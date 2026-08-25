# Agent instructions

This is a **research** repository, not a product app.

1. Read `FOR_MODELS.md` before changing any parameter.
2. Read `RESEARCH.md` for the actual numbers (generated 2026-08-25).
3. The only executable truth of the strategy is `src/backtest.ts` + `src/specs.ts`.
4. Daily-bar filters (weekday, MA20, gap vs ATR **size**, settlement calendar, ATR20/ATR60) beat 1-minute probe tweaks. Intraday bars in `src/intraday.ts` are **synthetic**. Default market is TX front (`MARKETS.tx`); `MARKETS.twii` is only for reproducing H-06/H-11 committed numbers. `gapSkip080` passed on TWII then **failed its pass rule on TX (H-04)** — do not retune 0.8. `gapDirection055` was not adopted. `atrExpandSkip` was killed at locked K=2.0. `gapFilter` is a both-on alias.
5. Report in-sample (`< 2025-08-25`), out-of-sample, 2025, and 2026 separately. Never quote a single PF. H-06 also requires expectancy. Do not write "thin edge found".
6. Do not treat ORB-15 as a finding. Do not add presets for H-06 skip080-only, H-11 atrExpand, or H-04 TX. Do not retune `ATR_EXPAND_K`.
7. Reproduce with `npx --yes tsx scripts/run.ts`, `scripts/h06-gap.ts` (TWII), `scripts/h11-atr.ts` (TWII), and `scripts/h04-tx.ts`.
8. Path-dependent KPIs must be reported as a distribution across `seedOffset` (>=20 seeds). Seed 0 is the historical canonical path and is known to flatter targetR=0 presets (RESEARCH.md section 10). H-11 is A-layer ATR ratio, seed-independent.
9. `^TWII` open prices are stale-price contaminated. Do not draw intraday-drift or gap conclusions from them. Default daily bars are TX front (`MARKETS.tx`). H-04 already re-ran H-06 on real TX opens: pass rule failed. Do not retune 0.8.
