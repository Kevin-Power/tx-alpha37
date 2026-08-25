import twii from "./twii-daily.json";
import type { DailyBar } from "./types";

type FileShape = {
  symbol: string;
  source: string;
  asOf: string;
  bars: DailyBar[];
};

const file = twii as FileShape;

export const MARKET = {
  symbol: file.symbol,
  source: file.source,
  asOf: file.asOf,
  bars: file.bars as DailyBar[],
};

const indexByDate = new Map(MARKET.bars.map((b, i) => [b.d, i]));

export function barIndex(date: string): number {
  return indexByDate.get(date) ?? -1;
}

/** 截至當日收盤的 20 日均。進場濾網要用前一日，避免偷看。 */
export const MA20: number[] = (() => {
  const bars = MARKET.bars;
  const out = new Array<number>(bars.length).fill(0);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    acc += bars[i].c;
    if (i >= 20) acc -= bars[i - 20].c;
    out[i] = acc / Math.min(i + 1, 20);
  }
  return out;
})();

export function trueRange(prevClose: number, bar: DailyBar): number {
  return Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - prevClose),
    Math.abs(bar.l - prevClose),
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

/** Wilder ATR20／ATR60，截至當日收盤。進場濾網要用前一日。 */
export const ATR20: number[] = atrSeries(MARKET.bars, 20);
export const ATR60: number[] = atrSeries(MARKET.bars, 60);

/** H-11 鎖死門檻。不准改、不准做成 slider。 */
export const ATR_EXPAND_K = 2.0;

/** ATR20[t-1] / ATR60[t-1]。開盤前已知，無偷看。idx 是當日 bar index。 */
export function atrExpandRatio(idx: number): number {
  if (idx < 1) return 0;
  const slow = ATR60[idx - 1];
  if (slow <= 0) return 0;
  return ATR20[idx - 1] / slow;
}
