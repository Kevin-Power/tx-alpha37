/**
 * Q6 / Q13：用 TX 期貨本體（真實成交開盤價）重驗 ^TWII 上的日內漂移結論。
 *
 * 近月連續化規則（預先登記）：
 * 1. 只用日盤（trading_session === "position"）、volume > 0。
 * 2. 排除價差合約（contract_date 含 "/"）與非 YYYYMM 格式。
 * 3. 每日近月 = 最小 contract_date（結算日當天即到期合約，交易至 13:30 收結算）。
 * 4. 缺口的昨收 = 「今日近月合約」在前一交易日的收盤（同合約，避免轉倉跳空）；
 *    若無（極罕見）退回前一日近月收盤並計數。
 * 5. o→c 為同日同合約，無轉倉問題。TX 日盤 08:45–13:45，與 TWII 的 09:00–13:30 口徑不同，直接比較時要記得。
 *
 * 產出 data/tx-daily.json 供後續引擎替換（Q6）。
 *
 * 原始 chunk 不進 repo（.gitignore）。重抓（FinMind 匿名 API，7 段）：
 *   https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=TX&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *   段界：2012/2014/2016/2018/2020/2022/2024 各兩年，存成 data/tx-chunk-1..7.json。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isSettlement, weekdayUtc } from "../src/calendar";

type RawRow = {
  date: string;
  contract_date: string;
  open: number;
  max: number;
  min: number;
  close: number;
  volume: number;
  trading_session: string;
};

type Day = {
  d: string;
  contract: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  prevSameC: number | null; // 同合約昨收
  dow: number;
};

const rows: RawRow[] = [];
for (let i = 1; i <= 7; i++) {
  const raw = JSON.parse(
    readFileSync(new URL(`../data/tx-chunk-${i}.json`, import.meta.url), "utf8"),
  );
  rows.push(...raw.data);
}

const isMonthly = (c: string) => /^\d{6}$/.test(c);
const byDateContract = new Map<string, RawRow>();
const byDate = new Map<string, RawRow[]>();
for (const r of rows) {
  if (r.trading_session !== "position" || !isMonthly(r.contract_date)) continue;
  if (!(r.open > 0 && r.close > 0 && r.volume > 0)) continue;
  byDateContract.set(`${r.date}|${r.contract_date}`, r);
  const list = byDate.get(r.date) ?? [];
  list.push(r);
  byDate.set(r.date, list);
}

const dates = [...byDate.keys()].sort();
const days: Day[] = [];
let fallbackCount = 0;
for (let i = 0; i < dates.length; i++) {
  const d = dates[i];
  const list = byDate.get(d)!;
  list.sort((a, b) => a.contract_date.localeCompare(b.contract_date));
  const front = list[0];
  let prevSameC: number | null = null;
  if (i > 0) {
    const prevRow = byDateContract.get(`${dates[i - 1]}|${front.contract_date}`);
    if (prevRow) prevSameC = prevRow.close;
    else {
      const prevList = byDate.get(dates[i - 1])!;
      prevList.sort((a, b) => a.contract_date.localeCompare(b.contract_date));
      prevSameC = prevList[0].close;
      fallbackCount++;
    }
  }
  days.push({
    d,
    contract: front.contract_date,
    o: front.open,
    h: front.max,
    l: front.min,
    c: front.close,
    v: front.volume,
    prevSameC,
    dow: weekdayUtc(d),
  });
}

writeFileSync(
  new URL("../data/tx-daily.json", import.meta.url),
  JSON.stringify({ symbol: "TX front (day session)", source: "FinMind TaiwanFuturesDaily", built: "2026-08-25", days }, null, 1),
);
console.log(
  `TX front days=${days.length}  ${days[0]?.d} → ${days[days.length - 1]?.d}  同合約昨收 fallback=${fallbackCount}`,
);

// ---------- 統計工具 ----------
function stats(xs: number[]) {
  const n = xs.length;
  if (!n) return { n: 0, mean: 0, t: 0, pos: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : 0, pos: xs.filter((x) => x > 0).length / n };
}
const ocBp = (x: Day) => ((x.c - x.o) / x.o) * 10000;
const gapBp = (x: Day) => (x.prevSameC ? ((x.o - x.prevSameC) / x.prevSameC) * 10000 : 0);
const P = (label: string, rs: Day[]) => {
  const s = stats(rs.map(ocBp));
  console.log(
    label.padEnd(24),
    `n=${String(s.n).padStart(4)} 平均=${s.mean.toFixed(1).padStart(6)}bp t=${s.t.toFixed(2).padStart(6)} 正率=${(s.pos * 100).toFixed(0)}%`,
  );
};

const ERAS: [string, string, string][] = [
  ["2012-2017", "2012-01-01", "2017-12-31"],
  ["2018-2019", "2018-01-01", "2019-12-31"],
  ["2020-2021", "2020-01-01", "2021-12-31"],
  ["2022", "2022-01-01", "2022-12-31"],
  ["2023", "2023-01-01", "2023-12-31"],
  ["2024", "2024-01-01", "2024-12-31"],
  ["2025", "2025-01-01", "2025-12-31"],
  ["2026", "2026-01-01", "2026-12-31"],
];

console.log("\n=== TX 各星期 o→c 漂移（bp），按年代（真實成交開盤價） ===");
for (const [label, a, b] of ERAS) {
  const rs = days.filter((x) => x.d >= a && x.d <= b);
  if (!rs.length) continue;
  console.log(`-- ${label} --`);
  for (const dow of [1, 2, 3, 4, 5]) {
    P(`  週${["一", "二", "三", "四", "五"][dow - 1]}`, rs.filter((x) => x.dow === dow));
  }
}

console.log("\n=== TX 非結算週三，按年代（H-02 判決） ===");
for (const [label, a, b] of ERAS) {
  const rs = days.filter((x) => x.d >= a && x.d <= b && x.dow === 3 && !isSettlement(x.d));
  if (rs.length) P(label, rs);
}

console.log("\n=== TX 缺口方向條件表（假象檢定：TWII 上 ±20–40bp 的缺口繼承若在 TX 消失＝假象確認） ===");
for (const era of [["2018-01-01", "2026-12-31", "2018–今"], ["2025-01-01", "2026-12-31", "2025–今"]] as const) {
  const [a, b, label] = era;
  const rs = days.filter((x) => x.d >= a && x.d <= b && x.prevSameC);
  console.log(`-- ${label} --`);
  console.log("星期  n    缺口均bp   o→c均bp   o→c(缺口<0)   o→c(缺口>0)");
  for (const dow of [1, 2, 3, 4, 5]) {
    const g = rs.filter((x) => x.dow === dow);
    const dn = g.filter((x) => gapBp(x) < 0).map(ocBp);
    const up = g.filter((x) => gapBp(x) >= 0).map(ocBp);
    const m = (xs: number[]) => (xs.length ? xs.reduce((s, y) => s + y, 0) / xs.length : 0);
    console.log(
      `週${["一", "二", "三", "四", "五"][dow - 1]}  ${String(g.length).padStart(3)}`,
      `${m(g.map(gapBp)).toFixed(1).padStart(8)}`,
      `${m(g.map(ocBp)).toFixed(1).padStart(8)}`,
      `${m(dn).toFixed(1).padStart(8)}(n=${dn.length})`,
      `${m(up).toFixed(1).padStart(8)}(n=${up.length})`,
    );
  }
}

console.log("\n=== TX 非結算週三、缺口向下（最乾淨子樣本） ===");
for (const era of [["2018-01-01", "2021-12-31", "2018–2021"], ["2022-01-01", "2024-12-31", "2022–2024"], ["2025-01-01", "2026-12-31", "2025–今"]] as const) {
  const [a, b, label] = era;
  const g = days.filter((x) => x.d >= a && x.d <= b && x.dow === 3 && !isSettlement(x.d) && x.prevSameC && gapBp(x) < 0);
  const s = stats(g.map(ocBp));
  console.log(label.padEnd(12), `n=${s.n} 平均=${s.mean.toFixed(1)}bp t=${s.t.toFixed(2)} 正率=${(s.pos * 100).toFixed(0)}%`);
}

console.log("\n=== TX 週四＋週五合併，按年代（H-03 判決） ===");
for (const [label, a, b] of ERAS) {
  const rs = days.filter((x) => x.d >= a && x.d <= b && (x.dow === 4 || x.dow === 5));
  if (rs.length) P(label, rs);
}

console.log("\n=== TX 隔夜 vs 日內分解（本倉樣本 2024-08-26 起，對照 TWII 的 78%/22%） ===");
const sample = days.filter((x) => x.d >= "2024-08-26" && x.prevSameC);
let ovn = 0;
let intra = 0;
for (const x of sample) {
  ovn += x.o - (x.prevSameC as number);
  intra += x.c - x.o;
}
console.log(`n=${sample.length}  隔夜合計=${ovn.toFixed(0)}點  日內合計=${intra.toFixed(0)}點  隔夜佔比=${((ovn / (ovn + intra)) * 100).toFixed(0)}%`);

console.log("\n=== 缺口濾網分類差異（2024-08-26 起，|gap|/ATR20 ≥ 0.8 的放假日：TX vs TWII 會不會選到不同天） ===");
// 用 TX 自身的 ATR20 與 TWII 版本各自分類，看重疊率
import twii from "../src/twii-daily.json";
const twiiBars = (twii as { bars: { d: string; o: number; h: number; l: number; c: number }[] }).bars;
function atr20(rows: { h: number; l: number; c: number }[]): number[] {
  const out = new Array<number>(rows.length).fill(0);
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    const prev = i === 0 ? rows[0].c : rows[i - 1].c;
    const tr = Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - prev), Math.abs(rows[i].l - prev));
    if (i < 20) { acc += tr; out[i] = acc / (i + 1); }
    else out[i] = (out[i - 1] * 19 + tr) / 20;
  }
  return out;
}
const txAtr = atr20(days);
const txSkip = new Set<string>();
for (let i = 1; i < days.length; i++) {
  const x = days[i];
  if (x.d < "2024-08-26" || !x.prevSameC) continue;
  if (Math.abs(x.o - x.prevSameC) / txAtr[i - 1] >= 0.8) txSkip.add(x.d);
}
const twiiAtr = atr20(twiiBars);
const twiiSkip = new Set<string>();
for (let i = 1; i < twiiBars.length; i++) {
  const b = twiiBars[i];
  if (Math.abs(b.o - twiiBars[i - 1].c) / twiiAtr[i - 1] >= 0.8) twiiSkip.add(b.d);
}
const both = [...txSkip].filter((d) => twiiSkip.has(d)).length;
console.log(`TX 放假日=${txSkip.size}  TWII 放假日=${twiiSkip.size}  交集=${both}`);
console.log(`只有 TX 放假: ${[...txSkip].filter((d) => !twiiSkip.has(d)).join(", ")}`);
console.log(`只有 TWII 放假: ${[...twiiSkip].filter((d) => !txSkip.has(d)).join(", ")}`);
