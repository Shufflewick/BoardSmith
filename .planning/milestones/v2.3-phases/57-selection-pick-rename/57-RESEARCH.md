# Phase 57: Selection -> Pick Rename - Research

**Researched:** 2026-01-22
**Domain:** Terminology Rename (Selection -> Pick)
**Confidence:** HIGH

## Summary

This phase renames "selection" terminology to "pick" throughout the codebase to align with the nomenclature dictionary established in Phase 54. The nomenclature.md document defines:

> **Pick:** A choice that a player must make to complete an action. Picks can select from a list, choose an element, or enter a value.

The rename follows the same pattern as Phase 56 (position -> seat) but is more extensive due to the deep integration of "selection" terminology in the action system, session layer, and UI composables.

**Primary recommendation:** Rename user-facing terminology and public APIs from "selection" to "pick" while keeping internal type names (Selection, SelectionType) for implementation details that don't surface to end users.

## Scope Analysis

### What MUST Be Renamed (User-Facing)

Based on nomenclature.md's note: "Replaces 'selection' in user-facing communication in v2.3."

1. **Documentation strings and prompts** - Any text users see
2. **JSDoc comments** - Developer-facing documentation
3. **Error messages** - User-visible feedback
4. **CLI templates and instructions** - Generator output

### What SHOULD Be Renamed (Public API)

The public API surface uses "selection" extensively:

| Current | Proposed | Location |
|---------|----------|----------|
| `SelectionMetadata` | `PickMetadata` | src/session/types.ts, src/ui/composables/useActionControllerTypes.ts |
| `SelectionFilter` | `PickFilter` | src/session/types.ts |
| `SelectionChoicesResponse` | `PickChoicesResponse` | src/session/types.ts |
| `SelectionStepResult` | `PickStepResult` | src/session/pending-action-manager.ts |
| `SelectionTrace` | `PickTrace` | src/engine/action/types.ts |
| `SelectionDebugInfo` | `PickDebugInfo` | src/engine/action/types.ts |
| `SelectionHandler` | `PickHandler` | src/session/selection-handler.ts |
| `currentSelection` | `currentPick` | useActionController composable |
| `fetchSelectionChoices` | `fetchPickChoices` | useActionController composable |
| `selectionStep` | `pickStep` | useActionController composable |
| `getSelectionChoices` | `getPickChoices` | SelectionHandler class |
| `injectSelectionStepFn` | `injectPickStepFn` | src/ui/index.ts |

### What Should NOT Be Renamed (Internal Types)

Internal type definitions that don't surface to users should remain as-is for implementation clarity:

| Type | Reason to Keep |
|------|----------------|
| `Selection` | Base type union - internal |
| `SelectionType` | Enum values - internal |
| `ChoiceSelection` | Type discriminant - internal |
| `ElementSelection` | Type discriminant - internal |
| `ElementsSelection` | Type discriminant - internal |
| `TextSelection` | Type discriminant - internal |
| `NumberSelection` | Type discriminant - internal |
| `BaseSelection` | Internal base interface |

The nomenclature doc specifically says "user-facing communication" - these type names are implementation details visible only to TypeScript compilation.

## Affected Files

### Tier 1: Core Engine Types (src/engine/action/types.ts)

```
- SelectionTrace -> PickTrace
- SelectionDebugInfo -> PickDebugInfo
- JSDoc comments referencing "selection"
```

### Tier 2: Session Layer (src/session/)

**Files:**
- `types.ts` - SelectionMetadata, SelectionFilter, SelectionChoicesResponse
- `selection-handler.ts` - Class name, method names, file name
- `pending-action-manager.ts` - SelectionStepResult
- `game-session.ts` - Method references
- `index.ts` - Exports

**Proposed renames:**
- `SelectionMetadata` -> `PickMetadata`
- `SelectionFilter` -> `PickFilter`
- `SelectionChoicesResponse` -> `PickChoicesResponse`
- `SelectionStepResult` -> `PickStepResult`
- `selection-handler.ts` -> `pick-handler.ts`
- `SelectionHandler` -> `PickHandler`
- `getSelectionChoices()` -> `getPickChoices()`

### Tier 3: UI Composables (src/ui/)

**Files:**
- `composables/useActionControllerTypes.ts`
- `composables/useActionController.ts`
- `composables/useActionController.helpers.ts`
- `composables/useActionController.selections.test.ts` (filename)
- `index.ts` - Exports

**Proposed renames:**
- `SelectionMetadata` -> `PickMetadata` (re-exported type)
- `SelectionSnapshot` -> `PickSnapshot`
- `SelectionStepResult` -> `PickStepResult`
- `SelectionChoicesResult` -> `PickChoicesResult`
- `currentSelection` -> `currentPick`
- `fetchSelectionChoices` -> `fetchPickChoices`
- `selectionStep` -> `pickStep`
- `fetchChoicesForSelection` -> `fetchChoicesForPick`
- `injectSelectionStepFn` -> `injectPickStepFn`
- Test file: `useActionController.selections.test.ts` -> `useActionController.picks.test.ts`

### Tier 4: Documentation (docs/)

**Files with "selection" references:**
- `docs/nomenclature.md` - Already updated (defines Pick)
- `docs/core-concepts.md` - "selections" in action context
- `docs/custom-ui-guide.md` - Selection UI patterns
- `docs/actions-and-flow.md` - Selection methods
- `docs/api/index.md` - API documentation
- `docs/api/ui.md` - UI exports
- `docs/api/session.md` - Session exports
- `docs/common-pitfalls.md` - Selection pitfalls

### Tier 5: CLI Templates (src/cli/slash-command/)

**Files:**
- `instructions.md` - Selection references in templates
- `aspects/square-grid.md` - currentSelection usage
- `aspects/playing-cards.md` - chooseElement selections

### Tier 6: Extracted Games (packages/games/)

Based on grep results, the extracted games use selection-related APIs:
- `checkers/ui/src/components/CheckersBoard.vue`
- `cribbage/ui/src/components/CribbageBoard.vue`
- `go-fish/ui/src/components/GoFishBoard.vue`
- `polyhedral-potions/ui/src/components/DiceShelf.vue`
- Various rules files referencing action selections

## Architecture Patterns

### Pattern 1: Layered Rename (Same as Phase 56)

Following the successful pattern from Phase 56 (position -> seat):

1. **Tier 1: Engine types** - Internal action types
2. **Tier 2: Session layer** - Public API types and handlers
3. **Tier 3: UI layer** - Composables and components
4. **Tier 4: Documentation** - User-facing docs
5. **Tier 5: CLI templates** - Code generation
6. **Tier 6: Extracted games** - External packages

### Pattern 2: Parameter Name Stability

From Phase 56 decision:
> "Keep playerPosition parameter names in session methods for API stability - only updated JSDoc to clarify"

Apply same pattern: Keep internal parameter names like `selectionName` but update JSDoc to clarify these refer to "picks."

### Pattern 3: Deprecation Aliases

Consider adding type aliases for backward compatibility:

```typescript
// Backward compatibility (deprecated)
/** @deprecated Use PickMetadata instead */
export type SelectionMetadata = PickMetadata;
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Find/replace | Manual text editing | Structured rename with TypeScript | Ensures type safety |
| Export aliases | Copy types | `export type X = Y` | Single source of truth |
| Test updates | Manual edits | Run tests, fix failures | Catches hidden usages |

## Common Pitfalls

### Pitfall 1: Incomplete Rename

**What goes wrong:** Missing some references leads to mixed terminology
**Why it happens:** "selection" is used extensively throughout codebase
**How to avoid:** Systematic grep search after each tier
**Warning signs:** TypeScript errors about missing types

### Pitfall 2: Breaking External Games

**What goes wrong:** Extracted games fail to compile
**Why it happens:** They import selection-related types
**How to avoid:** Update all games in same commit
**Warning signs:** Build failures in packages/games

### Pitfall 3: CLI Template Drift

**What goes wrong:** New projects generated with old terminology
**Why it happens:** Templates not updated
**How to avoid:** Test `npx boardsmith init` after changes
**Warning signs:** Generated code uses "selection"

### Pitfall 4: Documentation Inconsistency

**What goes wrong:** Docs say "pick" but code examples say "selection"
**Why it happens:** Partial doc updates
**How to avoid:** Update code blocks in docs too
**Warning signs:** Confused users

## Code Examples

### Current API (Selection)

```typescript
// Session types
interface SelectionMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'number' | 'text';
  prompt?: string;
  choices?: ChoiceWithRefs[];
  validElements?: ValidElement[];
}

// Action controller
const { currentSelection, fetchSelectionChoices } = useActionController({
  selectionStep: async (player, selectionName, value, actionName) => { ... }
});
```

### Proposed API (Pick)

```typescript
// Session types
interface PickMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'number' | 'text';
  prompt?: string;
  choices?: ChoiceWithRefs[];
  validElements?: ValidElement[];
}

// Action controller
const { currentPick, fetchPickChoices } = useActionController({
  pickStep: async (player, pickName, value, actionName) => { ... }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "selection" terminology | "pick" terminology | v2.3 (this phase) | User clarity |

**Deprecated/outdated:**
- `SelectionMetadata` - Use `PickMetadata`
- `currentSelection` - Use `currentPick`
- `selectionStep` - Use `pickStep`

## Implementation Order

Based on Phase 56's successful approach:

### Plan 01: Engine Types and Session Types
1. Update `src/engine/action/types.ts` (SelectionTrace, SelectionDebugInfo)
2. Update `src/session/types.ts` (SelectionMetadata, SelectionFilter, SelectionChoicesResponse)
3. Rename `selection-handler.ts` to `pick-handler.ts`
4. Update exports in `src/session/index.ts`

### Plan 02: UI Layer
1. Update `src/ui/composables/useActionControllerTypes.ts`
2. Update `src/ui/composables/useActionController.ts` (currentSelection -> currentPick, etc.)
3. Rename test file
4. Update `src/ui/index.ts` exports

### Plan 03: External Games
1. Update all packages/games/* that use selection APIs
2. Verify builds pass

### Plan 04: Documentation
1. Update `docs/core-concepts.md`
2. Update `docs/custom-ui-guide.md`
3. Update `docs/actions-and-flow.md`
4. Update API docs

### Plan 05: CLI Templates
1. Update `src/cli/slash-command/instructions.md`
2. Update aspect templates
3. Test `npx boardsmith init`

## Open Questions

1. **Backward Compatibility Duration**
   - How long should deprecated type aliases be kept?
   - Recommendation: Add deprecation notices, remove in v3.0

2. **Internal Parameter Names**
   - Should `selectionName` parameters be renamed to `pickName`?
   - Recommendation: Keep parameter names, update JSDoc (per Phase 56 precedent)

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/docs/nomenclature.md` - Official terminology definition
- `/Users/jtsmith/BoardSmith/.planning/phases/56-position-seat-rename/56-02-SUMMARY.md` - Prior rename pattern

### Codebase Analysis (HIGH confidence)
- `src/engine/action/types.ts` - Core action types
- `src/session/types.ts` - Session layer types
- `src/session/selection-handler.ts` - Selection handler implementation
- `src/ui/composables/useActionController*.ts` - UI composables
- `src/ui/index.ts` - UI exports

## Metadata

**Confidence breakdown:**
- File identification: HIGH - grep/glob comprehensive search
- Rename scope: HIGH - based on nomenclature.md definition
- Implementation pattern: HIGH - follows Phase 56 precedent

**Research date:** 2026-01-22
**Valid until:** N/A (internal refactoring, no external dependencies)
