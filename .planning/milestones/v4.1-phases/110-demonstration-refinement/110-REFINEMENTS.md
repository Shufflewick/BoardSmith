---
phase: 110-demonstration-refinement
type: refinement-capture
status: in-progress
created: 2026-06-29
---

# Phase 110 — Refinement Capture

Record friction points, bugs, and requests from the live demo session.
See `110-DEMO-SCRIPT.md` for the full walkthrough instructions.

---

## Beat 1 — Checkers Tutorial

### R-12 (QUESTION / scope) — Tutorial teaches mechanics only, no strategy
- **Observed:** the tutorial covers mandatory captures, multi-jump continuation,
  and turn-end — pure mechanics. The user expected (or wondered about) strategy
  content (center control, back-row defense, trading when ahead, building
  phalanxes, avoiding leaving pieces en prise, etc.).
- **Status:** working as designed — `CHECKERS_TUTORIAL` (109) was scoped to teach
  the four core MECHANICS (CHK-01/02/03 + confirm-turn), not strategy. Adding a
  strategy track is a content/scope expansion, not a bug.
- **DECISION NEEDED (product):** keep mechanics-only, or add strategy steps/a
  second tutorial track?

---

## Beat 2 — AI Move Hint

### R-15 (refinement, user) — No feedback during the ~1s MCTS search
- **Observed (user, live):** Beat 2 works, but "Get a hint" takes ~1 second before
  the bubble/ring appears (MCTS search). Nothing on screen indicates it's thinking,
  so the button feels unresponsive / possibly broken.
- **Fix (GameShell.vue, client-only):** the hint handler now shows a persistent
  "Thinking about the best move…" info toast (`duration:0`) immediately on click,
  removed in `finally` the instant the hint resolves or fails (just before the
  bubble/ring renders). Pure UI feedback; no server change.
- **Status:** implemented; NEEDS USER BROWSER CONFIRMATION (hard reload — client-side).

### R-09 (BLOCKING) — Hint shows nothing in the checkers custom UI
- **Observed (live):** "Get a hint" produced no ring, no bubble, no toast — nothing on screen.
- **Root cause (PROVEN live):** the server is correct — broadcast state carried
  `state.hint.annotation = { text:"Suggested: b2 → a1", target:{notation:"a1"} }`.
  But the checkers custom UI (`CheckersBoard.vue`) renders squares with only
  `data-piece-id`; it never emits the `data-bs-el-*` anchors that
  `HintOverlay`/`buildSelector` query. So the target `a1` could not resolve →
  no ring, and the bubble fell back to "below the board." Since `.boardregion`
  spans the full iframe height, "below the board" landed **behind the
  `.actionbar`** (confirmed via `elementFromPoint` → `DIV.actionbar`), so even
  the fallback bubble was hidden.
- **Fix:** export `anchorAttrs` from `boardsmith/ui`; bind
  `v-bind="anchorAttrs({ notation: squareToNotation(row-1,col-1) })"` on each
  checkers square. Now the ring + bubble attach to the a1 cell and are visible.
- **Parity note:** AutoUI already emits these anchors automatically (every
  renderer uses `useSelectable` → `anchorAttrs`). This was a custom-UI-only gap —
  the checkers reference game forgot the anchors. **Pit-of-Success follow-up:** a
  custom UI silently breaks ALL teaching overlays (hint/heatmap/tutorial-by-ref)
  if it doesn't spread `anchorAttrs`. Worth a lint/dev-warning or a shared
  board-cell helper so the right path is the easy path.
- **Verified live** (follow Seat 1): ring + "i" chip on a1, bubble "Suggested:
  b2 → a1" fully visible. Checkers 38/38.

---

## Beat 3 — AI-vs-AI Narrated Demo

<!-- Add friction, bugs, or requests here -->

---

### R-13 (bug) — "Show move quality" needed two clicks to turn on
- **Observed (user):** clicking the toggle once didn't turn it on; a second click did.
- **Root cause (proven live):** the toggle pill reflects only the broadcast
  `heatmap.visible`, which flips ~1s later when the MCTS search returns. With no
  immediate feedback the toggle looks dead, so the user clicks again — and because
  the first request hasn't broadcast yet, BOTH clicks read the stale "off" state
  and BOTH send visible:true, so it ends up on after "two clicks."
- **Fix (GameShell.vue, client-only):** optimistic toggle — `heatmapPending` holds
  the requested state while a toggle is in flight so the pill flips instantly;
  `heatmapToggling` ignores a duplicate request mid-flight. The broadcast arrives
  before the op response resolves (WS order), so clearing the optimistic value in
  `finally` hands back to authoritative server state with no flicker.
- **Verified live (deterministic):** invoking the real handler flips
  `isHeatmapVisibleProp` synchronously (true→false before any round-trip);
  after the response, pending=null/toggling=false with server state authoritative.
  Client-side → hard reload applies it. BoardSmith 1664/1664.

## Beat 4 — Evaluation Heatmap

### R-10 (BLOCKING) — "Show move quality" renders nothing in the checkers custom UI
- **Observed (live):** the toggle turns ON (so the server DID compute + broadcast
  `state.heatmap = { visible:true, entries:[…] }`), but zero chips appear.
- **Root cause:** same as R-09 — `HeatmapOverlay` resolves each `entry.cellRef`
  (a `{notation}`) via `buildSelector` → `[data-bs-el-notation="…"]`, which the
  checkers board never emitted. `resolvedChips` was empty → overlay root rendered
  with no children.
- **Fix:** same anchor fix as R-09 (square `data-bs-el-notation`). Chips now render
  (e.g. 29% best / 23% others). **Verified live.**

### R-11 (discovered, NOT yet fixed) — Heatmap goes stale; never recomputed/cleared after a move
- **Observed:** with the heatmap left ON across moves, chips persist on cells that
  are no longer legal (showed b6/c5/e5/g5 while the only legal moves from b2 were
  a1/c1). Confirmed in broadcast state: `heatmap.entries` notations did not match
  `availableActions`.
- **Root cause:** production `GameSession.performAction` explicitly clears the
  **hint** as stale (`this.#hint.delete(player)`, game-session.ts:1226) but does
  NOT clear or recompute the **heatmap**. Dev host (`snapshot-session-host.ts`)
  clears hint on action too, but not heatmap. So a visible heatmap is frozen at
  the position where it was first toggled on.
- **DECISION (user):** recompute each turn (best UX).
- **R-11 → FIXED (2026-06-29, BoardSmith):** added per-turn heatmap refresh in
  BOTH layers — `GameSession.#refreshVisibleHeatmaps()` (called in performAction
  after the tutorial auto-advance, before the AI is scheduled) and
  `SnapshotSessionHost.refreshVisibleHeatmaps()` (called after runAITurns). For
  the seat now on turn the heatmap is recomputed (`#computeHeatmapEntries` /
  re-running the `heatmapToggle` op, both gated by `canSeatAct`); for any other
  seat with a visible heatmap the stale entries are cleared while the overlay
  stays toggled on. Recompute is guarded against an overlapping search / AI
  thinking.
- **Tests:** +1 dev-host regression (`snapshot-session-host.test.ts` Test 3b —
  recompute on the owner's action, call-count proof) and +1 production
  regression (`teaching.test.ts` — clears off-turn, recomputes back on turn).
  BoardSmith session suite 291/291.
- **Verified live** (restarted dev host, follow Seat 1): opening chips on
  a5/c5/e5/g5 → after P1 moves d6→c5 the chips clear on P2's turn → after P2
  replies the chips recompute for the new position (a5/e5/g5/d6/**b4**). The
  b4 chip is new — it tracks the piece that advanced to c5. Server-side change →
  **dev host must be RESTARTED** (Vite HMR doesn't pick up src/session/*).

---

## Dock interaction

### R-16 (BLOCKING) — Action-dock destination buttons do nothing on click
- **Observed (user, live):** in the Move action's secondary (destination) selection,
  clicking a destination button in the action dock (e.g. "e5"/"g5") does nothing.
  Moving forward only works by clicking the square on the board.
- **Root cause (PROVEN):** the inline anchored-choice button
  (`ActionPanel.vue`) routed its click through
  `boardInteraction?.triggerElementSelect({ notation: choice.refs.find(first notation) })`.
  For a checkers destination choice the FIRST notation ref is the **source** square
  (`fromNotation`, role:'source'), which is shared by every destination from the same
  piece — so it can never disambiguate the target. And in any UI without a custom
  board (AutoUI), `boardInteraction` is absent, so the optional-chained call was a
  silent no-op. The board click worked because clicking the actual target square
  resolves the correct choice directly.
- **Fix (ActionPanel.vue):** the anchored-choice button now calls
  `executeChoice(currentPick.name, choice)` — the exact same handler the primary
  choice buttons use — resolving the specific choice it represents via
  `controller.fill()`. No board round-trip, no notation ambiguity. Parity: works in
  custom UI and AutoUI, board click and dock button.
- **Test:** `ActionPanel.interaction.test.ts` C3 — mounts the panel with a filterBy
  destination whose choices carry source+target refs and NO boardInteraction provided,
  clicks the "c5" anchored button, asserts `sendAction` fires once with
  `destination.toNotation === 'c5'`. Proven RED (sendAction never called) → GREEN.
- **Status:** implemented + tested. Client-side → NEEDS USER BROWSER CONFIRMATION (hard reload).

---

## Beat 5 — Action Help

### R-14 (BLOCKING) — Action help shows nothing; toggle has no visible effect
- **Observed (user, live):** "I don't know where I would see this. Nothing is
  different on screen between turning action help ON vs OFF."
- **Root cause (PROVEN):** the Phase 108 substrate is correct, but the "?" affordance
  only renders when an action actually has help text —
  `ActionPanel.vue:815` `v-if="isActionHelpVisible && (action.help || disabledActions?.[action.name])"`.
  The checkers `move` and `endTurn` actions (`~/BoardSmithGames/checkers/src/rules/actions.ts`)
  **never authored `.help()`**, so `action.help` is undefined and no "?" ever shows —
  toggling the global flag has nothing to reveal. Same class of bug as R-09/R-10:
  the checkers reference game forgot to use a substrate feature.
- **Fix (checkers repo):** added `.help(...)` to both actions —
  `move` → "Pick one of your pieces, then a highlighted destination square…",
  `endTurn` → "Confirm your move and pass play to your opponent. You can Undo until…".
  Now the "?" renders on each action and the global toggle hides/shows it.
- **Status:** implemented in checkers; NEEDS USER BROWSER CONFIRMATION (hard reload).
- **Pit-of-Success follow-up (substrate) → IMPLEMENTED (R-14b):** a game with zero
  `.help()` text made the global "Show action help" toggle a silent no-op — it looked
  broken (exactly what the user hit). Now the toggle is HIDDEN entirely when no
  currently-available action has help text or a disabled reason. New `hasActionHelp`
  prop on `ControlsMenu` (defaults true), driven by a `GameShell.hasActionHelp` computed
  that mirrors ActionPanel's exact "?"-render condition
  (`actionMetadata[name].help || disabledActions[name]`). Tests: `ControlsMenu.action-help.test.ts`
  E (hidden when false) + F (shown when true). The toggle is never present-but-inert.

---

## Beat 6 — AutoUI Parity

<!-- Add parity gaps between custom UI and AutoUI here -->

---

## Backlog (for CRIB milestone)

<!-- Larger requests that are out of scope for Phase 110 -->

---

## Overall Notes

<!-- General observations about the teaching system -->

## DEMO-01 findings (2026-06-29, live browser run — checkers, custom UI)

### R-01 (BLOCKING) — Tutorial does not load its deterministic preset position
- **Observed:** Starting the tutorial shows the STANDARD 24-piece opening with a simple non-capture move highlighted (d6→c5/e5), and step 0 immediately shows the capture-tip "A capture is available — you MUST take it!" when NO capture exists.
- **Root cause (hypothesis, to prove):** the live `start-tutorial` op starts the tutorial on the currently-running game (standard new game) and never applies the checkers `tutorialSetup` preset. The 109 CI test passed because `simulateTutorial` was given a `TestGame` constructed with `tutorialSetup: true`; the launch path has no equivalent — the preset and the launch diverge.
- **Required fix:** when the tutorial launches, the game must be set to the tutorial's deterministic starting position (capture-first). Likely needs a "tutorial starting position/setup" carried by the TutorialDefinition (or game registration) that `startTutorial` applies by resetting the runner to a fresh game with that setup. Cross-repo (substrate launch + checkers preset exposure).

### R-02 (BLOCKING) — No way to exit/leave the tutorial once started
- **Observed:** Once the tutorial starts there is no control to leave it.
- **Required fix:** add a stop/exit-tutorial op + UI control (e.g. "Exit tutorial", or make the ControlsMenu item toggle Start↔Exit while a tutorial is running) that clears the seat's tutorialProgress and returns to normal play.

### Resolution (2026-06-29)
- **R-01 → FIXED** (BoardSmith `0b59c1a` + checkers `95d74ea`): added `TutorialDefinition.setup?(game)` hook, applied in both the `startTutorial` op (dev host) and `TutorialController.start()` (production); checkers `CHECKERS_TUTORIAL.setup` calls a new public `resetToTutorialPreset()`. Starting the tutorial now loads the deterministic capture-first preset, so the mandatory-capture tip is truthful. +7 tests.
- **R-02 → FIXED** (BoardSmith `cfe3b50`): symmetric `exit-tutorial` op (engine `TutorialController.exit` already existed) wired through bridge + stateless-ops; ControlsMenu Tutorial button now toggles Start↔Exit off the broadcast `tutorialStep` signal. +7 tests.
- Suites: BoardSmith 1640/1640, checkers 38/38.
- **NOTE:** the dev-host CLI node process must be RESTARTED (not just a browser reload) to pick up the stateless-ops/bridge substrate changes — Vite HMR only refreshes the browser/Vue layer.

### R-01 follow-up (UX framing, non-blocking)
- The deterministic preset works (board now shows the minimal capture-first position). User read it as "fast-forwarded to few pieces." Functionally correct/intended. OPTIONAL refinement: frame it for the learner (e.g. an intro step "Here's a practice position" / a distinct tutorial-board treatment) so it doesn't read as a mid-game jump. Captured for consideration; not blocking.

### R-03 (BLOCKING) — Tutorial annotation bubble is unreadable + wrong z-order
- **Observed:** the step annotation ("Captures are mandatory – you must jump!") renders as faint red text in a low-contrast box OVERLAPPING the board cells; pieces in those squares render ABOVE the bubble, obscuring it further.
- **Two defects:** (1) contrast/legibility — faint red-on-board text + translucent box (the BoardMessage 'annotation' variant styling); (2) z-order/stacking — the bubble sits below board pieces instead of above them, and overlaps the play area.
- **Required fix:** the annotation bubble must be clearly readable (solid/high-contrast background + ink color per Slate tokens, WCAG AA) and stack ABOVE pieces (correct z-index / not trapped in the board stacking context), ideally not obscuring active cells. Prove root cause in TutorialOverlay.vue / BoardMessage.vue (annotation variant) before fixing.

### R-03 → FIXED (2026-06-29, checkers repo)
- Replaced the hand-rolled `.capture-notice` div (hardcoded faint-red rgba/hex, no z-index → buried under pieces) with the BoardSmith `BoardMessage` primitive: Slate tokens (`--bsg-surface-2`/`--bsg-ink`, WCAG-AA), `z-index:5` (above `.piece` z-1), non-reflowing. Same `v-if` condition → `:visible`. −15 lines (literals removed). Checkers 38/38 green.
- This was the checkers game's OWN capture indicator, not the tutorial annotation (which teleports to body at z-20 and was already correct).
- HMR-friendly: a Vue-layer change, so a browser reload applies it (no CLI restart needed, unlike R-01/R-02).

### R-04 (BLOCKING) — Tutorial gets stuck after the first move (multi-jump continuation)
- **Observed:** preset loads correctly (R-01 fixed) and bubbles are readable (R-03 fixed), but after making the first move the tutorial is STUCK. Top annotation reads "Jump to d4 to capture!"; bottom capture-notice "Captures are mandatory — you must jump!"; a piece/landing square is highlighted but the player cannot proceed.
- **Key divergence:** the 109 CI test (`simulateTutorial`, 38/38 green) completes the full walkthrough by scripting `doAction` with full args, but the LIVE UI selection flow (piece → destination round-trips) gets stuck — so the bug is in the live multi-jump continuation path, not the headless script. Suspects: (a) per-selection destination gate blocks the only legal continuation move; (b) auto-advance not firing at the right moment in the live selectionStep path leaving a stale step whose gate blocks the next move; (c) stale annotation ("Jump to d4" after the jump already happened). Relates to the Phase 109 followUp-vs-auto-advance limitation, now live in the dev host.
- **Required:** prove the root cause by reproducing the UI-driven multi-jump (selection-step flow), not just the scripted doAction; fix so a player can complete the forced multi-jump live.

### R-04 → FIXED (2026-06-29, BoardSmith `997f2d2`)
- Root cause: in `useActionController.startFollowUp`, `pendingOnServer=true` is set before `fetchAndAutoFill`; when all remaining selections auto-fill to a single legal choice, `isReady` flips true but the auto-execute watcher's `!pendingOnServer` guard permanently blocks submission → continuation filled locally, never sent → stuck.
- Fix: after `fetchAndAutoFill` in `startFollowUp`, if `isReady && autoExecute && !isExecuting && pickStep`, route the first auto-filled selection through `handleOnSelectFill` (selection-step transport) so the server completes the action. Tight guards leave all other flows unchanged.
- **NOT tutorial-specific:** NORMAL checkers forced multi-jump with a single legal continuation was ALSO stuck. This is a shared-controller substrate fix benefiting all games (parity: both custom UI + Action Panel). Surfaced by DEMO-01.
- +3 regression tests (selection-step followUp path, which the 109 CI doAction-based test did not exercise). BoardSmith 1643/1643, checkers 38/38.
- HMR-friendly: a Vue composable change → browser reload applies it (no CLI restart needed).

### R-04 → REALLY FIXED (2026-06-29, BoardSmith `b7776b5`) — supersedes the insufficient 997f2d2
- TRUE root cause: a `tutorialStep` timing race. `execute-capture` has `suppressAutoFill:true`; `startFollowUp` runs (via nextTick) BEFORE the game_state WS broadcast updates `tutorialStep` to `multi-jump-continue`. So auto-fill is suppressed (stale step) → isReady stays false → the original auto-execute watcher AND the 997f2d2 guard both miss. When the broadcast later clears suppression, nothing re-triggers fill → permanent hang.
- Why prior fix failed: its guard `if (isReady && ...)` evaluated at the same stale-step moment (isReady=false).
- Why the unit test passed: it never set `tutorialStep`, so suppressAutoFill was never true → no race.
- Fix: a watcher on `options.tutorialStep` in `useActionController` that, when `suppressAutoFill` flips true→false while a `pendingOnServer` followUp has an unfilled currentPick, retries `tryAutoFillSelection` + `handleOnSelectFill`. Substrate layer → parity (custom UI + Action Panel).
- Verification: integration regression test (R-04 block) that FAILS without the watcher and PASSES with it — captures the real broadcast-after-startFollowUp timing. BoardSmith 1644/1644, checkers 38/38.
- Client-side change → HARD browser reload picks it up (server restart not required, but harmless).

### R-04 → CONFIRMED FIXED by user (server restart + hard refresh; multi-jump completes). ✅

### R-05 (QUESTION + possible refinement) — Undo offered during the tutorial confirm step
- After completing the multi-jump, the tutorial confirm-turn step shows "Well done! Click End Turn" but BOTH End Turn AND Undo are available. User asks: why is Undo there when they've "taken their turn"? (Note: it is still Player 1's turn until End Turn commits — "Your move" shown.) Need to state the ENGINE rule for when Undo is offered (verify in code), and decide whether the tutorial should suppress Undo during guided steps.

### R-06 (BLOCKING bug) — "No options available" shown while options ARE present + spurious post-multijump move
- After the multi-jump, selecting/entering the Move action with the b2 piece shows the action panel: "Move | b2 | Select destination — *No options available*" YET simultaneously renders two valid choices "a1 → King" and "c1 → King". The empty-state text is wrong (options exist).
- Also questionable: after a COMPLETED forced multi-jump, why is a further (non-capture promotion) move b2→a1/c1 being offered at all? In checkers the jump sequence is the turn; the player should End Turn, not get an extra slide. Investigate whether this is a checkers-rules/flow bug or a tutorial-state artifact, AND the ActionPanel empty-state condition bug.

### R-05 → ANSWERED (no fix): Undo during confirm step is correct engine behavior
- Rule (`src/session/utils.ts:375`): `canUndo = isMyTurn && actionsThisTurn>0 && currentPlayer===you && !hasNonUndoableAction`. Still your turn until End Turn commits; Undo = take back uncommitted moves. Hiding Undo during a tutorial step is NOT possible today (tutorial gating covers game actions only, not session canUndo) → optional future refinement (new session hook), out of scope.

### R-06 → FIXED (2026-06-29, BoardSmith) — stale choice-fetch race + missing loading guard
- Rules/flow were correct (move blocked after jump sequence; only endTurn legal). The a1→King/c1→King + "No options available" were an async race: an in-flight `fetchChoicesForPick` resolved against post-completion state and rendered stale promotion slides; the `choice` template had no loading guard.
- Fix (useActionController.ts): `choiceFetchGen` generation counter bumped in `clearAdvancedState`; `fetchChoicesForPick` captures the gen pre-await and discards the result if it changed. (ActionPanel.vue): loading guard on the choice+filterBy template ("Loading choices..." vs "No options available"). +3 regression tests. R-04 path intact. BoardSmith 1647/1647, checkers 38/38. Client-side → hard reload to load.

### R-06b → FIXED (2026-06-29, BoardSmith) — "No options available" for board-anchored choice destinations
- **Re-surfaced during re-test:** the checkers Move destination picker (a `choice` pick with `filterBy`) still showed "Select destination — No options available" while the valid destination buttons (e.g. f4/h4, or the multi-jump b2) rendered right below in the "Select on board or choose here:" list.
- **Root cause (proven, not the R-06 fetch race):** `splitAnchoredChoices` routes every notation-anchored choice into `anchoredChoices`; `filteredChoices` (= primary/unanchored) is therefore EMPTY for checkers, since every destination square has a notation. The `choice + filterBy/dependsOn` template's empty-state (ActionPanel.vue) checked only `filteredChoices.length === 0` → it always rendered "No options available" for board-square destinations. R-06's loading guard didn't catch it because the fetch COMPLETED with choices — they just landed in the anchored bucket.
- **Fix (ActionPanel.vue):** gate both the loading indicator and the "No options available" empty-state on `filteredChoices.length === 0 && anchoredChoices.length === 0`, so the message only shows when BOTH lists are genuinely empty.
- **Test:** new C2 regression in `ActionPanel.interaction.test.ts` — mounts the real panel with a `filterBy` destination whose choices ALL carry notation refs; FAILS pre-fix ("…Pick destination No options available Select on board or choose here:a5c5"), PASSES post-fix. ActionPanel + controller suites 283/283. Verified live in browser. Client-side → hard reload (HMR applied).

### R-07 → FIXED (2026-06-29, BoardSmith) — tutorial hangs on the first move (stale action survives the setup() board reset)
- **The real hang** (my earlier "stale Safari JS" guess was WRONG — user shut down the server and I reproduced it myself as the genuine Seat 1 client). Repro: fresh STANDARD checkers game → "Start tutorial" → click the preset piece → the panel stays on "Select a piece to move", the move never reaches the server (no log entry, no piece-count change), tutorial frozen on step-2 ("Jump to d4"). Exactly the user's screenshot.
- **Root cause (PROVEN via console):** on entering the seat the sole `move` action is **auto-started** against the standard opening; its piece-select choices are the standard front-row pieces (element IDs 77/78/79/80 = b6/d6/f6/h6). Starting the tutorial runs `CHECKERS_TUTORIAL.setup` → `resetToTutorialPreset()`, which **deletes those pieces and creates the preset pieces**. The client kept the stale in-progress action, so clicking the new preset piece matched none of the dead choices and the action could never advance. Console smoking gun: `[actionController] Element 77 (b6) not found in gameView … removed after selection metadata was built` (×77/78/79/80). This is why follow-mode (a client that JOINED after the preset already existed) never hung — its metadata was built against the preset.
- **Fix (useActionController.ts):** the existing `tutorialStep` watcher now also handles the inactive→active transition — when the tutorial turns on, cancel any non-server-pending in-progress action so the UI re-starts it fresh against the new board. Tight guards: only fires on `!oldStep && !!newStep`; never tears down a server-pending followUp chain; step→step advances (defined→defined) are untouched, so the R-04 suppress-lift continuation path is preserved.
- **Tests:** `useActionController.test.ts` Case D (R-07) — turning the tutorial on resets a stale action (RED without fix: stays 'movePiece'); Case E (guard) — step→step advance does NOT reset. BoardSmith 1650/1650, checkers 38/38.
- **Verified live end-to-end** (real Seat 1, instrumented Chrome): standard game → Start tutorial → b6→d4 (executes server-side) → d4→b2 auto-continues (R-04 watcher) → "Well done! Click End Turn" → End Turn → AI replies → b2→King move renders a1/c1 cleanly (R-06b). No hang at any step.
- Client-side composable change → **hard reload** required to apply (Vite composable HMR is unreliable).

### R-08 → FIXED (2026-06-29, BoardSmith + checkers) — multi-jump doesn't auto-end the turn (stray End Turn + Undo)
- **User question:** during the tutorial, after the forced multi-jump the seat lands on a manual "End Turn" with an **Undo** button — but in normal play (with "Auto end turn" on) the turn commits instantly and there is no Undo. Why only in the tutorial?
- **Root cause (proven by code + live A/B):** it is NOT tutorial-specific — it's **multi-jump**-specific. A single move completes through `executeCurrentAction`, which toggles `isExecuting`; the board bridge watches that toggle and auto-executes the sole no-selection `endTurn` (turn commits, no Undo). A multi-jump's final hop instead completes through the **selection-step / followUp transport** (`handleOnSelectFill`), which NEVER toggles `isExecuting`, so the auto-end trigger never fires → the turn is left "moved but not committed" → Undo is offered. A normal (non-tutorial) multi-jump behaves identically; the tutorial just always ends in one. Empirically confirmed live: a normal single move (g3→f4) auto-committed with no Undo, while the tutorial multi-jump stopped at End Turn + Undo.
- **Fix (substrate):** the controller pulses a new `actionCompletedTick` when an action fully completes via the selection-step path with no further followUp (i.e. the capture chain is done — NOT mid-chain). The board bridge watches it and runs the same `scheduleAutoStart(false)` that the `isExecuting` toggle drives — so a sole no-selection `endTurn` auto-executes after a capture chain exactly as after a single move. Parity for all games, both transports.
- **Fix (checkers tutorial):** reworded the `confirm-turn` step from "Well done! Click End Turn to confirm your move." → "Nice — the capture chain is complete, so your turn ends automatically." (the step/gate/advanceWhen are unchanged; only the now-inaccurate instruction text). With auto-end on, the turn commits automatically and the tutorial completes — no manual End Turn, no Undo.
- **Tests:** new bridge regression (`useBoardActionBridge.test.ts`) — pulsing `actionCompletedTick` auto-executes a sole no-selection `endTurn`. BoardSmith 1651/1651, checkers 38/38.
- **Verified live end-to-end** (following Player 1 = genuine Seat 1 GameShell): tutorial multi-jump b6→d4→b2 auto-ends the turn → play passes straight to Player 2, no End Turn / Undo shown. Client-side → hard reload to apply.

## DEMO-01 status (2026-06-29)
- Verified by user: R-01, R-02, R-03, R-04 (multi-jump auto-continue). Fixed+tested+verified-live by agent: R-06b (false "No options available"), R-07 (first-move hang — the actual blocker), R-08 (multi-jump didn't auto-end the turn → stray End Turn + Undo). Answered: R-05.
- Note: the checkers capture-notice ("Captures are mandatory — you must jump!") lingers on the confirm-turn step where no capture exists — minor stale-indicator cosmetic, separate from the hang. Captured for later.
- Still to demo: AI move hint, AI-vs-AI narrated demo, evaluation heatmap, action-help reveal/toggle; full pass in AutoUI. Then milestone lifecycle (audit→complete→cleanup).
