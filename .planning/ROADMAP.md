# Roadmap: BoardSmith v2.4 Animation Event System

## Overview

This milestone adds infrastructure-level support for dramatic UI playback of game calculations. The animation event system enables games like MERC to animate combat sequences while game state advances immediately (soft continuation pattern). Events flow from engine to session to UI, with the ActionPanel gating on animation completion.

## Milestones

- v0.1 through v2.3 - See STATE.md for history
- **v2.4 Animation Event System** - Phases 59-63 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (59, 60, 61): Planned milestone work
- Decimal phases (59.1, 59.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 59: Core Animation Events** - Engine types, buffer, emit/acknowledge API
- [x] **Phase 60: Session Integration** - PlayerGameState and snapshot support
- [ ] **Phase 61: Animation Playback** - useAnimationEvents composable with handlers
- [ ] **Phase 62: ActionController Integration** - Action panel waits for animations
- [ ] **Phase 63: Documentation** - Document animation event system

## Phase Details

### Phase 59: Core Animation Events
**Goal**: Game class can emit, buffer, and manage animation events with unique IDs
**Depends on**: Nothing (first phase of v2.4)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06
**Success Criteria** (what must be TRUE):
  1. Game can emit animation events with type, data, and optional group
  2. Each event has a unique ID and timestamp
  3. Events accumulate in buffer until acknowledged
  4. Acknowledging up to an ID clears consumed events
  5. Animation buffer survives serialize/restore round-trip
**Plans**: 2 plans

Plans:
- [x] 59-01-PLAN.md - Animation event types and core API
- [x] 59-02-PLAN.md - Serialization support and unit tests

### Phase 60: Session Integration
**Goal**: Session layer exposes animation events to UI consumers
**Depends on**: Phase 59
**Requirements**: SES-01, SES-02, SES-03, SES-04
**Success Criteria** (what must be TRUE):
  1. PlayerGameState includes animationEvents array from game buffer
  2. PlayerGameState includes lastAnimationEventId for acknowledgment tracking
  3. GameSession.acknowledgeAnimations(playerSeat, upToId) clears events
  4. Session snapshots preserve animation event buffer
**Plans**: 1 plan

Plans:
- [x] 60-01-PLAN.md - Session animation event integration

### Phase 61: Animation Playback
**Goal**: UI can register handlers and play back animation events sequentially
**Depends on**: Phase 60
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. useAnimationEvents composable accepts handler registration by event type
  2. Handlers return Promises that control animation timing
  3. isAnimating ref correctly reflects playback state
  4. skipAll() method bypasses remaining animations
  5. paused ref enables pause/resume control
**Plans**: 1 plan

Plans:
- [ ] 61-01-PLAN.md - Animation event playback composable

### Phase 62: ActionController Integration
**Goal**: Action panel waits for animations before showing new decisions
**Depends on**: Phase 61
**Requirements**: UI-06, UI-07, UI-08, UI-09
**Success Criteria** (what must be TRUE):
  1. useActionController exposes animationsPending computed
  2. useActionController exposes showActionPanel that gates on animation completion
  3. useAutoAnimations accepts eventHandlers option for handler registration
  4. useAnimationEvents exported from boardsmith/ui
**Plans**: TBD

Plans:
- [ ] 62-01: TBD

### Phase 63: Documentation
**Goal**: Animation event system fully documented for game developers
**Depends on**: Phase 62
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. docs/ui-components.md documents animation event system with examples
  2. docs/nomenclature.md includes animation event terminology
**Plans**: TBD

Plans:
- [ ] 63-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 59 -> 60 -> 61 -> 62 -> 63

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 59. Core Animation Events | 2/2 | ✓ Complete | 2026-01-22 |
| 60. Session Integration | 1/1 | ✓ Complete | 2026-01-22 |
| 61. Animation Playback | 0/1 | Not started | - |
| 62. ActionController Integration | 0/? | Not started | - |
| 63. Documentation | 0/? | Not started | - |
