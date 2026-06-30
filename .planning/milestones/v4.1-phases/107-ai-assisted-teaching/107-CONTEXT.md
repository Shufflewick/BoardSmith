# Phase 107: AI-Assisted Teaching - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface checkers' EXISTING MCTS bot to players as three teaching aids — a move hint, a narrated AI-vs-AI demo, and a toggleable per-move evaluation heatmap — with **no new training, weights, or models**. This phase builds the reusable substrate (bot stats API, session narration/hint hooks, overlay rendering) in this repo; checkers-specific content wiring is deferred to Phase 109. Reuses the Phase 105 annotation overlay (TUT-01) for the hint highlight.

Requirements: AI-01 (move hint), AI-02 (narrated AI-vs-AI demo), AI-03 (evaluation heatmap).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — MCTS stats API & move hint
- Add `playWithStats()` to `MCTSBot` returning `{ move: BotMove; stats: Array<{ move: BotMove; visits: number; value: number }> }`, capturing the root node's children array BEFORE the search tree is discarded (`mcts-bot.ts:291–292` nulls `searchGame`/`rootSnapshot` today). The existing `play()` stays as the single-move path.
- A move hint is a **transient hint annotation** injected into game state via the session layer — usable OUTSIDE a running tutorial (not coupled to TutorialController step content). Reuses the TUT-01 annotation overlay ring/bubble.
- The hint highlights the suggested move's **target cell** (destination), anchored via the existing `data-bs-el-id` attribute.
- A hint is available at **any decision point in normal play** (per AI-01 success criterion), not only during a tutorial.

### Area 2 — AI-vs-AI narrated demo
- Narration text is **engine-derived** from the action name + args by default (e.g. "Player 2: move c3→d4"), with an OPTIONAL author hook to customize per-game wording.
- Add an `onBeforeMove` callback in `AIController`, fired between MCTS-compute and `runner.performAction()`, surfaced on `GameSession` so callers can announce the move before it executes.
- Pacing: announce, then execute after a **configurable delay (default ~1.2s)**.
- The demo reuses the existing all-seats AI mechanism (`AIConfig.players: [1,2]`) plus narration, exposed as a session/UI control. The known dev-host AI-turn bug (`dev-host-ai-open-seat-not-auto-playing.md`) is tracked separately and is not in scope here.

### Area 3 — Evaluation heatmap
- Render via a **new fixed-position overlay component** (analogous to TutorialOverlay) that reads the MCTS stats and draws chips over each candidate cell's `getBoundingClientRect()`, located via the shared `data-bs-el-id` anchors. Additive — no change to GridBoardRenderer, parity for free.
- Visualize the **normalized win-rate (value)** per candidate move's target cell.
- Visual encoding uses **intensity/opacity + a numeric badge** (non-color cue, WCAG 2.2 AA, v4.0 Slate tokens) — never color-only.
- Show only the **candidate move target cells** the MCTS actually evaluated, not the whole board.

### Area 4 — Parity, scope & testing
- All three features route through the shared `useBoardInteraction`/anchor layer so they render identically in a custom UI and AutoUI (project hard-rule). No per-renderer opt-in.
- **Substrate lands in this repo** (`src/ai`, `src/session`, `src/ui`): bot stats API, session hooks, overlay components. Checkers-specific wiring is deferred to Phase 109.
- These are **general player-aid features**, usable independently of a running tutorial.
- Verification: unit/integration tests in this repo using a test game and the symlinked checkers bot. Browser end-to-end is deferred to the Phase 110 demo gate.

### Claude's Discretion
- Exact method/option/event names, component file names, the chip layout and badge formatting, the precise default narration delay, and how `playWithStats` snapshots the root children are at implementation discretion, consistent with existing AI/session/Slate patterns.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MCTSBot.play(): Promise<BotMove>` and `createBot(...)` (`src/ai/mcts-bot.ts`, `src/ai/index.ts`); `BotMove = {action, args}` (`src/ai/types.ts:44`). Root tree carries per-child `visits`/`value` (`types.ts:58–87`) but is private and discarded after `play()`.
- TUT-01 annotation overlay: `TutorialOverlay.vue`, reads `gameState.value.state.tutorial.content` reactively; `Annotation { text, target?, placement? }`, `AnnotationTarget = {kind:'element',ref}|{kind:'action',actionName}|{kind:'panel'}` (`src/engine/tutorial/types.ts:81`). Highlights via `document.querySelector` on `data-bs-el-id/notation/name` from `anchorAttrs` (`useBoardInteraction.ts:408`).
- `AIController` (`src/session/ai-controller.ts`): `AIConfig {players:number[], level}`, `players:[1,2]` ⇒ all-AI; `checkAndPlay()` → `bot.play()` → `onMove()` → `runner.performAction()`; hardcoded 300ms delay (`:99`).
- Grid cells emit `data-bs-el-*` via `cellAttrs` (`GridBoardRenderer.vue:281`, `useSelectable.ts:151`) and toggle `is-board-highlighted` etc. — individually addressable.

### Established Patterns
- Game wires its bot through `GameDefinition.ai` (`BotAIConfig`) → `AIController` → `createBot`. Checkers AI = `getCheckersObjectives()` (objective-weighted engine MCTS, no custom search).
- Overlays mount once in GameShell `.boardregion`, position by measuring DOM rects (Phase 105 structural-parity pattern).

### Integration Points
- New `playWithStats()` on `MCTSBot`; consumed by hint + heatmap.
- Session: transient-hint annotation injection + `onBeforeMove` narration hook on `GameSession`/`AIController`.
- New heatmap overlay component in `src/ui/components/` mounted alongside TutorialOverlay.

### Gaps that MUST be built (from scout)
1. `MCTSBot.playWithStats()` — expose per-child visits + value before root tree discard.
2. Non-tutorial transient annotation injection for the hint.
3. Pre-move narration hook (`onBeforeMove`) in `AIController`/`GameSession`.
4. Per-cell heatmap overlay component (fixed overlay reusing `data-bs-el-id` anchors).
</code_context>

<specifics>
## Specific Ideas

- Success criteria reference checkers' bot at `~/BoardSmithGames/checkers/src/rules/ai.ts` specifically — exercise the substrate against the symlinked checkers game in tests.
- "AI" here means the built-in MCTS, NOT an LLM — no new external dependency (per PROJECT.md anti-goals).
</specifics>

<deferred>
## Deferred Ideas

- Checkers-specific teaching UI/content wiring → Phase 109.
- Browser end-to-end demonstration of all three features → Phase 110 (demo gate).
- Fixing the dev-host AI-vs-AI open-seat auto-play bug → tracked as a separate pending todo.
</deferred>
