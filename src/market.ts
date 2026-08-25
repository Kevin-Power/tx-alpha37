import twii from "./twii-daily.json";
import txFile from "../data/tx-daily.json";
import type { DailyBar, MarketId } from "./types";

export const SAMPLE_START = "2024-08-26";

export type MarketCtx = {
  id: MarketId;
  symbol: string;
  source: string;
  asOf: string;
  bars: DailyBar[];
  tradeFrom: string;
  startIdx: number;
  MA20: number[];
  ATR20: number[];
  ATR60: number[];
  indexByDate: Map<string, number>;
};

type TwiiFile = {
  symbol: string;
  source: string;
  asOf: string;
  bars: DailyBar[];
};

type TxFile = {
  symbol: string;
  source: string;
  built: string;
  days: Array<
    DailyBar & {
      contract: string;
      v: number;
      prevSameC: number | null;
      dow: number;
    }
  >;
};

function maSeries(bars: DailyBar[], n = 20): number[] {
  const out = new Array<number>(bars.length).fill(0);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    acc += bars[i].c;
    if (i >= n) acc -= bars[i - n].c;
    out[i] = acc / Math.min(i + 1, n);
  }
  return out;
}

export function gapClose(bar: DailyBar, prevClose: number): number {
  return bar.prevSameC ?? prevClose;
}

export function trueRange(prevClose: number, bar: DailyBar): number {
  const pc = gapClose(bar, prevClose);
  return Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - pc),
    Math.abs(bar.l - pc),
  );
}

export function atrSeries(bars: DailyBar[], n = 20): number[] {
  const out = new Array<number>(bars.length).fill(0);
  if (bars.length === 0) return out;
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    const prev = i === 0 ? bars[0].c : bars[i - 1].c;
    const tr = trueRange(prev, bars[i]);
    if (i < n) {
      acc += tr;
      out[i] = acc / (i + 1);
    } else {
      out[i] = (out[i - 1] * (n - 1) + tr) / n;
    }
  }
  return out;
}

function buildMarket(
  id: MarketId,
  symbol: string,
  source: string,
  asOf: string,
  bars: DailyBar[],
  tradeFrom: string,
): MarketCtx {
  let startIdx = bars.findIndex((b) => b.d >= tradeFrom);
  if (startIdx < 1) startIdx = 1;
  return {
    id,
    symbol,
    source,
    asOf,
    bars,
    tradeFrom,
    startIdx,
    MA20: maSeries(bars, 20),
    ATR20: atrSeries(bars, 20),
    ATR60: atrSeries(bars, 60),
    indexByDate: new Map(bars.map((b, i) => [b.d, i])),
  };
}

const twiiRaw = twii as TwiiFile;
const txRaw = txFile as TxFile;

export const MARKETS: Record<MarketId, MarketCtx> = {
  twii: buildMarket(
    "twii",
    twiiRaw.symbol,
    twiiRaw.source,
    twiiRaw.asOf,
    twiiRaw.bars as DailyBar[],
    SAMPLE_START,
  ),
  tx: buildMarket(
    "tx",
    "TX",
    txRaw.source,
    txRaw.days[txRaw.days.length - 1]?.d ?? txRaw.built,
    txRaw.days.map((d) => ({
      d: d.d,
      o: d.o,
      h: d.h,
      l: d.l,
      c: d.c,
      prevSameC: d.prevSameC,
    })),
    SAMPLE_START,
  ),
};

/** 預設＝TX 近月真開盤價。要重現 H-06／H-11 舊數字時顯式傳 MARKETS.twii。 */
export const MARKET: MarketCtx = MARKETS.tx;

export function barIndex(date: string, m: MarketCtx = MARKET): number {
  return m.indexByDate.get(date) ?? -1;
}

export const ATR_EXPAND_K = 2.0;

export function atrExpandRatio(idx: number, m: MarketCtx = MARKET): number {
  if (idx < 1) return 0;
  const slow = m.ATR60[idx - 1];
  if (slow <= 0) return 0;
  return m.ATR20[idx - 1] / slow;
}

/** @deprecated 用 market.MA20。保留給舊 import。 */
export const MA20: number[] = MARKET.MA20;
export const ATR20: number[] = MARKET.ATR20;
export const ATR60: number[] = MARKET.ATR60;
