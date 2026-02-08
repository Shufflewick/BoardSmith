# Requirements: BoardSmith v3.0 Animation Timeline

**Defined:** 2026-02-07
**Core Value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

### Engine -- Animation Event System

- [x] **ENG-01**: `game.animate(type, data)` emits pure data events with no mutation capture
- [x] **ENG-02**: `game.animate()` accepts optional callback for truth advancement (convenience, not capture)
- [x] **ENG-03**: Animation events recorded as entries on the command stack
- [x] **ENG-04**: Animation event buffer persists across flow steps until next batch replaces it

### Engine -- Removal

- [x] **REM-01**: Remove `_theatreSnapshot` and all theatre state management from Game
- [x] **REM-02**: Remove `MutationCaptureContext`, property diffing, element attribute diffing from animate()
- [x] **REM-03**: Remove `acknowledgeAnimationEvents()` from Game
- [x] **REM-04**: Remove `theatreStateForPlayer()` and `theatreState` getter from Game
- [x] **REM-05**: Remove `theatre-state.ts` and `mutation-capture.ts` source files
- [x] **REM-06**: Remove all theatre-related tests and migrate to new system tests

### Session -- Simplified State Broadcasting

- [x] **SES-01**: `buildPlayerState()` sends truth as single `view` (no theatre/currentView split)
- [x] **SES-02**: `buildPlayerState()` includes animation events from current flow step
- [x] **SES-03**: Remove `acknowledgeAnimations()` from GameSession
- [x] **SES-04**: Remove `acknowledgeAnimations` WebSocket message handler from server

### Client -- Animation Timeline

- [x] **CLI-01**: Client-side animation queue processes events FIFO
- [x] **CLI-02**: Wait-for-handler: queue pauses when no handler registered for current event type
- [x] **CLI-03**: Configurable timeout for handler wait (default 3 seconds)
- [x] **CLI-04**: Timeout logs console warning with event type, ID, and elapsed time
- [x] **CLI-05**: After timeout, event is skipped and queue continues
- [x] **CLI-06**: `registerHandler()` API for components to claim event types
- [x] **CLI-07**: When handler registers while queue is waiting, processing resumes immediately
- [x] **CLI-08**: `skipAll()` clears client queue (UI already shows truth)
- [x] **CLI-09**: `isAnimating` and `pendingCount` reactive state preserved
- [x] **CLI-10**: Remove acknowledgment callback from `createAnimationEvents()`
- [x] **CLI-11**: Remove `useCurrentView()` composable and `CURRENT_VIEW_KEY`

### UI -- Animation Integration

- [x] **UI-01**: ActionPanel gates on pending animation events (preserved behavior)
- [x] **UI-02**: GameShell wires `createAnimationEvents` without acknowledge callback
- [x] **UI-03**: GameShell provides single `gameView` (truth) -- no `currentGameView`

### Documentation & Migration

- [x] **DOC-01**: BREAKING.md documents all removed APIs with migration paths
- [ ] **DOC-02**: Update ui-components.md animation events section
- [ ] **DOC-03**: Update nomenclature.md -- revise Theatre View and Current View definitions
- [ ] **DOC-04**: Update migration-guide.md for v3.0
- [ ] **DOC-05**: Migrate demo-animation game to new system
- [ ] **DOC-06**: Migrate cribbage game to new system (if it uses animate)

## v2 Requirements

### Replay System

- **REPLAY-01**: Replay animation events from command stack history
- **REPLAY-02**: Rewind to specific flow step and replay animation timeline
- **REPLAY-03**: Spectator mode replays animations for late-joining viewers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Server-side playback tracking | Playback is 100% client-side by design |
| Per-player animation state on server | No acknowledgment protocol -- client owns timeline |
| Mutation capture / automatic state diffing | Too fragile for complex state; animation-driven components use event data payloads |
| Theatre view / pre-animation snapshots | Replaced by client-side timeline approach |
| Backward compatibility with v2.9 theatre API | Clean break -- no deprecation, complete removal |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 86 | Complete |
| ENG-02 | Phase 86 | Complete |
| ENG-03 | Phase 86 | Complete |
| ENG-04 | Phase 86 | Complete |
| REM-01 | Phase 85 | Complete |
| REM-02 | Phase 85 | Complete |
| REM-03 | Phase 85 | Complete |
| REM-04 | Phase 85 | Complete |
| REM-05 | Phase 85 | Complete |
| REM-06 | Phase 85 | Complete |
| SES-01 | Phase 87 | Complete |
| SES-02 | Phase 87 | Complete |
| SES-03 | Phase 87 | Complete |
| SES-04 | Phase 87 | Complete |
| CLI-01 | Phase 88 | Complete |
| CLI-02 | Phase 88 | Complete |
| CLI-03 | Phase 88 | Complete |
| CLI-04 | Phase 88 | Complete |
| CLI-05 | Phase 88 | Complete |
| CLI-06 | Phase 88 | Complete |
| CLI-07 | Phase 88 | Complete |
| CLI-08 | Phase 88 | Complete |
| CLI-09 | Phase 88 | Complete |
| CLI-10 | Phase 89 | Complete |
| CLI-11 | Phase 89 | Complete |
| UI-01 | Phase 89 | Complete |
| UI-02 | Phase 89 | Complete |
| UI-03 | Phase 89 | Complete |
| DOC-01 | Phase 85 | Complete |
| DOC-02 | Phase 90 | Pending |
| DOC-03 | Phase 90 | Pending |
| DOC-04 | Phase 90 | Pending |
| DOC-05 | Phase 90 | Pending |
| DOC-06 | Phase 90 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-08 after Phase 89 completion (CLI-10, CLI-11, UI-01, UI-02, UI-03 complete)*
