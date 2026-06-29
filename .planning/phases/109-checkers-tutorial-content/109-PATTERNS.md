# Phase 109: Checkers Tutorial Content - Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 16 (9 BoardSmith modifications, 3 checkers modifications, 2 checkers new files, 2 BoardSmith test additions)
**Analogs found:** 16 / 16

---

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/engine/tutorial/types.ts` | BoardSmith | model | transform | self (existing `ElementRef`/`TutorialGateAllowList` in same file) | exact |
| `src/engine/tutorial/gate.ts` | BoardSmith | utility | transform | self (existing `getGateReasonForValue` in same file) | exact |
| `src/engine/action/action.ts` (3 call sites) | BoardSmith | engine | transform | self (existing `getGateReasonForValue(tutorialStep, actionName!, value)` calls) | exact |
| `src/session/stateless-ops.ts` | BoardSmith | service | request-response | self (existing `Op` union + `executeOp` switch, `undo`/`cancelAction` variants) | exact |
| `src/session/types.ts` | BoardSmith | model | — | self (existing `tutorial?:`, `disabledActions?:` optional fields in `PlayerGameState`) | exact |
| `src/session/utils.ts` | BoardSmith | utility | transform | self (existing tutorial projection block in `buildPlayerState`) | exact |
| `src/cli/dev-host/bridge.ts` | BoardSmith | middleware | request-response | self (existing `translateOp`/`shapeResult`/`WireOp` — `cancel_action`/`undo` cases) | exact |
| `src/ui/components/ControlsMenu.vue` | BoardSmith | component | event-driven | self (existing Teaching group template block, `showHint` prop gate pattern) | exact |
| `src/ui/components/GameShell.vue` | BoardSmith | component | event-driven | self (existing `handleTeachingAction` function body) | exact |
| `src/rules/index.ts` (checkers) | checkers | config | CRUD | self (existing `ai:`, `presets:` fields in `gameDefinition`) | exact |
| `src/rules/game.ts` (checkers) | checkers | model | CRUD | self (existing `CheckersOptions`, `placePieces()` method) | exact |
| `src/rules/tutorial.ts` (NEW, checkers) | checkers | config | transform | `src/testing/tutorial-ci-demo.test.ts` (`DEMO_TUTORIAL` constant) | role-match |
| `tests/tutorial.test.ts` (NEW, checkers) | checkers | test | transform | `src/testing/tutorial-ci-demo.test.ts` + `tests/game.test.ts` (checkers) | role-match |
| `src/engine/tutorial/gate.test.ts` (new cases) | BoardSmith | test | transform | self (existing allow-list test cases in same file) | exact |
| `src/session/stateless-ops.test.ts` (new cases) | BoardSmith | test | request-response | self (existing `executeOp` test structure) | exact |
| `src/session/build-player-state.test.ts` (new cases) | BoardSmith | test | transform | self (existing tutorial field test cases) | exact |

---

## Pattern Assignments

### `src/engine/tutorial/types.ts` (model, transform) — BoardSmith

**Analog:** self — existing `ElementRef` interface + `TutorialGateAllowList` interface (same file, lines 38–131)

**Current `TutorialGateAllowList`** (lines 118–131 — the block to replace):
```typescript
export interface TutorialGateAllowList {
  /** The single action name the learner must perform on this step. */
  action: string;
  /**
   * RESERVED (Phase 109): restrict the source element / choice value.
   * Type is `unknown` to avoid type churn; Phase 109 will narrow it.
   */
  from?: unknown;
  /**
   * RESERVED (Phase 109): restrict the destination element / choice value.
   * Type is `unknown` to avoid type churn; Phase 109 will narrow it.
   */
  to?: unknown;
}
```

**Replacement pattern — add `SelectionMatcher` before the interface:**
```typescript
/**
 * Matches a single selection value against authored criteria.
 *
 * For element selections: use ElementRef-style fields — id takes precedence,
 * then notation, then name. Match is field equality: { id: 5 } matches any
 * element where el.id === 5.
 *
 * For choice selections (e.g. DestinationChoice): field equality on the choice
 * object — { toNotation: 'd4' } matches any choice where choice.toNotation === 'd4'.
 *
 * Supply only the fields you care about; unspecified fields are ignored.
 */
export type SelectionMatcher = Record<string, unknown>;

export interface TutorialGateAllowList {
  /** The single action name the learner must perform on this step. */
  action: string;
  /**
   * Optional per-selection value restrictions.
   *
   * Keys are selection names (matching `selection.name` in the action definition).
   * Values are SelectionMatcher objects: each field in the matcher must equal the
   * corresponding field on the value for a match.
   *
   * When absent (or a selection name has no entry), all values for that selection
   * are permitted.
   */
  selections?: Record<string, SelectionMatcher>;
}
```

**JSDoc style to mirror** (from `ElementRef` block, lines 38–45):
```typescript
export interface ElementRef {
  /** Engine-assigned numeric element id. Takes precedence over notation + name. */
  id?: number;
  /** Logical element name (e.g. 'queen'). Matched after id, before notation. */
  name?: string;
  /** Board notation (e.g. 'd4'). Matched after id; beats name when both present. */
  notation?: string;
}
```
The `SelectionMatcher` doc block must mention the id > notation > name precedence — exact same prose used in `ElementRef` lines 31–36.

**Export addition:** Add `SelectionMatcher` to `src/engine/index.ts` alongside the other tutorial types exported at lines 249–262.

---

### `src/engine/tutorial/gate.ts` (utility, transform) — BoardSmith

**Analog:** self — existing `getGateReasonForValue` function (lines 117–151) + `gateValuesEqual` helper (lines 35–47)

**Current function signature** (line 117):
```typescript
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
): string | null {
```

**Phase 109 signature change** — add `selectionName: string` as 4th param:
```typescript
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
  selectionName: string,   // NEW 4th param — selection.name from BaseSelection
): string | null {
```

**New branch to insert after the action-mismatch early return** (currently line 131):
```typescript
  // Per-selection matching (Phase 109): if the gate specifies a restriction
  // for this selection name, check field-equality match only for that selection.
  if (gate.selections && selectionName in gate.selections) {
    const matcher = gate.selections[selectionName];
    if (selectionMatchesValue(matcher, value)) return null;
    return `Tutorial step requires a specific ${selectionName}: ${JSON.stringify(matcher)}`;
  }

  // Legacy no-selections path: all values of the allowed action are permitted.
  return null;
```

**Remove the old `from`/`to` block** (lines 135–150) — the reserved flat fields are superseded by `selections`. No deprecation cycle.

**New `selectionMatchesValue` helper** — add before `getGateReasonForValue`, using same pattern as existing `gateValuesEqual` (lines 35–47):
```typescript
/**
 * Field-equality match: matcher fields must equal the corresponding fields on value.
 *
 * ElementRef precedence (mirrors matchesRef in useBoardInteraction):
 *   id wins, then notation, then name. Only the first present key is checked.
 * For choice objects (DestinationChoice etc.): all matcher fields must match.
 */
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const val = value as Record<string, unknown>;

  // ElementRef precedence: if matcher specifies id, that alone determines match.
  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];

  // General field equality for choice objects (DestinationChoice, etc.)
  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}
```

**Import to add at top of gate.ts:**
```typescript
import type { SelectionMatcher, TutorialGate, TutorialGateAllowList, TutorialStep, TutorialStepView } from './types.js';
```
(Add `SelectionMatcher` to the existing import on line 24.)

---

### `src/engine/action/action.ts` (engine, transform) — BoardSmith — 3 call sites

**Analog:** self — existing `getGateReasonForValue` call pattern (lines 388, 440, 460)

**Current call pattern** (identical at all 3 call sites — vary only in variable name):
```typescript
// line 388 (choice selection):
const gateReason = getGateReasonForValue(tutorialStep, actionName!, choice);

// line 440 (element selection):
const gateReason = getGateReasonForValue(tutorialStep, actionName!, el);

// line 460 (elements selection):
const gateReason = getGateReasonForValue(tutorialStep, actionName!, el);
```

**Phase 109 change** — add `selection.name` as 4th arg at each call site:
```typescript
// line 388 — selection is typed ChoiceSelection (extends BaseSelection, has .name)
const gateReason = getGateReasonForValue(tutorialStep, actionName!, choice, selection.name);

// line 440 — selection is typed ElementSelection (extends BaseSelection, has .name)
const gateReason = getGateReasonForValue(tutorialStep, actionName!, el, selection.name);

// line 460 — selection is typed ElementsSelection (extends BaseSelection, has .name)
const gateReason = getGateReasonForValue(tutorialStep, actionName!, el, selection.name);
```

**Confirmation:** `BaseSelection.name: string` is confirmed at `src/engine/action/types.ts:39`. All selection types extend `BaseSelection`. `selection.name` is always in scope at these 3 call sites.

---

### `src/session/stateless-ops.ts` (service, request-response) — BoardSmith

**Analog:** self — existing `Op` union (lines 29–59) + `executeOp` switch (lines 651–719)

**Op union addition** (insert after the last debug op variant, before the closing `;`):
```typescript
// Pattern: mirrors { type: 'undo'; player: number } and { type: 'cancelAction'; player: number }
| { type: 'startTutorial'; player: number }
```

**executeOp switch case** (insert before the closing `}` of the switch at line ~715 — NOT in READ_ONLY_OP_TYPES since it mutates state):
```typescript
case 'startTutorial': {
  const def = (runner.game as any).tutorialDefinition;
  if (!def) {
    return errorResult('No tutorial definition on this game.', 'protocol');
  }
  const { validateTutorialDefinition, initialProgress } = await import('../engine/tutorial/progress.js');
  validateTutorialDefinition(def);
  runner.game.tutorialProgress.set(op.player, initialProgress(def));
  break;
}
```

**Note:** `validateTutorialDefinition` and `initialProgress` already exist in `src/engine/tutorial/progress.ts` (verified by RESEARCH). Check the import path; they may already be re-exported from `src/engine/index.ts`. The `runner.game.tutorialDefinition` field is an unserializable attribute (in `unserializableAttributes`) and is NOT in the snapshot — the runner must be freshly constructed from the `def` passed to `executeOp`. Verify whether `def` (the `GameDefinitionLike`) carries a `tutorial` field (it does: `src/session/types.ts:78-101` confirms `GameDefinition.tutorial`).

---

### `src/session/types.ts` (model) — BoardSmith

**Analog:** self — existing optional fields in `PlayerGameState` (lines 401–485), specifically the tutorial + disabledActions block (lines 429–449)

**Addition pattern** — add after the existing `isDemoRunning?:` field (around line 484):
```typescript
/**
 * Whether the current game definition has a tutorial attached.
 *
 * Set by `buildPlayerState` when `runner.game.tutorialDefinition` is defined.
 * Consumers (GameShell, ControlsMenu) use this to show the "Start tutorial" menu item.
 * Undefined when no tutorial is defined (not false — omitted to keep wire shape lean).
 */
hasTutorial?: boolean;
```

**Style parity:** All optional session-layer fields in `PlayerGameState` use `?:` (not `| undefined`), have a JSDoc comment explaining when populated, and are listed after the core fields. The `hasTutorial` field follows this convention exactly.

---

### `src/session/utils.ts` (utility, transform) — BoardSmith

**Analog:** self — existing tutorial projection block in `buildPlayerState` (lines 451–462)

**Existing tutorial block** (lines 451–462 — the block to mirror for `hasTutorial`):
```typescript
// Tutorial projection — parity with createPlayerView (T-104-07).
if (playerPosition > 0) {
  const tutorial = getActiveTutorialStepView(runner.game, playerPosition);
  if (tutorial !== undefined) {
    state.tutorial = tutorial;
    const disabled = runner.game.getTutorialDisabledActions(playerPosition);
    if (Object.keys(disabled).length > 0) {
      state.disabledActions = disabled;
    }
  }
}
```

**Addition** — insert `hasTutorial` BEFORE the tutorial projection block (it applies to all seats including spectators, no `playerPosition > 0` guard needed since the menu shows for any connected player):
```typescript
// Signal whether the game has a tutorial definition (for ControlsMenu gating).
if (runner.game.tutorialDefinition) {
  state.hasTutorial = true;
}
```

---

### `src/cli/dev-host/bridge.ts` (middleware, request-response) — BoardSmith

**Analog:** self — existing `WireOp` union (lines 21–37), `translateOp` switch (lines 92–165), `shapeResult` switch (lines 172–213)

**WireOp addition** (insert into the union after `'undo'`, before the debug ops):
```typescript
// Pattern: mirrors 'cancel_action' | 'undo' entries
| 'start-tutorial'
```

**translateOp case** (insert after `case 'undo':` at line 124–125):
```typescript
case 'start-tutorial':
  return { type: 'startTutorial', player: seat };
```

**shapeResult case** (insert after `case 'undo':` at lines 188–189 — same shape as undo: `{ success, error }` only):
```typescript
case 'start-tutorial':
  return { success: result.success, error: result.error };
```

**Exact analog for shape pattern** (lines 188–189):
```typescript
case 'cancel_action':
case 'undo':
  return { success: result.success, error: result.error };
```

---

### `src/ui/components/ControlsMenu.vue` (component, event-driven) — BoardSmith

**Analog:** self — existing `showHint` prop + Teaching group template block (lines 19–63, 258–301)

**Props addition** (insert after `isActionHelpVisible?:` in the `defineProps` block, lines 44–48):
```typescript
/**
 * When true, renders the Tutorial group showing the "Start tutorial" item.
 * Undefined / absent hides the group (game has no tutorial definition).
 */
hasTutorial?: boolean;
```

**Emit type addition** (extend the `teaching-action` emit union on line 62):
```typescript
// Before:
'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'];

// After:
'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial'];
```

**New Tutorial group template block** (insert after the Teaching group's closing `</template>` tag at line 301, before `</div>`):
```html
<!-- Tutorial group: visible only when the game has a tutorial definition -->
<template v-if="hasTutorial">
  <div class="sep"></div>
  <div class="grouplabel">Tutorial</div>
  <button
    class="mi"
    type="button"
    role="menuitem"
    @click="emit('teaching-action', 'start-tutorial'); close()"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 4v8m0 2v2" stroke-linecap="round"/></svg>
    Start tutorial
  </button>
</template>
```

**Pattern: Teaching group** (lines 258–301 — exact structural analog to copy):
```html
<template v-if="showHint !== undefined">
  <div class="sep"></div>
  <div class="grouplabel">Teaching</div>
  <button
    class="mi"
    type="button"
    role="menuitem"
    :disabled="hintDisabled"
    :aria-disabled="hintDisabled"
    @click="emit('teaching-action', 'hint'); close()"
  >
    ...
  </button>
</template>
```

Note: Tutorial group uses `v-if="hasTutorial"` (boolean prop), not `v-if="showHint !== undefined"` (undefined-gate). This is intentional: `hasTutorial` is a boolean (true/absent) rather than a tri-state signal.

---

### `src/ui/components/GameShell.vue` (component, event-driven) — BoardSmith

**Analog:** self — existing `handleTeachingAction` function (lines 711–750) + `showHintProp` computed (lines 694–696) + ControlsMenu usage (lines 1909–1924)

**Type union extension** (line 712):
```typescript
// Before:
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle'
) {

// After:
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial'
) {
```

**New case to add inside `handleTeachingAction`** (after the `help-toggle` else-if block, lines 746–750):
```typescript
} else if (teachAction === 'start-tutorial') {
  try {
    await platformRequest('start-tutorial', { seat: playerSeat.value });
  } catch {
    toast.error('Failed to start tutorial.');
  }
}
```

**Pattern: existing heatmap-toggle case** (lines 736–745 — same try/catch/toast structure):
```typescript
} else if (teachAction === 'heatmap-toggle') {
  const currentVisible = isHeatmapVisibleProp.value;
  try {
    await platformRequest('heatmap-toggle', {
      seat: playerSeat.value,
      visible: !currentVisible,
    });
  } catch {
    toast.error('Failed to toggle move quality display.');
  }
}
```

**New computed for `hasTutorialProp`** (add near `showHintProp` computed at lines 694–696):
```typescript
// Pattern: mirrors showHintProp (line 694)
const hasTutorialProp = computed<boolean>(
  () => (state.value?.state as any)?.hasTutorial ?? false
);
```

**ControlsMenu binding addition** (insert in the `<ControlsMenu>` block at lines 1909–1924):
```html
:has-tutorial="hasTutorialProp"
```

---

### `~/BoardSmithGames/checkers/src/rules/index.ts` (config, CRUD) — checkers

**Analog:** self — existing `ai:` and `presets:` fields in `gameDefinition` (lines 15–44)

**Current shape** (lines 15–44):
```typescript
export const gameDefinition = {
  gameClass: CheckersGame,
  gameType: 'checkers',
  displayName: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCheckersObjectives,
  },
  presets: [ ... ],
};
```

**Addition pattern** — add `tutorial:` after `presets:`:
```typescript
import { CHECKERS_TUTORIAL } from './tutorial.js';

export const gameDefinition = {
  gameClass: CheckersGame,
  gameType: 'checkers',
  displayName: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,
  ai: { objectives: getCheckersObjectives },
  presets: [ ... ],
  tutorial: CHECKERS_TUTORIAL,   // NEW: add after presets
};
```

---

### `~/BoardSmithGames/checkers/src/rules/game.ts` (model, CRUD) — checkers

**Analog:** self — existing `CheckersOptions` interface (lines 9–12) + `placePieces()` method (lines 97–115)

**Current `CheckersOptions`** (lines 9–12):
```typescript
export interface CheckersOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
}
```

**Addition:**
```typescript
export interface CheckersOptions extends GameOptions {
  /** Random seed for deterministic gameplay */
  seed?: string;
  /**
   * When true, replaces the standard 24-piece opening with a minimal
   * deterministic position that forces a capture + multi-jump for seat-1.
   * Used by the CI tutorial test to provide a stable, reproducible board.
   */
  tutorialSetup?: boolean;
}
```

**Constructor change** — pass options through to `placePieces`:
```typescript
constructor(options: CheckersOptions) {
  super(options);
  // ... existing setup ...
  // Change from:
  this.placePieces();
  // Change to:
  this.placePieces(options.tutorialSetup ?? false);
  // ... rest unchanged
}
```

**`placePieces` signature change** (line 97):
```typescript
// Before:
private placePieces(): void {

// After:
private placePieces(tutorialSetup = false): void {
  if (tutorialSetup) {
    this.placeTutorialPieces();
    return;
  }
  // ... existing 24-piece setup unchanged (lines 98–115) ...
}
```

**New `placeTutorialPieces` private method** — minimal deterministic position (exact squares at implementation discretion; must force one capture then a multi-jump for seat-1):
```typescript
/**
 * Minimal board position for the tutorial CI scenario.
 *
 * Seat-1 has one piece positioned to make a mandatory capture. The captured
 * seat-2 piece is in the jump path, and a second seat-2 piece is in the next
 * jump position (multi-jump). Seat-2 has additional pieces to make valid moves.
 *
 * Exact squares are implementation-defined; the CI test derives piece IDs and
 * notation from getValidMoves() rather than hard-coding them.
 */
private placeTutorialPieces(): void {
  // Example layout (implementer chooses exact squares):
  // Seat-1: one piece at c3 (row 5, col 2)
  // Seat-2: pieces at d4 (row 4, col 3) and f6 (row 2, col 5)
  //         plus one extra piece elsewhere so seat-2 has valid moves
  // ... create pieces using same pattern as placePieces() above ...
}
```

**Create piece pattern** (lines 105–107 — copy this for tutorial pieces):
```typescript
const piece = square.create(CheckerPiece, `p1-${row}-${col}`);
piece.player = this.getPlayer(1);
```

---

### `~/BoardSmithGames/checkers/src/rules/tutorial.ts` (config, transform) — checkers NEW FILE

**Analog:** `src/testing/tutorial-ci-demo.test.ts` — `DEMO_TUTORIAL` constant (lines 178–196) + RESEARCH predicate patterns

**Imports pattern** (from `tutorial-ci-demo.test.ts` lines 28–43, adapted for checkers):
```typescript
import type { TutorialDefinition } from 'boardsmith';
import { whenForced } from 'boardsmith';   // if re-exported; else from engine sub-path
import type { CheckersGame, CheckersPlayer } from './game.js';
```

Note: `afterFirstTurn`, `afterTurns`, `whenForced` are exported from `src/engine/index.ts` (confirmed at line 246 in RESEARCH). Import as `from 'boardsmith'`.

**TutorialDefinition constant structure** (mirror `DEMO_TUTORIAL` shape, lines 178–196):
```typescript
export const CHECKERS_TUTORIAL: TutorialDefinition = {
  steps: [
    // Step 1: capture-tip (CHK-02)
    // advanceWhen: custom predicate using playerHasCaptures — NOT whenForced
    {
      id: 'capture-tip',
      gate: { action: 'move' },
      content: [{
        text: 'A capture is available — in checkers, captures are mandatory!',
        placement: 'top',
      }],
      advanceWhen: {
        'first capture forced': (ctx): boolean => {
          const game = ctx.game as CheckersGame;
          const player = game.getPlayer(ctx.seat) as CheckersPlayer | undefined;
          if (!player) return false;
          return game.playerHasCaptures(player);
        },
      },
    },

    // Step 2: execute-capture with piece+destination gate (CHK-01)
    // selectionName 'piece' and 'destination' from actions.ts:83,120
    // piece gated by { id: TUTORIAL_PIECE_ID } — NOT notation (CheckerPiece has no .notation)
    // destination gated by { toNotation: KNOWN_CAPTURE_SQUARE }
    {
      id: 'execute-capture',
      suppressAutoFill: true,       // prevent auto-selection of the sole valid piece
      gate: {
        action: 'move',
        selections: {
          piece: { id: TUTORIAL_PIECE_ID },              // resolved at init (see below)
          destination: { toNotation: CAPTURE_SQUARE },
        },
      },
      content: [
        {
          text: 'Select your piece.',
          target: { kind: 'element', ref: { id: TUTORIAL_PIECE_ID } },
        },
        {
          text: `Jump to ${CAPTURE_SQUARE} to capture!`,
          target: { kind: 'element', ref: { notation: CAPTURE_SQUARE } },
        },
      ],
      advanceWhen: {
        'capture executed': (ctx): boolean => {
          return (ctx.game as CheckersGame).continuingPiece !== null;
        },
      },
    },

    // Step 3: multi-jump continuation (CHK-03)
    {
      id: 'multi-jump-continue',
      gate: {
        action: 'move',
        selections: {
          destination: { toNotation: SECOND_JUMP_SQUARE },
        },
      },
      content: [{
        text: 'The turn continues! Jump again to finish the capture chain.',
        target: { kind: 'element', ref: { notation: SECOND_JUMP_SQUARE } },
      }],
      advanceWhen: {
        'multi-jump chain complete': (ctx): boolean => {
          return (ctx.game as CheckersGame).continuingPiece === null;
        },
      },
    },

    // Step 4: end-turn (needed after multi-jump chain ends)
    {
      id: 'confirm-turn',
      gate: { action: 'endTurn' },
      content: [{ text: 'Well done! Click End Turn to confirm your move.' }],
      advanceWhen: {
        'turn confirmed': (ctx): boolean => {
          return !(ctx.game as CheckersGame).hasMovedThisTurn;
        },
      },
    },
  ],
};
```

**Note on `TUTORIAL_PIECE_ID` / `CAPTURE_SQUARE` / `SECOND_JUMP_SQUARE`:** These constants must come from the fixed tutorial preset position. Two valid approaches:
1. **Export from `game.ts`** as named constants (e.g. `TUTORIAL_PIECE_ID`, `TUTORIAL_CAPTURE_SQUARE`), set by `placeTutorialPieces()` and assigned to piece IDs deterministically.
2. **Derive lazily in the tutorial** using a factory function `createCheckersTutorial(game: CheckersGame): TutorialDefinition` that runs after game construction — then the preset piece ID is looked up from `game.getPlayerPieces()`. Either approach is fine; a factory avoids circular references.

The RESEARCH confirms piece gating MUST use `{ id }` — NOT `{ notation }` — because `CheckerPiece` has no `.notation` property (only `Square` does).

---

### `~/BoardSmithGames/checkers/tests/tutorial.test.ts` (test, transform) — checkers NEW FILE

**Analog 1:** `src/testing/tutorial-ci-demo.test.ts` — full test structure (lines 229–341)
**Analog 2:** `~/BoardSmithGames/checkers/tests/game.test.ts` — import pattern (lines 1–10)

**Imports pattern** (blend of both analogs):
```typescript
import { describe, it, expect } from 'vitest';
import { TestGame, simulateTutorial, assertTutorialCompletes } from 'boardsmith/testing';
import type { TutorialScenarioMove } from 'boardsmith/testing';
import { CheckersGame, CheckersPlayer, type CheckersMove } from '../src/rules/index.js';
import { CHECKERS_TUTORIAL } from '../src/rules/tutorial.js';
```

Note: `tests/game.test.ts` uses `createTestGame` (old API). This file uses `TestGame.create` (current API) following the pattern in `tutorial-ci-demo.test.ts` line 238.

**Test game setup** (mirror tutorial-ci-demo.test.ts lines 238–248):
```typescript
it('intact rules: tutorial completes', () => {
  const testGame = TestGame.create(CheckersGame, {
    playerCount: 2,
    playerNames: ['Learner', 'Opponent'],
    seed: 'checkers-tutorial-pinned',
    tutorialSetup: true,   // triggers placeTutorialPieces()
  });

  // Derive piece IDs + move args from the live game (not hard-coded)
  const learner = testGame.game.getPlayer(1) as CheckersPlayer;
  const captureMoves = testGame.game.getValidMoves(learner).filter(m => m.captures.length > 0);
  const firstCapture = captureMoves[0];
  const captureArg = {
    pieceId: firstCapture.piece.id,
    fromNotation: firstCapture.from.notation,
    toNotation: firstCapture.to.notation,
    isCapture: true,
    becomesKing: firstCapture.becomesKing,
    capturedNotations: firstCapture.captures.map((s: any) => s.notation),
  };
  // ... derive second jump similarly from getValidMoves after first capture ...

  const WALKTHROUGH: TutorialScenarioMove[] = [
    // capture-tip advances via advanceWhen (no explicit action needed if predicate fires at start)
    // execute the capture:
    { action: 'move', args: { piece: firstCapture.piece, destination: captureArg },
      expectStep: 'multi-jump-continue' },
    // execute the continuation jump:
    { action: 'move', args: { piece: firstCapture.piece, destination: secondJumpArg },
      expectStep: 'confirm-turn' },
    // end seat-1's turn:
    { action: 'endTurn', expectStep: 'done' },
    // seat-2 MUST take a turn (eachPlayer flow requires it):
    { seat: 2, action: 'move', args: { piece: seat2Piece, destination: seat2Arg } },
    { seat: 2, action: 'endTurn' },
  ];

  const result = simulateTutorial(testGame, CHECKERS_TUTORIAL, {
    seat: 1,
    scenario: WALKTHROUGH,
    seed: 'checkers-tutorial-pinned',
  });

  assertTutorialCompletes(result);
  expect(result.stepsVisited).toContain('capture-tip');
  expect(result.stepsVisited).toContain('execute-capture');
  expect(result.stepsVisited).toContain('multi-jump-continue');
});
```

**Green→red break pattern** (mirror tutorial-ci-demo.test.ts lines 324–341):
```typescript
it('break: mandatory-capture rule removed → tutorial never advances past capture-tip', () => {
  const testGame = TestGame.create(CheckersGame, {
    playerCount: 2,
    playerNames: ['Learner', 'Opponent'],
    seed: 'checkers-tutorial-pinned',
    tutorialSetup: true,
  });

  // Monkey-patch playerHasCaptures to always return false (simulates rule removal)
  testGame.game.playerHasCaptures = () => false;

  expect(() =>
    simulateTutorial(testGame, CHECKERS_TUTORIAL, {
      seat: 1,
      scenario: WALKTHROUGH,
    })
  ).toThrow(/Tutorial drift/);
});
```

---

### `src/engine/tutorial/gate.test.ts` (test, transform) — BoardSmith — new cases

**Analog:** self — existing allow-list test cases (lines 213–228):
```typescript
it('applies per-value gating when from/to are specified', () => {
  const runner = makeRunner({ seed: 'per-value' });
  runner.game.tutorialDefinition = {
    steps: [{ id: 'step-1', gate: { action: 'move', from: 'a', to: 'b' } }],
  };
  runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

  const step = getActiveStep(runner.game, 1)!;
  expect(getGateReasonForValue(step, 'move', 'a')).toBeNull();
  expect(getGateReasonForValue(step, 'move', 'b')).toBeNull();
  expect(getGateReasonForValue(step, 'move', 'c')).not.toBeNull();
});
```

**New per-selection test cases to add** (extend the `describe('allow-list gate')` block):
```typescript
it('selections: per-selection id match allows the matching element', () => {
  const step: TutorialStep = {
    id: 's',
    gate: { action: 'move', selections: { piece: { id: 42 } } },
  };
  // matching element: allowed
  expect(getGateReasonForValue(step, 'move', { id: 42 }, 'piece')).toBeNull();
  // non-matching element: blocked
  expect(getGateReasonForValue(step, 'move', { id: 99 }, 'piece')).not.toBeNull();
});

it('selections: unspecified selection name allows all values', () => {
  const step: TutorialStep = {
    id: 's',
    gate: { action: 'move', selections: { piece: { id: 42 } } },
  };
  // 'destination' has no entry in selections → all values allowed
  expect(getGateReasonForValue(step, 'move', { toNotation: 'a1' }, 'destination')).toBeNull();
});

it('selections: destination toNotation field equality', () => {
  const step: TutorialStep = {
    id: 's',
    gate: { action: 'move', selections: { destination: { toNotation: 'd4' } } },
  };
  expect(getGateReasonForValue(step, 'move', { toNotation: 'd4', pieceId: 1 }, 'destination')).toBeNull();
  expect(getGateReasonForValue(step, 'move', { toNotation: 'e5', pieceId: 1 }, 'destination')).not.toBeNull();
});
```

---

### `src/session/stateless-ops.test.ts` (test, request-response) — BoardSmith — new cases

**Analog:** self — existing `executeOp` test patterns (lines 1–100)

**Pattern for new case** (mirror existing `action` / `undo` op test shape):
```typescript
it('startTutorial: sets tutorialProgress for the given seat', async () => {
  // Create a game def with a tutorial definition
  // Execute { type: 'startTutorial', player: 1 }
  // Assert result.success === true
  // Assert the broadcast snapshot contains tutorial progress for seat 1
});

it('startTutorial: fails gracefully when no tutorial definition on game', async () => {
  // Execute startTutorial on a game without tutorialDefinition
  // Assert result.success === false, result.error contains 'No tutorial definition'
});
```

---

### `src/session/build-player-state.test.ts` (test, transform) — BoardSmith — new cases

**Analog:** self — existing tutorial field test cases in same file

**Pattern for new case:**
```typescript
it('hasTutorial: true when game has tutorialDefinition', () => {
  // Set runner.game.tutorialDefinition = { steps: [...] }
  // Call buildPlayerState(runner, ...)
  // Assert state.hasTutorial === true
});

it('hasTutorial: absent when game has no tutorialDefinition', () => {
  // Default game, no tutorialDefinition
  // Assert !('hasTutorial' in state) or state.hasTutorial === undefined
});
```

---

## Shared Patterns

### platformRequest / teaching-action emit (Area 2 operations)
**Source:** `src/ui/components/GameShell.vue` lines 711–750 + `src/ui/components/ControlsMenu.vue` lines 258–301
**Apply to:** `start-tutorial` handling in GameShell + ControlsMenu item template

Each teaching action follows this exact three-layer pattern:
1. `ControlsMenu` emits `'teaching-action'` with a string value; calls `close()`
2. `GameShell.handleTeachingAction` catches the emit, calls `platformRequest(wireOpName, payload)`
3. `bridge.translateOp` converts wire op name to typed `Op`; `shapeResult` formats the response

```typescript
// ControlsMenu (layer 1)
@click="emit('teaching-action', 'start-tutorial'); close()"

// GameShell (layer 2)
} else if (teachAction === 'start-tutorial') {
  try {
    await platformRequest('start-tutorial', { seat: playerSeat.value });
  } catch {
    toast.error('Failed to start tutorial.');
  }
}

// bridge.ts (layer 3)
case 'start-tutorial': return { type: 'startTutorial', player: seat };  // translateOp
case 'start-tutorial': return { success: result.success, error: result.error }; // shapeResult
```

### ElementRef precedence matching
**Source:** `src/ui/composables/useBoardInteraction.ts` lines 207–217 (matchesRef) + `src/engine/tutorial/types.ts` lines 31–45 (ElementRef doc)
**Apply to:** `selectionMatchesValue` helper in `gate.ts`

Precedence: `id` wins, then `notation`, then `name`. When the `SelectionMatcher` contains one of these keys, only that field is checked. When none of these keys are present, all matcher keys are compared via field equality (for `DestinationChoice`-style objects).

### advanceWhen predicate style
**Source:** `src/testing/tutorial-ci-demo.test.ts` lines 183–194 + `src/engine/tutorial/types.ts` lines 213–226
**Apply to:** All `advanceWhen` entries in `CHECKERS_TUTORIAL`

```typescript
advanceWhen: {
  'human-readable label describing the condition': (ctx): boolean => {
    const game = ctx.game as SpecificGame;
    // ...
    return booleanValue;
  },
},
```
Keys are human-readable labels (shown in debug traces on failure). Return type is `boolean` (not `boolean | undefined`). No mutations to game state.

### Tutorial gate allow-list structure
**Source:** `src/engine/tutorial/types.ts` lines 118–131 (current) + `src/testing/tutorial-ci-demo.test.ts` lines 178–196
**Apply to:** All `gate:` entries in `CHECKERS_TUTORIAL`

Simple gate (no per-selection restriction): `{ action: 'move' }`
Per-selection gate (Phase 109): `{ action: 'move', selections: { piece: { id: N }, destination: { toNotation: 'X' } } }`

### Test scenario structure
**Source:** `src/testing/tutorial-ci-demo.test.ts` lines 212–223
**Apply to:** `WALKTHROUGH` in `tests/tutorial.test.ts` (checkers)

```typescript
const WALKTHROUGH: TutorialScenarioMove[] = [
  { action: 'move', args: {...}, expectStep: 'next-step-id' },  // seat-1 (default)
  { seat: 2, action: 'move', args: {...} },                     // seat-2 (explicit)
  { seat: 2, action: 'endTurn' },
];
```
Seat-2 turns are MANDATORY whenever the checkers `eachPlayer` flow requires it — include them after every seat-1 `endTurn` to prevent "Not Player N's turn" throws.

---

## No Analog Found

All files in this phase have close analogs. No cases where the planner must fall back to RESEARCH.md patterns alone.

---

## Critical Pitfalls (for planner to note in plan actions)

| Pitfall | File | What to Avoid |
|---------|------|---------------|
| `CheckerPiece` has no `.notation` | `tutorial.ts` gate for 'piece' selection | Never use `{ notation: 'c3' }` for piece gate; always use `{ id: N }` |
| `whenForced('move')` for mandatory capture | `tutorial.ts` capture-tip step | Use custom `advanceWhen: { playerHasCaptures }` instead |
| Missing seat-2 turns in CI scenario | `tests/tutorial.test.ts` WALKTHROUGH | Include `{ seat: 2, action: 'move', ... }` + `{ seat: 2, action: 'endTurn' }` after every seat-1 `endTurn` |
| `advanceWhen` fires before teaching beat shown | `tutorial.ts` capture-tip step | Design preset so capture is only forced AFTER the first action (not from game start) |
| `endTurn` deadlock with move-only gate | `tutorial.ts` non-capture steps | Include explicit `{ id: 'confirm-turn', gate: { action: 'endTurn' } }` step after move sequences |
| `from`/`to` fields still present | `gate.ts` logic | Remove old `from`/`to` logic entirely when adding `selections` — no deprecation |

---

## Metadata

**Analog search scope:** `src/engine/tutorial/`, `src/engine/action/`, `src/session/`, `src/cli/dev-host/`, `src/ui/components/`, `src/testing/`, `~/BoardSmithGames/checkers/src/rules/`, `~/BoardSmithGames/checkers/tests/`
**Files scanned:** 18
**Pattern extraction date:** 2026-06-28
