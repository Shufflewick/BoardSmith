---
phase: 169
slug: post-fix-game-de-workaround-sweep
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-21
---

# Phase 169 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (each game repo) |
| **Per-repo run** | `cd <game-repo> && npx vitest run` |
| **Library baseline** | `npm run test` in this repo (~3137) — must stay green (no library edits expected) |

## Sampling Rate
- Per repo: run `npx vitest run` in that repo BEFORE any removal (record the green baseline) and AFTER each removal (must stay green; a red suite reverts the removal).
- Crosswalk/gating: each removal cites the verified-present library fix.

## Validation Architecture (Nyquist — gated cross-repo sweep, PROC-01/SC-5)

The unit of validation is: **(fix verified present in symlinked boardsmith) AND (game suite green after removal)**. There is no new test to author beyond the games' existing suites; the discipline is the gate.

- **Crosswalk + fix-verification (foundation):** a `Dxx ↔ BUG-n` crosswalk built from each repo's `BOARDSMITH-BUGS.md`/`REQUESTS.md`, paired with a grep-verified "this library fix is present" checklist (e.g. server undo executor honoring `hasNonUndoableAction` for D1; function-valued multiSelect enumeration for D9; SPACE-* APIs for D22-26; `unbounded` valve for D29). A removal whose fix is NOT verified present is a BLOCKER (skip + record) — this is the PROC-01/SC-5 gate.
- **Per-repo (×5):** capture the green `vitest run` baseline; apply only conservative, fix-verified removals + stale-comment refreshes on a `sweep/v4.8-dework` branch; re-run `vitest run` — must stay green. Any regression reverts that removal.
- **BSR-12 AI:** re-verify each repo's `src/rules/ai.ts` builds + its AI tests pass against AI-01/AI-02 (redacted-view MCTS + dynamic multiSelect); close BSR-12 if green, keep-open+note otherwise. (doom-machine has no AI — N/A.)
- **BS-10:** reclassification is a ledger/doc change (game-side art-path already handled); verified by inspection, no re-fix.
- **Ledger reconciliation:** each removed workaround's entry updated in the repo's own `BOARDSMITH-BUGS.md`/`REQUESTS.md` (SKILLAUTO-08 discipline — audit the paperwork, not just the code).

**Sampling justification:** The games' existing suites are the oracle; the phase adds gating discipline, not new tests. Green-before/green-after per repo + fix-present verification per removal is exact coverage for "no regression traded for cleanliness" and "no removal without a verified fix."
