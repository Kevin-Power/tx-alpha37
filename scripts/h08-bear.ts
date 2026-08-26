import { writeFileSync } from "node:fs";
import { runBacktest } from "../src/backtest.ts";
import { MARKETS, gapClose, type MarketCtx } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import type { LabParams, Trade } from "../src/types.ts";

/**
 * H-08 / Q5：結構37 有沒有空頭年。
 *
 * 預先登記（GitHub #9）：
 *   主場 TX 近月，tradeFrom=2012-01-02（不改 SAMPLE_START）。
 *   空頭年鎖死 2018、2022，不准改成年再報。
 *   ΔPF = PF(結構37) − PF(ALPHA-37)。
 * 通過（恢復「全能濾網」）：2018 與 2022 的 ΔPF 都 > 0，且 ≥70% 種子成立。
 * 殺掉：任一年 ΔPF ≤ 0，或兩年翻號，或 <70% 種子。
 * A 層 o→c（均線上/下 × 年）只陪跑，不能覆寫通過／殺掉。
 * 成本模型沿用 2026 MTX。相對 ΔPF 才是主張。
 * 不准開新預設，不准改 MA20／0.8／probeMin。
 */

const SEED_N = 20;
const BEAR = ["2018", "2022"] as const;
const YEARS = [
  "2012",
  "2013",
  "2014",
  "2015",
  "2016",
  "2017",
  "2018",
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
] as const;

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}

function withTradeFrom(m: MarketCtx, from: string): MarketCtx {
  let startIdx = m.bars.findIndex((b) => b.d >= from);
  if (startIdx < 1) startIdx = 1;
  return { ...m, tradeFrom: from, startIdx };
}

function pfOf(tr: Trade[]) {
  const gw = tr.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(
    tr.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0),
  );
  const pnl = tr.reduce((s, t) => s + t.pnlTwd, 0);
  return {
    n: tr.length,
    win: tr.filter((t) => t.pnlTwd > 0).length,
    wr: tr.length ? r(tr.filter((t) => t.pnlTwd > 0).length / tr.length, 4) : 0,
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 3),
    pnl: Math.round(pnl),
  };
}

function byYear(tr: Trade[]) {
  const out: Record<string, ReturnType<typeof pfOf>> = {};
  for (const y of YEARS) {
    out[y] = pfOf(tr.filter((t) => t.date.startsWith(y)));
  }
  return out;
}

function runSpec(market: MarketCtx, spec: "alpha37" | "struct37" | "torb37", seedOffset: number) {
  const params: LabParams = {
    ...DEFAULT_PARAMS,
    ...PRESETS[spec].params,
    seedOffset,
  };
  // 不用 runLab：memo key 是 market.id，改 startIdx 會撞到 2024 窗的 cache。
  const lab = runBacktest(params, market);
  return { spec, seedOffset, all: pfOf(lab.trades), years: byYear(lab.trades) };
}

function judge(a2018: number, s2018: number, a2022: number, s2022: number) {
  const d2018 = r(s2018 - a2018, 4);
  const d2022 = r(s2022 - a2022, 4);
  const bothPos = d2018 > 0 && d2022 > 0;
  const yearsFlip = d2018 * d2022 < 0;
  const anyNonPos = d2018 <= 0 || d2022 <= 0;
  return {
    d2018,
    d2022,
    bothPos,
    yearsFlip,
    pass: bothPos,
    kill: anyNonPos || yearsFlip,
  };
}

function ocByYear(market: MarketCtx) {
  const cells: Record<
    string,
    { n: number; nPos: number; oc: number; above: boolean }
  > = {};
  const key = (y: string, above: boolean) => `${y}-${above ? "above" : "below"}`;
  for (const y of YEARS) {
    cells[key(y, true)] = { n: 0, nPos: 0, oc: 0, above: true };
    cells[key(y, false)] = { n: 0, nPos: 0, oc: 0, above: false };
  }
  for (let i = 1; i < market.bars.length; i++) {
    const b = market.bars[i];
    const y = b.d.slice(0, 4);
    if (!(YEARS as readonly string[]).includes(y)) continue;
    const prev = market.bars[i - 1];
    const ma = market.MA20[i - 1];
    const above = prev.c >= ma;
    const oc = b.c - b.o;
    const c = cells[key(y, above)]!;
    c.n += 1;
    if (oc > 0) c.nPos += 1;
    c.oc += oc;
  }
  const px = market.bars[market.bars.length - 1]?.c || 1;
  const years: Record<
    string,
    {
      above: { n: number; nPos: number; meanOc: number; meanBp: number };
      below: { n: number; nPos: number; meanOc: number; meanBp: number };
    }
  > = {};
  const pack = (c: { n: number; nPos: number; oc: number }) => ({
    n: c.n,
    nPos: c.nPos,
    meanOc: c.n ? r(c.oc / c.n, 1) : 0,
    meanBp: c.n ? r((c.oc / c.n / px) * 10_000, 2) : 0,
  });
  for (const y of YEARS) {
    years[y] = {
      above: pack(cells[key(y, true)]!),
      below: pack(cells[key(y, false)]!),
    };
  }
  return years;
}

function overnight(market: MarketCtx) {
  // Q14 陪跑：隔夜 = 今開 − 同合約昨收；日內 = 收 − 開。不是 H-08 通過／殺掉。
  const nightStart = "2017-05-15";
  const buckets = {
    preNight: { on: 0, day: 0, n: 0 },
    postNight: { on: 0, day: 0, n: 0 },
    window2024: { on: 0, day: 0, n: 0 },
    full: { on: 0, day: 0, n: 0 },
  };
  for (let i = 1; i < market.bars.length; i++) {
    const b = market.bars[i];
    const prev = market.bars[i - 1];
    const on = b.o - gapClose(b, prev.c);
    const day = b.c - b.o;
    const add = (k: keyof typeof buckets) => {
      buckets[k].on += on;
      buckets[k].day += day;
      buckets[k].n += 1;
    };
    add("full");
    if (b.d < nightStart) add("preNight");
    else add("postNight");
    if (b.d >= "2024-08-26") add("window2024");
  }
  const pack = (b: { on: number; day: number; n: number }) => {
    const tot = b.on + b.day;
    return {
      n: b.n,
      overnightPts: r(b.on, 1),
      dayPts: r(b.day, 1),
      overnightShare: tot !== 0 ? r(b.on / tot, 4) : 0,
    };
  };
  return {
    preNight: pack(buckets.preNight),
    postNight: pack(buckets.postNight),
    window2024: pack(buckets.window2024),
    full: pack(buckets.full),
  };
}

const tx = withTradeFrom(MARKETS.tx, "2012-01-02");
console.log("H-08 window", tx.bars[tx.startIdx]?.d, "→", tx.bars[tx.bars.length - 1]?.d, "nDays", tx.bars.length - tx.startIdx);

const seed0 = {
  alpha: runSpec(tx, "alpha37", 0),
  struct: runSpec(tx, "struct37", 0),
  torb: runSpec(tx, "torb37", 0),
};
const v0 = judge(
  seed0.alpha.years["2018"]!.pf,
  seed0.struct.years["2018"]!.pf,
  seed0.alpha.years["2022"]!.pf,
  seed0.struct.years["2022"]!.pf,
);

const seeds = [];
for (let s = 0; s < SEED_N; s++) {
  const alpha = runSpec(tx, "alpha37", s);
  const struct = runSpec(tx, "struct37", s);
  const v = judge(
    alpha.years["2018"]!.pf,
    struct.years["2018"]!.pf,
    alpha.years["2022"]!.pf,
    struct.years["2022"]!.pf,
  );
  seeds.push({
    seed: s,
    a2018: alpha.years["2018"]!.pf,
    s2018: struct.years["2018"]!.pf,
    a2022: alpha.years["2022"]!.pf,
    s2022: struct.years["2022"]!.pf,
    ...v,
  });
  console.log("seed", s, "d2018", v.d2018, "d2022", v.d2022, "pass", v.pass, "kill", v.kill);
}

const nPass = seeds.filter((s) => s.pass).length;
const nKill = seeds.filter((s) => s.kill).length;
const nBothPos = seeds.filter((s) => s.bothPos).length;
const pass = v0.pass && nPass / SEED_N >= 0.7;
const kill = v0.kill || nBothPos / SEED_N < 0.7;
const call = pass
  ? "PASS：2018 與 2022 結構37 相對 ALPHA-37 的 ΔPF 都為正，且 ≥70% 種子。仍不准寫全能濾網以外的升級（C 層路徑；成本模型是 2026）。"
  : kill
    ? "KILL：空頭年加分不成立。結構37 不是全能濾網。"
    : "INCONCLUSIVE。";

const yearTable = YEARS.map((y) => ({
  year: y,
  alpha: seed0.alpha.years[y],
  struct: seed0.struct.years[y],
  torb: seed0.torb.years[y],
  dPf: r(seed0.struct.years[y]!.pf - seed0.alpha.years[y]!.pf, 4),
  dPnl: seed0.struct.years[y]!.pnl - seed0.alpha.years[y]!.pnl,
}));

const out = {
  generatedAt: "2026-08-26",
  experiment: "H-08",
  issue: 9,
  definition: {
    layer: "A×C（交易損益，重建 1 分）+ A（o→c）",
    tradeFrom: "2012-01-02",
    bearYears: BEAR,
    dPf: "PF(struct37) − PF(ALPHA-37)",
    pass: "2018 與 2022 ΔPF 都 > 0 且 ≥70% 種子",
    kill: "任一年 ΔPF≤0 或兩年翻號或 <70% 種子",
    seeds: SEED_N,
    primary: "tx",
    sampleStartUnchanged: true,
    costModel: "2026 MTX",
    notTuned: true,
  },
  verdict: {
    pass,
    kill,
    seed0Pass: v0.pass,
    seed0Kill: v0.kill,
    nPass,
    nKill,
    nBothPos,
    call,
  },
  seed0: {
    all: {
      alpha: seed0.alpha.all,
      struct: seed0.struct.all,
      torb: seed0.torb.all,
      dPf: r(seed0.struct.all.pf - seed0.alpha.all.pf, 4),
      dPnl: seed0.struct.all.pnl - seed0.alpha.all.pnl,
    },
    years: yearTable,
    bear: {
      y2018: {
        alpha: seed0.alpha.years["2018"],
        struct: seed0.struct.years["2018"],
        torb: seed0.torb.years["2018"],
        dPf: v0.d2018,
      },
      y2022: {
        alpha: seed0.alpha.years["2022"],
        struct: seed0.struct.years["2022"],
        torb: seed0.torb.years["2022"],
        dPf: v0.d2022,
      },
    },
    ...v0,
  },
  seeds,
  aLayerOc: ocByYear(tx),
  q14Overnight: overnight(tx),
};

writeFileSync(
  new URL("../results/h08-bear.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log(call);
console.log("2018", seed0.alpha.years["2018"], seed0.struct.years["2018"], "dPf", v0.d2018);
console.log("2022", seed0.alpha.years["2022"], seed0.struct.years["2022"], "dPf", v0.d2022);
console.log("full", seed0.alpha.all, seed0.struct.all);
console.log("seeds nPass", nPass, "nKill", nKill, "nBothPos", nBothPos);
console.log("overnight", overnight(tx));
