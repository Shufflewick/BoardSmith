# Roadmap: BoardSmith v2.8 Disabled Selections

## Overview

Add a `disabled` state to element and choice selections so items remain visible but unselectable, with a mandatory reason string. The feature threads through three layers (engine, session, UI) following the existing data flow, then concludes with documentation of the breaking `getChoices()` return type change.

## Phases

- [x] **Phase 75: Engine Core** - Builder methods accept `disabled`, getChoices returns annotated choices, validation enforces disabled state
- [x] **Phase 76: Session Wire** - Wire types carry disabled status, PickHandler threads disabled from engine to protocol
- [x] **Phase 77: UI Integration** - ActionPanel, board interaction, custom UI composables, and fill/auto-fill respect disabled state
- [x] **Phase 78: Documentation** - BREAKING.md and migration guide document the getChoices return type change

## Phase Details

### Phase 75: Engine Core
**Goal**: Game designers can mark choices and elements as disabled with a reason, and the engine correctly evaluates availability and rejects invalid selections
**Depends on**: Nothing (first phase)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06
**Success Criteria** (what must be TRUE):
  1. `chooseElement`, `fromElements`, and `chooseFrom` each accept a `disabled` callback with signature `(item, ctx) => string | false`
  2. `getChoices()` returns `AnnotatedChoice<T>[]` where each item carries `{ value, disabled }` and disabled items appear in the list (not filtered out)
  3. `hasValidSelectionPath()` treats all-disabled as unavailable for required selections, but optional selections remain available when all items are disabled
  4. `validateSelection()` rejects a disabled item with error message `"Selection disabled: <reason>"` containing the specific reason string
**Plans**: 2 plans

Plans:
- [x] 75-01-PLAN.md -- Add AnnotatedChoice type, disabled to selection interfaces, disabled option to builder methods
- [x] 75-02-PLAN.md -- Update getChoices to return AnnotatedChoice[], validation, path checking, internal callers, AI bot, tests

### Phase 76: Session Wire
**Goal**: Disabled status survives the engine-to-UI boundary so the UI layer can render and enforce disabled state without re-evaluating engine logic
**Depends on**: Phase 75
**Requirements**: SES-01, SES-02, SES-03
**Success Criteria** (what must be TRUE):
  1. `ValidElement` includes `disabled?: string` field, present only when the element is disabled (not sent as `undefined` for enabled items)
  2. `ChoiceWithRefs` includes `disabled?: string` field with the same sparse representation
  3. `PickHandler.getPickChoices()` correctly maps engine `AnnotatedChoice` disabled status onto the wire types for both element and choice selections
**Plans**: 1 plan

Plans:
- [x] 76-01-PLAN.md -- Add disabled?: string to wire types, thread disabled in PickHandler, add tests

### Phase 77: UI Integration
**Goal**: Players see disabled items greyed out with reason tooltips in both ActionPanel and custom UIs, cannot select disabled items through any interaction path, and auto-fill correctly skips disabled items
**Depends on**: Phase 76
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09
**Success Criteria** (what must be TRUE):
  1. ActionPanel renders disabled element and choice buttons as visually disabled (`:disabled` attribute) with the reason string as a title tooltip
  2. Board elements that are disabled get CSS class `bs-element-disabled`, and clicking them does nothing (no selection, no error)
  3. Custom UIs can read `disabled?: string` from both `validElements` and `getChoices()`/`getCurrentChoices()` to implement their own disabled rendering
  4. `fill()` rejects disabled values client-side and surfaces the reason string to the user
  5. Auto-fill triggers only when exactly 1 enabled item remains (skips disabled items); if all items are disabled and selection is required, the pick shows as unavailable
**Plans**: 3 plans

Plans:
- [x] 77-01-PLAN.md -- Add disabled?: string to UI-layer types, isDisabledElement() and triggerElementSelect guard in board interaction
- [x] 77-02-PLAN.md -- Add disabled rendering to all ActionPanel button templates and AutoElement bs-element-disabled CSS class
- [x] 77-03-PLAN.md -- Add disabled validation/auto-fill filtering to useActionController, tests

### Phase 78: Documentation
**Goal**: External teams can migrate to v2.8 without surprises by reading the breaking changes and migration guide
**Depends on**: Phase 77
**Requirements**: DOC-01, DOC-02
**Success Criteria** (what must be TRUE):
  1. BREAKING.md v2.8 section documents that `getChoices()` now returns `AnnotatedChoice<T>[]` instead of `T[]`, with before/after code examples
  2. Migration guide covers the return type change and shows how to update existing `getChoices()` call sites (accessing `.value` on each item)
**Plans**: 1 plan

Plans:
- [x] 78-01-PLAN.md -- Add v2.8 section to BREAKING.md and update existing docs for disabled field

## Progress

**Execution Order:**
Phases execute in numeric order: 75 -> 76 -> 77 -> 78

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 75. Engine Core | 2/2 | Verified ✓ | 2026-02-06 |
| 76. Session Wire | 1/1 | Verified ✓ | 2026-02-06 |
| 77. UI Integration | 3/3 | Verified ✓ | 2026-02-06 |
| 78. Documentation | 1/1 | Verified ✓ | 2026-02-06 |
