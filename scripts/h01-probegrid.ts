/**
 * H-01-30d 探針網格（診斷，不是通過／殺掉）。
 *
 * 讀已經聚合的 data/tx-1min.json（30 個交易日），不碰原始 tick。
 * 預先登記清單：presets 全表 × probeMin ∈ {15,30,37,45,60}，同一成本、
 * 停損先於停利、收盤突破。真實軌與重建軌各用自己的 OR 寬度歷史當波動基準
 * （與 scripts/h01-real1m.ts 相同）。
 *
 * n≈30、全是 2026 多頭。數字不是回測。15 分若在這張表勝出，也不准改
 * DEFAULT_PARAMS.probeMin。H-01 正版要 2024-08-26 起。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateDayTrade } from "../src/backtest.ts";
import { MARKETS } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import type { LabParams, MinuteBar, Trade } from "../src/types.ts";

const generatedAt = "2026-08-26";
const PROBES = [15, 30, 37, 45, 60] as const;
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

function replay(params: LabParams, kind: "real" | "syn") {
  const recentS: number[] = [];
  const recentR: number[] = [];
  const trades: Trade[] = [];
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
    }
    recentS.push(evS.orWidth);
    if (recentS.length > 20) recentS.shift();
    recentR.push(orR);
    if (recentR.length > 20) recentR.shift();
  }
  return pfOf(trades);
}

const presetIds = Object.keys(PRESETS);
const grid: Record<
  string,
  Record<number, { real: ReturnType<typeof pfOf>; syn: ReturnType<typeof pfOf> }>
> = {};

for (const id of presetIds) {
  grid[id] = {};
  for (const p of PROBES) {
    const params: LabParams = {
      ...DEFAULT_PARAMS,
      ...PRESETS[id].params,
      probeMin: p,
      seedOffset: 0,
    };
    grid[id][p] = {
      real: replay(params, "real"),
      syn: replay(params, "syn"),
    };
  }
}

function line(id: string, p: number) {
  const cell = grid[id][p];
  return {
    probeMin: p,
    real: cell.real,
    syn: cell.syn,
    dPf: r(cell.real.pf - cell.syn.pf, 3),
    dPnl: cell.real.pnl - cell.syn.pnl,
  };
}

const torbReal = PROBES.map((p) => grid.torb37[p].real);
const torbSyn = PROBES.map((p) => grid.torb37[p].syn);
const alphaReal = PROBES.map((p) => grid.alpha37[p].real);
const alphaSyn = PROBES.map((p) => grid.alpha37[p].syn);

function argmaxPf(rows: ReturnType<typeof pfOf>[]) {
  let best = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].pf > rows[best].pf) best = i;
  return { probeMin: PROBES[best], pf: rows[best].pf, n: rows[best].n };
}

const call = [
  `真 1 分 ${windowDates.length} 日（${windowDates[0]}→${windowDates[windowDates.length - 1]}）探針網格是診斷，不是 H-01 通過。`,
  `無濾網 TORB 真 1 分：15 分 PF ${grid.torb37[15].real.pf}、37 分 ${grid.torb37[37].real.pf}、45 分 ${grid.torb37[45].real.pf}（最高）；15 沒有主宰 37。`,
  `同窗重建 TORB：15 分 PF ${grid.torb37[15].syn.pf}、37 分 ${grid.torb37[37].syn.pf}。`,
  `ORB-15（短探針＋固定停利）重建 PF ${grid.torb15[15].syn.pf} vs 真 1 分 ${grid.torb15[15].real.pf}——重建把 PF 灌了約一倍。`,
  `ALPHA-37 真 1 分五檔裡 37 分最高（PF ${grid.alpha37[37].real.pf}），15 分 ${grid.alpha37[15].real.pf}。`,
  "n=30、全是 2026 多頭。不准改 probeMin，不准把 ORB-15 當發現。",
].join(" ");

const out = {
  generatedAt,
  experiment: "H-01-30d-probegrid",
  isPassFail: false,
  blocked: true,
  reason:
    "只有滾動 30 個交易日的真 1 分。H-01 通過／殺掉要 2024-08-26 起。本檔只衡量重建器是否仍偏惠短探針。",
  call,
  window: { from: windowDates[0], to: windowDates[windowDates.length - 1], n: windowDates.length },
  probes: [...PROBES],
  bestPf: {
    torbReal: argmaxPf(torbReal),
    torbSyn: argmaxPf(torbSyn),
    alphaReal: argmaxPf(alphaReal),
    alphaSyn: argmaxPf(alphaSyn),
  },
  locked: {
    torb37: PROBES.map((p) => line("torb37", p)),
    alpha37: PROBES.map((p) => line("alpha37", p)),
    torb15: PROBES.map((p) => line("torb15", p)),
  },
  grid,
  doNot: [
    "改 DEFAULT_PARAMS.probeMin",
    "把 ORB-15 當發現",
    "把 30 日 PF 寫成 H-01 通過或殺掉",
    "新增 preset",
  ],
};

writeFileSync(
  new URL("../results/h01-probegrid.json", import.meta.url),
  JSON.stringify(out, null, 2),
);
console.log(call);
console.log("best", out.bestPf);
for (const id of ["torb37", "alpha37", "torb15"]) {
  console.log(`\n${id}`);
  for (const p of PROBES) {
    const c = grid[id][p];
    console.log(
      `  ${p}  real n=${c.real.n} PF ${c.real.pf} pnl ${c.real.pnl}  syn n=${c.syn.n} PF ${c.syn.pf} pnl ${c.syn.pnl}`,
    );
  }
}
