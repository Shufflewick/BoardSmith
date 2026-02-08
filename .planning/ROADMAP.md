# Milestone v3.0: Animation Timeline

**Status:** Complete
**Phases:** 85-90
**Total Plans:** TBD

## Overview

Replace the v2.9 theatre view and mutation capture system with a client-side animation timeline. Six phases work bottom-up: tear out the old theatre/mutation capture system, build the simplified animate() API with command stack integration, simplify session broadcasting to a single truth view, build the client-side animation queue with wait-for-handler semantics, wire up the UI layer, then migrate games and documentation. The server never waits on animation state again.

## Phases

- [x] **Phase 85: Theatre Erasure** - Remove all theatre, mutation capture, and acknowledgment code; start BREAKING.md
- [x] **Phase 86: Simplified Animation Events** - Build the new `game.animate(type, data)` API with command stack entries
- [x] **Phase 87: Session Simplification** - Single-view broadcasting with animation events, remove acknowledgment protocol
- [x] **Phase 88: Client Animation Queue** - FIFO queue with wait-for-handler, timeout, skip, and reactive state
- [x] **Phase 89: UI Integration** - Wire GameShell and ActionPanel to new animation system, remove old composables
- [x] **Phase 90: Documentation & Migration** - Update docs, migrate example games, complete BREAKING.md

## Phase Details

### Phase 85: Theatre Erasure
**Goal**: All theatre view, mutation capture, and acknowledgment code is removed from the codebase -- the old system no longer exists
**Depends on**: Nothing (first phase)
**Requirements**: REM-01, REM-02, REM-03, REM-04, REM-05, REM-06, DOC-01
**Success Criteria** (what must be TRUE):
  1. `_theatreSnapshot`, `theatreState`, `theatreStateForPlayer()`, and `acknowledgeAnimationEvents()` no longer exist on the Game class
  2. `MutationCaptureContext`, property diffing, and element attribute diffing code is deleted -- no `mutation-capture.ts` or `theatre-state.ts` files remain
  3. `acknowledgeAnimations` WebSocket message handler and `GameSession.acknowledgeAnimations()` are gone
  4. All theatre-related tests are removed; all remaining tests pass (no regressions in non-theatre functionality)
  5. BREAKING.md exists documenting every removed API with a "before (v2.9) / after (v3.0)" migration pattern
**Plans:** 4 plans
Plans:
- [x] 85-01-PLAN.md -- Engine core erasure (delete theatre files, strip Game class, clean exports)
- [x] 85-02-PLAN.md -- Session + server erasure (remove acknowledgeAnimations, simplify buildPlayerState)
- [x] 85-03-PLAN.md -- Client + UI erasure (remove acknowledge wiring, delete useCurrentView)
- [x] 85-04-PLAN.md -- BREAKING.md creation and full verification

### Phase 86: Simplified Animation Events
**Goal**: Game developers call `game.animate(type, data)` to emit pure data events that land on the command stack -- no mutation capture, no theatre snapshot
**Depends on**: Phase 85
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04
**Success Criteria** (what must be TRUE):
  1. `game.animate('combat', { attacker, defender, damage })` emits a pure data event with no mutation capture context
  2. `game.animate('combat', data, () => { piece.remove() })` accepts an optional callback that advances truth (convenience), but the callback's mutations are NOT captured as event metadata
  3. Animation events appear as entries on the command stack and survive serialization round-trips
  4. The animation event buffer persists across flow steps and is replaced when the next batch of events arrives (not accumulated indefinitely)
**Plans:** 1 plan
Plans:
- [x] 86-01-PLAN.md -- AnimateCommand in command system, game.animate() API, buffer lifecycle, tests

### Phase 87: Session Simplification
**Goal**: The session layer broadcasts a single truth view with animation events -- no theatre/currentView split, no acknowledgment protocol
**Depends on**: Phase 86
**Requirements**: SES-01, SES-02, SES-03, SES-04
**Success Criteria** (what must be TRUE):
  1. `buildPlayerState()` produces a single `view` field containing the truth game state (per-player visibility filtering preserved)
  2. `buildPlayerState()` includes the current flow step's animation events in the player state payload
  3. `acknowledgeAnimations()` method no longer exists on GameSession -- the server never tracks animation playback
  4. The `acknowledgeAnimations` WebSocket message type is rejected or ignored by the server
**Plans:** 1 plan
Plans:
- [x] 87-01-PLAN.md -- Verification tests, stale JSDoc cleanup, documentation updates

### Phase 88: Client Animation Queue
**Goal**: The client-side animation system processes events through a FIFO queue with wait-for-handler semantics, configurable timeouts, and skip support
**Depends on**: Phase 87
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09
**Success Criteria** (what must be TRUE):
  1. Animation events arriving from the server are queued FIFO and processed in order -- a handler registered for event type "combat" receives combat events one at a time
  2. When the queue encounters an event type with no registered handler, processing pauses (up to a configurable timeout, default 3s) to allow component mounting
  3. If timeout expires with no handler, a console warning names the event type and ID, the event is skipped, and processing continues
  4. Components call `registerHandler(type, fn)` to claim event types; if the queue is waiting for that type, processing resumes immediately
  5. `skipAll()` clears the queue instantly (UI already shows truth), and `isAnimating` / `pendingCount` remain reactive throughout
**Plans:** 1 plan
Plans:
- [x] 88-01-PLAN.md -- Wait-for-handler mechanism, timeout, skipAll cleanup, comprehensive tests

### Phase 89: UI Integration
**Goal**: GameShell and ActionPanel work with the new animation system -- old composables removed, single game view provided
**Depends on**: Phase 88
**Requirements**: CLI-10, CLI-11, UI-01, UI-02, UI-03
**Success Criteria** (what must be TRUE):
  1. `createAnimationEvents()` no longer accepts or uses an acknowledgment callback
  2. `useCurrentView()` composable and `CURRENT_VIEW_KEY` are deleted -- components use the single truth view
  3. GameShell provides a single `gameView` (truth) to all child components -- no `currentGameView` alternative
  4. ActionPanel gates on pending animation events before showing new decisions (preserved behavior from v2.9)
**Plans:** 1 plan
Plans:
- [x] 89-01-PLAN.md -- Remove acknowledge from animation events composable, update tests, verify UI chain

### Phase 90: Documentation & Migration
**Goal**: Documentation reflects the v3.0 animation system, example games are migrated, and external teams have a complete migration guide
**Depends on**: Phase 89
**Requirements**: DOC-02, DOC-03, DOC-04, DOC-05, DOC-06
**Success Criteria** (what must be TRUE):
  1. ui-components.md animation events section describes the new pure-data event model, registerHandler pattern, and wait-for-handler behavior
  2. nomenclature.md no longer references Theatre View or Current View as concepts -- terminology reflects client-side animation timeline
  3. migration-guide.md has a v3.0 section documenting the full migration path from theatre view to animation timeline
  4. demo-animation game runs correctly with the new animation system (verified in browser)
  5. cribbage game animations (if using animate) work correctly with the new system (verified in browser)
**Plans:** 2 plans
Plans:
- [x] 90-01-PLAN.md -- Update ui-components.md, nomenclature.md, and create migration-guide.md
- [x] 90-02-PLAN.md -- Migrate demo-animation and cribbage example games, verify in browser

## Progress

**Execution Order:**
Phases execute in numeric order: 85 -> 86 -> 87 -> 88 -> 89 -> 90

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 85. Theatre Erasure | 4/4 | Complete | 2026-02-08 |
| 86. Simplified Animation Events | 1/1 | Complete | 2026-02-08 |
| 87. Session Simplification | 1/1 | Complete | 2026-02-08 |
| 88. Client Animation Queue | 1/1 | Complete | 2026-02-08 |
| 89. UI Integration | 1/1 | Complete | 2026-02-08 |
| 90. Documentation & Migration | 2/2 | Complete | 2026-02-08 |
