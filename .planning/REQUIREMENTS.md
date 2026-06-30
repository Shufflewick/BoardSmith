# Requirements: BoardSmith v4.3 — Agent-Ready Engine

**Defined:** 2026-06-30
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules. v4.3 extends that to: an AI agent can author, drive, and test a BoardSmith game with minimal friction.

> "User" below means the **consumer of BoardSmith** — a game author, a test author, or an AI agent driving the engine programmatically or through the dev host.

## v4.3 Requirements

### Verification & API Design (DSGN)

- [x] **DSGN-01**: Each scouted friction claim is verified against the codebase with a recorded verdict (confirmed / false / partial), file:line evidence, and an "already exists vs. needs building" note — so we expose/document rather than rebuild.
- [x] **DSGN-02**: A single reviewed API-design doc specifies the new introspection / test-ergonomics / devtools surface (names, signatures, return shapes, serialization, ownership across engine/session/runtime/ui) and is approved before implementation begins.
- [x] **DSGN-03**: The design doc explicitly records which speculative scout recommendations (e.g. lint rules, hidden-info assertions, programmatic seat-switch) are IN vs. DEFERRED, with rationale.

### Action-Space Introspection (INTRO)

- [x] **INTRO-01**: A user can call one method to get every legal action for a seat — each with its selections, choices, dependencies (`dependsOn`), and ready-to-submit argument templates — in one serializable structure.
- [x] **INTRO-02**: A user can retrieve a single action's schema (selection names, types, optional flags, available choices) without executing it.
- [x] **INTRO-03**: A user can build validated, wire-correct action arguments from plain selection values without hand-constructing `{value, display}`/element-id shapes.
- [x] **INTRO-04**: A user can enumerate all concrete legal moves (action + fully-resolved args) from the current state, suitable for tree search / brute-force exploration.
- [x] **INTRO-05**: A user can obtain a typed, perspective-aware view of game state ("what does seat N see?") with hidden information correctly excluded.

### Test Ergonomics (TEST)

- [ ] **TEST-01**: A test author can read observable game state through a typed API without parsing snapshot JSON or knowing per-game accessor methods.
- [ ] **TEST-02**: A test author can play a game to completion with one call that guards against infinite/stuck loops and throws a structured, actionable diagnostic (e.g. `GameStuckError`) instead of hanging.
- [ ] **TEST-03**: When an availability/action assertion fails, the failure message automatically includes a trace explaining *why* the action is unavailable (which selection/condition failed).
- [ ] **TEST-04**: Action-list assertions support both permissive ("contains these") and exact ("only these") modes, chosen explicitly rather than exact-by-default.
- [ ] **TEST-05**: A test author can drive multi-step / dependent selections through an ergonomic builder rather than low-level `resolveChoices`/`selectionStep` calls.

### Dev-Host Devtools Bridge (DEV)

- [ ] **DEV-01**: Every rendered board element exposes a stable selector (`data-element-id`, plus notation where applicable) in both custom UI and AutoUI, so agents select by id instead of coordinates/vision.
- [ ] **DEV-02**: A `boardsmith dev` page exposes a read-only `window.__BOARDSMITH_DEVTOOLS` global to synchronously inspect current game state, available actions, and board-interaction state (valid elements, current selection).
- [ ] **DEV-03**: The dev-host page emits an observable signal (custom event and/or devtools log) when an action resolves, distinguishing success from failure, so agents confirm outcomes without polling.
- [ ] **DEV-04**: The fastest agent UI loop (change → drive → confirm) is documented and proven end-to-end in the browser for at least one custom-UI game and one AutoUI game.

### Authoring Pit-of-Success Guards (PIT)

- [ ] **PIT-01**: A `loop()` declared without `maxIterations` fails fast at game construction with an actionable error (not a dev-console-only warning).
- [ ] **PIT-02**: Game start validates element registration and fails loud with an actionable message naming any custom element class that is used but unregistered.
- [ ] **PIT-03**: Game start validates that every registered action is reachable from at least one `actionStep`, warning/erroring on actions that can never fire.
- [ ] **PIT-04**: Lint rules catch the highest-value silent footguns confirmed in DSGN-01 (element identity comparison via `includes`/`===`, element arrays used as state), with actionable messages.

### Game Migration (MIG)

- [ ] **MIG-01**: All `~/BoardSmithGames/` example games adopt the new introspection/test APIs where they replace hand-rolled patterns, and all game test suites pass.
- [ ] **MIG-02**: BoardSmith's own test suite passes with the new surface, and the MERC vendored canary is re-vendored and verified green.

### Documentation (DOC)

- [ ] **DOC-01**: An agent-control guide documents headless driving (create → inspect → enumerate → submit → assert), introspection APIs, undo/checkpoint/replay, and determinism/seeding.
- [ ] **DOC-02**: Testing documentation is updated for the new TestGame ergonomics (observable state, `playUntilComplete`, assertion modes, multi-step builder).
- [ ] **DOC-03**: Browser/dev-host testing documentation covers `data-element-id`, `__BOARDSMITH_DEVTOOLS`, and the action-resolved signal.
- [ ] **DOC-04**: Authoring docs and `common-pitfalls.md` are updated to reflect the new pit-of-success guards and any removed footguns.

## Future Requirements

Deferred unless DSGN promotes them.

### Introspection / Control

- **INTRO-F1**: Public checkpoint/rewind API on the session for what-if/tree-search (pending DSGN verdict on whether internal `state-history` machinery merely needs exposing).
- **INTRO-F2**: A reusable `AgentRunner` base class for the standard decide→act loop.
- **TEST-F1**: First-class hidden-information leak assertion (`assertNoLeakFrom`) replacing per-game regex checks.
- **DEV-F1**: Programmatic seat-switch / `getCurrentSeat()` and `?dev-seat=N` query param in the dev host.
- **DEV-F2**: Deterministic-AI seed + `forceAIMove()` for replayable multiplayer browser tests.
- **PIT-F1**: Auto-generated `boardRef`, and `dependsOn` inference from callback arg access.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backward compatibility / deprecation shims for changed APIs | Library in active development — clean break, no fallbacks (project hard rule) |
| Production-mode devtools global | `__BOARDSMITH_DEVTOOLS` is dev-host only; exposing engine internals in production is a security/coupling leak |
| New AI/MCTS capability | Migration reuses existing bots; this milestone is about driveability, not bot strength |
| Rebuilding anything DSGN-01 finds already exists | Verify first — expose/document existing APIs instead of duplicating them |
| GameBuilder fluent authoring façade | Larger authoring-DX redesign; out of scope for this introspection/test milestone |

## Traceability

Which phases cover which requirements. Every v4.3 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DSGN-01 | Phase 116 | Complete |
| DSGN-02 | Phase 116 | Complete |
| DSGN-03 | Phase 116 | Complete |
| INTRO-01 | Phase 117 | Complete |
| INTRO-02 | Phase 117 | Complete |
| INTRO-03 | Phase 117 | Complete |
| INTRO-04 | Phase 117 | Complete |
| INTRO-05 | Phase 117 | Complete |
| TEST-01 | Phase 118 | Pending |
| TEST-02 | Phase 118 | Pending |
| TEST-03 | Phase 118 | Pending |
| TEST-04 | Phase 118 | Pending |
| TEST-05 | Phase 118 | Pending |
| DEV-01 | Phase 119 | Pending |
| DEV-02 | Phase 119 | Pending |
| DEV-03 | Phase 119 | Pending |
| DEV-04 | Phase 119 | Pending |
| PIT-01 | Phase 120 | Pending |
| PIT-02 | Phase 120 | Pending |
| PIT-03 | Phase 120 | Pending |
| PIT-04 | Phase 120 | Pending |
| MIG-01 | Phase 121 | Pending |
| MIG-02 | Phase 121 | Pending |
| DOC-01 | Phase 122 | Pending |
| DOC-02 | Phase 122 | Pending |
| DOC-03 | Phase 122 | Pending |
| DOC-04 | Phase 122 | Pending |
