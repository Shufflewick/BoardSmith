# Requirements: BoardSmith v3.0 Animation Timeline

**Defined:** 2026-02-07
**Core Value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

### Engine -- Animation Event System

- [ ] **ENG-01**: `game.animate(type, data)` emits pure data events with no mutation capture
- [ ] **ENG-02**: `game.animate()` accepts optional callback for truth advancement (convenience, not capture)
- [ ] **ENG-03**: Animation events recorded as entries on the command stack
- [ ] **ENG-04**: Animation event buffer persists across flow steps until next batch replaces it

### Engine -- Removal

- [ ] **REM-01**: Remove `_theatreSnapshot` and all theatre state management from Game
- [ ] **REM-02**: Remove `MutationCaptureContext`, property diffing, element attribute diffing from animate()
- [ ] **REM-03**: Remove `acknowledgeAnimationEvents()` from Game
- [ ] **REM-04**: Remove `theatreStateForPlayer()` and `theatreState` getter from Game
- [ ] **REM-05**: Remove `theatre-state.ts` and `mutation-capture.ts` source files
- [ ] **REM-06**: Remove all theatre-related tests and migrate to new system tests

### Session -- Simplified State Broadcasting

- [ ] **SES-01**: `buildPlayerState()` sends truth as single `view` (no theatre/currentView split)
- [ ] **SES-02**: `buildPlayerState()` includes animation events from current flow step
- [ ] **SES-03**: Remove `acknowledgeAnimations()` from GameSession
- [ ] **SES-04**: Remove `acknowledgeAnimations` WebSocket message handler from server

### Client -- Animation Timeline

- [ ] **CLI-01**: Client-side animation queue processes events FIFO
- [ ] **CLI-02**: Wait-for-handler: queue pauses when no handler registered for current event type
- [ ] **CLI-03**: Configurable timeout for handler wait (default 3 seconds)
- [ ] **CLI-04**: Timeout logs console warning with event type, ID, and elapsed time
- [ ] **CLI-05**: After timeout, event is skipped and queue continues
- [ ] **CLI-06**: `registerHandler()` API for components to claim event types
- [ ] **CLI-07**: When handler registers while queue is waiting, processing resumes immediately
- [ ] **CLI-08**: `skipAll()` clears client queue (UI already shows truth)
- [ ] **CLI-09**: `isAnimating` and `pendingCount` reactive state preserved
- [ ] **CLI-10**: Remove acknowledgment callback from `createAnimationEvents()`
- [ ] **CLI-11**: Remove `useCurrentView()` composable and `CURRENT_VIEW_KEY`

### UI -- Animation Integration

- [ ] **UI-01**: ActionPanel gates on pending animation events (preserved behavior)
- [ ] **UI-02**: GameShell wires `createAnimationEvents` without acknowledge callback
- [ ] **UI-03**: GameShell provides single `gameView` (truth) -- no `currentGameView`

### Documentation & Migration

- [ ] **DOC-01**: BREAKING.md documents all removed APIs with migration paths
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
| ENG-01 | - | Pending |
| ENG-02 | - | Pending |
| ENG-03 | - | Pending |
| ENG-04 | - | Pending |
| REM-01 | - | Pending |
| REM-02 | - | Pending |
| REM-03 | - | Pending |
| REM-04 | - | Pending |
| REM-05 | - | Pending |
| REM-06 | - | Pending |
| SES-01 | - | Pending |
| SES-02 | - | Pending |
| SES-03 | - | Pending |
| SES-04 | - | Pending |
| CLI-01 | - | Pending |
| CLI-02 | - | Pending |
| CLI-03 | - | Pending |
| CLI-04 | - | Pending |
| CLI-05 | - | Pending |
| CLI-06 | - | Pending |
| CLI-07 | - | Pending |
| CLI-08 | - | Pending |
| CLI-09 | - | Pending |
| CLI-10 | - | Pending |
| CLI-11 | - | Pending |
| UI-01 | - | Pending |
| UI-02 | - | Pending |
| UI-03 | - | Pending |
| DOC-01 | - | Pending |
| DOC-02 | - | Pending |
| DOC-03 | - | Pending |
| DOC-04 | - | Pending |
| DOC-05 | - | Pending |
| DOC-06 | - | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 0
- Unmapped: 34

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-07 after initial definition*
