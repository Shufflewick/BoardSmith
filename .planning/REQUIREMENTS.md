# Requirements: BoardSmith v4.4 — Agent-Ergonomics Gaps (Audit Fixes)

**Defined:** 2026-07-01
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules. Since games are built by AI agents, everything must be testable, observable, or drivable without a human watching a screen.

Source: 2026-07-01 agent-ergonomics audit — all findings verified against code with file:line evidence.

## v1 Requirements

### Hidden-Info Verification (VIS)

- [ ] **VIS-01**: Developer can assert per-seat element visibility in tests via `isElementVisible(element, seat)` / `getVisibleElements(seat)` on TestGame (no hand-parsing ElementJSON)
- [ ] **VIS-02**: Developer can diff what two seats see (`diffPlayerViews`-style utility) to verify hidden information stays hidden
- [ ] **VIS-03**: Developer can run a DOM-leak test utility that renders the game UI as seat N and fails when hidden-element identity (rank/suit/face attributes) appears in the rendered DOM

### Headless Simulation (SIM)

- [ ] **SIM-01**: Developer can import the headless session harness (`createHeadlessSession`) from the public `boardsmith/session` API (currently internal at `src/session/testing/headless-harness.ts`)
- [ ] **SIM-02**: Developer can run `boardsmith simulate` (games count + seed flags) to play seeded games headless with pass/stuck/error reporting

### Structured Error Surfacing (ERR)

- [ ] **ERR-01**: `boardRefs()` / `display()` / `getChoices()` failures surface as structured warnings in the pick/op result — no console-only silent fallbacks (pick-handler.ts:235 et al.)
- [ ] **ERR-02**: Action execution failures from the runner carry structured `errorCode` values agents can branch on (runner.ts:172-176 currently flattens to message strings)
- [ ] **ERR-03**: Storage save failures are observable by the caller (awaitable or surfaced event), not fire-and-forget `.catch(console.error)`
- [ ] **ERR-04**: Dev-host server-side errors/logs are available to connected clients via a WS op (e.g. `debug:logs`), not buried in the Node terminal

### Scriptable Dev Host (DRIVE)

- [ ] **DRIVE-01**: Agent can query current game state and lobby over WS — `getState`/`getLobby` ops (already in protocol.ts:316,321) implemented in the dev host
- [ ] **DRIVE-02**: Client SDK (`GameConnection`) works in Node — WebSocket abstraction replaces the browser-only `new WebSocket()` (game-connection.ts:80)
- [ ] **DRIVE-03**: Remaining UI-only dev-host controls (debug-panel toggle, UI switcher) are drivable via WS ops

### Animation & Drag-Drop Test Story (ANIM)

- [ ] **ANIM-01**: Animation composables support a test mode with instant resolution + a recorded, assertable trace (`{element, from, to, kind}`) so "card X flew from A to B" is a headless assertion
- [ ] **ANIM-02**: `useFLIP`, `useFlyingElements`, `useElementAnimation`, `useActionAnimations`, and `useDragDrop` each have direct unit tests (currently zero)
- [ ] **ANIM-03**: Animation helpers fail loud with an actionable error when a target element lacks its anchor attribute (silent no-op today), plus the deferred anchorAttrs dev-warning for custom boards

### Flow & Debug Introspection (FLOW)

- [ ] **FLOW-01**: Developer can get a human-readable flow-position dump ("phase *pegging* → step *player-turn*, waiting on seat 2") via FlowState / `toDebugString()`
- [ ] **FLOW-02**: Developer can query disabled choices with their disable reasons (currently filtered out by `getPickChoices`)
- [ ] **FLOW-03**: Developer can inspect mid-multi-step action state (`PendingActionState`) from TestGame
- [ ] **FLOW-04**: Seeded runs are deterministic end-to-end — no `Math.random` fallbacks in engine paths (space.ts:279, element-collection.ts:211) and `playUntilComplete` is deterministic by default

### Documentation (DOC — continues from v4.3)

- [ ] **DOC-05**: All new/changed APIs documented — testing guide (visibility, animation traces, headless sim), dev-host protocol, determinism guarantees
- [ ] **DOC-06**: BREAKING.md updated for all removed/changed APIs (clean break, no deprecation aliases)

### Migration (MIG — continues from v4.3)

- [ ] **MIG-03**: All `~/BoardSmithGames/` example games updated to the new/changed APIs, all suites green
- [ ] **MIG-04**: MERC re-vendored and updated, suite green

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Higher-Level Game Helpers (HELP)

- **HELP-02**: Standardized multi-select helper ("select N elements then submit") replacing hand-wired `multiSelectDraft`
- **HELP-03**: Grid-game move-validation base helpers (checkers hand-rolled ~400 lines)
- **HELP-04**: Sprite-sheet rendering helper (cribbage hand-rolled scale math)

### Dev Tooling (TOOL)

- **TOOL-01**: `boardsmith screenshot` — render board to image headlessly
- **TOOL-02**: HTTP REST endpoints (`/api/state`, `/api/actions`) alongside WS

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backward compatibility / deprecation aliases | Pre-users; clean break is the project's hard rule |
| Multi-client follow mode in dev host | Single-agent workflow is the target; coordination YAGNI |
| Visual/pixel regression testing | Trace-based animation assertions cover correctness; pixel-perfection stays human |
| ShufflewickPub host skin (HOST-01..04) | Separate repo, carried deferral from v4.0 |
| Abstract game-type base classes (card game, grid game) | Design-heavy; helpers above (v2) are the incremental path |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| — | — | — |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 0
- Unmapped: 20 ⚠️ (roadmap pending)

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 after initial definition*
