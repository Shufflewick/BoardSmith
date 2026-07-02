---
phase: 129
slug: migration-games-merc
status: finalized
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-02
---

# Phase 129 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest per repo (each game's own suite; MERC's own suite) |
| **Config file** | per-repo (bare `vitest` default config; no dedicated vitest.config.ts in games/MERC) |
| **Quick run command** | `cd <repo> && npx vitest run` (MERC: `npx vitest --run`) |
| **Full suite command** | all 8 game suites + MERC suite + per-repo `npx tsc --noEmit` |
| **Estimated runtime** | <2s per game, ~31s MERC (~10 min total across repos) |

---

## Sampling Rate

- **After each repo's migration:** that repo's `npx vitest run` + `npx tsc --noEmit`
- **After any BoardSmith src/ fix (none expected):** BoardSmith full `npm test`
- **Before phase close:** all repos green + repo-wide grep sweep zero hits + simulate smoke (hex/checkers)
- **Max feedback latency:** 300 seconds (cross-repo)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 129-01 | 1 | MIG-03 | T-129-01, T-129-02 | hex stone carries useFLIP-recognized anchor (no dev throw) | integration + static | `cd ~/BoardSmithGames/hex && npx vitest run && npx tsc --noEmit` | existing suite; new vite-env.d.ts | ⬜ pending |
| 01-T2 | 129-01 | 1 | MIG-03 | T-129-01 | type-only tsc fixes, no behavior change | integration + static | `cd ~/BoardSmithGames/checkers && npx vitest run && npx tsc --noEmit` | existing suite | ⬜ pending |
| 01-T3 | 129-01 | 1 | MIG-03 | T-129-01 | ChoiceBoardRefs.refs type fix + scoped grep sweep | integration + static + grep | `cd ~/BoardSmithGames/polyhedral-potions && npx vitest run && npx tsc --noEmit` (+ demo-complex-ui, demo-action-panel) | existing suites | ⬜ pending |
| 02-T1 | 129-02 | 1 | MIG-03 | T-129-SC | package legitimacy gate (jsdom, @vue/test-utils) before install | checkpoint:human-verify (blocking-human) | npmjs.com verification | N/A | ⬜ pending |
| 02-T2 | 129-02 | 1 | MIG-03 | T-129-03 | opponent-seat DOM render has no hidden-card identity; positive control fails on injected leak | integration (jsdom) + static | `cd ~/BoardSmithGames/go-fish && npx vitest run && npx tsc --noEmit` | ❌ new: tests/no-hidden-info-dom-leak.test.ts, tests/visibility.test.ts | ⬜ pending |
| 02-T3 | 129-02 | 1 | MIG-03 | T-129-04 | hand visible to owner/hidden from opponent, crib hidden from both; animation trace records from/to | integration | `cd ~/BoardSmithGames/cribbage && npx vitest run && npx tsc --noEmit` (+ demo-animation) | ❌ new: cribbage/tests/visibility.test.ts, demo-animation/tests/animation-trace.test.ts | ⬜ pending |
| 03-T1 | 129-03 | 2 | MIG-04 | T-129-05 | re-vendor packs post-Wave-1; suite green confirms correct version | integration | `cd ~/Dropbox/MERC/BoardSmith/MERC && npx vitest --run` | existing suite | ⬜ pending |
| 03-T2 | 129-03 | 2 | MIG-03, MIG-04 | T-129-06 | phase-wide grep sweep zero hits (MERC local playUntilComplete exempt) + simulate smoke | static (grep) + integration (simulate) | repo-wide grep sweep across 9 repos + `boardsmith simulate` hex/checkers | read-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Positive control (security test):** 02-T2's DOM-leak test MUST contain an assertion that fails when a forbidden marker (opponent card identity) is injected — a green suite without a proven-failing positive control is rejected (T-129-03).

Baseline (pre-migration, from RESEARCH): checkers 38 ✅, cribbage 20 ✅, go-fish 78 ✅, hex 19 ✅, polyhedral-potions 24 ✅, demo-animation 8 ✅, demo-complex-ui 4 ✅, demo-action-panel (no suite), MERC 738/7 ✅ (v4.3 vendored). tsc red in 5/8 games (pre-existing debt, in scope).

---

## Wave 0 Requirements

- go-fish: add `jsdom@^29.1.1` + `@vue/test-utils@^2.4.11` devDeps (approved in CONTEXT amendment; gated by 02-T1 blocking-human legitimacy checkpoint), versions matching BoardSmith's package.json
- demo-animation: add `@vue/test-utils@^2.4.11` (+ `jsdom@^29.1.1` if not present) ONLY if its trace test mounts a component — same gate
- No other new deps anywhere

---

## Manual-Only Verifications

None — no visual behavior changed; per-repo suites + grep sweep + simulate smoke are the gates. (02-T1 is a package-legitimacy human checkpoint, not a manual verification of behavior.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity
- [x] Wave 0 covers all MISSING references (3 new flagship test files + devDeps)
- [x] No watch-mode flags
- [x] Feedback latency documented
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** finalized 2026-07-02
