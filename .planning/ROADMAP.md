# Roadmap — BoardSmith

## Milestones

- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- 🚧 **v4.1 Tutorial Primitives (Checkers)** — Phases 104–110 (in progress) — substrate + checkers showcase + AI/HELP teaching, then demo.

## Phases

<details>
<summary>✅ v4.0 UI Redesign (Slate) — Phases 97–103 — SHIPPED 2026-06-23</summary>

- [x] Phase 97: Quick Wins (Wave 0) — completed 2026-06-23
- [x] Phase 98: Token Foundation (Wave 1) — completed 2026-06-23
- [x] Phase 99: Theming Swap (Wave 2) — completed 2026-06-23
- [x] Phase 100: IA & Responsive (Wave 3) — completed 2026-06-23
- [x] Phase 101: Accessibility — WCAG 2.2 AA (Wave 4) — completed 2026-06-23
- [x] Phase 102: Material Polish & Dev/Debug Parity (Wave 5) — completed 2026-06-23
- [x] Phase 103: Cross-Repo Verification — completed 2026-06-23

48/48 requirements satisfied · BoardSmith 1245/1245 tests · 8 games + MERC green · audit passed (`milestones/v4.0-MILESTONE-AUDIT.md`).

</details>

### 🚧 v4.1 Tutorial Primitives (Checkers) — Phases 104–110

- [x] **Phase 104: Tutorial Lifecycle & Action Gating** — Engine/session run a gated, resumable tutorial; steps restrict the legal action set and progress is checkpoint/replay safe. (completed 2026-06-25)
- [x] **Phase 105: Annotation Overlay (UI Parity)** — Text-bubble + targeted highlight on any cell/piece/panel/control, rendered identically in custom UI and AutoUI via `useBoardInteraction`. (completed 2026-06-25)
- [x] **Phase 106: Predicate Triggers & CI-Verifiable Authoring** — Fire content on game-state predicate/event, and author the tutorial as a test that fails when the rules drift. (completed 2026-06-26)
- [x] **Phase 107: AI-Assisted Teaching** — MCTS-powered move hint, narrated AI-vs-AI demo, and evaluation heatmap, surfaced from checkers' existing bot. (completed 2026-06-26)
- [x] **Phase 108: Lightweight Action Help** — Per-action help text revealed on hover/tap, with a global toggle. (completed 2026-06-27)
- [x] **Phase 109: Checkers Tutorial Content** — The cross-repo showcase: guided selection/movement, mandatory-capture tip, multi-jump walkthrough, launchable in GameShell + dev host. (completed 2026-06-29)
- [ ] **Phase 110: Demonstration & Refinement** — End-to-end browser demo of the tutorial + AI + HELP as a hands-on refinement gate before applying the substrate to cribbage.

## Phase Details

### Phase 104: Tutorial Lifecycle & Action Gating
**Goal**: The engine and session can run a gated, resumable tutorial — a step restricts the legal action set, and tutorial progress survives checkpoint/replay. This is the foundational substrate everything else builds on.
**Depends on**: Nothing (first phase of this milestone; builds on the v2.8 disabled-reason mechanism)
**Requirements**: TUT-02, TUT-05
**Success Criteria** (what must be TRUE):
  1. A player can start, advance, skip a step, and exit a tutorial through a documented lifecycle API.
  2. Tutorial progress serializes with the game state and restores identically after checkpoint/replay (round-trip safe).
  3. A game author can gate a step to a restricted subset of legal actions; out-of-step actions are blocked and surface a reason (reusing the v2.8 disabled-reason mechanism), not silently ignored.
  4. Action gating reuses the engine's existing action validation — no parallel or duplicate validation path is introduced.
**Plans**: 4 plans
- [x] 104-01-PLAN.md — Tutorial substrate: contracts, serialized progress field, definition threading, serialization round-trip guard (Wave 1)
- [x] 104-02-PLAN.md — Action & target gating via the v2.8 disabled path + action-level reason (Wave 2)
- [x] 104-03-PLAN.md — Auto-fill suppressibility for taught selections (Wave 2)
- [x] 104-04-PLAN.md — Lifecycle controller (start/advance/skip/exit) + dual-projection parity (Wave 3)

### Phase 105: Annotation Overlay (UI Parity)
**Goal**: A tutorial step can render a text bubble plus a targeted highlight on a board cell, piece, panel, or action control — and it renders identically in a custom UI and AutoUI.
**Depends on**: Phase 104
**Requirements**: TUT-01
**Success Criteria** (what must be TRUE):
  1. An author can attach a text-bubble annotation plus a targeted highlight to a tutorial step, and both render in the browser.
  2. The highlight can target any of: a board cell, a piece, a panel, or an action control.
  3. The same annotation renders identically in a custom UI and in AutoUI because it routes through `useBoardInteraction` — verified in BOTH UI paths (parity is a project hard-rule; no primitive may work in only one UI path).
**Plans**: 5 plans (Waves 1–3)
- [x] 105-01-PLAN.md — Annotation content model: narrow TutorialStep/TutorialStepView `content` to `Annotation[]` + AnnotationTarget union (Wave 1)
- [x] 105-02-PLAN.md — Shared anchor substrate: `anchorAttrs` single source → `data-bs-el-*`/`data-bs-action`/`data-bs-panel` via useSelectable/useSelectableGrid (Wave 1)
- [x] 105-03-PLAN.md — TutorialOverlay + BoardMessage annotation variant: ring + bubble resolved by anchor only (Wave 2)
- [x] 105-04-PLAN.md — GameShell wiring: mount overlay in `.boardregion` + close MR-01 (thread tutorialStep into useActionController) (Wave 3)
- [x] 105-05-PLAN.md — Dual-path parity test: same annotation renders in AutoUI + custom-UI fixtures (criterion #3) (Wave 3)
**UI hint**: yes

### Phase 106: Predicate Triggers & CI-Verifiable Authoring
**Goal**: Authors can fire tutorial content from a game-state predicate or engine event, and author the entire tutorial as a CI-verifiable artifact that fails a test when the rules drift instead of rotting silently.
**Depends on**: Phase 104
**Requirements**: TUT-03, TUT-04
**Success Criteria** (what must be TRUE):
  1. An author can define a trigger that fires tutorial content when a game-state predicate or engine event matches (e.g. before the player's first turn, after N turns, the first time a capture becomes forced).
  2. An author can express a complete tutorial using the `testing` DSL, and it runs as a normal CI test.
  3. A game-rule change that breaks the tutorial fails that test (demonstrated by a deliberately broken rule), rather than failing silently at runtime.
**Plans**: 5 plans (Waves 1-3)
- [x] 106-01-PLAN.md — Engine predicate substrate: shared evaluator + labeled advanceWhen/gate (MR-02) + auto-advance pump + fail-loud validation (MR-03) (Wave 1)
- [x] 106-02-PLAN.md — Named-predicate helpers: beforeFirstTurn / afterTurns(n) / whenForced (Wave 2)
- [x] 106-03-PLAN.md — Server-side auto-advance hook + re-broadcast + MR-03 fail-loud lifecycle (Wave 2)
- [x] 106-04-PLAN.md — testing DSL: simulateTutorial + assertTutorialStep/Completes, fails on rule drift (Wave 2)
- [x] 106-05-PLAN.md — CI-verifiable demonstration: green-when-intact, red-when-rule-broken (Wave 3)

### Phase 107: AI-Assisted Teaching
**Goal**: A player can get MCTS-powered help — a move hint, a narrated AI-vs-AI demo, and an evaluation heatmap — all surfaced from the game's existing bot with no new training.
**Depends on**: Phase 105 (the hint highlight reuses the annotation overlay)
**Requirements**: AI-01, AI-02, AI-03
**Success Criteria** (what must be TRUE):
  1. A player can request a move hint at any decision point; the existing MCTS returns a legal move and its target is highlighted via the annotation overlay (TUT-01).
  2. A player can watch an AI-vs-AI demo in which each move is announced before it executes.
  3. A player can toggle an evaluation heatmap that visualizes the AI's per-move evaluation across the board.
  4. All three features reuse checkers' existing MCTS bot (`~/BoardSmithGames/checkers/src/rules/ai.ts`) — no new training, weights, or models.
**Plans**: 4 plans (Waves 1-4)
- [x] 107-01-PLAN.md — MCTS stats API: runSearch() + playWithStats() + BotMoveStats/hintTargetFromMove (Wave 1)
- [x] 107-02-PLAN.md — Session teaching state: transient hint/heatmap/narration injection + requestHint/setHeatmapVisible (Wave 2)
- [x] 107-03-PLAN.md — Narration hook (onBeforeMove) + AI-vs-AI demo mode (startDemo/stopDemo) (Wave 3)
- [x] 107-04-PLAN.md — UI overlays (HintOverlay/HeatmapOverlay) + BoardMessage narration + ControlsMenu/GameShell + parity tests (Wave 4)
**UI hint**: yes

### Phase 108: Lightweight Action Help
**Goal**: Authors can attach per-action help text that a player reveals on demand and toggles globally — building on the v2.8 disabled-reason "why-disabled" friction surface.
**Depends on**: Phase 104
**Requirements**: HELP-01, HELP-02
**Success Criteria** (what must be TRUE):
  1. A game author can attach help text to each action.
  2. A player can reveal an action's help text on hover (pointer) or tap (touch).
  3. A player can toggle action help text on or off globally, and the setting holds across actions.
**Plans**: 3 plans (Waves 1-3)
- [x] 108-01-PLAN.md — Engine + session substrate: help?: string + .help() builder + propagation through both buildActionMetadata paths + UI ActionMetadata type (Wave 1)
- [x] 108-02-PLAN.md — ActionHelpPopover.vue + ActionPanel "?" affordance + dead disabledActions reason rendered in the same popover (Wave 2)
- [x] 108-03-PLAN.md — Global "Show action help" toggle in ControlsMenu + localStorage persistence + GameShell dual-path wiring/parity (Wave 3)
**UI hint**: yes

### Phase 109: Checkers Tutorial Content
**Goal**: A complete, launchable checkers tutorial that proves the substrate end-to-end at checkers' real teaching-difficulty points (mandatory capture, multi-jump). Authored cross-repo in `~/BoardSmithGames/checkers` against the substrate from Phases 104–106.
**Depends on**: Phase 104 (gating + lifecycle), Phase 105 (overlay), Phase 106 (triggers + CI-verifiable authoring)
**Requirements**: CHK-01, CHK-02, CHK-03, CHK-04
**Success Criteria** (what must be TRUE):
  1. A new player can complete a guided tutorial that teaches the two-step piece-selection → destination move, using action gating (TUT-02) and annotation overlays (TUT-01).
  2. A predicate-triggered tip (TUT-03) explains the mandatory-capture rule the first time a capture becomes forced.
  3. The tutorial walks the player through a forced multi-jump, teaching that the turn does not end while further jumps exist.
  4. The tutorial is launchable from the game and runs inside both GameShell and the `boardsmith dev` host.
  5. The tutorial is authored as a CI-verifiable artifact (TUT-04), so a checkers-rules change that breaks it fails a test.
**Plans**: 4 plans (Waves 1-3) — CROSS-REPO: substrate in BoardSmith `src/`, content in `~/BoardSmithGames/checkers`
- [x] 109-01-PLAN.md — LR-02 per-selection gate: SelectionMatcher + TutorialGateAllowList.selections + thread selection.name (BoardSmith, Wave 1)
- [x] 109-02-PLAN.md — start-tutorial launch surface: stateless op + hasTutorial signal + bridge routing + ControlsMenu/GameShell (BoardSmith, Wave 1)
- [x] 109-03-PLAN.md — Checkers tutorial content: tutorialSetup preset + CHECKERS_TUTORIAL def + gameDefinition registration (checkers repo, Wave 2)
- [x] 109-04-PLAN.md — CI-verifiable tutorial.test.ts: full walkthrough + green→red mandatory-capture break proof (checkers repo, Wave 3)
**UI hint**: yes

### Phase 110: Demonstration & Refinement
**Goal**: Demonstrate the checkers tutorial and all teaching features (TUT/AI/HELP) end-to-end in the browser as the explicit, user-facing refinement gate — so the primitives can be refined before a future milestone applies them to cribbage.
**Depends on**: Phase 107 (AI), Phase 108 (HELP), Phase 109 (checkers tutorial)
**Requirements**: DEMO-01
**Success Criteria** (what must be TRUE):
  1. The checkers tutorial runs start-to-finish in the browser (GameShell + `boardsmith dev` host) with annotation overlays, action gating, and predicate-triggered tips all firing live.
  2. The AI move hint, narrated AI-vs-AI demo, and evaluation heatmap are each demonstrated live in the browser.
  3. Action help (hover/tap reveal + global toggle) is demonstrated live.
  4. The demonstration is conducted as a hands-on refinement checkpoint with the user: observed friction and requested refinements are captured to inform the substrate before it is applied to cribbage (the deferred v2 CRIB milestone).
**Plans**: 5 plans (Waves 1-4) — CROSS-REPO: mostly BoardSmith src/, plus one checkers hintTargetFromMove change
- [x] 110-01-PLAN.md — Foundation: transient teaching-state injection + hasAIPlayers signal + un-hide Teaching controls (Wave 1)
- [x] 110-02-PLAN.md — hint + heatmap ops through bridge/stateless-ops + transient store/clear (Wave 2)
- [x] 110-03-PLAN.md — AI-vs-AI narrated demo loop (aiSuggest preview + cancellable, timer-leak-free) (Wave 3)
- [ ] 110-04-PLAN.md — checkers hintTargetFromMove for destination-square highlight (checkers repo, Wave 3)
- [ ] 110-05-PLAN.md — Demo script + live browser demonstration & refinement capture (human gate, Wave 4)
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 104. Tutorial Lifecycle & Action Gating | 4/4 | Complete   | 2026-06-25 |
| 105. Annotation Overlay (UI Parity) | 5/5 | Complete   | 2026-06-25 |
| 106. Predicate Triggers & CI-Verifiable Authoring | 5/5 | Complete    | 2026-06-26 |
| 107. AI-Assisted Teaching | 4/4 | Complete    | 2026-06-26 |
| 108. Lightweight Action Help | 3/3 | Complete    | 2026-06-27 |
| 109. Checkers Tutorial Content | 4/4 | Complete    | 2026-06-29 |
| 110. Demonstration & Refinement | 3/5 | In Progress|  |
