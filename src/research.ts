import { runLab } from "./backtest";
import { OOS_SPLIT, weekdayUtc } from "./calendar";
import { barIndex, MA20, MARKET } from "./market";
import { DEFAULT_PARAMS } from "./specs";
import type { LabParams, ResearchSlice, Trade } from "./types";

function sliceKpi(trades: Trade[]): Omit<ResearchSlice, "id" | "label" | "hint"> {
  const wins = trades.filter((t) => t.pnlTwd > 0);
  const losses = trades.filter((t) => t.pnlTwd <= 0);
  const gw = wins.reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlTwd, 0));
  const pnl = trades.reduce((s, t) => s + t.pnlTwd, 0);
  let eq = DEFAULT_PARAMS.capital;
  let peak = eq;
  let maxDd = 0;
  for (const t of trades) {
    eq += t.pnlTwd;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak > 0 ? (peak - eq) / peak : 0);
  }
  const first = MARKET.bars[0]?.d ?? MARKET.asOf;
  const last = MARKET.bars[MARKET.bars.length - 1]?.d ?? MARKET.asOf;
  const years = Math.max(
    0.15,
    (Date.parse(last) - Date.parse(first)) / (365.25 * 86400000),
  );
  const ret = pnl / DEFAULT_PARAMS.capital;
  const cagr = Math.pow(Math.max(1e-9, 1 + ret), 1 / years) - 1;
  const oos = trades.filter((t) => t.date >= OOS_SPLIT);
  const ow = oos.filter((t) => t.pnlTwd > 0);
  const ol = oos.filter((t) => t.pnlTwd <= 0);
  const ogw = ow.reduce((s, t) => s + t.pnlTwd, 0);
  const ogl = Math.abs(ol.reduce((s, t) => s + t.pnlTwd, 0));
  return {
    n: trades.length,
    wr: trades.length ? wins.length / trades.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
    cagr,
    dd: maxDd,
    oosN: oos.length,
    oosPf: ogl > 0 ? ogw / ogl : ogw > 0 ? 9 : 0,
    oosWr: oos.length ? ow.length / oos.length : 0,
  };
}

type Tag = {
  t: Trade;
  dow: number;
  aboveMa: boolean;
};

function tagTrades(params: LabParams): Tag[] {
  const result = runLab(params);
  return result.trades.map((t) => {
    const i = barIndex(t.date);
    const prev = MARKET.bars[Math.max(0, i - 1)];
    const ma = i > 0 ? MA20[i - 1] : prev.c;
    return {
      t,
      dow: weekdayUtc(t.date),
      aboveMa: prev.c >= ma,
    };
  });
}

/** ALPHA-37 的日線切片。這些不用 1 分重建，可信度較高。 */
export function dailySlices(): ResearchSlice[] {
  const tagged = tagTrades(DEFAULT_PARAMS);
  const rows: [string, string, string, (x: Tag) => boolean][] = [
    [
      "all",
      "ALPHA-37 全樣本",
      "基準。過大缺口已放假",
      () => true,
    ],
    [
      "ma",
      "只做 20 日均之上",
      "空頭結構不做。結構37",
      (x) => x.aboveMa,
    ],
    [
      "thuFri",
      "只做週四、週五",
      "週五選擇權結算結構",
      (x) => x.dow === 4 || x.dow === 5,
    ],
    [
      "friday",
      "只做週五",
      "筆數少、回撤最小",
      (x) => x.dow === 5,
    ],
    [
      "skipMonWed",
      "避開週一、週三",
      "週一缺口、週三週選",
      (x) => x.dow !== 1 && x.dow !== 3,
    ],
  ];
  return rows.map(([id, label, hint, pred]) => ({
    id,
    label,
    hint,
    ...sliceKpi(tagged.filter(pred).map((x) => x.t)),
  }));
}

const sliceMemo = { key: "", rows: [] as ResearchSlice[] };

export function dailySlicesMemo(): ResearchSlice[] {
  const key = MARKET.asOf + String(MARKET.bars.length);
  if (sliceMemo.key === key) return sliceMemo.rows;
  sliceMemo.key = key;
  sliceMemo.rows = dailySlices();
  return sliceMemo.rows;
}
