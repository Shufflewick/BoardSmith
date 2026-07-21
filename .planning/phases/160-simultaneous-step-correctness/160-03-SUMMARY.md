---
requirements-completed: [SIM-04, PROC-01]
---

# Plan 160-03 Summary — Simultaneous-Step Shell Status Contradiction + Commit Leak (D27, SIM-04, PROC-01)

**Plan:** 160-03 (execute — UI-only, GameShell.vue + ActionPanel.vue seat status/commit gate)
**Completed:** 2026-07-20
**Result:** PASS — viewer's own seat self-filtered out of the "Waiting for" list, execute path gated
on the viewer's own `completed` flag, no single-player turn identity derived while a simultaneous step
is active. PROC-01's RED-before-GREEN and adversarial-leak-closure gates both satisfied.

## What was done

1. **Task 1 (RED):** Created `src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts` proving two
   D27 defects failing against CURRENT source (no production changes):
   - A harness mirroring `GameShell.vue`'s `awaitingPlayerSeats`/`awaitingPlayerNames` computeds AS
     THEY EXISTED (no exclusion of the viewer's own seat) — same mirror-harness convention as the
     `showHintProp` harness in `GameShell.test.ts`, since these computeds live inside `<script setup>`
     and aren't exported.
   - A REAL `ActionPanel` mounted with a REAL `useActionController` (same pattern as
     `ActionPanel.interaction.test.ts`), modeling the vulnerable case (`isMyTurn=true` after the seat
     already committed — a stale/optimistic prop) and clicking a zero-selection action button.
   Ran and captured the real failures (verbatim below). Negative controls (co-decider present in the
   list; a not-yet-completed viewer CAN execute) passed both before and after the fix.
2. **Task 2 (GREEN):**
   - `GameShell.vue`: `awaitingPlayerSeats`/`awaitingPlayerNames` now filter out
     `p.playerIndex !== playerSeat.value`. New `isSimultaneous` computed
     (`awaitingPlayers?.length > 0`) drives `currentPlayerName` (returns `''`) and `activePlayer`
     (returns `null`) while a simultaneous step is active — no single-player "It is X's turn" identity
     is ever surfaced when multiple seats are deciding independently. New `myCompleted` computed
     (viewer's own `awaitingPlayers[].completed`, `false` outside a simultaneous step) passed to
     `ActionPanel` as `:completed`.
   - `ActionPanel.vue`: new optional `completed` prop; `executeAction` gates on `props.completed` in
     addition to `!isMyTurn` — a committed seat's click never reaches `sendAction`. Defense in depth:
     `isMyTurn` is already completed-aware server-side (`canSeatAct`/`dueSeats`), but nothing in
     ActionPanel's own prop contract enforced that invariant against a stale/race client-side value.
   - Test harness updated to mirror the FIXED GameShell computeds; re-ran to confirm GREEN.
3. **Task 3 (adversarial + regression guard):** Extended the test file with repeat-submit (5x rapid
   clicks on a completed seat → zero executes), a mid-step `completed:true` prop-flip race (click lands
   after the flip → zero executes), a 3-awaiting-seat ordering/exclusion test, a reactive-flip test
   (self stays excluded as `completed` flags change across the whole seat set), and an exhaustive
   3-seat completed/not-completed sweep (8 combinations) proving the viewer's own seat is NEVER in its
   own waiting list. Ran the full suite to confirm zero collateral regression.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts (3 tests | 2 failed)
   × GameShell awaitingPlayerNames/awaitingPlayerSeats — self-filter (D27, SIM-04) > SF-1 (RED pre-fix): the viewer's OWN seat appears in its own "Waiting for" list
     → expected [ 'You', 'Ari' ] to not include 'You'
   × ActionPanel executeAction — commit-leak gate on own completed flag (D27, SIM-04) > CL-1 (RED pre-fix): a completed seat can still trigger executeAction (the leak)
     → expected "spy" to not be called at all, but actually been called 1 times

Test Files  1 failed (1)
     Tests  2 failed | 1 passed (3)
```
The 1 passing test was `CL-2` (negative control — a not-yet-completed viewer CAN execute), proving the
harness/mount doesn't fail everything. Both failures were the real defects, for the right reasons: own
seat present in the rendered "Waiting for" list, and a completed seat's click reached `sendAction`.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts (3 tests) 23ms

Test Files  1 passed (1)
     Tests  3 passed (3)
```

## Adversarial verification (Task 3)

- **CL-3** (repeat submit): 5 rapid clicks on a completed seat's action button (mixed same-tick and
  cross-tick) → `sendAction` never called.
- **CL-4** (mid-step race): action button clicked immediately after `completed` prop flips from `false`
  to `true` (the realistic race — a co-decider's commit resolves the step mid-interaction) →
  `sendAction` never called.
- **SF-2**: 3 awaiting seats, viewer is seat 1 → sees exactly `['Ari', 'Sam']`, in seat order, never
  `'You'`.
- **SF-3**: across two successive `flowState` updates (viewer commits, then a co-decider commits), the
  viewer's own seat is excluded from the list at every step — never re-appears.
- **NC-1**: exhaustive 3-seat completed/not-completed sweep (8 combinations) — in every reachable
  state, the viewer's own seat is absent from its own waiting list.

```
✓ src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts (8 tests) 32ms
✓ src/ui/components/GameShell.test.ts (19 tests) 61ms

Test Files  2 passed (2)
     Tests  27 passed (27)
```

## Verification

- `npx vitest run src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts src/ui/components/GameShell.test.ts` — 27/27 pass.
- `npm test` — **202 files / 2870 tests pass** (up from the 160-02 baseline of 201/2862 — this plan's 1
  new file / 8 new tests, zero regressions elsewhere).
- Grep gate: `grep -c 'playerIndex !== playerSeat' src/ui/components/GameShell.vue` → 2 (≥1 required).
- Grep gate: `grep -v '^\s*//' src/ui/components/auto-ui/ActionPanel.vue | grep -c 'completed'` → 4
  (≥1 required).

## Deviations from Plan

None — plan executed exactly as written; no Rule 1/2/3 fixes were needed. The self-filter and
completed-gate were the plan's own scope; UI parity (CLAUDE.md hard rule) was preserved because the
fix lives entirely in `ActionPanel.vue`/its shared `useActionController` and `GameShell.vue`'s shared
computeds — no Action-Panel-only branch was introduced. A custom UI driven by `useBoardInteraction`
reads the same `availableActions`/`isMyTurn` computeds from GameShell (already completed-aware via the
pre-existing `myPlayerState.completed` check at `GameShell.vue:426`) and would need its own
`executeAction`-equivalent call site to wire the `completed` prop if/when a custom UI reimplements
execute submission directly — none currently do; they route through the same `actionController.execute`
that `ActionPanel.executeAction` calls, so the completed-gate at the ActionPanel layer is the correct
scope for this plan (no custom UI in this repo bypasses ActionPanel's submit path).

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-160-27, T-160-28); no
new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/ui/components/GameShell.vue` (`isSimultaneous`, `myCompleted`, self-filtered `awaitingPlayerSeats`/`awaitingPlayerNames`) — FOUND
- `src/ui/components/auto-ui/ActionPanel.vue` (`completed` prop, `executeAction` gate) — FOUND
- `src/ui/components/auto-ui/ActionPanel.simultaneous.test.ts` — FOUND
- Commit `10ebdd54` (RED) — FOUND in `git log`
- Commit `e59109e2` (GREEN) — FOUND in `git log`
- Commit `53b1c52d` (adversarial + regression guard) — FOUND in `git log`
