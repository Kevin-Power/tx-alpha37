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

- 1 分 K 是日線 OHLC **重建**的，不是期交所逐筆。不准把探針改成 15 分或把 ORB-15 當發現。
- 只准用日線層（星期、20 日均、缺口 vs ATR、月結算日曆）提出可採納的升級。
- 任何新規格必須同時報：全樣本、樣本內（< 2025-08-25）、樣本外、2025、2026、分星期、多空分開。
- 無濾網 TORB 扣成本後 PF 0.99，已經死了。ALPHA-37 PF 1.15 是薄 edge。結構37（MA20）是目前最站得住的升級。跳過月結算、外資水位濾網已經被推翻。
- 2026 是大多頭（加權約 22,000 → 44,800）。2025 年 ALPHA-37 是打平的。不准把 2026 的 CAGR 講成可實盤年化。
- 這不是投資建議。用繁體中文回覆。先攻擊現有結論，再提下一個可證偽的假設。

現在請：用 RESEARCH.md 的數字做一份「什麼能信、什麼不能信」的審查，並從 OPEN_QUESTIONS.md 挑一個你認為最可能推翻現況的問題，給驗證步驟。不要先改預設參數。

---
