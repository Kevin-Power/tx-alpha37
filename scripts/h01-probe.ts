import { writeFileSync } from "node:fs";

/**
 * H-01 資料探針。匿名層沒有真 1 分 K 之前，不准重跑 probeMin。
 * 本腳本只記錄「現在拿得到什麼」，不產出可採納結論。
 */
const generatedAt = "2026-08-25";

const probes = [
  {
    source: "FinMind TaiwanFuturesTick",
    url: "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesTick&data_id=TX&start_date=2026-08-25",
    result: "HTTP 400（匿名）。與 DATA_SOURCES.md 一致：tick 要贊助會員。",
  },
  {
    source: "FinMind TaiwanFuturesMinute",
    url: "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesMinute&data_id=TX&start_date=2026-08-25",
    result: "HTTP 422。匿名層沒有分 K。",
  },
  {
    source: "FinMind TaiwanFuturesDaily",
    url: "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesDaily&data_id=TX&start_date=2026-08-25",
    result: "HTTP 200。日線仍可用（H-04 已採用）。",
  },
  {
    source: "期交所 前30個交易日每筆成交 zip 直鏈",
    url: "https://www.taifex.com.tw/file/taifex/Dailydownload/Fusa/Fusa_YYYYMMDD.zip",
    result: "直鏈回 HTML 表單頁，不是 zip。需要瀏覽器表單（單人單機、不得散布）。本沙盒沒有互動式登入／驗證碼。",
  },
];

const out = {
  generatedAt,
  experiment: "H-01-probe",
  blocked: true,
  reason:
    "沒有 2024-08 起的 TX 真 1 分 K。匿名 FinMind tick 被拒；期交所 30 日檔要表單下載且原始 tick 不能進公開倉。",
  next: [
    "FinMind sponsor token 抓 2024-08→今 TX tick，本地聚合成 08:45–13:45 1 分 K（VWAP 用成交量加權）。",
    "聚合後的分 K 才能進倉；原始 tick 不能 push。",
    "真 1 分到手後才准重跑 probeMin ∈ {15,30,37,45,60}。在那之前 DEFAULT_PARAMS.probeMin 維持 37。",
  ],
  probes,
};

writeFileSync(new URL("../results/h01-block.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(out.reason);
for (const p of probes) console.log("-", p.source, "→", p.result);
