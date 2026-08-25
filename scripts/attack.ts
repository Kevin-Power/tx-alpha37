/**
 * 本地攻擊腳本（不改 src、不進 repo 預設）。
 * A. 種子擾動：同樣真實日 OHLC，換 20 條重建路徑，看 PF 分布。
 * B. 純日線星期 open→close 漂移（週五 beta 檢查，100% A 層）。
 * C. 結構濾網 MA 長度敏感度（5/10/15/20/30/50）。
 * D. OOS 切點敏感度。
 * E. 結構37 增量驗屍：MA20 濾網到底刪掉了哪些月份的虧損。
 */
import { evaluateDayTrade } from "../src/backtest";
import { atrSeries, MARKET } from "../src/market";
import { OOS_SPLIT, weekdayUtc } from "../src/calendar";
import { DEFAULT_PARAMS, PRESETS, SESSION } from "../src/specs";
import { hashDate, mulberry32 } from "../src/rng";
import type {
  DailyBar,
  LabParams,
  MinuteBar,
  Trade,
} from "../src/types";

// ---------- buildIntraday 複本，只多一個 seedOffset ----------
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function buildIntradaySeed(
  day: DailyBar,
  prevClose: number,
  seedOffset: number,
): MinuteBar[] {
  const n = SESSION.dayMinutes;
  const rng = mulberry32(
    ((hashDate(day.d) ^ 0x51ed) + Math.imul(seedOffset, 0x9e3779b9)) >>> 0,
  );
  const { o, h, l, c } = day;
  const range = Math.max(8, h - l);
  const upDay = c >= o;
  const classic = rng() < 0.57;

  let tH: number;
  let tL: number;
  const first = 10 + Math.floor(rng() * 110);
  const second = clamp(first + 25 + Math.floor(rng() * 150), first + 20, n - 4);

  if (classic && upDay) {
    tL = first;
    tH = second;
  } else if (classic && !upDay) {
    tH = first;
    tL = second;
  } else if (rng() < 0.5) {
    tH = first;
    tL = second;
  } else {
    tL = first;
    tH = second;
  }

  tH = clamp(Math.round(tH), 3, n - 3);
  tL = clamp(Math.round(tL), 3, n - 3);
  if (tH === tL) tL = clamp(tL + 23, 3, n - 3);

  type Wp = { t: number; p: number };
  const wps: Wp[] = [{ t: 0, p: o }];
  const gap = o - prevClose;
  wps.push({
    t: 14,
    p: clamp(o + gap * 0.12 + (rng() - 0.5) * range * 0.08, l, h),
  });
  const mid = 70 + Math.floor(rng() * 80);
  wps.push({
    t: mid,
    p: clamp(lerp(o, c, 0.35 + rng() * 0.3) + (rng() - 0.5) * range * 0.2, l, h),
  });
  wps.push(tH < tL ? { t: tH, p: h } : { t: tL, p: l });
  wps.push(tH < tL ? { t: tL, p: l } : { t: tH, p: h });
  wps.push({ t: n - 1, p: c });
  wps.sort((a, b) => a.t - b.t);

  const px = new Array<number>(n).fill(o);
  for (let k = 0; k < wps.length - 1; k++) {
    const a = wps[k];
    const b = wps[k + 1];
    const span = Math.max(1, b.t - a.t);
    for (let t = a.t; t <= b.t; t++) {
      const u = (t - a.t) / span;
      const noise = (rng() - 0.5) * range * 0.09 * Math.sin(Math.PI * u);
      px[t] = clamp(lerp(a.p, b.p, smooth(u)) + noise, l, h);
    }
  }
  px[0] = o;
  px[n - 1] = c;
  px[tH] = h;
  px[tL] = l;

  if (h - o < range * 0.1) {
    for (let i = 1; i < 95; i++) {
      const toward = lerp(o, Math.min(c, o - range * 0.28), i / 95);
      px[i] = clamp(lerp(px[i], toward, 0.58), l, h);
    }
  } else if (o - l < range * 0.1) {
    for (let i = 1; i < 95; i++) {
      const toward = lerp(o, Math.max(c, o + range * 0.28), i / 95);
      px[i] = clamp(lerp(px[i], toward, 0.58), l, h);
    }
  }

  px[tH] = h;
  px[tL] = l;

  if (rng() < 0.38) {
    const poke = 50 + Math.floor(rng() * 55);
    const dir = rng() < 0.5 ? 1 : -1;
    const mag = range * (0.06 + rng() * 0.1);
    for (let t = poke; t < Math.min(n - 6, poke + 16); t++) {
      const u = (t - poke) / 16;
      px[t] = clamp(px[t] + mag * Math.sin(Math.PI * u) * dir, l, h);
    }
  }

  const bars: MinuteBar[] = [];
  let cumPv = 0;
  let cumV = 0;
  for (let i = 0; i < n; i++) {
    const close = px[i];
    const prev = i === 0 ? o : px[i - 1];
    const wick = range * (0.012 + rng() * 0.035);
    let hi = clamp(Math.max(prev, close) + wick * rng(), l, h);
    let lo = clamp(Math.min(prev, close) - wick * rng(), l, h);
    if (i === tH) hi = h;
    if (i === tL) lo = l;
    const uOpen = i < 40 ? 1.8 : i > 250 ? 1.5 : 0.7;
    const uMid = Math.cos((i / n) * Math.PI * 2);
    const vol = Math.max(8, (42 + rng() * 28) * (uOpen + 0.35 * (1 - uMid)));
    const typical = (hi + lo + close) / 3;
    cumPv += typical * vol;
    cumV += vol;
    bars.push({ i, o: prev, h: hi, l: lo, c: close, v: vol, vwap: cumPv / cumV });
  }
  bars[0].o = o;
  bars[n - 1].c = c;
  return bars;
}

// ---------- 迴圈（對齊 runBacktest 的 recentOr 邏輯） ----------
type Rec = { trade: Trade; i: number; aboveMaN: Map<number, boolean>; dow: number };

const bars = MARKET.bars;
const atr = atrSeries(bars, 20);

const MA_LENS = [5, 10, 15, 20, 30, 50];
const maSeries = new Map<number, number[]>();
for (const nLen of MA_LENS) {
  const out = new Array<number>(bars.length).fill(0);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    acc += bars[i].c;
    if (i >= nLen) acc -= bars[i - nLen].c;
    out[i] = acc / Math.min(i + 1, nLen);
  }
  maSeries.set(nLen, out);
}

function runWith(params: LabParams, seedOffset: number): Rec[] {
  const recentOr: number[] = [];
  const recs: Rec[] = [];
  for (let i = 1; i < bars.length; i++) {
    const day = bars[i];
    const prev = bars[i - 1];
    const minutes =
      seedOffset === 0 ? undefined : buildIntradaySeed(day, prev.c, seedOffset);
    const ev = evaluateDayTrade(day, prev.c, atr[i], recentOr, params, minutes);
    recentOr.push(ev.orWidth);
    if (recentOr.length > 20) recentOr.shift();
    if (ev.trade) {
      const aboveMaN = new Map<number, boolean>();
      for (const nLen of MA_LENS) {
        aboveMaN.set(nLen, prev.c >= (maSeries.get(nLen)![i - 1] ?? prev.c));
      }
      recs.push({ trade: ev.trade, i, aboveMaN, dow: weekdayUtc(day.d) });
    }
  }
  return recs;
}

function kpi(ts: Trade[]) {
  const wins = ts.filter((t) => t.pnlTwd > 0);
  const losses = ts.filter((t) => t.pnlTwd <= 0);
  const gw = wins.reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.pnlTwd, 0));
  const pnl = ts.reduce((s, t) => s + t.pnlTwd, 0);
  return {
    n: ts.length,
    wr: ts.length ? wins.length / ts.length : 0,
    pf: gl > 0 ? gw / gl : gw > 0 ? 9 : 0,
    pnl,
  };
}

function fullReport(ts: Trade[], split = OOS_SPLIT) {
  const all = kpi(ts);
  const is_ = kpi(ts.filter((t) => t.date < split));
  const oos = kpi(ts.filter((t) => t.date >= split));
  const y24 = kpi(ts.filter((t) => t.date.startsWith("2024")));
  const y25 = kpi(ts.filter((t) => t.date.startsWith("2025")));
  const y26 = kpi(ts.filter((t) => t.date.startsWith("2026")));
  return { all, is_, oos, y24, y25, y26 };
}

const F = (x: number) => x.toFixed(2);
const P = (x: number) => `${(x * 100).toFixed(0)}%`;
const K = (x: number) => `${(x / 1000).toFixed(0)}k`;

function printFull(label: string, ts: Trade[]) {
  const r = fullReport(ts);
  console.log(
    label.padEnd(22),
    `n=${String(r.all.n).padStart(3)} WR=${P(r.all.wr).padStart(4)} PF=${F(r.all.pf)} pnl=${K(r.all.pnl).padStart(6)}`,
    `| IS PF=${F(r.is_.pf)}(n=${r.is_.n}) OOS PF=${F(r.oos.pf)}(n=${r.oos.n})`,
    `| 2024 PF=${F(r.y24.pf)} ${K(r.y24.pnl)} | 2025 PF=${F(r.y25.pf)} ${K(r.y25.pnl)} | 2026 PF=${F(r.y26.pf)} ${K(r.y26.pnl)}`,
  );
}

const p = (over: Partial<LabParams>): LabParams => ({
  ...DEFAULT_PARAMS,
  ...over,
});

// ================= A. 種子擾動 =================
console.log("=== A. 種子擾動（20 條重建路徑；offset=0 為 repo 原始路徑） ===");
const SEEDS = Array.from({ length: 20 }, (_, k) => k);
const seedPresets: [string, LabParams][] = [
  ["alpha37", p(PRESETS.alpha37.params)],
  ["struct37", p(PRESETS.struct37.params)],
  ["friday", p(PRESETS.friday.params)],
  ["torb37", p(PRESETS.torb37.params)],
  ["torb15", p(PRESETS.torb15.params)],
];
for (const [id, params] of seedPresets) {
  const pfs: number[] = [];
  const oosPfs: number[] = [];
  const pnls: number[] = [];
  for (const s of SEEDS) {
    const recs = runWith(params, s);
    const r = fullReport(recs.map((x) => x.trade));
    pfs.push(r.all.pf);
    oosPfs.push(r.oos.pf);
    pnls.push(r.all.pnl);
  }
  const sorted = [...pfs].sort((a, b) => a - b);
  const oSorted = [...oosPfs].sort((a, b) => a - b);
  const med = sorted[10];
  const oMed = oSorted[10];
  const above1 = pfs.filter((x) => x > 1).length;
  const oAbove1 = oosPfs.filter((x) => x > 1).length;
  console.log(
    id.padEnd(10),
    `PF min/med/max = ${F(sorted[0])}/${F(med)}/${F(sorted[19])}  >1: ${above1}/20`,
    ` | OOS PF = ${F(oSorted[0])}/${F(oMed)}/${F(oSorted[19])}  >1: ${oAbove1}/20`,
    ` | pnl med=${K([...pnls].sort((a, b) => a - b)[10])}`,
  );
}

// struct37 相對 alpha37 的增量，是否在每個種子都成立
console.log("\n--- struct37 增量 vs alpha37（同種子逐一比） ---");
let incWins = 0;
const incDetail: string[] = [];
for (const s of SEEDS) {
  const a = fullReport(runWith(p(PRESETS.alpha37.params), s).map((x) => x.trade));
  const st = fullReport(runWith(p(PRESETS.struct37.params), s).map((x) => x.trade));
  const win = st.all.pf > a.all.pf;
  if (win) incWins++;
  incDetail.push(
    `seed${String(s).padStart(2)} alpha=${F(a.all.pf)} struct=${F(st.all.pf)} Δ=${F(st.all.pf - a.all.pf)} | OOS Δ=${F(st.oos.pf - a.oos.pf)} | struct2025=${K(st.y25.pnl)}`,
  );
}
console.log(incDetail.join("\n"));
console.log(`struct37 全樣本 PF 高於 alpha37 的種子數：${incWins}/20`);

// 週五 edge 是否跨種子
console.log("\n--- 週五切片（alpha37 交易 ∩ 週五）跨種子 ---");
for (const s of SEEDS) {
  const recs = runWith(p(PRESETS.alpha37.params), s);
  const fri = recs.filter((x) => x.dow === 5).map((x) => x.trade);
  const rest = recs.filter((x) => x.dow !== 5).map((x) => x.trade);
  const rf = fullReport(fri);
  const rr = kpi(rest);
  console.log(
    `seed${String(s).padStart(2)} 週五 n=${rf.all.n} PF=${F(rf.all.pf)} 2025PF=${F(rf.y25.pf)} 2026PF=${F(rf.y26.pf)} | 其餘四天 PF=${F(rr.pf)}`,
  );
}

// ================= B. 純日線星期漂移（A 層） =================
console.log("\n=== B. 純日線 open→close 漂移（真實日 K，無任何重建） ===");
function driftStats(rows: DailyBar[]) {
  const rets = rows.map((b) => b.c - b.o);
  const nPos = rets.filter((x) => x > 0).length;
  const mean = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const sum = rets.reduce((s, x) => s + x, 0);
  return { n: rets.length, mean, sum, posRate: rets.length ? nPos / rets.length : 0 };
}
for (const dow of [1, 2, 3, 4, 5]) {
  const rows = bars.filter((b) => weekdayUtc(b.d) === dow);
  const all = driftStats(rows);
  const y25 = driftStats(rows.filter((b) => b.d.startsWith("2025")));
  const y26 = driftStats(rows.filter((b) => b.d.startsWith("2026")));
  const oos = driftStats(rows.filter((b) => b.d >= OOS_SPLIT));
  console.log(
    `週${["一", "二", "三", "四", "五"][dow - 1]}`,
    `n=${all.n} 平均=${all.mean.toFixed(1)}點 正率=${P(all.posRate)} 合計=${all.sum.toFixed(0)}點`,
    `| 2025: ${y25.mean.toFixed(1)}點/${P(y25.posRate)} | 2026: ${y26.mean.toFixed(1)}點/${P(y26.posRate)} | OOS: ${oos.mean.toFixed(1)}點/${P(oos.posRate)}`,
  );
}

// 週五多空拆解（repo 原始路徑）
console.log("\n--- 週五交易多空拆解（seed=0 原始路徑） ---");
const base = runWith(p(PRESETS.alpha37.params), 0);
const friT = base.filter((x) => x.dow === 5);
printFull("週五全部", friT.map((x) => x.trade));
printFull("週五-多單", friT.filter((x) => x.trade.side === "long").map((x) => x.trade));
printFull("週五-空單", friT.filter((x) => x.trade.side === "short").map((x) => x.trade));

// ================= C. MA 長度敏感度 =================
console.log("\n=== C. 結構濾網 MA 長度敏感度（alpha37 交易 ∩ 昨收≥MA_n） ===");
printFull("alpha37 全部(對照)", base.map((x) => x.trade));
for (const nLen of MA_LENS) {
  const ts = base.filter((x) => x.aboveMaN.get(nLen)).map((x) => x.trade);
  printFull(`昨收≥MA${nLen}`, ts);
}
console.log("--- 反向：昨收<MA_n（被刪掉的那組） ---");
for (const nLen of MA_LENS) {
  const ts = base.filter((x) => !x.aboveMaN.get(nLen)).map((x) => x.trade);
  printFull(`昨收<MA${nLen}`, ts);
}

// ================= D. OOS 切點敏感度 =================
console.log("\n=== D. OOS 切點敏感度 ===");
const SPLITS = ["2025-05-01", "2025-08-25", "2025-11-01", "2026-02-01", "2026-05-01"];
const structT = base.filter((x) => x.aboveMaN.get(20)).map((x) => x.trade);
const friAll = friT.map((x) => x.trade);
for (const sp of SPLITS) {
  const a = kpi(base.map((x) => x.trade).filter((t) => t.date >= sp));
  const st = kpi(structT.filter((t) => t.date >= sp));
  const fr = kpi(friAll.filter((t) => t.date >= sp));
  console.log(
    `split=${sp}`,
    `alpha37 OOS PF=${F(a.pf)}(n=${a.n})`,
    `| struct37 OOS PF=${F(st.pf)}(n=${st.n})`,
    `| friday OOS PF=${F(fr.pf)}(n=${fr.n})`,
  );
}

// ================= E. 結構37 增量驗屍 =================
console.log("\n=== E. MA20 濾網刪掉的交易，按月分布（seed=0） ===");
const removed = base.filter((x) => !x.aboveMaN.get(20)).map((x) => x.trade);
const byMonth = new Map<string, { pnl: number; n: number }>();
for (const t of removed) {
  const mk = t.date.slice(0, 7);
  const cell = byMonth.get(mk) ?? { pnl: 0, n: 0 };
  cell.pnl += t.pnlTwd;
  cell.n += 1;
  byMonth.set(mk, cell);
}
const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [mk, cell] of months) {
  console.log(`${mk}  n=${String(cell.n).padStart(2)}  pnl=${K(cell.pnl).padStart(6)}`);
}
console.log(`刪掉合計：n=${removed.length} pnl=${K(removed.reduce((s, t) => s + t.pnlTwd, 0))}`);

// 三大虧月：結構37 有沒有避開
console.log("\n--- 三大虧月在 alpha37 vs struct37 ---");
for (const mk of ["2025-11", "2025-12", "2026-07"]) {
  const a = kpi(base.map((x) => x.trade).filter((t) => t.date.startsWith(mk)));
  const st = kpi(structT.filter((t) => t.date.startsWith(mk)));
  console.log(`${mk}  alpha37: n=${a.n} pnl=${K(a.pnl)} | struct37: n=${st.n} pnl=${K(st.pnl)}`);
}

// struct37 淨利有多少來自週五
console.log("\n--- struct37 的週五依賴 ---");
const structFri = base
  .filter((x) => x.aboveMaN.get(20) && x.dow === 5)
  .map((x) => x.trade);
const structNonFri = base
  .filter((x) => x.aboveMaN.get(20) && x.dow !== 5)
  .map((x) => x.trade);
printFull("struct37 全部", structT);
printFull("struct37 ∩ 週五", structFri);
printFull("struct37 非週五", structNonFri);
