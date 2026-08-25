/** 週三漂移深挖 + 隔夜/日內分解（全部 A 層，真實日 K）。 */
import { MARKETS } from "../src/market";
const MARKET = MARKETS.twii;
import { isSettlement, weekdayUtc, OOS_SPLIT } from "../src/calendar";
import type { DailyBar } from "../src/types";

const bars = MARKET.bars;

function stats(rows: DailyBar[]) {
  const rets = rows.map((b) => b.c - b.o);
  const nPos = rets.filter((x) => x > 0).length;
  const mean = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const sd =
    rets.length > 1
      ? Math.sqrt(
          rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1),
        )
      : 0;
  return {
    n: rets.length,
    mean,
    sd,
    t: rets.length > 1 ? (mean / (sd / Math.sqrt(rets.length))) : 0,
    pos: rets.length ? nPos / rets.length : 0,
  };
}
const S = (label: string, rows: DailyBar[]) => {
  const r = stats(rows);
  console.log(
    label.padEnd(26),
    `n=${String(r.n).padStart(3)} 平均=${r.mean.toFixed(1).padStart(7)}點 t=${r.t.toFixed(2).padStart(5)} 正率=${(r.pos * 100).toFixed(0)}%`,
  );
};

console.log("=== 週三 o→c 漂移拆解（真實日 K） ===");
const wed = bars.filter((b) => weekdayUtc(b.d) === 3);
S("週三全部", wed);
S("週三-月結算日", wed.filter((b) => isSettlement(b.d)));
S("週三-非月結算", wed.filter((b) => !isSettlement(b.d)));
for (const y of ["2024", "2025", "2026"]) {
  S(`週三 ${y}`, wed.filter((b) => b.d.startsWith(y)));
  S(`週三 ${y} 非結算`, wed.filter((b) => b.d.startsWith(y) && !isSettlement(b.d)));
}
S("週三 IS", wed.filter((b) => b.d < OOS_SPLIT));
S("週三 OOS", wed.filter((b) => b.d >= OOS_SPLIT));

console.log("\n=== 每年全部交易日 o→c（beta 對照） ===");
for (const y of ["2024", "2025", "2026"]) {
  S(`全日 ${y}`, bars.filter((b) => b.d.startsWith(y)));
}
S("全日 全樣本", bars);

console.log("\n=== 指數漲幅分解：隔夜缺口 vs 日內 ===");
let ovn = 0;
let intra = 0;
for (let i = 1; i < bars.length; i++) {
  ovn += bars[i].o - bars[i - 1].c;
  intra += bars[i].c - bars[i].o;
}
console.log(`總漲點=${(bars[bars.length - 1].c - bars[0].c).toFixed(0)}  隔夜合計=${ovn.toFixed(0)}  日內合計=${intra.toFixed(0)}`);

console.log("\n=== 各星期日內合計（點）by 年 ===");
for (const dow of [1, 2, 3, 4, 5]) {
  const rows = bars.filter((b) => weekdayUtc(b.d) === dow);
  const line = ["2024", "2025", "2026"]
    .map((y) => {
      const r = rows.filter((b) => b.d.startsWith(y));
      const sum = r.reduce((s, b) => s + (b.c - b.o), 0);
      return `${y}:${sum.toFixed(0)}點(n=${r.length})`;
    })
    .join("  ");
  console.log(`週${["一", "二", "三", "四", "五"][dow - 1]}  ${line}`);
}
