# Requirements: BoardSmith v2.9 Theatre View

**Defined:** 2026-02-06
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

Requirements for v2.9 release. Each maps to roadmap phases.

### Engine

- [ ] **ENG-01**: `game.animate(type, data, callback)` scoped callback API — mutations inside callback are captured and associated with the animation event
- [ ] **ENG-02**: Mutation capture tracks element tree changes (create, move, remove, attribute changes) during animate callbacks
- [ ] **ENG-03**: Mutation capture tracks custom game property changes during animate callbacks
- [ ] **ENG-04**: Theatre state maintained at engine level — reflects only acknowledged events' mutations applied to a base snapshot
- [ ] **ENG-05**: Per-event acknowledgment applies that event's captured mutations to advance the theatre state
- [ ] **ENG-06**: Theatre state serializes and restores with game state (checkpoint/replay safe)
- [ ] **ENG-07**: `emitAnimationEvent()` removed — `game.animate()` is the only animation API
- [ ] **ENG-08**: Monotonically increasing event IDs preserved across `animate()` (same guarantee as current system)

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
| ENG-01 | TBD | Pending |
| ENG-02 | TBD | Pending |
| ENG-03 | TBD | Pending |
| ENG-04 | TBD | Pending |
| ENG-05 | TBD | Pending |
| ENG-06 | TBD | Pending |
| ENG-07 | TBD | Pending |
| ENG-08 | TBD | Pending |
| SES-01 | TBD | Pending |
| SES-02 | TBD | Pending |
| SES-03 | TBD | Pending |
| SES-04 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| MIG-01 | TBD | Pending |
| MIG-02 | TBD | Pending |
| MIG-03 | TBD | Pending |
| MIG-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 0
- Unmapped: 21

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-06 after initial definition*
