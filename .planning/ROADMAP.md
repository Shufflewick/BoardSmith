# Roadmap — BoardSmith

## Milestones

- 🚧 **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–149 (in progress)
- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- ✅ **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (shipped 2026-06-30) — full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md)
- ✅ **v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools** — Phases 116–122 (shipped 2026-07-01) — full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md)
- ✅ **v4.4 Agent-Ergonomics Gaps (Audit Fixes)** — Phases 123–130 (shipped 2026-07-02) — full detail: [`milestones/v4.4-ROADMAP.md`](milestones/v4.4-ROADMAP.md)
- ✅ **v4.5 Pit of Success Hardening (Audit #3 Fixes)** — Phases 131–139 (shipped 2026-07-03) — full detail: [`milestones/v4.5-ROADMAP.md`](milestones/v4.5-ROADMAP.md)

## 🚧 v4.6 BS Skills (Rulebook-Driven Game Building) — In Progress

**Milestone Goal:** Replace `/design-game` with a family of `bs-` skills that turn a game rulebook into a working BoardSmith game through small, adversarially-vetted, human-playtested chunks.

### Overview

Requirements cluster into eight fix surfaces following the plan's own build order. `useAnnouncer()` (LIB-01) and the six literal file templates (TMPL-01..03) ship first because every downstream skill consumes them — the a11y floor is unenforceable without the composable, and every skill fills templates rather than improvising state files. `/bs-ingest-rules` (INGEST-01..07) ships next: it is the largest new-thinking surface (chunking, INDEX, visual survey, sketch heuristic, interview fallback, scaffold) and nothing downstream has a project to operate on without it. `/bs-build-chunk`, the state-aware 10-step chunk engine, is split into four phases along its own natural step-group seams (the same seams the plan mandates as session-handoff boundaries): interpretation + ask gate (BUILD-01..04, BUILD-12), build + test with the per-chunk UI/a11y floor (BUILD-05/06, UIQ-01..03), audit + repair with the design-review lens (BUILD-07/08, UIQ-04), and playtest + revise + close + final acceptance (BUILD-09..11/13, UIQ-05). The thin state tools (`/bs-check-status`, `/bs-insert-chunk` — STAT-01/02) come after build-chunk exists, since they read/edit the same state build-chunk writes. Distribution (installer + `/bs-generate-ai` rename — DIST-01/02) comes after all five skills exist to bundle. The milestone closes with an end-to-end dry-run (VAL-01) against a reference game rulebook, proving the whole pipeline before it is pointed at an actual designer.

### Phases

- [ ] **Phase 140: Library Prerequisite — useAnnouncer()** - Game UIs get a screen-reader announce API from `boardsmith/ui`
- [ ] **Phase 141: File Templates & State-Machine Authority** - Literal skeletons for all six state files with enforced authority rules
- [ ] **Phase 142: `/bs-ingest-rules`** - Rulebook (or interview) becomes a scaffolded project with an approved sketch
- [ ] **Phase 143: `/bs-build-chunk` — Interpretation & Ask Gate** - Resume routing, investigate, redteam, and the plain-language ask gate
- [ ] **Phase 144: `/bs-build-chunk` — Build & Test with UI Floor** - Code extension, automated test suite, and the per-chunk a11y/design floor
- [ ] **Phase 145: `/bs-build-chunk` — Audit & Repair with Design Review** - Adversarial fidelity/leak/undo audit plus the screenshot-armed design lens
- [ ] **Phase 146: `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance** - Human verification gate, feedback triage, close bookkeeping, and design-QA
- [ ] **Phase 147: `/bs-check-status` & `/bs-insert-chunk`** - Thin state readers/editors with consistency checks
- [ ] **Phase 148: Distribution — Installer & `/bs-generate-ai`** - One installer for the full skill family; AI-opponent skill renamed and repositioned
- [ ] **Phase 149: End-to-End Dry-Run Validation** - Full pipeline proven against a reference game before shipping

### Phase Details

#### Phase 140: Library Prerequisite — useAnnouncer()

**Goal**: Game UIs can announce meaningful state changes to screen readers, so the per-chunk a11y floor can require it.
**Depends on**: Nothing (first phase)
**Requirements**: LIB-01
**Success Criteria** (what must be TRUE):

  1. A developer can import `useAnnouncer()` from `boardsmith/ui` and call it from any game component to announce a message
  2. Announced messages are written to GameShell's existing live regions and are read by screen readers without adding new DOM nodes
  3. `useAnnouncer()` behaves identically whether used from a custom UI or an AutoUI renderer

**Plans**: 1 plan

- [x] 140-01-PLAN.md — useAnnouncer() composable + GameShell wiring + public export + parity/relay tests

**UI hint**: yes

#### Phase 141: File Templates & State-Machine Authority

**Goal**: Every `bs-` skill has literal, unambiguous file templates to fill, and the hard state-machine rules that keep cold-resume safe are enforced from day one.
**Depends on**: Nothing (independent of Phase 140; both are prerequisites for everything downstream)
**Requirements**: TMPL-01, TMPL-02, TMPL-03
**Success Criteria** (what must be TRUE):

  1. SKETCH.md, CHUNK.md, RULINGS.md, DECISIONS.md, DESIGN.md, and ASSETS.md each exist as literal template files with exact step names and status enum values
  2. A resumed session that finds a state file failing to parse against its template stops and asks the user instead of guessing
  3. CHUNK.md is authoritative for its own chunk's status; SKETCH.md holds only the ordered list and derived pointers; on contradiction CHUNK.md wins and the session logs + repairs the sketch; writes always go CHUNK.md first, SKETCH.md second

**Plans**: 3 plans

- [x] 141-01-PLAN.md — state-machine.md authority-rules doc + drift-test scaffold
- [x] 141-02-PLAN.md — CHUNK.template.md + SKETCH.template.md (status-bearing templates) + cross-file agreement test
- [x] 141-03-PLAN.md — RULINGS/DECISIONS/DESIGN/ASSETS ledger templates + full drift test

#### Phase 142: `/bs-ingest-rules`

**Goal**: A designer can turn a rulebook (or a from-scratch interview) into a scaffolded, compiling project with an approved sketch, ready for the first chunk.
**Depends on**: Phase 140, Phase 141
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, INGEST-07
**Success Criteria** (what must be TRUE):

  1. A designer can hand `/bs-ingest-rules` a PDF/image/text rulebook and receive canonical `rulebook/` slices with citations, each confirmed section-by-section with the user
  2. Ingest produces `rulebook/INDEX.md`, variant/edition tagging, a component inventory with aspect ratios, `ASSETS.md`, a visual identity survey, and player-count data
  3. A designer with no written rulebook can complete the same ingest via an interview fallback that produces the identical set of `rulebook/` files
  4. Ingest scaffolds the project (`boardsmith init` + naming rules), verifies the empty skeleton compiles and serves, and proposes a `SKETCH.md` — core-event-loop-first, mandatory game-end/final-acceptance chunks, `ui:` tags, outcome-based test scripts — gated on user approval with chunk-count/time expectations, including the UI strategy decision made with the user
  5. Re-running ingest on an existing project requires explicit confirmation, and an old `/design-game` project is offered a one-time conversion instead of being silently overwritten

**Plans**: 3 plans

- [x] 142-01-PLAN.md — drift test harness + lean orchestrator skill (INGEST-02/06/07)
- [x] 142-02-PLAN.md — transcription fan-out + interview fallback reference files (INGEST-01/03)
- [x] 142-03-PLAN.md — scaffold + sketch-derivation reference files (INGEST-04/05)

#### Phase 143: `/bs-build-chunk` — Interpretation & Ask Gate

**Goal**: A designer can start or resume any chunk at exactly the right step, and reach a human-approved, plain-language design before a single line of code is written.
**Depends on**: Phase 142
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-12
**Success Criteria** (what must be TRUE):

  1. Running `/bs-build-chunk` resumes at the first incomplete step of the current chunk — including mid-loop and awaiting-playtest states — and routes conversational status/insert intents instead of misbuilding
  2. Investigate produces a numbered, citation-backed claims list plus a hidden-information visibility declaration, built from cited slices, INDEX-discovered slices, `RULINGS.md`, and `DECISIONS.md`
  3. Redteam runs 3 independent fresh-context agents (2 refuters + 1 coverage adversary) against the claims list with no investigator framing; a claim refuted twice escalates to the user as a plain-language ruling recorded in `RULINGS.md`
  4. The ask gate presents plain designer-language rules with citations, ambiguity questions with options, a "what you will NOT see yet" list, zero implementation vocabulary, and requests any needed assets with a never-blocking placeholder path
  5. Chunks tagged trivial run the light path (build → test → playtest) with the user explicitly told which ceremony is in effect

**Plans**: 5 plans

- [x] 143-01-PLAN.md — build-chunk.test.ts structural drift suite (Wave 0 contract: pins step/enum strings + return-shape field names)
- [x] 143-02-PLAN.md — build-chunk.md orchestrator: resume routing, 3-way session lock, conversational intents, full+light routing (BUILD-01, BUILD-12)
- [x] 143-03-PLAN.md — build/investigate.md: doc-reading + claims list + visibility declaration (BUILD-02)
- [x] 143-04-PLAN.md — build/redteam.md: 3 fresh-context agents, no framing, refuted-twice → RULINGS.md (BUILD-03)
- [x] 143-05-PLAN.md — build/ask.md: 4-part plain-language gate, zero impl vocab, never-blocking assets, gate-before-write (BUILD-04)

#### Phase 144: `/bs-build-chunk` — Build & Test with UI Floor

**Goal**: An approved design becomes extended, automatically-tested code that meets the per-chunk accessibility and visual-identity floor.
**Depends on**: Phase 143
**Requirements**: BUILD-05, BUILD-06, UIQ-01, UIQ-02, UIQ-03
**Success Criteria** (what must be TRUE):

  1. Build reads the raw slices plus the approved interpretation, extends rather than restructures verified code (restructuring requires a user gate), appends to `DECISIONS.md`, and keeps a per-file manifest so a mid-build crash resumes file-by-file
  2. Test runs `tsc --noEmit`, the boardsmith eslint plugin, unit/integration tests, the full accumulated regression suite, and a random-simulation playthrough to a terminal state
  3. The first UI chunk's ask offers Adopt/Derive/Original visual directions and records the choice in `DESIGN.md` with token overrides and component recipes
  4. Components awaiting assets render designed, correctly-proportioned placeholders styled from `DESIGN.md` tokens, and a later asset swap causes zero layout change
  5. `ui: touches|major` chunks pass the a11y floor: keyboard-only ActionPanel completion, an axe-core scan, a no-color-literal grep, real semantic controls with game-meaning labels, focus management, and `prefers-reduced-motion` honored

**Plans**: 4 plans

- [x] 144-01-PLAN.md — Wave-0 drift-test scaffold (build-chunk.test.ts: BUILD-05/06, UIQ-01..03 blocks + updated path/marker arrays)
- [x] 144-02-PLAN.md — Scaffold-template real code: axe-core + @vue/test-utils devDeps + tests/a11y.example.test.ts (UIQ-03)
- [x] 144-03-PLAN.md — build/build.md + build/test.md ({build,test} step group: BUILD-05, BUILD-06, UIQ-02, UIQ-03)
- [x] 144-04-PLAN.md — build/design-ask.md + ask.md hook + build-chunk.md routing (UIQ-01) + phase gate

**UI hint**: yes

#### Phase 145: `/bs-build-chunk` — Audit & Repair with Design Review

**Goal**: Every chunk is adversarially checked against the rulebook, hidden-information leaks, undo sanity, and (for UI chunks) visual cohesion before it ever reaches the human.
**Depends on**: Phase 144
**Requirements**: BUILD-07, BUILD-08, UIQ-04
**Success Criteria** (what must be TRUE):

  1. Audit agents read the raw slices + `RULINGS.md` + the code (never the interpretation) and record fidelity, visibility-leak (two-seat diff), and undo findings in a stable-ID ledger inside `CHUNK.md`
  2. Repair loops fix findings or refute them with citations, cap at 3 audit rounds enforcing an only-new-findings rule, and triage any remaining findings to the user
  3. `ui: touches|major` chunks get a screenshot-armed design-review agent that captures 3 Slate breakpoints × 2 themes, diffs against `DESIGN.md` and the previous chunk's stored screenshots, and feeds findings into the same repair loop

**Plans**: 2 plans
Plans:
**Wave 1**

- [x] 145-01-PLAN.md — {audit, repair} step group: audit.md (BUILD-07, 3 lenses + leak diff) & repair.md (BUILD-08, bounded fix-or-refute loop)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 145-02-PLAN.md — design-review agent (UIQ-04): screenshot 3×2 breakpoint/theme grid, cohesion diff, server-kill

**UI hint**: yes

#### Phase 146: `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance

**Goal**: A human verifies every chunk in the browser on the most polished artifact, feedback is triaged honestly, and closed chunks leave a durable, git-anchored, resumable trail.
**Depends on**: Phase 145
**Requirements**: BUILD-09, BUILD-10, BUILD-11, BUILD-13, UIQ-05
**Success Criteria** (what must be TRUE):

  1. Playtest hands the user a numbered, click-by-click script (seat counts, dev-host affordances taught once, a build stamp, a regression line) with an explicit item-by-item verified checklist, and a `verified (user-waived)` state exists for honest skipping
  2. Feedback is triaged item-by-item (this-chunk / future-scope / not-built-yet / ruling); re-entry after a revise round shows a feedback disposition report with a targeted re-test script, not a blind full re-test
  3. Close records the verified commit hash in `CHUNK.md`, re-derives the sketch tail against the rulebook, and presents the delta for approval before proposing the next chunk
  4. Sessions commit at every step completion (`chunk-<slug>/step-<name>`), hand off at structural step-group seams with a non-programmer-readable resume message, and a second concurrent session is warned via a sketch lock note instead of silently clobbered
  5. The final-acceptance chunk runs the full design-QA pass (screen-reader playthrough, 200% zoom, touch targets, colorblind pass, both Slate themes, mobile layout) as part of what "done" means for the sketch

**Plans**: 4 plans
- [x] 146-01-PLAN.md — extend build-chunk.test.ts drift suite (BUILD-09/10/11/13 + UIQ-05 describe blocks; invert forward-ref markers to zero-remain)
- [x] 146-02-PLAN.md — author build/playtest.md (BUILD-09 human gate) + build/revise.md (BUILD-10 4-category triage)
- [ ] 146-03-PLAN.md — author build/close.md (BUILD-11 bookkeeping + sketch-tail delta gate) + build/final-acceptance.md (UIQ-05 6-point design-QA)
- [ ] 146-04-PLAN.md — retire all forward-ref markers in build-chunk.md, register 4 files, reconcile Step Group 4 dispatch, assert full suite green (BUILD-13)
**UI hint**: yes

#### Phase 147: `/bs-check-status` & `/bs-insert-chunk`

**Goal**: A designer can see exactly where the project stands and reshape the sketch safely without corrupting state.
**Depends on**: Phase 142, Phase 146
**Requirements**: STAT-01, STAT-02
**Success Criteria** (what must be TRUE):

  1. `/bs-check-status` reports chunks done/remaining, the current chunk and step, outstanding playtest feedback, waived verifications, outstanding asset debts, ideas backlog size, and the exact next command to run
  2. `/bs-insert-chunk` can add, reorder, split, or remove chunks, re-validating dependency order against citations and diffing the new chunk's citations against closed chunks to flag overlaps
  3. `/bs-insert-chunk` marks any already-detailed pending `CHUNK.md` as stale-needs-re-derivation and bumps the sketch version stamp so a concurrently resumed build session detects the sketch changed under it

**Plans**: TBD

#### Phase 148: Distribution — Installer & `/bs-generate-ai`

**Goal**: Installing BoardSmith's Claude tooling gives a designer the complete, self-consistent `bs-` skill family with no dead `/design-game` path left behind.
**Depends on**: Phase 142, Phase 146, Phase 147
**Requirements**: DIST-01, DIST-02
**Success Criteria** (what must be TRUE):

  1. `install-claude-command.ts` installs all five `bs-` skills plus the shared reference files (aspects, doc lists, templates) in one pass
  2. Running install removes the `design-game` template entirely, with no residual references left in the installed set
  3. `/generate-ai` is renamed `/bs-generate-ai`, keeps working as an AI-opponent generator, and is positioned/reachable as a late sketch chunk once game-end/scoring exists

**Plans**: TBD

#### Phase 149: End-to-End Dry-Run Validation

**Goal**: The full rulebook-to-playable-game pipeline is proven end-to-end against a real rulebook before it is ever pointed at an actual designer.
**Depends on**: Phase 148
**Requirements**: VAL-01
**Success Criteria** (what must be TRUE):

  1. `/bs-ingest-rules` through several `/bs-build-chunk` cycles run against a reference game's rulebook (e.g. Hex or Go Fish) end-to-end, including all playtest gates
  2. The dry-run's resulting implementation is compared against the existing hand-built reference implementation, with discrepancies reconciled or explicitly documented
  3. Any pipeline defects (skill logic, template gaps, gate friction) surfaced during the dry-run are fixed before the milestone ships

**Plans**: TBD

### Progress

**Execution Order:**
Phases execute in numeric order: 140 → 141 → 142 → 143 → 144 → 145 → 146 → 147 → 148 → 149

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 140. Library Prerequisite — useAnnouncer() | 1/1 | Complete    | 2026-07-04 |
| 141. File Templates & State-Machine Authority | 3/3 | Complete    | 2026-07-04 |
| 142. `/bs-ingest-rules` | 3/3 | Complete    | 2026-07-04 |
| 143. `/bs-build-chunk` — Interpretation & Ask Gate | 5/5 | Complete    | 2026-07-04 |
| 144. `/bs-build-chunk` — Build & Test with UI Floor | 4/4 | Complete    | 2026-07-04 |
| 145. `/bs-build-chunk` — Audit & Repair with Design Review | 2/2 | Complete    | 2026-07-05 |
| 146. `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance | 2/4 | In Progress|  |
| 147. `/bs-check-status` & `/bs-insert-chunk` | 0/TBD | Not started | - |
| 148. Distribution — Installer & `/bs-generate-ai` | 0/TBD | Not started | - |
| 149. End-to-End Dry-Run Validation | 0/TBD | Not started | - |

### Shipped milestones

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
<details>
<summary>✅ v4.2 Tutorial Primitives — Go Fish & Docs — Phases 112–115 — SHIPPED 2026-06-30</summary>

- [x] Phase 112: Go-Fish Tutorial Content (4/4) — 2026-06-30
- [x] Phase 113: Go-Fish AI Teaching (3/3) — 2026-06-30
- [x] Phase 114: Go-Fish Action Help & Host Lockout (3/3) — 2026-06-30
- [x] Phase 115: Developer Documentation (2/2) — 2026-06-30

14/14 requirements (GFT-01..06, GFAI-01/02, GFHELP-01, GFLOCK-01, DOC-01..04) · go-fish 78 + BoardSmith 1708 tests green · audit passed (`milestones/v4.2-MILESTONE-AUDIT.md`). Proved the v4.1 tutorial substrate generalizes to a hidden-information card game + shipped the developer authoring guide. Full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md).

</details>

<details>
<summary>✅ v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools — Phases 116–122 — SHIPPED 2026-07-01</summary>

- [x] Phase 116: Verification & API Design (3/3) — 2026-06-30
- [x] Phase 117: Action-Space Introspection (4/4) — 2026-06-30
- [x] Phase 118: Test Ergonomics (4/4) — 2026-06-30
- [x] Phase 119: Dev-Host Devtools Bridge (4/4) — 2026-07-01
- [x] Phase 120: Authoring Pit-of-Success Guards (5/5) — 2026-07-01
- [x] Phase 121: Game & MERC Migration (3/3) — 2026-07-01
- [x] Phase 122: Documentation (4/4) — 2026-07-01

27/27 requirements (DSGN-01..03, INTRO-01..05+F1, TEST-01..05, DEV-01..04, PIT-01..04, MIG-01/02, DOC-01..04) · BoardSmith 1873 tests + all 7 games + MERC 738 green · audit passed (`milestones/v4.3-MILESTONE-AUDIT.md`). Agent-drivable engine: serializable action-space introspection, self-explaining test ergonomics, dev-host devtools bridge (browser-proven), fail-fast authoring guards, full game+MERC migration. Full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md).

</details>

<details>
<summary>✅ v4.4 Agent-Ergonomics Gaps (Audit Fixes) — Phases 123–130 — SHIPPED 2026-07-02</summary>

- [x] Phase 123: Determinism & Flow Introspection (4/4) — 2026-07-01
- [x] Phase 124: Hidden-Info Test Utilities (3/3) — 2026-07-02
- [x] Phase 125: Headless Simulation (2/2) — 2026-07-02
- [x] Phase 126: Structured Error Surfacing (4/4) — 2026-07-02
- [x] Phase 127: Scriptable Dev Host (3/3) — 2026-07-02
- [x] Phase 128: Animation & Drag-Drop Test Story (6/6) — 2026-07-02
- [x] Phase 129: Migration (Games + MERC) (3/3) — 2026-07-02
- [x] Phase 130: Documentation (2/2) — 2026-07-02

23/23 requirements (FLOW-01..04, VIS-01..03, SIM-01/02, ERR-01..04, DRIVE-01..03, ANIM-01..03, MIG-03/04, DOC-05/06) · BoardSmith 159 files / 2081 tests + all 8 games + MERC 738 green · audit passed (`milestones/v4.4-MILESTONE-AUDIT.md`). Closed every verified gap from the 2026-07-01 agent-ergonomics audit: determinism/flow introspection, hidden-info test utilities, headless simulation (`boardsmith simulate`), structured error surfacing, a fully scriptable dev host (`createDevHostClient`), an animation/drag-drop test story, full game+MERC migration, and docs. Full detail: [`milestones/v4.4-ROADMAP.md`](milestones/v4.4-ROADMAP.md).

</details>

---

<details>
<summary>✅ v4.5 Pit of Success Hardening (Audit #3 Fixes) — Phases 131–139 — SHIPPED 2026-07-03</summary>

42/42 requirements · 34 audit findings fixed verify-first · BoardSmith 2371 tests · 8 games + MERC (738) green · audit passed. See [`milestones/v4.5-ROADMAP.md`](milestones/v4.5-ROADMAP.md).

</details>
</content>
