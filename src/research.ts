import { runLab, skipCounts } from "./backtest";
import { OOS_SPLIT, weekdayUtc } from "./calendar";
import { atrExpandRatio, ATR_EXPAND_K, barIndex, MA20, MARKET } from "./market";
import { DEFAULT_PARAMS, withGap } from "./specs";
import type {
  BacktestResult,
  LabParams,
  ResearchSlice,
  Trade,
  WindowKpis,
} from "./types";

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
      "採納得太早。九成增量來自三個大虧月",
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

function tradeStats(trades: Trade[]) {
  const wins = trades.filter((t) => t.pnlTwd > 0);
  const losses = trades.filter((t) => t.pnlTwd <= 0);
  const gw = wins.reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlTwd, 0));
  const pnl = trades.reduce((s, t) => s + t.pnlTwd, 0);
  return {
    n: trades.length,
    wr: trades.length ? wins.length / trades.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
    pnl,
    expectancy: trades.length ? pnl / trades.length : 0,
  };
}

function sharpeOf(rets: number[]): number {
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return v > 0 ? (mean / Math.sqrt(v)) * Math.sqrt(242) : 0;
}

/** 用完整權益曲線切一個日曆窗：PF 來自窗內交易，MDD／Sharpe／CAGR 來自窗內權益路徑。 */
export function windowKpis(
  result: BacktestResult,
  label: string,
  pred: (date: string) => boolean,
): WindowKpis {
  const trades = result.trades.filter((t) => pred(t.date));
  const stats = tradeStats(trades);
  const eqPts = result.equity.filter((e) => pred(e.date));
  let peak = eqPts[0]?.equity ?? result.params.capital;
  let maxDd = 0;
  const rets: number[] = [];
  for (let i = 0; i < eqPts.length; i++) {
    const eq = eqPts[i].equity;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDd) maxDd = dd;
    if (i > 0) {
      const a = eqPts[i - 1].equity;
      rets.push(a > 0 ? (eq - a) / a : 0);
    }
  }
  const firstDate = eqPts[0]?.date ?? MARKET.bars[0]?.d ?? MARKET.asOf;
  const lastDate = eqPts[eqPts.length - 1]?.date ?? MARKET.asOf;
  const years = Math.max(
    0.08,
    (Date.parse(lastDate) - Date.parse(firstDate)) / (365.25 * 86400000),
  );
  const startEq = eqPts[0]?.equity ?? result.params.capital;
  const endEq = eqPts[eqPts.length - 1]?.equity ?? startEq;
  const ret = startEq > 0 ? (endEq - startEq) / startEq : 0;
  const cagr = Math.pow(Math.max(1e-9, 1 + ret), 1 / years) - 1;
  return {
    label,
    ...stats,
    cagr,
    dd: maxDd,
    sharpe: sharpeOf(rets),
  };
}

function sideWindow(trades: Trade[], label: string, side: "long" | "short"): WindowKpis {
  const rows = trades.filter((t) => t.side === side);
  const stats = tradeStats(rows);
  let eq = DEFAULT_PARAMS.capital;
  let peak = eq;
  let maxDd = 0;
  const rets: number[] = [];
  for (const t of rows) {
    const prev = eq;
    eq += t.pnlTwd;
    rets.push(prev > 0 ? (eq - prev) / prev : 0);
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak > 0 ? (peak - eq) / peak : 0);
  }
  const first = rows[0]?.date;
  const last = rows[rows.length - 1]?.date;
  const years =
    first && last
      ? Math.max(
          0.08,
          (Date.parse(last) - Date.parse(first)) / (365.25 * 86400000),
        )
      : 0.08;
  const ret = stats.pnl / DEFAULT_PARAMS.capital;
  const cagr = Math.pow(Math.max(1e-9, 1 + ret), 1 / years) - 1;
  return { label, ...stats, cagr, dd: maxDd, sharpe: sharpeOf(rets) };
}

export type SpecReport = {
  id: string;
  label: string;
  hint: string;
  params: LabParams;
  full: WindowKpis;
  is: WindowKpis;
  oos: WindowKpis;
  y2024: WindowKpis;
  y2025: WindowKpis;
  y2026: WindowKpis;
  weekdays: { label: string; n: number; wr: number; pf: number; pnl: number }[];
  long: WindowKpis;
  short: WindowKpis;
  skip: Record<string, number>;
  vsAlpha: {
    dN: number;
    dPf: number;
    dExp: number;
    dOosPf: number;
    dIsPf: number;
    d2025Pf: number;
    d2026Pf: number;
  };
};

export function reportSpec(
  id: string,
  label: string,
  hint: string,
  params: LabParams,
  alpha?: BacktestResult,
): SpecReport {
  const result = runLab(params);
  const ref = alpha ?? runLab(DEFAULT_PARAMS);
  const full = windowKpis(result, "全樣本", () => true);
  const isW = windowKpis(result, "樣本內", (d) => d < OOS_SPLIT);
  const oos = windowKpis(result, "樣本外", (d) => d >= OOS_SPLIT);
  const y2024 = windowKpis(result, "2024", (d) => d.startsWith("2024"));
  const y2025 = windowKpis(result, "2025", (d) => d.startsWith("2025"));
  const y2026 = windowKpis(result, "2026", (d) => d.startsWith("2026"));
  const aFull = windowKpis(ref, "全樣本", () => true);
  const aIs = windowKpis(ref, "樣本內", (d) => d < OOS_SPLIT);
  const aOos = windowKpis(ref, "樣本外", (d) => d >= OOS_SPLIT);
  const a2025 = windowKpis(ref, "2025", (d) => d.startsWith("2025"));
  const a2026 = windowKpis(ref, "2026", (d) => d.startsWith("2026"));
  return {
    id,
    label,
    hint,
    params,
    full,
    is: isW,
    oos,
    y2024,
    y2025,
    y2026,
    weekdays: result.weekdays.map((w) => ({
      label: w.label,
      n: w.trades,
      wr: w.trades ? w.win / w.trades : 0,
      pf: w.pf,
      pnl: w.pnl,
    })),
    long: sideWindow(result.trades, "多", "long"),
    short: sideWindow(result.trades, "空", "short"),
    skip: skipCounts(params),
    vsAlpha: {
      dN: full.n - aFull.n,
      dPf: full.pf - aFull.pf,
      dExp: full.expectancy - aFull.expectancy,
      dOosPf: oos.pf - aOos.pf,
      dIsPf: isW.pf - aIs.pf,
      d2025Pf: y2025.pf - a2025.pf,
      d2026Pf: y2026.pf - a2026.pf,
    },
  };
}

/** H-06（GPT 來稿稱 H-01）：拆開 gap 的 A 層放假 vs A×C 順勢。不調探針、不加預設。 */
export function h06Specs(): {
  id: string;
  label: string;
  hint: string;
  params: LabParams;
}[] {
  return [
    {
      id: "noGap",
      label: "無缺口濾網",
      hint: "ALPHA-37 關掉兩個 gap 開關；VWAP 與波動仍開",
      params: withGap(DEFAULT_PARAMS, false, false),
    },
    {
      id: "skip080",
      label: "只放假 0.8 ATR",
      hint: "純 A 層：|缺口|/ATR ≥ 0.8 整日不交易；不做 0.55 順勢",
      params: withGap(DEFAULT_PARAMS, true, false),
    },
    {
      id: "both",
      label: "ALPHA-37（兩者皆開）",
      hint: "必須重現 n=332 PF≈1.145",
      params: withGap(DEFAULT_PARAMS, true, true),
    },
  ];
}

export function h06Reports(): SpecReport[] {
  const alpha = runLab(DEFAULT_PARAMS);
  return h06Specs().map((s) =>
    reportSpec(s.id, s.label, s.hint, s.params, alpha),
  );
}

/** H-11：ATR 擴張放假（門檻鎖死 2.0）能不能複製結構37。不調門檻、不加預設。 */
export function h11Specs(): {
  id: string;
  label: string;
  hint: string;
  params: LabParams;
}[] {
  return [
    {
      id: "alpha37",
      label: "ALPHA-37",
      hint: "必須重現 n=332 PF≈1.145",
      params: { ...DEFAULT_PARAMS, atrExpandSkip: false, regimeFilter: false },
    },
    {
      id: "struct37",
      label: "結構37",
      hint: "必須重現 n=241 PF≈1.317。MA20 開、ATR 擴張關",
      params: { ...DEFAULT_PARAMS, atrExpandSkip: false, regimeFilter: true },
    },
    {
      id: "atrSkip20",
      label: "ATR 擴張放假 2.0",
      hint: "MA20 關；ATR20[t-1]/ATR60[t-1] ≥ 2.0 整日放假",
      params: { ...DEFAULT_PARAMS, atrExpandSkip: true, regimeFilter: false },
    },
  ];
}

export function h11Reports(): SpecReport[] {
  const alpha = runLab(DEFAULT_PARAMS);
  return h11Specs().map((s) =>
    reportSpec(s.id, s.label, s.hint, s.params, alpha),
  );
}

export type AtrExpandDist = {
  nDays: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  nAtK: number;
  nBelowMa: number;
  k: number;
};

/** 開盤前已知的 ATR20/ATR60 分布。H-11 用來證明 2.0 有沒有開火，不是拿來改門檻。 */
export function atrExpandDist(): AtrExpandDist {
  const ratios: number[] = [];
  let nBelowMa = 0;
  let nAtK = 0;
  for (let i = 1; i < MARKET.bars.length; i++) {
    const r = atrExpandRatio(i);
    ratios.push(r);
    const prev = MARKET.bars[i - 1];
    const ma = MA20[i - 1];
    if (prev.c < ma) nBelowMa += 1;
    if (r >= ATR_EXPAND_K) nAtK += 1;
  }
  const s = [...ratios].sort((a, b) => a - b);
  const pct = (p: number) =>
    s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))] ?? 0;
  return {
    nDays: ratios.length,
    p50: pct(50),
    p75: pct(75),
    p90: pct(90),
    p95: pct(95),
    p99: pct(99),
    max: s[s.length - 1] ?? 0,
    nAtK,
    nBelowMa,
    k: ATR_EXPAND_K,
  };
}
