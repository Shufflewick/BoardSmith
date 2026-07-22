---
status: resolved
trigger: "Resolve the one remaining pre-existing test failure in ~/BoardSmithGames/seven (a SIM-family undo-message assertion). Prove whether it's a STALE TEST expectation or a GENUINE bug in computeUndoEligibility message selection."
created: 2026-07-22T00:00:00Z
updated: 2026-07-22T00:00:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The failing seat 2/3 assertions are a STALE TEST written against pre-Phase-160 BSR-7 behavior (currentPlayer pinned at 1). D4/SIM-02 (Phase 160) fixed BSR-7 as requested (awaitingPlayers-participant-based eligibility), and by the time the test's forged undo runs, the flow has already auto-advanced past the discard barrier into round 2's fresh draw step where every seat equally has zero actions -> 'No actions to undo' for all three is objectively correct, not a regression."
  confirming_evidence:
    - "Instrumented flowState dump at the exact point of the forged undo shows awaitingPlayers=[1,2,3] (round-2 draw step), moveCount:0 -- the discard step is already fully closed."
    - "computeUndoEligibility source (src/session/utils.ts) traced by hand for this exact state: isSimultaneousParticipant is true for all 3 seats, simultaneousUndoBoundary returns undefined for all 3 (empty window), so eligible:true/actionsThisTurn:0 uniformly -> 'No actions to undo' is the only reachable message."
    - "BOARDSMITH-REQUESTS.md BSR-7's own 'What we'd like' section literally describes the D4/SIM-02 fix that shipped: per-seat undo authorization from awaitingPlayers, not currentPlayer."
    - "git blame shows this exact test was authored in chunk-simultaneous-round-loop/step-repair (commit 2f6e509), explicitly documenting BSR-7's then-current (buggy) currentPlayer-pinned behavior as a plain (non-tripwire) it(...) -- it was never designed to survive BSR-7 being fixed."
  falsification_test: "If flowState at the undo point still showed the discard step's awaitingPlayers (not round-2's draw step) AND seat 2/3 got 'No actions to undo' anyway, that would indicate a genuine message-selection bug in computeUndoEligibility rather than a stale test. Not observed -- the flow had genuinely advanced."
  fix_rationale: "Update test assertions (not library code) since the library's current behavior matches its own documented D4/SIM-02 contract and correctly implements BSR-7's own requested fix. Also correct BOARDSMITH-REQUESTS.md BSR-7 status to RESOLVED for artifact accuracy (mirrors BSR-1/5/12 resolution style from the 169-03 sweep in the same file)."
  blind_spots: "Did not test undo mid-discard-step (before all 3 seats have committed) to confirm BSR-7's fix also holds there -- out of scope for this specific failing test, which only exercises post-barrier state."

next_action: complete -- fix applied to seven's tests/game.test.ts and BOARDSMITH-REQUESTS.md, deferred-items.md updated, full seven suite green (205/205), ready to commit on sweep/v4.8-dework.

## Symptoms

expected: seats 2/3 forging {type:'undo'} after published-discard barrier should get /not your turn/ per test title ("engine reasons, not .notUndoable()")
actual: seats 2/3 get "No actions to undo" instead
errors: assertion failure comparing undo error message to /not your turn/
reproduction: cd ~/BoardSmithGames/seven && npx vitest run tests/game.test.ts
started: pre-existing on seven's untouched master baseline, exposed by v4.8 SIM work in library (Phase 160, D3/D4/SIM-01..04) changing simultaneous-step undo semantics

## Eliminated

## Evidence

- timestamp: 2026-07-22T00:10:00Z
  checked: instrumented the failing test with a console.log of session.host.snapshot.flowState and actionHistory tail, right before the forged undo calls
  found: |
    After all 3 seats discard (completing the `discard` simultaneousActionStep), the flow's
    `execute((ctx)=>publishPendingDiscards())` barrier runs synchronously, then the round `loop`
    re-enters `sequence(draw, discard, execute)` for round 2. flowState at the point of the forged
    undo shows: awaitingPlayers = [{playerIndex:1,completed:false},{playerIndex:2,...},{playerIndex:3,...}]
    (all three seats awaiting the NEW `draw` step), moveCount:0, currentPlayer:1.
    actionHistory tail confirms discard(1), discard(2), discard(3) are the last 3 entries — no
    round-2 draw has happened yet for anyone.
  implication: the flow has genuinely ADVANCED past the discard barrier into round 2's draw
    step by the time the test forges its undo calls — this is NOT still "inside" the discard
    step for any seat.

- timestamp: 2026-07-22T00:12:00Z
  checked: src/session/utils.ts computeUndoEligibility + simultaneousUndoBoundary for seat 1 vs 2 vs 3 against the observed flowState
  found: |
    isSimultaneousStep = true (awaitingPlayers.length=3 for the round-2 draw step).
    isSimultaneousParticipant(seat) = true for ALL of seat 1,2,3 (all three are awaitingPlayers
    entries of the round-2 draw step — nobody is excluded).
    simultaneousUndoBoundary(actionHistory, moveCount=0, seat): windowStart = length - 0 = length,
    so the `for i=windowStart..length` scan is empty for every seat -> ownIndex stays undefined ->
    boundary returns undefined for seat 1, 2, AND 3 identically.
    computeUndoEligibility therefore returns {eligible:true, actionsThisTurn:0} for all three seats
    -> handleUndo's actionsThisTurn===0 branch fires uniformly -> "No actions to undo" for seat 1,
    2, and 3 alike. There is no seat-dependent branch that could produce "not your turn" here,
    because ALL THREE seats genuinely ARE participants of the (new) current step — none of them
    is "not eligible".
  implication: "No actions to undo" is the objectively correct message for seat 2 and seat 3 in
    this scenario, not a regression. "not your turn" would be semantically WRONG to return here:
    it implies the seat is not a participant of the current step, which is false — every seat is
    awaiting the fresh round-2 draw step equally. The test's premise (staging order determines
    who is "not your turn" post-barrier) does not hold once the flow advances past the barrier
    into a brand-new simultaneous step where nobody has acted yet.

## Resolution

root_cause: |
  STALE TEST, not a library bug. The test's title/comment assumed the flow would still be
  "inside" the completed discard step (with seat-1-vs-seat-2/3 asymmetry from staging order)
  at the moment of the forged undo. In reality seven's flow (src/rules/flow.ts) auto-publishes
  the discard barrier via a synchronous `execute()` node and the enclosing `loop` immediately
  re-enters `sequence(draw, discard, execute)` for the next round, landing in a BRAND NEW
  `draw` simultaneousActionStep before the test ever calls `session.send(seat,{type:'undo'})`.
  At that point every seat (1, 2, 3) is equally an `awaitingPlayers` participant of the new
  step with moveCount 0 and zero own actions in the window — `computeUndoEligibility`
  (src/session/utils.ts) correctly reports `eligible:true, actionsThisTurn:0` for all three,
  which `handleUndo`/`undoToTurnStart` correctly render as "No actions to undo" uniformly.
  "not your turn" would only be correct if a seat were NOT a current-step participant, which
  is never the case here. Verified library behavior against Phase 160/D4/SIM-02's documented
  contract in `computeUndoEligibility`'s doc comment — behaves exactly as designed.
fix: |
  Updated seven's test assertion (tests/game.test.ts) so seats 2 and 3 expect
  `/No actions to undo/` (matching seat 1's assertion), with a rewritten comment explaining
  that the discard barrier auto-advances the flow into round 2's draw step before the forged
  undo runs, so all three seats are refused for the same reason. No library change needed.
verification: |
  `cd ~/BoardSmithGames/seven && npx vitest run` — full suite green after test fix.
files_changed:
  - ~/BoardSmithGames/seven/tests/game.test.ts
