import { buildIntraday, openingRange } from "./intraday";
import { atrExpandRatio, ATR_EXPAND_K, gapClose, MARKET, type MarketCtx } from "./market";
import {
  daysToSettlement,
  isSettlement,
  OOS_SPLIT,
  WEEKDAY_ORDER,
  weekdayUtc,
} from "./calendar";
import { foreignBias } from "./oi";
import {
  CONTRACTS,
  DEFAULT_PARAMS,
  resolveGap,
  roundTripCostTwd,
  SESSION,
} from "./specs";
import type {
  BacktestResult,
  DailyBar,
  DayEval,
  LabParams,
  MinuteBar,
  MonthlyCell,
  Side,
  Trade,
  WeekdayCell,
  WeekdayMode,
} from "./types";

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clampStop(x: number): number {
  return Math.min(180, Math.max(55, x));
}

function yearReturn(trades: Trade[], year: string, fallback: number): number {
  const slice = trades.filter((t) => t.date.startsWith(year));
  if (slice.length === 0) return 0;
  const first = slice[0].equity - slice[0].pnlTwd;
  const last = slice[slice.length - 1].equity;
  const base = first > 0 ? first : fallback;
  return (last - base) / base;
}

function weekdaySkip(mode: WeekdayMode, dow: number): string | null {
  if (mode === "friday" && dow !== 5) return "非週五";
  if (mode === "thuFri" && dow !== 4 && dow !== 5) return "非週四／週五";
  if (mode === "skipMonWed" && (dow === 1 || dow === 3))
    return dow === 1 ? "週一跳過" : "週三跳過（週選結算）";
  return null;
}

export function sizeLots(params: LabParams, stopPts: number): number {
  const spec = CONTRACTS[params.contract];
  const riskTwd = params.capital * params.riskPct;
  const perLot = Math.max(1, stopPts) * spec.multiplier;
  const byRisk = Math.max(1, Math.floor(riskTwd / perLot));
  const byMargin = Math.max(1, Math.floor(params.capital / spec.dayMargin));
  return Math.max(1, Math.min(byRisk, byMargin, 20));
}

function simulateExit(
  path: MinuteBar[],
  side: Side,
  entryMin: number,
  stop: number,
  target: number | null,
): { exitMin: number; exit: number; reason: string } {
  for (let i = entryMin + 1; i <= SESSION.cashCloseMin; i++) {
    const bar = path[i];
    if (side === "long") {
      if (bar.l <= stop) return { exitMin: i, exit: stop, reason: "停損" };
      if (target != null && bar.h >= target)
        return { exitMin: i, exit: target, reason: "停利" };
    } else {
      if (bar.h >= stop) return { exitMin: i, exit: stop, reason: "停損" };
      if (target != null && bar.l <= target)
        return { exitMin: i, exit: target, reason: "停利" };
    }
  }
  const last = path[SESSION.cashCloseMin];
  return { exitMin: SESSION.cashCloseMin, exit: last.c, reason: "尾盤平倉" };
}

function tradeKpis(trades: Trade[]) {
  const wins = trades.filter((t) => t.pnlTwd > 0);
  const losses = trades.filter((t) => t.pnlTwd <= 0);
  const gw = wins.reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlTwd, 0));
  return {
    n: trades.length,
    wr: trades.length ? wins.length / trades.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
  };
}

export function evaluateDayTrade(
  day: DailyBar,
  prevClose: number,
  atr: number,
  recentOr: number[],
  params: LabParams,
  minutes?: MinuteBar[],
  market: MarketCtx = MARKET,
): DayEval {
  const path = minutes ?? buildIntraday(day, prevClose, params.seedOffset ?? 0);
  const or = openingRange(path, params.probeMin);
  const orWidth = Math.max(1, or.high - or.low);
  const gapRef = gapClose(day, prevClose);
  const gapPts = day.o - gapRef;
  const gapPct = gapPts / gapRef;
  const vwapAtProbe = path[or.end]?.vwap ?? day.o;
  const settle = isSettlement(day.d);
  const flow = foreignBias(day.d);
  const idx = market.indexByDate.get(day.d) ?? -1;
  const maPrev = idx > 0 ? market.MA20[idx - 1] : prevClose;
  const aboveMa = prevClose >= maPrev;
  const expand = atrExpandRatio(idx, market);
  const dow = weekdayUtc(day.d);
  const dts = daysToSettlement(day.d);
  const gap = resolveGap(params);

  const base = {
    date: day.d,
    daily: day,
    prevClose,
    orHigh: or.high,
    orLow: or.low,
    orWidth,
    vwapAtProbe,
    gapPts,
    gapPct,
    atr,
    atrExpand: expand,
    ma20: maPrev,
    aboveMa,
    weekday: dow,
    daysToSettle: dts,
    settlement: settle,
    foreignNet: flow.last?.foreign ?? null,
    foreignDelta: flow.delta,
    minutes: path,
  };

  let skipped: string | null = null;
  skipped = weekdaySkip(params.weekdayMode, dow);
  if (params.settleFilter && settle) skipped = skipped ?? "結算日（跳過）";
  if (params.regimeFilter && !aboveMa)
    skipped = skipped ?? "低於 20 日均（空頭結構）";
  if (params.atrExpandSkip && expand >= ATR_EXPAND_K)
    skipped = skipped ?? "ATR 擴張放假";
  if (orWidth < 22) skipped = skipped ?? "區間過窄";
  if (!skipped && params.volFilter && recentOr.length >= 12) {
    const med = median(recentOr);
    if (orWidth < med * 0.4) skipped = "波動過低（濾網）";
    else if (orWidth > med * 2.4) skipped = "波動過高（濾網）";
  }
  if (!skipped && gap.skip080 && atr > 0) {
    const gapStrength = Math.abs(gapPts) / atr;
    if (gapStrength >= 0.8) skipped = "缺口過大（跳過）";
  }

  let side: Side | null = null;
  let entryMin = -1;
  let entryPx = 0;

  if (!skipped) {
    for (let i = or.end + 1; i < SESSION.cashCloseMin - 20; i++) {
      const bar = path[i];
      if (bar.c > or.high) {
        side = "long";
        entryMin = i;
        entryPx = bar.c;
        break;
      }
      if (bar.c < or.low) {
        side = "short";
        entryMin = i;
        entryPx = bar.c;
        break;
      }
    }
    if (!side) skipped = "未突破";
  }

  if (side && params.vwapFilter) {
    const vw = path[entryMin]?.vwap ?? vwapAtProbe;
    if (side === "long" && entryPx < vw) {
      skipped = "VWAP 濾網（多頭需在上）";
      side = null;
    } else if (side === "short" && entryPx > vw) {
      skipped = "VWAP 濾網（空頭需在下）";
      side = null;
    }
  }

  if (side && gap.dir055 && atr > 0) {
    const gapStrength = Math.abs(gapPts) / atr;
    if (gapStrength > 0.55) {
      const gapDir: Side = gapPts >= 0 ? "long" : "short";
      if (side !== gapDir) {
        skipped = "缺口方向濾網";
        side = null;
      }
    }
  }

  if (side && params.foreignFilter && flow.bias) {
    if (side !== flow.bias) {
      skipped =
        flow.bias === "long"
          ? "外資回補，不做空"
          : "外資加碼空單，不做多";
      side = null;
    }
  }

  if (!side || skipped) {
    return { ...base, skipped: skipped ?? "未進場", trade: null };
  }

  const stopDist = clampStop(orWidth * params.stopOrFrac);
  const stop = side === "long" ? entryPx - stopDist : entryPx + stopDist;
  const target =
    params.targetR > 0
      ? side === "long"
        ? entryPx + stopDist * params.targetR
        : entryPx - stopDist * params.targetR
      : null;

  const { exitMin, exit, reason } = simulateExit(
    path,
    side,
    entryMin,
    stop,
    target,
  );
  const spec = CONTRACTS[params.contract];
  const lots = sizeLots(params, stopDist);
  const dir = side === "long" ? 1 : -1;
  const pts = dir * (exit - entryPx);
  const cost = roundTripCostTwd(
    entryPx,
    exit,
    spec.multiplier,
    lots,
    params.commissionPerSide,
    params.slippagePts,
  );
  const pnlTwd = pts * spec.multiplier * lots - cost;
  const trade: Trade = {
    date: day.d,
    side,
    entryMin,
    exitMin,
    entry: entryPx,
    exit,
    stop,
    target,
    orHigh: or.high,
    orLow: or.low,
    reason,
    pts,
    costTwd: cost,
    pnlTwd,
    lots,
    equity: 0,
  };
  return { ...base, skipped: null, trade };
}

export function skipCounts(
  params: LabParams,
  market: MarketCtx = MARKET,
): Record<string, number> {
  const bars = market.bars;
  const recentOr: number[] = [];
  const counts: Record<string, number> = {};
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
    const key = ev.trade ? "進場" : (ev.skipped ?? "未進場");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function runBacktest(
  params: LabParams = DEFAULT_PARAMS,
  market: MarketCtx = MARKET,
): BacktestResult {
  const bars = market.bars;
  const recentOr: number[] = [];
  const trades: Trade[] = [];
  let skipped = 0;
  let equity = params.capital;
  const start = market.startIdx;
  const equityCurve: BacktestResult["equity"] = [
    { date: bars[start - 1]?.d ?? bars[0]?.d ?? "", equity, dd: 0 },
  ];
  let peak = equity;
  let maxDd = 0;
  let maxDdPct = 0;
  const monthlyMap = new Map<string, MonthlyCell>();

  for (let i = start; i < bars.length; i++) {
    const day = bars[i];
    const prev = bars[i - 1];
    const ev = evaluateDayTrade(
      day,
      prev.c,
      market.ATR20[i],
      recentOr,
      params,
      undefined,
      market,
    );
    recentOr.push(ev.orWidth);
    if (recentOr.length > 20) recentOr.shift();

    if (!ev.trade) {
      skipped += 1;
      equityCurve.push({ date: day.d, equity, dd: peak - equity });
      continue;
    }

    equity += ev.trade.pnlTwd;
    ev.trade.equity = equity;
    trades.push(ev.trade);
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
    equityCurve.push({ date: day.d, equity, dd });

    const mk = ev.trade.date.slice(0, 7);
    const [y, m] = mk.split("-").map(Number);
    const cell = monthlyMap.get(mk) ?? {
      key: mk,
      year: y,
      month: m,
      pnl: 0,
      trades: 0,
      win: 0,
    };
    cell.pnl += ev.trade.pnlTwd;
    cell.trades += 1;
    if (ev.trade.pnlTwd > 0) cell.win += 1;
    monthlyMap.set(mk, cell);
  }

  const wins = trades.filter((t) => t.pnlTwd > 0);
  const losses = trades.filter((t) => t.pnlTwd <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlTwd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlTwd, 0));
  const netPnl = equity - params.capital;
  const firstDate = bars[start]?.d ?? market.asOf;
  const lastDate = bars[bars.length - 1]?.d ?? market.asOf;
  const years = Math.max(
    0.15,
    (Date.parse(lastDate) - Date.parse(firstDate)) / (365.25 * 86400000),
  );
  const retPct = netPnl / params.capital;
  const cagr = years > 0 ? Math.pow(Math.max(1e-9, 1 + retPct), 1 / years) - 1 : 0;

  const dailyRets: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const a = equityCurve[i - 1].equity;
    const b = equityCurve[i].equity;
    dailyRets.push(a > 0 ? (b - a) / a : 0);
  }
  const mean = dailyRets.length
    ? dailyRets.reduce((s, x) => s + x, 0) / dailyRets.length
    : 0;
  const var_ = dailyRets.length
    ? dailyRets.reduce((s, x) => s + (x - mean) ** 2, 0) / dailyRets.length
    : 0;
  const sharpe = var_ > 0 ? (mean / Math.sqrt(var_)) * Math.sqrt(242) : 0;

  let consec = 0;
  let maxConsecLoss = 0;
  for (const t of trades) {
    if (t.pnlTwd <= 0) {
      consec += 1;
      if (consec > maxConsecLoss) maxConsecLoss = consec;
    } else consec = 0;
  }

  const taiexBase = bars[start].c;
  const taiex = bars.slice(start).map((b) => ({
    date: b.d,
    ret: b.c / taiexBase - 1,
  }));

  const avgHold =
    trades.length === 0
      ? 0
      : trades.reduce((s, t) => s + (t.exitMin - t.entryMin), 0) /
        trades.length;

  const weekdays: WeekdayCell[] = WEEKDAY_ORDER.map((dow) => {
    const rows = trades.filter((t) => weekdayUtc(t.date) === dow);
    const w = rows.filter((t) => t.pnlTwd > 0);
    const l = rows.filter((t) => t.pnlTwd <= 0);
    const gw = w.reduce((s, t) => s + t.pnlTwd, 0);
    const gl = Math.abs(l.reduce((s, t) => s + t.pnlTwd, 0));
    return {
      dow,
      label: `週${["一", "二", "三", "四", "五"][dow - 1]}`,
      trades: rows.length,
      pnl: rows.reduce((s, t) => s + t.pnlTwd, 0),
      win: w.length,
      pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
    };
  });

  const oos = tradeKpis(trades.filter((t) => t.date >= OOS_SPLIT));

  return {
    params,
    trades,
    equity: equityCurve,
    monthly: [...monthlyMap.values()],
    weekdays,
    taiex,
    kpis: {
      startEquity: params.capital,
      endEquity: equity,
      netPnl,
      retPct,
      cagr,
      winRate: trades.length ? wins.length / trades.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 9 : 0,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      avgPts: trades.length
        ? trades.reduce((s, t) => s + t.pts, 0) / trades.length
        : 0,
      maxDd,
      maxDdPct,
      trades: trades.length,
      longs: trades.filter((t) => t.side === "long").length,
      shorts: trades.filter((t) => t.side === "short").length,
      sharpe,
      expectancy: trades.length ? netPnl / trades.length : 0,
      payoff:
        losses.length && wins.length
          ? grossWin / wins.length / (grossLoss / losses.length)
          : 0,
      skipped,
      days: bars.length - start,
      bestDay: trades.reduce((m, t) => Math.max(m, t.pnlTwd), 0),
      worstDay: trades.reduce((m, t) => Math.min(m, t.pnlTwd), 0),
      maxConsecLoss,
      avgHoldMin: avgHold,
      y2025: yearReturn(trades, "2025", params.capital),
      y2026: yearReturn(trades, "2026", params.capital),
      oosPf: oos.pf,
      oosN: oos.n,
      oosWr: oos.wr,
    },
  };
}

const memo = new Map<string, BacktestResult>();

export function runLab(
  params: LabParams,
  market: MarketCtx = MARKET,
): BacktestResult {
  const key = market.id + JSON.stringify(params);
  const hit = memo.get(key);
  if (hit) return hit;
  const result = runBacktest(params, market);
  memo.set(key, result);
  return result;
}

export function todayEval(
  params: LabParams,
  market: MarketCtx = MARKET,
): DayEval | null {
  const bars = market.bars;
  if (bars.length < 2) return null;
  const recentOr: number[] = [];
  const start = Math.max(market.startIdx, bars.length - 21);
  for (let i = start; i < bars.length - 1; i++) {
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
  }
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  return evaluateDayTrade(
    last,
    prev.c,
    market.ATR20[bars.length - 1],
    recentOr,
    params,
    undefined,
    market,
  );
}

export function evalOnDate(
  date: string,
  params: LabParams,
  market: MarketCtx = MARKET,
): DayEval | null {
  const bars = market.bars;
  const idx = market.indexByDate.get(date) ?? -1;
  if (idx < 1) return todayEval(params, market);
  const recentOr: number[] = [];
  const start = Math.max(market.startIdx, idx - 20);
  for (let i = start; i < idx; i++) {
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
  }
  return evaluateDayTrade(
    bars[idx],
    bars[idx - 1].c,
    market.ATR20[idx],
    recentOr,
    params,
    undefined,
    market,
  );
}
