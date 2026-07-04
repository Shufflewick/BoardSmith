# Roadmap — BoardSmith

## Milestones

- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- ✅ **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (shipped 2026-06-30) — full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md)
- ✅ **v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools** — Phases 116–122 (shipped 2026-07-01) — full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md)
- ✅ **v4.4 Agent-Ergonomics Gaps (Audit Fixes)** — Phases 123–130 (shipped 2026-07-02) — full detail: [`milestones/v4.4-ROADMAP.md`](milestones/v4.4-ROADMAP.md)
- 🚧 **v4.5 Pit of Success Hardening (Audit #3 Fixes)** — Phases 131–139 (in progress)

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

## 🚧 v4.5 Pit of Success Hardening (Audit #3 Fixes) — In Progress

**Milestone Goal:** Resolve all 38 confirmed Pit of Success violations from `boardsmith-audit-report-3.html` (findings F1–F38) — each finding re-verified before fixing, fixed at the source (not spot-patched), documented, and rolled out to all example games and MERC. No Backward Compatibility rule applies; breaking API changes are fine when they're the clean fix.

### Overview

Findings cluster into eight fix surfaces plus migration and docs. The critical hidden-information leak (F1/F7, zone visibility lost on every snapshot restore) and its sibling restore-fidelity findings (state.players broadcast, registerDebug leak, onEnter/onExit amnesia, teachingDisabled reset) are fixed together at the serialization layer first, since they share one root cause: constructor-applied config that `loadSerializedState` silently discards. Engine correctness findings (putInto cycles, eachPlayer wrap-around, simultaneous-action errors, multiSelect validation, forEach mutation, switchOn/build() no-ops) are independent of each other and split into an element/builder-safety phase and a flow/action-validation phase. UI, session, CLI, and client-SDK findings each get their own phase since they touch disjoint subsystems. Cross-repo migration (all 8 games + MERC) runs last, after every API-changing phase is stable, followed by a documentation audit that both fixes the three pure-docs findings and grep-verifies every doc touched by this milestone's fixes (DOCX-04).

**Process discipline (PROC-01, PROC-02):** every finding gets a recorded verification verdict — LEGITIMATE with repro/trace evidence, or REJECTED with reasoning — as the first task of the phase that fixes it, not in one giant upfront verification phase. Every legitimate finding's fix ships a regression test that fails on the pre-fix code. This discipline threads through every phase below; PROC-01/PROC-02 are tracked here in Phase 131 for traceability but apply to all nine phases.

## Phases

- [x] **Phase 131: Serialization & Restore Fidelity** - Hidden zone visibility, player-state filtering, debug-data gating, and handler/lockout state all survive every snapshot restore path (completed 2026-07-03)
- [x] **Phase 132: Engine Element & Builder Safety** - putInto, resolveArgs, forEach, and action .build() fail loudly instead of silently corrupting or no-oping (completed 2026-07-03)
- [x] **Phase 133: Engine Flow & Action Validation** - eachPlayer wrap-around, simultaneous-action error surfacing, server-side multiSelect validation, and switchOn fail loudly (completed 2026-07-03)
- [x] **Phase 134: UI & Session Interaction Guardrails** - Custom-UI action failures, multiSelect fill() misuse, responsive board collapse, dragProps/setBeforeAutoExecute, and the runner-bypass footgun are all fixed or surfaced loudly (completed 2026-07-03)
- [x] **Phase 135: CLI & Dev Experience** - boardsmith.json/gameDefinition source-of-truth, config validation, bundle-size limits, host binding, init templates, and --players/--ai flags are all correct or fail loudly (completed 2026-07-03)
- [x] **Phase 136: Client SDK & Protocol** - GameConnection is awaitable, reconnect is predictable, MeepleClient has one error contract, and protocol types are canonical (completed 2026-07-03)
- [x] **Phase 137: Testing Utilities** - TestGame.doAction fails loud by default and its default seed is deterministic (completed 2026-07-03)
- [x] **Phase 138: Cross-Repo Migration** - All 8 example games + MERC comply with the changed API surface, every suite green (completed 2026-07-04)
- [x] **Phase 139: Documentation Audit & Corrections** - Pure-docs findings fixed and every API changed by this milestone has grep-verified doc updates (completed 2026-07-04)

## Phase Details

### Phase 131: Serialization & Restore Fidelity

**Goal**: Hidden information, per-player state, debug data, and host lockouts all remain correct and secure across every snapshot restore path (undo, rewind, `GameSession.restore`, `GameRunner.fromSnapshot`, stateless ops) — not just in a live, never-restored game.
**Depends on**: Nothing (first phase of this milestone)
**Scope**: BoardSmith `src/engine/element/` (Space/GameElement serialization, onEnter/onExit handlers) + `src/session/` (`utils.ts` buildPlayerState, `game-session.ts` restore/broadcast, registerDebug gating, teachingDisabled persistence).
**Requirements**: PROC-01, PROC-02, SEC-01, SEC-02, SEC-03, SEC-04, RST-01, RST-02
**Success Criteria** (what must be TRUE):

  1. Every finding fixed in this phase has a recorded verification verdict (repro or file:line trace) before its fix was written, and each fix ships a regression test that fails on the pre-fix code.
  2. A hidden zone's contents (`contentsHidden`/`contentsVisibleToOwner`/`contentsCountOnly`, including visibility changed at runtime) remain hidden to the correct viewers after undo, rewind, `GameSession.restore`, and `GameRunner.fromSnapshot` — `toJSONForPlayer(opponent)` is byte-identical before and after restore.
  3. `static visibleAttributes` either filters non-listed attributes from non-owners in `toJSONForPlayer`, or has been deleted entirely with docs corrected to match — no documented no-op security control remains.
  4. `state.players` is filtered per-viewer the same way the board `view` is — a custom Player attribute or Player-child element hidden from an opponent no longer appears in that opponent's `state.players`.
  5. `registerDebug()` payloads are not broadcast to players/spectators by default (dev-only or explicit opt-in), and `onEnter`/`onExit` handlers plus `teachingDisabled` survive `GameSession.restore()`.

**Plans**: 5 plans

- [x] 131-01-PLAN.md — PROC-01 verification gate: verdict per finding (F1/F2/F7/F8/F10/F15/F16) before any fix
- [x] 131-02-PLAN.md — SEC-01: serialize `_zoneVisibility` so zone visibility survives every restore path
- [x] 131-03-PLAN.md — RST-02 + SEC-04: persist teachingDisabled/displayName; gate registerDebug data off by default
- [x] 131-04-PLAN.md — SEC-02 + SEC-03: implement `visibleAttributes` filtering; route `state.players` through per-viewer filter
- [x] 131-05-PLAN.md — RST-01: re-bind onEnter/onExit across restore; correct registerDebug docs (DOCX-04)

### Phase 132: Engine Element & Builder Safety

**Goal**: Element-tree mutation and action-builder APIs fail loudly on misuse instead of silently corrupting state or shipping a no-op.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/engine/element/piece.ts` (putInto), `src/engine/action/action.ts` (resolveArgs), `src/engine/flow/engine.ts` (forEach), `src/engine/action/action-builder.ts` (build()).
**Requirements**: ENG-01, ENG-05, ENG-06, ENG-08
**Success Criteria** (what must be TRUE):

  1. `putInto()` onto the element's own descendant (or itself) throws an actionable error instead of silently detaching the subtree from the game tree.
  2. `resolveArgs` no longer coerces an arbitrary numeric non-selection arg into a GameElement — plain numeric followUp args survive as numbers.
  3. `forEach` over a collection that's mutated by its own body processes every original item (snapshot semantics), or the live-mutation case is guarded with a loud warning.
  4. An action chain ending in `.build()` without `.execute()` is rejected at build/registration time (or requires an explicit opt-in) instead of silently registering a no-op action.

**Plans**: 5 plans

- [x] 132-01-PLAN.md — PROC-01 verification gate: verdicts for F3/F12/F13/F28 before any fix
- [x] 132-02-PLAN.md — ENG-01: putInto self/descendant throw in moveToInternal
- [x] 132-03-PLAN.md — ENG-05: resolveArgs second pass stops coercing bare numbers
- [x] 132-04-PLAN.md — ENG-06: executeForEach snapshot-on-entry
- [x] 132-05-PLAN.md — ENG-08: registerAction throws on handler-less definitions

### Phase 133: Engine Flow & Action Validation

**Goal**: Multi-player flow control and multi-step action validation behave correctly and surface failures instead of silently skipping players or accepting invalid input.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/engine/flow/engine.ts` (eachPlayer, simultaneousActionStep, switchOn), `src/engine/action/action.ts` (validateSelection), `docs/common-patterns.md` + TurnOrder presets.
**Requirements**: ENG-02, ENG-03, ENG-04, ENG-07
**Success Criteria** (what must be TRUE):

  1. `eachPlayer` with `startingPlayer` wraps around so every player gets a turn that round; `docs/common-patterns.md`'s dealer pattern and the `TurnOrder` presets are corrected to match.
  2. A failed action inside `simultaneousActionStep` surfaces `actionError`, returns failure to the client, and is not recorded in `actionHistory`.
  3. `chooseFrom` multiSelect min/max is enforced server-side in `validateSelection` (count + array-type checks), matching the elements branch.
  4. `switchOn` with no matching case and no default fails loudly (throw or dev-warn) instead of silently no-oping.

**Plans**: 5 plans

- [x] 133-01-PLAN.md — PROC-01 verification gate: verdicts for F4/F5/F6/F27 before any fix
- [x] 133-02-PLAN.md — ENG-02: eachPlayer startingPlayer wrap-around + TurnOrder/dealer doc fixes
- [x] 133-03-PLAN.md — ENG-03: resumeSimultaneousAction surfaces actionError (engine + runner)
- [x] 133-04-PLAN.md — ENG-04: choice-branch multiSelect count + array-type enforcement
- [x] 133-05-PLAN.md — ENG-07: switchOn unmatched-case + no-default throws loudly

### Phase 134: UI & Session Interaction Guardrails

**Goal**: Developers building custom UIs or scripting sessions get loud, actionable feedback the moment they take a wrong-but-plausible path, instead of a silent no-op.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/ui/composables/useActionController.ts` (lastError, fill, setBeforeAutoExecute), `src/ui/composables/useDragDrop.ts` (dragProps), `src/ui/components/GameShell.vue` (responsive board sizing), `src/session/game-session.ts` (`runner` accessor).
**Requirements**: SESS-01, UIX-01, UIX-02, UIX-03, UIX-04, UIX-05
**Success Criteria** (what must be TRUE):

  1. A custom-UI action failure is surfaced through a consumed `lastError` channel (or equivalent loud signal) — GameShell shows the same failure feedback for custom UIs that the ActionPanel already gets for free.
  2. `fill()` rejects a scalar value for a multiSelect pick with an actionable error instead of silently submitting a malformed selection.
  3. A responsive custom board (percentage width / `container-type`) no longer silently collapses to zero inside the zoom container's `width:max-content`.
  4. `dragProps()` honors its documented `when` option, or the option is removed from the API and docs.
  5. `setBeforeAutoExecute()` either supports multiple hooks or fails loudly when silently replacing a previously registered one.
  6. `session.runner.performAction()` is no longer reachable as an easy wrong path beside `session.performAction()` — persistence/broadcast/checkpoints can't be silently skipped by calling the runner directly.

**Plans**: 5 plans

- [x] 134-01-PLAN.md — PROC-01 verification gate: verdicts for F17/F18/F19/F29/F30/F31 before any fix
- [x] 134-02-PLAN.md — UIX-01/UIX-02/UIX-05: useActionController start() result+devWarn, fill() multiSelect guard, hook accumulation
- [x] 134-03-PLAN.md — UIX-01/UIX-03/UIX-04: GameShell lastError->toast, 0x0 board dev-check, dragProps when-gating
- [x] 134-04-PLAN.md — SESS-01: session.runner read-only facade (performAction unreachable)
- [x] 134-05-PLAN.md — DOCX-04 doc updates + live browser verification of toast + drag gating

**UI hint**: yes

### Phase 135: CLI & Dev Experience

**Goal**: `boardsmith` CLI commands catch misconfiguration and invalid input instead of silently diverging, clamping, or ignoring flags.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/cli/commands/dev.ts`, `src/cli/commands/validate.ts`, `src/cli/commands/init.ts`, `src/cli/project-scaffold.ts`.
**Requirements**: CLIX-01, CLIX-02, CLIX-03, CLIX-04, CLIX-05, CLIX-06
**Success Criteria** (what must be TRUE):

  1. Player-count has one source of truth — `boardsmith.json` `playerCount` vs. `gameDefinition` disagreement is impossible (single source) or errors loudly; the scaffold no longer hardcodes both.
  2. `boardsmith validate` rejects unknown `boardsmith.json` keys, catching misspelled `gameOptions`/`playerOptions`/`colorPalette`.
  3. Bundle-size validation enforces the actual server limit its comment states (not a stale, looser constant).
  4. `boardsmith dev`'s host binding matches its documented default, or the help text is corrected to state the real default with rationale.
  5. `boardsmith init -t/--template` either works or is removed from the CLI surface and docs.
  6. `--players` out-of-range/NaN values error loudly instead of silently clamping, and `--ai` validates against the final (post-clamp) player count.

**Plans**: 6 plans (3 waves)

- [x] 135-01-PLAN.md — PROC-01 verify-first gate: per-finding verdicts (F9/F21/F22/F32/F33/F34) in 135-FINDINGS-VERIFICATION.md before any fix
- [x] 135-02-PLAN.md — CLI option surface: remove -t/--template (CLIX-05); correct --host help + register --lan (CLIX-04)
- [x] 135-03-PLAN.md — scaffold: drop playerCount + dead $schema from boardsmith.json (CLIX-01/CLIX-02)
- [x] 135-04-PLAN.md — build.ts: derive manifest playerCount from gameDefinition (CLIX-01)
- [x] 135-05-PLAN.md — validate.ts: unknown-key rejection + did-you-mean + playerCount migration (CLIX-02/CLIX-01); 50MB bundle constant (CLIX-03)
- [x] 135-06-PLAN.md — dev.ts: default 127.0.0.1 + non-localhost banner (CLIX-04); fail-fast numeric flags + --ai post-move (CLIX-06); single gameDefinition read (CLIX-01); unknown-key startup warn (CLIX-02)

### Phase 136: Client SDK & Protocol

**Goal**: The public client SDK gives callers an awaitable connection lifecycle, one consistent error contract, and types that match the canonical protocol — no silent drops, no forked type drift.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/client/game-connection.ts`, `src/client/client.ts`, `src/client/types.ts`, `src/types/protocol.ts`.
**Requirements**: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05, SDK-06
**Success Criteria** (what must be TRUE):

  1. Callers can await `GameConnection` becoming open (promise/event), and an action sent before open fails loudly instead of silently resolving `{success:false}`.
  2. `disconnect()` followed by `connect()` restores auto-reconnect behavior predictably — the `reconnect()`-only asymmetry is removed or made impossible to miss.
  3. `MeepleClient` methods have one consistent error contract (all throw, or all return results) — no silent raw-JSON failure half.
  4. The client SDK imports canonical protocol types from `src/types/` instead of redefining them, and the existing `CreateGameRequest`/WS-message-union drift is resolved.
  5. The `WebSocketMessage` union includes every message type actually sent (including `UpdateSlotPlayerOptionsMessage`).
  6. The playerId configuration error message points at a field that actually exists on the config type.

**Plans**: 5 plans

- [x] 136-01-PLAN.md — PROC-01 verification gate: verdicts for F23/F24/F25/F26/F35/F38 before any fix
- [x] 136-02-PLAN.md — canonical protocol/type foundation: WebSocketMessage union member (SDK-05), delete-and-re-export client types + discriminated WS unions (SDK-04), config-field scaffolding (connectImmediately/connectionTimeout/playerId)
- [x] 136-03-PLAN.md — GameConnection lifecycle: opened promise + await-then-send action() (SDK-01), #userDisconnected flag + connectImmediately honoring (SDK-02)
- [x] 136-04-PLAN.md — MeepleClient: one throwing error contract via shared helper (SDK-03), awaitable connect() (SDK-01), playerId config + actionable error (SDK-06)
- [x] 136-05-PLAN.md — consumer migration: useGame hack removal (SDK-01/02), GameShell.vue try/catch-only (SDK-03), docs/api/client.md corrections (DOCX-04)

### Phase 137: Testing Utilities

**Goal**: `TestGame`'s default behavior matches the library's own deterministic, fail-loud doctrine.
**Depends on**: Phase 131
**Scope**: BoardSmith `src/testing/test-game.ts`.
**Requirements**: TST-01, TST-02
**Success Criteria** (what must be TRUE):

  1. `TestGame.doAction` failures are loud by default (throws, or an equivalent that can't be silently ignored), and the flagship class-level doc example no longer models ignoring the result.
  2. `TestGame`'s default seed is a fixed literal, not `Date.now()` — no-seed test runs are deterministic and reproducible in CI.

**Plans**: 3 plans

  - [x] 137-01-PLAN.md — PROC-01 verification gate (F36, F37) → 137-FINDINGS-VERIFICATION.md
  - [x] 137-02-PLAN.md — TST-01: doAction throws + tryAction escape hatch, harness call-site migrations, example fixes
  - [x] 137-03-PLAN.md — TST-02: fixed default seed, testGame.seed accessor, seed in failure messages

### Phase 138: Cross-Repo Migration

**Goal**: Every example game and MERC comply with the full v4.5 API surface, with no lingering references to removed/changed APIs.
**Depends on**: Phases 131, 132, 133, 134, 135, 136, 137 (the full API surface must be built and stable before cross-repo migration)
**Scope**: Cross-repo — all `~/BoardSmithGames/` games (symlinked, live HMR) and the MERC vendored copy (`~/Dropbox/MERC/BoardSmith/MERC`, must be re-vendored). Minimal BoardSmith `src/` changes only to close gaps migration surfaces.
**Requirements**: GAMES-01, GAMES-02
**Success Criteria** (what must be TRUE):

  1. All 8 example games in `~/BoardSmithGames/` build and pass their test suites against the fixed API surface.
  2. MERC is re-vendored onto the new BoardSmith version and its test suite is green.
  3. Any gap surfaced during migration is fixed in BoardSmith `src/`, not worked around in game code.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 138-01-PLAN.md — 8-game migration (boardsmith.json sweep + checkers/go-fish doAction fixes; all suites green)
- [x] 138-03-PLAN.md — MERC WIP-commit + re-vendor + iterate to green (gaps fixed in BoardSmith src)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 138-02-PLAN.md — Playwright browser smokes (hex drag, go-fish toast+hidden-info, cribbage multiSelect)

### Phase 139: Documentation Audit & Corrections

**Goal**: Documentation teaches the real, shipped API everywhere touched by this milestone — including the three findings that are purely docs-teaching-nonexistent-APIs.
**Depends on**: Phase 138 (docs describe the shipped, game-migrated surface, with real worked examples)
**Scope**: BoardSmith `docs/` only — `core-concepts.md`, `registerActions()` JSDoc, `getting-started.md`, plus a grep-verification pass across every doc touched by phases 131–138.
**Requirements**: DOCX-01, DOCX-02, DOCX-03, DOCX-04
**Success Criteria** (what must be TRUE):

  1. `docs/core-concepts.md` no longer teaches the removed event-sourcing command model or the nonexistent `element.setAttribute()` API.
  2. `registerActions()` JSDoc models the real `Action.create(...).chooseElement(...).execute(...)` API.
  3. `docs/getting-started.md` documents the CLI that actually exists (flags, ports, tab behavior, publish target).
  4. Every API changed by phases 131–138 has its docs updated and grep-verified against `src/`, mirroring the v4.4 Phase 130 doc-verifier pass.

**Plans**: 2 plans
- [x] 139-01-PLAN.md — Fix the three named findings (DOCX-01 core-concepts.md event-sourcing/setAttribute; DOCX-02 registerActions JSDoc + runtime error; DOCX-03 getting-started.md residual CLI audit)
- [x] 139-02-PLAN.md — DOCX-04 grep-verified sweep of all docs/ against every API changed in phases 131-138 + full-suite gate

## Progress

**Execution Order:**
Phases execute in numeric order: 131 → 132 → 133 → 134 → 135 → 136 → 137 → 138 → 139

| Phase | Plans Complete | Status | Completed |
|-------|-----------------|--------|-----------|
| 131. Serialization & Restore Fidelity | 5/5 | Complete    | 2026-07-03 |
| 132. Engine Element & Builder Safety | 5/5 | Complete    | 2026-07-03 |
| 133. Engine Flow & Action Validation | 5/5 | Complete    | 2026-07-03 |
| 134. UI & Session Interaction Guardrails | 5/5 | Complete    | 2026-07-03 |
| 135. CLI & Dev Experience | 6/6 | Complete    | 2026-07-03 |
| 136. Client SDK & Protocol | 5/5 | Complete    | 2026-07-03 |
| 137. Testing Utilities | 3/3 | Complete    | 2026-07-04 |
| 138. Cross-Repo Migration | 3/3 | Complete    | 2026-07-04 |
| 139. Documentation Audit & Corrections | 2/2 | Complete   | 2026-07-04 |
</content>
</invoke>
