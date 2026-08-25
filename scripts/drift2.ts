/**
 * H-02 假象排除：加權指數開盤含「未成交股用昨收」的機制，跳空會漏進 o→c。
 * 若週三的隔夜缺口分布跟其他天一樣，跨星期比較仍然成立。
 * 同時做：控制缺口方向後的週三漂移。
 */
import { readFileSync } from "node:fs";
import { isSettlement } from "../src/calendar";

type Row = { d: string; o: number; c: number; dow: number; gapBp: number; ocBp: number };

const raw = JSON.parse(
  readFileSync(new URL("../data/twii-chart-raw.json", import.meta.url), "utf8"),
);
const res = raw.chart.result[0];
const ts: number[] = res.timestamp;
const q = res.indicators.quote[0];

const rows: Row[] = [];
let prevC: number | null = null;
for (let i = 0; i < ts.length; i++) {
  const o = q.open[i];
  const c = q.close[i];
  if (o == null || c == null || o <= 0 || c <= 0) continue;
  const dt = new Date((ts[i] + 8 * 3600) * 1000);
  const dow = dt.getUTCDay();
  const d = dt.toISOString().slice(0, 10);
  if (dow >= 1 && dow <= 5 && prevC != null) {
    rows.push({
      d,
      o,
      c,
      dow,
      gapBp: ((o - prevC) / prevC) * 10000,
      ocBp: ((c - o) / o) * 10000,
    });
  }
  prevC = c;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function tstat(xs: number[]) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : 0;
}

for (const era of [
  ["2018-01-01", "2026-12-31", "2018–今"],
  ["2022-01-01", "2022-12-31", "2022 空頭年"],
  ["2025-01-01", "2026-12-31", "2025–今"],
] as const) {
  const [a, b, label] = era;
  const rs = rows.filter((r) => r.d >= a && r.d <= b);
  console.log(`\n=== ${label} ===`);
  console.log("星期  n    缺口均值bp  o→c均值bp  o→c(缺口<0日) o→c(缺口>0日)");
  for (const dow of [1, 2, 3, 4, 5]) {
    const g = rs.filter((r) => r.dow === dow);
    const dn = g.filter((r) => r.gapBp < 0).map((r) => r.ocBp);
    const up = g.filter((r) => r.gapBp >= 0).map((r) => r.ocBp);
    console.log(
      `週${["一", "二", "三", "四", "五"][dow - 1]}  ${String(g.length).padStart(3)}`,
      `${mean(g.map((r) => r.gapBp)).toFixed(1).padStart(9)}`,
      `${mean(g.map((r) => r.ocBp)).toFixed(1).padStart(9)}`,
      `${mean(dn).toFixed(1).padStart(9)}(n=${dn.length})`,
      `${mean(up).toFixed(1).padStart(9)}(n=${up.length})`,
    );
  }
}

console.log("\n=== 非結算週三：缺口向下日（開盤假象反向，最乾淨的子樣本） ===");
for (const era of [
  ["2018-01-01", "2021-12-31", "2018–2021"],
  ["2022-01-01", "2024-12-31", "2022–2024"],
  ["2025-01-01", "2026-12-31", "2025–今"],
] as const) {
  const [a, b, label] = era;
  const g = rows.filter(
    (r) => r.d >= a && r.d <= b && r.dow === 3 && !isSettlement(r.d) && r.gapBp < 0,
  );
  const xs = g.map((r) => r.ocBp);
  console.log(
    label.padEnd(12),
    `n=${xs.length} 平均=${mean(xs).toFixed(1)}bp t=${tstat(xs).toFixed(2)} 正率=${((xs.filter((x) => x > 0).length / Math.max(1, xs.length)) * 100).toFixed(0)}%`,
  );
}
