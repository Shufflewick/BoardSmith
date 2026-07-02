---
phase: 124-hidden-info-test-utilities
plan: 03
subsystem: testing
tags: [visibility, hidden-info, testing, dom-leak, playerView, auto-ui]

# Dependency graph
requires: [124-01, 124-02]
provides:
  - "renderAsSeat(testGame, seat, gameViewOverride?) in src/testing/dom-leak.ts"
  - "assertNoHiddenInfoLeak(testGame, seat, options?) in src/testing/dom-leak.ts"
  - "HiddenInfoGameView / HiddenInfoLeakAllowPredicate / AssertNoHiddenInfoLeakOptions types"
  - "All exported from boardsmith/testing barrel"
affects: [129-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Forbidden-marker derivation = diff each element's full unfiltered toJSON() identity against what survives in game.toJSONForPlayer(seat) (never a hardcoded identity-field list, never trusting the engine's own redaction allowlist)"
    - "Dynamic import() to defer a component's module graph evaluation past a runtime polyfill (window.matchMedia) that must exist before the module's top-level code runs"

key-files:
  created:
    - src/testing/dom-leak.ts
    - src/testing/dom-leak.test.ts
  modified:
    - src/testing/index.ts

key-decisions:
  - "renderAsSeat/assertNoHiddenInfoLeak are async — AutoUI is loaded via a runtime dynamic import() (not a static top-of-file import) so a window.matchMedia polyfill can be installed before AutoRenderer's transitive useElementAnimation.ts module-load-time window.matchMedia() call runs; a static import would be hoisted ahead of any polyfill code (ESM import ordering), throwing before render ever starts"
  - "$images.back is excluded from identity candidates (both extraction and survival-check) — it is intentionally NOT identity-bearing (every hidden card of that shape shows the same back), so treating it as forbidden would false-positive on every correctly-redacted hidden card whose anonymized placeholder legitimately re-renders that same back image (redactHiddenElementAttrs keeps it for exactly this reason)"
  - "Boolean attribute values (e.g. Card.faceUp) are excluded from stringifyScalar — true/false are near-universal DOM substrings (data-animatable=\"true\", aria-pressed=\"true\"), so treating them as identity candidates guarantees false positives rather than merely risking them"
  - "gameViewOverride (renderAsSeat + assertNoHiddenInfoLeak options) exists ONLY so the matcher's own tests can construct a deliberately-leaky render (unfiltered game.toJSON(), or a mutated per-seat view) while marker derivation still uses the real game/seat — proving the matcher is not a no-op without weakening real callers' normal (no-override) path"
  - "Scoped DOM scan (data-* attribute values, img[src], inline background-image style) — not a blind wrapper.text() search — to avoid false positives from short numeric ranks/suits colliding with unrelated visible numbers (turn counters, element ids, scores)"

patterns-established:
  - "Positive-control-first testing for leak detectors: the matcher's own test suite proves BOTH that a deliberately-injected leak throws (matcher is not a no-op) and that the redacted view passes (matcher is not over-broad)"

requirements-completed: [VIS-03]

# Metrics
duration: ~35min
completed: 2026-07-02
---

# Phase 124 Plan 03: Headless DOM-Leak Test Utility (VIS-03) Summary

**`assertNoHiddenInfoLeak` mounts a game's real AutoUI/AutoRenderer/CardRenderer stack headlessly as seat N and fails when any hidden element's identity leaks into the rendered markup — forbidden markers are auto-derived by diffing each element's full unfiltered `toJSON()` against what survives into `game.toJSONForPlayer(seat)` (honoring a `static playerView` hook), never from a hardcoded rank/suit/name field list.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-02
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `src/testing/dom-leak.ts` exports `renderAsSeat(testGame, seat, gameViewOverride?)` (mounts the REAL `AutoUI` → `AutoRenderer` → archetype templates → per-element renderers, no stubbing — that is the actual production leak surface) and `assertNoHiddenInfoLeak(testGame, seat, options?)`.
- Forbidden-marker derivation (`deriveForbiddenMarkers`) walks `game.all(GameElement)`, compares each element's unfiltered `toJSON()` identity (name + non-`$`-prefixed attributes + `$image`/`$images.face`) against its node in `game.toJSONForPlayer(seat)`: absent-or-`__hidden` → every identity candidate is forbidden; present-and-visible → only candidates the final tree did NOT preserve (redaction OR a `static playerView` strip) are forbidden. This closes both the redaction-allowlist blind spot (unknown custom attributes are covered) and the playerView blind spot (hook-stripped content is still forbidden).
- A **mandatory positive control** proves the matcher is not a no-op: rendering the fully unfiltered `game.toJSON()` state as seat 1's view throws, naming the leaked marker, the owning element (`ClassName#id`), and the seat.
- A **static-playerView case** proves an attribute a hook strips from an otherwise element-visible card (not hidden by `isVisibleTo`) is still treated as forbidden — injecting the stripped value back into the render is caught.
- An **allowlist case** proves a narrow caller-supplied predicate suppresses a genuine false-positive collision (a hidden card's rank coincidentally equal to a visible Hand container's element id, which legitimately appears in `data-bs-el-id`/`data-zone-id`) while the SAME predicate still lets a real leak (unfiltered override) fail.
- `renderAsSeat`/`assertNoHiddenInfoLeak` (+ their supporting types) exported from `boardsmith/testing` under a new "DOM-leak test utility (VIS-03)" section comment.

## Task Commits

Each task was committed atomically:

1. **Task 1: dom-leak.ts (renderAsSeat + assertNoHiddenInfoLeak)** - `5caa68c` (feat)
2. **Task 2: dom-leak.test.ts + barrel export** - `bcdf2af` (test)

## Files Created/Modified

- `src/testing/dom-leak.ts` - `renderAsSeat`/`assertNoHiddenInfoLeak`, forbidden-marker derivation (toJSON-vs-toJSONForPlayer diff), scoped DOM scan, matchMedia polyfill + dynamic-import loader for AutoUI
- `src/testing/dom-leak.test.ts` - fixture card game (owner-only hands) + negative/positive-control/playerView/allowlist cases, jsdom-pragma'd
- `src/testing/index.ts` - new "DOM-leak test utility (VIS-03)" export block

## Decisions Made

- **Async API via dynamic import.** jsdom does not implement `window.matchMedia`, and `useElementAnimation.ts` reads it at MODULE LOAD time (pulled in transitively through `AutoRenderer`'s `useFlyingElements()`). A static `import AutoUI from '...'` at the top of `dom-leak.ts` would be hoisted and evaluated before any of this file's own code (including a polyfill) could run — so `renderAsSeat`/`assertNoHiddenInfoLeak` became `async`, loading `AutoUI` via a runtime `import()` that only resolves after the polyfill is installed (Rule 3: auto-fixed blocking issue; not a mock of BoardSmith behavior, only a browser API jsdom omits).
- **`$images.back` is not identity.** Every renderer treats a card's back image as safe-by-design (shown for any hidden card of that shape, per `redactHiddenElementAttrs`'s own T-93-04 rationale). Including it as a forbidden-marker candidate would false-positive on every correctly-redacted hidden card, breaking the negative case entirely — so it is excluded from candidate extraction (and, symmetrically, from the surviving-values check).
- **Booleans are not identity.** `Card.faceUp` (and any boolean custom attribute) stringifies to `"true"`/`"false"`, which appear as substrings in near-ubiquitous DOM surfaces (`data-animatable="true"`, `aria-pressed="true"`). This was caught during Task 2 verification (the negative test failed on a spurious `faceUp` marker) and fixed by excluding booleans from `stringifyScalar` — documented as a stronger version of the same short-value-collision risk RESEARCH Pitfall 3 already anticipated for numeric ranks.
- **`gameViewOverride` is test-only, documented as such.** It exists solely so this plan's own test suite can construct a deliberately-leaky render while `deriveForbiddenMarkers` still uses the real game/seat for its ground truth — real callers never need or should pass it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] Static AutoUI import made async/dynamic to admit a matchMedia polyfill**
- **Found during:** Task 1/2 (first real vitest run)
- **Issue:** Mounting the real `AutoUI` (required — stubbing renderers would hide the actual leak surface) throws `TypeError: window.matchMedia is not a function` at import time, because `useElementAnimation.ts`'s top-level `prefersReducedMotion` ref reads `window.matchMedia` during module evaluation, and ESM hoists static imports ahead of any in-file polyfill code.
- **Fix:** `renderAsSeat`/`assertNoHiddenInfoLeak` became `async`; `AutoUI` is loaded via a cached runtime `import()` inside `loadAutoUI()`, called only after `ensureMatchMediaPolyfill()` runs.
- **Files modified:** `src/testing/dom-leak.ts` (also required updating `dom-leak.test.ts`'s assertions to `await expect(...).resolves/.rejects`)
- **Commit:** `5caa68c`

**2. [Rule 1 - bug] Boolean attribute values caused a false-positive leak in the negative case**
- **Found during:** Task 2 (first vitest run of dom-leak.test.ts)
- **Issue:** `Card.faceUp` (boolean, defaults `true`) was treated as an identity candidate; stringified to `"true"`, it trivially matched `data-animatable="true"` on the viewer's own visible cards, failing the negative (redacted-view) test with a spurious leak report.
- **Fix:** Excluded booleans from `stringifyScalar` (both marker extraction and surviving-values collection) — only strings and numbers are treated as identity-bearing scalar values.
- **Files modified:** `src/testing/dom-leak.ts`
- **Commit:** `5caa68c`

## Issues Encountered

None beyond the two auto-fixed items above — both were caught and resolved during the initial test run, before the final commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- VIS-01/02/03 (Phase 124) are all complete and exported from `boardsmith/testing`: `isElementVisible`/`getVisibleElements`/`assertHidden`/`assertVisible` (element-level), `diffPlayerViews` (per-seat view diffing), and `renderAsSeat`/`assertNoHiddenInfoLeak` (rendered-DOM leak detection) together cover the full hidden-info verification surface from raw element state through to actual markup.
- No blockers identified. Phase 124 is ready for `/gsd:verify-phase 124`.

---
*Phase: 124-hidden-info-test-utilities*
*Completed: 2026-07-02*

## Self-Check: PASSED

`src/testing/dom-leak.ts`, `src/testing/dom-leak.test.ts` exist on disk; `src/testing/index.ts` contains the VIS-03 export block; both task commits (`5caa68c`, `bcdf2af`) verified present in `git log --oneline -5`.
