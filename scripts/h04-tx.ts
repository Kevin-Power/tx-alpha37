import { writeFileSync } from "node:fs";
import { runLab } from "../src/backtest.ts";
import { h06Reports, reportSpec } from "../src/research.ts";
import { MARKETS, gapClose } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import type { SpecReport, WindowKpis } from "../src/research.ts";

function r(n: number, d = 3) {
  return Number(n.toFixed(d));
}
function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
function twd(n: number) {
  const s = Math.round(n).toLocaleString("en-US");
  return n > 0 ? `+${s}` : s;
}
function row(w: WindowKpis) {
  return {
    label: w.label,
    n: w.n,
    wr: r(w.wr, 4),
    pf: r(w.pf, 4),
    pnl: Math.round(w.pnl),
    expectancy: Math.round(w.expectancy),
    cagr: r(w.cagr, 4),
    dd: r(w.dd, 4),
    sharpe: r(w.sharpe, 3),
  };
}
function mdWindow(w: WindowKpis) {
  return `| ${w.label} | ${w.n} | ${pct(w.wr)} | ${w.pf.toFixed(3)} | ${twd(w.pnl)} | ${twd(w.expectancy)} | ${pct(w.cagr)} | ${pct(w.dd)} | ${w.sharpe.toFixed(2)} |`;
}
function pack(s: SpecReport) {
  return {
    id: s.id,
    label: s.label,
    windows: [s.full, s.is, s.oos, s.y2024, s.y2025, s.y2026].map(row),
    weekdays: s.weekdays.map((w) => ({
      ...w,
      wr: r(w.wr, 4),
      pf: r(w.pf, 3),
      pnl: Math.round(w.pnl),
    })),
    long: row(s.long),
    short: row(s.short),
    skip: s.skip,
    vsAlpha: {
      dN: s.vsAlpha.dN,
      dPf: r(s.vsAlpha.dPf, 4),
      dExp: Math.round(s.vsAlpha.dExp),
      dOosPf: r(s.vsAlpha.dOosPf, 4),
      dIsPf: r(s.vsAlpha.dIsPf, 4),
      d2025Pf: r(s.vsAlpha.d2025Pf, 4),
      d2026Pf: r(s.vsAlpha.d2026Pf, 4),
    },
  };
}

const twii = MARKETS.twii;
const tx = MARKETS.tx;

const alphaTw = runLab(DEFAULT_PARAMS, twii);
const structTw = runLab(
  { ...DEFAULT_PARAMS, ...PRESETS.struct37.params },
  twii,
);
const replication = {
  n: alphaTw.kpis.trades,
  pf: r(alphaTw.kpis.profitFactor, 4),
  structN: structTw.kpis.trades,
  structPf: r(structTw.kpis.profitFactor, 4),
  ok:
    alphaTw.kpis.trades === 332 &&
    Math.abs(alphaTw.kpis.profitFactor - 1.145) < 0.002 &&
    structTw.kpis.trades === 241,
};

function gapSkipDays(market: typeof tx) {
  const days: string[] = [];
  for (let i = market.startIdx; i < market.bars.length; i++) {
    const b = market.bars[i];
    const prev = market.bars[i - 1].c;
    const gc = gapClose(b, prev);
    const atr = market.ATR20[i];
    if (atr > 0 && Math.abs(b.o - gc) / atr >= 0.8) days.push(b.d);
  }
  return days;
}
const twiiGaps = gapSkipDays(twii);
const txGaps = gapSkipDays(tx);
const twiiSet = new Set(twiiGaps);
const txSet = new Set(txGaps);
const both = txGaps.filter((d) => twiiSet.has(d));

const h06tx = h06Reports(tx);
const none = h06tx.find((x) => x.id === "noGap")!;
const skip = h06tx.find((x) => x.id === "skip080")!;

function improve(a: WindowKpis, b: WindowKpis) {
  return a.pf > b.pf && a.expectancy > b.expectancy;
}
const d2025 = skip.y2025.pf - none.y2025.pf;
const d2026 = skip.y2026.pf - none.y2026.pf;
const pass =
  improve(skip.full, none.full) &&
  improve(skip.is, none.is) &&
  improve(skip.oos, none.oos) &&
  d2025 > 0 &&
  d2026 > 0;
const kill = !improve(skip.oos, none.oos) || d2025 * d2026 < 0;
const call = pass
  ? "PASS：TX 上 skip080 相對無缺口，全樣本／IS／OOS 的 PF 與 expectancy 都改善，2025／2026 同號。"
  : kill
    ? "KILL：TX 真開盤價上，A 層 0.8 ATR 放假沒通過原 H-06 不等式。不准改門檻。"
    : "INCONCLUSIVE。通過條件失敗（全樣本與 IS 變差），殺掉條件沒觸發（OOS 有改善、年份同號）。不能再當有條件通過。不准改 0.8。";

const presets: Record<string, ReturnType<typeof pack>> = {};
for (const [id, p] of Object.entries(PRESETS)) {
  presets[id] = pack(
    reportSpec(id, p.label, p.hint, { ...DEFAULT_PARAMS, ...p.params }, undefined, tx),
  );
}

const SEED_N = 20;
function seedDist(id: string, extra: Partial<typeof DEFAULT_PARAMS>) {
  const pfs: number[] = [];
  const oos: number[] = [];
  for (let s = 0; s < SEED_N; s++) {
    const k = runLab({ ...DEFAULT_PARAMS, ...extra, seedOffset: s }, tx).kpis;
    pfs.push(k.profitFactor);
    oos.push(k.oosPf);
  }
  const sorted = [...pfs].sort((a, b) => a - b);
  const oSorted = [...oos].sort((a, b) => a - b);
  return {
    id,
    min: r(sorted[0], 4),
    med: r(sorted[Math.floor(SEED_N / 2)], 4),
    max: r(sorted[SEED_N - 1], 4),
    gt1: pfs.filter((x) => x > 1).length,
    n: SEED_N,
    oosMed: r(oSorted[Math.floor(SEED_N / 2)], 4),
    seed0: r(pfs[0], 4),
  };
}

const out = {
  generatedAt: "2026-08-25",
  experiment: "H-04",
  definition: {
    layer: "A",
    window: "2024-08-26 → 2026-08-25",
    gap: "open - prevSameC (TX) / prevClose (TWII)",
    atrLookahead: "atr[i] includes today (same as H-06 engine)",
  },
  replicationTwii: replication,
  overlap: {
    twiiN: twii.bars.length,
    txN: tx.bars.length - tx.startIdx,
    datesEqual:
      twii.bars.length === tx.bars.length - tx.startIdx &&
      twii.bars.every((b, i) => b.d === tx.bars[tx.startIdx + i]?.d),
    gapSkipTwii: twiiGaps.length,
    gapSkipTx: txGaps.length,
    intersection: both.length,
    onlyTx: txGaps.filter((d) => !twiiSet.has(d)).length,
    onlyTwii: twiiGaps.filter((d) => !txSet.has(d)).length,
  },
  h06onTx: {
    pass,
    kill,
    d2025: r(d2025, 4),
    d2026: r(d2026, 4),
    call,
    specs: h06tx.map(pack),
  },
  presets,
  seeds: [
    seedDist("alpha37", {}),
    seedDist("struct37", { regimeFilter: true }),
    seedDist("torb37", PRESETS.torb37.params),
  ],
};

writeFileSync(new URL("../results/h04-tx.json", import.meta.url), JSON.stringify(out, null, 2));

console.log("TWII replication", JSON.stringify(replication));
console.log("overlap", JSON.stringify(out.overlap));
console.log(call);
const header =
  "| 區間 | n | 勝率 | PF | 損益 TWD | 期望 | CAGR | MDD | Sharpe |";
const sep = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
for (const s of h06tx) {
  console.log(`## ${s.id}  ${s.label}`);
  console.log(header);
  console.log(sep);
  for (const w of [s.full, s.is, s.oos, s.y2024, s.y2025, s.y2026]) {
    console.log(mdWindow(w));
  }
}
console.log("\npresets TX seed0");
for (const [id, p] of Object.entries(presets)) {
  const f = p.windows[0];
  const o = p.windows[2];
  const y25 = p.windows[4];
  const y26 = p.windows[5];
  console.log(
    id.padEnd(12),
    `n=${f.n}`,
    `PF=${f.pf}`,
    `OOS=${o.pf}`,
    `2025=${y25.pf}`,
    `2026=${y26.pf}`,
    `exp=${f.expectancy}`,
  );
}
console.log("\nseeds", JSON.stringify(out.seeds));
