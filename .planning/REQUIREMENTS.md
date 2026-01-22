# Requirements: BoardSmith v2.4

**Defined:** 2026-01-22
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

Requirements for the Animation Event System milestone.

### Core Engine

- [ ] **ENG-01**: Game class exposes `emitAnimationEvent(type, data, options?)` method
- [ ] **ENG-02**: Animation events stored in buffer with unique IDs and timestamps
- [ ] **ENG-03**: `pendingAnimationEvents` getter returns events not yet acknowledged
- [ ] **ENG-04**: `acknowledgeAnimationEvents(upToId)` clears consumed events
- [ ] **ENG-05**: Animation buffer serializes/restores with game state
- [ ] **ENG-06**: Optional `group` field for batching related events

### Session Layer

- [ ] **SES-01**: `PlayerGameState` includes `animationEvents` array
- [ ] **SES-02**: `PlayerGameState` includes `lastAnimationEventId` for acknowledgment
- [ ] **SES-03**: `GameSession.acknowledgeAnimations(playerSeat, upToId)` method
- [ ] **SES-04**: Snapshot includes animation event buffer

### UI Layer

- [ ] **UI-01**: `useAnimationEvents` composable with handler registration
- [ ] **UI-02**: Handlers return Promises for animation timing control
- [ ] **UI-03**: `isAnimating` ref indicates playback in progress
- [ ] **UI-04**: `skipAll()` method to bypass remaining animations
- [ ] **UI-05**: `paused` ref for pause/resume control
- [ ] **UI-06**: `useActionController` exposes `animationsPending` computed
- [ ] **UI-07**: `useActionController` exposes `showActionPanel` that gates on animations
- [ ] **UI-08**: `useAutoAnimations` accepts `eventHandlers` option
- [ ] **UI-09**: Export `useAnimationEvents` from `boardsmith/ui`

### Documentation

- [ ] **DOC-01**: Document animation event system in `docs/ui-components.md`
- [ ] **DOC-02**: Add animation events to `docs/nomenclature.md`

## v2 Requirements

Deferred to future release.

(None identified — scope is focused)

## Out of Scope

Explicitly excluded from this milestone.

| Feature | Reason |
|---------|--------|
| Flow-level blocking | Soft continuation chosen; flow never waits for animations |
| Animation event commands | Events are UI hints, not state mutations; parallel channel chosen |
| Backward compatibility | Clean API design prioritized over migration support |

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
| SES-01 | TBD | Pending |
| SES-02 | TBD | Pending |
| SES-03 | TBD | Pending |
| SES-04 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| UI-06 | TBD | Pending |
| UI-07 | TBD | Pending |
| UI-08 | TBD | Pending |
| UI-09 | TBD | Pending |
| DOC-01 | TBD | Pending |
| DOC-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 0
- Unmapped: 21 ⚠️

---
*Requirements defined: 2026-01-22*
*Last updated: 2026-01-22 after initial definition*
