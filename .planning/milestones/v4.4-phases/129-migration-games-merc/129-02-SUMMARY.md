---
phase: 129-migration-games-merc
plan: 02
subsystem: cross-repo test adoption (go-fish, cribbage, demo-animation)
tags: [migration, testing, hidden-info, animation, VIS-01, VIS-03, ANIM]
dependency-graph:
  requires: [VIS-01, VIS-03 (boardsmith/testing), ANIM-01/02/03 (boardsmith/ui)]
  provides: [go-fish DOM-leak proof, go-fish/cribbage visibility assertions, demo-animation trace test]
  affects: [go-fish tests/tsconfig, cribbage tests, demo-animation tests/tsconfig]
tech-stack:
  added: ["go-fish: jsdom@^29.1.1, @vue/test-utils@^2.4.11 (devDeps)", "demo-animation: jsdom@^29.1.1 (devDep)"]
  patterns: ["assertNoHiddenInfoLeak with allow-predicate for redundant/collision-prone rank+suit fields", "direct useFlyingElements composable test mirroring a real component's autoWatch setup (no full mount needed)"]
key-files:
  created:
    - ~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts
    - ~/BoardSmithGames/go-fish/tests/visibility.test.ts
    - ~/BoardSmithGames/go-fish/src/vite-env.d.ts
    - ~/BoardSmithGames/cribbage/tests/visibility.test.ts
    - ~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts
    - ~/BoardSmithGames/demo-animation/src/vite-env.d.ts
  modified:
    - ~/BoardSmithGames/go-fish/package.json
    - ~/BoardSmithGames/go-fish/tests/demo.test.ts
    - ~/BoardSmithGames/demo-animation/package.json
decisions:
  - "Package-legitimacy gate (Task 1) pre-approved by orchestrator: jsdom@^29.1.1 and @vue/test-utils@^2.4.11 already exist as BoardSmith's own devDependencies at these exact versions (first-party authoritative source), plus both are top-tier, long-established ecosystem packages (jsdom = github.com/jsdom/jsdom; @vue/test-utils = official Vue org). Installed the SAME pinned versions in go-fish and demo-animation, no ungated substitutions."
  - "go-fish tsc debt: node:fs/url/path TS2307 errors resolved for free via the already-installed transitive @types/node (no new devDep needed, avoiding an ungated install of a package the Task 1 gate didn't cover)."
  - "go-fish tsc debt: GameDefinitionLike construct-signature mismatch fixed with a narrow, documented `as unknown as GameDefinitionLike` cast at the single executeOp call site in tests/demo.test.ts (not a blanket `any`, not a src/ change — matches plan's 'read the call site' instruction)."
  - "go-fish DOM-leak test: added an `allow` predicate excluding isolated `rank`/`suit` identity candidates (redundant with the full `name` = `${rank}${suit}` compound identity, which a standard 52-card deck guarantees is globally unique and collision-free). Proven necessary by running the test WITHOUT the predicate first: isolated single-/short-character rank/suit values collided with unrelated visible substrings (suit 'C' inside the word 'Card'; rank '8' inside 'Your hand, 8 cards'; rank '10' as a prefix of another player's own visible '10C' card) — the exact coincidental-collision class BoardSmith's own dom-leak.test.ts documents as requiring an allow predicate (IN-01)."
  - "demo-animation animation-trace test: implemented as a direct `useFlyingElements` composable test (mirroring GameTable.vue's real zone-a/zone-b autoWatch config) rather than mounting the full GameTable.vue component — avoids needing to stand up actionController/GameShell plumbing just to prove the trace, matches the ANIM composable-level test precedent in BoardSmith's own useFlyingElements.test.ts, and needed only a jsdom devDep (no @vue/test-utils mount)."
  - "demo-animation vite-env.d.ts added: this test file is the first plain .ts source in the repo to import boardsmith/ui directly — bare tsc only checks .ts files (not .vue), so GameTable.vue's identical import never surfaced the pre-existing ImportMeta.env issue. Rule 3 (blocking-issue) fix, not new v4.4 breakage."
metrics:
  duration: "~90 minutes"
  completed: "2026-07-02"
---

# Phase 129 Plan 02: Flagship Test Adoption (go-fish, cribbage, demo-animation) Summary

Adopted the v4.4 hidden-info and animation test utilities in the three flagship games: go-fish gets the render-level `assertNoHiddenInfoLeak` DOM-leak proof (with a required positive control) plus TestGame-level visibility assertions and closes its pre-existing tsc debt; cribbage gets hand/crib visibility assertions; demo-animation gets a direct animation-trace test proving its real zone-a→zone-b autoWatch fly path.

## What Was Built

**go-fish** (`~/BoardSmithGames/go-fish`):
- `tests/no-hidden-info-dom-leak.test.ts` — the milestone's flagship: renders the game headlessly as the opponent seat (2) via `assertNoHiddenInfoLeak` and proves no hidden card identity reaches the DOM; a second test proves rendering as the owner seat (1) does NOT throw (sanity — not vacuously passing); a third is the **required positive control**, splicing a real hidden-card identity into the rendered view via `gameViewOverride` and asserting the matcher throws.
- `tests/visibility.test.ts` — `isElementVisible`/`assertVisible`/`assertHidden` on hand cards (owner sees own hand, not opponent's) and pond cards (hidden from both).
- Closed all 4 pre-existing tsc errors: `src/vite-env.d.ts` added (ImportMeta.env), node:fs/url/path errors resolved via the already-present transitive `@types/node` (no new devDep), and the `GameDefinitionLike` construct-signature mismatch fixed with a narrow documented cast at the one call site in `tests/demo.test.ts`.
- devDeps added: `jsdom@^29.1.1`, `@vue/test-utils@^2.4.11` (approved versions, matching BoardSmith's own).

**cribbage** (`~/BoardSmithGames/cribbage`):
- `tests/visibility.test.ts` — own-hand cards visible to owner/hidden from opponent; crib cards hidden from both players before the show phase (using the existing `game.test.ts` "simulate discarding via putInto" pattern for setup). No new devDeps (TestGame-level, no DOM mounting). tsc was already clean and stays clean.

**demo-animation** (`~/BoardSmithGames/demo-animation`):
- `tests/animation-trace.test.ts` — a direct `useFlyingElements` composable test (not a full component mount) mirroring `GameTable.vue`'s real zone-a/zone-b `autoWatch` config: moving a card from zone-a to zone-b records `{kind:'fly', element:'7', from:'zone-a', to:'zone-b'}` with no `flip` entry (both zones are face-up).
- `src/vite-env.d.ts` added — fixes an `ImportMeta.env` tsc error this new test surfaced (first plain `.ts` file to import `boardsmith/ui` directly; bare `tsc` never checks `.vue` files, so `GameTable.vue`'s identical import never exposed this).
- devDep added: `jsdom@^29.1.1` (approved version).

## Verification Results

| Repo | Suite | tsc |
|------|-------|-----|
| go-fish | 83 passed (78 baseline + 5 new: 3 DOM-leak + 2 visibility) | clean (was 4 errors) |
| cribbage | 22 passed (20 baseline + 2 new) | clean (unchanged) |
| demo-animation | 9 passed (8 baseline + 1 new) | clean (was 0 errors, stayed 0 after fix for a newly-surfaced one) |

All three repos committed independently:
- go-fish: `1b04ca6` — feat(129-02): adopt VIS-03 DOM-leak + VIS-01 visibility assertions, close tsc debt
- cribbage: `ae87ee3` — feat(129-02): adopt VIS-01 hand/crib visibility assertions
- demo-animation: `4c05b00` — feat(129-02): adopt ANIM animation-trace test (zone-a -> zone-b autoWatch)

## Package-Legitimacy Gate (Task 1)

Pre-resolved by the orchestrator as **approved**, per the checkpoint_resolution instructions: `jsdom@^29.1.1` and `@vue/test-utils@^2.4.11` already exist as BoardSmith's own root `package.json` devDependencies at these exact pinned versions (a first-party authoritative source cross-checked against the live npm registry in RESEARCH), and both are top-tier, long-established ecosystem packages (jsdom: github.com/jsdom/jsdom, 10+ years, tens of millions of weekly downloads; @vue/test-utils: official Vue org package, github.com/vuejs/test-utils, 8+ years). Installed the identical pinned versions in go-fish (`jsdom` + `@vue/test-utils`) and demo-animation (`jsdom` only — no component mount needed there), no substitutions or version drift.

## DOM-Leak Positive Control (verified)

The flagship `no-hidden-info-dom-leak.test.ts` includes a dedicated "POSITIVE CONTROL" test: it takes the real seat-2 view (which correctly hides Alice's hand) and splices one of Alice's actual hidden card identities into it as a `data-leaked-identity` attribute via `gameViewOverride`, then asserts `assertNoHiddenInfoLeak` **rejects** with `/Hidden-info leak/`. This was run and confirmed failing (throwing) before the natural-leak tests were fixed to pass — proving the matcher is capable of catching a real leak, not a silent no-op (T-129-03 mitigation, IN-01 discipline).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/test-design] go-fish DOM-leak natural tests initially false-positived on rank/suit substring collisions**
- **Found during:** Task 2, first `npx vitest run` of the new DOM-leak tests
- **Issue:** `assertNoHiddenInfoLeak` derives forbidden markers per-attribute (`rank`, `suit` checked separately, not as the compound `name`). Go Fish's suit codes are single characters ('H','D','C','S') and most ranks are 1-2 characters — these coincidentally substring-matched unrelated visible DOM text: suit 'C' inside the rendered word "Card"; rank '8' inside a hand-count label "Your hand, 8 cards"; rank '10' as a literal prefix of a different, legitimately-visible "10C" card belonging to the rendering seat's own hand.
- **Fix:** Added a documented `allow` predicate excluding the `rank`/`suit` attributes specifically (kept `name` — the full `${rank}${suit}` compound identity — and `$image`/`$images.face` fully checked; a standard 52-card deck guarantees `name` has zero legitimate collisions). Verified via the required positive control that meaningful leak detection is preserved.
- **Files modified:** `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts`
- **Commit:** `1b04ca6` (go-fish)

**2. [Rule 3 - Blocking issue] demo-animation: new tsc error surfaced by the new test file**
- **Found during:** Task 3, `npx tsc --noEmit` after adding `tests/animation-trace.test.ts`
- **Issue:** The new test is the first plain `.ts` file in demo-animation to import `boardsmith/ui` directly, pulling `useActionController.ts`'s `import.meta.env.DEV` read into `tsc`'s checked module graph for the first time (bare `tsc` never type-checks `.vue` files, so `GameTable.vue`'s identical import was invisible to it).
- **Fix:** Added `src/vite-env.d.ts` (`/// <reference types="vite/client" />`), same fix pattern as go-fish's pre-existing tsc debt (Plan 129-01/129-02).
- **Files modified:** `~/BoardSmithGames/demo-animation/src/vite-env.d.ts`
- **Commit:** `4c05b00` (demo-animation)

**3. [Rule 3 - Blocking issue] go-fish: dual-package Vue `Ref` type mismatch** — N/A, this did not occur in go-fish (no composable-level ref passing needed there); see demo-animation note below for the analogous issue that DID occur.

**4. [Rule 3 - Blocking issue] demo-animation: dual-package-instance `Ref` type mismatch in the new test**
- **Found during:** Task 3, `npx tsc --noEmit`
- **Issue:** `useFlyingElements`'s `AutoWatchContainer.ref: Ref<HTMLElement | null>` type is BoardSmith's own `vue` package copy; the test file's `ref()` calls use demo-animation's own separately-installed `vue` copy. Both are structurally identical but nominally distinct (nominal `Ref` brand symbol differs), producing a TS2741 error. This is invisible in `GameTable.vue` because bare `tsc` doesn't check `.vue` files at all.
- **Fix:** Narrow, documented `as unknown as AutoWatchContainerRef` cast at the two container-ref call sites (not a blanket `any`) — same discipline as the go-fish `GameDefinitionLike` cast.
- **Files modified:** `~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts`
- **Commit:** `4c05b00` (demo-animation)

No BoardSmith `src/` gaps were found — all fixes were game-repo-local (test design, tsconfig/type-declaration gaps, and narrow documented casts at cross-package boundaries).

## Known Stubs

None.

## Threat Flags

None — all new test surface is test-only (no new runtime endpoints, auth paths, or schema changes). The devDependency installs (jsdom, @vue/test-utils) were the one supply-chain-adjacent surface, covered by the pre-approved Task 1 package-legitimacy gate.

## Self-Check: PASSED

- `~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts` — FOUND
- `~/BoardSmithGames/go-fish/tests/visibility.test.ts` — FOUND
- `~/BoardSmithGames/go-fish/src/vite-env.d.ts` — FOUND
- `~/BoardSmithGames/cribbage/tests/visibility.test.ts` — FOUND
- `~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts` — FOUND
- `~/BoardSmithGames/demo-animation/src/vite-env.d.ts` — FOUND
- go-fish commit `1b04ca6` — FOUND (`git log --oneline` in go-fish)
- cribbage commit `ae87ee3` — FOUND (`git log --oneline` in cribbage)
- demo-animation commit `4c05b00` — FOUND (`git log --oneline` in demo-animation)
