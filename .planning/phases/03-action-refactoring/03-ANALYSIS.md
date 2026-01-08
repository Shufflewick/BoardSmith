# Phase 3 Analysis: action.ts Refactoring

## Overview

Target file: `packages/engine/src/action/action.ts` (1,845 lines)

**Current module structure:**
- `action.ts` - 1,845 lines (main file, target for refactoring)
- `types.ts` - 563 lines (already extracted)
- `helpers.ts` - 310 lines (already extracted)
- `index.ts` - re-exports

## Current action.ts Structure

| Section | Lines | Description |
|---------|-------|-------------|
| Imports | 1-26 | Type imports from types.ts |
| Dev utilities | 27-51 | isDevMode(), shownWarnings Set, devWarn() |
| ConditionTracer | 52-112 | Debug tracing helper class |
| Filter wrapper | 114-166 | wrapFilterWithHelpfulErrors() |
| Action class | 168-509 | Fluent builder API (~341 lines) |
| ActionExecutor | 511-1845 | Main executor class (~1,334 lines) |

### ActionExecutor Internal Structure

| Method Group | Lines | Responsibility |
|--------------|-------|----------------|
| resolveArgs | 529-636 | Deserialize network args to objects |
| looksLikeSerializedElement | 643-647 | Element ID detection |
| isSerializedElement | 652-656 | Serialized element validation |
| extractChoiceValue | 669-694 | Choice value extraction |
| getChoices | 699-807 | Get available choices for selection |
| shouldSkip (deprecated) | 815-822 | Auto-skip logic (now UI-handled) |
| valuesEqual | 827-835 | Object equality |
| choicesContain | 840-842 | Choice membership |
| trySmartResolveChoice | 855-901 | Smart choice resolution |
| smartResolveChoiceValue | 909-949 | Value resolution |
| formatValidChoices | 954-973 | Error message formatting |
| validateSelection | 978-1111 | Single selection validation |
| validateAction | 1116-1156 | Full action validation |
| executeAction | 1161-1193 | Execute action handler |
| isActionAvailable | 1200-1213 | Check if action available |
| traceActionAvailability | 1219-1259 | Debug tracing |
| traceSelectionPath | 1265-1337 | Selection path tracing |
| getChoiceFilterValue | 1342-1347 | Filter value extraction |
| hasDependentSelection | 1352-1372 | Dependency detection |
| hasValidSelectionPath | 1384-1504 | Recursive availability check |
| isRepeatingSelection | 1513-1527 | Detect repeating config |
| hasRepeatingSelections | 1532-1534 | Action has repeating |
| processRepeatingStep | 1548-1702 | Process repeat iteration |
| formatElementChoices | 1708-1751 | Format elements for UI |
| createPendingActionState | 1756-1763 | Create pending state |
| processSelectionStep | 1769-1805 | Process single selection |
| isPendingActionComplete | 1810-1812 | Check completion |
| executePendingAction | 1817-1844 | Execute pending action |

## Extraction Analysis

### Strategy: Follow Phase 2 Pattern

Phase 2 showed that over-aggressive extraction fragments tightly-coupled code. Key learnings:
1. Types were already well-separated → extracted successfully
2. Pure helpers → extracted successfully
3. Stateful/interconnected code → kept together

For action.ts, we should follow the same pattern:
1. **Dev utilities** → Already small (25 lines), extraction optional
2. **ConditionTracer** → Already a clean class (60 lines), can extract
3. **Action builder** → Clean, well-defined (341 lines) → could be own file
4. **ActionExecutor** → Large (1,334 lines) but tightly coupled

### ActionExecutor Coupling Analysis

The ActionExecutor methods are highly interconnected:

```
executeAction → resolveArgs → isSerializedElement, looksLikeSerializedElement
             → validateAction → validateSelection → getChoices
                                                   → choicesContain, valuesEqual
                                                   → formatValidChoices

isActionAvailable → hasValidSelectionPath → getChoices
                                          → hasDependentSelection

processRepeatingStep → getChoices
                     → resolveArgs
                     → formatElementChoices
```

**Verdict**: ActionExecutor is a cohesive unit. Splitting it would create many cross-file dependencies and hurt readability.

### Recommended Extractions

Based on analysis, recommend extracting only clean boundaries:

1. **ConditionTracer class** → `condition-tracer.ts` (~60 lines)
   - Self-contained debug helper
   - No dependencies on ActionExecutor
   - Clear single responsibility

2. **Dev utilities** → `action-dev-utils.ts` (~25 lines)
   - isDevMode(), devWarn(), shownWarnings
   - Pure utilities, no dependencies
   - Already used by wrapFilterWithHelpfulErrors

3. **Action builder class** → `action-builder.ts` (~341 lines)
   - Clean fluent API builder
   - Only creates ActionDefinition objects
   - No runtime dependencies on ActionExecutor

This leaves ActionExecutor at ~1,400 lines, which is acceptable given its cohesive responsibilities.

### Alternative: Keep As-Is with Better Organization

The file already has clear section comments. An alternative is to:
- Add better internal organization (region comments)
- Extract only ConditionTracer (most independent)
- Document the method groups

## Recommendation

**Level 0 - Skip** or **Minimal extraction**

The action.ts file is fundamentally different from game-session.ts and useActionController.ts:
- Already has types in separate file (563 lines)
- Already has helpers in separate file (310 lines)
- The remaining code is tightly coupled around ActionExecutor

**Recommended approach:**
1. Extract ConditionTracer → `condition-tracer.ts`
2. Extract dev utilities → move to existing helpers.ts or new file
3. Optionally extract Action builder → `action-builder.ts`
4. Keep ActionExecutor intact

This gives a ~400 line reduction while preserving cohesion.

## Revised Plan Structure

Given the analysis, Phase 3 should have:

- **03-01**: Analyze and create analysis document (this document)
- **03-02**: Extract ConditionTracer and dev utilities
- **03-03**: Extract Action builder class (if beneficial)
- **03-04**: Verify and clean up

However, if the extraction doesn't provide meaningful value (ActionExecutor stays at ~1,400 lines), we should consider marking Phase 3 as "minimal changes" and document why aggressive extraction was avoided.
