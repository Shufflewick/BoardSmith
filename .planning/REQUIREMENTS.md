# Requirements: BoardSmith v2.8

**Defined:** 2026-02-05
**Core Value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

### Engine

- [x] **ENG-01**: `chooseElement` accepts `disabled` option with signature `(element, ctx) => string | false`
- [x] **ENG-02**: `fromElements` accepts `disabled` option with signature `(element, ctx) => string | false`
- [x] **ENG-03**: `chooseFrom` accepts `disabled` option with signature `(choice, ctx) => string | false`
- [x] **ENG-04**: `getChoices()` returns `AnnotatedChoice<T>[]` with `{ value: T, disabled: string | false }`
- [x] **ENG-05**: `hasValidSelectionPath()` only counts items where `disabled === false` (optional selections still available when all disabled)
- [x] **ENG-06**: `validateSelection()` rejects disabled items with `"Selection disabled: <reason>"` error

### Session

- [ ] **SES-01**: `ValidElement` gains `disabled?: string` field
- [ ] **SES-02**: `ChoiceWithRefs` gains `disabled?: string` field
- [ ] **SES-03**: `PickHandler.getPickChoices()` threads disabled status from engine to wire types

### UI

- [ ] **UI-01**: ActionPanel renders disabled element buttons with `:disabled` and title tooltip
- [ ] **UI-02**: ActionPanel renders disabled choice buttons with `:disabled` and title tooltip
- [ ] **UI-03**: `useBoardInteraction` gains `isDisabledElement(element)` returning `string | false`
- [ ] **UI-04**: `useBoardInteraction.triggerElementSelect()` ignores clicks on disabled elements
- [ ] **UI-05**: Disabled board elements get CSS class `bs-element-disabled`
- [ ] **UI-06**: `validElements` computed carries `disabled?: string` for custom UI consumption
- [ ] **UI-07**: `getChoices()` / `getCurrentChoices()` carry `disabled?: string` for custom UI consumption
- [ ] **UI-08**: `fill()` rejects disabled values client-side with reason surfaced to user
- [ ] **UI-09**: Auto-fill skips disabled items (exactly 1 enabled = auto-fill)

### Documentation

- [ ] **DOC-01**: BREAKING.md v2.8 section documents `getChoices()` return type change
- [ ] **DOC-02**: Migration guide updated for v2.8

## v2 Requirements

None -- this is a focused feature milestone.

## Out of Scope

| Feature | Reason |
|---------|--------|
| `disabled` on number/text picks | No use case -- disabled only makes sense for discrete choices |
| Animated disabled state transitions | Over-engineering -- static disabled state is sufficient |
| Server-push of disabled state changes | Disabled is evaluated per-fetch, not reactive |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENG-01 | Phase 75 | Complete |
| ENG-02 | Phase 75 | Complete |
| ENG-03 | Phase 75 | Complete |
| ENG-04 | Phase 75 | Complete |
| ENG-05 | Phase 75 | Complete |
| ENG-06 | Phase 75 | Complete |
| SES-01 | Phase 76 | Pending |
| SES-02 | Phase 76 | Pending |
| SES-03 | Phase 76 | Pending |
| UI-01 | Phase 77 | Pending |
| UI-02 | Phase 77 | Pending |
| UI-03 | Phase 77 | Pending |
| UI-04 | Phase 77 | Pending |
| UI-05 | Phase 77 | Pending |
| UI-06 | Phase 77 | Pending |
| UI-07 | Phase 77 | Pending |
| UI-08 | Phase 77 | Pending |
| UI-09 | Phase 77 | Pending |
| DOC-01 | Phase 78 | Pending |
| DOC-02 | Phase 78 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-05*
*Last updated: 2026-02-06 after Phase 75 completion*
