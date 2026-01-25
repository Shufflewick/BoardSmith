# Roadmap: BoardSmith v2.5 Player Colors

## Overview

Refactor player colors from game-managed to engine-managed. Players get a `color` property, games define available colors via configuration, and UI components adapt automatically. This enables consistent color handling across all games and eliminates the fragmented `DEFAULT_PLAYER_COLORS` pattern.

## Milestones

- **v2.5 Player Colors Refactor** - Phases 64-68 (in progress)

## Phases

- [x] **Phase 64: Engine Layer** - Player.color property and game color configuration (complete 2026-01-25)
- [x] **Phase 65: Session Layer** - Color change API and persistence (complete 2026-01-25)
- [ ] **Phase 66: UI Layer** - Lobby color picker and PlayerStats integration
- [ ] **Phase 67: Cleanup** - Remove old API, update documentation
- [ ] **Phase 68: Game Updates** - Migrate all games to player.color

## Phase Details

### Phase 64: Engine Layer
**Goal**: Players have engine-managed color properties with game-configurable palettes
**Depends on**: Nothing (first phase)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06
**Success Criteria** (what must be TRUE):
  1. Game developer can access `player.color` and receive a hex string
  2. Game developer can define `colors` array in game config and players are assigned from it
  3. Game developer can set `colorSelectionEnabled: false` to disable player color selection
  4. Player joining seat N receives color at index N from the palette
  5. Engine throws helpful error if maxPlayers exceeds available colors
**Plans**: 1 plan

Plans:
- [x] 64-01-PLAN.md — Add DEFAULT_COLOR_PALETTE, extend GameOptions, color validation and auto-assignment

### Phase 65: Session Layer
**Goal**: Players can change colors during lobby, with proper conflict handling
**Depends on**: Phase 64
**Requirements**: SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
  1. Player can call color change API and receive a new color
  2. Color change is rejected with clear message when target color is occupied
  3. Player's color persists through disconnection and reconnection
**Plans**: 1 plan

Plans:
- [x] 65-01-PLAN.md — Add color conflict validation to updatePlayerOptions and updateSlotPlayerOptions

### Phase 66: UI Layer
**Goal**: Lobby and PlayerStats display player colors with selection UI
**Depends on**: Phase 65
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. Lobby shows color picker when game has colorSelectionEnabled: true
  2. Lobby hides color picker when game has colorSelectionEnabled: false
  3. Color picker visually distinguishes available vs occupied colors
  4. PlayerStats component displays player color indicator when enabled
  5. PlayerStats hides color indicator when colorSelectionEnabled: false
**Plans**: 1 plan

Plans:
- [ ] 66-01-PLAN.md — Extend LobbyInfo with color config, add conditional color UI to WaitingRoom and PlayersPanel

### Phase 67: Cleanup
**Goal**: Old color API removed, documentation updated
**Depends on**: Phase 66
**Requirements**: CLN-01, CLN-02
**Success Criteria** (what must be TRUE):
  1. DEFAULT_PLAYER_COLORS export removed or marked deprecated with migration guidance
  2. Documentation describes new player.color API with examples
**Plans**: TBD

Plans:
- [ ] 67-01: TBD

### Phase 68: Game Updates
**Goal**: All games migrated to use player.color
**Depends on**: Phase 67
**Requirements**: GAME-01, GAME-02, GAME-03, GAME-04
**Success Criteria** (what must be TRUE):
  1. Hex game uses player.color for all player-specific styling
  2. Checkers game uses player.color for piece rendering
  3. MERC game uses player.color throughout UI
  4. All other BoardSmithGames use player.color where applicable
**Plans**: TBD

Plans:
- [ ] 68-01: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 64. Engine Layer | 1/1 | Complete | 2026-01-25 |
| 65. Session Layer | 1/1 | Complete | 2026-01-25 |
| 66. UI Layer | 0/1 | Planned | - |
| 67. Cleanup | 0/? | Not started | - |
| 68. Game Updates | 0/? | Not started | - |
