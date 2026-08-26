import { readFileSync, writeFileSync } from "node:fs";
import { evaluateDayTrade, runLab } from "../src/backtest.ts";
import { MARKETS, type MarketCtx } from "../src/market.ts";
import { DEFAULT_PARAMS } from "../src/specs.ts";
import {
  OOS_SPLIT,
  prevSettlement,
  weekdayUtc,
} from "../src/calendar.ts";
import type { LabParams, MinuteBar, Trade } from "../src/types.ts";

/**
 * H-02：週五 PF 是選擇權結構還是多頭星期效應。
 *
 * 預先登記（主場 TX，ALPHA-37，成本開，seed 0 + 20 種子）：
 * 通過（「週五是選擇權結構」）：2025 週五 PF>1 且 2026 週五 PF>1，
 *   且週五多單 PF>1 且週五空單 PF>1，且 ≥70% 種子週五 PF > 其餘四天 PF。
 * 殺掉（issue 原文）：2025 週五 PF<1，或週五優勢只在多單（空單 PF<1 且多單 PF>1）。
 * 週選週五幾乎每週都到期，「非到期週五比較弱」這條 keep 條件是空的，改報
 *   月結算後那個週五 vs 其他週五，不當通過條件。
 * 30 日真 1 分只當診斷，不能當通過／殺掉。
 * 不准把 friday preset 當結論，不准改 DEFAULT_PARAMS。
 */

const SEED_N = 20;

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
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
function yearOf(d: string) {
  return d.slice(0, 4);
}
function isFri(d: string) {
  return weekdayUtc(d) === 5;
}
function daysSinceSettle(iso: string) {
  const prev = prevSettlement(iso);
  const a = Date.parse(`${prev}T00:00:00Z`);
  const b = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
/** 月結算週三之後那個週五（日曆 +2）。 */
function isPostSettleFri(iso: string) {
  return isFri(iso) && daysSinceSettle(iso) === 2;
}

function judge(s: {
  fri: ReturnType<typeof pfOf>;
  rest: ReturnType<typeof pfOf>;
  y2025: ReturnType<typeof pfOf>;
  y2026: ReturnType<typeof pfOf>;
  longs: ReturnType<typeof pfOf>;
  shorts: ReturnType<typeof pfOf>;
}) {
  const y2025Gt1 = s.y2025.pf > 1;
  const y2026Gt1 = s.y2026.pf > 1;
  const bothYears = y2025Gt1 && y2026Gt1;
  const bothSides = s.longs.pf > 1 && s.shorts.pf > 1;
  const longOnly = s.longs.pf > 1 && s.shorts.pf < 1;
  const friBeatsRest = s.fri.pf > s.rest.pf;
  const kill2025 = s.y2025.pf < 1;
  const pass = bothYears && bothSides && friBeatsRest;
  const kill = kill2025 || longOnly;
  return {
    y2025Gt1,
    y2026Gt1,
    bothYears,
    bothSides,
    longOnly,
    friBeatsRest,
    kill2025,
    pass,
    kill,
  };
}

function runOnce(market: MarketCtx, seedOffset: number) {
  const params: LabParams = { ...DEFAULT_PARAMS, seedOffset };
  const lab = runLab(params, market);
  const tr = lab.trades;
  const fri = tr.filter((t) => isFri(t.date));
  const rest = tr.filter((t) => !isFri(t.date));
  const pack = {
    all: pfOf(tr),
    fri: pfOf(fri),
    rest: pfOf(rest),
    y2024: pfOf(fri.filter((t) => yearOf(t.date) === "2024")),
    y2025: pfOf(fri.filter((t) => yearOf(t.date) === "2025")),
    y2026: pfOf(fri.filter((t) => yearOf(t.date) === "2026")),
    oos: pfOf(fri.filter((t) => t.date >= OOS_SPLIT)),
    longs: pfOf(fri.filter((t) => t.side === "long")),
    shorts: pfOf(fri.filter((t) => t.side === "short")),
    postSettleFri: pfOf(fri.filter((t) => isPostSettleFri(t.date))),
    otherFri: pfOf(fri.filter((t) => !isPostSettleFri(t.date))),
  };
  const share =
    pack.all.pnl !== 0 ? r(pack.fri.pnl / pack.all.pnl, 4) : 0;
  const v = judge(pack);
  return { seedOffset, share, ...pack, ...v };
}

function ocLayer(market: MarketCtx, fromIdx: number) {
  const cells: Record<string, { n: number; nPos: number; oc: number }> = {
    "1": { n: 0, nPos: 0, oc: 0 },
    "2": { n: 0, nPos: 0, oc: 0 },
    "3": { n: 0, nPos: 0, oc: 0 },
    "4": { n: 0, nPos: 0, oc: 0 },
    "5": { n: 0, nPos: 0, oc: 0 },
  };
  for (let i = Math.max(1, fromIdx); i < market.bars.length; i++) {
    const b = market.bars[i];
    const d = weekdayUtc(b.d);
    if (d < 1 || d > 5) continue;
    const oc = b.c - b.o;
    const c = cells[String(d)]!;
    c.n += 1;
    if (oc > 0) c.nPos += 1;
    c.oc += oc;
  }
  const px = market.bars[market.bars.length - 1]?.c || 1;
  const out: Record<string, { n: number; nPos: number; meanOc: number; meanBp: number }> = {};
  for (const [k, c] of Object.entries(cells)) {
    out[`週${["", "一", "二", "三", "四", "五"][Number(k)]}`] = {
      n: c.n,
      nPos: c.nPos,
      meanOc: c.n ? r(c.oc / c.n, 1) : 0,
      meanBp: c.n ? r((c.oc / c.n / px) * 10_000, 2) : 0,
    };
  }
  return out;
}

type RealFile = {
  days: Array<{ d: string; bars: MinuteBar[] }>;
};

function realFridayDiagnostic(market: MarketCtx) {
  let real: RealFile | null = null;
  try {
    real = JSON.parse(
      readFileSync(new URL("../data/tx-1min.json", import.meta.url), "utf8"),
    ) as RealFile;
  } catch {
    return { available: false as const };
  }
  const byDate = new Map(real.days.map((x) => [x.d, x.bars]));
  const params: LabParams = { ...DEFAULT_PARAMS, seedOffset: 0 };
  const recentR: number[] = [];
  const recentS: number[] = [];
  const friR: Trade[] = [];
  const restR: Trade[] = [];
  const friS: Trade[] = [];
  const restS: Trade[] = [];
  let nFriDays = 0;
  for (let i = market.startIdx; i < market.bars.length; i++) {
    const day = market.bars[i];
    const atr = market.ATR20[i];
    const realBars = byDate.get(day.d);
    const evS = evaluateDayTrade(
      day,
      market.bars[i - 1].c,
      atr,
      recentS,
      params,
      undefined,
      market,
    );
    recentS.push(evS.orWidth);
    if (recentS.length > 20) recentS.shift();
    let orR = evS.orWidth;
    if (realBars) {
      const evR = evaluateDayTrade(
        day,
        market.bars[i - 1].c,
        atr,
        recentR,
        params,
        realBars,
        market,
      );
      orR = evR.orWidth;
      if (isFri(day.d)) {
        nFriDays += 1;
        if (evR.trade) friR.push(evR.trade);
        if (evS.trade) friS.push(evS.trade);
      } else {
        if (evR.trade) restR.push(evR.trade);
        if (evS.trade) restS.push(evS.trade);
      }
    }
    recentR.push(orR);
    if (recentR.length > 20) recentR.shift();
  }
  return {
    available: true as const,
    nDays: real.days.length,
    nFriDays,
    real: { fri: pfOf(friR), rest: pfOf(restR) },
    syn: { fri: pfOf(friS), rest: pfOf(restS) },
    note: "n≈6 個週五，不是 H-02 通過／殺掉",
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
const nFriBeats = seeds.filter((s) => s.friBeatsRest).length;
const n2025gt1 = seeds.filter((s) => s.y2025Gt1).length;
const nBothSides = seeds.filter((s) => s.bothSides).length;
const pass = seed0.pass && nPass / SEED_N >= 0.7;
const kill = seed0.kill || n2025gt1 / SEED_N < 0.3;
const call = pass
  ? "PASS：週五兩年、兩向都 PF>1，且 ≥70% 種子週五優於其餘四天。仍不准把 friday preset 當結論（C 層路徑）。"
  : kill
    ? "KILL：2025 週五 PF<1，或優勢只在多單。不是可移植的選擇權結構。"
    : "INCONCLUSIVE：seed0 會過原文 keep 不等式，但種子過不了。「週五拿走七成」不是種子穩健的事實。不准把 friday preset 當結論。";

const realDiag = realFridayDiagnostic(tx);

const out = {
  generatedAt: "2026-08-26",
  experiment: "H-02",
  definition: {
    layer: "A×C（交易損益）+ A（o→c）",
    pass: "2025 與 2026 週五 PF>1，多空都 PF>1，≥70% 種子週五 PF>其餘四天",
    kill: "2025 週五 PF<1，或只在多單（空單 PF<1 且多單 PF>1）",
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
    nFriBeats,
    n2025gt1,
    nBothSides,
    call,
  },
  seed0: {
    all: seed0.all,
    fri: seed0.fri,
    rest: seed0.rest,
    share: seed0.share,
    y2024: seed0.y2024,
    y2025: seed0.y2025,
    y2026: seed0.y2026,
    oos: seed0.oos,
    longs: seed0.longs,
    shorts: seed0.shorts,
    postSettleFri: seed0.postSettleFri,
    otherFri: seed0.otherFri,
    y2025Gt1: seed0.y2025Gt1,
    y2026Gt1: seed0.y2026Gt1,
    bothSides: seed0.bothSides,
    longOnly: seed0.longOnly,
    friBeatsRest: seed0.friBeatsRest,
  },
  twii0: {
    fri: twii0.fri,
    rest: twii0.rest,
    share: twii0.share,
    y2025: twii0.y2025,
    y2026: twii0.y2026,
    longs: twii0.longs,
    shorts: twii0.shorts,
    pass: twii0.pass,
    kill: twii0.kill,
  },
  seeds: seeds.map((s) => ({
    seed: s.seedOffset,
    friPf: s.fri.pf,
    restPf: s.rest.pf,
    share: s.share,
    y2025: s.y2025.pf,
    y2026: s.y2026.pf,
    longPf: s.longs.pf,
    shortPf: s.shorts.pf,
    pass: s.pass,
    kill: s.kill,
  })),
  real1m: realDiag,
  aLayerOc: {
    window: ocLayer(tx, tx.startIdx),
    full2012: ocLayer(tx, 1),
  },
};

writeFileSync(
  new URL("../results/h02-friday.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log(call);
console.log("TX fri", seed0.fri, "rest", seed0.rest, "share", seed0.share);
console.log("y2025", seed0.y2025, "y2026", seed0.y2026, "oos", seed0.oos);
console.log("long", seed0.longs, "short", seed0.shorts);
console.log("postSettleFri", seed0.postSettleFri, "otherFri", seed0.otherFri);
console.log("seeds nPass", nPass, "nKill", nKill, "nFriBeats", nFriBeats, "n2025gt1", n2025gt1);
console.log("A-layer window", ocLayer(tx, tx.startIdx));
console.log("real1m", JSON.stringify(realDiag));
