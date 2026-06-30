# Roadmap — BoardSmith

## Milestones

- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- ✅ **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (shipped 2026-06-30) — full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md)
- 🚧 **v4.3 Agent-Ready Engine** — Phases 116–122 (planning) — full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md)

## Phases

- [x] **Phase 116: Verification & API Design** — Verify scout friction claims (confirmed/false/partial + evidence) and lock an approved API-design doc; gates all later phases. ✅ 2026-06-30 (3/3 plans, verification passed)
- [x] **Phase 117: Action-Space Introspection** — Keystone: one serializable entry point for every legal action (selections, choices, `dependsOn`, arg templates) + per-action schema, validated arg-building, legal-move enumeration, perspective-aware state view. ✅ 2026-06-30 (4/4 plans, verification 6/6, code review clean)
- [ ] **Phase 118: Test Ergonomics** — Typed observable state, `playUntilComplete` with stuck-game diagnostics, auto-trace on failed availability assertions, permissive-vs-exact action assertions, multi-step selection builder.
- [ ] **Phase 119: Dev-Host Devtools Bridge** — Stable `data-element-id` selectors (custom UI + AutoUI), read-only `window.__BOARDSMITH_DEVTOOLS`, observable action-resolved signal — browser-proven.
- [ ] **Phase 120: Authoring Pit-of-Success Guards** — Fail-fast `maxIterations`, element-registration validation, flow-reachability validation, and lint coverage for confirmed identity/state footguns.
- [ ] **Phase 121: Game & MERC Migration** — Migrate all `~/BoardSmithGames/` games onto the new APIs, keep BoardSmith green, re-vendor + verify the MERC canary.
- [ ] **Phase 122: Documentation** — Agent-control guide, updated testing + browser/dev-host docs, and authoring/common-pitfalls updates for the shipped surface.

See [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md) for goals, dependencies, requirement mappings, and success criteria.

## Phase Details

### Phase 116: Verification & API Design
**Goal**: Establish ground truth on what already exists vs. what must be built, and lock a single reviewed API-design doc so implementation builds the agreed surface (and exposes/documents rather than rebuilds).
**Depends on**: Nothing (first phase of this milestone; hard dependency for every later phase)
**Scope**: BoardSmith `src/` (read/verify only) + a new design doc under `docs/` or `.planning/`. No production code changes.
**Requirements**: DSGN-01, DSGN-02, DSGN-03
**Success Criteria** (what must be TRUE):
  1. Every scouted friction claim has a recorded verdict (confirmed / false / partial) with file:line evidence and an explicit "already exists vs. needs building" note (e.g. `getPlayerView()`, private checkpoint APIs, an existing action-resolved signal).
  2. A single API-design doc specifies the introspection / test-ergonomics / devtools surface — names, signatures, return shapes, serialization, and ownership across engine/session/runtime/ui — and is approved before implementation begins.
  3. The doc explicitly records which speculative scout recommendations (e.g. lint rules, hidden-info assertions, programmatic seat-switch) are IN vs. DEFERRED, each with rationale.
**Plans**: 3 plans
- [x] 116-01-PLAN.md — Verdicts table (DSGN-01) + INTRO/TEST API spec (DSGN-02)
- [x] 116-02-PLAN.md — DEV/PIT API spec (DSGN-02) + speculative-scope disposition (DSGN-03)
- [x] 116-03-PLAN.md — No-regression check + human approval gate

### Phase 117: Action-Space Introspection
**Goal**: Ship the keystone primitive every other layer depends on — a single, serializable way to ask "what can this seat do right now, with what choices?" — plus per-action schema, validated arg-building, full legal-move enumeration, and a typed perspective-aware state view.
**Depends on**: Phase 116 (design doc locks the surface; verification determines what to expose vs. build)
**Scope**: BoardSmith `src/` — primarily engine/session/runtime; serializable, no-backward-compat clean implementation.
**Requirements**: INTRO-01, INTRO-02, INTRO-03, INTRO-04, INTRO-05, INTRO-F1 (promoted)
**Success Criteria** (what must be TRUE):
  1. A user can call one method to get every legal action for a seat — each with its selections, choices, dependencies (`dependsOn`), and ready-to-submit argument templates — in one serializable structure.
  2. A user can retrieve a single action's schema (selection names, types, optional flags, available choices) without executing it.
  3. A user can build validated, wire-correct action arguments from plain selection values without hand-constructing `{value, display}` / element-id shapes.
  4. A user can enumerate all concrete legal moves (action + fully-resolved args) from the current state, suitable for tree search / brute-force exploration.
  5. A user can obtain a typed, perspective-aware view of game state ("what does seat N see?") with hidden information correctly excluded.
**Plans**: 4 plans
Plans:
- [x] 117-01-PLAN.md — Foundational type exports (ElementDiff + ActionMetadata) to session barrel [INTRO-F1, INTRO-02]
- [x] 117-02-PLAN.md — Extract legal-move enumeration core; enumerateLegalMoves + MCTSBot delegation [INTRO-04]
- [x] 117-03-PLAN.md — buildActionArgs in-process/wire arg builder [INTRO-03]
- [x] 117-04-PLAN.md — getActionSpace + getActionSchema on Game + hidden-info leak regression [INTRO-01, INTRO-02, INTRO-05]

### Phase 118: Test Ergonomics
**Goal**: A test author can read state, drive games to completion, and assert availability without parsing snapshot JSON or dropping to low-level selection plumbing — with failures that explain themselves.
**Depends on**: Phase 117 (observable state, `playUntilComplete`, and the multi-step builder all build on the introspection primitive)
**Scope**: BoardSmith `src/testing/` (TestGame ergonomics) + supporting engine/session surface from Phase 117.
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. A test author can read observable game state through a typed API without parsing snapshot JSON or knowing per-game accessor methods.
  2. A test author can play a game to completion with one call that guards against infinite/stuck loops and throws a structured, actionable diagnostic (e.g. `GameStuckError`) instead of hanging.
  3. When an availability/action assertion fails, the failure message automatically includes a trace explaining *why* the action is unavailable (which selection/condition failed).
  4. Action-list assertions support both permissive ("contains these") and exact ("only these") modes, chosen explicitly rather than exact-by-default.
  5. A test author can drive multi-step / dependent selections through an ergonomic builder rather than low-level `resolveChoices` / `selectionStep` calls.
**Plans**: TBD

### Phase 119: Dev-Host Devtools Bridge
**Goal**: Agents (and humans) can drive the `boardsmith dev` host by stable element id and confirm outcomes via an observable signal — no coordinate-clicking, no vision, no polling — in both custom UI and AutoUI.
**Depends on**: Phase 117 (the devtools global surfaces the introspection state: available actions, valid elements, current selection)
**Scope**: BoardSmith `src/ui/` (renderers + GameShell) and `src/cli/dev-host/`; cross-repo browser verification against a custom-UI game and an AutoUI game.
**Requirements**: DEV-01, DEV-02, DEV-03, DEV-04
**Success Criteria** (what must be TRUE):
  1. Every rendered board element exposes a stable selector (`data-element-id`, plus notation where applicable) in both custom UI and AutoUI, so agents select by id instead of coordinates/vision.
  2. A `boardsmith dev` page exposes a read-only `window.__BOARDSMITH_DEVTOOLS` global to synchronously inspect current game state, available actions, and board-interaction state (valid elements, current selection).
  3. The dev-host page emits an observable signal (custom event and/or devtools log) when an action resolves, distinguishing success from failure, so agents confirm outcomes without polling.
  4. The fastest agent UI loop (change → drive → confirm) is proven end-to-end in the browser for at least one custom-UI game and one AutoUI game.
**Plans**: TBD
**UI hint**: yes

### Phase 120: Authoring Pit-of-Success Guards
**Goal**: Convert the highest-value silent authoring footguns into fail-fast, actionable errors at construction/start time, plus lint coverage for the identity/state mistakes confirmed in DSGN.
**Depends on**: Phase 116 (PIT-04's lint rules target the specific footguns DSGN-01 confirms; the construction/start guards are independent of INTRO)
**Scope**: BoardSmith `src/engine/` (construction/start validation) + `src/eslint-plugin/` (new lint rules).
**Requirements**: PIT-01, PIT-02, PIT-03, PIT-04
**Success Criteria** (what must be TRUE):
  1. A `loop()` declared without `maxIterations` fails fast at game construction with an actionable error (not a dev-console-only warning).
  2. Game start validates element registration and fails loud with an actionable message naming any custom element class that is used but unregistered.
  3. Game start validates that every registered action is reachable from at least one `actionStep`, warning/erroring on actions that can never fire.
  4. Lint rules catch the highest-value silent footguns confirmed in DSGN-01 (element identity comparison via `includes`/`===`, element arrays used as state), with actionable messages.
**Plans**: TBD

### Phase 121: Game & MERC Migration
**Goal**: Prove the new surface against every real game — adopt the introspection/test APIs where they replace hand-rolled patterns, keep all suites green, and re-vendor the MERC canary.
**Depends on**: Phases 117, 118, 119, 120 (the full surface must be built and stabilized before games migrate onto it)
**Scope**: Cross-repo — all `~/BoardSmithGames/` games (symlinked, live HMR) and the MERC vendored copy (`~/Dropbox/MERC/BoardSmith/MERC`, must be re-vendored). Minimal BoardSmith `src/` changes only to close gaps migration surfaces.
**Requirements**: MIG-01, MIG-02
**Success Criteria** (what must be TRUE):
  1. All `~/BoardSmithGames/` example games adopt the new introspection/test APIs where they replace hand-rolled patterns, and every game test suite passes.
  2. BoardSmith's own test suite passes with the new surface.
  3. The MERC vendored canary is re-vendored against the new surface and verified green.
**Plans**: TBD

### Phase 122: Documentation
**Goal**: Bring the docs in line with the shipped, migrated surface so an agent or author can learn headless driving, the new test ergonomics, browser/dev-host driving, and the new authoring guards from the docs alone.
**Depends on**: Phase 121 (docs describe the shipped + game-migrated surface, with real worked examples)
**Scope**: BoardSmith `docs/` only — agent-control guide, testing, browser-testing, authoring/common-pitfalls.
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. An agent-control guide documents headless driving (create → inspect → enumerate → submit → assert), the introspection APIs, undo/checkpoint/replay, and determinism/seeding.
  2. Testing documentation is updated for the new TestGame ergonomics (observable state, `playUntilComplete`, assertion modes, multi-step builder).
  3. Browser/dev-host testing documentation covers `data-element-id`, `__BOARDSMITH_DEVTOOLS`, and the action-resolved signal.
  4. Authoring docs and `common-pitfalls.md` are updated to reflect the new pit-of-success guards and any removed footguns.
**Plans**: TBD

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
