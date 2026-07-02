# Phase 124: Hidden-Info Test Utilities - Pattern Map

> **⚠ SUPERSEDED GUIDANCE NOTE (post-plan-check revision, 2026-07-01):** Code excerpts in this document that derive visibility from a bare `element.isVisibleTo(seat)` or read unfiltered `element.toJSON().attributes` are the PRE-REVISION approach and MUST NOT be reused verbatim. The authoritative implementation contract is the PLAN.md task `<action>` text: derive from the final `game.toJSONForPlayer(seat)` tree (post-`GameClass.playerView` transform, game.ts:2813-2816), with `isVisibleTo` only as a fast path when `playerView` is undefined. DOM-leak markers come from a `toJSON()`-vs-final-tree diff. See threat T-124-08.

**Mapped:** 2026-07-01
**Files analyzed:** 5 (new/modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/testing/visibility.ts` (NEW — `isElementVisible`, `getVisibleElements`) | utility (test-layer wrapper) | transform (query over live elements) | `src/engine/element/game-element.ts:696` (`isVisibleTo`) + `src/testing/test-game.ts:360` (`getPlayerView`, thin-wrapper style) | exact (composes an existing primitive 1:1) |
| `src/testing/view-diff.ts` (NEW — `diffPlayerViews`) | utility (structured + `describe()` diff) | transform (positional tree walk) | `src/engine/flow/describe-flow-position.ts:115-135` (structured object + `describe()` shape) and `src/testing/debug.ts:402` (`findDiffs`, positional JSON walker) | role-match (shape from Phase 123, walk strategy from `findDiffs`) |
| `src/testing/dom-leak.ts` (NEW — `renderAsSeat`/`assertNoHiddenInfoLeak`) | utility (headless Vue mount + DOM scan) | request-response (mount → scan → pass/fail) | `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts:1-24` (jsdom mount pattern) + `src/ui/components/auto-ui/AutoUI.vue:22-31` (minimal prop contract) | exact (same mount idiom, minimal-prop target component) |
| `src/testing/assertions.ts` (MODIFIED — add `assertHidden`/`assertVisible`) | utility (assertion helper) | request-response (throw on failure) | `src/testing/assertions.ts:206-241` (`assertActionAvailable`, rich-failure-message convention) | exact (same file, same convention) |
| `src/testing/index.ts` (MODIFIED — export barrel) | config (module exports) | — | `src/testing/index.ts:64-72` (existing assertions export block) | exact |

## Pattern Assignments

### `src/testing/visibility.ts` (utility, transform)

**Analog:** `src/engine/element/game-element.ts:696` (`isVisibleTo`) composed the same way `test-game.ts` composes `runner.getPlayerView`.

**Core pattern — thin wrapper, no re-derivation of visibility rules** (`src/engine/element/game-element.ts:693-703`):
```typescript
/**
 * Check if this element is visible to a player
 */
isVisibleTo(player: Player | number): boolean {
  const seat = typeof player === 'number' ? player : player.seat;
  const visibility = this.getEffectiveVisibility();
  // For owner-based visibility, check this element's owner first,
  // then walk up the tree to find an owner (for inherited visibility)
  const ownerSeat = this.getEffectiveOwner()?.seat;
  return canPlayerSee(visibility, seat, ownerSeat);
}
```

**Wrapper doc-comment style to copy** (`src/testing/test-game.ts:329-362`, `getPlayerView`): use a JSDoc block with a `@param`, `@returns`, and an explicit "what NOT to do" callout — this file established the convention of warning callers away from hand-parsing serialized JSON, which is exactly VIS-01's stated goal:
```typescript
/**
 * ...
 * **What NOT to do:** Do not parse `view.state` JSON to read game-specific
 * properties — `view.state` is an `ElementJSON` tree intended for the UI
 * renderer, not for domain assertions. Use `testGame.game.<prop>` instead.
 *
 * @param playerSeat - The player whose view to get (1-indexed)
 * @returns The game state as visible to that player, with hidden info excluded
 */
getPlayerView(playerSeat: number): PlayerStateView {
  return this.runner.getPlayerView(playerSeat);
}
```

**Imports pattern** (`src/testing/test-game.ts:9-19`):
```typescript
import {
  Game,
  Player,
  type GameOptions,
  type FlowState,
  type FlowDebugInfo,
  type PendingActionState,
  type AnnotatedChoice,
} from '../engine/index.js';
import { GameRunner, type ActionExecutionResult, type PlayerStateView } from '../runtime/index.js';
```
`visibility.ts` should import `Game`, `GameElement`, `ElementCollection` similarly from `'../engine/index.js'` (barrel import, `.js` extension convention — NodeNext ESM).

**Count-only equivalence note (must match wire behavior exactly):** `src/engine/element/game.ts:2682` — `visibility.mode === 'count-only' && !element.isVisibleTo(visibilityPosition)` is the exact branch condition `toJSONForPlayer` uses; confirms `isVisibleTo` alone (no extra count-only special-casing) is correct for `isElementVisible`.

---

### `src/testing/view-diff.ts` (utility, transform — VIS-02)

**Analog 1 — structured object + `describe()` shape:** `src/engine/flow/describe-flow-position.ts:115-135`
```typescript
export function describeFlowPosition(
  root: FlowNode,
  position: FlowPosition,
  flowState: FlowState,
): FlowDebugInfo {
  const { step } = walkPath(root, position.path);
  const phase = flowState.currentPhase;

  return {
    phase,
    step,
    path: position.path,
    awaiting: {
      currentPlayer: flowState.currentPlayer,
      awaitingPlayers: flowState.awaitingPlayers?.map(p => p.playerIndex),
    },
    describe(): string {
      return formatDescribe(phase, step, flowState);
    },
  };
}
```
Corresponding interface shape to mirror (`src/engine/flow/types.ts:276-291`, `FlowDebugInfo`): plain data fields + a `describe(): string` method on the returned object — no class, no extra runtime dependency. `diffPlayerViews` should return `{ onlyInA, onlyInB, attributeDiffs, describe(): string }` following this exact shape convention (data fields first, `describe()` last).

**Analog 2 — positional JSON tree walker to extend (NOT reuse verbatim):** `src/testing/debug.ts:402-441` (`findDiffs`)
```typescript
function findDiffs(before: any, after: any, path: string, diffs: string[]): void {
  if (typeof before !== typeof after) {
    diffs.push(`${path}: type changed from ${typeof before} to ${typeof after}`);
    return;
  }
  if (typeof before !== 'object' || before === null) {
    if (before !== after) {
      diffs.push(`${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }
    return;
  }
  if (Array.isArray(before)) {
    if (!Array.isArray(after)) { diffs.push(`${path}: array → non-array`); return; }
    if (before.length !== after.length) diffs.push(`${path}: length ${before.length} → ${after.length}`);
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i++) findDiffs(before[i], after[i], `${path}[${i}]`, diffs);
    return;
  }
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const subPath = path ? `${path}.${key}` : key;
    if (!(key in before)) diffs.push(`${subPath}: added (${JSON.stringify(after[key])})`);
    else if (!(key in after)) diffs.push(`${subPath}: removed (was ${JSON.stringify(before[key])})`);
    else findDiffs(before[key], after[key], subPath, diffs);
  }
}
```
**Do NOT reuse this verbatim** — it emits `string[]`, but CONTEXT.md locks the `{onlyInA, onlyInB, attributeDiffs}` structured shape. Reuse only the recursive-walk STRATEGY (index-by-index for arrays/children, key-set union for attributes), and per Open Question 1 in RESEARCH.md, scope `diffPlayerViews` around per-element `isElementVisible` results (visible-to-exactly-one-seat → `onlyInA`/`onlyInB`; visible-to-both-but-different-attrs → `attributeDiffs`) rather than raw id-based JSON diffing, to sidestep the anonymized-id correlation problem entirely (Pitfalls 1/2 below).

**Critical id-handling excerpt to read/respect before writing the walker** (`src/engine/element/game.ts:2694-2732`, individually-hidden — KEEPS stable id — vs. `2739-2788`, zone-hidden children — synthetic negative ids):
```typescript
// Zone-hidden / count-only children (src/engine/element/game.ts:2750-2756):
hiddenChildren.push({
  className: childJson.className,
  // Use negative index-based IDs to prevent correlation with real element IDs
  id: -(element._t.id * 1000 + i),
  attributes: { __hidden: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) },
});

// Individually-hidden single element (src/engine/element/game.ts:2722-2731):
return {
  className: json.className,
  id: json.id, // intentional: stable id for FLIP (see comment above)
  attributes: { __hidden: true, ...redactHiddenElementAttrs(json.attributes ?? {}) },
};
```

---

### `src/testing/dom-leak.ts` (utility, request-response — VIS-03)

**Analog — jsdom + `@vue/test-utils` mount pragma and pattern:** `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts:1-24`
```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import CardRenderer from './CardRenderer.vue';
```
The `// @vitest-environment jsdom` pragma MUST be the first line of any file (or its own test file) that calls `mount()` — `vitest.config.ts` default environment is `node`.

**Target component's minimal prop contract** (`src/ui/components/auto-ui/AutoUI.vue:22-31`):
```typescript
defineProps<{
  /** The game view tree */
  gameView: GameElement | null | undefined;
  /** Flow state (for game complete detection) */
  flowState?: FlowState;
  /** Current player's seat */
  playerSeat: number;
  /** Per-UI presentation overlay — keyed by element class/name/attribute → visuals (D-04). */
  presentation?: PresentationOverlay;
}>();
```
Only `gameView` and `playerSeat` are required — no `GameShell` wrapper, no WebSocket/session mocking needed (confirmed: `CardRenderer.vue` uses `tryUseBoardInteraction()`, the non-throwing variant, which degrades to `undefined` outside a provider — RESEARCH.md Assumption A1, verify with a one-off mount spike before locking).

**Mount + assert convention (simple case, no provider needed):** `src/ui/components/GameOverCard.test.ts:1-29`
```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GameOverCard from './GameOverCard.vue';

describe('GameOverCard — winner naming', () => {
  it('displays the winner name when winnerSeats is non-empty', () => {
    const wrapper = mount(GameOverCard, {
      props: { winnerSeats: [1], players: PLAYERS },
    });
    expect(wrapper.text()).toContain('Bob');
  });
});
```
`dom-leak.ts` mirrors this exact `mount(Component, { props: {...} })` → `wrapper.html()`/`wrapper.text()` idiom, per RESEARCH.md Pattern 3:
```typescript
// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import AutoUI from '../ui/components/auto-ui/AutoUI.vue';

const view = testGame.getPlayerView(seat);
const wrapper = mount(AutoUI, {
  props: { gameView: view.state, playerSeat: seat },
});
const html = wrapper.html();
// scan html for forbidden markers derived from hidden elements' FULL (unfiltered) attrs
```

**Forbidden-marker derivation (composes VIS-01, does not re-derive visibility):**
```typescript
const hiddenElements = game.all(GameElement).filter((e) => !e.isVisibleTo(seat));
const forbiddenMarkers = new Set<string>();
for (const el of hiddenElements) {
  const fullJson = el.toJSON(); // UNFILTERED — the real identity
  for (const [key, value] of Object.entries(fullJson.attributes ?? {})) {
    if (typeof value === 'string' && value.length > 0) forbiddenMarkers.add(value);
  }
  if (fullJson.name) forbiddenMarkers.add(fullJson.name);
}
```
Scope the scan to `data-*` attribute values and `img[src]`/background-image URL fragments (not raw `wrapper.text()` substring search) to avoid false positives from short numeric ranks colliding with turn counters/scores (Pitfall 3) — implement a caller-configurable allowlist per CONTEXT.md's locked decision (Open Question 2: predicate-based allowlist fits the existing `ElementFinder`/`Sorter` predicate idiom better than a flat string list).

---

### `src/testing/assertions.ts` (MODIFIED — add `assertHidden`/`assertVisible`)

**Analog:** `assertActionAvailable`, same file, lines 206-241 — rich-failure-message convention (embeds WHY, not just WHAT):
```typescript
export function assertActionAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();
  if (!canSeatAct(flowState, playerSeat)) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} — seat is not active. ` +
      `currentPlayer=${flowState?.currentPlayer}, ` +
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}\n` +
      `Flow position: ${testGame.game.getFlowDebugInfo().describe()}`
    );
  }
  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    const player = testGame.getPlayer(playerSeat);
    const debugInfo = testGame.game.debugActionAvailability(actionName, player);
    // ... builds a multi-line "Why: ..." + "Selections:\n..." + "Flow position: ..." message
  }
}
```
`assertHidden`/`assertVisible` should follow the same "state what happened, what was expected, and embed the concrete evidence" structure. Concrete target excerpt (from RESEARCH.md Code Examples, matches this file's style exactly — reuse verbatim as the implementation starting point):
```typescript
export function assertHidden(element: GameElement, seat: number): void {
  if (element.isVisibleTo(seat)) {
    const leaked = Object.keys(element.toJSON().attributes ?? {});
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is visible to seat ${seat} ` +
      `(expected hidden): serialized attributes [${leaked.join(', ')}] present in seat ${seat}'s view`
    );
  }
}

export function assertVisible(element: GameElement, seat: number): void {
  if (!element.isVisibleTo(seat)) {
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is hidden from seat ${seat} ` +
      `(expected visible)`
    );
  }
}
```

**Imports pattern already in this file** (`src/testing/assertions.ts:1-12`):
```typescript
import type { TestGame } from './test-game.js';
import { canSeatAct, availableActionsForSeat } from '../engine/index.js';
import { _collectAvailableActions } from './simulate-action.js';
```
Add `GameElement` to the `'../engine/index.js'` import line rather than a new import block (matches existing barrel-import convention).

---

### `src/testing/index.ts` (MODIFIED — export barrel)

**Analog:** the existing "Assertion helpers" export block, `src/testing/index.ts:64-72`:
```typescript
// Assertion helpers
export {
  assertFlowState,
  assertGameFinished,
  assertActionAvailable,
  assertActionNotAvailable,
  type ExpectedFlowState,
  type FlowStateAssertionResult,
} from './assertions.js';
```
Add `assertHidden`/`assertVisible` to this block; add three NEW commented sections (matching the file's section-comment style, e.g. `// Debug utilities`, `// Tutorial DSL`) for `visibility.ts`, `view-diff.ts`, and `dom-leak.ts`:
```typescript
// Hidden-info visibility utilities (VIS-01)
export {
  isElementVisible,
  getVisibleElements,
} from './visibility.js';

// Per-seat view diffing (VIS-02)
export {
  diffPlayerViews,
  type ViewDiffResult,
} from './view-diff.js';

// DOM-leak test utility (VIS-03)
export {
  renderAsSeat,
  assertNoHiddenInfoLeak,
} from './dom-leak.js';
```

---

## Shared Patterns

### Same-serialization-path invariant (applies to ALL three new files)
**Source:** `src/engine/element/game-element.ts:696` (`isVisibleTo`) + `src/engine/element/game.ts:2682,2695,2739,2764` (each per-element `toJSONForPlayer` branch calls `isVisibleTo`/checks `getZoneVisibility()`/`getEffectiveOwner()`) + `src/engine/element/game.ts:2813-2816` (the `GameClass.playerView` POST-TRANSFORM applied AFTER those branches — the final view is NOT `isVisibleTo` alone for games defining `static playerView`)
**Apply to:** `visibility.ts`, `view-diff.ts`, `dom-leak.ts` — none may re-implement owner/zone/count-only visibility rules. Derive visibility/markers from the FINAL `game.toJSONForPlayer(seat)` tree (element presence + non-`__hidden` + attribute survival), which INCLUDES the `playerView` post-transform; use `element.isVisibleTo(seat)` only as a fast path when `GameClass.playerView` is undefined. Reading `__hidden` to interpret the serializer's own final output is fine; re-deriving the visibility RULES from scratch is not. This guarantees zero drift from the wire.

### Rich, actionable failure messages
**Source:** `src/testing/assertions.ts:206-241` (`assertActionAvailable`), and RESEARCH.md's target error string: `` `Element Card#7H is visible to seat 2 (expected hidden): serialized attributes [rank, suit] present in seat 2's view` ``
**Apply to:** `assertHidden`/`assertVisible`, and `assertNoHiddenInfoLeak`'s failure path (embed the specific element id/class, the seat, and the exact leaked marker/attribute — never a generic "leak detected").

### Structured-object + `describe()` shape
**Source:** `src/engine/flow/describe-flow-position.ts:115-135` / `src/engine/flow/types.ts:276-291` (`FlowDebugInfo`)
**Apply to:** `view-diff.ts`'s `diffPlayerViews` return value — plain data fields (`onlyInA`, `onlyInB`, `attributeDiffs`) plus a `describe(): string` method, no class instantiation.

### `@vitest-environment jsdom` pragma
**Source:** `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts:1`, `src/ui/components/GameOverCard.test.ts:1`
**Apply to:** `src/testing/dom-leak.ts` (if it contains its own internal `mount()` call) and `src/testing/dom-leak.test.ts` — first line of the file, since `vitest.config.ts` defaults to `environment: 'node'`.

### Barrel-import convention (`.js` extensions, NodeNext ESM)
**Source:** `src/testing/test-game.ts:9-19`, `src/testing/assertions.ts:10-12`
**Apply to:** All new files — import from `'../engine/index.js'` / `'../runtime/index.js'` / sibling `'./*.js'`, never deep-import engine internals directly.

## No Analog Found

None — every file in this phase's scope has a strong analog (all rated `exact` or `role-match`); RESEARCH.md independently confirms this is pure composition of existing primitives, not new algorithm design.

## Metadata

**Analog search scope:** `src/testing/`, `src/engine/element/`, `src/engine/flow/`, `src/ui/components/auto-ui/`, `src/ui/components/*.test.ts`
**Files scanned:** `test-game.ts`, `assertions.ts`, `debug.ts`, `index.ts`, `describe-flow-position.ts`, `types.ts` (flow), `game-element.ts`, `game.ts`, `AutoUI.vue`, `CardRenderer.a11y.test.ts`, `GameOverCard.test.ts`
**Pattern extraction date:** 2026-07-01
