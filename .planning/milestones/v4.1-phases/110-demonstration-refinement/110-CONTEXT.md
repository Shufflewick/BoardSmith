# Phase 110: Demonstration & Refinement - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Make ALL teaching features demonstrable end-to-end in the `boardsmith dev` host, then conduct the hands-on, user-driven refinement checkpoint (DEMO-01). The dev host runs through `SnapshotSessionHost`/`stateless-ops` (NOT the production `GameSession`), so the Phase 107 AI teaching features (hint, heatmap, AI-vs-AI narrated demo) are currently unreachable there — this phase wires them through the dev-host path (mirroring the Phase 109 `start-tutorial` op). The checkers tutorial (109), action-help (108), and `--ai` opponents already work in the dev host. After the wiring lands, the milestone-closing demonstration + refinement capture is the user's hands-on browser session.

Requirement: DEMO-01 (demonstrate the checkers tutorial + all teaching features TUT/AI/HELP end-to-end in the browser as the refinement gate).
</domain>

<decisions>
## Implementation Decisions

### Scope (user decision, 2026-06-29): BUILD EVERYTHING including the demo loop
All five teaching beats must be demonstrable live in the dev host. Build the full dev-host wiring; do NOT defer the AI-vs-AI demo loop.

### Area 1 — Un-hide the Teaching controls in platform mode
- The Teaching group (hint/demo/heatmap) in ControlsMenu is gated on `showHint !== undefined`, and `showHintProp` derives from `lobbyInfo` which is ALWAYS null in platform mode (GameShell iframe). Fix: signal AI availability through the dev-host broadcast — set a `hasAIPlayers` (or equivalent) flag in `buildPlayerState`/the snapshot playerViews when any seat is AI, and base `showHintProp` on that broadcast signal in platform mode (not `lobbyInfo`). Production (lobby) path keeps working.

### Area 2 — Wire `hint` + `heatmap-toggle` ops through the dev-host path
- Mirror the Phase 109 `start-tutorial` three-file pattern: add wire ops to `bridge.ts` (`WireOp` union + `translateOp` case + `shapeResult` case), Op types + `executeOp` cases in `stateless-ops.ts`.
- Reuse the existing ephemeral-bot infra (`handleAITurn`'s `createBot(runner.game, …)`): `hint` → `bot.play()` → build the hint annotation; `heatmap-toggle` (visible=true) → `bot.playWithStats()` → build `HeatmapEntry[]`.
- **Transient-state persistence:** add a `transientTeachingState: Map<seat, {hint?, heatmap?}>` to `SnapshotSessionHost` (these are NOT in the snapshot) and merge it into playerViews on EVERY broadcast — replicating `GameSession.broadcast()`'s post-`buildPlayerState` injection (hint clears on the seat's next action; heatmap clears on state replacement/undo).

### Area 3 — Wire `demo-start`/`demo-stop` (the AI-vs-AI narrated demo loop)
- The narrated demo is a stateful, timed loop that the stateless `executeOp` model can't express alone. Build a **demo coordinator** in the snapshot/CLI layer (`SnapshotSessionHost` and/or `MultiplayerHost`): on `demo-start`, run all seats as AI in a delayed loop (reuse the `runAITurns`/`handleAITurn` ephemeral-bot path), inject the engine-derived narration text (the Phase 107 `onBeforeMove` semantics — announce the move, wait the configurable delay, then execute) into the broadcast playerViews; `demo-stop` halts the loop and restores normal play.
- Reuse Phase 107's narration formatting + default delay. The loop must be cancellable, must not leave a background timer running after `demo-stop` or game end, and must broadcast narration before each move executes.

### Area 4 — The demonstration + refinement capture (user-driven gate)
- After the wiring lands and both suites are green, the autonomous build pauses and HANDS OFF to the user for the live browser demonstration (success criterion #4 — a hands-on refinement checkpoint). I prepare a concrete demo script/checklist and ensure `cd ~/BoardSmithGames/checkers && npx boardsmith dev` launches cleanly, then the user walks: checkers tutorial (all 4 beats), AI hint, AI-vs-AI narrated demo, evaluation heatmap, and action-help (hover/tap + global toggle) — in BOTH the custom checkers UI and AutoUI.
- Observed friction + requested refinements are captured (into the phase artifacts / a refinement list) to inform the substrate before the future cribbage (v2 CRIB) milestone. This is a refinement checkpoint, NOT a sign-off.

### Claude's Discretion
- Exact wire-op names + payloads; the precise `hasAIPlayers` signal mechanism; where the demo coordinator lives (`SnapshotSessionHost` vs `MultiplayerHost`); the transient-state Map shape; and the demo loop's cancellation/cleanup approach — all at implementation discretion, consistent with the Phase 109 op pattern + Phase 107 GameSession teaching semantics. Keep parity (custom UI + AutoUI) and fail-loud (clear errors when no AI/bot is available).
</decisions>

<code_context>
## Existing Code Insights (from scout)

### Dev-host path (the target to wire)
- `boardsmith dev` → `dev.ts` WS server → `MultiplayerHost.handleServerRequest` (`multiplayer-host.ts:307`) → `bridge.ts handleServerRequest`/`translateOp` (`:93-269`) → `SnapshotSessionHost.handleOp` (`snapshot-session-host.ts:47`) → `stateless-ops.ts executeOp`. NO `GameSession` in the dev host (it's a production-only Durable Object).
- `start-tutorial` wiring (Phase 109) is the template: `bridge.ts` WireOp `:27` + translateOp `:127` + shapeResult `:193`; `stateless-ops.ts` Op union `:61` + `executeOp case startTutorial :749-769` (reconstruct runner via `runnerFromSnapshot`, mutate snapshot state, `autoAdvanceTutorial`, return `stateEnvelope`).
- Ephemeral bot infra: `stateless-ops.ts handleAITurn :430-484` creates `createBot(runner.game,…)` per AI turn, `bot.play()`. Sufficient for hint (`bot.play()`) and heatmap (`bot.playWithStats()`); blocker is result PERSISTENCE, not bot construction.
- `--ai` flag → `designatedAiSeats` in MultiplayerHost → `aiSeats` in `createDevSession` → `executeOp({type:'aiTurn',seats})`. Proves the bot infra works end-to-end in dev.

### Phase 107 production semantics to replicate (GameSession, WS-only)
- `requestHint`/`clearHint`/`setHeatmapVisible`/`startDemo`/`stopDemo`/`onBeforeMove`. `#hint`/`#heatmap` Maps (private, not snapshot) injected in `broadcast()` AFTER `buildPlayerState()` (`:1923-1934`); hint cleared in `performAction` (`:1231`) + undo (`:312`). `startDemo` (`:1118`) builds an all-seats AIController + `#onBeforeMove` closure + `#scheduleAICheck()` with `demoDelay`.

### UI gating to fix
- `GameShell.vue:694` `showHintProp = lobbyInfo?.slots?.some(aiLevel!=null) ? true : undefined` — null in platform mode. `ControlsMenu.vue:266` `v-if="showHint !== undefined"` hides the whole Teaching group in dev.

### Already works (no build)
- Action-help (108): `actionMetadata.help` + `disabledActions` flow via broadcast; `help-toggle` is client localStorage. `stateless-ops.ts buildViews` uses `includeActionMetadata:true` (`:152`).
- `start-tutorial` (109): fully wired through the dev-host path incl. `autoAdvanceTutorial`.
</code_context>

<specifics>
## Specific Ideas

- This is the FINAL phase of v4.1 and the user's explicit "demonstrate to me so we can refine" gate before the deferred cribbage (v2 CRIB) milestone. Frame the demo as refinement, not sign-off.
- Carry-forward browser UATs from Phases 108 + 109 (action-help pointer/tap/persistence; checkers tutorial end-to-end) are validated AS PART OF this demonstration.
- The dev-host teaching wiring is reusable substrate — it also benefits the future cribbage tutorial.
</specifics>

<deferred>
## Deferred Ideas

- Applying the tutorial/teaching primitives to cribbage → future v2 CRIB milestone.
- Any refinements the user requests during the demo that are larger than quick fixes → captured as backlog/todos for CRIB or a follow-up, not necessarily built in this phase.
</deferred>
