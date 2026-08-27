/**
 * H-10 / Q9：固定 1 口 vs 波動倉位。
 *
 * 預先登記（GitHub #11）：
 *   層級：資金曲線，不是訊號。同一批 ALPHA-37 交易，只改口數／契約重算 TWD。
 *   不准改 DEFAULT_PARAMS／SAMPLE_START／probeMin／預設契約。
 *   主場 TX，2024-08-26 窗。陪跑 tradeFrom=2012-01-02 克隆（同 H-08）。
 *   30 日真 1 分口數 vs 重建口數只診斷，不是通過／殺掉。
 *
 * 鎖定規格（不是網格）：
 *   1. risk-mtx  現行 ALPHA-37（MTX，風險 1.2%）
 *   2. fix1-mtx  同 pts，固定 1 口小台
 *   3. fix1-tmf  同 pts，固定 1 口微台
 *   4. risk-tmf  sizeLots + TMF 1.2%（同風險、不同契約）
 *
 * 通過 A（波動倉把 2026 灌大／比 fix1-mtx 不穩）：
 *   seed0 2024 窗 lots>1 佔比 ≥30%，2026 淨利佔比高出 ≥5pp，
 *   最大回撤% 較高，且 ≥70% 種子 2026 佔比(risk) > 佔比(fix1)。
 * 殺掉 A：2024 窗均口數 < 1.15，或 lots>1 <15%，
 *   或 2026 佔比差 <5pp 且回撤沒比較差。
 *
 * 通過 B（微台比較誠實）：fix1-tmf 回撤% < fix1-mtx，PF 不因成本變差，2025 同號。
 * 殺掉 B：fix1-tmf PF < fix1-mtx（手續費吃掉微台），或勝率翻號
 *   （小點數贏家在微台上變成 TWD 輸家）。
 *
 * 不准開新預設。不准改預設契約。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { evaluateDayTrade, runBacktest, sizeLots } from "../src/backtest.ts";
import { OOS_SPLIT } from "../src/calendar.ts";
import { MARKETS, type MarketCtx } from "../src/market.ts";
import {
  CONTRACTS,
  DEFAULT_PARAMS,
  roundTripCostTwd,
} from "../src/specs.ts";
import type { ContractCode, LabParams, MinuteBar, Trade } from "../src/types.ts";

const generatedAt = "2026-08-27";
const SEED_N = 20;
const CAPITAL = DEFAULT_PARAMS.capital;

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}

function withTradeFrom(m: MarketCtx, from: string): MarketCtx {
  let startIdx = m.bars.findIndex((b) => b.d >= from);
  if (startIdx < 1) startIdx = 1;
  return { ...m, tradeFrom: from, startIdx };
}

function stopDistOf(t: Trade) {
  return Math.max(1, Math.abs(t.entry - t.stop));
}

function reprice(t: Trade, contract: ContractCode, lots: number): Trade {
  const spec = CONTRACTS[contract];
  const cost = roundTripCostTwd(
    t.entry,
    t.exit,
    spec.multiplier,
    lots,
    DEFAULT_PARAMS.commissionPerSide,
    DEFAULT_PARAMS.slippagePts,
  );
  const pnlTwd = t.pts * spec.multiplier * lots - cost;
  return { ...t, lots, costTwd: cost, pnlTwd, equity: 0 };
}

function pack(tr: Trade[]) {
  const gw = tr.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(
    tr.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0),
  );
  const pnl = tr.reduce((s, t) => s + t.pnlTwd, 0);
  let eq = CAPITAL;
  let peak = eq;
  let maxDd = 0;
  for (const t of tr) {
    eq += t.pnlTwd;
    if (eq > peak) peak = eq;
    maxDd = Math.max(maxDd, peak > 0 ? (peak - eq) / peak : 0);
  }
  const first = tr[0]?.date;
  const last = tr[tr.length - 1]?.date;
  const years =
    first && last
      ? Math.max(0.15, (Date.parse(last) - Date.parse(first)) / (365.25 * 86400000))
      : 0.15;
  const ret = pnl / CAPITAL;
  const y2025 = tr.filter((t) => t.date.startsWith("2025"));
  const y2026 = tr.filter((t) => t.date.startsWith("2026"));
  const p25 = y2025.reduce((s, t) => s + t.pnlTwd, 0);
  const p26 = y2026.reduce((s, t) => s + t.pnlTwd, 0);
  const oos = tr.filter((t) => t.date >= OOS_SPLIT);
  const ogw = oos.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const ogl = Math.abs(
    oos.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0),
  );
  const lots = tr.map((t) => t.lots);
  const meanLots = lots.length
    ? r(lots.reduce((s, x) => s + x, 0) / lots.length, 3)
    : 0;
  const nGt1 = lots.filter((x) => x > 1).length;
  const hist: Record<string, number> = {};
  for (const x of lots) hist[String(x)] = (hist[String(x)] ?? 0) + 1;
  return {
    n: tr.length,
    win: tr.filter((t) => t.pnlTwd > 0).length,
    wr: tr.length ? r(tr.filter((t) => t.pnlTwd > 0).length / tr.length, 4) : 0,
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 3),
    pnl: Math.round(pnl),
    expect: tr.length ? Math.round(pnl / tr.length) : 0,
    cagr: r(Math.pow(Math.max(1e-9, 1 + ret), 1 / years) - 1, 4),
    dd: r(maxDd, 4),
    oosN: oos.length,
    oosPf: r(ogl > 0 ? ogw / ogl : ogw > 0 ? 9 : 0, 3),
    y2025: { n: y2025.length, pnl: Math.round(p25) },
    y2026: { n: y2026.length, pnl: Math.round(p26) },
    share2026: pnl !== 0 ? r(p26 / pnl, 4) : 0,
    meanLots,
    nGt1,
    fracGt1: lots.length ? r(nGt1 / lots.length, 4) : 0,
    maxLots: lots.length ? Math.max(...lots) : 0,
    hist,
  };
}

function alphaTrades(market: MarketCtx, seedOffset: number) {
  const params: LabParams = { ...DEFAULT_PARAMS, seedOffset };
  return runBacktest(params, market).trades;
}

function fourWays(src: Trade[]) {
  const riskMtx = src.map((t) => reprice(t, "MTX", t.lots));
  const fix1Mtx = src.map((t) => reprice(t, "MTX", 1));
  const fix1Tmf = src.map((t) => reprice(t, "TMF", 1));
  const riskTmf = src.map((t) =>
    reprice(t, "TMF", sizeLots({ ...DEFAULT_PARAMS, contract: "TMF" }, stopDistOf(t))),
  );
  const nFlip = src.filter((t) => {
    const a = reprice(t, "MTX", 1);
    const b = reprice(t, "TMF", 1);
    return a.pnlTwd > 0 && b.pnlTwd <= 0;
  }).length;
  return {
    "risk-mtx": pack(riskMtx),
    "fix1-mtx": pack(fix1Mtx),
    "fix1-tmf": pack(fix1Tmf),
    "risk-tmf": pack(riskTmf),
    nFlipMtxWinTmfLose: nFlip,
  };
}

const tx2024 = MARKETS.tx;
const tx2012 = withTradeFrom(MARKETS.tx, "2012-01-02");

console.log(
  "H-10 windows",
  "2024",
  tx2024.bars[tx2024.startIdx]?.d,
  "→",
  tx2024.bars[tx2024.bars.length - 1]?.d,
  "| 2012",
  tx2012.bars[tx2012.startIdx]?.d,
  "→",
  tx2012.bars[tx2012.bars.length - 1]?.d,
);

const seed0src = alphaTrades(tx2024, 0);
const seed0 = fourWays(seed0src);
const long0 = fourWays(alphaTrades(tx2012, 0));

const risk = seed0["risk-mtx"];
const fix = seed0["fix1-mtx"];
const tmf = seed0["fix1-tmf"];
const dShare = r(risk.share2026 - fix.share2026, 4);
const dDd = r(risk.dd - fix.dd, 4);

const seeds = [];
for (let s = 0; s < SEED_N; s++) {
  const w = fourWays(alphaTrades(tx2024, s));
  const rs = w["risk-mtx"];
  const fx = w["fix1-mtx"];
  seeds.push({
    seed: s,
    meanLots: rs.meanLots,
    fracGt1: rs.fracGt1,
    shareRisk: rs.share2026,
    shareFix: fx.share2026,
    dShare: r(rs.share2026 - fx.share2026, 4),
    ddRisk: rs.dd,
    ddFix: fx.dd,
    dDd: r(rs.dd - fx.dd, 4),
    pfRisk: rs.pf,
    pfFix: fx.pf,
    pfTmf: w["fix1-tmf"].pf,
    wrTmf: w["fix1-tmf"].wr,
    wrFix: fx.wr,
    nFlip: w.nFlipMtxWinTmfLose,
  });
  console.log(
    "seed",
    s,
    "meanLots",
    rs.meanLots,
    "frac>1",
    rs.fracGt1,
    "dShare",
    r(rs.share2026 - fx.share2026, 4),
    "dDd",
    r(rs.dd - fx.dd, 4),
  );
}

const nSharePos = seeds.filter((s) => s.dShare > 0).length;
const nDdWorse = seeds.filter((s) => s.dDd > 0).length;
const nFixPfBetter = seeds.filter((s) => s.pfFix > s.pfRisk).length;
const killALots = risk.meanLots < 1.15 || risk.fracGt1 < 0.15;
const passA =
  !killALots &&
  risk.fracGt1 >= 0.3 &&
  dShare >= 0.05 &&
  dDd > 0 &&
  nSharePos / SEED_N >= 0.7;
const killA = killALots || (dShare < 0.05 && dDd <= 0);

const killBCost =
  tmf.pf < fix.pf || tmf.wr < fix.wr || seed0.nFlipMtxWinTmfLose > 0;
const passB =
  !killBCost &&
  tmf.dd < fix.dd &&
  Math.sign(tmf.y2025.pnl) === Math.sign(fix.y2025.pnl);
const killB = killBCost;

const callA = passA
  ? "PASS A：波動倉把 2026 灌大，比固定 1 口小台不穩。仍不准改 DEFAULT_PARAMS。"
  : killALots
    ? "KILL A：50 萬小台的「波動倉位」幾乎就是 1 口，沒有獨立的資金曲線故事。"
    : killA
      ? "KILL A：2026 佔比差與回撤差撐不起「波動倉比較不穩」。"
      : "INCONCLUSIVE A：2026 佔比在總損益接近 0 時會爆炸，過不了 ≥70% 種子。重建路徑上波動倉是 1 或 2 口，回撤 20/20 較差，但 30 日真 1 分全是 1 口（OR 偏窄灌口數）。不准改 DEFAULT_PARAMS，不准開 1 口預設。";

const callB = passB
  ? "PASS B：固定 1 口微台回撤較低且 PF 沒被成本吃掉。仍不准改預設契約。"
  : "KILL B：微台不是更誠實的報告單位——單邊 50 元手續費吃掉小點數贏家。";

type RealFile = {
  built: string;
  days: Array<{ d: string; contract: string; bars: MinuteBar[] }>;
};
const realFile = JSON.parse(
  readFileSync(new URL("../data/tx-1min.json", import.meta.url), "utf8"),
) as RealFile;
const realByDate = new Map(realFile.days.map((x) => [x.d, x.bars]));

function lotsOnPath(kind: "real" | "syn") {
  const params: LabParams = { ...DEFAULT_PARAMS, seedOffset: 0 };
  const recentS: number[] = [];
  const recentR: number[] = [];
  const rows: Array<{ d: string; or: number; stop: number; lots: number }> = [];
  const m = MARKETS.tx;
  for (let i = m.startIdx; i < m.bars.length; i++) {
    const day = m.bars[i];
    const evS = evaluateDayTrade(
      day,
      m.bars[i - 1].c,
      m.ATR20[i],
      recentS,
      params,
      undefined,
      m,
    );
    const realBars = realByDate.get(day.d);
    let orR = evS.orWidth;
    let ev = evS;
    if (realBars) {
      const evR = evaluateDayTrade(
        day,
        m.bars[i - 1].c,
        m.ATR20[i],
        recentR,
        params,
        realBars,
        m,
      );
      orR = evR.orWidth;
      ev = kind === "real" ? evR : evS;
      if (ev.trade) {
        const stop = stopDistOf(ev.trade);
        rows.push({
          d: day.d,
          or: r(kind === "real" ? orR : evS.orWidth, 1),
          stop: r(stop, 1),
          lots: sizeLots(params, stop),
        });
      }
    }
    recentS.push(evS.orWidth);
    if (recentS.length > 20) recentS.shift();
    recentR.push(orR);
    if (recentR.length > 20) recentR.shift();
  }
  const lots = rows.map((x) => x.lots);
  const ors = rows.map((x) => x.or);
  const mean = (xs: number[]) =>
    xs.length ? r(xs.reduce((s, x) => s + x, 0) / xs.length, 3) : 0;
  return {
    n: rows.length,
    meanOr: mean(ors),
    meanStop: mean(rows.map((x) => x.stop)),
    meanLots: mean(lots),
    nGt1: lots.filter((x) => x > 1).length,
    rows,
  };
}

const realLots = lotsOnPath("real");
const synLots = lotsOnPath("syn");

const out = {
  generatedAt,
  experiment: "H-10",
  issue: 11,
  definition: {
    layer: "資金曲線，不是訊號",
    primary: "tx 2024-08-26",
    companion: "tx 2012-01-02 clone",
    specs: ["risk-mtx", "fix1-mtx", "fix1-tmf", "risk-tmf"],
    sampleStartUnchanged: true,
    notTuned: true,
    passA:
      "lots>1 ≥30% 且 2026 佔比差 ≥5pp 且 DD(risk)>DD(fix1) 且 ≥70% 種子",
    killA: "均口數 <1.15 或 lots>1 <15% 或佔比差<5pp 且回撤沒比較差",
    passB: "fix1-tmf DD% < fix1-mtx 且 PF 不因成本變差 且 2025 同號",
    killB: "微台 PF 較差或勝率翻號（手續費吃掉小贏家）",
  },
  verdict: {
    passA,
    killA,
    callA,
    passB,
    killB,
    callB,
    killALots,
    nSharePos,
    nDdWorse,
    nFixPfBetter,
    dShare,
    dDd,
    nFlip: seed0.nFlipMtxWinTmfLose,
    dPnl2025: risk.y2025.pnl - fix.y2025.pnl,
    dPnl2026: risk.y2026.pnl - fix.y2026.pnl,
    noteShare:
      "share2026 = 年損益/總損益。總損益接近 0 時會爆炸（H-02 同一病），不能當通過條件的穩健 KPI。",
  },
  seed0: { window2024: seed0, window2012: long0 },
  seeds,
  real1mLots: {
    isPassFail: false,
    window: {
      from: realFile.days.map((d) => d.d).sort()[0],
      to: realFile.days.map((d) => d.d).sort().at(-1),
      n: realFile.days.length,
    },
    real: { n: realLots.n, meanOr: realLots.meanOr, meanStop: realLots.meanStop, meanLots: realLots.meanLots, nGt1: realLots.nGt1 },
    syn: { n: synLots.n, meanOr: synLots.meanOr, meanStop: synLots.meanStop, meanLots: synLots.meanLots, nGt1: synLots.nGt1 },
  },
};

writeFileSync(
  new URL("../results/h10-size.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log(callA);
console.log(callB);
console.log("seed0 2024", {
  risk: seed0["risk-mtx"],
  fix1: seed0["fix1-mtx"],
  tmf: seed0["fix1-tmf"],
  riskTmf: seed0["risk-tmf"],
  nFlip: seed0.nFlipMtxWinTmfLose,
});
console.log("lots hist", seed0["risk-mtx"].hist, "mean", seed0["risk-mtx"].meanLots);
console.log("2012 risk vs fix1", long0["risk-mtx"].meanLots, long0["fix1-mtx"].pf, long0["risk-mtx"].pf);
console.log("real1m lots", out.real1mLots);
