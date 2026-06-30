# Phase 112: Go-Fish Tutorial Content - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Author a complete, launchable, CI-verifiable **go-fish** tutorial that teaches four beats — (1) ask-for-rank gating, (2) the "Go Fish!" draw predicate tip, (3) forming a book, (4) turn continuation on a successful ask. This proves the v4.1 tutorial substrate (already in BoardSmith `src/`) generalizes from a grid board (checkers) to a hidden-information card game.

Content lands cross-repo in `~/BoardSmithGames/go-fish` (symlinked `node_modules/boardsmith` → this repo, so source changes are live; no re-vendor). `.planning/` tracking stays in BoardSmith. **No BoardSmith `src/` changes are expected** — the only exception is a real substrate gap (e.g. the `selections` matcher cannot match go-fish's value-choices), which must be fixed in BoardSmith with a unit test, never worked around in go-fish.

Requirements: GFT-01 (ask-for-rank gating + card/hand overlay), GFT-02 (Go-Fish-draw predicate tip), GFT-03 (forming a book), GFT-04 (turn continuation), GFT-05 (launchable in GameShell + `boardsmith dev` host), GFT-06 (CI-verifiable artifact via the `testing` DSL).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Card Anchoring & Overlay Strategy
- **Name tutorial-relevant cards in the preset** so an overlay's `target: { kind: 'element', ref: { name } }` resolves through AutoUI's rendered `data-bs-el-id` — the direct card-game analog of checkers' named pieces (`TUTORIAL_PIECE_NAME`). This is the parity path the milestone is meant to prove (board square `notation` → card `name`).
- The **ask-step overlay anchors to the learner's matching cards in their own hand** (the rank they hold), with text pointing at the opponent target.
- **Rely on AutoUI Card rendering to expose a stable anchor id** (`data-bs-el-id` from the card's stable `id`); verify at execution. If AutoUI does not surface a resolvable anchor for named cards, that is a flagged AutoUI/substrate gap to fix in BoardSmith — not a go-fish workaround.
- Overlay tooltip **placement defaults to `top`**, consistent with checkers.

### Area 2 — Tutorial Preset & Deterministic Hands
- Add a **`resetToTutorialPreset()` (or equivalent setup) on `GoFishGame`** that deals scripted, named hands — mirrors checkers' `resetToTutorialPreset()` / `placeTutorialPieces()`.
- **One combined scenario forces all four beats:** the learner holds three of a rank R plus a second rank that will miss; an opponent holds the fourth R. Flow: a successful ask (turn continuation, beat 4) → an ask that misses → Go Fish draw (beat 2) → completing four-of-R into a book (beat 3). Ask-for-rank gating (beat 1) frames the first ask.
- The preset is toggled in tests via **`TestGame.create(..., { tutorialSetup: true })`** (checkers parity), invoked from `TutorialDefinition.setup()`.
- **Pin a fixed deck seed** (e.g. `go-fish-tutorial-pinned`) so the deal and walkthrough are reproducible.

### Area 3 — Step Gating & Advancement Semantics
- **Gate the `ask` action's `rank` and `target` selections** via `gate.selections` matching the legal tutorial rank value + opponent. **Flagged risk:** go-fish's `ask` uses `chooseFrom('target')` / `chooseFrom('rank')` with primitive/player-choice values, not element selections — `selectionMatchesValue` may not match these. If it does not, **extend the matcher minimally in BoardSmith with a unit test** (real substrate gap), do not gate around it.
- **Beat 2 (Go Fish tip):** a `advanceWhen` predicate that fires when an ask misses and the player must draw (reads `lastActionResult` / game state) — NOT `whenForced`.
- **Beat 3 (forming a book):** a predicate detecting the player's scored-books count increased (book scored and removed from hand) via `game.checkForBooks` state.
- **Beat 4 (turn continuation):** a predicate detecting `extraTurn` was granted / the same player asks again (the turn does not end on a hit).

### Area 4 — CI Test & Cross-Repo Build/Scope
- **Green→red proof:** deliberately disable turn-continuation (force `extraTurn: false`) and confirm the tutorial CI test fails — ties directly to a go-fish rule the tutorial teaches.
- **Test structure mirrors checkers:** `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` using `simulateTutorial(testGame, GO_FISH_TUTORIAL, { seat, scenario, seed })` + `assertTutorialCompletes`, asserting `stepsVisited` contains all four beats.
- **Cross-repo build loop:** rely on go-fish's symlinked `node_modules/boardsmith` (live source per CLAUDE.md); no re-vendor. Keep BoardSmith vitest green throughout.
- **BoardSmith `src/` scope:** none expected; the only allowed change is extending the `selections` matcher (with a unit test) if the Area 3 gap is confirmed.

### Claude's Discretion
- Exact preset hand composition (which rank R, the missing rank, filler cards) as long as it deterministically forces the four beats in order.
- The exact tutorial step count and ids; the precise predicate expressions; named-card naming scheme.
- How the launch surface is confirmed (the v4.1 ControlsMenu "Start tutorial" + `start-tutorial` op should light up purely from attaching `tutorial:` to `gameDefinition` — verify, no new substrate expected).
</decisions>

<code_context>
## Existing Code Insights (from scout)

### Go-Fish repo (`~/BoardSmithGames/go-fish`, dep `file:../../BoardSmith`, node_modules/boardsmith symlinked)
- Game def: `src/rules/index.ts` `gameDefinition` (gameClass `GoFishGame`, gameType `'go-fish'`, displayName, min/max 2–6, `ai`) — **no `tutorial` field yet** (add it).
- Actions: `src/rules/actions.ts` `createAskAction()` (lines 32–191) — `Action.create('ask').chooseFrom('target', {opponent picker, game.playerChoices({excludeSelf:true})}).chooseFrom('rank', {ranks held}).condition(...).execute(...)`. Execute returns payload `{ extraTurn, formedBooks, ... }`. Two sequential value choices (target → rank), no element selection.
- Mechanics: `game.ts` — `checkForBooks(player)` (book-forming, called after receiving/drawing), `extraTurn: true` returned when ask succeeds OR drawn card matches asked rank (turn continuation).
- Flow: `src/rules/flow.ts` (lines 23–117) — `ask` at line 65; `setVar('extraTurn', false)` then checks `ctx.lastActionResult?.data?.extraTurn` (line 77) to loop or end turn.
- UI: `src/ui/presentation.ts` — AutoUI only (`byClass: { PlayerHand: { label: 'Hand' } }`), no custom components; cards render from `Hand`/`Books` spaces.
- AI: `src/rules/ai.ts` (492 lines) — full MCTS bot already configured (`getGoFishObjectives` etc.), attached to `gameDefinition`. (Consumed in Phase 113, not here.)
- Tests: `tests/game.test.ts` (434 lines) — vitest + `boardsmith/testing` (`createTestGame`, `simulateAction`, `doAction`, etc.). **No `tutorial.test.ts` yet.**
- Card elements: `Card` has stable `id`, `rank`, `suit` (no `notation`); `Hand`/`Books` are Spaces with stable `id` + `player` ref.

### Checkers tutorial (the template, `~/BoardSmithGames/checkers`)
- `src/rules/tutorial.ts` (197 lines): `export const CHECKERS_TUTORIAL: TutorialDefinition = { setup: (game) => game.resetToTutorialPreset(), steps: [...] }`. Steps shape: `{ id, suppressAutoFill?, gate: { action, selections?: { piece?: {name|notation}, destination?: {toNotation} } }, content: [{ text, target?: { kind:'element', ref:{name|notation} }, placement?:'top' }], advanceWhen: { [label]: (ctx)=>boolean } }`.
- Anchoring: `target: { kind:'element', ref:{ notation:'d4' } }` or `ref:{ name:'tutorial-p1' }` — squares carry computed `notation`; pieces are named in the preset.
- Gating: `gate.selections.piece: { name: TUTORIAL_PIECE_NAME }` narrows the legal selection; `suppressAutoFill: true` stops auto-pick of the only valid value.
- Predicate advance: `advanceWhen: { 'first capture forced': (ctx) => (ctx.game as CheckersGame).playerHasCaptures(player) }` — reads `ctx.game/seat/lastActionResult`.
- Preset: `game.ts resetToTutorialPreset()` + `placeTutorialPieces()` (lines 139–173) deals a deterministic, named layout; toggled in tests via `TestGame.create(..., { tutorialSetup: true })`.
- Launch: `src/rules/index.ts` exports `CHECKERS_TUTORIAL` and sets `gameDefinition.tutorial = CHECKERS_TUTORIAL` — this is the only wiring needed for the v4.1 ControlsMenu "Start tutorial" + `start-tutorial` op to appear in GameShell and dev host.
- CI test: `tests/tutorial.test.ts` (276 lines) — `simulateTutorial(testGame, CHECKERS_TUTORIAL, { seat, scenario, seed })` + `assertTutorialCompletes(result)` + `expect(result.stepsVisited).toContain(...)`. Scenario moves `{ action, args, expectStep, seat? }`.

### BoardSmith substrate (already shipped v4.1, reuse as-is)
- Tutorial types in `src/engine/tutorial/types.ts`; `TutorialDefinition` exported from `boardsmith`; `simulateTutorial`/`assertTutorialCompletes`/`TutorialScenarioMove` from `boardsmith/testing`.
- Per-selection gating: `selections` map keyed by selection name (shipped Phase 109 Plan 01); `selectionMatchesValue` uses ElementRef precedence (id>notation>name) + all-field equality for choice objects. **Verify it handles go-fish primitive rank / player-choice target.**
- Launch surface: `start-tutorial` platform op + ControlsMenu "Start tutorial" (shown only when `gameDefinition.tutorial` exists), works in GameShell + dev host.

### Files to create/touch in go-fish
- CREATE `src/rules/tutorial.ts` (`GO_FISH_TUTORIAL: TutorialDefinition` + setup/steps).
- CREATE `tests/tutorial.test.ts` (simulateTutorial walkthrough + green→red proof).
- EDIT `src/rules/game.ts` (add `resetToTutorialPreset()` / named-card preset + `tutorialSetup` path).
- EDIT `src/rules/index.ts` (export `GO_FISH_TUTORIAL`, set `gameDefinition.tutorial`).
</code_context>

<specifics>
## Specific Ideas

- **Highest-risk parity item:** the overlay must anchor to cards/hand, not a board cell. Named cards + AutoUI `data-bs-el-id` is the chosen path; if AutoUI doesn't surface a resolvable anchor, fix in BoardSmith (flagged gap), don't fake it.
- **Second risk:** `gate.selections` matching go-fish's value-choices (primitive rank, player target) — may be a real `selectionMatchesValue` gap; extend the matcher in BoardSmith with a unit test if confirmed.
- **CI must go red on a real break:** prove green→red by disabling turn-continuation, the same standard as checkers' Phase 109.
- Cross-repo dev loop stays green: BoardSmith vitest must remain green while authoring go-fish content (symlinked, live source — no re-vendor).
</specifics>

<deferred>
## Deferred Ideas

- Go-fish AI teaching (move hint + narrated AI-vs-AI demo, GFAI-*) → Phase 113.
- Go-fish action help (GFHELP-01) and host teaching-lockout verification (GFLOCK-01) → Phase 114.
- Developer documentation of the substrate (DOC-*) → Phase 115.
- The evaluation heatmap stays board-only — explicitly out of scope for go-fish.
</deferred>
