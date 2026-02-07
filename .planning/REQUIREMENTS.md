# Requirements: BoardSmith v2.9 Theatre View

**Defined:** 2026-02-06
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

Requirements for v2.9 release. Each maps to roadmap phases.

### Engine

- [x] **ENG-01**: `game.animate(type, data, callback)` scoped callback API — mutations inside callback are captured and associated with the animation event
- [x] **ENG-02**: Mutation capture tracks element tree changes (create, move, remove, attribute changes) during animate callbacks
- [x] **ENG-03**: Mutation capture tracks custom game property changes during animate callbacks
- [x] **ENG-04**: Theatre state maintained at engine level — reflects only acknowledged events' mutations applied to a base snapshot
- [x] **ENG-05**: Per-event acknowledgment applies that event's captured mutations to advance the theatre state
- [x] **ENG-06**: Theatre state serializes and restores with game state (checkpoint/replay safe)
- [ ] **ENG-07**: `emitAnimationEvent()` removed — `game.animate()` is the only animation API
- [x] **ENG-08**: Monotonically increasing event IDs preserved across `animate()` (same guarantee as current system)

### Session

- [ ] **SES-01**: `buildPlayerState()` produces theatre view (default) with per-player visibility filtering
- [ ] **SES-02**: `PlayerGameState` carries current view as opt-in field alongside theatre view
- [ ] **SES-03**: `acknowledgeAnimations()` advances theatre state and rebroadcasts to all clients
- [ ] **SES-04**: All connected clients receive theatre view — multiplayer sync without spoilers

### UI

- [ ] **UI-01**: `useAnimationEvents` composable updated for `animate()` event flow with same handler registration pattern
- [ ] **UI-02**: Components render from theatre view by default (what `gameView` provides)
- [ ] **UI-03**: Explicit opt-in API for current view (truth) — e.g., `useCurrentView()` or similar
- [ ] **UI-04**: ActionPanel renders decisions from theatre state when flow yields mid-animation sequence
- [ ] **UI-05**: Skip functionality acknowledges all pending events and immediately shows current view

### Migration

- [ ] **MIG-01**: Demo animation game migrated to `game.animate()` API
- [ ] **MIG-02**: Cribbage game migrated to `game.animate()` API
- [ ] **MIG-03**: BREAKING.md updated with v2.9 migration guide (emitAnimationEvent → animate)
- [ ] **MIG-04**: Documentation updated (ui-components.md, nomenclature.md)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Theatre Features

- **ADV-01**: Per-player theatre view advancement (different players see different animation states)
- **ADV-02**: Theatre view diffing for bandwidth optimization (send patches instead of full snapshots)
- **ADV-03**: Nested animate scopes (animation events that contain sub-events)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Backward compatibility for `emitAnimationEvent` | Clean break — one animation API, no confusion |
| Per-player theatre view advancement | All players advance together — simpler, matches multiplayer semantics |
| View transform hooks | Scoped callback is more pit-of-success — developers can't forget to register transforms |
| Element-level gating (without full theatre view) | Too ad-hoc — theatre view solves the general problem |
| Shims or deprecation aliases for old API | No backward compat policy — remove old, add new |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 80: Mutation Capture | Complete |
| ENG-02 | Phase 80: Mutation Capture | Complete |
| ENG-03 | Phase 80: Mutation Capture | Complete |
| ENG-04 | Phase 81: Theatre State Engine | Complete |
| ENG-05 | Phase 81: Theatre State Engine | Complete |
| ENG-06 | Phase 81: Theatre State Engine | Complete |
| ENG-07 | Phase 84: Clean Break and Migration | Pending |
| ENG-08 | Phase 80: Mutation Capture | Complete |
| SES-01 | Phase 82: Session Integration | Pending |
| SES-02 | Phase 82: Session Integration | Pending |
| SES-03 | Phase 82: Session Integration | Pending |
| SES-04 | Phase 82: Session Integration | Pending |
| UI-01 | Phase 83: UI Composables | Pending |
| UI-02 | Phase 83: UI Composables | Pending |
| UI-03 | Phase 83: UI Composables | Pending |
| UI-04 | Phase 83: UI Composables | Pending |
| UI-05 | Phase 83: UI Composables | Pending |
| MIG-01 | Phase 84: Clean Break and Migration | Pending |
| MIG-02 | Phase 84: Clean Break and Migration | Pending |
| MIG-03 | Phase 84: Clean Break and Migration | Pending |
| MIG-04 | Phase 84: Clean Break and Migration | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-07 after Phase 81 completion*
