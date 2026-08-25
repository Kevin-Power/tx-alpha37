import { runLab } from "./backtest";
import { PRESETS } from "./specs";
import type { BacktestResult, LabParams } from "./types";

export type RankedStrategy = {
  id: string;
  label: string;
  hint: string;
  result: BacktestResult;
};

/** 依研究順序排列，不用 PF 排序——1 分重建會把 ORB-15 這種假象排到最前面。 */
export function rankStrategies(base: LabParams): RankedStrategy[] {
  return Object.entries(PRESETS).map(([id, p]) => ({
    id,
    label: p.label,
    hint: p.hint,
    result: runLab({ ...base, ...p.params }),
  }));
}
