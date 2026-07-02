# Roadmap — BoardSmith

## Milestones

- 🚧 **v4.4 Agent-Ergonomics Gaps (Audit Fixes)** — Phases 123–130 (in progress, roadmap defined 2026-07-01)
- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- ✅ **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (shipped 2026-06-30) — full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md)
- ✅ **v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools** — Phases 116–122 (shipped 2026-07-01) — full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md)

## 🚧 v4.4 Agent-Ergonomics Gaps (Audit Fixes) — In Progress

**Milestone Goal:** Close every verified gap from the 2026-07-01 agent-ergonomics audit — hidden-info verification, headless simulation, structured errors, a fully scriptable dev host, an animation/drag-drop test story, and flow/debug introspection with enforced determinism — then update docs and migrate all example games + MERC.

### Phases

- [ ] **Phase 123: Determinism & Flow Introspection** - Seeded runs are fully deterministic and flow/action state is human- and machine-readable
- [ ] **Phase 124: Hidden-Info Test Utilities** - Developers can verify hidden information stays hidden without hand-parsing state or DOM
- [ ] **Phase 125: Headless Simulation** - Developers can play seeded games headlessly via API and CLI
- [ ] **Phase 126: Structured Error Surfacing** - Failures at every layer surface as structured, actionable signals, not console-only fallbacks
- [ ] **Phase 127: Scriptable Dev Host** - Every dev-host capability is drivable by a scripted client, not just a browser user
- [ ] **Phase 128: Animation & Drag-Drop Test Story** - Animation/drag-drop behavior is testable headlessly and fails loud on misconfiguration
- [ ] **Phase 129: Migration (Games + MERC)** - All example games + MERC run green on the new API surface
- [ ] **Phase 130: Documentation** - Docs describe the shipped, migrated v4.4 surface

### Phase Details

#### Phase 123: Determinism & Flow Introspection

**Goal**: Developers get accurate, human-readable insight into flow state, disabled choices, and mid-action state, and seeded runs are fully deterministic end-to-end — the foundation later test-utility and dev-host phases build on.
**Depends on**: Nothing (first phase of this milestone)
**Scope**: BoardSmith `src/engine/` (flow state, RNG paths) + `src/session/` (PendingActionState, pick-choice filtering) + `src/testing/` (`playUntilComplete` determinism).
**Requirements**: FLOW-01, FLOW-02, FLOW-03, FLOW-04
**Success Criteria** (what must be TRUE):

  1. A developer can call a `toDebugString()`-style method on FlowState and get a human-readable phase/step/waiting-on-seat description (e.g. "phase *pegging* → step *player-turn*, waiting on seat 2").
  2. A developer can query pick choices and see disabled choices alongside their disable reasons, rather than having them filtered out by `getPickChoices`.
  3. A developer can inspect mid-multi-step action state (`PendingActionState`) directly from TestGame.
  4. Two runs started with the same seed produce identical results — no `Math.random` fallback remains in `space.ts`/`element-collection.ts`, and `playUntilComplete` is deterministic by default (no unseeded fallback).

**Plans**: 4 plans (2 waves)

- [x] 123-01-PLAN.md — Flow-position debug primitive: describeFlowPosition + FlowDebugInfo + Game.getFlowDebugInfo() (FLOW-01) [wave 1]
- [x] 123-02-PLAN.md — Determinism enforcement: fix RNG fallbacks in space.ts/element-collection.ts, deterministic playUntilComplete, seed retrievability (FLOW-04) [wave 1]
- [x] 123-03-PLAN.md — TestGame introspection surface: getPendingAction snapshot, disabled-choices helper, flow-position in error messages (FLOW-01/02/03) [wave 2]
- [x] 123-04-PLAN.md — Devtools bridge parity: broadcast serialized flow-debug + own-seat pending action, __BOARDSMITH_DEVTOOLS getters (FLOW-01/03) [wave 2]

#### Phase 124: Hidden-Info Test Utilities

**Goal**: Developers can verify hidden information stays hidden — in test assertions and in the rendered DOM — without hand-parsing ElementJSON or manually inspecting markup.
**Depends on**: Nothing (independent of Phase 123; both are foundational test-ergonomics work)
**Scope**: BoardSmith `src/testing/` (TestGame visibility methods, view-diff utility, DOM-leak renderer utility).
**Requirements**: VIS-01, VIS-02, VIS-03
**Success Criteria** (what must be TRUE):

  1. A developer can call `isElementVisible(element, seat)` / `getVisibleElements(seat)` on TestGame and get correct per-seat results without parsing raw ElementJSON.
  2. A developer can diff what two seats see via a `diffPlayerViews`-style utility and get exactly which elements/fields differ.
  3. A developer can run a DOM-leak test utility that renders the game UI as seat N and fails when hidden-element identity attributes (rank/suit/face) appear in the rendered markup.

**Plans**: 3 plans

- [x] 124-01-PLAN.md — VIS-01: isElementVisible/getVisibleElements on TestGame + assertHidden/assertVisible, wrapping the engine isVisibleTo primitive [wave 1]
- [x] 124-02-PLAN.md — VIS-02: diffPlayerViews structured+describe() view diff, visibility-scoped to sidestep anonymized-id noise [wave 2]
- [x] 124-03-PLAN.md — VIS-03: headless DOM-leak matcher (mount AutoUI as seat N), auto-derived forbidden markers + proven positive control [wave 3]

#### Phase 125: Headless Simulation

**Goal**: Developers can play and audit games headlessly — via a public API and a CLI command — using the deterministic seeding established in Phase 123.
**Depends on**: Phase 123 (seeded determinism is required for reproducible headless runs)
**Scope**: BoardSmith `src/session/` (promote `createHeadlessSession` to the public `boardsmith/session` export) + `src/cli/` (`boardsmith simulate` command).
**Requirements**: SIM-01, SIM-02
**Success Criteria** (what must be TRUE):

  1. A developer can `import { createHeadlessSession } from 'boardsmith/session'` — no reaching into the internal `src/session/testing/headless-harness.ts` path.
  2. A developer can run `boardsmith simulate` with games-count and seed flags and get pass/stuck/error reporting per simulated game.
  3. Running `boardsmith simulate` twice with the same seed produces identical pass/stuck/error results.

**Plans**: 2 plans

  - [x] 125-01-PLAN.md — SIM-01: move createHeadlessSession to public boardsmith/session (clean break) + JSDoc + tests
  - [x] 125-02-PLAN.md — SIM-02: boardsmith simulate CLI (seeded batch, table/--json, non-zero exit, replay) + shared rules loader

#### Phase 126: Structured Error Surfacing

**Goal**: Failures at the pick-handler, action-runner, storage, and dev-host layers surface as structured, inspectable signals instead of console-only silent fallbacks.
**Depends on**: Nothing (independent surface work; shares the dev-host/session boundary with Phase 127)
**Scope**: BoardSmith `src/session/` (pick-handler.ts, runner.ts, storage save paths) + `src/cli/dev-host/` (WS log-streaming op).
**Requirements**: ERR-01, ERR-02, ERR-03, ERR-04
**Success Criteria** (what must be TRUE):

  1. When `boardRefs()` / `display()` / `getChoices()` fail, the pick/op result carries a structured warning the caller can inspect — not just a `console.error`.
  2. Action execution failures from the runner carry a structured `errorCode` value an agent can branch on, instead of a flattened message string.
  3. Storage save failures are observable by the caller — awaitable or surfaced as an event — instead of a fire-and-forget `.catch(console.error)`.
  4. A connected dev-host client can request server-side errors/logs via a WS op (e.g. `debug:logs`) instead of reading the Node terminal.

**Plans**: 4 plans

  - [x] 126-01-PLAN.md — ERR-02: runner errorCode (ENGINE_ERROR/ACTION_EXECUTION_ERROR) + OpResult.errorCode threaded through op handlers [wave 1]
  - [x] 126-02-PLAN.md — ERR-03: shared onPersistenceError hook + lastPersistenceError across both hosts; fix AI/persistence misclassification [wave 1]
  - [x] 126-03-PLAN.md — ERR-01: structured WarningEntry for boardRefs/display/boardRef soft-fails, threaded onto OpResult + bridge shapeResult [wave 2]
  - [x] 126-04-PLAN.md — ERR-04: dev-host log-capture ring buffer + debug:logs host-lifecycle WS op + DebugPanel Logs tab [wave 3]

#### Phase 127: Scriptable Dev Host

**Goal**: Every remaining dev-host capability — state/lobby queries, the client SDK, and the last UI-only controls — is drivable by a scripted (non-browser) client.
**Depends on**: Phase 126 (shares the dev-host/session WS boundary; error surfacing lands first so new ops report failures structurally)
**Scope**: BoardSmith `src/cli/dev-host/` (WS op handlers) + `src/client/` (`GameConnection` Node-capable WebSocket abstraction).
**Requirements**: DRIVE-01, DRIVE-02, DRIVE-03
**Success Criteria** (what must be TRUE):

  1. An agent can send `getState` / `getLobby` WS ops and receive current game state and lobby info from the dev host.
  2. The `GameConnection` client SDK connects and drives a game session from a Node script — no browser-only `new WebSocket()` global required.
  3. The debug-panel toggle and UI switcher are triggerable via WS ops, closing the remaining UI-only dev-host controls.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 127-01-PLAN.md — dev-host WS ops: getState/getLobby queries + debugToggle/uiSwitch relay (host + DevHost.vue page side)
- [x] 127-02-PLAN.md — GameConnection Node-capability (injectable globalThis.WebSocket + fail-loud guard)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 127-03-PLAN.md — createDevHostClient + browserless Node integration test (phase acceptance proof)

#### Phase 128: Animation & Drag-Drop Test Story

**Goal**: Animation and drag-drop behavior is testable headlessly via an instant/traced test mode and direct composable tests, and fails loud instead of silently no-op'ing on misconfiguration.
**Depends on**: Nothing (independent of FLOW/VIS/SIM/ERR/DRIVE work)
**Scope**: BoardSmith `src/ui/composables/` (`useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`, `useDragDrop`).
**Requirements**: ANIM-01, ANIM-02, ANIM-03
**Success Criteria** (what must be TRUE):

  1. Animation composables support a test mode that resolves instantly and records an assertable trace (`{element, from, to, kind}`), so "card X flew from A to B" is a headless assertion.
  2. `useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`, and `useDragDrop` each have passing direct unit tests (currently zero).
  3. Triggering an animation on a target element missing its anchor attribute throws an actionable error instead of silently no-op'ing, and custom boards missing `anchorAttrs` get a dev-time warning.

**Plans**: 6 plans
- [x] 128-01-PLAN.md — Vue-free animation test-mode + trace recorder module (ANIM-01 foundation), re-exported from ui + testing
- [x] 128-02-PLAN.md — anchorAttrs custom-board dev-warning (ANIM-03) + useDragDrop direct unit tests (ANIM-02)
- [x] 128-03-PLAN.md — useFLIP test-mode trace branch + fail-loud anchor throw + unit tests (ANIM-01/02/03)
- [ ] 128-04-PLAN.md — useElementAnimation test-mode trace branch + throw + unit tests (ANIM-01/02/03)
- [ ] 128-05-PLAN.md — useFlyingElements test-mode trace (autoWatch from/to) + first-resolution throw + unit tests (ANIM-01/02/03)
- [ ] 128-06-PLAN.md — useActionAnimations trace (own selectors) + warn→dev-throw upgrade + unit tests (ANIM-01/02/03)
**UI hint**: yes

#### Phase 129: Migration (Games + MERC)

**Goal**: Every example game and MERC build and test green against the full v4.4 API surface, with no lingering references to removed/changed APIs.
**Depends on**: Phases 123, 124, 125, 126, 127, 128 (the full API surface must be built and stable before cross-repo migration)
**Scope**: Cross-repo — all `~/BoardSmithGames/` games (symlinked, live HMR) and the MERC vendored copy (`~/Dropbox/MERC/BoardSmith/MERC`, must be re-vendored). Minimal BoardSmith `src/` changes only to close gaps migration surfaces.
**Requirements**: MIG-03, MIG-04
**Success Criteria** (what must be TRUE):

  1. All `~/BoardSmithGames/` example games run and pass their test suites against the updated BoardSmith APIs.
  2. MERC is re-vendored with the updated BoardSmith and its test suite passes.
  3. No game or MERC code references a removed/changed API path (clean break, no deprecation aliases).

**Plans**: TBD

#### Phase 130: Documentation

**Goal**: Documentation accurately describes the shipped, migrated v4.4 surface so an agent or author can learn the new testing, dev-host, and determinism guarantees from the docs alone.
**Depends on**: Phase 129 (docs describe the shipped + game-migrated surface, with real worked examples)
**Scope**: BoardSmith `docs/` only — testing guide, dev-host protocol, determinism guarantees, BREAKING.md.
**Requirements**: DOC-05, DOC-06
**Success Criteria** (what must be TRUE):

  1. The testing guide documents visibility assertions, animation traces, and headless simulation with working examples.
  2. Dev-host protocol documentation covers all new/changed WS ops (`getState`, `getLobby`, `debug:logs`, UI-switcher/debug-toggle ops).
  3. Documentation states the determinism guarantee (seeded runs are reproducible, no `Math.random` fallbacks remain).
  4. `BREAKING.md` lists every removed/changed API introduced in v4.4 with migration guidance.

**Plans**: TBD

### Progress

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 123. Determinism & Flow Introspection | 4/4 | Complete    | 2026-07-01 |
| 124. Hidden-Info Test Utilities | 3/3 | Complete    | 2026-07-02 |
| 125. Headless Simulation | 2/2 | Complete    | 2026-07-02 |
| 126. Structured Error Surfacing | 4/4 | Complete    | 2026-07-02 |
| 127. Scriptable Dev Host | 3/3 | Complete    | 2026-07-02 |
| 128. Animation & Drag-Drop Test Story | 3/6 | In Progress|  |
| 129. Migration (Games + MERC) | 0/TBD | Not started | - |
| 130. Documentation | 0/TBD | Not started | - |

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
</content>
