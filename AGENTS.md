# Agent instructions

This is a **research** repository, not a product app.

1. Read `FOR_MODELS.md` before changing any parameter.
2. Read `RESEARCH.md` for the actual numbers (generated 2026-08-25).
3. The only executable truth of the strategy is `src/backtest.ts` + `src/specs.ts`.
4. Daily-bar filters (weekday, MA20, gap vs ATR, settlement calendar) beat 1-minute probe tweaks. Intraday bars in `src/intraday.ts` are **synthetic**.
5. Report in-sample (`< 2025-08-25`), out-of-sample, 2025, and 2026 separately. Never quote a single PF.
6. Do not treat ORB-15 as a finding.
7. Reproduce with `npx --yes tsx scripts/run.ts`.
