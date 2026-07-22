---
requirements-completed: [TOOL-03, TOOL-04, PROC-01]
---

# Plan 162-02 Summary — Side-Effect-Free matchMedia + elementId-Keyed Leak Detection (TOOL-03, TOOL-04, PROC-01)

**Plan:** 162-02 (execute — D19 blocking jsdom import throw + D20 symmetric-deck leak detection)
**Completed:** 2026-07-21
**Result:** PASS — `boardsmith/ui` now imports side-effect-free under jsdom with no matchMedia stub
(D19, Blocking); `assertNoHiddenInfoLeak` now keys detection on element identity, distinguishing
symmetric-deck siblings (D20); PROC-01's RED-before-GREEN and adversarial-bypass gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/ui/composables/ui-barrel-import.test.ts` (`// @vitest-environment
   jsdom`, deliberately NO `vi.stubGlobal('matchMedia', ...)`) dynamically importing the ui barrel and
   asserting it resolves. Ran against current source — captured the real throw (verbatim below).
   Added a symmetric-deck fixture (`SymmetricDeckGame`, two same-named "Ace" `Card`s — one all-visible
   on a table, one in seat 2's hand) to `dom-leak.test.ts`; `assertNoHiddenInfoLeak(tg, 1)` mis-fired
   because the name-substring matcher blamed the visible sibling's own rendered "Ace" for the hidden
   sibling's marker. Ran and captured the wrong failure (verbatim below). No production source touched
   in this commit.
2. **Task 2 (GREEN):**
   - `useElementAnimation.ts`: `prefersReducedMotion` is now a `customRef<boolean>` whose
     `matchMedia` read + `change`-listener registration are deferred to the FIRST `.value` GET (not
     module scope), guarded on `typeof window.matchMedia === 'function'` (not just `typeof window !==
     'undefined'`). Idempotent (init runs once via a module-level flag). Guarded against a
     write-before-first-read footgun discovered while running the full regression sweep: a test that
     assigns `.value = true` before any `.value` read was being silently clobbered back to the OS's
     actual preference on the first subsequent read — fixed with an `explicitlySet` flag so a manual
     write always wins over the lazy OS-preference seed (Rule 1 — bug found and fixed inline during
     Task 2, not a plan deviation since Task 2's own verification step caught and fixed it before
     commit).
   - `dom-leak.ts`: `collectScopedSurfaceStrings` now returns `{ value, ownerId? }` — each scanned
     surface is attributed to the nearest ancestor's `data-element-id` (the same anchor
     `useElementAnimation` reads), or `undefined` if no such ancestor exists. The match loop skips a
     marker/surface pair when both have a defined, differing owner; surfaces with no owning id are
     still checked against every marker (conservative fallback — a leak is never silently dropped for
     lack of attribution).
3. **Task 3:** Added two adversarial cases attempting to defeat the D20 fix: (a) a real leak forced
   into a surface owned by the HIDDEN card's own element id (via `showOnlyTo`, which keeps a stable
   placeholder id) — still throws, proving elementId-scoping isn't a blanket trust hole; (b) a leak
   surface with no `data-element-id` ancestor at all (a `Hand` container, which renders `data-bs-el-id`
   via `anchorAttrs` but never `data-element-id`) — still throws via the conservative fallback. All six
   pre-existing `dom-leak.test.ts` cases (negative, positive control, playerView blind-spot, allowlist,
   aria/alt/title, outside-jsdom) reconfirmed green. Ran the full suite.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ src/ui/composables/ui-barrel-import.test.ts (2 tests | 2 failed)
  × imports the ui barrel under jsdom with no matchMedia stub without throwing
    → promise rejected "TypeError: window.matchMedia is not a fun…" instead of resolving
    Caused by: TypeError: window.matchMedia is not a function
     ❯ src/ui/composables/useElementAnimation.ts:38:14
     ❯ src/ui/composables/useFlyingElements.ts:2:31
  × prefersReducedMotion is defined on the barrel after a no-stub import
    → TypeError: window.matchMedia is not a function

Test Files  1 failed (1)
     Tests  2 failed (2)
```

```
❯ src/testing/dom-leak.test.ts > TOOL-04 (D20): symmetric-deck (identical-named) siblings
  × does NOT false-positive on the visible sibling when only its own "Ace" is on screen
    → AssertionError: promise rejected "Error: Hidden-info leak: "Ace" (attribute…" instead of resolving
    Caused by: Error: Hidden-info leak: "Ace" (attribute "name") from SymmetricCard#7 is visible
    in the DOM rendered for seat 1. Leaked via surface: Ace
```
The hidden `SymmetricCard#7`'s marker was blamed for a surface that actually belonged to the
*different*, legitimately-visible "Ace" card — the exact false-positive D20 predicted.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/ui/composables/ui-barrel-import.test.ts (2 tests) 1129ms
✓ src/testing/dom-leak.test.ts (15 tests) 238ms

Test Files  2 passed (2)
     Tests  17 passed (17)
```

## Adversarial verification (Task 3, real attack attempted)

- Forced the hidden card's real name back into its OWN element-id's node in an otherwise correctly
  redacted view (`showOnlyTo` keeps a stable placeholder id) → still throws
  (`assertNoHiddenInfoLeak — Task 3 adversarial`, first case).
- Forced a collision between a hidden card's rank and a `Hand` container's own id (a surface with no
  `data-element-id` ancestor — un-attributable) → still throws via the conservative fallback (second
  case).
- All 6 pre-existing `dom-leak.test.ts` cases (:108 negative, :120 positive control, :206 playerView
  blind-spot, :240 allowlist, :336 aria/alt/title, :370 outside-jsdom) reconfirmed passing, unmodified.

`src/testing/dom-leak.test.ts` final count: **17 tests** (13 pre-existing describe blocks' worth of
assertions + 2 new symmetric-deck tests + 2 new adversarial tests).

## Verification

- `npx vitest run src/ui/composables/ui-barrel-import.test.ts src/testing/dom-leak.test.ts` — 19/19
  pass (2 barrel-import + 17 dom-leak).
- `npx vitest run src/testing/dom-leak.test.ts src/ui/composables/useElementAnimation.test.ts
  src/ui/composables/useFLIP.test.ts` — 29/29 pass; the still-stubbed UI suites (which pre-stub
  `matchMedia` defensively) remain green, confirming the D19 fix doesn't break suites that still ship
  the (now-unnecessary) stub.
- `npm test` — **209 files / 2937 tests pass**, at/above the pre-phase baseline (208/2931). The
  increase reflects this plan's 2 barrel-import tests + 6 dom-leak additions (2 symmetric-deck + 2
  adversarial + the file's own test count delta).
- Grep gate: `grep -c "typeof.*matchMedia" src/ui/composables/useElementAnimation.ts` → 2 (≥1 required).
- Grep gate: `grep -c "data-element-id" src/testing/dom-leak.ts` → 6 (≥1 required).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] write-before-first-read footgun in the lazy `customRef`**
- **Found during:** Task 2's own regression sweep (`useFlyingElements.test.ts`)
- **Issue:** A test assigns `prefersReducedMotion.value = true` before any `.value` GET has occurred.
  Because the lazy initializer runs on first GET and unconditionally seeded the ref from
  `matchMedia().matches`, that explicit `true` was silently overwritten back to `false` (the stubbed
  OS preference) on the very next read — breaking `useFlyingElements`'s reduced-motion skip path.
- **Fix:** Added an `explicitlySet` flag; the lazy initializer only seeds the value from `matchMedia`
  if no explicit `.value =` write has happened first. The OS `change` listener still updates the value
  live afterward (real reactivity unaffected).
- **Files modified:** `src/ui/composables/useElementAnimation.ts`
- **Commit:** `beb104d5` (folded into the Task 2 GREEN commit — caught and fixed before that commit
  landed, so it never shipped broken)

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-162-04, T-162-05,
T-162-06); no new, unlisted security-relevant surface was introduced. The ~15 pre-existing defensive
`matchMedia` stubs in other UI test files were left in place per the plan's explicit decision
(deferred cleanup, not this phase) and verified compatible with the new lazy-init shape.

## Self-Check: PASSED

- `src/ui/composables/useElementAnimation.ts` (`customRef`, `typeof.*matchMedia` guard) — FOUND
- `src/ui/composables/ui-barrel-import.test.ts` — FOUND
- `src/testing/dom-leak.ts` (`ownerId`, `findOwningElementId`, `data-element-id`) — FOUND
- `src/testing/dom-leak.test.ts` (symmetric-deck + adversarial describe blocks) — FOUND
- Commit `5a86709c` (RED) — FOUND in `git log`
- Commit `beb104d5` (GREEN) — FOUND in `git log`
- Commit `5f36936b` (adversarial) — FOUND in `git log`
