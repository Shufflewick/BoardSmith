# Roadmap — BoardSmith

## Milestones

- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- 🚧 **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (in progress) — go-fish tutorial showcase + AI teaching + docs.

## Phases

<details>
<summary>✅ v4.0 UI Redesign (Slate) — Phases 97–103 — SHIPPED 2026-06-23</summary>

48/48 requirements · BoardSmith 1245 tests · 8 games + MERC green. See [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md).

</details>

<details>
<summary>✅ v4.1 Tutorial Primitives (Checkers) — Phases 104–111 — SHIPPED 2026-06-30</summary>

- [x] Phase 104: Tutorial Lifecycle & Action Gating (4/4) — 2026-06-25
- [x] Phase 105: Annotation Overlay (UI Parity) (5/5) — 2026-06-25
- [x] Phase 106: Predicate Triggers & CI-Verifiable Authoring (5/5) — 2026-06-26
- [x] Phase 107: AI-Assisted Teaching (4/4) — 2026-06-26
- [x] Phase 108: Lightweight Action Help (3/3) — 2026-06-27
- [x] Phase 109: Checkers Tutorial Content (4/4) — 2026-06-29
- [x] Phase 110: Demonstration & Refinement (5/5) — 2026-06-29
- [x] Phase 111: Host-Gated Teaching Lockout (5/5) — 2026-06-30

16/16 requirements (TUT-01..05, AI-01..03, HELP-01/02, CHK-01..04, DEMO-01, LOCK-01) · BoardSmith 1706 tests + checkers 38 green · audit passed (`milestones/v4.1-MILESTONE-AUDIT.md`). Full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md).

</details>

### 🚧 v4.2 Tutorial Primitives — Go Fish & Docs — Phases 112–115

- [x] **Phase 112: Go-Fish Tutorial Content** — Four teaching beats (ask-for-rank gating, Go-Fish-draw tip, forming-a-book, turn-continuation) authored in go-fish and launchable in GameShell + `boardsmith dev`, with CI-verifiable test artifact. (completed 2026-06-30)
- [x] **Phase 113: Go-Fish AI Teaching** — MCTS move hint (anchored to cards/hand via `anchorAttrs`) and narrated AI-vs-AI demo, reusing go-fish's existing bot. (completed 2026-06-30)
- [x] **Phase 114: Go-Fish Action Help & Host Lockout** — Per-action help text on go-fish actions and browser-verified proof that `teachingDisabled` gates all teaching affordances on a card game. (completed 2026-06-30)
- [x] **Phase 115: Developer Documentation** — Full authoring guide covering the whole tutorial substrate + AI teaching + action help + host lockout, with checkers (grid) and go-fish (cards) as worked examples. (completed 2026-06-30)

## Phase Details

### Phase 112: Go-Fish Tutorial Content
**Goal**: A new player can follow four teaching beats in go-fish (ask-for-rank gating, Go-Fish-draw predicate tip, forming-a-book, turn-continuation) and the complete tutorial is a CI-verifiable artifact that fails when go-fish rules drift.
**Depends on**: Nothing (first phase of this milestone; consumes v4.1 substrate already in BoardSmith `src/`)
**Scope**: Cross-repo in `~/BoardSmithGames/go-fish`; no BoardSmith `src/` changes expected unless a substrate gap is discovered (flag as risk if found).
**Requirements**: GFT-01, GFT-02, GFT-03, GFT-04, GFT-05, GFT-06
**Success Criteria** (what must be TRUE):
  1. A player entering the go-fish tutorial can only ask for a rank they currently hold, from a legal opponent — the action is gated and an annotation overlay anchors to the relevant cards/hand (not a board cell).
  2. The first time an ask misses and the player must draw, a predicate-triggered tip appears explaining the "Go Fish!" rule.
  3. The tutorial walks the player through completing four of a rank and verifies a book is scored and removed from hand.
  4. The tutorial demonstrates that a successful ask lets the same player go again (the turn does not end on a hit).
  5. The go-fish tutorial is launchable from within the game in both GameShell and the `boardsmith dev` host, identical to the checkers tutorial entry point.
  6. `tutorial.test.ts` (or equivalent) in the go-fish repo uses `simulateTutorial` + `assertTutorialCompletes` and fails (goes red) when a go-fish rule is deliberately broken.
**Plans**: 4 plans
- [x] 112-01-PLAN.md — BoardSmith selectionMatchesValue primitive-matcher fix + unit test (Wave 1)
- [x] 112-02-PLAN.md — go-fish tutorial preset + GO_FISH_TUTORIAL definition + gameDefinition wiring (Wave 2)
- [x] 112-03-PLAN.md — CI-verifiable tutorial.test.ts walkthrough + green→red proof (Wave 3)
- [x] 112-04-PLAN.md — browser smoke checkpoint: launchable in both hosts + card-anchored overlay (Wave 3)
**UI hint**: yes

### Phase 113: Go-Fish AI Teaching
**Goal**: A player can request an MCTS move hint on their go-fish turn and watch a narrated AI-vs-AI demo — both reuse go-fish's existing bot and surface the hint target on cards/hand via `anchorAttrs`, proving card-game parity with checkers' board-square anchoring.
**Depends on**: Phase 112 (go-fish tutorial content establishes the `anchorAttrs` card-anchoring pattern in go-fish)
**Scope**: Cross-repo in `~/BoardSmithGames/go-fish`; no BoardSmith `src/` changes expected unless a card-game-specific substrate gap is discovered.
**Requirements**: GFAI-01, GFAI-02
**Success Criteria** (what must be TRUE):
  1. On their turn, a player can request a move hint; the MCTS bot returns a legal ask and the annotation overlay highlights the target card or hand area — not a board cell — proving `anchorAttrs` generalizes to a card game.
  2. A player can start a narrated AI-vs-AI go-fish demo in which each move is announced in the narration card before it executes, using the same demo infrastructure as checkers.
  3. The hint clears on the next player action and the demo can be stopped mid-game, both without leaving orphaned state (mirrors v4.1's R-06 and demo-stop correctness criteria).
**Plans**: 3 plans
- [x] 113-01-PLAN.md — getGoFishHintTarget hook + gameDefinition.ai wiring + card-group rank anchor + hint-target.test.ts (GFAI-01, Wave 1)
- [x] 113-02-PLAN.md — AI-vs-AI narrated demo integration test (narrate-before-execute + clean stop), substrate-driven (GFAI-02, Wave 1)
- [x] 113-03-PLAN.md — browser human-verify checkpoint: hint ring on rank cards + narrated demo, dev server killed (GFAI-01, GFAI-02, Wave 2)
**UI hint**: yes

### Phase 114: Go-Fish Action Help & Host Lockout
**Goal**: Each go-fish action has author-supplied help text, and the v4.1 `teachingDisabled` host lockout is verified to gate all go-fish teaching affordances (hint, demo, tutorial) while leaving action help enabled — proving the lockout substrate generalizes to a card game.
**Depends on**: Phase 113 (all go-fish teaching affordances must exist before the lockout can be verified against them)
**Scope**: Cross-repo in `~/BoardSmithGames/go-fish` for `.help()` authoring and lockout verification; no BoardSmith `src/` changes expected (the `teachingDisabled` substrate is already in place from Phase 111).
**Requirements**: GFHELP-01, GFLOCK-01
**Success Criteria** (what must be TRUE):
  1. Hovering or tapping any go-fish action (ask for a rank, draw from deck) reveals author-supplied help text; the global "Show action help" toggle shows and hides it correctly.
  2. When the host sets `teachingDisabled`, the go-fish hint button, AI-demo button, and tutorial entry point are all hidden in the UI and the corresponding ops are rejected fail-loud at the server — exactly as checkers' affordances are gated.
  3. When `teachingDisabled` is set, action help text remains visible and functional for go-fish actions (action help is not a teaching affordance).
**Plans**: 3 plans
- [x] 114-01-PLAN.md — GFHELP-01: add `.help()` to the go-fish `ask` action + integration test asserting ActionMetadata.help propagation
- [x] 114-02-PLAN.md — GFLOCK-01: go-fish host-lockout test (locked session: hint/demo/tutorial throw fail-loud; action help stays — both halves)
- [x] 114-03-PLAN.md — Browser checkpoint: ask help reveals in the custom-UI dock + `--lock-teaching` hides the Teaching group while keeping "Show action help" (autonomous:false, kills dev server)

### Phase 115: Developer Documentation
**Goal**: A developer can author a BoardSmith tutorial, predicate triggers, CI-verifiable tests, AI teaching features, action help, and host lockout by reading a single guide — illustrated with both a grid game (checkers) and a card game (go-fish) as worked examples.
**Depends on**: Phase 114 (both checkers and go-fish showcases must be complete so the guide's worked examples reflect real, working code)
**Scope**: BoardSmith `docs/` — new documentation files; no `src/` changes.
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. A developer can read the guide and understand `TutorialDefinition`, the start/advance/skip/exit lifecycle, action gating, and annotation overlay targeting (cell / piece / card / panel / action) — with working code examples.
  2. The guide shows how to author a predicate trigger and how to write a CI-verifiable tutorial test using `simulateTutorial`, including a demonstration that a rule change makes the test fail.
  3. The guide documents the move hint, narrated AI-vs-AI demo, and evaluation heatmap (noting the heatmap is board-only and not applicable to go-fish), plus the `teachingDisabled` host lockout and per-action `.help()` authoring.
  4. Both checkers (grid board, `anchorAttrs` on board squares) and go-fish (card game, `anchorAttrs` on cards/hands) appear as worked examples side-by-side so the parity path is immediately legible to a developer starting a new game.
**Plans**: 2 plans
- [x] 115-01-PLAN.md — Author docs/teaching-and-tutorials.md covering DOC-01..04 with checkers + go-fish worked examples; link from docs/README.md
- [x] 115-02-PLAN.md — Doc-verifier accuracy + coverage pass; README link + BoardSmith suite green

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 112. Go-Fish Tutorial Content | 4/4 | Complete   | 2026-06-30 |
| 113. Go-Fish AI Teaching | 3/3 | Complete   | 2026-06-30 |
| 114. Go-Fish Action Help & Host Lockout | 3/3 | Complete   | 2026-06-30 |
| 115. Developer Documentation | 2/2 | Complete   | 2026-06-30 |
