# Roadmap: BoardSmith v2.3 Nomenclature Standardization

## Milestone Overview

**Goal:** Consistent terminology across codebase, documentation, and games before external adoption.

**Scope:** 5 phases, 19 requirements

## Phases

### Phase 54: Nomenclature Dictionary

**Goal:** Create the authoritative terminology reference document.

**Requirements:** DICT-01, DICT-02, DICT-03

**Plans:** 1 plan

Plans:
- [x] 54-01-PLAN.md — Create docs/nomenclature.md with all defined terms

**Success Criteria:**
- `docs/nomenclature.md` exists with all defined terms
- Terms organized by category
- Each term has clear definition
- Cross-references where terms relate

**Depends on:** None

---

### Phase 55: GameTable Rename

**Goal:** Rename GameBoard.vue to GameTable.vue everywhere.

**Requirements:** UI-01, UI-02, UI-03, UI-04

**Plans:** 2 plans

Plans:
- [x] 55-01-PLAN.md — Rename GameBoard.vue files in extracted games
- [x] 55-02-PLAN.md — Update CLI templates and documentation

**Success Criteria:**
- No files named `GameBoard.vue` in BoardSmith or extracted games
- All imports reference `GameTable.vue`
- `/design-game` generates `GameTable.vue`
- All 9 extracted games build and run

**Depends on:** Phase 54 (dictionary defines Table)

---

### Phase 56: Position → Seat Rename

**Goal:** Rename player position to seat throughout the API.

**Requirements:** SEAT-01, SEAT-02, SEAT-03, SEAT-04

**Plans:** 5 plans

Plans:
- [x] 56-01-PLAN.md — Core engine: Player.position -> Player.seat
- [x] 56-02-PLAN.md — Session/client/server types update
- [x] 56-03-PLAN.md — UI components and composables update
- [x] 56-04-PLAN.md — Extracted games update (all 9 games)
- [x] 56-05-PLAN.md — Documentation and CLI templates update

**Success Criteria:**
- Player API uses `seat` instead of `position`
- All internal code updated
- Documentation uses "seat" terminology
- All tests pass
- Extracted games updated if they reference position

**Depends on:** Phase 54 (dictionary defines Seat)

---

### Phase 57: Selection → Pick Rename

**Goal:** Rename selection APIs to use pick terminology.

**Requirements:** PICK-01, PICK-02, PICK-03, PICK-04

**Plans:** 4 plans

Plans:
- [x] 57-01-PLAN.md — Engine types + session types + handler rename
- [x] 57-02-PLAN.md — UI composables rename
- [x] 57-03-PLAN.md — Extracted games update (all 9 games)
- [x] 57-04-PLAN.md — Documentation and CLI templates update

**Success Criteria:**
- Selection-related APIs use "pick" terminology
- All internal code updated
- Documentation uses "pick" terminology
- `/design-game` templates use pick terminology
- All tests pass

**Depends on:** Phase 54 (dictionary defines Pick)

---

### Phase 58: Documentation Audit

**Goal:** Ensure all documentation uses standardized terminology.

**Requirements:** DOCS-01, DOCS-02, DOCS-03, DOCS-04

**Success Criteria:**
- All docs/*.md files audited
- Standardized terms used consistently (Table, Board, Zone, Session, etc.)
- Nomenclature.md linked from relevant docs
- Migration guide updated with v2.3 terminology changes

**Depends on:** Phases 54-57 (all renames complete)

---

## Progress

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 54 | Nomenclature Dictionary | 3 | Complete |
| 55 | GameTable Rename | 4 | Complete |
| 56 | Position → Seat | 4 | Complete |
| 57 | Selection → Pick | 4 | Complete |
| 58 | Documentation Audit | 4 | Not started |

**Total:** 5 phases, 19 requirements

---
*Roadmap created: 2026-01-21*
