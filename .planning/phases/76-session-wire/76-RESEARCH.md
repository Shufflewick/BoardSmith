# Phase 76: Session Wire - Research

**Researched:** 2026-02-06
**Domain:** Session layer wire types and pick handler disabled threading
**Confidence:** HIGH

## Summary

Phase 76 threads the `disabled` status from the engine's `AnnotatedChoice<T>` type through the session layer's wire types (`ValidElement`, `ChoiceWithRefs`) so the UI layer can render and enforce disabled state without re-evaluating engine logic. This is a focused, well-scoped phase with exactly three requirements (SES-01, SES-02, SES-03).

The key insight is that the `PickHandler.getPickChoices()` method implements its own parallel choice resolution -- it does NOT delegate to `game.getSelectionChoices()` or `executor.getChoices()`. Instead, it directly accesses `selection.choices`/`selection.elements`/`selection.filter` and builds wire-format responses independently. This means the PickHandler must independently evaluate the `disabled` callback from each selection definition and thread the result into its output types.

The wire representation uses `disabled?: string` (optional, absent when selectable) rather than the engine's `disabled: string | false` (always present). This is the correct sparse representation for network transmission -- no need to send `false` for every selectable item.

**Primary recommendation:** Add `disabled?: string` to both `ValidElement` and `ChoiceWithRefs` in TWO locations (`src/session/types.ts` AND `src/types/protocol.ts`), then update `PickHandler.getPickChoices()` to evaluate the `disabled` callback and include the result in its output. The UI-layer type mirrors in `src/ui/composables/useActionControllerTypes.ts` are a Phase 77 concern.

## Standard Stack

No new libraries needed. This is purely internal type and logic changes.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | existing | Type field additions | Already used throughout |
| Vitest | existing | Tests for disabled threading | Already used for session tests |

## Architecture Patterns

### Data Flow: Engine to UI

```
Engine (action.ts)                      Session (pick-handler.ts)              Wire (types)                UI
getChoices() -> AnnotatedChoice<T>[]    getPickChoices() -> PickChoicesResponse ValidElement/ChoiceWithRefs  ActionPanel
{ value: T, disabled: string|false }    { validElements/choices + disabled? }  { disabled?: string }       { :disabled }
```

The critical boundary is in `PickHandler.getPickChoices()`. This method:
1. Gets the raw selection definition from the action
2. Evaluates choices/elements independently (does NOT call `executor.getChoices()`)
3. Maps to wire types (`ValidElement`, `ChoiceWithRefs`)
4. **NEW**: Must also evaluate `selection.disabled` callback and include result

### Where Types Live (Three Locations)

The wire types are defined in THREE places that need updating:

| Location | Role | Consumers |
|----------|------|-----------|
| `src/session/types.ts` | Session-layer canonical types | `PickHandler`, `GameSession`, server handlers |
| `src/types/protocol.ts` | Protocol-level canonical types | Client SDK, worker |
| `src/ui/composables/useActionControllerTypes.ts` | UI-layer mirror types | Vue components, composables |

Phase 76 updates the first two. Phase 77 updates the third.

### PickHandler Choice Resolution (Current Code)

The PickHandler currently resolves choices independently for each selection type:

**Choice selections** (lines 114-183):
- Evaluates `choiceSel.choices` (function or static array)
- Maps each to `{ value, display, sourceRef?, targetRef? }` (ChoiceWithRefs)
- **Threading point**: After constructing `choice` object, evaluate `choiceSel.disabled` and conditionally add `disabled` field

**Element selections** (lines 186-238):
- Gets elements via `elemSel.elements` or `from`/`filter`/`elementClass` pattern
- Maps to `ValidElement[]` via `#buildValidElementsList()`
- **Threading point**: In `#buildValidElementsList()`, evaluate `elemSel.disabled` and conditionally add `disabled` field

**Elements selections** (lines 241-278):
- Gets elements via `elementsSel.elements`
- Maps to `ValidElement[]` via `#buildValidElementsList()`
- **Threading point**: Same as element -- in `#buildValidElementsList()`

### Pattern: Sparse Disabled on Wire

The engine uses `disabled: string | false` (always present). The wire uses `disabled?: string` (absent when selectable):

```typescript
// Engine AnnotatedChoice<T>
{ value: someElement, disabled: false }          // selectable
{ value: someElement, disabled: "No ammo left" } // disabled

// Wire ValidElement / ChoiceWithRefs
{ id: 42, display: "Grenade" }                   // selectable (no disabled field)
{ id: 42, display: "Grenade", disabled: "No ammo left" } // disabled
```

This transformation is straightforward: only set `disabled` on the wire object when the callback returns a string (not `false`).

### Anti-Patterns to Avoid
- **Do NOT call `executor.getChoices()` from PickHandler**: The PickHandler intentionally duplicates resolution for error handling and formatting. Adding a dependency on the engine's `getChoices()` would create coupling. Thread `disabled` independently by evaluating the callback directly.
- **Do NOT send `disabled: false` on the wire**: Use sparse representation. Only include `disabled` field when the item IS disabled.
- **Do NOT touch UI-layer types in this phase**: `src/ui/composables/useActionControllerTypes.ts` is Phase 77's concern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wire disabled format | Custom encoding | `disabled?: string` (optional field) | Design doc specifies sparse representation |
| Disabled evaluation | New evaluation system | Direct callback invocation `selection.disabled?.(item, ctx)` | Engine already defines the callback signature |
| Context for disabled | New context type | Existing `ctx` already built in PickHandler (`{ game, player, args }`) | Same context shape as `ActionContext` |

## Common Pitfalls

### Pitfall 1: PickHandler Builds Context Differently from Engine
**What goes wrong:** The disabled callback expects `ActionContext` shape (`{ game, player, args }`), but the PickHandler builds a slightly different context object at line 99.
**Why it happens:** PickHandler's `ctx` already has `{ game, player, args }` matching `ActionContext`, but args are resolved differently (element IDs resolved from currentArgs).
**How to avoid:** The existing `ctx` object at line 99 of pick-handler.ts already matches the `ActionContext` shape. Use it directly when calling `selection.disabled?.(item, ctx)`. No new context construction needed.
**Warning signs:** Disabled callback receives undefined args or wrong player.

### Pitfall 2: Three Type Locations Must Stay in Sync
**What goes wrong:** Adding `disabled?: string` to `src/session/types.ts` but forgetting `src/types/protocol.ts` (or vice versa). The types are defined in BOTH places.
**Why it happens:** Historical duplication -- `src/types/protocol.ts` is the "canonical" protocol source, but `src/session/types.ts` has its own definitions for backward compatibility.
**How to avoid:** Update BOTH `ValidElement` and `ChoiceWithRefs` in BOTH files. The interface shapes should be identical.
**Warning signs:** TypeScript doesn't catch this because the types are structurally compatible (adding an optional field doesn't break anything). But consumers of one file won't see the field from the other.

### Pitfall 3: #buildValidElementsList Uses `any` Types
**What goes wrong:** The private `#buildValidElementsList` method takes `elemSel: any` which means TypeScript won't catch if you access `elemSel.disabled` wrong.
**Why it happens:** The method was written before disabled existed and uses `any` for the selection parameter.
**How to avoid:** Access `elemSel.disabled` carefully -- it's `((element, ctx) => string | false) | undefined`. Must check for existence before calling. The `any` type means no compiler help.
**Warning signs:** Runtime error "elemSel.disabled is not a function" if you don't check for undefined.

### Pitfall 4: Choice Selection Has Two Value Shapes
**What goes wrong:** In the choice case (lines 131-162), raw choices can be either plain values OR pre-formatted `{ value, display }` objects (like from `playerChoices()`). The disabled callback receives the `rawValue` (the original value, not the unwrapped one).
**Why it happens:** The PickHandler already handles this dual shape for display purposes. The disabled callback on the engine side also receives the original choice value.
**How to avoid:** Call `choiceSel.disabled?.(rawValue, ctx)` using the `rawValue`, NOT the unwrapped `value`. This matches the engine's behavior where `disabled` receives the same value that `choices` returns.
**Warning signs:** Disabled callback fails because it expects the original object shape but gets an unwrapped value.

### Pitfall 5: DependsOn Choices Must Also Thread Disabled
**What goes wrong:** The `getPickChoices()` method is called for on-demand choice resolution AND for building `choicesByDependentValue`/`elementsByDependentValue` in `buildPickMetadata()`.
**Why it happens:** The `buildPickMetadata` in `utils.ts` currently does NOT evaluate choices (it only includes static metadata). Choices are always fetched on-demand via `getPickChoices()`. So this is actually NOT a concern for Phase 76 -- the on-demand path through `getPickChoices()` is the only path that returns choices.
**How to avoid:** Verify that `buildPickMetadata()` (in `utils.ts`) does NOT need changes. It doesn't evaluate choices, so no disabled threading needed there.
**Warning signs:** None expected -- this is a non-issue.

## Code Examples

### SES-01: ValidElement gains disabled field

```typescript
// Source: Design doc + existing code in src/session/types.ts line 292
// BOTH src/session/types.ts AND src/types/protocol.ts

export interface ValidElement {
  id: number;
  /** Display label for this element */
  display?: string;
  /** Element reference for board highlighting */
  ref?: ElementRef;
  /** Disabled reason string, present only when element is disabled */
  disabled?: string;
}
```

### SES-02: ChoiceWithRefs gains disabled field

```typescript
// Source: Design doc + existing code in src/session/types.ts line 280
// BOTH src/session/types.ts AND src/types/protocol.ts

export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Element reference for source highlighting */
  sourceRef?: ElementRef;
  /** Element reference for target highlighting */
  targetRef?: ElementRef;
  /** Disabled reason string, present only when choice is disabled */
  disabled?: string;
}
```

### SES-03: PickHandler threads disabled for choice selections

```typescript
// In pick-handler.ts, choice case (around line 131-162)
// After constructing the choice object:

const formattedChoices = choices.map(rawValue => {
  // ... existing value/display extraction ...

  const choice: any = { value, display };

  // ... existing boardRefs logic ...

  // NEW: Thread disabled status from engine callback
  if (choiceSel.disabled) {
    const disabledReason = choiceSel.disabled(rawValue, ctx);
    if (disabledReason) {
      choice.disabled = disabledReason;
    }
  }

  return choice;
});
```

### SES-03: PickHandler threads disabled for element selections

```typescript
// In pick-handler.ts, #buildValidElementsList method (around line 298-353)
// After constructing validElem and adding display/ref:

// NEW: Thread disabled status from engine callback
if (elemSel.disabled) {
  const disabledReason = elemSel.disabled(element, ctx);
  if (disabledReason) {
    validElem.disabled = disabledReason;
  }
}

return validElem;
```

Note: `#buildValidElementsList` receives `elemSel: any` so `elemSel.disabled` access works without type issues. The context `ctx` is passed through from the caller.

### SES-03: Context Threading for #buildValidElementsList

The `#buildValidElementsList` currently does NOT receive `ctx` -- it only gets `elements`, `elemSel`, and `ctx`. Wait, re-reading the code... it DOES receive `ctx`:

```typescript
#buildValidElementsList(
  elements: any[],
  elemSel: any,
  ctx: { game: Game; player: Player; args: Record<string, unknown> }
): ValidElement[] {
```

The `ctx` parameter already has the right shape for the disabled callback. No new parameter needed.

## Exact Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/session/types.ts` | Add `disabled?: string` to `ValidElement` (line 292-298) | +1 line |
| `src/session/types.ts` | Add `disabled?: string` to `ChoiceWithRefs` (line 280-287) | +1 line |
| `src/types/protocol.ts` | Add `disabled?: string` to `ValidElement` (line 269-275) | +1 line |
| `src/types/protocol.ts` | Add `disabled?: string` to `ChoiceWithRefs` (line 257-264) | +1 line |
| `src/session/pick-handler.ts` | Thread disabled in choice case (after line 148) | +5 lines |
| `src/session/pick-handler.ts` | Thread disabled in `#buildValidElementsList` (after line 351) | +5 lines |

Total: ~14 lines of code changes across 3 files (4 locations).

## Testing Strategy

There are NO existing PickHandler-specific tests (no `pick-handler.test.ts`). The PickHandler is tested indirectly through integration tests. For this phase, we need:

1. **Unit test for disabled choice threading**: Create a game with a `chooseFrom` that has a `disabled` callback, call `getPickChoices()`, verify the returned `ChoiceWithRefs[]` includes `disabled` on disabled items and omits it on enabled items.

2. **Unit test for disabled element threading**: Create a game with a `chooseElement` or `fromElements` that has a `disabled` callback, call `getPickChoices()`, verify the returned `ValidElement[]` includes `disabled` on disabled items and omits it on enabled items.

3. **Sparse representation test**: Verify that enabled items do NOT have a `disabled` field (not even `undefined`) -- this ensures clean JSON serialization.

The test can follow the pattern of existing session tests like `src/session/animation-events.test.ts` which create a `GameSession` and test through the session API.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No disabled on wire types | `disabled?: string` sparse field | This phase (76) | UI can render disabled state without re-evaluating |
| PickHandler ignores disabled | PickHandler evaluates disabled callback | This phase (76) | Disabled survives engine-to-UI boundary |

## Open Questions

None -- this phase is fully specified by the design document and the prior decisions. All decisions are locked:
- Wire type representation: `disabled?: string` (sparse, optional)
- Callback evaluation: runs the engine's `disabled` callback from each selection
- No new session-level logic: just threading

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/docs/plans/2026-02-05-disabled-selections-design.md` -- Complete design spec
- `/Users/jtsmith/BoardSmith/src/session/pick-handler.ts` -- Current PickHandler (354 lines, fully read)
- `/Users/jtsmith/BoardSmith/src/session/types.ts` -- Current wire types (591 lines, fully read)
- `/Users/jtsmith/BoardSmith/src/types/protocol.ts` -- Protocol types (365 lines, fully read)
- `/Users/jtsmith/BoardSmith/src/engine/action/types.ts` -- Engine types with AnnotatedChoice and disabled callbacks (fully read)
- `/Users/jtsmith/BoardSmith/src/engine/action/action.ts` -- Engine getChoices() implementation (verified post-Phase 75)
- `/Users/jtsmith/BoardSmith/.planning/phases/75-engine-core/75-02-SUMMARY.md` -- Phase 75 completion summary

### Secondary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/session/utils.ts` -- buildActionMetadata/buildPickMetadata (verified: does NOT evaluate choices)
- `/Users/jtsmith/BoardSmith/src/session/game-session.ts` -- GameSession delegates to PickHandler (verified delegation chain)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionControllerTypes.ts` -- UI-layer type mirrors (Phase 77 concern)
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` -- SES-01, SES-02, SES-03 definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No dependencies, pure TypeScript
- Architecture: HIGH -- Complete source code read, all modification points identified with line numbers
- Pitfalls: HIGH -- All dual-location type definitions identified, PickHandler resolution paths fully traced

**Research date:** 2026-02-06
**Valid until:** Stable -- this is internal session code with a locked design document
