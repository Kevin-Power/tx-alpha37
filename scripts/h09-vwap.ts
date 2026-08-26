/**
 * H-09 / Q8：VWAP × 波動 ablation（30 日真 1 分診斷，不是通過／殺掉）。
 *
 * 預先登記（GitHub #10）：
 *   層級 C。窗 = data/tx-1min.json（與 H-01 同一 30 日）。
 *   骨架鎖定：probeMin=37、targetR=0、stopOrFrac=0.55
 *   （不是 TORB 的 0.7——停損分數不准混進這刀）。
 *   無結構／結算／外資／星期。缺口兩邊都關（隔離 C 層）。
 *   2×2：vwapFilter × volFilter。
 *   陪跑：ALPHA-37 原裝（vwap+vol+缺口），不進 2×2。
 *   真實軌／重建軌各用自己的 OR 寬度歷史（同 h01-probegrid）。
 *   成本 2026 MTX。
 *   不准開新預設，不准改 probeMin／0.8／0.55。
 *
 * 這不是通過／殺掉。n=30、全是 2026 多頭，沒有 2025。
 * 正版 Q8 要 2024-08-26 起真 1 分。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateDayTrade } from "../src/backtest.ts";
import { MARKETS } from "../src/market.ts";
import { DEFAULT_PARAMS, withGap } from "../src/specs.ts";
import type { LabParams, MinuteBar, Trade } from "../src/types.ts";

const generatedAt = "2026-08-26";
const market = MARKETS.tx;

type RealFile = {
  built: string;
  days: Array<{ d: string; contract: string; bars: MinuteBar[] }>;
};

const realFile = JSON.parse(
  readFileSync(new URL("../data/tx-1min.json", import.meta.url), "utf8"),
) as RealFile;

const realByDate = new Map(realFile.days.map((x) => [x.d, x.bars]));
const windowDates = realFile.days.map((x) => x.d).sort();

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
    pnl: Math.round(pnl),
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 3),
    wr: tr.length ? r(tr.filter((t) => t.pnlTwd > 0).length / tr.length, 4) : 0,
    stops: tr.filter((t) => t.reason === "停損").length,
    flatten: tr.filter((t) => t.reason === "尾盤平倉").length,
    targets: tr.filter((t) => t.reason === "停利").length,
  };
}

function skeleton(vwap: boolean, vol: boolean, gaps: boolean): LabParams {
  return withGap(
    {
      ...DEFAULT_PARAMS,
      probeMin: 37,
      targetR: 0,
      stopOrFrac: 0.55,
      vwapFilter: vwap,
      volFilter: vol,
      settleFilter: false,
      foreignFilter: false,
      weekdayMode: "all",
      regimeFilter: false,
      atrExpandSkip: false,
      seedOffset: 0,
    },
    gaps,
    gaps,
  );
}

const SPECS: Record<string, { label: string; params: LabParams; inGrid: boolean }> = {
  none: { label: "無 VWAP／波動（停損 0.55）", params: skeleton(false, false, false), inGrid: true },
  vwap: { label: "只 VWAP", params: skeleton(true, false, false), inGrid: true },
  vol: { label: "只波動", params: skeleton(false, true, false), inGrid: true },
  both: { label: "VWAP＋波動", params: skeleton(true, true, false), inGrid: true },
  alpha37: { label: "ALPHA-37 原裝", params: { ...DEFAULT_PARAMS, seedOffset: 0 }, inGrid: false },
};

function replay(params: LabParams, kind: "real" | "syn") {
  const recentS: number[] = [];
  const recentR: number[] = [];
  const trades: Trade[] = [];
  const skips: Record<string, number> = {};
  let nDays = 0;
  for (let i = market.startIdx; i < market.bars.length; i++) {
    const day = market.bars[i];
    const atr = market.ATR20[i];
    const evS = evaluateDayTrade(
      day,
      market.bars[i - 1].c,
      atr,
      recentS,
      params,
      undefined,
      market,
    );
    const realBars = realByDate.get(day.d);
    let orR = evS.orWidth;
    if (realBars) {
      nDays += 1;
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
      const ev = kind === "real" ? evR : evS;
      if (ev.trade) trades.push(ev.trade);
      const reason = ev.skipped ?? (ev.trade ? "進場" : "未觸發");
      skips[reason] = (skips[reason] ?? 0) + 1;
    }
    recentS.push(evS.orWidth);
    if (recentS.length > 20) recentS.shift();
    recentR.push(orR);
    if (recentR.length > 20) recentR.shift();
  }
  return { ...pfOf(trades), nDays, skips };
}

const cells: Record<string, { real: ReturnType<typeof replay>; syn: ReturnType<typeof replay> }> =
  {};
for (const [id, spec] of Object.entries(SPECS)) {
  cells[id] = {
    real: replay(spec.params, "real"),
    syn: replay(spec.params, "syn"),
  };
  const c = cells[id];
  console.log(
    id,
    "real n",
    c.real.n,
    "PF",
    c.real.pf,
    "pnl",
    c.real.pnl,
    "syn PF",
    c.syn.pf,
    "skips",
    JSON.stringify(c.real.skips),
  );
}

const noneR = cells.none.real;
const grid = (["none", "vwap", "vol", "both"] as const).map((id) => ({
  id,
  label: SPECS[id].label,
  real: cells[id].real,
  syn: cells[id].syn,
  dPfReal: r(cells[id].real.pf - noneR.pf, 3),
  dPnlReal: cells[id].real.pnl - noneR.pnl,
  dPfSyn: r(cells[id].syn.pf - cells.none.syn.pf, 3),
}));

const call = [
  `H-09／Q8 30 日真 1 分（${windowDates[0]}→${windowDates[windowDates.length - 1]}，n=${windowDates.length}）是診斷，不是通過／殺掉。`,
  `骨架停損 0.55、探針 37、缺口關。真 1 分：無濾網 PF ${cells.none.real.pf}（n=${cells.none.real.n}），只 VWAP ${cells.vwap.real.pf}（Δ${r(cells.vwap.real.pf - noneR.pf, 3)}），只波動 ${cells.vol.real.pf}（Δ${r(cells.vol.real.pf - noneR.pf, 3)}），兩者 ${cells.both.real.pf}（Δ${r(cells.both.real.pf - noneR.pf, 3)}）。`,
  `ALPHA-37 原裝真 1 分 PF ${cells.alpha37.real.pf}（n=${cells.alpha37.real.n}）。`,
  `同窗重建：無濾網 ${cells.none.syn.pf}、只 VWAP ${cells.vwap.syn.pf}、只波動 ${cells.vol.syn.pf}、兩者 ${cells.both.syn.pf}。`,
  "n=30、全是 2026 多頭。不准改 DEFAULT_PARAMS，不准把 30 日 PF 寫成 Q8 通過或殺掉。",
].join(" ");

const out = {
  generatedAt,
  experiment: "H-09",
  issue: 10,
  isPassFail: false,
  blocked: true,
  reason:
    "只有滾動 30 個交易日的真 1 分。Q8 通過／殺掉要 2024-08-26 起。本檔只看 VWAP／波動在真 1 分上的符號，值不值得等長窗。",
  definition: {
    layer: "C（真 1 分 30 日）+ 重建陪跑",
    skeleton: "probeMin=37, targetR=0, stopOrFrac=0.55, gaps off",
    grid: "vwapFilter × volFilter",
    companion: "ALPHA-37 原裝",
    costModel: "2026 MTX",
    notTuned: true,
    sampleStartUnchanged: true,
  },
  call,
  window: { from: windowDates[0], to: windowDates[windowDates.length - 1], n: windowDates.length },
  grid,
  alpha37: {
    label: SPECS.alpha37.label,
    real: cells.alpha37.real,
    syn: cells.alpha37.syn,
  },
  doNot: [
    "改 DEFAULT_PARAMS",
    "改 probeMin / 0.8 / 0.55",
    "新增 preset",
    "把 30 日 PF 寫成 Q8 通過或殺掉",
  ],
};

writeFileSync(
  new URL("../results/h09-vwap.json", import.meta.url),
  JSON.stringify(out, null, 2),
);
console.log(call);
