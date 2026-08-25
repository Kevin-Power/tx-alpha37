import { writeFileSync } from "node:fs";
import { runLab } from "../src/backtest.ts";
import { MARKETS, type MarketCtx } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { OOS_SPLIT, weekdayUtc } from "../src/calendar.ts";
import type { LabParams, Trade } from "../src/types.ts";

const SEED_N = 20;
const DOW = [1, 2, 3, 4, 5] as const;
const LABELS = ["一", "二", "三", "四", "五"] as const;

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}
function twd(n: number) {
  const s = Math.round(n).toLocaleString("en-US");
  return n > 0 ? `+${s}` : String(s);
}

function pfOf(tr: Trade[]) {
  const gw = tr.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(tr.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0));
  const pnl = tr.reduce((s, t) => s + t.pnlTwd, 0);
  return {
    n: tr.length,
    win: tr.filter((t) => t.pnlTwd > 0).length,
    wr: tr.length ? r(tr.filter((t) => t.pnlTwd > 0).length / tr.length, 4) : 0,
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 4),
    pnl: Math.round(pnl),
  };
}

function tagAboveMa(trades: Trade[], market: MarketCtx) {
  return trades.map((t) => {
    const i = market.indexByDate.get(t.date) ?? -1;
    const prev = market.bars[Math.max(0, i - 1)];
    const ma = i > 0 ? market.MA20[i - 1] : prev.c;
    return { t, aboveMa: prev.c >= ma, dow: weekdayUtc(t.date) };
  });
}

function cellTable(trades: Trade[], market: MarketCtx) {
  const tagged = tagAboveMa(trades, market);
  const grid: Record<string, ReturnType<typeof pfOf>> = {};
  for (const above of [true, false]) {
    for (const d of DOW) {
      const rows = tagged.filter((x) => x.aboveMa === above && x.dow === d).map((x) => x.t);
      grid[`${above ? "above" : "below"}-${d}`] = pfOf(rows);
    }
  }
  return grid;
}

function weekdayDelta(alpha: Trade[], struct: Trade[]) {
  return DOW.map((d) => {
    const a = pfOf(alpha.filter((t) => weekdayUtc(t.date) === d));
    const s = pfOf(struct.filter((t) => weekdayUtc(t.date) === d));
    return {
      dow: d,
      label: `週${LABELS[d - 1]}`,
      alpha: a,
      struct: s,
      dN: s.n - a.n,
      dPf: r(s.pf - a.pf, 4),
      dPnl: s.pnl - a.pnl,
    };
  });
}

function yearPf(tr: Trade[], year: string) {
  return pfOf(tr.filter((t) => t.date.startsWith(year)));
}

function judge(rows: ReturnType<typeof weekdayDelta>, d2025: number, d2026: number) {
  const signs = rows.map((x) => Math.sign(x.dPf));
  const nPos = signs.filter((s) => s > 0).length;
  const nNeg = signs.filter((s) => s < 0).length;
  const sameSign4 = nPos >= 4 || nNeg >= 4;
  const yearSame = Math.sign(d2025) === Math.sign(d2026) && Math.sign(d2025) !== 0;
  const gainThuFri = rows[3].dPf > 0 || rows[4].dPf > 0;
  const monWedNonPos = rows[0].dPf <= 0 && rows[1].dPf <= 0 && rows[2].dPf <= 0;
  const gainOnlyThuFri = gainThuFri && monWedNonPos && nPos > 0 && nPos <= 2;
  const othersWorsen = rows[0].dPf < 0 || rows[1].dPf < 0 || rows[2].dPf < 0;
  const yearsFlip = d2025 * d2026 < 0;
  const pass = sameSign4 && yearSame;
  const kill = gainOnlyThuFri || (othersWorsen && yearsFlip);
  return { nPos, nNeg, sameSign4, yearSame, gainOnlyThuFri, othersWorsen, yearsFlip, pass, kill };
}

function aLayerOc(market: MarketCtx) {
  const cells: Record<string, { n: number; nPos: number; sum: number; meanBp: number }> = {};
  for (const above of [true, false]) {
    for (const d of DOW) {
      cells[`${above ? "above" : "below"}-${d}`] = { n: 0, nPos: 0, sum: 0, meanBp: 0 };
    }
  }
  for (let i = market.startIdx; i < market.bars.length; i++) {
    const b = market.bars[i];
    const prev = market.bars[i - 1];
    const ma = market.MA20[i - 1];
    const above = prev.c >= ma;
    const d = weekdayUtc(b.d);
    if (d < 1 || d > 5) continue;
    const oc = b.c - b.o;
    const key = `${above ? "above" : "below"}-${d}`;
    const c = cells[key];
    c.n += 1;
    if (oc > 0) c.nPos += 1;
    c.sum += oc;
  }
  for (const c of Object.values(cells)) {
    const px = market.bars[market.bars.length - 1]?.c || 1;
    c.meanBp = c.n ? r((c.sum / c.n / px) * 10_000, 2) : 0;
    c.sum = r(c.sum, 1);
  }
  return cells;
}

function runOnce(market: MarketCtx, seedOffset: number) {
  const alphaP: LabParams = { ...DEFAULT_PARAMS, seedOffset };
  const structP: LabParams = {
    ...DEFAULT_PARAMS,
    ...PRESETS.struct37.params,
    seedOffset,
  };
  const alpha = runLab(alphaP, market);
  const struct = runLab(structP, market);
  const rows = weekdayDelta(alpha.trades, struct.trades);
  const a2025 = yearPf(alpha.trades, "2025");
  const s2025 = yearPf(struct.trades, "2025");
  const a2026 = yearPf(alpha.trades, "2026");
  const s2026 = yearPf(struct.trades, "2026");
  const d2025 = r(s2025.pf - a2025.pf, 4);
  const d2026 = r(s2026.pf - a2026.pf, 4);
  const v = judge(rows, d2025, d2026);
  return {
    seedOffset,
    alphaN: alpha.kpis.trades,
    alphaPf: r(alpha.kpis.profitFactor, 4),
    structN: struct.kpis.trades,
    structPf: r(struct.kpis.profitFactor, 4),
    dPf: r(struct.kpis.profitFactor - alpha.kpis.profitFactor, 4),
    dPnl: Math.round(struct.kpis.netPnl - alpha.kpis.netPnl),
    rows,
    y2025: { alpha: a2025, struct: s2025, dPf: d2025 },
    y2026: { alpha: a2026, struct: s2026, dPf: d2026 },
    grid: cellTable(alpha.trades, market),
    ...v,
  };
}

const tx = MARKETS.tx;
const twii = MARKETS.twii;
const seed0 = runOnce(tx, 0);
const twii0 = runOnce(twii, 0);

const seeds = [];
for (let s = 0; s < SEED_N; s++) seeds.push(runOnce(tx, s));

const nPass = seeds.filter((s) => s.pass).length;
const nKill = seeds.filter((s) => s.kill).length;
const nPos4 = seeds.filter((s) => s.nPos >= 4).length;
const nYearSame = seeds.filter((s) => s.yearSame).length;
const nYearPos = seeds.filter((s) => s.y2025.dPf > 0 && s.y2026.dPf > 0).length;

const pass = seed0.pass && nPass / SEED_N >= 0.7;
const kill = seed0.kill || nPos4 / SEED_N < 0.3;
const call = pass
  ? "PASS：MA20 在至少四個 weekday 的 PF 增量同號，2025／2026 同號，且 ≥70% 種子成立。"
  : kill
    ? "KILL：增益集中在週四／週五，或其他 weekday 變差且分年翻號。結構37 不是跨星期的均線結構。"
    : "INCONCLUSIVE。";

const aOc = aLayerOc(tx);

const out = {
  generatedAt: "2026-08-25",
  experiment: "H-07",
  definition: {
    layer: "A×C",
    grid: "MA20 above/below × weekday",
    dPf: "PF(struct37 weekday) − PF(ALPHA-37 weekday)",
    seeds: SEED_N,
    primary: "tx",
    notTuned: true,
  },
  verdict: {
    pass,
    kill,
    seed0Pass: seed0.pass,
    seed0Kill: seed0.kill,
    nPass,
    nKill,
    nPos4,
    nYearSame,
    nYearPos,
    call,
  },
  seed0,
  twii0: {
    dPf: twii0.dPf,
    dPnl: twii0.dPnl,
    rows: twii0.rows,
    y2025: twii0.y2025,
    y2026: twii0.y2026,
    ...{
      pass: twii0.pass,
      kill: twii0.kill,
      nPos: twii0.nPos,
      nNeg: twii0.nNeg,
    },
  },
  seeds: seeds.map((s) => ({
    seed: s.seedOffset,
    dPf: s.dPf,
    dPnl: s.dPnl,
    nPos: s.nPos,
    nNeg: s.nNeg,
    d2025: s.y2025.dPf,
    d2026: s.y2026.dPf,
    pass: s.pass,
    kill: s.kill,
    weekdayDpf: s.rows.map((x) => x.dPf),
  })),
  aLayerOc: aOc,
};

writeFileSync(
  new URL("../results/h07-ma.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log("TWII seed0", JSON.stringify({
  dPf: twii0.dPf,
  dPnl: twii0.dPnl,
  nPos: twii0.nPos,
  nNeg: twii0.nNeg,
  pass: twii0.pass,
  kill: twii0.kill,
  d2025: twii0.y2025.dPf,
  d2026: twii0.y2026.dPf,
}));
console.log("TX seed0", JSON.stringify({
  dPf: seed0.dPf,
  dPnl: seed0.dPnl,
  nPos: seed0.nPos,
  nNeg: seed0.nNeg,
  pass: seed0.pass,
  kill: seed0.kill,
  d2025: seed0.y2025.dPf,
  d2026: seed0.y2026.dPf,
  weekday: seed0.rows.map((x) => `${x.label} ΔPF=${x.dPf} Δpnl=${twd(x.dPnl)}`),
}));
console.log(
  `seeds nPass=${nPass}/${SEED_N} nKill=${nKill}/${SEED_N} nPos4=${nPos4}/${SEED_N} nYearSame=${nYearSame}/${SEED_N}`,
);
console.log(call);
console.log("");
console.log("## TX seed 0  2×5（ALPHA-37 交易）");
console.log("| MA20 | 一 | 二 | 三 | 四 | 五 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const above of [true, false]) {
  const cells = DOW.map((d) => seed0.grid[`${above ? "above" : "below"}-${d}`]);
  console.log(
    `| ${above ? "上" : "下"} | ${cells.map((c) => `n=${c.n} PF=${c.pf.toFixed(2)} ${twd(c.pnl)}`).join(" | ")} |`,
  );
}
console.log("");
console.log("| 星期 | α n | α PF | α 損益 | 結構 n | 結構 PF | ΔPF | Δ損益 |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const x of seed0.rows) {
  console.log(
    `| ${x.label} | ${x.alpha.n} | ${x.alpha.pf} | ${twd(x.alpha.pnl)} | ${x.struct.n} | ${x.struct.pf} | ${x.dPf} | ${twd(x.dPnl)} |`,
  );
}
