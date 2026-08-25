/** 種子擾動加大到 60 條，確認 seed0（repo 原始路徑）的百分位。 */
import { evaluateDayTrade } from "../src/backtest";
import { atrSeries, MARKET } from "../src/market";
import { OOS_SPLIT, weekdayUtc } from "../src/calendar";
import { DEFAULT_PARAMS, PRESETS, SESSION } from "../src/specs";
import { hashDate, mulberry32 } from "../src/rng";
import type { DailyBar, LabParams, MinuteBar, Trade } from "../src/types";

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function buildIntradaySeed(day: DailyBar, prevClose: number, seedOffset: number): MinuteBar[] {
  const n = SESSION.dayMinutes;
  const rng = mulberry32(((hashDate(day.d) ^ 0x51ed) + Math.imul(seedOffset, 0x9e3779b9)) >>> 0);
  const { o, h, l, c } = day;
  const range = Math.max(8, h - l);
  const upDay = c >= o;
  const classic = rng() < 0.57;
  let tH: number;
  let tL: number;
  const first = 10 + Math.floor(rng() * 110);
  const second = clamp(first + 25 + Math.floor(rng() * 150), first + 20, n - 4);
  if (classic && upDay) { tL = first; tH = second; }
  else if (classic && !upDay) { tH = first; tL = second; }
  else if (rng() < 0.5) { tH = first; tL = second; }
  else { tL = first; tH = second; }
  tH = clamp(Math.round(tH), 3, n - 3);
  tL = clamp(Math.round(tL), 3, n - 3);
  if (tH === tL) tL = clamp(tL + 23, 3, n - 3);
  type Wp = { t: number; p: number };
  const wps: Wp[] = [{ t: 0, p: o }];
  const gap = o - prevClose;
  wps.push({ t: 14, p: clamp(o + gap * 0.12 + (rng() - 0.5) * range * 0.08, l, h) });
  const mid = 70 + Math.floor(rng() * 80);
  wps.push({ t: mid, p: clamp(lerp(o, c, 0.35 + rng() * 0.3) + (rng() - 0.5) * range * 0.2, l, h) });
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
  px[0] = o; px[n - 1] = c; px[tH] = h; px[tL] = l;
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
  px[tH] = h; px[tL] = l;
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

const bars = MARKET.bars;
const atr = atrSeries(bars, 20);
function runTrades(params: LabParams, seedOffset: number): Trade[] {
  const recentOr: number[] = [];
  const out: Trade[] = [];
  for (let i = 1; i < bars.length; i++) {
    const minutes = seedOffset === 0 ? undefined : buildIntradaySeed(bars[i], bars[i - 1].c, seedOffset);
    const ev = evaluateDayTrade(bars[i], bars[i - 1].c, atr[i], recentOr, params, minutes);
    recentOr.push(ev.orWidth);
    if (recentOr.length > 20) recentOr.shift();
    if (ev.trade) out.push(ev.trade);
  }
  return out;
}
function pfOf(ts: Trade[]) {
  const gw = ts.filter((t) => t.pnlTwd > 0).reduce((s, t) => s + t.pnlTwd, 0);
  const gl = Math.abs(ts.filter((t) => t.pnlTwd <= 0).reduce((s, t) => s + t.pnlTwd, 0));
  return gl > 0 ? gw / gl : gw > 0 ? 9 : 0;
}

const N = 60;
const p = (over: Partial<LabParams>): LabParams => ({ ...DEFAULT_PARAMS, ...over });
for (const [id, params] of [
  ["alpha37", p(PRESETS.alpha37.params)],
  ["struct37", p(PRESETS.struct37.params)],
  ["friday", p(PRESETS.friday.params)],
] as [string, LabParams][]) {
  const pfs: number[] = [];
  for (let s = 0; s < N; s++) pfs.push(pfOf(runTrades(params, s)));
  const seed0 = pfs[0];
  const sorted = [...pfs].sort((a, b) => a - b);
  const rank = sorted.filter((x) => x < seed0).length;
  console.log(
    id.padEnd(9),
    `seed0 PF=${seed0.toFixed(2)} 在 ${N} 條路徑中的百分位=${((rank / (N - 1)) * 100).toFixed(0)}%`,
    `中位數=${sorted[Math.floor(N / 2)].toFixed(2)}`,
    `>1 比例=${pfs.filter((x) => x > 1).length}/${N}`,
  );
}
