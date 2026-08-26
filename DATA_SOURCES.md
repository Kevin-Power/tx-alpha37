# 真實資料採購清單

目標：終結 C 層。兩個里程碑——(1) TX 期貨日線取代 ^TWII（Q6），(2) 真實 1 分 K 取代重建路徑（Q1、Q2、Q8、Q12）。
調查日期：2026-08-25。

## 里程碑 1：TX 日線 ✅ 已完成（2026-08-25）

FinMind `TaiwanFuturesDaily` 匿名 API 抓完 2012-01-02 → 2026-08-25（`data/tx-chunk-*.json` 原始檔、
`data/tx-daily.json` 近月連續序列）。連續化規則預先登記在 `scripts/tx-drift.ts` 開頭：日盤、排除價差合約、
近月＝最小 contract_date 有量者、缺口用同合約昨收（fallback 次數 0）。

判決見 RESEARCH.md 10.5：週三漂移＝假象（殺）、日盤淨漂移為負（隔夜 109%）、缺口濾網 TX vs TWII 錯位 89/37 天。
**H-04 已完成：** `src/market.ts` 並列 `MARKETS.twii`／`MARKETS.tx`，預設 TX。H-06 通過條件失敗，結構37 沒加分。見 RESEARCH.md §5.8、`results/h04-tx.json`。**H-08 已完成：** 同一份 2012 起 TX 日線、`tradeFrom=2012-01-02` 克隆（不改 `SAMPLE_START`），空頭年 2018／2022 加分殺掉。見 RESEARCH.md §5.15、`results/h08-bear.json`。

| 來源 | 內容 | 起始 | 費用 | 備註 |
| --- | --- | --- | --- | --- |
| 期交所「期貨每日交易行情下載」 | TX 各月份契約日 OHLC＋結算價＋量＋OI | 1998 | 免費 | 年度 zip，備援用 |
| FinMind `taiwan_futures_daily` | 同上，已整理成 API | 1998-07 | 免費（匿名可用） | **已採用**，見上 |

## 里程碑 2：真實 1 分 K（部分解鎖，2026-08-25 晚間）

2026-08-25 探針（`scripts/h01-probe.ts`）：FinMind `TaiwanFuturesTick` 匿名 400、`TaiwanFuturesMinute` 422——這兩條仍然成立。
但「期交所 30 日 zip 直鏈回 HTML 表單頁」是**路徑錯誤**：探針試的 `Dailydownload/Fusa/` 是表單頁，正確直鏈是

```
https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_YYYY_MM_DD.zip
```

匿名可下載（PK zip、每日約 2MB、全商品逐筆、日盤＋夜盤，夜盤掛實際成交日曆日）。
已抓 30 個交易日並聚合成 `data/tx-1min.json`（`scripts/fetch-taifex-30d.ps1` 或 `python3 scripts/h01-fetch.py`，
再 `npx --yes tsx scripts/h01-real1m.ts`；四價與 FinMind 日線全對齊）。第一批對照結論見 RESEARCH.md §5.11。
探針網格診斷（仍不是 H-01 通過）：`npx --yes tsx scripts/h01-probegrid.ts`。
**每日（至少每兩週）跑一次 fetch 腳本**，30 天窗滾動消失，累積一年就有約 250 天真 1 分 K。
歷史回補（2024-08 起）仍需 FinMind sponsor。正版 H-01 通過／殺掉等真實窗覆蓋 2024-08-26 起才准判。

## 里程碑 2 來源表：真實 1 分 K

| 來源 | 內容 | 起始 | 費用 | 評估 |
| --- | --- | --- | --- | --- |
| 期交所「前 30 個交易日每筆成交資料」 | 每筆成交 CSV（不含鉅額） | 滾動 30 日 | 免費 | **已接通**（`scripts/fetch-taifex-30d.ps1` 或 `python3 scripts/h01-fetch.py`），每日抓存累積 |
| FinMind `TaiwanFuturesTick` | 期貨逐筆成交 | 2011-01-03 | 贊助會員（sponsor，約數百元/月） | 性價比最高的歷史回補；一次一天，寫個迴圈抓 2024-08 起即可覆蓋本倉樣本 |
| 期交所 E-Data Shop「期貨成交檔」 | 官方逐筆，含更多欄位 | 1998-07-21 | NT$10,000／月份資料 | 本倉樣本 24 個月 ≈ NT$24 萬，除非要發論文否則不值 |
| 永豐 Shioaji API | kbars 歷史分 K | 約近幾年 | 免費（需開戶） | 有帳戶就順手，但歷史深度不保證覆蓋 2024-08 |

建議路徑：**FinMind sponsor 抓 2024-08→今的 TX tick，自建 1 分 K（08:45–13:45）**，同時排程每日抓期交所免費 30 日檔備援。
tick→1 分 K 的聚合規則（含 VWAP 用成交量加權）寫成獨立腳本並附驗證（對照期交所日行情的 H/L/量）。

## 真 1 分 K 到手後的複製清單（預先登記，FOR_MODELS 第 5 節第 3 項）

1. 欄位：時間（精確到分）、O/H/L/C、量、累積 VWAP（量加權，非 typical price 近似）。
2. 出場優先順序：同一根 K 內停損與停利都觸到 → 先停損（與 `simulateExit` 對齊）；停損以觸價（H/L）判定，不是收盤。
3. 進場：突破以「1 分 K 收盤價」越過區間界線，與 `evaluateDayTrade` 對齊；09:37 前不進場、13:10 後不進場。
4. 要重跑的全部規格：presets 全表 × `probeMin ∈ {15,30,37,45,60}`，同一成本模型。
5. 報告格式照 FOR_MODELS 第 2 節；真實路徑只有一條，不需種子擾動，但要報 bootstrap 信賴區間（逐日重抽）。
6. 對照組：同日期範圍的重建路徑結果放旁邊，量化重建器偏誤的方向與大小——這本身就是一篇附錄。

## 注意

- 期交所資料「單人單機、不得散布」——tick 原始檔不能 push 到公開倉，只能 push 聚合後的分 K 或統計。
- FinMind 免費層的 `TaiwanFuturesDaily` 沒有限制，日線可以直接進倉。
