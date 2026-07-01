---
phase: 117-action-space-introspection
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/engine/element/action-metadata.ts
  - src/engine/element/game.ts
  - src/engine/utils/enumerate-moves.ts
  - src/engine/utils/arg-builder.ts
  - src/ai/mcts-bot.ts
  - src/session/utils.ts
  - src/session/index.ts
  - src/engine/index.ts
  - src/engine/utils/index.ts
  - src/engine/element/index.ts
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 117: Code Review Report

**Reviewed:** 2026-06-30
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 117 introduces the action-space introspection API (INTRO-01..05 + INTRO-F1):
`getActionSpace` / `getActionSchema` on `Game`, `buildActionMetadata` relocated from
`session/utils.ts` to `src/engine/element/action-metadata.ts`, `enumerateLegalMoves`
extracted into `src/engine/utils/enumerate-moves.ts`, and `buildActionArgs` added as
INTRO-03.

**Hidden-information leakage:** No leakage found. `buildActionMetadata` and
`buildPickMetadata` expose only static schema metadata (type, prompt, dependsOn,
class names). No choices, element IDs, or attributes are emitted here; those stay on
the on-demand `/selection-choices` path. The `elementClassName` field is the CLASS
name (`"Card"`, `"Piece"`), not an element ID or attribute value.

**MCTS extraction:** The delegation chain — `enumerateSelectionsCore` → `_getChoices`
→ `game.getSelectionChoices` → filter `c.disabled === false` → `serializeArgs` — is a
faithful extraction of what the old inline bot code performed. Serialization (element
objects → raw numeric IDs) correctly happens AFTER full recursive enumeration,
preserving the invariant that dependent selections receive live element objects during
recursion.

**Function relocation:** The move of `buildActionMetadata` + `buildPickMetadata` from
`session/utils.ts` to `engine/element/action-metadata.ts` is architecturally correct.
The session import in `action-metadata.ts` is type-only (`import type { ActionMetadata,
PickMetadata } from '../../session/types.js'`) — no runtime cycle introduced.
`session/utils.ts` re-exports both functions so all existing consumers are unaffected.

One confirmed behavioral bug was found: the brand-new `getActionSchema` method silently
violates its own documented contract. Five additional quality/robustness warnings are
noted.

---

## Critical Issues

### CR-01: `getActionSchema` contradicts its own documented contract — returns `undefined` when condition is false

**File:** `src/engine/element/game.ts:1056–1062`

**Issue:** The JSDoc at line 1048–1049 explicitly promises:
> "Unlike `getActionSpace`, this does NOT filter by availability — it returns
> **the schema even for actions whose condition is currently false** (mirrors
> `buildSingleActionMetadata` semantics)."

The implementation delegates to `buildActionMetadata`:
```typescript
const metadata = buildActionMetadata(this, player, [actionName]);
return metadata[actionName];
```

`buildActionMetadata` (action-metadata.ts:44–53) evaluates the action's condition and
calls `continue` (skips the action) when the condition is false. As a result,
`metadata[actionName]` is `undefined` whenever the condition is currently false, and
`getActionSchema` returns `undefined` — exactly the opposite of what is promised.

Callers cannot distinguish "action doesn't exist" from "action exists but condition is
false", making it impossible to inspect a conditionally-disabled action's schema (e.g.
for grayed-out UI, tutorial overlays, or agent introspection of the full action space).
The stated model was `buildSingleActionMetadata` semantics, which intentionally skips
condition evaluation. The implementation must match.

**Fix:** Replace `buildActionMetadata` with `buildSingleActionMetadata` logic (no
condition check) directly in `getActionSchema`, or expose the skip-condition path from
`action-metadata.ts`. The simplest correct implementation mirrors
`buildSingleActionMetadata` in `session/utils.ts`:

```typescript
// src/engine/element/game.ts
getActionSchema(actionName: string, seat: number): ActionMetadata | undefined {
  const player = this.getPlayer(seat);
  if (!player) return undefined;

  const actions = this._actions;
  const actionDef = actions.get(actionName);
  if (!actionDef) return undefined;

  // Intentionally skip condition check — returns schema regardless of availability.
  // Use getActionSpace() when you need condition-filtered actions only.
  const selections = actionDef.selections.map(sel =>
    buildPickMetadata(this, player, sel)
  );
  return {
    name: actionName,
    prompt: actionDef.prompt,
    help: actionDef.help,
    selections,
  };
}
```

Alternatively, add a `skipConditionCheck?: boolean` option to `buildActionMetadata` so
the behaviour is centralised. Either way, the JSDoc must match the implementation.

---

## Warnings

### WR-01: `buildActionArgs` silently ignores required selections — downstream errors are unactionable

**File:** `src/engine/utils/arg-builder.ts:64–70`

**Issue:** The function validates that no UNKNOWN keys appear in `selectionValues`, but
it does NOT validate that all REQUIRED (non-optional) selections are present. A caller
who omits a required arg receives no error from `buildActionArgs`; the failure surfaces
only inside `performAction` / the action executor, with a message that doesn't mention
`buildActionArgs` or which required key was missing.

CLAUDE.md rule: "Error messages should be actionable."

**Fix:** After building `validNames`, iterate the action's selections and check each
non-optional selection is present:

```typescript
// After the unknown-key validation loop:
for (const sel of actionDef.selections) {
  if (!sel.optional && !(sel.name in selectionValues)) {
    throw new Error(
      `buildActionArgs: required selection "${sel.name}" not provided for action "${actionName}". ` +
      `Required selections: ${actionDef.selections.filter(s => !s.optional).map(s => s.name).join(', ')}.`,
    );
  }
}
```

---

### WR-02: `buildActionArgs` `_seat` parameter is required by callers but silently discarded

**File:** `src/engine/utils/arg-builder.ts:48`

**Issue:** The `_seat: number` parameter appears in the public signature (callers must
supply it) and is documented "reserved for future per-seat validation", but the
underscore prefix and zero usage mean any value — including `0`, `-1`, or a wrong seat
— passes silently. When per-seat validation is eventually added, all existing callers
will have been passing unvalidated values for potentially a long time with no feedback.

This violates the "Pit of Success" principle: making wrong usage impossible should be
the design goal, not documenting that a parameter is ignored.

**Fix:** Either (a) remove `_seat` now and add it back as an optional parameter when
it's actually used, or (b) validate the range immediately so callers learn early:

```typescript
// Option A — remove until needed (preferred per Pit of Success):
export function buildActionArgs(
  actionName: string,
  selectionValues: Record<string, unknown>,
  game: Game,
  options?: BuildActionArgsOptions,
): Record<string, unknown>

// Option B — validate range if the parameter must stay:
if (_seat < 1) {
  throw new Error(`buildActionArgs: seat must be 1-indexed (got ${_seat})`);
}
```

---

### WR-03: Function-based `multiSelect` silently degrades to `{min:1, max:Infinity}` enumeration in `enumerateLegalMoves`

**File:** `src/engine/utils/enumerate-moves.ts:190–199`

**Issue:** Inside `_enumerateRecursive`, when a selection's `multiSelect` value is a
function (dynamic multiSelect configured by the game author), `parseMultiSelect`
receives a function argument. `typeof fn === 'function'` matches neither the `number`
nor the `object` branch, so `parseMultiSelect` falls through and returns
`{ min: 1, max: Infinity }`. The enumeration then generates ALL non-empty subsets of
the choice array — for N choices that is 2^N − 1 combinations per action slot. No
warning is emitted.

For example, a selection with 12 board cells and a function-based multiSelect would
produce 4,095 arg combinations for that one selection alone, silently blowing the MCTS
branching factor or freezing an agent caller.

Note: `buildPickMetadata` already acknowledges this case and notes "it will be
evaluated when fetching choices." The enumeration path needs the same awareness.

**Fix:** Detect the function case explicitly and either skip the selection (treating it
like an unenumerable `text` selection) or warn loudly:

```typescript
// In _enumerateRecursive, before the multiSelect branch:
const multiSelect = (selection as any).multiSelect;
if (typeof multiSelect === 'function') {
  // Dynamic multiSelect cannot be enumerated statically.
  // Treat like a required non-enumerable selection: no legal combos.
  if (!selection.optional) return [];
  return _enumerateRecursive(game, actionDef, player, index + 1, currentArgs);
}
if (multiSelect) { ... }
```

---

### WR-04: Condition evaluation errors are silently swallowed in `buildActionMetadata`

**File:** `src/engine/element/action-metadata.ts:50–53`

**Issue:**
```typescript
} catch (error) {
  console.error(`[buildActionMetadata] Error checking condition for "${actionName}":`, error);
  continue; // Skip on error
}
```

A bug in a game author's condition function causes the action to silently disappear
from the UI. Only a `console.error` is emitted, which may be suppressed in production.
The author sees no obvious cause; the action just stops appearing. CLAUDE.md: "Fail
fast and loud, not silently."

This is especially treacherous because `buildActionMetadata` is called on every
state broadcast for every connected player.

**Fix:** Re-throw the error (or wrap it) so callers see a clear, actionable failure
rather than a missing action:

```typescript
} catch (error) {
  throw new Error(
    `[buildActionMetadata] Condition for action "${actionName}" threw an error. ` +
    `Fix the condition function before this action can be used.\n` +
    `Original error: ${error instanceof Error ? error.message : String(error)}`,
  );
}
```

If swallowing is intentional for resilience, at minimum the `console.error` should
carry enough context to reproduce the issue (game state snapshot, player seat).

---

### WR-05: `serializeChoice` accesses `_t.id` (internal tree-node) for `element` type, `.id` (public getter) for `elements` type

**File:** `src/ai/mcts-bot.ts:954–961`

**Issue:**
```typescript
private serializeChoice(choice: unknown, selection: Selection): unknown {
  if (selection.type === 'element') {
    return (choice as { _t: { id: number } })._t.id;   // internal path
  }
  if (selection.type === 'elements') {
    return (choice as { id: number }).id;               // public getter
  }
  return choice;
}
```

Both access the same underlying integer (`GameElement.id` is a getter that returns
`this._t.id` — confirmed in `game-element.ts:1017–1019`). The value is identical, but
one path uses the internal tree-node field directly. If the element tree implementation
ever renames `_t` or moves the `id` field, the `element` branch breaks silently while
the `elements` branch continues working, creating a hard-to-diagnose split failure.

**Fix:** Standardise on the public getter for both:

```typescript
if (selection.type === 'element' || selection.type === 'elements') {
  const el = choice as { id: number };
  return Array.isArray(el) ? (el as any[]).map(e => (e as { id: number }).id) : el.id;
}
```

Or simply:
```typescript
if (selection.type === 'element') {
  return (choice as { id: number }).id;  // use public getter, not _t.id
}
```

---

## Info

### IN-01: `console.warn` / `console.error` fire on every state broadcast from a hot production path

**File:** `src/engine/element/action-metadata.ts:38, 52`

**Issue:** `buildActionMetadata` is called per-seat on every game state broadcast. The
`console.warn` at line 38 (missing action name) and `console.error` at line 52
(condition error, though see WR-04) fire unconditionally in all environments. In
production these generate noise; in development the messages are actionable but only
appear in the server console, not surfaced to the game author. Consider gating on
`process.env.NODE_ENV !== 'production'` or centralizing through a project-standard
debug logger.

---

### IN-02: Player guard in `getActionSpace` runs after `availableActionsForSeat`

**File:** `src/engine/element/game.ts:1012–1014`

**Issue:**
```typescript
const actionNames = availableActionsForSeat(this.getFlowState(), seat); // runs first
const player = this.getPlayer(seat);
if (!player) return { actions: [] };  // guard runs second
```

`availableActionsForSeat` is safe with `undefined` flow state (confirmed — it returns
`[]` immediately when `flowState?.awaitingInput` is falsy). But the guard ordering is
logically inverted: an invalid seat is a fast-fail condition that should come before any
work. This is a code-clarity issue only, not a crash risk.

**Fix:** Move the player guard before the `availableActionsForSeat` call:

```typescript
getActionSpace(seat: number): ActionSpaceView {
  const player = this.getPlayer(seat);
  if (!player) return { actions: [] };

  const actionNames = availableActionsForSeat(this.getFlowState(), seat);
  // ...
}
```

---

_Reviewed: 2026-06-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
