---
requirements-completed: [ENDGAME-01, PROC-01]
---

# Plan 157-01 Summary — Game-Over UI: dismiss, suppress, draw-vs-unknown labeling (ENDGAME-01, PROC-01)

**Plan:** 157-01 (execute — GameOverCard rewrite + GameShell `#game-over` slot / `providesOwnGameOverUI` + isDraw threading)
**Completed:** 2026-07-20
**Result:** PASS — the default `GameOverCard` now distinguishes a genuine draw from unavailable winner
data, is dismissable (close button + Escape), and is fully suppressable via a `#game-over` slot or
`providesOwnGameOverUI`; PROC-01's RED-before-GREEN and adversarial-suppression gates both satisfied.

## What was done

1. **Task 1 (RED):** Extended `GameOverCard.test.ts` with the draw/unknown labeling matrix and the
   dismiss cases (close button + Escape → `dismiss`). Created `GameShell.game-over.test.ts` — mounting
   the full GameShell was impractical (client/WS wiring), so it follows the codebase's established
   harness pattern (`GameShell.ia.test.ts` Suite 5): an isolated component mirroring GameShell.vue's
   exact mount-guard template logic, using the real `GameOverCard`. Extended `GameShell.live-region.test.ts`
   with a draw-vs-unknown case against the pure `announceGameOver` helper. Left `useFocusTrap.test.ts`
   unmodified — it already asserts `Escape → onClose` when `escapeToClose:true` (the card's new config);
   no behavioral gap existed there to RED. Ran all four files against current, unfixed source and
   captured the real failures (verbatim below). No production source touched in this commit.
2. **Task 2 (GREEN):** Threaded an explicit `isDraw` signal `isComplete && winners.length === 0` from
   `SnapshotSessionHost`'s broadcast meta through `multiplayer-host.ts`'s `game_state` frame to
   `GameShell.vue`'s captured `isDraw` ref, and rewrote `GameOverCard.vue`'s `titleText` as a pure
   function of `winners` + `isDraw`. Added the close button (`aria-label="Close"`, 44×44 CSS px,
   `--bsg-ink` on transparent — no new colors) and reconfigured `useFocusTrap` to `escapeToClose:true`
   with `onClose` emitting `dismiss`. Added the `#game-over` scoped slot and `providesOwnGameOverUI`
   prop to `GameShell.vue`'s mount guard, plus a `gameOverDismissed` ref that hides the card/slot and
   returns focus to `.boardregion` (now `tabindex="-1"`) without restarting or leaving.
3. **Task 3:** Extended `GameShell.game-over.test.ts` with an adversarial block proving suppression is
   real DOM removal (`wrapper.html()` containment check, not just `.find().exists()`), parity-checked
   under both the default board and a custom `#game-board` UI, plus a dismiss-adversarial block (spies
   confirming no `rematch`/`new-game` ever fires, board stays reachable/focusable, mounted props
   untouched). Extended `GameOverCard.test.ts` with explicit degrade-adversarial cases (`isDraw:false`
   and `isDraw` omitted entirely) proving the empty-array-is-not-a-draw invariant survives. Ran the full
   suite: 194 files / 2800 tests, above the pre-phase baseline (193/2772).

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 FAIL  GameOverCard.test.ts > draw vs unknown labeling (D10) > labels a genuine draw "Draw" when isDraw=true and winnerSeats=[]
AssertionError: expected 'Game Over' to be 'Draw'

 FAIL  GameOverCard.test.ts > dismiss affordance (D10) > renders a close control with aria-label="Close"
AssertionError: expected false to be true

 FAIL  GameOverCard.test.ts > dismiss affordance (D10) > clicking the close control emits "dismiss"
AssertionError: expected undefined to be truthy

 FAIL  GameOverCard.test.ts > dismiss affordance (D10) > pressing Escape on the card emits "dismiss"
AssertionError: expected undefined to be truthy

 FAIL  GameShell.game-over.test.ts > #game-over slot suppression (default board / custom #game-board UI)
       > removes the default card from the DOM and renders slot content when #game-over is filled
AssertionError: expected false to be true   (.custom-game-over never rendered — slot silently dropped)

 FAIL  GameShell.game-over.test.ts > providesOwnGameOverUI suppression (default board / custom #game-board UI)
       > suppresses BOTH the default card and slot content when providesOwnGameOverUI=true
AssertionError: expected true to be false   (.game-over-card still present — flag ignored)

 FAIL  GameShell.live-region.test.ts > announceGameOver — draw vs unknown (D10)
       > announces "Draw" for a genuine draw (winners=[], isDraw=true)
AssertionError: expected 'Game over' to contain 'Draw'

Test Files  3 failed | 1 passed (4)
     Tests  10 failed | 47 passed (57)
```
Negative controls kept green throughout (single/co-winner labeling, `isDraw=false` stays "Game Over",
`announceGameOver([], false)` stays "Game over") — proving the new assertions aren't over-broad.
`useFocusTrap.test.ts` passed unmodified (14/14) — composable-level `escapeToClose:true` coverage
pre-existed.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ GameShell.live-region.test.ts (16 tests)
 ✓ useFocusTrap.test.ts (14 tests)
 ✓ GameShell.game-over.test.ts (6 tests)
 ✓ GameOverCard.test.ts (21 tests)

Test Files  4 passed (4)
     Tests  57 passed (57)
```

## Adversarial + parity verification (Task 3)

- Suppression asserted via `wrapper.html()` containment (rules out a `display:none`/`v-show` fake-out),
  for both the `#game-over` slot and `providesOwnGameOverUI` paths, under both the default board and a
  custom `#game-board` UI (`describe.each` parity) — 4 new adversarial cases, all pass.
- Dismiss adversarial: close-click and Escape each emit **only** `dismiss` (spied for absence of
  `rematch`/`new-game`); post-dismiss the card is gone, `.boardregion` remains present/focusable
  (`tabindex="-1"`), and the mounted `winnerSeats` prop is unchanged — dismiss is presentation-only.
- Degrade adversarial (`GameOverCard.test.ts`): `isDraw:false` and `isDraw` omitted entirely (exercising
  the prop default) both render exactly `"Game Over"`, never `"Draw"` — only the explicit `isDraw`
  signal can ever produce "Draw".

```
 ✓ GameShell.game-over.test.ts (16 tests)
 ✓ GameOverCard.test.ts (23 tests)

Test Files  2 passed (2)
     Tests  39 passed (39)
```

Full suite: **194 files / 2800 tests pass**, above the pre-phase baseline (193/2772 — +1 new test file,
+28 net-new tests across the 4 touched files).

## Verification

- `npx vitest run src/ui/components/GameOverCard.test.ts src/ui/components/GameShell.game-over.test.ts src/ui/composables/useFocusTrap.test.ts src/ui/components/GameShell.live-region.test.ts` — 57/57 pass.
- `npm test` — 194 files / 2800 tests pass, at/above baseline.
- Grep gate: `grep -v '^\s*\*' src/session/snapshot-session-host.ts src/cli/dev-host/multiplayer-host.ts src/ui/components/GameShell.vue src/ui/components/GameOverCard.vue | grep -c 'isDraw'` → **19** (≥4 required).
- Grep gate: `grep -c 'providesOwnGameOverUI' src/ui/components/GameShell.vue` → **4** (≥2 required).
- Grep gate: `grep -nE '#[0-9a-fA-F]{3,6}\b' src/ui/components/GameOverCard.vue` → no matches (no new raw colors).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] `src/cli/dev-host/bridge.ts` required widening (not in the plan's `files_modified` list)**
- **Found during:** Task 2, wiring `isDraw` from `SnapshotSessionHost` through `multiplayer-host.ts`.
- **Issue:** The plan's interfaces section describes `multiplayer-host.ts` reading `this.session.meta()`
  as if that method returned `SnapshotSessionHost`'s meta shape directly. In fact `createDevSession`
  (in `bridge.ts`) sits between them: it maintains its own local `isComplete`/`winners` mirror captured
  from the broadcast callback, and `DevSession.meta()` returns that local mirror with its own declared
  type — `{ isComplete: boolean; winners: number[] }`, no `isDraw`. Without widening `bridge.ts`,
  `multiplayer-host.ts` could not forward `meta.isDraw` (the field would not exist on the type, and at
  runtime the local mirror would never have captured it either).
- **Fix:** Widened `DevSessionOptions.postGameState`'s meta param and `DevSession.meta()`'s return type
  to include `isDraw: boolean`; added a local `isDraw` mirror variable in `createDevSession`, captured
  in the `broadcast` callback alongside `isComplete`/`winners`, and returned from `meta()`.
- **Files modified:** `src/cli/dev-host/bridge.ts`.
- **Commit:** `dd6b953c`.

### Design note (not a deviation — a documented discretion)

The plan's action text for the live-region fix (`GameShell.vue:1780-1785`) could be read as requiring
the same top-level `isDraw` (captured from the platform postMessage frame) to drive the announcement.
Investigation showed the per-player `flowState.winners` field (used by the live-region watcher, sourced
from `engine/utils/snapshot.ts`: `winners: flowState?.complete ? game.getWinners()... : undefined`) is
**already** the authoritative defined-vs-undefined draw signal, independent of the flat postMessage
`isDraw` field added for the card. Reusing it for the live region avoids adding a second parallel
threading path for the same distinction; `announceGameOver` gained an `isDraw` boolean param computed
locally in the watcher as `flowState.winners !== undefined && flowState.winners.length === 0`. The card's
`:is-draw` prop is separately sourced from the top-level frame field per the plan's explicit interfaces
section (`winnerSeats`/`isDraw` capture at `GameShell.vue:~308`/`~1144-1150`).

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced. `rematch`/`newGame` slot props and event handlers route to the
existing (currently partially-inert) `handleRestartGame`/`handleMenuItemClick('new-game')` — this is
intentional per CONTEXT.md/the plan ("Plan 02 fixes their behavior — do NOT change routing here"), not
a stub introduced by this plan.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-157-01 spoofing via
labeling-as-pure-function-of-validated-signal, T-157-02 slot-props-scoped-to-already-visible-data,
T-157-03 label-only strings with no leaked paths/stack traces). No new, unlisted security-relevant
surface was introduced.

## Self-Check: PASSED

- `src/ui/components/GameOverCard.vue` — FOUND
- `src/ui/components/GameShell.vue` — FOUND
- `src/session/snapshot-session-host.ts` — FOUND
- `src/cli/dev-host/multiplayer-host.ts` — FOUND
- `src/cli/dev-host/bridge.ts` — FOUND
- `src/ui/components/GameOverCard.test.ts` — FOUND
- `src/ui/components/GameShell.game-over.test.ts` — FOUND
- `src/ui/composables/liveRegionAnnouncer.ts` — FOUND
- Commit `78158e9b` (RED) — FOUND in `git log`
- Commit `dd6b953c` (GREEN) — FOUND in `git log`
- Commit `0bbbc386` (adversarial + parity) — FOUND in `git log`
