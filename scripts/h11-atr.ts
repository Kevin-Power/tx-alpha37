import { writeFileSync } from "node:fs";
import { runLab } from "../src/backtest.ts";
import { atrExpandDist, h11Reports } from "../src/research.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { ATR_EXPAND_K, MARKETS } from "../src/market.ts";
import { OOS_SPLIT, weekdayUtc } from "../src/calendar.ts";
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
const reports = h11Reports(MARKET);
const base = reports.find((x) => x.id === "alpha37")!;
const struct = reports.find((x) => x.id === "struct37")!;
const expand = reports.find((x) => x.id === "atrSkip20")!;
const dist = atrExpandDist(MARKET);

function improve(a: WindowKpis, b: WindowKpis) {
  return a.pf > b.pf && a.expectancy > b.expectancy;
}
const d2025 = expand.y2025.pf - base.y2025.pf;
const d2026 = expand.y2026.pf - base.y2026.pf;
const dPfMa = struct.full.pf - base.full.pf;
const dPfAtr = expand.full.pf - base.full.pf;
const share = dPfMa !== 0 ? dPfAtr / dPfMa : 0;
const fired = (expand.skip["ATR 擴張放假"] ?? 0) > 0;

const pass =
  fired &&
  improve(expand.full, base.full) &&
  improve(expand.is, base.is) &&
  improve(expand.oos, base.oos) &&
  d2025 * d2026 > 0 &&
  share >= 0.5;
const kill =
  !fired ||
  !improve(expand.oos, base.oos) ||
  d2025 * d2026 < 0 ||
  share < 0.5;
const call = pass
  ? "PASS：ATR 擴張 2.0 複製了結構37 的增量 → 把結構37 降成多頭樣本裡的共線代理。"
  : kill
    ? "KILL：ATR 擴張放假（門檻 2.0）複製不了結構37。失敗也不等於 MA20 是真結構。"
    : "INCONCLUSIVE。";

const crashMonths = ["2025-11", "2025-12", "2026-07"] as const;
function monthPnl(
  trades: { date: string; pnlTwd: number }[],
  ym: string,
) {
  const rows = trades.filter((t) => t.date.startsWith(ym));
  return {
    n: rows.length,
    win: rows.filter((t) => t.pnlTwd > 0).length,
    pnl: Math.round(rows.reduce((s, t) => s + t.pnlTwd, 0)),
  };
}

const structResult = runLab({ ...DEFAULT_PARAMS, ...PRESETS.struct37.params }, MARKET);
const expandResult = runLab(expand.params, MARKET);
const crash = crashMonths.map((m) => {
  const a = monthPnl(alpha.trades, m);
  const s = monthPnl(structResult.trades, m);
  const e = monthPnl(expandResult.trades, m);
  return { month: m, alpha: a, struct: s, atrSkip: e, savedByMa: s.pnl - a.pnl };
});
const crashSaved = crash.reduce((s, x) => s + x.savedByMa, 0);
const structDelta = structResult.kpis.netPnl - alpha.kpis.netPnl;

function pfOf(tr: { pnlTwd: number; date: string }[]) {
  const gw = tr.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(tr.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0));
  return {
    n: tr.length,
    pnl: Math.round(tr.reduce((s, t) => s + t.pnlTwd, 0)),
    pf: r(gl > 0 ? gw / gl : gw > 0 ? 9 : 0, 3),
  };
}
const fri = alpha.trades.filter((t) => weekdayUtc(t.date) === 5);
const nonFri = alpha.trades.filter((t) => weekdayUtc(t.date) !== 5);

function pack(s: SpecReport) {
  return {
    id: s.id,
    label: s.label,
    hint: s.hint,
    regimeFilter: s.params.regimeFilter,
    atrExpandSkip: s.params.atrExpandSkip,
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

const out = {
  generatedAt: "2026-08-25",
  experiment: "H-11",
  note: "Grok 4.6 指定：ATR 擴張放假，只打一次，門檻鎖死 2.0，五個窗口一起報。公開倉 H-01～H-07 編號已佔，沿用來稿 H-11。",
  definition: {
    layer: "A",
    formula: "ATR20[t-1] / ATR60[t-1] >= 2.0 → skip day",
    lookAhead: "none (yesterday close)",
    k: ATR_EXPAND_K,
    notTuned: true,
  },
  market: {
    asOf: MARKET.asOf,
    nBars: MARKET.bars.length,
    first: MARKET.bars[0]?.d,
    last: MARKET.bars[MARKET.bars.length - 1]?.d,
    lastClose: MARKET.bars[MARKET.bars.length - 1]?.c,
  },
  oosSplit: OOS_SPLIT,
  distribution: {
    nDays: dist.nDays,
    p50: r(dist.p50, 4),
    p75: r(dist.p75, 4),
    p90: r(dist.p90, 4),
    p95: r(dist.p95, 4),
    p99: r(dist.p99, 4),
    max: r(dist.max, 4),
    nAtK: dist.nAtK,
    nBelowMa: dist.nBelowMa,
    k: dist.k,
  },
  replication: {
    alphaN: base.full.n,
    alphaPf: r(base.full.pf, 4),
    structN: struct.full.n,
    structPf: r(struct.full.pf, 4),
    committedAlpha: { n: 332, pf: 1.145 },
    committedStruct: { n: 241, pf: 1.317 },
    ok:
      base.full.n === 332 &&
      Math.abs(base.full.pf - 1.145) < 0.002 &&
      struct.full.n === 241 &&
      Math.abs(struct.full.pf - 1.317) < 0.002,
  },
  verdict: {
    pass,
    kill,
    fired,
    d2025: r(d2025, 4),
    d2026: r(d2026, 4),
    dPfAtr: r(dPfAtr, 4),
    dPfMa: r(dPfMa, 4),
    share: r(share, 4),
    call,
    caveats: [
      "門檻鎖死 2.0。本樣本 ATR20/ATR60 最大值 1.43，0 日開火。不准改成 1.2。",
      "失敗只代表這個波動體制代理複製不了 MA20，不代表 MA20 是真結構。",
      "結構37 相對 ALPHA-37 的淨利增量，約 93% 來自 2025-11／2025-12／2026-07。",
      "沒有新預設。DEFAULT_PARAMS.atrExpandSkip 維持 false。",
    ],
  },
  specs: reports.map(pack),
  crashMonths: {
    incrementalPnl: Math.round(structDelta),
    savedInThreeMonths: crashSaved,
    shareOfIncrement: r(crashSaved / structDelta, 4),
    rows: crash,
  },
  fridayAttack: {
    all: pfOf(fri),
    y2025: pfOf(fri.filter((t) => t.date.startsWith("2025"))),
    y2025oos: pfOf(
      fri.filter((t) => t.date >= OOS_SPLIT && t.date.startsWith("2025")),
    ),
    y2026: pfOf(fri.filter((t) => t.date.startsWith("2026"))),
    nonFriAll: pfOf(nonFri),
    nonFriIs: pfOf(nonFri.filter((t) => t.date < OOS_SPLIT)),
    nonFri2025: pfOf(nonFri.filter((t) => t.date.startsWith("2025"))),
    shareOfNet: r(
      fri.reduce((s, t) => s + t.pnlTwd, 0) / alpha.kpis.netPnl,
      4,
    ),
  },
};

writeFileSync(new URL("../results/h11-atr.json", import.meta.url), JSON.stringify(out, null, 2));

const header =
  "| 區間 | n | 勝率 | PF | 損益 TWD | 期望 | CAGR | MDD | Sharpe |";
const sep = "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";

console.log(`TWII ${MARKET.asOf}  OOS≥${OOS_SPLIT}  K=${ATR_EXPAND_K}`);
console.log(
  `replication alpha n=${base.full.n} PF=${base.full.pf.toFixed(4)}  struct n=${struct.full.n} PF=${struct.full.pf.toFixed(4)}  match=${out.replication.ok}`,
);
console.log(
  `dist max=${dist.max.toFixed(4)} nAtK=${dist.nAtK} belowMa=${dist.nBelowMa}`,
);
console.log(call);
console.log("");
for (const s of reports) {
  console.log(
    `## ${s.id}  ${s.label}  regime=${s.params.regimeFilter} atrExpand=${s.params.atrExpandSkip}`,
  );
  console.log(header);
  console.log(sep);
  for (const w of [s.full, s.is, s.oos, s.y2024, s.y2025, s.y2026])
    console.log(mdWindow(w));
  console.log(
    "weekdays",
    s.weekdays
      .map((w) => `${w.label} n=${w.n} PF=${w.pf.toFixed(2)} ${twd(w.pnl)}`)
      .join(" · "),
  );
  console.log(
    `long n=${s.long.n} PF=${s.long.pf.toFixed(3)} ${twd(s.long.pnl)}  short n=${s.short.n} PF=${s.short.pf.toFixed(3)} ${twd(s.short.pnl)}`,
  );
  console.log("");
}
