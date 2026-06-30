---
phase: 107-ai-assisted-teaching
fixed_at: 2026-06-26T17:25:00Z
review_path: .planning/phases/107-ai-assisted-teaching/107-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 7
skipped: 2
status: partial
---

# Phase 107: Code Review Fix Report

**Fixed at:** 2026-06-26
**Source review:** `.planning/phases/107-ai-assisted-teaching/107-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (7 Warnings + 2 Info)
- Fixed: 7 (WR-01, WR-03, WR-04, WR-05, WR-06, WR-07, IN-02)
- Skipped: 2 (WR-02 pre-existing tech debt; IN-01 inaccurate finding)

**Test results:** 1510/1510 passed (full suite green, all affected suites green)

---

## Fixed Issues

### WR-01: startDemo idempotency guard

**Files modified:** `src/session/game-session.ts`
**Commit:** `49f7703`
**Applied fix:** Added `if (this.#demoMode) return;` at the start of `startDemo()` before the `#savedAIController` assignment. A double-call was permanently corrupting `#savedAIController` by overwriting it with the demo controller; `stopDemo()` would then restore the demo controller instead of the original. Guard prevents that corruption.

Also added to WR-04 commit (same atomic change).

---

### WR-03: setHeatmapVisible throws on concurrent recompute

**Files modified:** `src/session/game-session.ts`, `src/session/teaching.test.ts`
**Commit:** `3f4fa8b`
**Applied fix:** Changed the silent `return` when `#heatmapUpdating` is true to `throw new Error('Heatmap evaluation is already in progress — please wait.')`. This is consistent with `requestHint()`'s fail-loud pattern. The GameShell `heatmap-toggle` catch block already surfaces a toast for errors. A test was added to cover the concurrent-call behavior.

---

### WR-04: isDemoRunning broadcast state desync

**Files modified:** `src/session/game-session.ts`, `src/session/types.ts`, `src/ui/components/GameShell.vue`
**Commit:** `49f7703`
**Applied fix:**
- Added `isDemoRunning?: boolean` to `PlayerGameState` in `types.ts` with full JSDoc.
- Injected `if (this.#demoMode) state.isDemoRunning = true;` in `broadcast()` in `game-session.ts`.
- Added `this.broadcast()` at the end of `startDemo()` so clients learn about demo state before the first AI move fires (previously there was no immediate broadcast).
- Changed `isDemoRunning` in `GameShell.vue` from `ref(false)` to `computed(() => (state.value?.state as any)?.isDemoRunning ?? false)`, removing all three local `.value = false/true` mutations. The session is now the single source of truth.

---

### WR-05: requestHint uses play() not playWithStats()

**Files modified:** `src/session/game-session.ts`
**Commit:** `9c943d1`
**Applied fix:** Changed `const { move } = await bot.playWithStats();` to `const move = await bot.play();` in `requestHint()`. `playWithStats()` forces single-mode search regardless of parallel config, regressing hint quality at 'hard' difficulty (`parallel: 2`). The hint path only needs the best move — the stats return value was unused. `play()` honours the configured parallel mode.

---

### WR-06: Default narrator uses JSON.stringify for object args

**Files modified:** `src/session/game-session.ts`, `src/session/teaching.test.ts`
**Commit:** `dca868d`
**Applied fix:** Changed the default narrator arg formatter from `${k}=${String(v)}` to check `typeof v === 'object'` and use `JSON.stringify(v)` for non-null objects. `String(obj)` produced the useless `[object Object]` for any `Record<string, unknown>` value. Updated the JSDoc on `startDemo()` to note that games with rich arg types should supply a custom `narrator`. Added tests including a direct unit test of the formatter logic (covers primitive, object, array, null cases) and a double-`startDemo()` idempotency test.

---

### WR-07: Document deliberate concurrency scope difference

**Files modified:** `src/session/game-session.ts`
**Commit:** `75c1d5d`
**Applied fix:** Added a detailed comment on `#hintThinking` explaining the deliberate per-seat vs session-wide scope difference. `#hintThinking` (per-seat `Set`) intentionally allows concurrent hint searches for different seats in simultaneous-action games. `#heatmapUpdating` (session-wide `boolean`) blocks all seats because heatmap evaluates the full board across all candidate moves, making it significantly more CPU-intensive. The asymmetry is now documented in code rather than left as an unexplained inconsistency.

---

### IN-02: cssEscape polyfill extended for CSS string terminators

**Files modified:** `src/ui/components/helpers/overlay-utils.ts`
**Commit:** `9bd5cc2`
**Applied fix:** Extended the jsdom polyfill regex from `/["\\]/g` to `/[\0\n\r\f"\\]/g`, adding null byte (`\0`), newline (`\n`), carriage-return (`\r`), and form-feed (`\f`). These are CSS string terminators that can appear in programmatically-constructed element names in jsdom-based unit tests; a broken selector silently fails to match and renders the overlay on no element. Production browsers always use native `CSS.escape`.

---

## Skipped Issues

### WR-02: applyMoveToSearchGame swallows exceptions silently

**File:** `src/ai/mcts-bot.ts:523-533`
**Reason:** skipped: pre-existing tech debt, not introduced by Phase 107

The `applyMoveToSearchGame` method and its `catch`/swallow block were confirmed present in commit `df01c9c` (the commit immediately before Phase 107's `f1e29ec`). Phase 107's `runSearch()` extraction did not introduce or move this catch block — it existed in `playSingle()` in the same form before the refactor.

Per the guidance, this is out of scope: it predates Phase 107 and changing MCTS search error-recovery behavior speculatively carries risk disproportionate to the phase. This is recorded as pre-existing tech debt for a dedicated MCTS error-recovery fix.

---

### IN-01: Phase 107 test coverage gap claim is inaccurate

**File:** `vitest.config.ts:21-22`
**Reason:** skipped: finding is inaccurate — tests exist and were run

The reviewer claimed "no in-repo test file was found exercising `requestHint()`, `setHeatmapVisible()`, `startDemo()`/`stopDemo()`, or `playWithStats()` directly." This is incorrect. `src/session/teaching.test.ts` exists and covers all of these:

- `requestHint()`: covered in "broadcast injection" and "requestHint/clearHint" describe blocks (including concurrent-call, non-acting-seat, clear-after-action, clearHint)
- `setHeatmapVisible()`: covered in "heatmap" describe block (false/true cases, isBest invariant)
- `startDemo()`/`stopDemo()`/`isDemoRunning`: covered in "demo mode" describe block (lifecycle, narration timing, controller restore)

`playWithStats()` is indirectly exercised by `requestHint()` (before WR-05 changed it to `play()`) and by `setHeatmapVisible()` (which still uses `playWithStats()`). The `mcts-stats-checkers.test.ts` referenced in the finding is not a gap — it's a separate integration test for the checkers-specific wiring deferred to Phase 109.

The existing coverage is genuine. No additional tests were needed for IN-01.

---

_Fixed: 2026-06-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
