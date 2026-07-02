---
phase: 126-structured-error-surfacing
plan: 02
subsystem: session
tags: [error-handling, persistence, GameSession, SnapshotSessionHost, circuit-breaker, TDD]

# Dependency graph
requires: []
provides:
  - "GameSession: onPersistenceError hook + lastPersistenceError getter + persistenceHealthy getter + #persistSafely wrapping every save site (create()'s initial save, #save()'s direct-action/tutorial/AI-turn funnel)"
  - "SnapshotSessionHost: symmetric onPersistenceError + lastPersistenceError + persistenceHealthy wrapping apply()'s persist?.() call"
  - "Pitfall 2 fixed: a storage failure during an AI turn no longer increments #aiConsecutiveFailures or logs a false '[AI] Giving up'"
affects: [126-04-scriptable-dev-host-record]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "#persistSafely never rethrows — resets a consecutive-failure counter on success, increments + sanitizes + hooks on failure, guards the hook invocation itself"
    - "PERSISTENCE_UNHEALTHY_THRESHOLD = 3 named constant mirrors the pre-existing #aiConsecutiveFailures >= 3 circuit-breaker shape"
    - "Duplicate-but-identical private helper across GameSession and SnapshotSessionHost (no shared host base class in this codebase) — same pattern as serializeFlowDebugInfo-as-shared-function elsewhere, but here the class itself has no common ancestor so the guard logic is duplicated intentionally"

key-files:
  created: []
  modified:
    - src/session/game-session.ts
    - src/session/game-session.test.ts
    - src/session/ai-circuit-breaker.test.ts
    - src/session/snapshot-session-host.ts
    - src/session/snapshot-session-host.test.ts

key-decisions:
  - "#save() itself is the single funnel that gets wrapped in #persistSafely (not each caller individually) — this automatically makes every existing caller safe, including PendingActionManager's `save: () => this.#save()` callback, which this plan's file scope did not touch directly"
  - "The AI-turn call to #save() inside #checkAITurn's callback stays physically inside the existing try/catch (not moved outside as the plan's action text suggested) because #persistSafely already guarantees #save() never throws — moving it would have been cosmetic, not functionally necessary, once the funnel itself is non-throwing"
  - "create()'s initial save and #save()'s internal save share the SAME persistenceConsecutiveFailures counter (not two independent counters) — a real storage outage should count consistently regardless of which code path triggered the save"
  - "SnapshotSessionHost duplicates the #persistSafely shape rather than sharing a base class with GameSession, per the plan's explicit instruction (no shared host base class exists in this codebase)"

requirements-completed: [ERR-03]

# Metrics
duration: ~55min
completed: 2026-07-02
---

# Phase 126 Plan 02: Structured Error Surfacing — Persistence Hook Summary

**Storage save failures on both session hosts are now observable via a shared `onPersistenceError(entry, consecutiveFailures, healthy)` hook + `lastPersistenceError` status + a `persistenceHealthy` circuit-breaker flag (flips false after 3 consecutive failures, recovers on the next success) — and a storage outage during an AI turn no longer gets misclassified as an AI failure (Pitfall 2).**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2/2 completed
- **Files modified:** 5 (2 implementation, 3 test)

## Accomplishments

- `GameSession` gained `onPersistenceError` (constructor option, also threaded through `restore()` for symmetry), `lastPersistenceError`, `persistenceHealthy`, and a private `#persistSafely` wrapper. `#save()` — the single existing funnel for direct actions, tutorial-progress saves, and the AI-turn save inside `#checkAITurn` — now routes its `storage.save()` call through `#persistSafely`, so it can never throw. `create()`'s previously fire-and-forget `.catch(console.error)` initial save is now routed through the same funnel.
- Fixed Pitfall 2: because `#save()` can no longer reject, a storage outage during an AI turn (previously caught by the AI's broad try/catch and counted against `#aiConsecutiveFailures`, eventually logging a misleading `"[AI] Giving up"`) is now correctly counted only against `#persistenceConsecutiveFailures` — proven by a new regression test using a fixture where the AI seat acts immediately.
- `SnapshotSessionHost` gained the symmetric surface: `onPersistenceError` on `SnapshotSessionAdapters`, plus `lastPersistenceError`/`persistenceHealthy` getters. `apply()`'s `persist?.()` call is wrapped in an equivalent (duplicated, not shared) `persistSafely` guard that is a no-op when no `persist` adapter is configured (today's dev-host default), so that path is unchanged.
- Both circuit breakers use a named `PERSISTENCE_UNHEALTHY_THRESHOLD = 3` constant, mirroring the AI breaker's `>= 3` give-up threshold.

## Task Commits

Each task followed RED (test) → GREEN (implementation), verified by literally reverting the implementation file and re-running the tests before restoring it and confirming green:

1. **Task 1: GameSession persistence hook + persistenceHealthy + #persistSafely + Pitfall 2 fix**
   - `563d84a` (test) — failing tests for the hook, threshold/recovery, sanitized message, guarded hook, and the Pitfall 2 regression
   - `fe79176` (feat) — implementation
2. **Task 2: SnapshotSessionHost symmetric persistence hook**
   - `cfdd999` (test) — failing tests for `apply()`'s persist wrapping
   - `55a0e30` (feat) — implementation

**Plan metadata:** (this commit) — docs: complete plan

## Files Created/Modified

- `src/session/game-session.ts` — Added `PERSISTENCE_UNHEALTHY_THRESHOLD` constant, `PersistenceErrorEntry` type, `onPersistenceError` on `GameSessionOptions` (threaded through the private constructor, `create()`, and `restore()`), `#onPersistenceError`/`#lastPersistenceError`/`#persistenceConsecutiveFailures` fields, `lastPersistenceError`/`persistenceHealthy` getters, and `#persistSafely()`. `#save()` now routes its `storage.save()` call through `#persistSafely`; `create()`'s initial save does too.
- `src/session/game-session.test.ts` — New `RepeatMoveGame` fixture (a looping no-op action so a single test can drive several consecutive saves) and a `GameSession persistence hook (ERR-03)` describe block: never-throws-on-failure, resets/keeps-healthy-on-success, 1-2-failures-stay-healthy/3rd-flips-false, recovers-on-next-success, sanitized-message, guarded-hook.
- `src/session/ai-circuit-breaker.test.ts` — New `AIActsFirstGame` fixture (flow requires player 2 — the AI seat — to act immediately, unlike the existing `SimpleGame` fixture whose flow never lets the AI act at all) and a regression test proving a rejecting storage save during the AI's turn does not log `"[AI] Giving up"` and does not block the AI's move from landing.
- `src/session/snapshot-session-host.ts` — Added `PERSISTENCE_UNHEALTHY_THRESHOLD`, `PersistenceErrorEntry`, `onPersistenceError` on `SnapshotSessionAdapters`, `lastPersistenceErrorEntry`/`persistenceConsecutiveFailures` fields, `lastPersistenceError`/`persistenceHealthy` getters, and a private `persistSafely()`. `apply()`'s `persist?.()` call is now guarded (only invoked, and only wrapped, when a `persist` adapter is configured).
- `src/session/snapshot-session-host.test.ts` — New `persistence error hook + persistenceHealthy` describe block: never-throws + hook-fires + sanitized message, absent-adapter-unchanged, success-resets-counter, threshold-flip-and-recovery.

## Decisions Made

See key-decisions in frontmatter. The most consequential one: wrapping `#save()`/`apply()`'s save call itself (rather than wrapping each individual caller) means every existing caller of that funnel — including `PendingActionManager`'s `save: () => this.#save()` callback, which this plan's file scope explicitly excludes — is automatically protected. This is more correct than the plan's literal "wrap 3 call sites" phrasing would have produced, and required no changes to `pending-action-manager.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug, caught before implementation was even touched] Off-by-one in the persistenceHealthy threshold test's counter accounting**
- **Found during:** Task 1, writing the "flips false on the 3rd" test
- **Issue:** The test initially let `create()`'s own initial (failing) save count toward the same `#persistenceConsecutiveFailures` counter as the 3 explicit `performAction()` calls under test, so the counter reached the threshold one call earlier than the test expected.
- **Fix:** Made the test's storage succeed during `create()` and only start failing after `create()`'s own save had resolved, so the 3 measured failures are exactly the ones being asserted on.
- **Files modified:** `src/session/game-session.test.ts`
- **Verification:** Confirmed via an isolated debug script proving `create()` and `#save()` share one counter (by design — see key-decisions), then fixed the test and re-ran green.
- **Committed in:** `563d84a` (test commit)

**2. [Rule 3 - Blocking test-timing issue] AI-turn regression test needed to account for AIController's built-in 300ms move delay**
- **Found during:** Task 1, writing the Pitfall 2 regression test
- **Issue:** The AI-acts-first fixture's flow never progressed within the test's initial 100ms wait, because `AIController.checkAndPlay` has a deliberate 300ms "let humans see the state change" delay before the bot plays (`ai-controller.ts`).
- **Fix:** Increased the test's wait to 500ms with a comment explaining why.
- **Files modified:** `src/session/ai-circuit-breaker.test.ts`
- **Verification:** Test passes reliably; re-ran the file 2x to confirm no flakiness.
- **Committed in:** `563d84a` (test commit)

## Verification Results

- `npx vitest run src/session/game-session.test.ts src/session/snapshot-session-host.test.ts src/session/ai-circuit-breaker.test.ts` — 55 tests, all green.
- `npx vitest run` (full suite) — 148 files / 1971 tests, all green.
- `npx tsc --noEmit -p .` — no new errors in either modified implementation file (pre-existing unrelated `.test.ts` looseness errors elsewhere in the repo, documented tech debt, untouched).
- `grep -rn "error.stack" src/session/game-session.ts src/session/snapshot-session-host.ts` — no matches (T-126-05 mitigation holds).
- `grep -rn "cli/dev-host" src/session/` — no matches (the hook is injected; no dev-host import in session/).
- `grep -c "persistSafely" src/session/game-session.ts` → 7 (>= 4 required).
- `grep -c "persistenceHealthy" src/session/game-session.ts` → 6 (>= 2 required).
- `grep -c "onPersistenceError" src/session/snapshot-session-host.ts` → 6 (>= 1 required).
- `grep -c "persistenceHealthy" src/session/snapshot-session-host.ts` → 5 (>= 2 required).

## Must-Haves Validation

- ✅ "A storage save failure calls onPersistenceError and sets lastPersistenceError without throwing or crashing gameplay" — `game-session.test.ts` "a rejecting storage save on a normal action resolves performAction (never throws)..." and `snapshot-session-host.test.ts` "a rejecting persist adapter does not throw..."
- ✅ "A persistence failure during an AI turn does NOT increment #aiConsecutiveFailures (no false '[AI] Giving up' log)" — `ai-circuit-breaker.test.ts` Pitfall 2 regression test
- ✅ "Persistence status flips unhealthy after 3 consecutive save failures and recovers... on the next successful save" — both test files' threshold/recovery tests
- ✅ "onPersistenceError consumers receive the current health status so they can escalate severity" — the `healthy` third argument, asserted in both test files
- ✅ "SnapshotSessionHost.apply() persist failures surface through the same onPersistenceError + persistenceHealthy shape" — `snapshot-session-host.test.ts` persistence describe block

## Known Stubs

None.

## Threat Flags

None — this plan only extends existing persistence-error observability; no new network endpoints, auth paths, file access, or schema changes. T-126-03 (unhandled-rejection DoS), T-126-04 (Pitfall 2 misclassification), T-126-05 (stack-leak), and T-126-06 (throwing-hook DoS) mitigations from the plan's threat model were all honored and verified.

## Self-Check: PASSED

All claimed files verified present; all 4 task commit hashes verified present in git log.
