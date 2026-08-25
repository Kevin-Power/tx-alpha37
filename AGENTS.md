# Agent instructions

This is a **research** repository, not a product app.

1. Read `FOR_MODELS.md` before changing any parameter.
2. Read `RESEARCH.md` for the actual numbers (generated 2026-08-25).
3. The only executable truth of the strategy is `src/backtest.ts` + `src/specs.ts`.
4. Daily-bar filters (weekday, MA20, gap vs ATR **size**, settlement calendar) beat 1-minute probe tweaks. Intraday bars in `src/intraday.ts` are **synthetic**. `gapSkip080` is A-layer; `gapDirection055` is A×C and was **not** adopted after H-06. `gapFilter` is a both-on alias.
5. Report in-sample (`< 2025-08-25`), out-of-sample, 2025, and 2026 separately. Never quote a single PF. H-06 also requires expectancy.
6. Do not treat ORB-15 as a finding. Do not add presets for H-06 skip080-only.
7. Reproduce with `npx --yes tsx scripts/run.ts` and `npx --yes tsx scripts/h06-gap.ts`.
8. Path-dependent KPIs must be reported as a distribution across `seedOffset` (>=20 seeds). Seed 0 is the historical canonical path and is known to flatter targetR=0 presets (RESEARCH.md section 10).
9. `^TWII` open prices are stale-price contaminated. Do not draw intraday-drift or gap conclusions from them; TX futures data is required (see DATA_SOURCES.md). This also caps the H-06 `gapSkip080` conclusion: gap strength is measured off a stale open until Q6 (TX daily) is done.
