# Requirements: BoardSmith v2.3 Nomenclature Standardization

**Defined:** 2026-01-21
**Core Value:** Consistent terminology across the entire codebase before external adoption

## v1 Requirements

### Dictionary (DICT)

- [x] **DICT-01**: Create `docs/nomenclature.md` as the authoritative terminology reference
- [x] **DICT-02**: Dictionary includes all defined terms with definitions
- [x] **DICT-03**: Dictionary organized by category (Core, Players, Flow, Elements, Zones, Actions, etc.)

### UI Rename (UI)

- [x] **UI-01**: Rename `GameBoard.vue` → `GameTable.vue` in BoardSmith UI components (N/A: no GameBoard.vue in core UI)
- [x] **UI-02**: Update all imports/references to GameBoard in BoardSmith source
- [x] **UI-03**: Update `/design-game` templates to generate `GameTable.vue`
- [x] **UI-04**: Rename `GameBoard.vue` → `GameTable.vue` in all 9 extracted games (4 games had GameBoard.vue)

### API Rename - Seat (SEAT)

- [x] **SEAT-01**: Rename `position` → `seat` in Player class/types
- [x] **SEAT-02**: Update all internal references to player position
- [x] **SEAT-03**: Update documentation references to position
- [x] **SEAT-04**: Update extracted games that reference player position

### API Rename - Pick (PICK)

- [x] **PICK-01**: Rename selection-related APIs to use "pick" terminology
- [x] **PICK-02**: Update internal references to selection
- [x] **PICK-03**: Update documentation references to selection
- [x] **PICK-04**: Update `/design-game` templates for pick terminology

### Documentation (DOCS)

- [ ] **DOCS-01**: Audit all docs/*.md files for terminology consistency
- [ ] **DOCS-02**: Update docs to use standardized terms (Table, Board, Zone, etc.)
- [ ] **DOCS-03**: Add nomenclature.md reference link to relevant docs
- [ ] **DOCS-04**: Update migration guide with terminology changes

## Out of Scope

| Feature | Reason |
|---------|--------|
| Renaming `boardsmith/session` module | Would break imports; Session as instance name is fine |
| Renaming `Game` base class to `Rules` | Too disruptive; Game is acceptable |
| Defining game-specific terms (capture, market) | Not universal enough |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DICT-01 | Phase 54 | Complete |
| DICT-02 | Phase 54 | Complete |
| DICT-03 | Phase 54 | Complete |
| UI-01 | Phase 55 | Complete |
| UI-02 | Phase 55 | Complete |
| UI-03 | Phase 55 | Complete |
| UI-04 | Phase 55 | Complete |
| SEAT-01 | Phase 56 | Complete |
| SEAT-02 | Phase 56 | Complete |
| SEAT-03 | Phase 56 | Complete |
| SEAT-04 | Phase 56 | Complete |
| PICK-01 | Phase 57 | Complete |
| PICK-02 | Phase 57 | Complete |
| PICK-03 | Phase 57 | Complete |
| PICK-04 | Phase 57 | Complete |
| DOCS-01 | Phase 58 | Pending |
| DOCS-02 | Phase 58 | Pending |
| DOCS-03 | Phase 58 | Pending |
| DOCS-04 | Phase 58 | Pending |

**Coverage:**
- v1 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-21*
