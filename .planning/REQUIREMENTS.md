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
| ENG-01 | Phase 59 | Complete |
| ENG-02 | Phase 59 | Complete |
| ENG-03 | Phase 59 | Complete |
| ENG-04 | Phase 59 | Complete |
| ENG-05 | Phase 59 | Complete |
| ENG-06 | Phase 59 | Complete |
| SES-01 | Phase 60 | Pending |
| SES-02 | Phase 60 | Pending |
| SES-03 | Phase 60 | Pending |
| SES-04 | Phase 60 | Pending |
| UI-01 | Phase 61 | Pending |
| UI-02 | Phase 61 | Pending |
| UI-03 | Phase 61 | Pending |
| UI-04 | Phase 61 | Pending |
| UI-05 | Phase 61 | Pending |
| UI-06 | Phase 62 | Pending |
| UI-07 | Phase 62 | Pending |
| UI-08 | Phase 62 | Pending |
| UI-09 | Phase 62 | Pending |
| DOC-01 | Phase 63 | Pending |
| DOC-02 | Phase 63 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-01-22*
*Last updated: 2026-01-22 after roadmap creation*
