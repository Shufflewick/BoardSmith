# Phase 115: Developer Documentation - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Write ONE developer guide in BoardSmith `docs/` so a developer can author a tutorial, predicate triggers, CI-verifiable tests, AI teaching features, action help, and host lockout by reading a single document — illustrated with both checkers (grid) and go-fish (cards) as side-by-side worked examples. This is a BoardSmith-only documentation phase (no game-code changes); it synthesizes the substrate proven across v4.1 (checkers) and v4.2 Phases 112–114 (go-fish).

Requirements: DOC-01 (tutorial authoring: `TutorialDefinition`, start/advance/skip/exit lifecycle, action gating, annotation overlay targeting cell/piece/card/panel/action), DOC-02 (predicate triggers + CI-verifiable authoring via the `testing` DSL incl. the green→red demonstration), DOC-03 (AI teaching: move hint, narrated AI-vs-AI demo, evaluation heatmap noting heatmap is board-only; plus `teachingDisabled` host lockout and per-action `.help()`), DOC-04 (both checkers and go-fish as worked examples showing the parity path — `anchorAttrs` on board squares vs. on cards/hands).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Doc Structure & Location
- **One single guide** at **`docs/teaching-and-tutorials.md`** (sibling of the other `docs/*.md` guides), covering all of DOC-01..04 in sections.
- **Link it from `docs/README.md`** so it's discoverable in the docs index.
- **Developer-facing** with copy-pasteable working code examples that reference the REAL API names (`TutorialDefinition`, `simulateTutorial`, `anchorAttrs`, `hintTargetFromMove`, `.help()`, `teachingDisabled`, `--lock-teaching`).
- Suggested section order: (1) Authoring a tutorial (TutorialDefinition, lifecycle, gating, overlay targets), (2) Predicate triggers, (3) CI-verifiable tutorial tests (+ green→red), (4) AI teaching (hint, demo, heatmap [board-only]), (5) Action help (`.help()`), (6) Host teaching lockout (`teachingDisabled`), (7) Parity: checkers vs go-fish worked examples.

### Area 2 — Worked Examples (DOC-04)
- **Real snippets pulled from the actual checkers + go-fish source**, shown side-by-side for the parity path:
  - `CHECKERS_TUTORIAL` (`~/BoardSmithGames/checkers/src/rules/tutorial.ts`) vs `GO_FISH_TUTORIAL` (`~/BoardSmithGames/go-fish/src/rules/tutorial.ts`).
  - Overlay anchoring: checkers `ref: { notation }` on board squares (GridBoardRenderer `cellAttrs`) vs go-fish `ref: { name: '7H' }` on a named card, with the custom-UI `anchorAttrs({ id, name })` binding in `GameTable.vue`.
  - Hint target: checkers `hintTargetFromMove(move) => { notation }` vs go-fish `getGoFishHintTarget(move) => { name: rank }` + the rank-group `anchorAttrs({ name: rank })`.
  - CI test: `checkers/tests/tutorial.test.ts` vs `go-fish/tests/tutorial.test.ts`.
- **A doc-verifier pass** checks every API name / snippet against the live BoardSmith + checkers + go-fish source so the guide doesn't drift.
- **Document the central parity lesson:** custom UIs MUST emit `anchorAttrs` (`data-bs-el-id`/`data-bs-el-name`) for the annotation/hint overlays to anchor — the v4.2-112 fix. Board games anchor by `notation` (grid squares carry it via `cellAttrs`); card games anchor by `name` (name the card or the rank `card-group`). AutoUI's renderers emit these automatically via `useSelectable`/`anchorAttrs`; a custom UI must opt in.

### Area 3 — Content Scope & Accuracy
- **Heatmap is board-only** — explicitly documented (DOC-03): it shades grid cells via `data-bs-el-*` anchors and does not apply to a gridless card game; it stays available for grid games. (A card-game move-quality visualization is a deferred future idea.)
- **CI green→red technique** (DOC-02): show `simulateTutorial` + `assertTutorialCompletes` asserting all beats in `stepsVisited`, then a deliberate rule break (e.g. go-fish `checkForBooks = () => []` or disabling turn-continuation; checkers disabling mandatory capture) making the test go red — the tutorial as a living regression test.
- **Known caveats documented honestly:** (a) tutorial steps with already-true `advanceWhen` auto-advance instantly via the pump (the dwell-time UX limitation, R-05 backlog) and may not appear separately in `simulateTutorial`'s `stepsVisited`; (b) custom UIs must emit `anchorAttrs` or overlays float unanchored; (c) the AI-vs-AI demo affordance is gated on an AI seat being present, and driving a seat in the dev host (Follow-active-seat) removes that AI presence — a dev-host testing caveat; (d) the heatmap "Show move quality" toggle currently shows for gridless games when unlocked (gated on `showHint`, not board presence) — a known cosmetic substrate quirk.

### Claude's Discretion
- Exact prose, headings, and example formatting; how much of each real snippet to inline vs. reference by file:line; the precise placement of the parity side-by-side (a table vs. paired code blocks); the README link text. As long as DOC-01..04 are all covered, examples are real and codebase-verified, and the parity path + heatmap-board-only note + green→red demonstration are present.
</decisions>

<code_context>
## Existing Code Insights (sources for the worked examples)

### docs/ (BoardSmith — where the guide lands)
- Flat `docs/*.md` guides (getting-started, custom-ui-guide, ai-system, conditions, actions-and-flow, common-patterns/pitfalls, etc.) + `docs/README.md` index. NO existing tutorial/teaching-authoring guide — create `docs/teaching-and-tutorials.md` and link it from README.

### Tutorial / overlay substrate (BoardSmith `src/`)
- Types: `src/engine/tutorial/types.ts` — `TutorialDefinition { setup?, steps }`, `TutorialStep { id, gate, content?, advanceWhen?, suppressAutoFill? }`, `TutorialGateAllowList { action, selections? }`, `Annotation { text, target?, placement? }`, `AnnotationTarget = {kind:'element',ref} | {kind:'action',actionName} | {kind:'panel'}`. Exported from `boardsmith`.
- Gating: `src/engine/tutorial/gate.ts` — `selectionMatchesValue` (matches element refs id>notation>name, choice objects by field equality, AND primitives via `{ value }` — the v4.2-112 fix), `getGateReasonForValue`.
- Overlay anchoring: `anchorAttrs(ref)` (`src/ui/composables/useBoardInteraction.ts`) emits `data-bs-el-id`/`data-bs-el-notation`/`data-bs-el-name`; `overlay-utils.buildSelector` (`src/ui/components/helpers/overlay-utils.ts`) resolves them (id>notation>name); `TutorialOverlay.vue` + `HintOverlay.vue` render the ring/bubble. `useSelectable`/`useSelectableGrid` spread `anchorAttrs` automatically in AutoUI renderers (CardRenderer, GridBoardRenderer).
- Lifecycle + launch: `GameSession.startTutorial(seat)` / `exitTutorial`; `start-tutorial` platform op + ControlsMenu "Start tutorial" (shown when `gameDefinition.tutorial` exists).
- CI DSL: `simulateTutorial`, `assertTutorialCompletes`, `TutorialScenarioMove`, `TestGame.create(..., { tutorialSetup })` from `boardsmith/testing`.

### AI teaching + lockout + action help substrate (BoardSmith `src/`)
- Hint: `GameSession.requestHint(seat)` → `hintTargetFromMove` hook → `Annotation` → `HintOverlay`; cleared on next action (R-06). Demo: `demoStart`/`demoStop` ops + `runDemoLoop` (narrate-before-execute, `demoAbort` before+after delay). Heatmap: board-only overlay over candidate cells. Visibility: `GameShell.showHintProp` (AI present). All gated by `teachingDisabled` except action help.
- Lockout: `GameSessionOptions.teachingDisabled`; throws "Teaching features are disabled for this session." from `requestHint`/`setHeatmapVisible`/`startDemo`/`startTutorial`; UI hides the Teaching group; dev-host flag `boardsmith dev --lock-teaching`.
- Action help: `ActionDefinition.help` + `.help(text)` builder; propagated via `buildActionMetadata` → `ActionMetadata.help`; `ActionHelpPopover.vue` "?" affordance; "Show action help" toggle (gated by `hasActionHelp`, NOT teachingDisabled).

### Worked-example sources (the two games)
- Checkers (grid): `~/BoardSmithGames/checkers/src/rules/{tutorial.ts,game.ts,index.ts,actions.ts}`, `tests/tutorial.test.ts`, `tests/hint-target.test.ts`. Anchors by `notation` on squares.
- Go-fish (cards): `~/BoardSmithGames/go-fish/src/rules/{tutorial.ts,actions.ts,ai.ts,index.ts,game.ts}`, `src/ui/components/GameTable.vue` (custom UI emitting `anchorAttrs` on cards + rank `card-group`), `tests/{tutorial.test.ts,hint-target.test.ts,demo.test.ts,action-help.test.ts,host-lockout.test.ts}`. Anchors by `name` on cards.
- `.planning/phases/112-114` SUMMARYs capture the lessons (anchorAttrs custom-UI fix, rank-group hint anchor, lockout verification, action help) — useful source material.
</code_context>

<specifics>
## Specific Ideas

- The guide is the milestone's capstone: it should make the checkers↔go-fish parity path immediately legible so a developer starting a new game knows exactly where their UI must emit `anchorAttrs`.
- Examples must be REAL and codebase-verified (doc-verifier) — no invented API. Prefer concise excerpts with `file` references over pasting whole files.
- Honest caveats (auto-advance/R-05, custom-UI anchorAttrs requirement, dev-host AI-seat gating for the demo, heatmap-board-only + the showHint-gating quirk) belong in the guide so the next author isn't surprised.
</specifics>

<deferred>
## Deferred Ideas

- A card-game move-quality visualization (non-grid heatmap analog) — future requirement.
- Fixing the heatmap "Show move quality" toggle visibility for gridless games — pre-existing substrate quirk (document it; fix later).
- The dwell-time tutorial UX improvement (R-05) — backlog.
</deferred>
