# Requirements: BoardSmith v2.5

**Defined:** 2026-01-25
**Core Value:** Make board game development fast and correct

## v1 Requirements

Requirements for v2.5 Player Colors Refactor.

### Engine

- [x] **ENG-01**: Player has `color` property (hex string) accessible via `player.color`
- [x] **ENG-02**: Game defines available colors via `colors` configuration array
- [x] **ENG-03**: Game defines `colorSelectionEnabled` flag (default: true)
- [x] **ENG-04**: Player color auto-assigned from palette based on seat index
- [x] **ENG-05**: Validation throws error if `maxPlayers > colors.length`
- [x] **ENG-06**: Default color palette provided when game doesn't specify custom colors

### Session

- [x] **SESS-01**: Player can change color to any unoccupied color
- [x] **SESS-02**: Color change rejected if target color is held by another player
- [x] **SESS-03**: Color state persists across session lifecycle

### UI

- [x] **UI-01**: Lobby shows color picker when `colorSelectionEnabled` is true
- [x] **UI-02**: Lobby hides color picker when `colorSelectionEnabled` is false
- [x] **UI-03**: Color picker only shows available (unoccupied) colors as selectable
- [x] **UI-04**: PlayerStats shows player color when `colorSelectionEnabled` is true
- [x] **UI-05**: PlayerStats hides color when `colorSelectionEnabled` is false

### Cleanup

- [ ] **CLN-01**: Remove or deprecate `DEFAULT_PLAYER_COLORS` export
- [ ] **CLN-02**: Update documentation to reflect new color API

### Game Updates

- [ ] **GAME-01**: Update hex to use `player.color` throughout UI
- [ ] **GAME-02**: Update checkers to use `player.color` for piece colors
- [ ] **GAME-03**: Update MERC game to use `player.color` throughout UI
- [ ] **GAME-04**: Update remaining BoardSmithGames as needed

## v2 Requirements

(None deferred)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Backward compatibility for DEFAULT_PLAYER_COLORS | Clean break, pit of success |
| Color themes/skins | Beyond scope of this refactor |
| Per-piece color overrides | Player color is player-level, not piece-level |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 64 | Complete |
| ENG-02 | Phase 64 | Complete |
| ENG-03 | Phase 64 | Complete |
| ENG-04 | Phase 64 | Complete |
| ENG-05 | Phase 64 | Complete |
| ENG-06 | Phase 64 | Complete |
| SESS-01 | Phase 65 | Complete |
| SESS-02 | Phase 65 | Complete |
| SESS-03 | Phase 65 | Complete |
| UI-01 | Phase 66 | Complete |
| UI-02 | Phase 66 | Complete |
| UI-03 | Phase 66 | Complete |
| UI-04 | Phase 66 | Complete |
| UI-05 | Phase 66 | Complete |
| CLN-01 | Phase 67 | Pending |
| CLN-02 | Phase 67 | Pending |
| GAME-01 | Phase 68 | Pending |
| GAME-02 | Phase 68 | Pending |
| GAME-03 | Phase 68 | Pending |
| GAME-04 | Phase 68 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-01-25*
*Last updated: 2026-01-25 after Phase 66 completion*
