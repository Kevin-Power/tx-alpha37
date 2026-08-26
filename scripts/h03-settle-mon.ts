import { writeFileSync } from "node:fs";
import { evaluateDayTrade, runLab } from "../src/backtest.ts";
import { MARKETS, gapClose, type MarketCtx } from "../src/market.ts";
import { DEFAULT_PARAMS } from "../src/specs.ts";
import {
  daysToSettlement,
  isSettlement,
  weekdayUtc,
} from "../src/calendar.ts";
import type { DayEval, LabParams, Trade } from "../src/types.ts";
import txFile from "../data/tx-daily.json";

/**
 * H-03：結算週週一該不該放假。
 *
 * 預先登記（主場 TX，ALPHA-37，成本開，seed 0 + 20 種子）：
 *   結算週週一 = weekday==1 且 daysToSettlement ≤ 2。
 * 通過（採納「放假」）：seed0 PF < 0.7，且其他週一 PF ≥ 0.7（傷害集中），
 *   且 2025／2026 同號（皆 PF<0.7 或皆損益為負），且 ≥70% 種子 PF<0.7，
 *   且經濟故事成立——換月（當日近月 ≠ 昨近月）或 |缺口|/ATR 中位 ≥ 其他週一的 1.5 倍。
 * 殺掉：seed0 PF ≥ 0.7，或其他週一一樣差，或分年翻號，或故事不成立（0 筆換月且缺口沒比較大）。
 * 不開新預設。n 太小即使通過也不改 DEFAULT_PARAMS。
 *
 * Q4 陪跑：結算週三 TX 上的 PF。預設仍是「繼續做」；要放假必須 PF<1。
 */

const SEED_N = 20;
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

const contractByDate = new Map(
  (txFile as { days: Array<{ d: string; contract: string }> }).days.map((x) => [
    x.d,
    x.contract,
  ]),
);

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}
function twd(n: number) {
  const s = Math.round(n).toLocaleString("en-US");
  return n > 0 ? `+${s}` : String(s);
}
function isSettleMon(iso: string) {
  return weekdayUtc(iso) === 1 && daysToSettlement(iso) <= 2;
}
function isOtherMon(iso: string) {
  return weekdayUtc(iso) === 1 && !isSettleMon(iso);
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
    avg: tr.length ? Math.round(pnl / tr.length) : 0,
  };
}

function yearOf(d: string) {
  return d.slice(0, 4);
}

function replay(params: LabParams, market: MarketCtx): DayEval[] {
  const bars = market.bars;
  const recentOr: number[] = [];
  const out: DayEval[] = [];
  for (let i = market.startIdx; i < bars.length; i++) {
    const ev = evaluateDayTrade(
      bars[i],
      bars[i - 1].c,
      market.ATR20[i],
      recentOr,
      params,
      undefined,
      market,
    );
    recentOr.push(ev.orWidth);
    if (recentOr.length > 20) recentOr.shift();
    out.push(ev);
  }
  return out;
}

function bucket(days: DayEval[], pred: (ev: DayEval) => boolean) {
  return pfOf(days.filter((ev) => pred(ev) && ev.trade).map((ev) => ev.trade!));
}

function judge(seed0: {
  settleMon: ReturnType<typeof pfOf>;
  otherMon: ReturnType<typeof pfOf>;
  y2025: ReturnType<typeof pfOf>;
  y2026: ReturnType<typeof pfOf>;
  nRoll: number;
  gapMedSettle: number;
  gapMedOther: number;
}) {
  const pfLow = seed0.settleMon.pf < 0.7;
  const concentrated = seed0.otherMon.pf >= 0.7;
  const y2025Bad = seed0.y2025.pf < 0.7 || seed0.y2025.pnl < 0;
  const y2026Bad = seed0.y2026.pf < 0.7 || seed0.y2026.pnl < 0;
  const yearSame = y2025Bad && y2026Bad;
  const yearsFlip =
    (seed0.y2025.pnl >= 0 && seed0.y2026.pnl < 0) ||
    (seed0.y2025.pnl < 0 && seed0.y2026.pnl >= 0);
  const gapLarger =
    seed0.gapMedOther > 0 && seed0.gapMedSettle >= 1.5 * seed0.gapMedOther;
  const story = seed0.nRoll > 0 || gapLarger;
  const pass = pfLow && concentrated && yearSame && story;
  const kill =
    !pfLow || !concentrated || yearsFlip || !story;
  return {
    pfLow,
    concentrated,
    yearSame,
    yearsFlip,
    story,
    nRoll: seed0.nRoll,
    gapLarger,
    pass,
    kill,
  };
}

function ocLayer(market: MarketCtx, fromIdx: number) {
  const cells = {
    settleMon: { n: 0, nPos: 0, oc: 0, gapAbs: 0 },
    otherMon: { n: 0, nPos: 0, oc: 0, gapAbs: 0 },
    settleWed: { n: 0, nPos: 0, oc: 0, gapAbs: 0 },
    other: { n: 0, nPos: 0, oc: 0, gapAbs: 0 },
  };
  for (let i = Math.max(1, fromIdx); i < market.bars.length; i++) {
    const b = market.bars[i];
    const prev = market.bars[i - 1];
    const oc = b.c - b.o;
    const g = Math.abs(b.o - gapClose(b, prev.c));
    const d = weekdayUtc(b.d);
    if (d < 1 || d > 5) continue;
    const key = isSettleMon(b.d)
      ? "settleMon"
      : isSettlement(b.d)
        ? "settleWed"
        : isOtherMon(b.d)
          ? "otherMon"
          : "other";
    const c = cells[key];
    c.n += 1;
    if (oc > 0) c.nPos += 1;
    c.oc += oc;
    c.gapAbs += g;
  }
  const px = market.bars[market.bars.length - 1]?.c || 1;
  const out: Record<string, { n: number; nPos: number; meanOc: number; meanBp: number; meanGap: number }> = {};
  for (const [k, c] of Object.entries(cells)) {
    out[k] = {
      n: c.n,
      nPos: c.nPos,
      meanOc: c.n ? r(c.oc / c.n, 1) : 0,
      meanBp: c.n ? r((c.oc / c.n / px) * 10_000, 2) : 0,
      meanGap: c.n ? r(c.gapAbs / c.n, 1) : 0,
    };
  }
  return out;
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
}

function packDay(ev: DayEval, prevDate: string | undefined) {
  const t = ev.trade;
  const contract = contractByDate.get(ev.date) ?? "";
  const prevC = prevDate ? (contractByDate.get(prevDate) ?? "") : "";
  const roll = Boolean(contract && prevC && contract !== prevC);
  const gapAtr = ev.atr > 0 ? Math.abs(ev.gapPts) / ev.atr : 0;
  return {
    date: ev.date,
    dow: `週${DOW[ev.weekday]}`,
    dts: daysToSettlement(ev.date),
    contract,
    prevContract: prevC || null,
    roll,
    gapPts: r(ev.gapPts, 1),
    gapAtr: r(gapAtr, 3),
    orWidth: r(ev.orWidth, 1),
    side: t?.side ?? null,
    skipped: t ? null : ev.skipped,
    reason: t?.reason ?? ev.skipped,
    pnl: t ? Math.round(t.pnlTwd) : 0,
    pts: t ? r(t.pts, 1) : 0,
  };
}

function runOnce(market: MarketCtx, seedOffset: number) {
  const params: LabParams = { ...DEFAULT_PARAMS, seedOffset };
  const days = replay(params, market);
  const settleDays = days.filter((ev) => isSettleMon(ev.date));
  const tradesSettle = settleDays.filter((ev) => ev.trade).map((ev) => ev.trade!);
  const otherMon = bucket(days, (ev) => isOtherMon(ev.date));
  const settleWed = bucket(days, (ev) => isSettlement(ev.date));
  const allMon = bucket(days, (ev) => weekdayUtc(ev.date) === 1);
  const all = pfOf(days.filter((ev) => ev.trade).map((ev) => ev.trade!));
  const y2025 = pfOf(tradesSettle.filter((t) => yearOf(t.date) === "2025"));
  const y2026 = pfOf(tradesSettle.filter((t) => yearOf(t.date) === "2026"));
  const y2024 = pfOf(tradesSettle.filter((t) => yearOf(t.date) === "2024"));
  const dateIndex = new Map(market.bars.map((b, i) => [b.d, i]));
  const listed = settleDays.map((ev) => {
    const i = dateIndex.get(ev.date) ?? -1;
    const prevDate = i > 0 ? market.bars[i - 1]?.d : undefined;
    return packDay(ev, prevDate);
  });
  const nRoll = listed.filter((x) => x.roll).length;
  const gapMedSettle = median(listed.map((x) => Math.abs(x.gapAtr)));
  const otherMonDays = days.filter((ev) => isOtherMon(ev.date));
  const gapMedOther = median(
    otherMonDays.map((ev) => (ev.atr > 0 ? Math.abs(ev.gapPts) / ev.atr : 0)),
  );
  const settle = pfOf(tradesSettle);
  const v = judge({
    settleMon: settle,
    otherMon,
    y2025,
    y2026,
    nRoll,
    gapMedSettle,
    gapMedOther,
  });
  return {
    seedOffset,
    all,
    settleMon: settle,
    otherMon,
    allMon,
    settleWed,
    y2024,
    y2025,
    y2026,
    nSettleDays: settleDays.length,
    nRoll,
    gapMedSettle: r(gapMedSettle, 3),
    gapMedOther: r(gapMedOther, 3),
    listed,
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
const nPfLow = seeds.filter((s) => s.pfLow).length;
const nStory = seeds.filter((s) => s.story).length;
const pass = seed0.pass && nPass / SEED_N >= 0.7;
const kill = seed0.kill || nPfLow / SEED_N < 0.7;
const call = pass
  ? "PASS：結算週週一 PF<0.7、傷害集中、分年同號、經濟故事成立。仍不准開新預設（n 太小）。"
  : kill
    ? "KILL：不是該放假的法則。PF 不夠低、傷害不集中、分年翻號，或換月跳空故事不成立。"
    : "INCONCLUSIVE。";

const aWindow = ocLayer(tx, tx.startIdx);
const aFull = ocLayer(tx, 1);

const out = {
  generatedAt: "2026-08-26",
  experiment: "H-03",
  definition: {
    layer: "A×C（交易損益）+ A（o→c／缺口／換月）",
    settleMon: "weekday==1 && daysToSettlement≤2",
    pass: "PF<0.7 且其他週一 PF≥0.7 且 2025／2026 同號且故事成立且 ≥70% 種子",
    kill: "PF≥0.7 或其他週一一樣差或分年翻號或 0 換月且缺口沒比較大",
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
    nPfLow,
    nStory,
    call,
  },
  seed0: {
    all: seed0.all,
    settleMon: seed0.settleMon,
    otherMon: seed0.otherMon,
    allMon: seed0.allMon,
    settleWed: seed0.settleWed,
    y2024: seed0.y2024,
    y2025: seed0.y2025,
    y2026: seed0.y2026,
    nSettleDays: seed0.nSettleDays,
    nRoll: seed0.nRoll,
    gapMedSettle: seed0.gapMedSettle,
    gapMedOther: seed0.gapMedOther,
    pfLow: seed0.pfLow,
    concentrated: seed0.concentrated,
    yearSame: seed0.yearSame,
    yearsFlip: seed0.yearsFlip,
    story: seed0.story,
    listed: seed0.listed,
  },
  twii0: {
    settleMon: twii0.settleMon,
    otherMon: twii0.otherMon,
    settleWed: twii0.settleWed,
    nRoll: twii0.nRoll,
    pass: twii0.pass,
    kill: twii0.kill,
  },
  seeds: seeds.map((s) => ({
    seed: s.seedOffset,
    pf: s.settleMon.pf,
    n: s.settleMon.n,
    pnl: s.settleMon.pnl,
    otherPf: s.otherMon.pf,
    wedPf: s.settleWed.pf,
    nRoll: s.nRoll,
    pass: s.pass,
    kill: s.kill,
    pfLow: s.pfLow,
    story: s.story,
  })),
  aLayerOc: { window: aWindow, full2012: aFull },
};

writeFileSync(
  new URL("../results/h03-settle-mon.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log(call);
console.log(
  "TX settleMon",
  seed0.settleMon,
  "otherMon",
  seed0.otherMon,
  "settleWed",
  seed0.settleWed,
);
console.log(
  "nDays",
  seed0.nSettleDays,
  "nRoll",
  seed0.nRoll,
  "gapMed",
  seed0.gapMedSettle,
  "vs other",
  seed0.gapMedOther,
);
console.log("y2025", seed0.y2025, "y2026", seed0.y2026);
console.log("seeds nPass", nPass, "nKill", nKill, "nPfLow", nPfLow);
console.log("A-layer window", aWindow);
console.log("A-layer 2012+", aFull);
