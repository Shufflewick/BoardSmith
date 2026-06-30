---
phase: 106-predicate-triggers-ci-verifiable-authoring
verified: 2026-06-26T10:15:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 106: Predicate Triggers & CI-Verifiable Authoring — Verification Report

**Phase Goal:** Authors can fire tutorial content from a game-state predicate or engine event, and author the entire tutorial as a CI-verifiable artifact that fails a test when the rules drift instead of rotting silently.
**Verified:** 2026-06-26T10:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An author can define a trigger that fires tutorial content when a game-state predicate or engine event matches (e.g. before the player's first turn, after N turns, the first time a capture becomes forced). | ✓ VERIFIED | `afterFirstTurn()`, `afterTurns(n)`, `whenForced(actionName)` in `src/engine/tutorial/predicates.ts` (lines 48, 87, 140). Each returns a labeled `TutorialAdvanceCondition` (= `Record<string, (ctx: TutorialGateContext) => boolean>`) evaluated by the single shared `evaluateConditionWithTrace`. Session auto-advance pump in `game-session.ts:913-925` evaluates post-action server-side for all running-tutorial seats. AI actions also trigger the pump via the `#checkAITurn` callback at line 1652. |
| 2 | An author can express a complete tutorial using the `testing` DSL, and it runs as a normal CI test. | ✓ VERIFIED | `simulateTutorial` exported from `src/testing/simulate-tutorial.ts:163` and re-exported from `src/testing/index.ts:84`. `assertTutorialStep` and `assertTutorialCompletes` exported from `src/testing/tutorial-assertions.ts:46,93` and `src/testing/index.ts:91-92`. The CI demo test `src/testing/tutorial-ci-demo.test.ts` authors a 3-step tutorial with named helpers and runs as a normal Vitest test (3 tests, all green). |
| 3 | A game-rule change that breaks the tutorial fails that test (demonstrated by a deliberately broken rule), rather than failing silently at runtime. | ✓ VERIFIED | `tutorial-ci-demo.test.ts` contains two deliberate-break cases: Break #1 (gate drift) — changing the intro step gate to `{ action: 'capture' }` causes `simulateTutorial` to throw matching `/Tutorial drift \(gate\)/` (line 308). Break #2 (predicate drift) — `DemoGameNoCaptureRule` removes the capture rule so `whenForced('capture')` never fires; throws matching `/Tutorial drift \(predicate\)/` (line 339). Both `toThrow` assertions pass, and the intact-rules test also passes. Full suite of 3 tests is green. |

**Score:** 3/3 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/tutorial/progress.ts` | `initialProgress`, `nextProgress`, `evaluateAdvanceWhen`, `autoAdvanceTutorial`, `validateTutorialDefinition` | ✓ VERIFIED | All five functions exported (lines 28, 54, 93, 126, 178). `nextProgress` throws on stale step IDs (WR-01 fix applied). |
| `src/engine/tutorial/types.ts` | Narrowed `advanceWhen` (TutorialAdvanceCondition) + labeled predicate-gate type | ✓ VERIFIED | `TutorialAdvanceCondition` = `Record<string,(ctx)=>boolean>` at line 162. `advanceWhen?: TutorialAdvanceCondition` at line 224. No bare-function form remains. |
| `src/engine/action/action.ts` | Exported context-generic `evaluateConditionWithTrace` | ✓ VERIFIED | `export function evaluateConditionWithTrace<Ctx>` at line 40. |
| `src/engine/tutorial/predicates.ts` | `afterFirstTurn`, `afterTurns(n)`, `whenForced(actionName)` | ✓ VERIFIED | All three exported (lines 48, 87, 140). `afterTurns` validates `n > 0` (WR-03 fix applied). |
| `src/engine/index.ts` | Re-exports the named helpers for game authors | ✓ VERIFIED | `export { afterFirstTurn, afterTurns, whenForced } from './tutorial/predicates.js'` at line 246. |
| `src/session/game-session.ts` | Post-action + AI auto-advance hook calling `autoAdvanceTutorial` then re-broadcasting | ✓ VERIFIED | Post-action hook at lines 913-925 (saves before re-broadcast when advanced, CR-01 fix applied). AI path at lines 1651-1663 (CR-02 fix applied). |
| `src/session/tutorial-controller.ts` | Fail-loud start + shared step-transition delegation | ✓ VERIFIED | `validateTutorialDefinition` called at line 118; `initialProgress` at line 121; `nextProgress` at line 98. No `findIndex`/`nextIndex` in controller (transition math moved to engine). |
| `src/testing/simulate-tutorial.ts` | `simulateTutorial` driver | ✓ VERIFIED | `export function simulateTutorial` at line 163. Reuses `autoAdvanceTutorial` (line 206, 240) and `getTutorialDisabledActions` (line 215). Multi-seat gate drift fixed: scenarioSeats loop initializes progress for all seats before moves (WR-02 fix, line 180). |
| `src/testing/tutorial-assertions.ts` | `assertTutorialStep`, `assertTutorialCompletes` | ✓ VERIFIED | Both exported (lines 46, 93). |
| `src/testing/index.ts` | Public boardsmith/testing exports including `simulateTutorial` | ✓ VERIFIED | `simulateTutorial` at line 84; `assertTutorialStep`/`assertTutorialCompletes` at lines 91-92. |
| `src/testing/tutorial-ci-demo.test.ts` | Criterion #3 demonstration: green-when-intact, red-when-broken | ✓ VERIFIED | Two `toThrow` assertions (lines 308, 339), one passing complete scenario. No external game imports. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/engine/tutorial/progress.ts` | `src/engine/action/action.ts` | `import { evaluateConditionWithTrace }` | ✓ WIRED | Used in `evaluateAdvanceWhen` |
| `src/engine/tutorial/gate.ts` | `src/engine/action/action.ts` | shared evaluator for predicate-form gates | ✓ WIRED | `evaluateConditionWithTrace` imported and used in predicate gate path |
| `src/engine/index.ts` | `src/engine/tutorial/predicates.ts` | re-export of the named helpers | ✓ WIRED | Line 246: `export { afterFirstTurn, afterTurns, whenForced }` |
| `src/session/game-session.ts` | `src/engine/tutorial/progress.ts` | `autoAdvanceTutorial(game, seat)` after broadcast | ✓ WIRED | Lines 918 and 1656 — post-action and AI paths |
| `src/session/tutorial-controller.ts` | `src/engine/tutorial/progress.ts` | `nextProgress / initialProgress / validateTutorialDefinition` | ✓ WIRED | Import at line 16; all three called |
| `src/testing/simulate-tutorial.ts` | `src/engine/tutorial/progress.ts` | `autoAdvanceTutorial + validateTutorialDefinition + initialProgress` | ✓ WIRED | All three imported and used |
| `src/testing/simulate-tutorial.ts` | `src/engine/element/game.ts` | `getTutorialDisabledActions` for gate-legality assertion | ✓ WIRED | Called at line 215 |
| `src/testing/tutorial-ci-demo.test.ts` | `src/testing/simulate-tutorial.ts` | `simulateTutorial + assertTutorialCompletes` | ✓ WIRED | Imported at lines 40-41; called in all three tests |
| `src/testing/tutorial-ci-demo.test.ts` | `src/engine/tutorial/predicates.ts` | named-helper advanceWhen (`afterTurns` / `whenForced`) | ✓ WIRED | Imported at line 42; used in `DEMO_TUTORIAL` definition |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All tutorial engine tests green | `npx vitest run src/engine/tutorial` | 59 tests, 4 files passed | ✓ PASS |
| Session auto-advance and MR-03 tests green | `npx vitest run src/session/tutorial-autoadvance.test.ts src/session/tutorial-controller.test.ts` | 8 + existing tests passed | ✓ PASS |
| CI demo test — intact green, broken RED | `npx vitest run src/testing/tutorial-ci-demo.test.ts` | 3 tests passed | ✓ PASS |
| Full engine/session/testing suite | `npx vitest run src/engine src/session src/testing` | 730 tests, 49 files passed | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TUT-03 | Plans 01, 02, 03 | Author can define triggers from game-state predicates | ✓ SATISFIED | `evaluateConditionWithTrace` generalized; `afterFirstTurn`/`afterTurns`/`whenForced` helpers; session post-action pump; all tests green |
| TUT-04 | Plans 04, 05 | Tutorial as CI-verifiable artifact that fails on rule drift | ✓ SATISFIED | `simulateTutorial` DSL throws on gate drift and predicate drift; demo test proven in-repo with both break types |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No `TBD`, `FIXME`, `XXX` markers found in phase-modified files. No stub returns, empty implementations, or placeholder components detected.

---

### Review Findings Disposition

The phase went through code review (106-REVIEW.md) and fix (106-REVIEW-FIX.md). All 6 findings (2 critical, 4 warnings) were resolved before phase completion:

- **CR-01** (snapshot captured before auto-advance): Fixed — second `#save()` added after the advance block in `performAction`.
- **CR-02** (AI actions bypass tutorial advance): Fixed — pump added to `#checkAITurn` callback.
- **WR-01** (`nextProgress` silent fallback): Fixed — throws on stale step IDs.
- **WR-02** (multi-seat gate drift skips uninitialized seats): Fixed — `scenarioSeats` loop initializes all referenced seats before moves.
- **WR-03** (`afterTurns` no validation for non-positive n): Fixed — early guard added.
- **WR-04** (`resolveSeatForPlayer` 0-indexed fallback): Fixed — `idx + 1` applied.

---

### Human Verification Required

None. All must-haves are mechanically verifiable and confirmed by automated tests.

---

### Gaps Summary

No gaps. All three success criteria are satisfied by substantive, wired, data-flowing implementations. The 730-test suite across engine/session/testing passes in full. The CI demo proves criterion #3 with both break directions using a self-contained in-test game.

---

_Verified: 2026-06-26T10:15:00Z_
_Verifier: Claude (gsd-verifier)_
