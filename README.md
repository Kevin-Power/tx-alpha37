# TX ALPHA-37

台指期（TX / MTX / TMF）**開盤區間突破（TORB）當沖研究包**。

給人看、也給其他模型看。請先讀 [RESEARCH.md](./RESEARCH.md) 與 [FOR_MODELS.md](./FOR_MODELS.md)，不要只看獲利因子排序。

- 基準策略：**ALPHA-37**（開盤 37 分區間 + VWAP + 波動 + 缺口）——用來殺假故事，不是已確認 edge
- 結構37（再加「昨收在 20 日均之上」）：**不是升級**。H-04 沒加分，H-05／H-07 殺掉避震器與跨星期結構故事，H-08 殺掉空頭年加分
- 樣本：預設 FinMind **TX 近月日盤**（真開盤價）；加權 `^TWII` 仍可重現舊數字。交易窗 2024-08-26 → 2026-08-25（485 根）
- 樣本外切：`2025-08-25` 之後
- 契約預設：小台 MTX，本金 50 萬 TWD，單筆風險 1.2%
- 成本：期交稅 2/100,000（買賣各一次）+ 單邊手續費 50 + 每邊滑價 2 點

## 一句話結論

**假 edge 殺得差不多了，策略還沒成形。** H-04 之後缺口放假通過失敗、結構37 沒加分。H-05 殺掉「靠三個大虧月避震」；H-07 殺掉「MA20 是跨星期結構」；H-08 殺掉「空頭年加分」（2018 ΔPF −0.013、2022 −0.108，5/20 種子）。加權路徑上唯一種子穩健的結論仍是負結論：無濾網 TORB 扣完成本後沒有 edge。下表的正 PF 是 seed 0 加權數字，只能當上界。這不是投資建議。

## 數字（2026-08-25 重跑）

| 策略 | 筆數 | 勝率 | PF | 樣本外 PF | CAGR | 最大回撤 | 2025 | 2026 | Sharpe |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ALPHA-37 | 332 | 36.8% | 1.15 | 1.19 | 17% | 23% | −2% | +49% | 0.74 |
| 結構37 | 241 | 39.0% | 1.32 | 1.45 | 25% | 15% | +4% | +46% | 1.17 |
| 週四週五 | 120 | 40.8% | 1.38 | 1.55 | 15% | 9% | +12% | +22% | 1.00 |
| 只做週五 | 63 | 41.3% | 1.63 | 1.60 | 13% | 7% | +13% | +14% | 1.09 |
| 避開一二 | 191 | 39.3% | 1.24 | 1.25 | 16% | 15% | +15% | +26% | 0.89 |
| ALPHA-37X | 309 | 35.3% | 1.06 | 1.05 | 7% | 27% | −8% | +33% | 0.37 |
| TORB-37 無濾網 | 465 | 36.3% | 0.99 | 1.01 | −2% | 51% | −40% | +61% | 0.17 |
| ORB-15 | 330 | 54.5% | 1.58 | 2.09 | 43% | 11% | +51% | +32% | 2.55 |

**上表全部是 Yahoo 加權、seed 0 單一重建路徑的歷史數字，只能當上界。** TX 真開盤價的 seed 0 見 §5.8／`results/h04-tx.json`（ALPHA-37 n=271 PF 1.06）。`scripts/run.ts` 現在預設跑 TX，並同時輸出 20 條路徑的 PF 分布——引用數字時請引分布，不要引單點。

**ORB-15 看起來最好，請當假象。** 論文用真 1 分 K 選的是 37 分，不是 15 分。本倉的 1 分路徑是日線重建，且已證實結構性偏惠短探針＋固定停利（20/20 種子）。**2026-08-25 起有真實資料佐證**：期交所 30 日逐筆聚合的 29 個真實日上，重建器把 OR 寬度做窄約一半（中位 2.03×）、把 ORB-15 停利命中率從 48% 灌到 71%（§5.11、`data/tx-1min.json`）。

被推翻：跳過月結算週三、結算週週一（H-03）、外資水位、0.55 缺口順勢、ATR 擴張 2.0、≥ 0.8 ATR 放假當已確認法則（H-04）、結構37 避震器（H-05）、MA20 跨星期結構（H-07）、結構37 空頭年加分（H-08）。週五不採納（H-02）。沒有新預設。

已降級（2026-08-25 種子擾動攻擊輪）：ALPHA-37 濾網「救成勉強賺」→ 未證實；結構37 → 體制依賴（MA 單調性測試失敗）；週五 edge → 未證實（PF 1.63 是 60 條路徑最大值）。資料升級路線見 [DATA_SOURCES.md](./DATA_SOURCES.md)。

## 倉庫結構

```
RESEARCH.md          完整方法、結果、限制、文獻（§5.6 H-06，§5.7 H-11，§5.8 H-04，§5.9 H-05，§5.10 H-07，§5.15 H-08）
FOR_MODELS.md        給其他 LLM 的研究協議（必讀）
OPEN_QUESTIONS.md    下一步要驗的假設
src/                 可重跑的 TypeScript 引擎（預設 MARKETS.tx）
results/             2026-08-25 的 KPI dump
scripts/run.ts       重跑預設組合（TX）
scripts/h04-tx.ts    TX 真開盤價
scripts/h05-autopsy.ts 大虧月驗屍
scripts/h07-ma.ts    MA20 × weekday
scripts/h01-real1m.ts  30 日真 1 分 vs 重建
scripts/h01-probegrid.ts 探針網格診斷（不是 H-01 通過）
scripts/h02-friday.ts    週五（不採納）
scripts/h03-settle-mon.ts 結算週週一（殺掉）
scripts/h08-bear.ts      空頭年（殺掉；不改 SAMPLE_START）
scripts/h01-fetch.py   Linux 抓期交所 30 日 zip
```

## 重跑

```bash
npx --yes tsx scripts/run.ts
npx --yes tsx scripts/h06-gap.ts
npx --yes tsx scripts/h11-atr.ts
npx --yes tsx scripts/h04-tx.ts
npx --yes tsx scripts/h05-autopsy.ts
npx --yes tsx scripts/h07-ma.ts
npx --yes tsx scripts/h01-real1m.ts
npx --yes tsx scripts/h01-probegrid.ts
npx --yes tsx scripts/h02-friday.ts
npx --yes tsx scripts/h03-settle-mon.ts
npx --yes tsx scripts/h08-bear.ts
```

## 文獻

Tsai et al., *Assessing the Profitability of Timely Opening Range Breakout on Index Futures Markets*（台北科大團隊，樣本 2003–2013）。台指期年化約 20.28%，最適探針約 37 分鐘，亞洲市場探針長於美股。

## 這不是投資建議

真的下單前，用券商／期交所 **真實 1 分 K** 把同一套法則再跑一次。本倉已有滾動 30 日真 1 分（`data/tx-1min.json`），只夠校準重建器，不夠當 H-01 通過。日線預設是 TX 近月。

Repo: https://github.com/Kevin-Power/tx-alpha37
