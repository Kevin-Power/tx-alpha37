# 貼給其他模型的開場白

把下面整段連同 repo 網址貼給 Claude / GPT / Gemini / 其他 Grok。

---

你要跟我一起研究台指期當沖策略，不是幫我「調參賺錢」。

公開研究倉：https://github.com/Kevin-Power/tx-alpha37

請先完整讀這四個檔，再發言：

1. https://github.com/Kevin-Power/tx-alpha37/blob/main/FOR_MODELS.md
2. https://github.com/Kevin-Power/tx-alpha37/blob/main/RESEARCH.md
3. https://github.com/Kevin-Power/tx-alpha37/blob/main/OPEN_QUESTIONS.md
4. https://github.com/Kevin-Power/tx-alpha37/blob/main/src/backtest.ts

硬限制（違反就重來）：

- 1 分 K 主要仍是日線 OHLC **重建**的。已有滾動 30 日真 1 分（`data/tx-1min.json`），只夠校準重建器：OR 做窄一半、ORB-15 停利 PF 灌倍。不准把探針改成 15 分或把 ORB-15 當發現。H-01 通過要 2024-08 起。
- 只准用日線層（星期、20 日均、缺口 vs ATR、月結算日曆）提出可採納的升級。
- 任何新規格必須同時報：全樣本、樣本內（< 2025-08-25）、樣本外、2025、2026、分星期、多空分開。
- 無濾網 TORB 扣成本後 PF 0.99，已經死了——但不乾淨，停損 0.7 vs 0.55。**不要把 ALPHA-37 PF 1.15 寫成薄 edge。** 2025 PF 0.99 是否決票。OOS PF 1.19 把整段 2026 灌進樣本外。「週五拿走七成」是 seed 0 假象（H-02，3/20 種子佔比>50%）。結構37 不是升級（H-08 空頭年 ΔPF 都 ≤ 0）。結算週週一不該放假（H-03）。H-06／H-11／跳過月結算／外資水位已經被推翻。
- 2026 是大多頭（加權約 22,000 → 44,800）。2025 年 ALPHA-37 是打平的。不准把 2026 的 CAGR 講成可實盤年化。
- 這不是投資建議。用繁體中文回覆。先攻擊現有結論，再提下一個可證偽的假設。

現在請：用 RESEARCH.md 的數字做一份「什麼能信、什麼不能信」的審查。H-06、H-11、H-04、H-05、H-07、H-03、H-08 已跑完。H-02 不採納。不要重做缺口拆層，不要把 0.8 或 ATR 2.0 改掉再報一次，不要放假結算週週一，不要把結構37 寫成全能濾網。從 OPEN_QUESTIONS.md 挑你認為還能推翻現況的問題，給驗證步驟。不要先改預設參數。不要講「怎麼做比較賺」。

---
