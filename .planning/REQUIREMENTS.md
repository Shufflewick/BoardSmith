# Requirements: BoardSmith v4.6 — BS Skills (Rulebook-Driven Game Building)

**Defined:** 2026-07-04
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Milestone Goal:** Replace `/design-game` with a family of `bs-` skills that turn a game rulebook into a working BoardSmith game through small, adversarially-vetted, human-playtested chunks.
**Design contract:** `.planning/bs-skills-plan.md` (v2, hardened by 4-lens adversarial review). Where a requirement summarizes a mechanism, the plan document is authoritative for the details.

## v4.6 Requirements

### Library Prerequisite (LIB)

- [x] **LIB-01**: Game UIs can announce game-state changes to screen readers via a `useAnnouncer()` composable exported from `boardsmith/ui` that writes to GameShell's existing live regions

### File Templates (TMPL)

- [ ] **TMPL-01**: Skills ship literal file templates for SKETCH.md, CHUNK.md, RULINGS.md, DECISIONS.md, DESIGN.md, and ASSETS.md with exact step names and status enums
- [ ] **TMPL-02**: A resumed session that finds a state file not parsing against its template stops and asks the user instead of guessing
- [ ] **TMPL-03**: Chunk status authority rules are enforced (CHUNK.md owns its status; SKETCH.md is derived; CHUNK.md wins on contradiction; write order CHUNK→SKETCH)

### `/bs-ingest-rules` (INGEST)

- [ ] **INGEST-01**: Designer can ingest a rulebook (PDF/images/text) that is transcribed once by fan-out subagents into canonical `rulebook/` slices with citations, each confirmed with the user
- [ ] **INGEST-02**: Ingest produces `rulebook/INDEX.md` (term → slice cross-reference), variant/edition tagging, component inventory with aspect ratios, ASSETS.md, visual identity survey, and player-count data
- [ ] **INGEST-03**: Designer with no written rulebook can use an interview fallback that produces the same `rulebook/` files section by section
- [ ] **INGEST-04**: Ingest scaffolds the project (`boardsmith init`, naming rules) and verifies the skeleton compiles and serves before rules work begins
- [ ] **INGEST-05**: Ingest proposes a SKETCH.md whose first chunk is the core event loop, that mandates game-end and final-acceptance chunks, tags chunks `ui: none|touches|major`, uses outcome-based test scripts, and gates on user approval with chunk-count/time expectations
- [ ] **INGEST-06**: The UI strategy decision (Custom UI from chunk 1 vs AutoUI-with-cutover) is made with the user at ingest and recorded
- [ ] **INGEST-07**: Re-running ingest on an existing project detects state and requires explicit confirmation; old `/design-game` projects get a one-time conversion offer

### `/bs-build-chunk` (BUILD)

- [ ] **BUILD-01**: Designer can run `/bs-build-chunk` at any time and it resumes at the first incomplete step of the current chunk, including mid-loop and awaiting-playtest states
- [ ] **BUILD-02**: Investigate reads cited slices plus INDEX-discovered slices, RULINGS.md, and DECISIONS.md, and produces a claims-list interpretation with a hidden-information visibility declaration
- [ ] **BUILD-03**: Redteam runs 3 fresh-context agents (2 refuters + 1 coverage adversary) on the claims list without investigator framing; refuted-twice escalates to the user as a plain-language ruling recorded in RULINGS.md
- [ ] **BUILD-04**: The ask gate presents plain game-designer language with citations, ambiguity questions with options, a "what you will NOT see yet" list, and zero implementation vocabulary; assets are requested here with a never-blocking placeholder path
- [ ] **BUILD-05**: Build reads raw slices + approved interpretation, extends rather than restructures verified code (restructure requires a user gate), appends to DECISIONS.md, and keeps a per-file manifest for mid-step resume
- [ ] **BUILD-06**: The test step runs tsc, boardsmith eslint, unit/integration tests, the full accumulated suite, and a random-simulation playthrough to a terminal state
- [ ] **BUILD-07**: Audit agents read raw slices + RULINGS.md + code (never the interpretation) with fidelity, visibility-leak (two-seat diff), and undo lenses, writing to a stable-ID findings ledger
- [ ] **BUILD-08**: Repair loops are bounded (max 3 audit rounds, only-new-findings rule, refutation-with-citation allowed) with remaining findings triaged to the user
- [ ] **BUILD-09**: Playtest hands the user a numbered click-by-click script with seat counts, dev-host affordances, a build stamp, a regression line, and an explicit item-by-item verified checklist; `verified (user-waived)` is recordable
- [ ] **BUILD-10**: Playtest feedback is triaged item-by-item (this-chunk / future-scope / not-built-yet / ruling) and re-entry after revision presents a feedback disposition report with a targeted re-test script
- [ ] **BUILD-11**: Close records the verified commit hash, re-derives the sketch tail, and presents the delta for approval before proposing the next chunk
- [ ] **BUILD-12**: Trivial chunks run a light path (build → test → playtest) with the user told which ceremony is in effect
- [ ] **BUILD-13**: Sessions commit at every step completion (`chunk-<slug>/step-<name>`), hand off at structural step-group seams with a non-programmer-readable resume message, and detect concurrent sessions via a sketch lock note

### UI Quality & Accessibility (UIQ)

- [ ] **UIQ-01**: The first UI chunk's ask is a design ask offering Adopt / Derive / Original (frontend-design mood sketches), recorded in DESIGN.md with token overrides and component recipes
- [ ] **UIQ-02**: Components awaiting assets render designed placeholders (correct aspect ratio, DESIGN.md tokens, labeled) whose asset swap never changes geometry
- [ ] **UIQ-03**: UI chunks enforce the a11y floor: ActionPanel keyboard-only completability test, axe scan, no-color-literals grep, real controls with game-semantic labels, focus management, reduced-motion
- [ ] **UIQ-04**: UI chunks get a screenshot-armed design-review audit agent (3 breakpoints × 2 themes, drift diff vs stored shots) feeding the repair loop
- [ ] **UIQ-05**: The final-acceptance chunk includes the design-QA pass (screen-reader playthrough, zoom, touch targets, colorblind, both themes, mobile)

### Status & Sketch Editing (STAT)

- [ ] **STAT-01**: Designer can run `/bs-check-status` to see chunks done/remaining, current step, outstanding feedback, waived verifications, asset debts, and the exact next command
- [ ] **STAT-02**: Designer can reshape the sketch via `/bs-insert-chunk`, which diffs citations against closed chunks, marks stale detailed chunks, and bumps the sketch version stamp

### Distribution (DIST)

- [ ] **DIST-01**: `install-claude-command.ts` installs all five bs- skills + shared reference files (aspects, doc lists, templates) and removes the design-game template
- [ ] **DIST-02**: `/generate-ai` is renamed `/bs-generate-ai` and positioned as a late sketch chunk after game-end exists

### Validation (VAL)

- [ ] **VAL-01**: The full pipeline is dry-run against a reference game rulebook end-to-end (ingest → several chunks → playtest gates) and compared against the hand-built implementation before release

## Future Requirements (deferred)

- Multi-rulebook/expansion ingestion (base game + expansion merged into one sketch) — base-game pipeline must prove out first
- Automated asset generation (AI-generated card art/board art) — placeholder policy covers the gap for now
- Localization/i18n of generated games — carried from earlier milestones' named gaps

## Out of Scope

- Backward compatibility with `/design-game` project state beyond the one-time conversion — No Backward Compatibility rule; clean break
- Building bs- skills for non-Claude runtimes — the installer targets Claude Code only, as today
- Scanned-art adoption pipelines for commercial games beyond the trade-dress caution — licensing is the designer's responsibility; the skill only warns
- Direct arrow-key spatial navigation on custom boards as a requirement — ActionPanel keyboard path is the required accessible route; spatial nav stays recommended

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIB-01 | Phase 140 | Complete |
| TMPL-01 | Phase 141 | Pending |
| TMPL-02 | Phase 141 | Pending |
| TMPL-03 | Phase 141 | Pending |
| INGEST-01 | Phase 142 | Pending |
| INGEST-02 | Phase 142 | Pending |
| INGEST-03 | Phase 142 | Pending |
| INGEST-04 | Phase 142 | Pending |
| INGEST-05 | Phase 142 | Pending |
| INGEST-06 | Phase 142 | Pending |
| INGEST-07 | Phase 142 | Pending |
| BUILD-01 | Phase 143 | Pending |
| BUILD-02 | Phase 143 | Pending |
| BUILD-03 | Phase 143 | Pending |
| BUILD-04 | Phase 143 | Pending |
| BUILD-12 | Phase 143 | Pending |
| BUILD-05 | Phase 144 | Pending |
| BUILD-06 | Phase 144 | Pending |
| UIQ-01 | Phase 144 | Pending |
| UIQ-02 | Phase 144 | Pending |
| UIQ-03 | Phase 144 | Pending |
| BUILD-07 | Phase 145 | Pending |
| BUILD-08 | Phase 145 | Pending |
| UIQ-04 | Phase 145 | Pending |
| BUILD-09 | Phase 146 | Pending |
| BUILD-10 | Phase 146 | Pending |
| BUILD-11 | Phase 146 | Pending |
| BUILD-13 | Phase 146 | Pending |
| UIQ-05 | Phase 146 | Pending |
| STAT-01 | Phase 147 | Pending |
| STAT-02 | Phase 147 | Pending |
| DIST-01 | Phase 148 | Pending |
| DIST-02 | Phase 148 | Pending |
| VAL-01 | Phase 149 | Pending |

**Coverage:** 34/34 v4.6 requirements mapped, no orphans, no duplicates.
