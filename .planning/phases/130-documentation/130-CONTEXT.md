# Phase 130: Documentation - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Documentation accurately describes the shipped, migrated v4.4 surface so an agent or author can learn the new testing, dev-host, and determinism guarantees from the docs alone. DOC-05 (all new/changed APIs documented) + DOC-06 (BREAKING.md updated).

Scope: BoardSmith `docs/` only (+ BREAKING.md at repo root if that's where it lives — check).

</domain>

<decisions>
## Implementation Decisions

- Update the existing `docs/` guides IN PLACE — no new doc tree. Likely targets (verify during planning): a testing-focused guide (find the current home for TestGame/assertions docs — possibly docs/api or a testing guide; check docs/README.md index), agent-control.md (dev-host protocol/devtools — the v4.3 agent doc, natural home for getState/getLobby/debugToggle/uiSwitch/debug:logs/debug:flow-state/createDevHostClient), browser-testing.md, custom-ui-guide.md (anchor requirements + fail-loud + anchorAttrs warning), llm-overview.md (the agent-first index — must mention the new surfaces)
- BREAKING.md: one consolidated v4.4 section, every removed/changed API with before→after snippets (headless-harness move, ElementCollection.shuffle rng required, playUntilComplete deterministic default, animation fail-loud dev throws, onPersistenceError 3-arg, anchorAttrs signature)
- Doc-verifier pass: every claimed symbol/command grep-verified against code; examples lifted from real tests where possible
- Agent-first framing: each new capability gets a "what you can now assert/drive" recipe (e.g. the go-fish DOM-leak recipe, the flow-position debugging recipe, the createDevHostClient drive-the-dev-host recipe, boardsmith simulate CI recipe)

### What shipped in v4.4 (the surface to document)
- FLOW: getFlowDebugInfo/describeFlowPosition (+ in GameStuckError/assertions/toDebugString), TestGame.getPendingAction, disabled-choice introspection, determinism guarantee (seeded end-to-end, no Math.random fallbacks), seed retrievability, debug:flow-state WS op + devtools getters
- VIS: isElementVisible/getVisibleElements/assertHidden/assertVisible/diffPlayerViews (three-state, post-playerView), renderAsSeat/assertNoHiddenInfoLeak (async, jsdom, positive controls, allow predicates elementId-scoped)
- SIM: createHeadlessSession (boardsmith/session), boardsmith simulate CLI (--games/--seed/--players/--json, exit codes, replay hints)
- ERR: OpResult warnings[{code,message,source}] + errorCode; onPersistenceError/lastPersistenceError/persistenceHealthy (both hosts); debug:logs ring buffer + DebugPanel Logs tab
- DRIVE: getState/getLobby/debugToggle/uiSwitch WS ops; Node-capable GameConnection (wsImplementation ?? globalThis.WebSocket, Node >=22.4 note); createDevHostClient (boardsmith/client)
- ANIM: enableAnimationTestMode/getAnimationTrace (boardsmith/ui + testing), {kind,element,from,to} traces, isDevThrowEnabled semantics (positive-signal dev throw; unlabeled never crashes), anchorAttrs(ref, type) + once-per-type dev-warning

### Claude's Discretion
- Which existing doc files get which sections; recipe wording; how much API-reference vs guide

</decisions>

<code_context>
## Existing Code Insights

- docs/ tree listed: agent-control.md (v4.3 agent doc — primary home for DRIVE/devtools), browser-testing.md, custom-ui-guide.md, llm-overview.md, migration-guide.md, common-pitfalls.md, api/ subdir, README.md index
- BREAKING.md location: repo root (v2.7 created it) — verify
- All phase SUMMARYs in .planning/phases/12*/ carry precise API names + examples; the game repos' new tests (go-fish DOM-leak, cribbage visibility, demo-animation trace) are ready-made doc examples
- v4.3's DOC phase (122) SUMMARYs show the doc-update pattern from last milestone

</code_context>

<specifics>
## Specifics

- The doc-verifier (gsd-doc-verifier agent) should check every symbol/command claim against the live codebase
- llm-overview.md is the agent entry point — the v4.4 capabilities must be discoverable from it

</specifics>

<deferred>
## Deferred Ideas

None.
</deferred>
