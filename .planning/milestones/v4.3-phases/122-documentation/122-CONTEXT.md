# Phase 122: Documentation - Context

**Gathered:** 2026-07-01
**Status:** Ready for execution
**Mode:** Design-anchored (docs describe the shipped v4.3 surface; 4 independent DOC files)

<domain>
## Phase Boundary

Bring `docs/` in line with the shipped, migrated v4.3 surface so an agent or author can learn headless driving, the new test ergonomics, browser/dev-host driving, and the new authoring guards from the docs alone. Scope: BoardSmith `docs/` ONLY. Requirements DOC-01..04.
</domain>

<decisions>
## Shipped surface the docs must describe (accurate anchors)

### DOC-01 — NEW agent-control guide (`docs/agent-control.md`)
Headless driving loop: create → inspect → enumerate → submit → assert. Introspection APIs (Phase 117): `game.getActionSpace(seat)`, `game.getActionSchema(action)`, `buildActionArgs(...)`, `enumerateLegalMoves(...)`, `game.getPlayerView(seat)` (perspective-aware, hidden info excluded). Undo/checkpoint/replay + determinism/seeding (seeded RNG in ElementContext; replay via commandHistory/actionHistory). Reference `.planning/v4.3-API-DESIGN.md` for signatures.

### DOC-02 — UPDATE `docs/api/testing.md` (TestGame ergonomics, Phase 118)
Typed observable state via `getPlayerView`; `playUntilComplete` with `GameStuckError` (sequential + simultaneous); assertion auto-trace on failed availability assertions; `actionsMode` permissive ("contains") vs exact ("only these"); `ActionBuilder` multi-step selection builder (replaces low-level `resolveChoices`/`selectionStep`).

### DOC-03 — NEW browser/dev-host testing doc (`docs/browser-testing.md`)
Polished public version of `.planning/phases/119-dev-host-devtools-bridge/119-AGENT-LOOP.md`. Cover: stable `data-element-id` (canonical `data-bs-el-id`, `data-element-id` FLIP alias) in custom UI + AutoUI; `window.__BOARDSMITH_DEVTOOLS` (`getState`/`getAvailableActions`/`getActionMetadata`/`getBoardInteractionState`) on the `boardsmith dev` host; `boardsmith:action-resolved` CustomEvent (`{action, success, seat, error?}`); DISCOVER→SELECT→DRIVE→CONFIRM loop. Document the pit-of-success finding: `success:false` fires only on server rejection (client-side guards early-return without dispatch), so a well-designed game rarely emits it from UI-driven input.

### DOC-04 — UPDATE `docs/common-pitfalls.md` + authoring docs (Phase 120 guards)
New fail-fast guards: `loop()` without `maxIterations` throws at construction; game start validates element registration (throws naming unregistered CUSTOM class → `registerElements`; built-in classes are exempt — Phase 121); action reachability (actionStep-referenced-but-unregistered throws; registered-but-unreferenced devWarns; function-valued `actions` is a documented static blind spot); two eslint rules `no-element-identity-comparison` (use `element.id === other.id`) and `no-element-array-state` (don't store `game.all()` results as persistent state). Note removed footguns (silent devWarn for missing maxIterations is gone).
</decisions>

<specifics>
## Ground docs in real worked examples
Use the migrated games as worked examples: go-fish (cards, headless driving + devtools loop), checkers (grid), polyhedral-potions (the registerElements/built-in-Die lesson). Every code snippet must match the actually-shipped API names — verify against `src/` and `.planning/v4.3-API-DESIGN.md`, not memory.
</specifics>

<deferred>
## Deferred
None — docs describe the shipped surface only.
</deferred>
</content>
