# Roadmap: BoardSmith v2.9 Theatre View

## Overview

Replace fire-and-forget animation events with a scoped callback API (`game.animate()`) that captures mutations per event, maintains a theatre view (pre-animation snapshot that advances per-acknowledgment), and threads that view through session and UI layers so components never show "the future" while animations play. Five phases build bottom-up: mutation capture, theatre state engine, session integration, UI composables, then clean break with game migration to validate the whole stack.

## Phases

- [x] **Phase 80: Mutation Capture** - `game.animate()` scoped callback API that captures element and property mutations per event
- [ ] **Phase 81: Theatre State Engine** - Engine-level theatre state that advances per-event as animations are acknowledged
- [ ] **Phase 82: Session Integration** - Session layer threads theatre view to all clients with current view as opt-in
- [ ] **Phase 83: UI Composables** - UI renders from theatre view by default with skip and current-view opt-in
- [ ] **Phase 84: Clean Break and Migration** - Remove old API, migrate games, update documentation

## Phase Details

### Phase 80: Mutation Capture
**Goal**: Game developers can call `game.animate(type, data, callback)` and the framework captures every mutation inside the callback, associating it with the animation event
**Depends on**: Nothing (first phase)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-08
**Success Criteria** (what must be TRUE):
  1. Calling `game.animate('death', data, () => { piece.remove() })` produces an animation event that records the piece removal as a captured mutation
  2. Element tree changes (create, move, remove, attribute changes) inside animate callbacks are tracked and retrievable per event
  3. Custom game property changes inside animate callbacks are tracked and retrievable per event
  4. Animation event IDs are monotonically increasing across multiple `animate()` calls within the same action
  5. All existing tests continue to pass (mutations still apply to game state immediately)
**Plans**: 2 plans

Plans:
- [x] 80-01-PLAN.md -- Mutation capture types, game.animate() method, property snapshot/diff, barrel exports
- [x] 80-02-PLAN.md -- Element interception (putInto, create, attribute snapshot/diff), integration tests

### Phase 81: Theatre State Engine
**Goal**: The engine maintains a theatre state -- a snapshot that reflects only acknowledged events' mutations -- so consumers can render the "narrative" state rather than truth
**Depends on**: Phase 80
**Requirements**: ENG-04, ENG-05, ENG-06
**Success Criteria** (what must be TRUE):
  1. After `game.animate()` is called, the theatre state does NOT reflect the callback's mutations (it shows the pre-animation state)
  2. Acknowledging an event by ID applies exactly that event's captured mutations to the theatre state, advancing it one step
  3. Theatre state serializes with game state and restores correctly (checkpoint round-trip preserves pending events and theatre position)
  4. Multiple animate calls produce a theatre state that can be stepped through event-by-event in order
**Plans**: 2 plans

Plans:
- [x] 81-01-PLAN.md -- Theatre state types, mutation applicators (apply MOVE/CREATE/SET_ATTRIBUTE/SET_PROPERTY to ElementJSON), unit tests
- [ ] 81-02-PLAN.md -- Wire theatre state into Game class (lazy init, acknowledgment advancement, serialization, getter), integration tests

### Phase 82: Session Integration
**Goal**: The session layer builds and broadcasts theatre view to all connected clients, with current view available as an opt-in field
**Depends on**: Phase 81
**Requirements**: SES-01, SES-02, SES-03, SES-04
**Success Criteria** (what must be TRUE):
  1. `buildPlayerState()` produces a `PlayerGameState` whose primary game view is the theatre state (with per-player visibility filtering applied)
  2. `PlayerGameState` includes a current-view field that components can opt into for truth (AI decisions, post-game summary)
  3. `acknowledgeAnimations()` advances the theatre state and triggers rebroadcast so all clients see the updated theatre view
  4. In a multiplayer game, all connected clients receive the same theatre view -- no client sees spoilers ahead of animations
**Plans**: TBD

Plans:
- [ ] 82-01: TBD
- [ ] 82-02: TBD

### Phase 83: UI Composables
**Goal**: Vue components render from theatre view by default, with explicit opt-in for current view and skip functionality
**Depends on**: Phase 82
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. `useAnimationEvents` processes events from the new `animate()` flow using the same handler registration pattern game developers already know
  2. Components that use `gameView` (or equivalent) render theatre state by default -- a component showing a piece that was removed in an animate callback still sees the piece until that event is acknowledged
  3. Components that need truth (AI controller, post-game) can call an explicit opt-in API (e.g. `useCurrentView()`) to get current state
  4. When flow yields for player input mid-animation, ActionPanel renders decisions against theatre state so players see choices that make sense with what they have seen so far
  5. Skip button acknowledges all pending events at once and immediately shows current view
**Plans**: TBD

Plans:
- [ ] 83-01: TBD
- [ ] 83-02: TBD

### Phase 84: Clean Break and Migration
**Goal**: Old animation API removed, existing games migrated to `game.animate()`, documentation complete -- the v2.9 release is shippable
**Depends on**: Phase 83
**Requirements**: ENG-07, MIG-01, MIG-02, MIG-03, MIG-04
**Success Criteria** (what must be TRUE):
  1. `emitAnimationEvent()` no longer exists -- calling it produces a compile error, not a runtime error
  2. Demo animation game uses `game.animate()` and its animations play correctly in the browser
  3. Cribbage game uses `game.animate()` and its scoring/pegging animations play correctly in the browser
  4. BREAKING.md documents the `emitAnimationEvent` to `animate()` migration with before/after examples
  5. Documentation (ui-components.md, nomenclature.md) reflects the new API and theatre view concepts
**Plans**: TBD

Plans:
- [ ] 84-01: TBD
- [ ] 84-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 80 -> 81 -> 82 -> 83 -> 84

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 80. Mutation Capture | 2/2 | Complete | 2026-02-07 |
| 81. Theatre State Engine | 1/2 | In progress | - |
| 82. Session Integration | 0/TBD | Not started | - |
| 83. UI Composables | 0/TBD | Not started | - |
| 84. Clean Break and Migration | 0/TBD | Not started | - |
