export type DailyBar = {
  d: string;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type MinuteBar = {
  i: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vwap: number;
};

export type Side = "long" | "short";

export type ContractCode = "TMF" | "MTX" | "TX";

/** 日曆濾網：全部 / 避開週一週三 / 只做週四週五 / 只做週五。 */
export type WeekdayMode = "all" | "skipMonWed" | "thuFri" | "friday";

export type LabParams = {
  probeMin: number;
  vwapFilter: boolean;
  volFilter: boolean;
  /**
   * 舊開關：兩者皆開的別名。新碼請分別設 gapSkip080 / gapDirection055。
   * 若兩個新欄位缺席，引擎用這個值同時控制兩層。
   */
  gapFilter: boolean;
  /** A 層：|今開−昨收| / ATR20 ≥ 0.8 → 整日不交易。 */
  gapSkip080: boolean;
  /** A×C 層：缺口強度 > 0.55 ATR 時，突破方向必須與缺口同向。 */
  gapDirection055: boolean;
  settleFilter: boolean;
  foreignFilter: boolean;
  weekdayMode: WeekdayMode;
  regimeFilter: boolean;
  stopOrFrac: number;
  targetR: number;
  contract: ContractCode;
  capital: number;
  slippagePts: number;
  commissionPerSide: number;
  riskPct: number;
};

export type Trade = {
  date: string;
  side: Side;
  entryMin: number;
  exitMin: number;
  entry: number;
  exit: number;
  stop: number;
  target: number | null;
  orHigh: number;
  orLow: number;
  reason: string;
  pts: number;
  costTwd: number;
  pnlTwd: number;
  lots: number;
  equity: number;
};

export type DayEval = {
  date: string;
  daily: DailyBar;
  prevClose: number;
  orHigh: number;
  orLow: number;
  orWidth: number;
  vwapAtProbe: number;
  gapPts: number;
  gapPct: number;
  atr: number;
  ma20: number;
  aboveMa: boolean;
  weekday: number;
  daysToSettle: number;
  settlement: boolean;
  foreignNet: number | null;
  foreignDelta: number | null;
  skipped: string | null;
  trade: Trade | null;
  minutes: MinuteBar[];
};

export type MonthlyCell = {
  key: string;
  year: number;
  month: number;
  pnl: number;
  trades: number;
  win: number;
};

export type WeekdayCell = {
  dow: number;
  label: string;
  trades: number;
  pnl: number;
  win: number;
  pf: number;
};

export type BacktestResult = {
  params: LabParams;
  trades: Trade[];
  equity: { date: string; equity: number; dd: number }[];
  monthly: MonthlyCell[];
  weekdays: WeekdayCell[];
  kpis: {
    startEquity: number;
    endEquity: number;
    netPnl: number;
    retPct: number;
    cagr: number;
    winRate: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    avgPts: number;
    maxDd: number;
    maxDdPct: number;
    trades: number;
    longs: number;
    shorts: number;
    sharpe: number;
    expectancy: number;
    payoff: number;
    skipped: number;
    days: number;
    bestDay: number;
    worstDay: number;
    maxConsecLoss: number;
    avgHoldMin: number;
    y2025: number;
    y2026: number;
    oosPf: number;
    oosN: number;
    oosWr: number;
  };
  taiex: { date: string; ret: number }[];
};

export type ResearchSlice = {
  id: string;
  label: string;
  hint: string;
  n: number;
  wr: number;
  pf: number;
  cagr: number;
  dd: number;
  oosN: number;
  oosPf: number;
  oosWr: number;
};

export type WindowKpis = {
  label: string;
  n: number;
  wr: number;
  pf: number;
  pnl: number;
  expectancy: number;
  cagr: number;
  dd: number;
  sharpe: number;
};
