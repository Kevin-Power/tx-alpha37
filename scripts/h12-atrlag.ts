/**
 * H-12（預先登記草案）：缺口濾網分母的資訊集 bug。
 *
 * 現況：runBacktest 傳 market.ATR20[i]（Wilder，含當日 TR）給 evaluateDayTrade，
 * 缺口放假（≥0.8）與缺口方向（>0.55）在 09:00 決策時用了收盤才知道的分母。
 * 方向：大跳空日當日 TR 大 → atr[i] 被灌大 → gapStrength 縮小 → 暴力日反而少放假（反保守）。
 * 幅度上限：單日佔 1/20，極端日 atr[i] ≈ atr[i-1]×1.05，只有邊界日會翻。
 *
 * 本腳本不改引擎，只用 evaluateDayTrade 的 atr 參數注入 atr[i-1] 對照。
 * 通過（採納修正）標準：這是資訊集修正不是調參——只要數字重算後方向結論不變就直接換 atr[i-1]，
 * 若結論有變（例如 H-06 判定翻轉），兩個版本都要報。
 */
import { evaluateDayTrade } from "../src/backtest";
import { MARKETS } from "../src/market";
import { OOS_SPLIT } from "../src/calendar";
import { DEFAULT_PARAMS, PRESETS } from "../src/specs";
import type { LabParams, Trade } from "../src/types";

function kpi(ts: Trade[]) {
  const w = ts.filter((t) => t.pnlTwd > 0);
  const l = ts.filter((t) => t.pnlTwd <= 0);
  const gw = w.reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(l.reduce((s, t) => s + t.pnlTwd, 0));
  return {
    n: ts.length,
    pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
    pnl: ts.reduce((s, t) => s + t.pnlTwd, 0),
  };
}

function run(params: LabParams, lag: boolean, marketId: "tx" | "twii") {
  const m = MARKETS[marketId];
  const bars = m.bars;
  const recentOr: number[] = [];
  const trades: Trade[] = [];
  const skipDates: string[] = [];
  for (let i = m.startIdx; i < bars.length; i++) {
    const atr = lag ? m.ATR20[i - 1] : m.ATR20[i];
    const ev = evaluateDayTrade(bars[i], bars[i - 1].c, atr, recentOr, params, undefined, m);
    recentOr.push(ev.orWidth);
    if (recentOr.length > 20) recentOr.shift();
    if (ev.trade) trades.push(ev.trade);
    if (ev.skipped === "缺口過大（跳過）") skipDates.push(bars[i].d);
  }
  return { trades, skipDates };
}

const F = (x: number) => x.toFixed(3);
const K = (x: number) => `${(x / 1000).toFixed(0)}k`;

for (const marketId of ["tx", "twii"] as const) {
  console.log(`\n=== ${marketId.toUpperCase()}（seed 0，alpha37） ===`);
  const params = { ...DEFAULT_PARAMS, ...PRESETS.alpha37.params };
  const now = run(params, false, marketId);
  const lag = run(params, true, marketId);
  for (const [label, r] of [["atr[i]（現行）", now], ["atr[i-1]（修正）", lag]] as const) {
    const all = kpi(r.trades);
    const is_ = kpi(r.trades.filter((t) => t.date < OOS_SPLIT));
    const oos = kpi(r.trades.filter((t) => t.date >= OOS_SPLIT));
    const y25 = kpi(r.trades.filter((t) => t.date.startsWith("2025")));
    const y26 = kpi(r.trades.filter((t) => t.date.startsWith("2026")));
    console.log(
      label.padEnd(16),
      `n=${all.n} PF=${F(all.pf)} pnl=${K(all.pnl)}`,
      `| IS=${F(is_.pf)} OOS=${F(oos.pf)} | 2025=${F(y25.pf)} 2026=${F(y26.pf)} | 放假日=${r.skipDates.length}`,
    );
  }
  const nowSet = new Set(now.skipDates);
  const lagSet = new Set(lag.skipDates);
  const onlyLag = [...lagSet].filter((d) => !nowSet.has(d));
  const onlyNow = [...nowSet].filter((d) => !lagSet.has(d));
  console.log(`翻面的日子：修正後多放假 ${onlyLag.length} 天 [${onlyLag.join(", ")}]，少放假 ${onlyNow.length} 天 [${onlyNow.join(", ")}]`);
}
