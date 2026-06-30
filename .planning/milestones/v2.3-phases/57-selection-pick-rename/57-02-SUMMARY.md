---
phase: 57
plan: 02
subsystem: ui
tags: [refactor, rename, types, backward-compatibility]
depends_on:
  requires: [57-01]
  provides: [ui-pick-types, deprecated-aliases]
  affects: [57-03, 57-04, 57-05]
tech_stack:
  patterns:
    - deprecated-type-aliases
    - backward-compatible-refactoring
key_files:
  modified:
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useActionController.ts
    - src/ui/composables/actionControllerHelpers.ts
    - src/ui/composables/useGameViewEnrichment.ts
    - src/ui/composables/useBoardInteraction.ts
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/index.ts
    - src/ui/index.ts
    - src/ui/types.ts
decisions:
  - id: deprecated-aliases
    choice: "Add deprecated type aliases instead of just renaming"
    why: "Maintains backward compatibility for existing consumer code"
  - id: keep-selection-template-vars
    choice: "Keep currentSelection as template variable alias in ActionPanel"
    why: "Template uses 'currentSelection' extensively - changing would create churn"
metrics:
  duration: 10m
  completed: 2026-01-22
---

# Phase 57 Plan 02: UI Layer Pick Types Rename Summary

**One-liner:** Renamed Selection types to Pick in UI layer with deprecated aliases for backward compatibility.

## What Changed

### Type Renames in useActionControllerTypes.ts
| Old Name | New Name | Purpose |
|----------|----------|---------|
| SelectionMetadata | PickMetadata | Pick metadata from server |
| SelectionStepResult | PickStepResult | Result from repeating pick step |
| SelectionChoicesResult | PickChoicesResult | Result from fetching pick choices |
| SelectionSnapshot | PickSnapshot | Frozen snapshot of pick's choices |
| CollectedSelection | CollectedPick | Collected pick value with display |

### Internal Field Renames in ActionStateSnapshot
- `selectionSnapshots` -> `pickSnapshots`
- `collectedSelections` -> `collectedPicks`

### API Surface Changes in useActionController
| Old API | New API | Location |
|---------|---------|----------|
| currentSelection | currentPick | Return object |
| fetchChoicesForSelection | fetchChoicesForPick | Return object |
| fetchSelectionChoices (option) | fetchPickChoices (option) | Options |
| selectionStep (option) | pickStep (option) | Options |
| SelectionStepFn | PickStepFn | Type export |
| injectSelectionStepFn | injectPickStepFn | Helper function |

### useBoardInteraction Changes
| Old API | New API |
|---------|---------|
| currentSelectionIndex | currentPickIndex |
| currentSelectionName | currentPickName |
| setCurrentSelection | setCurrentPick |

### Public API Exports (index.ts)
All Pick* types are now exported as primary, with Selection* as deprecated aliases.

## Backward Compatibility

All old names remain available as deprecated type aliases:
```typescript
/** @deprecated Use PickMetadata instead */
export type SelectionMetadata = PickMetadata;
```

Existing code continues to work unchanged. TypeScript will show deprecation warnings in IDEs.

## Verification

- All 79 UI tests pass
- TypeScript compilation successful
- Deprecated aliases work for backward compatibility

## Commits

| Hash | Description |
|------|-------------|
| f6c48f7 | Rename Selection to Pick types with deprecated aliases |
| 6e5b34b | Update useActionController implementation for Pick naming |
| f681770 | Update helper files to use PickMetadata |
| 4fac639 | Add Pick aliases to useBoardInteraction |
| 69c6d25 | Update ActionPanel.vue to use PickMetadata |
| c8bdc2d | Update public API exports for Pick naming |

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

Ready for Plan 03 (GameShell and remaining components) with:
- All type aliases in place
- Internal usage updated to Pick terminology
- Public API maintains backward compatibility
