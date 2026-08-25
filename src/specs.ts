import type { ContractCode, LabParams, WeekdayMode } from "./types";

/** TAIFEX 指數期貨規格（2026-08 保證金水位）。 */
export const CONTRACTS: Record<
  ContractCode,
  {
    code: ContractCode;
    name: string;
    nameZh: string;
    multiplier: number;
    margin: number;
    dayMargin: number;
  }
> = {
  TX: {
    code: "TX",
    name: "TX",
    nameZh: "大台",
    multiplier: 200,
    margin: 701_000,
    dayMargin: 350_500,
  },
  MTX: {
    code: "MTX",
    name: "MTX",
    nameZh: "小台",
    multiplier: 50,
    margin: 175_250,
    dayMargin: 87_625,
  },
  TMF: {
    code: "TMF",
    name: "TMF",
    nameZh: "微台",
    multiplier: 10,
    margin: 35_050,
    dayMargin: 35_050,
  },
};

/** 股價類期貨期交稅：契約金額 × 十萬分之二，買賣各課一次。 */
export const FUTURES_TAX_RATE = 0.00002;

export const SESSION = {
  dayStart: "08:45",
  cashOpen: "09:00",
  cashClose: "13:30",
  dayEnd: "13:45",
  nightStart: "15:00",
  nightEnd: "05:00",
  /** 日盤 1 分 K 根數（08:45–13:45） */
  dayMinutes: 300,
  cashOpenMin: 15,
  cashCloseMin: 285,
} as const;

function gapFlags(on: boolean): Pick<
  LabParams,
  "gapFilter" | "gapSkip080" | "gapDirection055"
> {
  return { gapFilter: on, gapSkip080: on, gapDirection055: on };
}

export const DEFAULT_PARAMS: LabParams = {
  probeMin: 37,
  vwapFilter: true,
  volFilter: true,
  ...gapFlags(true),
  settleFilter: false,
  foreignFilter: false,
  weekdayMode: "all",
  regimeFilter: false,
  atrExpandSkip: false,
  stopOrFrac: 0.55,
  targetR: 0,
  contract: "MTX",
  capital: 500_000,
  slippagePts: 2,
  commissionPerSide: 50,
  riskPct: 0.012,
};

/** 把舊的單一 gapFilter 展開成兩層。新欄位優先。 */
export function resolveGap(params: LabParams): {
  skip080: boolean;
  dir055: boolean;
} {
  return {
    skip080: params.gapSkip080 ?? params.gapFilter,
    dir055: params.gapDirection055 ?? params.gapFilter,
  };
}

export function withGap(
  params: LabParams,
  skip080: boolean,
  dir055: boolean,
): LabParams {
  return {
    ...params,
    gapSkip080: skip080,
    gapDirection055: dir055,
    gapFilter: skip080 && dir055,
  };
}

export const WEEKDAY_MODES: Record<
  WeekdayMode,
  { label: string; hint: string }
> = {
  all: { label: "不限星期", hint: "五個交易日都做" },
  skipMonWed: { label: "避開一二", hint: "週一缺口、週三週選結算" },
  thuFri: { label: "週四週五", hint: "週五選擇權結構日" },
  friday: { label: "只做週五", hint: "樣本裡獲利因子最高" },
};

export const PRESETS: Record<
  string,
  { label: string; hint: string; params: Partial<LabParams> }
> = {
  alpha37: {
    label: "ALPHA-37",
    hint: "TORB 37 分 + VWAP + 波動 + 缺口。基準，不過度切片",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  struct37: {
    label: "結構37",
    hint: "加 20 日均之上。採納得太早：九成增量來自三個大虧月",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: true,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  thuFri: {
    label: "週四週五",
    hint: "週五選擇權帶量，樣本外獲利因子比全週更高",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "thuFri",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  friday: {
    label: "週五突破",
    hint: "只做週五。筆數少、回撤最小，樣本外仍站得住",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "friday",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  skipMonWed: {
    label: "避開一二",
    hint: "週一跳空、週三週選結算都放假",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "skipMonWed",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  alpha37x: {
    label: "ALPHA-37X",
    hint: "結算日跳過 + 外資流量。實驗：跳過結算日反而更差",
    params: {
      probeMin: 37,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: true,
      foreignFilter: true,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.55,
      targetR: 0,
    },
  },
  torb37: {
    label: "TORB-37",
    hint: "學術論文原型：開盤 37 分區間突破，無濾網",
    params: {
      probeMin: 37,
      vwapFilter: false,
      volFilter: false,
      ...gapFlags(false),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.7,
      targetR: 0,
    },
  },
  torb15: {
    label: "ORB-15",
    hint: "短探針 15 分，較多訊號、假突破也較多",
    params: {
      probeMin: 15,
      vwapFilter: true,
      volFilter: true,
      ...gapFlags(false),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.6,
      targetR: 1.6,
    },
  },
  gap: {
    label: "缺口順勢",
    hint: "只做隔夜缺口方向的突破（美盤驅動）",
    params: {
      probeMin: 30,
      vwapFilter: false,
      volFilter: true,
      ...gapFlags(true),
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      stopOrFrac: 0.5,
      targetR: 1.8,
    },
  },
};

export function taxTwd(price: number, multiplier: number): number {
  return Math.round(price * multiplier * FUTURES_TAX_RATE);
}

export function roundTripCostTwd(
  entry: number,
  exit: number,
  multiplier: number,
  lots: number,
  commissionPerSide: number,
  slippagePts: number,
): number {
  const tax = (taxTwd(entry, multiplier) + taxTwd(exit, multiplier)) * lots;
  const commission = commissionPerSide * 2 * lots;
  const slip = slippagePts * 2 * multiplier * lots;
  return tax + commission + slip;
}

export function minuteToClock(i: number): string {
  const total = 8 * 60 + 45 + i;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
