/**
 * H-02 / H-03 長樣本檢驗（全部 A 層，真實日 K，零重建）。
 * 資料：data/twii-chart-raw.json（Yahoo ^TWII 2000→今，scripts 外部下載）。
 *
 * H-02：非月結算週三存在正日內漂移（o→c）。
 * H-03：週四＋週五存在負日內漂移。
 * 預先登記的判準寫在 OPEN_QUESTIONS.md；本腳本只輸出數字。
 */
import { readFileSync } from "node:fs";
import { isSettlement } from "../src/calendar";

type Row = { d: string; o: number; h: number; l: number; c: number; dow: number };

const raw = JSON.parse(
  readFileSync(new URL("../data/twii-chart-raw.json", import.meta.url), "utf8"),
);
const res = raw.chart.result[0];
const ts: number[] = res.timestamp;
const q = res.indicators.quote[0];

const rows: Row[] = [];
let dropped = 0;
for (let i = 0; i < ts.length; i++) {
  const o = q.open[i];
  const h = q.high[i];
  const l = q.low[i];
  const c = q.close[i];
  if (o == null || h == null || l == null || c == null || o <= 0 || c <= 0) {
    dropped++;
    continue;
  }
  // 台股日盤時間戳 +8h 取 UTC 日期即為台北日期
  const dt = new Date((ts[i] + 8 * 3600) * 1000);
  const d = dt.toISOString().slice(0, 10);
  const dow = dt.getUTCDay();
  if (dow === 0 || dow === 6) continue; // 舊年代週六交易日排除，跟現制對齊
  rows.push({ d, o, h, l, c, dow });
}

console.log(`rows=${rows.length}  dropped(null)=${dropped}  ${rows[0]?.d} → ${rows[rows.length - 1]?.d}`);

// ---- 資料品質：開盤價是不是假的 ----
console.log("\n=== 資料品質檢查（o==c、o==h==l==c、|o-c|<0.01% 的比例，按年代） ===");
const ERAS: [string, string, string][] = [
  ["2000-2007", "2000-01-01", "2007-12-31"],
  ["2008-2012", "2008-01-01", "2012-12-31"],
  ["2013-2017", "2013-01-01", "2017-12-31"],
  ["2018-2019", "2018-01-01", "2019-12-31"],
  ["2020-2021", "2020-01-01", "2021-12-31"],
  ["2022", "2022-01-01", "2022-12-31"],
  ["2023", "2023-01-01", "2023-12-31"],
  ["2024", "2024-01-01", "2024-12-31"],
  ["2025", "2025-01-01", "2025-12-31"],
  ["2026", "2026-01-01", "2026-12-31"],
];
for (const [label, a, b] of ERAS) {
  const rs = rows.filter((r) => r.d >= a && r.d <= b);
  if (!rs.length) continue;
  const flatOc = rs.filter((r) => r.o === r.c).length;
  const allFlat = rs.filter((r) => r.o === r.c && r.o === r.h && r.o === r.l).length;
  const nearFlat = rs.filter((r) => Math.abs(r.o - r.c) / r.c < 0.0001).length;
  console.log(
    label.padEnd(10),
    `n=${String(rs.length).padStart(4)}  o==c=${((flatOc / rs.length) * 100).toFixed(1)}%  全平=${((allFlat / rs.length) * 100).toFixed(1)}%  |o-c|<1bp=${((nearFlat / rs.length) * 100).toFixed(1)}%`,
  );
}

// ---- 漂移統計 ----
function stats(rs: Row[]) {
  const rets = rs.map((r) => ((r.c - r.o) / r.o) * 10000); // bp
  const n = rets.length;
  if (!n) return { n: 0, mean: 0, t: 0, pos: 0 };
  const mean = rets.reduce((s, x) => s + x, 0) / n;
  const sd =
    n > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    mean,
    t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : 0,
    pos: rets.filter((x) => x > 0).length / n,
  };
}
const P = (label: string, rs: Row[]) => {
  const s = stats(rs);
  console.log(
    label.padEnd(24),
    `n=${String(s.n).padStart(4)} 平均=${s.mean.toFixed(1).padStart(6)}bp t=${s.t.toFixed(2).padStart(6)} 正率=${(s.pos * 100).toFixed(0)}%`,
  );
};

console.log("\n=== 各星期 o→c 漂移（bp），按年代 ===");
for (const [label, a, b] of ERAS) {
  const rs = rows.filter((r) => r.d >= a && r.d <= b);
  if (!rs.length) continue;
  console.log(`-- ${label} --`);
  for (const dow of [1, 2, 3, 4, 5]) {
    P(`  週${["一", "二", "三", "四", "五"][dow - 1]}`, rs.filter((r) => r.dow === dow));
  }
  P("  全部", rs);
}

console.log("\n=== H-02：非月結算週三，按年代 ===");
for (const [label, a, b] of ERAS) {
  const rs = rows.filter(
    (r) => r.d >= a && r.d <= b && r.dow === 3 && !isSettlement(r.d),
  );
  if (rs.length) P(label, rs);
}

console.log("\n=== H-03：週四＋週五合併，按年代 ===");
for (const [label, a, b] of ERAS) {
  const rs = rows.filter((r) => r.d >= a && r.d <= b && (r.dow === 4 || r.dow === 5));
  if (rs.length) P(label, rs);
}

console.log("\n=== 週選擇權年代切分（週選 2012-11-21 上市） ===");
P("週三 2001–2012-11", rows.filter((r) => r.dow === 3 && r.d >= "2001-01-01" && r.d < "2012-11-21" && !isSettlement(r.d)));
P("週三 2012-11–2024", rows.filter((r) => r.dow === 3 && r.d >= "2012-11-21" && r.d < "2025-01-01" && !isSettlement(r.d)));
P("週三 2025–今", rows.filter((r) => r.dow === 3 && r.d >= "2025-01-01" && !isSettlement(r.d)));
P("四五 2001–2012-11", rows.filter((r) => (r.dow === 4 || r.dow === 5) && r.d >= "2001-01-01" && r.d < "2012-11-21"));
P("四五 2012-11–2024", rows.filter((r) => (r.dow === 4 || r.dow === 5) && r.d >= "2012-11-21" && r.d < "2025-01-01"));
P("四五 2025–今", rows.filter((r) => (r.dow === 4 || r.dow === 5) && r.d >= "2025-01-01"));

console.log("\n=== 2025 拆半年（H-02 預先登記的殺掉檢查） ===");
P("週三非結算 2025H1", rows.filter((r) => r.dow === 3 && !isSettlement(r.d) && r.d >= "2025-01-01" && r.d < "2025-07-01"));
P("週三非結算 2025H2", rows.filter((r) => r.dow === 3 && !isSettlement(r.d) && r.d >= "2025-07-01" && r.d < "2026-01-01"));
P("週三非結算 2026H1", rows.filter((r) => r.dow === 3 && !isSettlement(r.d) && r.d >= "2026-01-01" && r.d < "2026-07-01"));
P("週三非結算 2026H2", rows.filter((r) => r.dow === 3 && !isSettlement(r.d) && r.d >= "2026-07-01"));
