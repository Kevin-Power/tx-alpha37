import { runLab } from "../src/backtest.ts";
import { dailySlices, h06Reports, reportSpec, windowKpis } from "../src/research.ts";
import { MARKET, MARKETS } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { OOS_SPLIT } from "../src/calendar.ts";

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

function pf(x: number) {
  return x.toFixed(3);
}

const twiiAlpha = runLab(DEFAULT_PARAMS, MARKETS.twii);
const twiiStruct = runLab(
  { ...DEFAULT_PARAMS, ...PRESETS.struct37.params },
  MARKETS.twii,
);
console.log(
  `${MARKET.id.toUpperCase()} ${MARKET.asOf}  bars=${MARKET.bars.length}  tradeFrom=${MARKET.tradeFrom}  ${MARKET.bars[MARKET.startIdx]?.d} → ${MARKET.bars[MARKET.bars.length - 1]?.d}  OOS≥${OOS_SPLIT}`,
);
console.log(
  `TWII replication alpha n=${twiiAlpha.kpis.trades} PF=${twiiAlpha.kpis.profitFactor.toFixed(3)}  struct n=${twiiStruct.kpis.trades} PF=${twiiStruct.kpis.profitFactor.toFixed(3)}`,
);
console.log("");
console.log(
  "id".padEnd(12),
  "n".padStart(4),
  "WR".padStart(7),
  "PF".padStart(6),
  "IS n".padStart(5),
  "IS PF".padStart(6),
  "OOSn".padStart(5),
  "OOSPF".padStart(6),
  "CAGR".padStart(7),
  "MDD".padStart(7),
  "25PF".padStart(6),
  "26PF".padStart(6),
  "Sharpe".padStart(7),
);

for (const [id, p] of Object.entries(PRESETS)) {
  const result = runLab({ ...DEFAULT_PARAMS, ...p.params });
  const isW = windowKpis(result, "IS", (d) => d < OOS_SPLIT);
  const y25 = windowKpis(result, "2025", (d) => d.startsWith("2025"));
  const y26 = windowKpis(result, "2026", (d) => d.startsWith("2026"));
  const k = result.kpis;
  console.log(
    id.padEnd(12),
    String(k.trades).padStart(4),
    pct(k.winRate).padStart(7),
    pf(k.profitFactor).padStart(6),
    String(isW.n).padStart(5),
    pf(isW.pf).padStart(6),
    String(k.oosN).padStart(5),
    pf(k.oosPf).padStart(6),
    pct(k.cagr).padStart(7),
    pct(k.maxDdPct).padStart(7),
    pf(y25.pf).padStart(6),
    pf(y26.pf).padStart(6),
    k.sharpe.toFixed(2).padStart(7),
  );
}

console.log("\nALPHA-37 daily slices");
for (const s of dailySlices()) {
  console.log(
    s.id.padEnd(12),
    `n=${s.n}`,
    `WR=${pct(s.wr)}`,
    `PF=${pf(s.pf)}`,
    `OOS PF=${pf(s.oosPf)} n=${s.oosN}`,
  );
}

console.log("\nH-06 gap ablation  (npx tsx scripts/h06-gap.ts)");
for (const s of h06Reports()) {
  console.log(
    s.id.padEnd(12),
    `n=${s.full.n}`,
    `PF=${pf(s.full.pf)}`,
    `IS=${pf(s.is.pf)}`,
    `OOS=${pf(s.oos.pf)}`,
    `2025=${pf(s.y2025.pf)}`,
    `2026=${pf(s.y2026.pf)}`,
    `exp=${Math.round(s.full.expectancy)}`,
  );
}

const struct = reportSpec(
  "struct37",
  "結構37",
  "",
  { ...DEFAULT_PARAMS, ...PRESETS.struct37.params },
);
console.log(
  "\nstruct37 windows  IS PF",
  pf(struct.is.pf),
  "2025 PF",
  pf(struct.y2025.pf),
  "2026 PF",
  pf(struct.y2026.pf),
);

// 種子擾動：C 層路徑相依 KPI 的可信區間。seed 0 = 上表使用的 canonical 路徑。
// 規則（FOR_MODELS）：路徑相依的主張須在 ≥70% 種子上成立，絕對 PF 只准報分布。
const SEED_N = 20;
console.log(`\n種子擾動（${SEED_N} 條重建路徑，seed0 = 上表）`);
console.log(
  "id".padEnd(12),
  "PF min/med/max".padStart(16),
  ">1".padStart(6),
  "OOS med".padStart(8),
  "seed0百分位".padStart(10),
);
for (const [id, p] of Object.entries(PRESETS)) {
  const pfs: number[] = [];
  const oosPfs: number[] = [];
  for (let s = 0; s < SEED_N; s++) {
    const k = runLab({ ...DEFAULT_PARAMS, ...p.params, seedOffset: s }).kpis;
    pfs.push(k.profitFactor);
    oosPfs.push(k.oosPf);
  }
  const sorted = [...pfs].sort((a, b) => a - b);
  const oSorted = [...oosPfs].sort((a, b) => a - b);
  const rank = sorted.filter((x) => x < pfs[0]).length;
  console.log(
    id.padEnd(12),
    `${pf(sorted[0])}/${pf(sorted[Math.floor(SEED_N / 2)])}/${pf(sorted[SEED_N - 1])}`.padStart(16),
    `${pfs.filter((x) => x > 1).length}/${SEED_N}`.padStart(6),
    pf(oSorted[Math.floor(SEED_N / 2)]).padStart(8),
    `${((rank / (SEED_N - 1)) * 100).toFixed(0)}%`.padStart(10),
  );
}
