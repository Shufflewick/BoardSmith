---
status: resolved
trigger: "checkers tutorial multi-jump STILL hangs after first move even after prior fix to useActionController.startFollowUp (commit 997f2d2)"
created: 2026-06-29T00:00:00Z
updated: 2026-06-29T00:01:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: stale tutorialStep suppresses auto-fill in startFollowUp; the state broadcast hasn't arrived when startFollowUp fires. Nothing re-triggers after broadcast.
test: add watcher on tutorialStep that retries auto-fill when suppressAutoFill lifts
expecting: watcher fires after broadcast, pickStep called, continuation submits
next_action: implement fix in useActionController.ts + add integration regression test

reasoning_checkpoint:
  hypothesis: "In startFollowUp, fetchAndAutoFill->tryAutoFillSelection is called while tutorialStep.value is still execute-capture (suppressAutoFill:true) because the server state broadcast (game_state WebSocket) arrives AFTER the platformRequest action response. isTutorialSuppressingAutoFill('destination') returns true → auto-fill skipped → isReady=false → R-04 guard misses. When the broadcast later updates tutorialStep to multi-jump-continue (no suppressAutoFill), no code path re-triggers tryAutoFillSelection. Permanent hang."
  confirming_evidence:
    - "execute-capture step has suppressAutoFill:true with no suppressAutoFillFor scoping — all selections suppressed including destination"
    - "tutorialStep computed from state.value?.state?.tutorial — updated only when WebSocket broadcast is processed, NOT when platformRequest response returns"
    - "queueFollowUp uses nextTick before startFollowUp — not enough to await WebSocket delivery"
    - "R-04 guard at end of startFollowUp checks isReady.value — which is false because destination was never auto-filled"
    - "existing R-04 unit test passes because it provides no tutorialStep — isTutorialSuppressingAutoFill always returns false"
    - "watch(currentPick, ...) and watch(isReady, ...) do not depend on tutorialStep — never re-fire when it changes"
  falsification_test: "if tutorialStep were already on multi-jump-continue when startFollowUp runs, auto-fill would succeed — confirmed by unit test with no tutorialStep"
  fix_rationale: "add watcher on options.tutorialStep that retries tryAutoFillSelection + R-04 handleOnSelectFill when suppressAutoFill changes from true to false while a pendingOnServer action has an unfilled selection"
  blind_spots: "filterBy filter produces exactly 1 non-disabled choice (assumed from code analysis); timing of state broadcast relative to nextTick may vary"

## Symptoms

expected: after first forced jump, the continuation (single legal move) auto-submits or the user can click to continue the multi-jump
actual: action hangs — never submitted to server; player stuck; only unintuitive re-click of moved piece sometimes submits
errors: no error — just a hang (no submit call reaches server)
reproduction: checkers tutorial preset (resetToTutorialPreset) → make first forced jump → continuation never proceeds
started: after prior fix commit 997f2d2 (still hanging)

## Eliminated

- hypothesis: "filter/choices issue — filterBy on destination selection causes zero choices"
  evidence: "game.continuingPiece set → getMovesForPlayer returns only continuing piece's moves; all choices have pieceId=continuingPiece.id; currentArgs['piece']=continuingPiece.id from initialArgs; filter matches"
  timestamp: 2026-06-29

- hypothesis: "server rejects the selection_step call"
  evidence: "processSelectionStep with initialArgs={piece,destination} creates pending action from both args, advances to destination selection, processes it, completes the action — server-side logic is correct"
  timestamp: 2026-06-29

## Evidence

- timestamp: 2026-06-29
  checked: "execute-capture tutorial step definition"
  found: "suppressAutoFill:true at step level (no suppressAutoFillFor scoping) — ALL selections in the step are suppressed"
  implication: "isTutorialSuppressingAutoFill returns true for both piece AND destination while this step is active"

- timestamp: 2026-06-29
  checked: "timing of tutorialStep update vs startFollowUp execution"
  found: "tutorialStep = computed(() => state.value?.state?.tutorial); state.value updated when WebSocket game_state message processed. platformRequest (action op) resolves with the action result; WebSocket broadcast fires separately AFTER the op completes. queueFollowUp uses nextTick (one Vue flush), which is NOT enough to await the WebSocket delivery."
  implication: "when startFollowUp runs, tutorialStep.value is still execute-capture (suppressAutoFill:true). The followUp's destination auto-fill is incorrectly suppressed."

- timestamp: 2026-06-29
  checked: "watch(currentPick) and watch(isReady) trigger conditions"
  found: "neither watcher depends on tutorialStep — they don't re-fire when tutorialStep changes from execute-capture to multi-jump-continue"
  implication: "once the broadcast arrives and tutorialStep updates, there is no mechanism to retry the suppressed auto-fill"

- timestamp: 2026-06-29
  checked: "existing R-04 unit test"
  found: "uses no tutorialStep option — isTutorialSuppressingAutoFill always returns false — auto-fill always succeeds"
  implication: "explains why the unit test passes while the live flow hangs"

## Resolution

root_cause: "In startFollowUp, fetchAndAutoFill→tryAutoFillSelection is called while tutorialStep still holds the execute-capture step (suppressAutoFill:true) because the game_state WebSocket broadcast has not yet arrived when queueFollowUp/nextTick fires. isTutorialSuppressingAutoFill returns true → destination not auto-filled → isReady=false → R-04 guard never fires. When the broadcast later updates tutorialStep to multi-jump-continue, no existing watcher retries auto-fill."
fix: "Add a watch on options.tutorialStep in useActionController. When suppressAutoFill changes from true to false and there is a pendingOnServer action with an unfilled currentPick: call tryAutoFillSelection, and if auto-fill succeeds and isReady, route through handleOnSelectFill (R-04 path). Add regression integration test that asserts pickStep NOT called before broadcast, then called after."
verification:
files_changed:
  - src/ui/composables/useActionController.ts
  - src/ui/composables/useActionController.picks.test.ts
