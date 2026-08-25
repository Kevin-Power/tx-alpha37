/**
 * H-01 第一刀：期交所前 30 個交易日「每筆成交」直鏈其實可用
 * （https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_YYYY_MM_DD.zip，
 * h01-block.json 裡試的 Fusa/ 路徑才是表單頁）。
 *
 * 流程：
 * 1. data/taifex-30d/tx_*.csv（本地、.gitignore）＝逐筆過濾出 TX 的瘦檔。
 * 2. 只取日盤 08:45–13:45、合約 = data/tx-daily.json 當日近月，聚合成 300 根 1 分 K。
 * 3. 聚合分 K 寫進 data/tx-1min.json（原始 tick 不進倉，聚合可以）。
 * 4. 同一天、同一組 recentOr／ATR 輸入，跑 evaluateDayTrade 兩次：
 *    真實分 K vs seed0 重建路徑，輸出交易級對照。
 *
 * 這不是回測（n≈29 沒有 PF 可言），是重建器的第一次現實校準：
 * OR 寬度偏差、進場觸發一致率、ORB-15 停利命中率是否被重建器高估。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateDayTrade } from "../src/backtest";
import { buildIntraday, openingRange } from "../src/intraday";
import { MARKETS } from "../src/market";
import { DEFAULT_PARAMS, PRESETS, SESSION, minuteToClock } from "../src/specs";
import type { LabParams, MinuteBar } from "../src/types";
import txDailyFile from "../data/tx-daily.json";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, "data", "taifex-30d");
const OUT = path.join(ROOT, "data", "tx-1min.json");

const contractByDate = new Map<string, string>(
  (txDailyFile as { days: Array<{ d: string; contract: string }> }).days.map(
    (x) => [x.d, x.contract],
  ),
);

function parseDay(file: string, dateTag: string): MinuteBar[] | null {
  const iso = `${dateTag.slice(0, 4)}-${dateTag.slice(4, 6)}-${dateTag.slice(6, 8)}`;
  const contract = contractByDate.get(iso);
  if (!contract) return null;
  const text = fs.readFileSync(file, "latin1");
  type Acc = { o: number; h: number; l: number; c: number; pv: number; v: number };
  const acc = new Map<number, Acc>();
  for (const line of text.split("\n")) {
    const f = line.split(",");
    if (f.length < 6) continue;
    if (f[0] !== dateTag) continue; // 夜盤掛前一日曆日，直接排除
    if (f[2].trim() !== contract) continue;
    const t = f[3].padStart(6, "0");
    if (t < "084500" || t > "134500") continue;
    const minute = Math.min(
      299,
      parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2, 4), 10) - 525,
    );
    const px = parseFloat(f[4]);
    const qty = parseInt(f[5], 10) / 2;
    if (!Number.isFinite(px) || minute < 0) continue;
    const a = acc.get(minute);
    if (!a) {
      acc.set(minute, { o: px, h: px, l: px, c: px, pv: px * qty, v: qty });
    } else {
      a.h = Math.max(a.h, px);
      a.l = Math.min(a.l, px);
      a.c = px;
      a.pv += px * qty;
      a.v += qty;
    }
  }
  if (acc.size < 200) return null;
  const bars: MinuteBar[] = [];
  let cumPv = 0;
  let cumV = 0;
  let prevC = acc.get(0)?.o ?? 0;
  for (let i = 0; i < SESSION.dayMinutes; i++) {
    const a = acc.get(i);
    if (a) {
      cumPv += a.pv;
      cumV += a.v;
      bars.push({ i, o: a.o, h: a.h, l: a.l, c: a.c, v: a.v, vwap: cumPv / cumV });
      prevC = a.c;
    } else {
      bars.push({ i, o: prevC, h: prevC, l: prevC, c: prevC, v: 0, vwap: cumV > 0 ? cumPv / cumV : prevC });
    }
  }
  return bars;
}

// ---- 聚合並落地 ----
const realDays: Array<{ d: string; contract: string; bars: MinuteBar[] }> = [];
for (const f of fs.readdirSync(DIR).filter((x) => /^tx_\d{4}_\d{2}_\d{2}\.csv$/.test(x)).sort()) {
  const dateTag = f.slice(3, 13).replace(/_/g, "");
  const iso = `${dateTag.slice(0, 4)}-${dateTag.slice(4, 6)}-${dateTag.slice(6, 8)}`;
  const bars = parseDay(path.join(DIR, f), dateTag);
  if (bars) realDays.push({ d: iso, contract: contractByDate.get(iso)!, bars });
}
fs.writeFileSync(
  OUT,
  JSON.stringify({
    source: "TAIFEX Dailydownload 每筆成交（免費 30 日窗），日盤 08:45–13:45，近月同 tx-daily.json",
    built: new Date().toISOString().slice(0, 10),
    note: "聚合 1 分 K；原始 tick 不進倉。量 = B+S/2（口）。缺分鐘以前收補平、v=0。",
    days: realDays,
  }),
);
console.log(`真實 1 分 K：${realDays.length} 天（${realDays[0]?.d} → ${realDays[realDays.length - 1]?.d}）→ data/tx-1min.json`);

// ---- 與日線層對帳 ----
const m = MARKETS.tx;
console.log("\n聚合 OHLC vs FinMind 日線（差 = tick聚合 − 日線）");
for (const rd of realDays) {
  const idx = m.indexByDate.get(rd.d);
  if (idx == null) continue;
  const b = m.bars[idx];
  const o = rd.bars[0].o;
  const h = Math.max(...rd.bars.map((x) => x.h));
  const l = Math.min(...rd.bars.map((x) => x.l));
  const c = rd.bars[rd.bars.length - 1].c;
  const diffs = [o - b.o, h - b.h, l - b.l, c - b.c];
  if (diffs.some((x) => Math.abs(x) > 0.5))
    console.log(`  ${rd.d} Δo=${diffs[0]} Δh=${diffs[1]} Δl=${diffs[2]} Δc=${diffs[3]}`);
}
console.log("（沒列出的天＝四價全對齊）");

// ---- 真實 vs 重建：同輸入雙跑 ----
type DayCmp = {
  d: string;
  orReal: number;
  orSynth: number;
  real: { fired: boolean; side?: string; entryMin?: number; exit?: string; pnl?: number };
  synth: { fired: boolean; side?: string; entryMin?: number; exit?: string; pnl?: number };
};

function compare(presetId: string): DayCmp[] {
  const params: LabParams = { ...DEFAULT_PARAMS, ...PRESETS[presetId].params };
  // 雙軌 recentOr：重建路徑用重建寬度、真實路徑用真實寬度當波動基準，
  // 否則真實 OR（中位數約為重建的 2 倍）會被重建基準整批誤判成「波動過高」。
  // 真實軌在第一個真實日之前先用重建寬度暖機（別無他源），窗內逐步被真實寬度替換。
  const recentS: number[] = [];
  const recentR: number[] = [];
  const out: DayCmp[] = [];
  const realByDate = new Map(realDays.map((x) => [x.d, x.bars]));
  for (let i = m.startIdx; i < m.bars.length; i++) {
    const day = m.bars[i];
    const atr = m.ATR20[i];
    const evS = evaluateDayTrade(day, m.bars[i - 1].c, atr, recentS, params, undefined, m);
    const realBars = realByDate.get(day.d);
    let orR = evS.orWidth;
    if (realBars) {
      const evR = evaluateDayTrade(day, m.bars[i - 1].c, atr, recentR, params, realBars, m);
      orR = evR.orWidth;
      out.push({
        d: day.d,
        orReal: evR.orWidth,
        orSynth: evS.orWidth,
        real: evR.trade
          ? { fired: true, side: evR.trade.side, entryMin: evR.trade.entryMin, exit: evR.trade.reason, pnl: evR.trade.pnlTwd }
          : { fired: false, exit: evR.skipped ?? "未突破" },
        synth: evS.trade
          ? { fired: true, side: evS.trade.side, entryMin: evS.trade.entryMin, exit: evS.trade.reason, pnl: evS.trade.pnlTwd }
          : { fired: false, exit: evS.skipped ?? "未突破" },
      });
    }
    recentS.push(evS.orWidth);
    if (recentS.length > 20) recentS.shift();
    recentR.push(orR);
    if (recentR.length > 20) recentR.shift();
  }
  return out;
}

// ---- OR 寬度偏差是不是 seed0 特例？對 20 條重建路徑的中位數再量一次 ----
{
  const ratios: number[] = [];
  for (const rd of realDays) {
    const idx = m.indexByDate.get(rd.d);
    if (idx == null || idx < 1) continue;
    const day = m.bars[idx];
    const prevC = m.bars[idx - 1].c;
    const realOr = openingRange(rd.bars, 37);
    const widths: number[] = [];
    for (let s = 0; s < 20; s++) {
      const or = openingRange(buildIntraday(day, prevC, s), 37);
      widths.push(or.high - or.low);
    }
    widths.sort((a, b) => a - b);
    ratios.push((realOr.high - realOr.low) / widths[10]);
  }
  ratios.sort((a, b) => a - b);
  const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))].toFixed(2);
  console.log(
    `\nOR37 寬度 real ÷ 重建20種子中位數：p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)}（n=${ratios.length}，>1 的天數=${ratios.filter((x) => x > 1).length}）`,
  );
}

for (const presetId of ["alpha37", "torb15"]) {
  const rows = compare(presetId);
  console.log(`\n=== ${PRESETS[presetId].label}（n=${rows.length} 天，真實 vs seed0 重建） ===`);
  const ratios = rows.map((r) => r.orReal / r.orSynth).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  console.log(
    `OR 寬度 real/synth：min=${ratios[0].toFixed(2)} med=${med.toFixed(2)} max=${ratios[ratios.length - 1].toFixed(2)}`,
  );
  let both = 0, onlyR = 0, onlyS = 0, neither = 0, sideAgree = 0;
  let pnlR = 0, pnlS = 0;
  for (const r of rows) {
    if (r.real.fired && r.synth.fired) { both++; if (r.real.side === r.synth.side) sideAgree++; }
    else if (r.real.fired) onlyR++;
    else if (r.synth.fired) onlyS++;
    else neither++;
    pnlR += r.real.pnl ?? 0;
    pnlS += r.synth.pnl ?? 0;
  }
  console.log(`觸發：both=${both}（方向同=${sideAgree}） 只真實=${onlyR} 只重建=${onlyS} 都沒=${neither}`);
  console.log(`30 日損益：真實=${pnlR.toFixed(0)} 重建=${pnlS.toFixed(0)}`);
  const exits = (rowsKey: "real" | "synth") => {
    const c: Record<string, number> = {};
    for (const r of rows) if (r[rowsKey].fired) c[r[rowsKey].exit!] = (c[r[rowsKey].exit!] ?? 0) + 1;
    return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");
  };
  console.log(`出場（真實）：${exits("real")}`);
  console.log(`出場（重建）：${exits("synth")}`);
  console.log("逐日：");
  for (const r of rows) {
    const fmt = (x: DayCmp["real"]) =>
      x.fired
        ? `${x.side === "long" ? "多" : "空"}@${minuteToClock(x.entryMin!)} ${x.exit} ${x.pnl! >= 0 ? "+" : ""}${x.pnl!.toFixed(0)}`
        : `— ${x.exit}`;
    console.log(
      `  ${r.d} OR ${r.orReal.toFixed(0)}/${r.orSynth.toFixed(0)}  真實[${fmt(r.real)}]  重建[${fmt(r.synth)}]`,
    );
  }
}
