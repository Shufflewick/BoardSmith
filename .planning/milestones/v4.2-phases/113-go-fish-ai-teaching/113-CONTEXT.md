# Phase 113: Go-Fish AI Teaching - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Surface go-fish's EXISTING MCTS bot as two teaching aids — a move HINT and a narrated AI-vs-AI DEMO — reusing the v4.1 substrate (Phase 107 hint/demo machinery + Phase 110 demo wiring) with NO new training/weights/models. The hint surfaces its target on cards/hand via `anchorAttrs` (the Phase 112 fix already emits `data-bs-el-id`/`data-bs-el-name` on hand cards), proving card-game parity with checkers' board-square anchoring. The evaluation heatmap is board-only and explicitly OUT of scope (documented in DOC-03, Phase 115).

Content lands cross-repo in `~/BoardSmithGames/go-fish` (node_modules/boardsmith symlinked — live, no re-vendor). `.planning/` stays in BoardSmith. No BoardSmith `src/` changes expected unless a real substrate gap is found (flag + fix, no workaround).

Requirements: GFAI-01 (move hint highlights the suggested ask's target on cards/hand), GFAI-02 (narrated AI-vs-AI demo announcing each move before it executes).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Move-Hint Target
- The hint highlights **the learner's cards of the suggested rank** — the `card-group` div in their own hand ("ask for 7s → here are your 7s"), the most instructive target for a card game.
- **Make the rank group overlay-addressable:** emit `anchorAttrs({ name: rank })` (→ `data-bs-el-name="7"`) on the `card-group` div in `GameTable.vue`. This reuses the exact overlay resolution the tutorial uses (`overlay-utils.buildSelector` → `[data-bs-el-name="…"]` via `HintOverlay`).
- **Hook:** `getGoFishHintTarget(move) => ({ name: move.args.rank })` in `ai.ts`, wired into `gameDefinition.ai.hintTargetFromMove` (mirrors checkers' `hintTargetFromMove`). The hook receives ONLY the `BotMove` (`{ action:'ask', args:{ target: seat, rank } }`) — no game state — so a rank-keyed `{ name }` is the correct resolvable ref (a specific card id is NOT derivable from the hook).
- **Fallback:** if no target resolves, the substrate shows a floating hint bubble with no ring — never fake a target.

### Area 2 — Narrated AI-vs-AI Demo
- Use the **substrate's engine-derived default narration** ("Player N: ask …"). Add a go-fish per-game narration hook for nicer wording ("Player 2 asks Player 1 for 7s") ONLY if the substrate exposes a cheap per-game hook; otherwise keep the default. Do not build new narration plumbing.
- **Pacing:** substrate default (~1.2s announce-then-execute).
- **Demo-stop correctness:** rely on the substrate's `demoAbort` (checked before AND after the delay, Phase 110-03) — no go-fish code. No orphaned state on stop.
- **Heatmap:** out of scope (board-only); documented as board-only in DOC-03.

### Area 3 — Scope, Tests & Parity
- **Tests:** go-fish unit test for `hintTargetFromMove` (mirror `checkers/tests/hint-target.test.ts`) asserting an ask `{target,rank}` → `{ name: rank }`; plus a demo/narration test exercising the AI-vs-AI loop. Assert the hint annotation resolves to the rank group.
- **Browser verification:** a human-verify checkpoint (like 112-04) — confirm the hint ring lands on the learner's rank cards (GFAI-01) and a narrated demo announces each ask before it executes (GFAI-02), in the `boardsmith dev` host. Kill the dev server after.
- **BoardSmith `src/` changes:** none expected (substrate is ready per the scout). Only if a real gap surfaces — flag + fix in BoardSmith with a test, never a go-fish workaround.
- **R-06 (hint clears on next action):** rely on the substrate (`game-session.performAction` deletes `#hint`); verify, no go-fish code.

### Claude's Discretion
- Exact hook function name/placement; the precise rank-anchor binding on the card-group; whether the optional go-fish narration hook is worth adding (use it only if the substrate makes it a one-liner); test file names; the browser-checkpoint script details.
</decisions>

<code_context>
## Existing Code Insights (from scout)

### BoardSmith hint/demo substrate (v4.1 — reuse as-is)
- HINT request: `GameShell.vue:816` `platformRequest('hint', { seat })`; `ControlsMenu.vue:303-324` "Get a hint" (gated by `showHint`, disabled by `hintDisabled`). Session: `game-session.ts:972` `requestHint(seat)` → ephemeral `bot.play()` → `#extractMoveTarget(move)` (`:943-955`) → `Annotation` in `#hint` → broadcast.
- `#extractMoveTarget(move)` uses `this.#botAIConfig.hintTargetFromMove(move)` if defined; else falls back to DEST_ARGS (`to/destination/target/square/cell/position`) returning `{id}` (numeric) or `{notation}` (string). **The hook signature is `(move: BotMove) => ElementRef | undefined` — move only, no game/seat.**
- Overlay: `HintOverlay.vue` reads `gameState.state.hint.annotation`, calls `overlay-utils.buildSelector(target)` → `[data-bs-el-id]` > `[data-bs-el-notation]` > `[data-bs-el-name]`, `document.querySelector`, measures rect, renders ring + bubble.
- R-06: `game-session.ts:1296-1299` `performAction()` deletes `#hint.delete(player)` before broadcast; `:243` replaceRunner clears hint+heatmap on undo/rewind.
- DEMO: ops `demoStart{delay?}`/`demoStop` (`stateless-ops.ts:75-76`); `runDemoLoop()` in `snapshot-session-host.ts` — aiSuggest preview → narrate (onBeforeMove) → delay → execute-same-args via 'action' op → try/finally cleanup; `demoAbort` checked before AND after delay. Narration: `game-session.ts:1206-1220` `buildNarrationText()` generic "Player N: action key=val"; rendered in `BoardMessage.vue` variant="narration".
- ControlsMenu "Get a hint"/"Watch AI demo" visibility gated by `showHint`/`gameDefinition.ai` presence (already true for go-fish — both entries were observed live in the dev host during Phase 112).

### go-fish (the target — minimal additions)
- AI already attached: `src/rules/index.ts:23-25` `ai: { objectives: getGoFishObjectives }`. Full bot in `src/rules/ai.ts` (objectives, move-ordering, playout, threat-response, UCT). **No new training.**
- Ask move: `src/rules/actions.ts` `createAskAction()` → `BotMove { action:'ask', args:{ target:number(seat), rank:string } }`.
- Custom UI: `src/ui/components/GameTable.vue` — hand cards at `:527` now `v-bind="anchorAttrs({ id: card.id, name: \`${card.rank}${card.suit}\` })"` (Phase 112). The `card-group` divs (grouped by rank, `:516`) currently carry no anchor — ADD `anchorAttrs({ name: rank })` here for the hint.
- **TODO (go-fish):** (1) `getGoFishHintTarget` in `ai.ts`; (2) wire `hintTargetFromMove` into `gameDefinition.ai`; (3) rank-anchor on the `card-group` div in `GameTable.vue`; (4) tests.

### Checkers reference (proven)
- `checkers/src/rules/index.ts:25-28` `hintTargetFromMove: (move) => move.args.destination?.toNotation ? { notation: ... } : undefined`.
- `checkers/tests/hint-target.test.ts` — asserts move→ref→anchored ring.

### Archived v4.1 Phase 107 context (`.planning/milestones/v4.1-phases/107-ai-assisted-teaching/`)
- Hint is a transient annotation injected via the session, usable outside a tutorial, reusing the TUT-01 overlay; highlights the suggested move's target via `data-bs-el-*`. Demo uses all-seats AI + `onBeforeMove` narration. Heatmap was board-only (AI-03) — out of scope for go-fish.
</code_context>

<specifics>
## Specific Ideas

- The Phase 112 `anchorAttrs` fix already de-risks GFAI-01: hand cards emit `data-bs-el-id`/`data-bs-el-name`, and the hint overlay uses the SAME `buildSelector` resolution as the tutorial overlay. The only new anchor needed is a rank-keyed one on the `card-group` so the hint can highlight the whole rank.
- "AI" here is the built-in MCTS, not an LLM — no new external dependency.
- Highest parity check: the hint ring must land on the learner's rank CARDS (not a board cell, not the opponent), proving card-game `anchorAttrs` generalizes.
</specifics>

<deferred>
## Deferred Ideas

- Evaluation heatmap for go-fish — board-only, documented as such (DOC-03, Phase 115).
- Go-fish action help (GFHELP-01) + host teaching-lockout verification (GFLOCK-01) → Phase 114.
- Developer documentation (DOC-*) → Phase 115.
- Card-game move-quality visualization (a non-grid heatmap analog) — future requirement, deferred.
</deferred>
