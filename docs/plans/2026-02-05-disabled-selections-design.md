# Disabled Selections Design

## Problem

When using `chooseElement`, `fromElements`, or `chooseFrom` in action definitions, the `filter` function only supports two states: included (visible + selectable) or excluded (hidden). There's no way to show an item as visible but disabled/unselectable.

**Use case (MERC):** The character Apeiron has a passive ability preventing grenade/mortar use. Currently, these items are hidden from equipment selection. The desired UX is to show them greyed out with a tooltip explaining why they can't be selected.

## API Design

### Builder Methods

All three selection builder methods gain a `disabled` option:

```ts
// chooseElement / fromElements
disabled?: (element: T, context: ActionContext) => string | false

// chooseFrom
disabled?: (choice: T, context: ActionContext) => string | false
```

- Returns `false` if selectable
- Returns a reason string if disabled (must explain why)
- No bare `true` allowed — forces good UX (pit of success)

### Separation of Concerns

- **`filter`** = what's in the pool (visibility/scoping)
- **`disabled`** = what's selectable within that pool

`disabled` only runs on items that passed `filter`. No hidden precedence rules.

```ts
// MERC example
.fromElements('equipment', {
  elements: (ctx) => stash.all(Equipment),
  filter: (e) => e.location === 'stash',
  disabled: (e) => e.isExplosive ? "Apeiron cannot use explosives" : false,
})
```

## Engine Layer

### AnnotatedChoice Type

```ts
type AnnotatedChoice<T> = {
  value: T
  disabled: string | false
}
```

`display` is not included — it's layered on by the session/UI layers.

### getChoices()

Returns `AnnotatedChoice<T>[]` — all items that pass filter, each annotated with disabled status. This is a **breaking change** from the previous `T[]` return type.

### hasValidSelectionPath()

Only counts items where `disabled === false`. If all items are disabled:
- **Required selection:** action is unavailable
- **Optional selection:** action remains available (player can skip)

### validateSelection()

When a disabled item is submitted, rejects with: `"Selection disabled: <reason>"` — includes the specific reason from the `disabled` callback, not a generic error.

## Session Layer

### Wire Types

```ts
// ValidElement (element selections)
{
  id: number
  display?: string
  ref?: ElementRef
  disabled?: string   // reason, absent if selectable
}

// ChoiceWithRefs (choice selections)
{
  value: unknown
  display: string
  sourceRef?: ElementRef
  targetRef?: ElementRef
  disabled?: string   // reason, absent if selectable
}
```

Using `disabled?: string` (optional) rather than `disabled: string | false` — no need to send `false` over the network for every selectable item.

### PickHandler

`getPickChoices()` maps engine `AnnotatedChoice` disabled status onto wire types. No new session logic — just threading.

## UI Layer

### ActionPanel

- Disabled element/choice buttons get `:disabled="true"` and `title` attribute with reason (native tooltip)
- CSS class `bs-choice-disabled` for styling
- Standard HTML disabled behavior prevents clicks

### useBoardInteraction

- `isDisabledElement(element): string | false` — returns reason if disabled, `false` if selectable
- `triggerElementSelect()` ignores clicks on disabled elements
- Disabled elements get CSS class `bs-element-disabled`

### Custom UI (useActionController)

- `validElements` computed carries `disabled?: string` on each item
- `getChoices()` / `getCurrentChoices()` carry `disabled?: string` on each choice
- Custom UIs read `item.disabled` to render however they want

### fill()

Rejects disabled values client-side with the reason surfaced to the user through the existing error display mechanism.

### Auto-fill

Skips disabled items. Exactly 1 enabled item = auto-fill. All disabled + required = unavailable. No change to auto-fill logic itself — just what counts as "valid."

## Breaking Changes

- `getChoices()` returns `AnnotatedChoice<T>[]` instead of `T[]`
- Callers accessing choices directly need to use `.value` on each item
