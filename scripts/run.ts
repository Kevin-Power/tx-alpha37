import { runLab } from "../src/backtest.ts";
import { dailySlices } from "../src/research.ts";
import { MARKET } from "../src/market.ts";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs.ts";
import { OOS_SPLIT } from "../src/calendar.ts";

function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}

function pf(x: number) {
  return x.toFixed(3);
}

console.log(
  `TWII ${MARKET.asOf}  bars=${MARKET.bars.length}  ${MARKET.bars[0]?.d} → ${MARKET.bars[MARKET.bars.length - 1]?.d}  OOS≥${OOS_SPLIT}`,
);
console.log("");
console.log(
  "id".padEnd(12),
  "n".padStart(4),
  "WR".padStart(7),
  "PF".padStart(6),
  "OOSn".padStart(5),
  "OOSPF".padStart(6),
  "CAGR".padStart(7),
  "MDD".padStart(7),
  "2025".padStart(8),
  "2026".padStart(8),
  "Sharpe".padStart(7),
);

for (const [id, p] of Object.entries(PRESETS)) {
  const k = runLab({ ...DEFAULT_PARAMS, ...p.params }).kpis;
  console.log(
    id.padEnd(12),
    String(k.trades).padStart(4),
    pct(k.winRate).padStart(7),
    pf(k.profitFactor).padStart(6),
    String(k.oosN).padStart(5),
    pf(k.oosPf).padStart(6),
    pct(k.cagr).padStart(7),
    pct(k.maxDdPct).padStart(7),
    pct(k.y2025).padStart(8),
    pct(k.y2026).padStart(8),
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
