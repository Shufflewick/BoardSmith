# Phase 109: Checkers Tutorial Content - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a complete, launchable, CI-verifiable checkers tutorial that teaches the two-step move, the mandatory-capture rule, and forced multi-jump continuation. This phase spans TWO repos: it first closes two BoardSmith **substrate gaps** the scout surfaced — (1) per-selection-name action gating (carry-forward LR-02 from Phase 104) and (2) a tutorial **launch surface** (`session.startTutorial` exists but nothing calls it) — then authors the **content** in `~/BoardSmithGames/checkers` against that substrate. `.planning/` tracking stays in BoardSmith. The end-to-end browser run is the Phase 110 demo gate.

Requirements: CHK-01 (two-step move via gating + overlays), CHK-02 (mandatory-capture tip via predicate trigger), CHK-03 (forced multi-jump continuation), CHK-04 (launchable from game + `boardsmith dev` host). Plus the goal's CI-verifiable artifact (TUT-04) for the checkers tutorial.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Per-selection-name gate API (LR-02 substrate, BoardSmith)
- Extend `TutorialGateAllowList` with a **`selections` map keyed by selection name** (e.g. `{ piece: <matcher>, destination: <matcher> }`). Plumb `selection.name` as a 4th argument into `getGateReasonForValue` (3 call sites in `src/engine/action/action.ts:388,440,460`) and match each selection's value ONLY against its own matcher — not a merged set.
- Matchers use **ElementRef-style `{ notation }` / value matching**, reusing the existing `matchesRef` precedence for board element selections; a `DestinationChoice` matches on `toNotation` (and/or `pieceId`). (Phase 105's `ElementRef {id,name,notation}` + `matchesRef` is the parity-consistent matcher.)
- **Additive / back-compatible:** the existing flat `action`-only allow-list keeps working unchanged (no `selections` ⇒ gate the whole action as today). The reserved flat `from`/`to` fields are superseded by `selections` (remove or repurpose them — no deprecation cycle per project hard-rule).
- Lands in **BoardSmith substrate** (`src/engine/action/{action,gate,types}.ts`) with unit tests proving per-selection gating (piece c3 allowed but destination d4-only; wrong square gated). Closes carry-forward LR-02.

### Area 2 — Tutorial launch surface (CHK-04 substrate, BoardSmith)
- Add a **`start-tutorial` platform op** routed through the existing `platformRequest` pattern (the same mechanism Phase 107 used for hint/heatmap) → `GameSession.startTutorial(seat)`.
- Surface a **"Start tutorial" item in ControlsMenu**, shown only when the game has a `tutorial` definition (mirror the Teaching-group gating). It must work in production GameShell AND the `boardsmith dev` host.
- **Restartable:** (re)start from step 0; if a tutorial is already running, restart cleanly (no error). (Also revisit MR-03/start() semantics so restart is fail-loud-safe.)
- Lands in **BoardSmith substrate** (GameShell + dev host + session op) with tests.

### Area 3 — Checkers tutorial content (CHK-01/02/03, checkers repo)
- Add a **dedicated deterministic tutorial preset/position** to checkers that forces a capture and a multi-jump at known squares, so step transitions are reproducible (and the CI test is stable).
- **CHK-02 mandatory-capture tip:** a step with a **custom `advanceWhen` predicate reading `game.playerHasCaptures(player)`** — NOT `whenForced` (which is wrong here: mandatory capture restricts destinations *within* the `move` action, so `move` is always available and `whenForced('move')` would always fire). Annotation explains the rule.
- **CHK-01 two-step teaching:** step 1 gates the `piece` selection (annotation highlights the piece to move); step 2 gates the `destination` selection (annotation highlights the target square) — via the new per-selection gate from Area 1 + Phase 105 annotation overlays.
- **CHK-03 multi-jump:** a step gating the continuation `move` (the `followUp` after a capture) with an annotation "the turn continues while more jumps exist"; advance when `game.continuingPiece` clears.

### Area 4 — CI-verifiable test, cross-repo build & scope
- **CI test (TUT-04):** `~/BoardSmithGames/checkers/tests/tutorial.test.ts` using `simulateTutorial(testGame, tutorialDef, {seat, scenario})` + `assertTutorialCompletes` — script the full walkthrough (incl. opponent seat-2 turns to advance the flow). Prove green→red by a deliberate checkers-rules break (e.g. disable mandatory capture) which must fail the test.
- **Repo split:** substrate (Area 1 gate + Area 2 launch) → BoardSmith; content (tutorial def, preset, `tutorial:` field on `gameDefinition` in `src/rules/index.ts`, CI test) → `~/BoardSmithGames/checkers`. Two commit streams; `.planning/` artifacts stay in BoardSmith.
- **Build/consume loop:** checkers depends on BoardSmith via `file:../../BoardSmith` (path dep). After the substrate lands, **rebuild BoardSmith and refresh checkers' dependency** (`npm install` / re-vendor as the checkers repo requires) so the new gate/launch APIs resolve before authoring + running the checkers CI test. Verify the new exports are importable from `boardsmith`/`boardsmith/testing` in checkers.
- **Browser confirmation** of the full checkers tutorial in GameShell + dev host is the **Phase 110 demo gate** (DEMO-01), not this phase.

### Claude's Discretion
- Exact matcher field names on the `selections` map; the precise platform-op name/payload; the ControlsMenu label/placement for "Start tutorial"; the preset's exact board layout (as long as it deterministically forces a single capture then a multi-jump); the number of tutorial steps; and how the checkers dep is refreshed — all at implementation discretion, consistent with existing patterns (Phase 105 overlay, Phase 107 platformRequest, the v2.8 disabled-reason surface).
</decisions>

<code_context>
## Existing Code Insights (from scout)

### Checkers repo (`~/BoardSmithGames/checkers`, separate git repo, dep `file:../../BoardSmith`)
- Game def: `src/rules/index.ts:17` `gameDefinition` (gameClass, gameType:'checkers', ai, presets) — **no `tutorial` field yet** (add it).
- Actions (`src/rules/actions.ts`): `move` = `.chooseElement('piece', …)` (selection name `piece`, `CheckerPiece` values, boardRef emits `{notation}`) then `.chooseFrom('destination', …)` (selection name `destination`, `DestinationChoice {pieceId,fromNotation,toNotation,isCapture,becomesKing,capturedNotations}`, `filterBy {key:'pieceId', selectionName:'piece'}`). Plus `endTurn`.
- Mandatory capture (`game.ts getValidMoves`): if `playerHasCaptures()` then only capture moves returned. `game.playerHasCaptures(player)` is the predicate hook.
- Multi-jump (`actions.ts execute` + `flow.ts`): after capture with more jumps, sets `continuingPlayer`/`continuingPiece`, returns `mustContinue`, issues `followUp:{action:'move',args:{piece:id}}`. `game.continuingPiece !== null` detects it. `endTurn` condition blocks while continuing.
- UI: custom `src/ui/components/CheckersBoard.vue` via `#game-board` slot in `App.vue`; AutoUI available via dev-host switcher.
- Launch: `npm run dev` → `npx boardsmith dev`; `npm test` → vitest (`tests/` auto-picked, `**/*.test.ts`); `tests/game.test.ts` already imports `boardsmith/testing` (resolution path works).

### BoardSmith substrate
- Tutorial types (`src/engine/tutorial/types.ts`): `TutorialDefinition{steps}`, `TutorialStep{id,gate,content?,advanceWhen?,suppressAutoFill?,suppressAutoFillFor?}`, `TutorialGateAllowList{action,from?,to?}` (from/to RESERVED for this phase), `TutorialGateCondition = Record<string,(ctx)=>boolean>`, `Annotation{text,target?,placement?}`. Exported from `boardsmith` (`src/engine/index.ts:249-262`); predicate helpers `afterFirstTurn/afterTurns/whenForced` at `:246`.
- Gate matching: `getGateReasonForValue(step, actionName, value)` (`src/engine/tutorial/gate.ts:117`) — **does NOT receive selection name** (LR-02). Called at `src/engine/action/action.ts:388,440,460`.
- Launch: `GameSession.startTutorial(seat)` (`src/session/game-session.ts:1842`) — NO UI/route/postMessage caller. GameShell wires `tutorialStep` (`:425`), mounts `TutorialOverlay` (`:1814`), auto-advance pump (`:1244`). `GameDefinition.tutorial` → `Game.tutorialDefinition` (`:496,528`).
- CI DSL: `simulateTutorial<G>(testGame, tutorialDef, {seat, scenario:[{seat?,action,args?,expectStep?}], seed?}): {completed, finalStepId, stepsVisited}` + `assertTutorialStep`/`assertTutorialCompletes` from `boardsmith/testing` (`src/testing/index.ts`). Pattern ref: `src/testing/tutorial-ci-demo.test.ts`.
- platformRequest pattern: Phase 107 added hint/heatmap ops via `platformRequest('…')` in GameShell (`handleTeachingAction`) + session — reuse for `start-tutorial`.

### Gaps that MUST be built (from scout) — see Areas 1 & 2
1. LR-02 per-selection gating (blocks CHK-01) — extend allow-list + plumb selection.name.
2. Launch surface (blocks CHK-04) — platform op + ControlsMenu control wired to startTutorial.
3. `tutorial:` field on checkers `gameDefinition` (content).
4. Use custom `advanceWhen` reading `playerHasCaptures` for the mandatory-capture beat, not `whenForced`.
</code_context>

<specifics>
## Specific Ideas

- Highest-risk item (from STATE): the CI-verifiable test must actually FAIL on a broken checkers rule, not pass vacuously — prove green→red with a deliberate mandatory-capture break.
- Cross-repo dev loop must stay green (substrate in BoardSmith src, content in checkers) — re-vendor/reinstall the checkers boardsmith dep after substrate lands.
- The launch surface + per-selection gating are reusable substrate, not checkers-specific — they benefit the future cribbage tutorial too.
</specifics>

<deferred>
## Deferred Ideas

- End-to-end browser run of the checkers tutorial in GameShell + dev host → Phase 110 (DEMO-01 demo/refinement gate).
- Tutorials for other games (cribbage etc.) → future milestone (v2 CRIB).
- Help text authoring (Phase 108 HELP) for checkers actions — optional; only if it naturally supports the tutorial, otherwise out of scope here.
</deferred>
