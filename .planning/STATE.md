---
gsd_state_version: 1.0
milestone: v4.4
milestone_name: Agent-Ergonomics Gaps (Audit Fixes)
status: executing
stopped_at: Completed 129-01-PLAN.md
last_updated: "2026-07-02T18:49:10.260Z"
last_activity: 2026-07-02 -- Completed 129-01-PLAN.md
progress:
  total_phases: 8
  completed_phases: 6
  total_plans: 25
  completed_plans: 23
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-01)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 129 — migration (games + merc)

## Current Position

Phase: 129
Plan: 1 of 3
Status: Ready to execute
Last activity: 2026-07-02 -- Completed 129-01-PLAN.md

## Milestones

**Completed:**

- v0.1 Large File Refactoring (Phases 1-4) -- shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) -- shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) -- shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) -- shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) -- shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) -- shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) -- shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) -- shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) -- shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) -- shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) -- shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) -- shipped 2026-01-18
- v2.0 Collapse the Monorepo (Phases 39-46) -- shipped 2026-01-19
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- shipped 2026-01-19
- v2.2 Game Design Aspects (Phases 51-53) -- shipped 2026-01-21
- v2.3 Nomenclature Standardization (Phases 54-58) -- shipped 2026-01-22
- v2.4 Animation Event System (Phases 59-63) -- shipped 2026-01-22
- v2.5 Player Colors Refactor (Phases 64-68) -- shipped 2026-01-25
- v2.6 Code Consolidation (post-mortem driven) -- shipped 2026-01-29
- v2.7 Dead Code & Code Smell Cleanup (Phases 69-74) -- shipped 2026-02-02
- v2.8 Disabled Selections (Phases 75-79) -- shipped 2026-02-06
- v2.9 Theatre View (Phases 80-84) -- shipped 2026-02-07
- v3.0 Animation Timeline (Phases 85-90) -- shipped 2026-02-08
- v3.1 Dynamic Auto-UI (Phases 91-96) -- shipped 2026-06-22
- v4.0 UI Redesign (Slate) (Phases 97-103) -- shipped 2026-06-23
- v4.1 Tutorial Primitives (Checkers) (Phases 104-111) -- shipped 2026-06-30
- v4.2 Tutorial Primitives — Go Fish & Docs (Phases 112-115) -- shipped 2026-06-30
- v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools (Phases 116-122) -- shipped 2026-07-01

**In Progress:**

- v4.4 Agent-Ergonomics Gaps (Audit Fixes) (Phases 123-130) — planning; roadmap created 2026-07-01.

## Deferred Items

Items acknowledged and deferred at v4.1 milestone close on 2026-06-30:

| Category | Item | Status | Note |
|----------|------|--------|------|
| verification | 108-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): action help demonstrated live + user-approved |
| verification | 109-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): checkers tutorial demonstrated live + user-approved |
| uat | 108-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| uat | 109-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | (third pending todo) | open | Pre-existing v4.0 carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Backlog for a future cribbage (v2 CRIB) milestone: R-05 (suppress Undo during guided tutorial steps), R-12 (strategy tutorial track), pit-of-success lint/dev-warning when a custom board omits `anchorAttrs`. Repo-wide: 3 pre-existing eslint no-shadow errors (game.ts, useAnimationEvents.ts, useFlyingElements.ts) + tsc test-file looseness — future cleanup pass.

## Accumulated Context

### Roadmap Evolution

- v4.4 roadmap defined (2026-07-01): 8 phases (123–130), 23 requirements (VIS, SIM, ERR, DRIVE, ANIM, FLOW, DOC, MIG) — corrected from an initial miscount of 20 in REQUIREMENTS.md. Continues phase numbering from v4.3 (ended at 122).
- Phase 123 (FLOW determinism + introspection) is foundational engine/session work sequenced first — kills `Math.random` fallbacks and adds flow-state/pending-action introspection that Phase 125 (SIM, seeded headless runs) depends on.
- Phase 124 (VIS hidden-info test utilities) is independent of 123 — both are foundational test-ergonomics work that can proceed in either order, but both precede the phases that consume them.
- Phase 125 (SIM headless simulation) depends on Phase 123's determinism guarantee for reproducible seeded runs.
- Phase 126 (ERR structured errors) and Phase 127 (DRIVE scriptable dev host) are sequenced adjacent — both touch the dev-host/session WS boundary; ERR lands first so new DRIVE-added ops report failures structurally from day one.
- Phase 128 (ANIM animation/drag-drop test story) is independent of FLOW/VIS/SIM/ERR/DRIVE and can run in parallel with any of them.
- Phase 129 (MIG cross-repo migration) is sequenced after all API-surface phases (123-128) are stable — spans `~/BoardSmithGames/` (symlinked, live HMR) + MERC (must re-vendor).
- Phase 130 (DOC) is last so docs describe the shipped, migrated surface — same discipline as v4.3 (DOC was phase 122, last).

- v4.3 roadmap defined (2026-06-30): 7 phases (116–122), 27 requirements (DSGN, INTRO, TEST, DEV, PIT, MIG, DOC). Three logical stages honored: (1) verify scout findings + lock API design [116]; (2) implement then migrate [117–121]; (3) docs [122].
- Phase 116 (DSGN) is a hard gate for everything: it decides what already exists vs. what must be built (scout claims like `getPlayerView()`, private checkpoint APIs, an existing action-resolved signal are UNVERIFIED) and which speculative items are IN vs. DEFERRED. No implementation begins until its design doc is approved.
- INTRO (117) is the keystone primitive — "what can this seat do right now, with what choices?" — and is sequenced BEFORE TEST (118) and DEV (119), which both build on it. Splitting them keeps each independently shippable/reviewable.
- PIT (120) authoring guards are largely independent of INTRO; depends only on 116 (PIT-04 lint targets the footguns DSGN-01 confirms).
- MIG (121) is its own phase after the surface is built and stabilized — spans cross-repo work: symlinked `~/BoardSmithGames/` games (live HMR) + the MERC vendored copy which must be re-vendored.
- DOC (122) is last so docs describe the shipped, migrated surface.
- Reuse-not-rebuild discipline carries from v4.2: where DSGN finds an API already exists, expose/document rather than duplicate.

**v4.2 roadmap notes (2026-06-30):**

- v4.2 roadmap defined (2026-06-30): 4 phases (112–115), 14 requirements. Reuse-not-rebuild: all substrate lives in v4.1 `src/`; phases are cross-repo content authoring (go-fish) + BoardSmith docs.
- Phase 112 (go-fish tutorial content + CI) mirrors Phase 109 (checkers tutorial content) from v4.1 — same pattern, different game type (card game vs grid game).
- Phase 113 (go-fish AI teaching) mirrors Phase 107 (checkers AI teaching) — surfaces existing MCTS bot; key difference is `anchorAttrs` must anchor to cards/hand, not board squares.
- Phase 114 (action help + host lockout) folds GFHELP-01 and GFLOCK-01 together as both are light verification/surface tasks that share a dependency on all teaching affordances existing (Phase 113 complete).
- Phase 115 (documentation) is last so both worked examples (checkers + go-fish) are complete and documentable.
- Heatmap is intentionally excluded from go-fish AI teaching (board-only feature); documented as such in DOC-03.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

**v4.1 roadmap decisions (2026-06-25):**

- Substrate-first sequencing: engine/session lifecycle+gating (104) → UI overlay (105) → triggers + CI-authoring (106) → teaching layers (107 AI, 108 HELP) → checkers showcase (109) → demo gate (110).
- TUT-01 annotation overlay must route through `useBoardInteraction` for custom-UI/AutoUI parity (hard-rule), verified in both UI paths.
- Action gating (TUT-02) reuses the engine's existing action validation and the v2.8 disabled-reason surface — no parallel validation path.
- AI teaching features reuse checkers' existing MCTS; no new training/weights.
- Checkers tutorial content (CHK-*) lands cross-repo in `~/BoardSmithGames/checkers`; substrate stays in this repo's `src/`.
- DEMO-01 framed as a refinement checkpoint, not a sign-off — captured friction feeds the substrate before cribbage (v2 CRIB).
- [Phase ?]: DEV-01: align AutoUI to emit data-bs-el-id (anchorAttrs single source of truth); keep data-element-id as FLIP alias
- [Phase ?]: PIT-01: loop() missing maxIterations is a construction-time throw; devWarn path removed
- [Phase ?]: INTRO-F1 promoted to IN-scope (trivial expose-not-build); flagged for user sign-off at approval gate
- [Phase ?]: ElementDiff reached through game-session.js barrel re-export; ActionMetadata added to types.js block; UndoResult not duplicated
- [Phase 120]: PIT-01: loop() missing maxIterations now throws at construction time; devWarn path removed; 6 test call sites patched
- [Phase 120]: PIT-03: unregistered actionStep-referenced action throws (naming registerActions); registered-but-unreferenced action is a devWarn, not a throw; function-valued actions are a documented static-walk blind spot
- [Phase ?]: FLOW-01: phase read from FlowState.currentPhase (not re-derived from path); step falls back to node.type when unnamed — Matches engine's own phase-entry/exit bookkeeping; avoids diverging on each-player/for-each re-entry
- [Phase ?]: ElementCollection.shuffle() requires an explicit rng argument (no Math.random default) — clean break, zero callers confirmed
- [Phase ?]: playUntilComplete defaults to a fixed literal seed instead of Math.random, keeping no-options runs deterministic
- [Phase ?]: GameRunner.seed reads back Game.getConstructorOptions().seed when no explicit seed was passed, so auto-generated seeds are replayable
- [Phase 123]: A2 resolved: reuse ActionExecutor.createPendingActionState/processSelectionStep session-free for GameRunner pending-action tracking, confirmed by tracing action.test.ts:1684+
- [Phase 123]: FlowDebugInfo (Plan 01) was never exported from flow/index.ts or engine/index.ts — fixed as a Rule 3 blocker before it could be imported in runner.ts/test-game.ts
- [Phase 123]: TestGame.getActionSpaceWithChoices(seat) composes existing getActionSpace()+getSelectionChoices() rather than a new disabled-choice evaluator; pick-handler.ts left untouched
- [Phase 123]: Gap-fix (ac1261e): boardsmith dev runs on SnapshotSessionHost, not GameSession -- extracted serializeFlowDebugInfo() as a shared helper so broadcast, debug op, and devtools never diverge in shape
- [Phase 124]: VIS-01: visibility judged on the FINAL post-playerView tree (game.toJSONForPlayer(seat)), not element.isVisibleTo alone; isVisibleTo retained only as a fast path when GameClass.playerView is undefined (provably safe -- no post-transform runs in that case)
- [Phase 124]: assertHidden/assertVisible call isElementVisible (not element.isVisibleTo directly) so assertion failures are judged on the same final-tree derivation as VIS-01; surviving-attribute-keys in assertHidden's message come from the final tree's node, not raw unfiltered element JSON
- [Phase 124]: VIS-02: diffPlayerViews classifies purely by each node's __hidden flag (never by id) to sidestep the engine's zone-hidden-vs-individually-hidden id-anonymization asymmetry
- [Phase 124]: VIS-03: assertNoHiddenInfoLeak derives forbidden markers by diffing each element's unfiltered toJSON() against its node in the final toJSONForPlayer(seat) tree (honors static playerView); renderAsSeat mounts the REAL AutoUI/AutoRenderer/CardRenderer stack via a runtime dynamic import() so a jsdom window.matchMedia polyfill can be installed before AutoRenderer's transitive module-load-time matchMedia() call; $images.back and boolean attribute values are excluded from identity candidates (both are near-universal DOM substrings, not per-element secrets)
- [Phase 125, Plan 01]: SIM-01: createHeadlessSession moved from src/session/testing/headless-harness.ts to src/session/headless-session.ts with a clean break (old path deleted, zero re-export shim); exported from the boardsmith/session barrel. Determinism tests must compare seeded-RNG-derived state values, not raw broadcast/result objects — those also carry Date.now() action-history timestamps that are legitimately wall-clock and outside the seeded-RNG contract.
- [Phase 125]: 125-02: loadGameDefinition re-exports only gameDefinition (no executeOp); simulate drives games via simulateRandomGames/createTestGame, not dev.ts's stateless executeOp path — Keeps the shared rules loader honest about what each caller needs; avoids pulling dev's WS-executor machinery into the CLI simulate path
- [Phase 126]: 126-01: errorCode set at source only (runner.ts, pick-handler.ts/pending-action-manager.ts); OpResult threads it through, never fabricated for protocol-only failures
- [Phase 126]: 126-02: #persistSafely wraps #save()/apply() as the single funnel (not each caller individually), automatically protecting PendingActionManager's save callback without touching that file
- [Phase ?]: 126-03: boardRef()'s warning code is CHOICES_ERROR per the plan's reserved taxonomy; PickStepResult.warnings? added in pending-action-manager.ts as necessary plumbing for handleSelectionStep forwarding
- [Phase 126]: 126-04: debugLogs kept as a bridge-local marker type (never joins stateless-ops.ts's Op union) so the executeOp purity contract holds by construction
- [Phase 127]: 127-01: getState/getLobby reuse the existing game_state/lobby HostOutbound shapes plus requestId (no new response type names); getState resolves seat only from server-tracked followerClientId/clientSeat (no client-supplied seat field exists on the variant); debugToggle/uiSwitch are host-level relay-only ops (fan-out to all connected clients), never routed through bridge.ts's WireOp machinery
- [Phase 127]: 127-02: GameConnection's WebSocket construction/OPEN/CONNECTING reads routed through a private #wsCtor resolved once via config.wsImplementation ?? globalThis.WebSocket, extracted into shared src/client/ws-ctor.ts (resolveWsCtor) for 127-03 dev-host-client reuse; package.json engines.node deliberately NOT bumped to >=22.4 (fail-loud guard is the enforcement, not a blanket engines constraint)
- [Phase 127]: 127-03: createDevHostClient kept as a plain closure (not a class extending/wrapping GameConnection), reusing only resolveWsCtor; the integration test's own WS wiring assigns clientId at connection (not gated behind a first 'hello' frame like dev.ts) so it can prove genuine getLobby-in-lobby-phase behavior — MultiplayerHost auto-starts unconditionally on the very first hello system-wide, making the transient lobby phase otherwise unobservable over a real socket; MultiplayerHost.handleMessage itself is still exercised identically to production. Phase 127 (Scriptable Dev Host) is now fully complete — DRIVE-01/02/03 all shipped.
- [Phase 128]: 128-01: recordTrace early-returns when disabled (pit-of-success no-op guard); AnimationTrace.from/to hold container/anchor identities only, never hidden-info payloads
- [Phase ?]: 128-02: anchorAttrs dev-warning keys by ref.name (ElementRef has no className field); useDragDrop tests use Parent/Child provide+inject pairing
- [Phase 128]: 128-03: reportMissingAnchor() shared by capture() and animate()'s first-resolution missing-anchor throw sites; test-mode trace from/to falls back to the handler's selector string when the container has no anchor attribute
- [Phase 128]: 128-04: container's own data-element-id (or undefined) used for trace from/to per discretion note — no containerName param added to public API
- [Phase 128]: 128-05: FlyConfig gained from/to/element fields so autoWatch threads container names + engine element id into the trace, distinct from FlyConfig.id (internal animation-bookkeeping key, generated as auto-fly-{id}-{timestamp} for autoWatch)
- [Phase 128]: 128-06: Test-mode trace recorded at useActionAnimations' own level (own interpolated selector strings), returns early without delegating to fly() - avoids double-recording with useFlyingElements' independent 'fly' trace branch
- [Phase 128]: 128-06: Fake-timer real path requires toFake including requestAnimationFrame/cancelAnimationFrame/performance/Date since the composable's real path chains through useFlyingElements.fly()'s RAF+performance.now() timing
- [Phase 129]: 129-01: hex data-element-id added additively alongside data-stone-id; checkers CheckersPlayer re-exported from game.ts; polyhedral-potions/demo-complex-ui boardRefs() converted to current { refs: RefWithRole[] } shape — All type-only/markup-only fixes; zero BoardSmith src/ gaps found

### Highest-Risk Items (v4.4)

1. **Determinism correctness (Phase 123)** — removing `Math.random` fallbacks in `space.ts`/`element-collection.ts` touches shuffle/randomization paths used by every game; a mistake here silently breaks fairness rather than throwing, and headless simulation (125) is only trustworthy if this is airtight.
2. **Hidden-info leak regression (Phase 124)** — VIS-01/02/03 utilities exist specifically to catch hidden-info leaks; the DOM-leak utility itself must not have blind spots (e.g. missing attributes it doesn't know to check) or it gives false confidence.
3. **Cross-repo migration breadth (Phase 129)** — same risk pattern as v4.3 Phase 121: all `~/BoardSmithGames/` games (symlinked, live HMR) plus the MERC vendored canary (must re-vendor) — keep every suite green; gaps surfaced during migration must be fixed in `src/`, not worked around.
4. **Dev-host WS surface growth (Phases 126-127)** — `getState`/`getLobby`/`debug:logs`/debug-toggle/UI-switcher ops all land on the same WS protocol; each must be additive and not regress the existing browser-driven dev-host flows proven in v4.3.

### Highest-Risk Items (v4.3)

1. **DSGN accuracy (Phase 116)** — several scout claims about what "already exists" are unverified; getting verdicts wrong means either rebuilding existing APIs or planning to build something that's missing. Verdicts must carry file:line evidence.
2. **INTRO serialization + perspective correctness (Phase 117)** — the action-space structure must be serializable end-to-end and the perspective-aware view must exclude hidden info correctly (INTRO-05); a leak here is a security regression.
3. **Cross-repo migration breadth (Phase 121)** — all `~/BoardSmithGames/` games (symlinked, live HMR) plus the MERC vendored canary (must re-vendor) — keep every suite green; gaps surfaced during migration must be fixed in `src/`, not worked around.
4. **Dev-host parity (Phase 119)** — `data-element-id` and the devtools global must work identically in custom UI and AutoUI (hard rule); browser-prove both before completion.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-07-02T18:45:54Z
Stopped at: Completed 129-01-PLAN.md
Resume file: None
Next action: Phase 129 (Migration — Games + MERC) Plan 01 complete (MIG-03 partial): hex/checkers/polyhedral-potions/demo-complex-ui/demo-action-panel all green, tsc clean, breakage-surface-free. Proceed to 129-02 (flagship new-test adoption: go-fish, cribbage, demo-animation) and 129-03 (MERC re-vendor).

## Operator Next Steps

- Phase 123 (Determinism & Flow Introspection) is fully executed (4/4 plans complete). Run `/gsd:verify-phase 123` to confirm FLOW-01/02/03/04 acceptance criteria before moving on to Phase 124/125.
- Phase 124 (Hidden-Info Test Utilities) is fully executed (3/3 plans complete) -- `isElementVisible`/`getVisibleElements`/`assertHidden`/`assertVisible`/`diffPlayerViews`/`renderAsSeat`/`assertNoHiddenInfoLeak` all shipped and exported from `boardsmith/testing`. Run `/gsd:verify-phase 124` to confirm VIS-01/02/03 acceptance criteria before starting Phase 125.
- Phase 125 (Headless Simulation) Plan 01 complete: `createHeadlessSession` is now exported from `boardsmith/session` (SIM-01). Plan 02 remains (per ROADMAP.md) before the phase is done.
- Phase 127 (Scriptable Dev Host) is fully executed (3/3 plans complete): `getState`/`getLobby`/`debugToggle`/`uiSwitch` host ops (127-01), Node-capable `GameConnection` via injectable `wsCtor` (127-02), and `createDevHostClient` + a browserless real-WS integration test proving the whole DRIVE-01/02/03 flow end-to-end (127-03). Run `/gsd:verify-phase 127` before starting Phase 128 (Animation/Drag-Drop Test Story).
