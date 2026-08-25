import { writeFileSync } from "node:fs";
import { evaluateDayTrade, runLab } from "../src/backtest.ts";
import { MARKETS, gapClose, type MarketCtx } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { weekdayUtc } from "../src/calendar.ts";
import type { DayEval, LabParams, Trade } from "../src/types.ts";

const CRASH = ["2025-11", "2025-12", "2026-07"] as const;
const NEIGHBOR = ["2026-06", "2026-08"] as const;
const MONTHS = [...CRASH, ...NEIGHBOR] as const;
const DOW = ["日", "一", "二", "三", "四", "五", "六"];

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}
function twd(n: number) {
  const s = Math.round(n).toLocaleString("en-US");
  return n > 0 ? `+${s}` : String(s);
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

function monthOf(d: string) {
  return d.slice(0, 7);
}

function pfOf(tr: Trade[]) {
  const gw = tr.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(tr.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0));
  const pnl = tr.reduce((s, t) => s + t.pnlTwd, 0);
  return {
    n: tr.length,
    win: tr.filter((t) => t.pnlTwd > 0).length,
    pnl: Math.round(pnl),
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 3),
    wr: tr.length ? r(tr.filter((t) => t.pnlTwd > 0).length / tr.length, 4) : 0,
  };
}

function attachStops(days: DayEval[]) {
  let streak = 0;
  return days.map((ev) => {
    if (!ev.trade) return { ...ev, stopStreak: 0 };
    if (ev.trade.reason === "停損") streak += 1;
    else streak = 0;
    return { ...ev, stopStreak: streak };
  });
}

function packDay(
  ev: DayEval & { stopStreak: number },
  structEv: DayEval | undefined,
) {
  const t = ev.trade;
  const gapAtr = ev.atr > 0 ? Math.abs(ev.gapPts) / ev.atr : 0;
  return {
    date: ev.date,
    dow: `週${DOW[ev.weekday]}`,
    settlement: ev.settlement,
    side: t?.side ?? null,
    reason: t?.reason ?? ev.skipped,
    pts: t ? r(t.pts, 1) : null,
    pnl: t ? Math.round(t.pnlTwd) : null,
    gapPts: r(ev.gapPts, 1),
    gapAtr: r(gapAtr, 3),
    aboveMa: ev.aboveMa,
    orWidth: r(ev.orWidth, 1),
    stopStreak: ev.stopStreak,
    structSkip: structEv?.skipped ?? null,
    structKept: Boolean(structEv?.trade),
  };
}

function monthBlock(
  ym: string,
  alphaDays: (DayEval & { stopStreak: number })[],
  structDays: DayEval[],
) {
  const a = alphaDays.filter((d) => monthOf(d.date) === ym);
  const s = structDays.filter((d) => monthOf(d.date) === ym);
  const aTr = a.map((d) => d.trade).filter((t): t is Trade => Boolean(t));
  const sTr = s.map((d) => d.trade).filter((t): t is Trade => Boolean(t));
  const structMap = new Map(s.map((d) => [d.date, d]));
  const traded = a.filter((d) => d.trade);
  const avoided = traded.filter((d) => !structMap.get(d.date)?.trade);
  const avoidedPnl = avoided.reduce((x, d) => x + (d.trade?.pnlTwd ?? 0), 0);
  return {
    month: ym,
    alpha: pfOf(aTr),
    struct: pfOf(sTr),
    saved: Math.round(pfOf(sTr).pnl - pfOf(aTr).pnl),
    avoidedN: avoided.length,
    avoidedPnl: Math.round(avoidedPnl),
    belowMaN: traded.filter((d) => !d.aboveMa).length,
    wedN: traded.filter((d) => d.weekday === 3).length,
    stopN: aTr.filter((t) => t.reason === "停損").length,
    long: pfOf(aTr.filter((t) => t.side === "long")),
    short: pfOf(aTr.filter((t) => t.side === "short")),
    trades: traded.map((d) => packDay(d, structMap.get(d.date))),
  };
}

function runMarket(id: "tx" | "twii") {
  const market = MARKETS[id];
  const alphaP = DEFAULT_PARAMS;
  const structP = { ...DEFAULT_PARAMS, ...PRESETS.struct37.params };
  const alphaRes = runLab(alphaP, market);
  const structRes = runLab(structP, market);
  const alphaDays = attachStops(replay(alphaP, market));
  const structDays = replay(structP, market);
  const months = MONTHS.map((ym) => monthBlock(ym, alphaDays, structDays));
  const crashAlpha = alphaRes.trades.filter((t) =>
    CRASH.includes(monthOf(t.date) as (typeof CRASH)[number]),
  );
  const crashStruct = structRes.trades.filter((t) =>
    CRASH.includes(monthOf(t.date) as (typeof CRASH)[number]),
  );
  const crashSaved =
    crashStruct.reduce((s, t) => s + t.pnlTwd, 0) -
    crashAlpha.reduce((s, t) => s + t.pnlTwd, 0);
  const structDelta = structRes.kpis.netPnl - alphaRes.kpis.netPnl;
  const neighbor = NEIGHBOR.map((ym) => {
    const row = months.find((m) => m.month === ym)!;
    return {
      month: ym,
      alphaPnl: row.alpha.pnl,
      structPnl: row.struct.pnl,
      flippedToLoss: row.alpha.pnl > 0 && row.struct.pnl <= 0,
    };
  });
  const shockPass =
    structDelta > 0 &&
    crashSaved / structDelta >= 0.7 &&
    neighbor.every((n) => !n.flippedToLoss);
  const shockKill =
    structDelta <= 0 || neighbor.some((n) => n.flippedToLoss);
  return {
    id,
    alphaN: alphaRes.kpis.trades,
    alphaPf: r(alphaRes.kpis.profitFactor, 4),
    alphaPnl: Math.round(alphaRes.kpis.netPnl),
    structN: structRes.kpis.trades,
    structPf: r(structRes.kpis.profitFactor, 4),
    structPnl: Math.round(structRes.kpis.netPnl),
    structDelta: Math.round(structDelta),
    crashAlpha: pfOf(crashAlpha),
    crashStruct: pfOf(crashStruct),
    crashSaved: Math.round(crashSaved),
    shareOfIncrement:
      structDelta !== 0 ? r(crashSaved / structDelta, 4) : null,
    neighbor,
    shockPass,
    shockKill,
    months,
  };
}

const tx = runMarket("tx");
const twii = runMarket("twii");
const call = tx.shockPass
  ? "PASS：TX 上結構37 增量 > 0，且 ≥70% 來自三個大虧月，鄰月沒被殺成負。"
  : tx.shockKill
    ? "KILL：TX 上結構37 沒有正增量，或避震的同時把 2026-06／2026-08 殺成負。避震器故事不能當留下結構37 的理由。"
    : "INCONCLUSIVE。";

const out = {
  generatedAt: "2026-08-25",
  experiment: "H-05",
  definition: {
    layer: "A×C",
    crash: CRASH,
    neighbor: NEIGHBOR,
    primary: "tx",
    notTuned: true,
  },
  verdict: {
    pass: tx.shockPass,
    kill: tx.shockKill,
    call,
  },
  tx,
  twii,
};

writeFileSync(
  new URL("../results/h05-autopsy.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log("TWII", JSON.stringify({
  alphaN: twii.alphaN,
  structDelta: twii.structDelta,
  crashSaved: twii.crashSaved,
  share: twii.shareOfIncrement,
}));
console.log("TX", JSON.stringify({
  alphaN: tx.alphaN,
  structDelta: tx.structDelta,
  crashSaved: tx.crashSaved,
  share: tx.shareOfIncrement,
  shockPass: tx.shockPass,
  shockKill: tx.shockKill,
}));
console.log(call);
console.log("");
for (const m of [twii, tx]) {
  console.log(`## ${m.id.toUpperCase()}`);
  console.log("| 月 | α n | α 損益 | α PF | 結構 n | 結構損益 | 避開 | 避開損益 | 週三 | 停損 |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of m.months) {
    console.log(
      `| ${row.month} | ${row.alpha.n} | ${twd(row.alpha.pnl)} | ${row.alpha.pf} | ${row.struct.n} | ${twd(row.struct.pnl)} | ${row.avoidedN} | ${twd(row.avoidedPnl)} | ${row.wedN} | ${row.stopN} |`,
    );
  }
  console.log("");
}
console.log("## TX ALPHA-37 逐筆（三個大虧月）");
console.log("| 日期 | 星期 | 向 | 損益 | 缺口 | |g|/ATR | MA20上 | 結算 | 出場 | 連停 | 結構 |");
console.log("| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |");
for (const row of tx.months.filter((m) => CRASH.includes(m.month as (typeof CRASH)[number]))) {
  for (const t of row.trades) {
    console.log(
      `| ${t.date} | ${t.dow} | ${t.side ?? "—"} | ${t.pnl == null ? "—" : twd(t.pnl)} | ${t.gapPts} | ${t.gapAtr} | ${t.aboveMa ? "是" : "否"} | ${t.settlement ? "是" : ""} | ${t.reason} | ${t.stopStreak} | ${t.structKept ? "留" : t.structSkip} |`,
    );
  }
}
