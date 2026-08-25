import { writeFileSync } from "node:fs";
import { runLab } from "../src/backtest.ts";
import { h06Reports, reportSpec } from "../src/research.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { MARKETS } from "../src/market.ts";
import { OOS_SPLIT } from "../src/calendar.ts";
import type { SpecReport, WindowKpis } from "../src/types.ts";

const MARKET = MARKETS.twii;

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

const alpha = runLab(DEFAULT_PARAMS, MARKET);
const reports = h06Reports(MARKET);
const both = reports.find((x) => x.id === "both")!;
const skip = reports.find((x) => x.id === "skip080")!;
const none = reports.find((x) => x.id === "noGap")!;

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
const mixedOnly =
  !improve(skip.full, none.full) &&
  both.full.pf > none.full.pf &&
  both.full.expectancy > none.full.expectancy;
const call = pass
  ? "PASS：A 層 0.8 ATR 放假相對無缺口，全樣本／IS／OOS 的 PF 與 expectancy 都改善，且 2025／2026 PF 增量同號為正。"
  : kill
    ? "KILL：OOS 沒改善，或 2025／2026 一正一負。"
    : mixedOnly
      ? "A-gap-only 沒過關；只有 mixed 改善 → gap edge 主要來自 C 層。"
      : "INCONCLUSIVE。";

const struct = reportSpec(
  "struct37",
  "結構37",
  "補齊 IS / 年度 PF（報告完整度，不是新實驗）",
  { ...DEFAULT_PARAMS, ...PRESETS.struct37.params },
  alpha,
  MARKET,
);

function pack(s: SpecReport) {
  return {
    id: s.id,
    label: s.label,
    hint: s.hint,
    gapSkip080: s.params.gapSkip080,
    gapDirection055: s.params.gapDirection055,
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
    vsNoGap: {
      dN: s.full.n - none.full.n,
      dPf: r(s.full.pf - none.full.pf, 4),
      dExp: Math.round(s.full.expectancy - none.full.expectancy),
      dIsPf: r(s.is.pf - none.is.pf, 4),
      dOosPf: r(s.oos.pf - none.oos.pf, 4),
      d2025Pf: r(s.y2025.pf - none.y2025.pf, 4),
      d2026Pf: r(s.y2026.pf - none.y2026.pf, 4),
    },
  };
}

const out = {
  generatedAt: "2026-08-25",
  experiment: "H-06",
  note: "GPT 來稿稱此實驗為 H-01。公開倉 H-01 已是真 1 分探針，故編號 H-06。",
  market: {
    asOf: MARKET.asOf,
    nBars: MARKET.bars.length,
    first: MARKET.bars[0]?.d,
    last: MARKET.bars[MARKET.bars.length - 1]?.d,
    lastClose: MARKET.bars[MARKET.bars.length - 1]?.c,
  },
  oosSplit: OOS_SPLIT,
  replication: {
    n: both.full.n,
    pf: r(both.full.pf, 4),
    committedN: 332,
    committedPf: 1.145,
    ok: both.full.n === 332 && Math.abs(both.full.pf - 1.145) < 0.002,
  },
  verdict: {
    pass,
    kill,
    mixedOnly,
    d2025: r(d2025, 4),
    d2026: r(d2026, 4),
    call,
    caveats: [
      "樣本內 PF 只從 1.079 → 1.083，總損益 −594；通過的是預先登記不等式，不是 IS 賺更多。",
      "2024 PF 變差（1.098 → 0.930）。不在殺掉條件裡，但要寫。",
      "2025 放假後仍 PF 0.966 < 1。",
      "0.55 順勢 2026 n 不變，一筆都沒擋到。",
    ],
  },
  specs: reports.map(pack),
  struct37Complete: {
    windows: [struct.full, struct.is, struct.oos, struct.y2024, struct.y2025, struct.y2026].map(row),
    weekdays: struct.weekdays.map((w) => ({
      ...w,
      wr: r(w.wr, 4),
      pf: r(w.pf, 3),
      pnl: Math.round(w.pnl),
    })),
    long: row(struct.long),
    short: row(struct.short),
  },
};

writeFileSync(new URL("../results/h06-gap.json", import.meta.url), JSON.stringify(out, null, 2));

const header =
  "| 區間 | n | 勝率 | PF | 損益 TWD | 期望 | CAGR | MDD | Sharpe |";
const sep = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";

console.log(`TWII ${MARKET.asOf}  OOS≥${OOS_SPLIT}`);
console.log(`replication both-on n=${both.full.n} PF=${both.full.pf.toFixed(4)}  match=${out.replication.ok}`);
console.log(call);
console.log("");
for (const s of reports) {
  console.log(`## ${s.id}  ${s.label}  skip080=${s.params.gapSkip080} dir055=${s.params.gapDirection055}`);
  console.log(header);
  console.log(sep);
  for (const w of [s.full, s.is, s.oos, s.y2024, s.y2025, s.y2026]) console.log(mdWindow(w));
  console.log(
    "weekdays",
    s.weekdays.map((w) => `${w.label} n=${w.n} PF=${w.pf.toFixed(2)} ${twd(w.pnl)}`).join(" · "),
  );
  console.log(
    `long n=${s.long.n} PF=${s.long.pf.toFixed(3)} ${twd(s.long.pnl)}  short n=${s.short.n} PF=${s.short.pf.toFixed(3)} ${twd(s.short.pnl)}`,
  );
  console.log("");
}
console.log("## struct37 complete windows");
console.log(header);
console.log(sep);
for (const w of [struct.full, struct.is, struct.oos, struct.y2024, struct.y2025, struct.y2026]) {
  console.log(mdWindow(w));
}
