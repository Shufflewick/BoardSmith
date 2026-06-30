# Teaching & Tutorials

This guide is the single authoring reference for BoardSmith's teaching primitives. It covers how to write a tutorial, author predicate triggers that auto-advance steps, verify your tutorial in CI, surface AI-powered hints and a narrated AI-vs-AI demo, add per-action help text, and lock down teaching features for competitive sessions.

Two games are used throughout as side-by-side worked examples: **checkers** (grid game, notation anchors) and **go-fish** (card game, name anchors). Reading both examples together reveals the parity contract every UI must honor.

---

## 1. Authoring a Tutorial

### The TutorialDefinition shape

Attach a tutorial to your game definition via the `tutorial` field. It takes a `TutorialDefinition`:

```typescript
// src/engine/tutorial/types.ts
export interface TutorialDefinition {
  steps: TutorialStep[];
  setup?: (game: Game) => void;
}
```

`steps` is the ordered sequence of teaching beats. `setup` is an optional callback called by `startTutorial` immediately before the first step activates — use it to put the board into a deterministic preset so the teaching beats are always meaningful regardless of what game was running before the learner opened the tutorial.

```typescript
// ~/BoardSmithGames/checkers/src/rules/tutorial.ts
export const CHECKERS_TUTORIAL: TutorialDefinition = {
  setup: (game) => (game as CheckersGame).resetToTutorialPreset(),
  steps: [ /* ... */ ],
};

// ~/BoardSmithGames/go-fish/src/rules/tutorial.ts
export const GO_FISH_TUTORIAL: TutorialDefinition = {
  setup: (game) => (game as GoFishGame).resetToTutorialPreset(),
  steps: [ /* ... */ ],
};
```

### TutorialStep fields

Each step is a `TutorialStep`:

```typescript
// src/engine/tutorial/types.ts
export interface TutorialStep {
  id: string;                          // unique identifier within this tutorial
  gate: TutorialGate;                  // restricts the learner's legal action set
  content?: Annotation[];              // annotation overlay content for this step
  advanceWhen?: TutorialAdvanceCondition; // predicate that auto-advances to the next step
  suppressAutoFill?: boolean;          // prevent auto-fill of single-enabled choices
  suppressAutoFillFor?: string;        // scope suppressAutoFill to one named selection
}
```

- **`id`** — used as the key in `TutorialProgress.stepId` and surfaced to the client in `TutorialStepView.stepId`.
- **`gate`** — the learner may only perform actions that pass this gate (details below).
- **`content`** — annotation overlays shown during this step. Absent means no annotation.
- **`advanceWhen`** — a labeled predicate record; when all predicates return `true` the tutorial automatically advances. Evaluated by the same `evaluateConditionWithTrace` evaluator used by action `ObjectCondition`, giving consistent debug traces.
- **`suppressAutoFill`** — when `true`, prevents the engine's auto-fill of single-enabled selections for this step. Use when the teaching goal is for the learner to explicitly click a piece or choice; auto-fill would skip the teaching beat before the learner interacts. When `suppressAutoFillFor` is also set, suppression is scoped to that one named selection.

### Action gating

A step's `gate` is either a declarative **allow-list** or a **labeled predicate condition**.

**Allow-list (TutorialGateAllowList)** — the pit-of-success path:

```typescript
// src/engine/tutorial/types.ts
export interface TutorialGateAllowList {
  action: string;
  selections?: Record<string, SelectionMatcher>;
}
```

`action` is the only action name permitted on this step. `selections` optionally restricts individual selection values. Each value in `selections` is a `SelectionMatcher`: field-equality matching against the selection value.

**SelectionMatcher matching rules** (from `src/engine/tutorial/gate.ts`, `selectionMatchesValue`):

| Value type | Matcher form | How it matches |
|---|---|---|
| Element (object with `id`/`notation`/`name`) | `{ id: 42 }` | `id` field wins; `notation` next; `name` last |
| Choice object (e.g. `{ toNotation: 'd4' }`) | `{ toNotation: 'd4' }` | all matcher fields must equal corresponding fields |
| Primitive string/number (e.g. `'7'`, `2`) | `{ value: '7' }` | strict `===` equality; number `7` does NOT match string `'7'` |

The `{ value: primitiveValue }` form was added in v4.2 (Phase 112) to support `chooseFrom()` actions that return primitive strings or numbers as choices — the primary use case being rank selection in card games.

**Examples from the real games:**

```typescript
// Checkers: gate piece by name, no destination restriction
// ~/BoardSmithGames/checkers/src/rules/tutorial.ts
gate: {
  action: 'move',
  selections: {
    piece: { name: TUTORIAL_PIECE_NAME },  // 'tutorial-p1'
  },
},
suppressAutoFill: true,
```

```typescript
// Go Fish: gate ask to opponent seat 2 (player-choice object) and rank '7' (primitive string)
// ~/BoardSmithGames/go-fish/src/rules/tutorial.ts
gate: {
  action: 'ask',
  selections: {
    target: { value: 2 },   // opponent at seat 2; { value, display } choice object
    rank: { value: '7' },   // rank '7' as primitive string (v4.2 matcher fix)
  },
},
suppressAutoFill: true,
```

**Labeled-predicate gate (TutorialGateCondition)** — an escape hatch when the allow-list is insufficient:

```typescript
// src/engine/tutorial/types.ts
export type TutorialGateCondition = Record<string, (ctx: TutorialGateContext) => boolean>;
```

All predicates must return `true` for the gate to pass (AND semantics). The failing label is surfaced in disabled-reason strings.

### Gate context

Both gate predicates and `advanceWhen` predicates receive a `TutorialGateContext`:

```typescript
// src/engine/tutorial/types.ts
export interface TutorialGateContext {
  game: Game;   // current game instance — read-only; do NOT mutate
  seat: number; // 1-indexed seat of the tutorial learner
}
```

**Important:** `TutorialGateContext` has `game` and `seat` only. There is no `lastActionResult`. All predicates must derive their signal from game state alone — reading `game.someProperty`, calling `game.getPlayer(seat)`, etc.

### Tutorial lifecycle and the ControlsMenu

The lifecycle methods live on `GameSession`:

```typescript
// src/session/game-session.ts
session.startTutorial(seat)   // activates step 1, runs auto-advance pump, broadcasts
session.advanceTutorial(seat) // moves to next step (or sets 'completed' on last step)
session.skipTutorial(seat)    // same forward move as advance; same semantics
session.exitTutorial(seat)    // sets status 'exited'; gate enforcement is lifted
```

`TutorialProgress.status` progresses through: `'running'` → `'completed'` (all steps passed) or `'exited'` (learner quit early). Gate enforcement is active only when `status === 'running'`.

The ControlsMenu shows a **"Start tutorial"** option automatically whenever `gameDefinition.tutorial` exists. No extra UI wiring is needed — the substrate handles it.

### Annotation overlay targets

A step's `content` is an array of `Annotation` objects. Each annotation combines explanatory text with an optional `AnnotationTarget`:

```typescript
// src/engine/tutorial/types.ts
export type AnnotationTarget =
  | { kind: 'element'; ref: ElementRef }   // highlight a board element
  | { kind: 'action'; actionName: string } // highlight an action button
  | { kind: 'panel' };                     // highlight the action panel as a whole
```

`ElementRef` carries `{ id?, name?, notation? }` — at least one field must be set. The overlay resolution precedence is `id` > `notation` > `name` (mirroring `matchesRef` in `useBoardInteraction`).

```typescript
// Annotation on a board square (checkers, by notation):
{
  text: `Jump to ${TUTORIAL_LAND1_NOTATION} to capture!`,
  target: { kind: 'element', ref: { notation: TUTORIAL_LAND1_NOTATION } },
}

// Annotation on a named card (go-fish, by name):
{
  text: 'Ask your opponent for a rank you hold. Select a 7 and ask your opponent!',
  target: { kind: 'element', ref: { name: '7H' } },
  placement: 'top',
}
```

The `placement` field is optional; `'auto'` (default) anchors near the target element when one is present.

---

## 2. Predicate Triggers

`advanceWhen` is a labeled predicate record. All predicates must pass simultaneously (AND semantics). Evaluation happens post-action via the shared `evaluateConditionWithTrace` evaluator.

### Writing inline predicates

```typescript
// Advance when continuingPiece is set (checkers multi-jump detected)
// ~/BoardSmithGames/checkers/src/rules/tutorial.ts
advanceWhen: {
  'capture executed, more jumps available': (ctx): boolean => {
    return (ctx.game as CheckersGame).continuingPiece !== null;
  },
},

// Advance when the learner's hand grows (go-fish ask hit)
// ~/BoardSmithGames/go-fish/src/rules/tutorial.ts
advanceWhen: {
  'got cards from ask': (ctx): boolean => {
    const game = ctx.game as GoFishGame;
    const learner = game.getPlayer(ctx.seat) as GoFishPlayer;
    return game.getPlayerHand(learner).count(Card) > 3;
  },
},
```

### Predicate helpers from boardsmith/testing

Three named helpers ship in `src/engine/tutorial/predicates.ts` for common patterns:

```typescript
import { afterFirstTurn, afterTurns, whenForced } from 'boardsmith';

// Advance after the learner's first action:
{ id: 'intro', gate: { action: 'move' }, advanceWhen: { ...afterFirstTurn() } }

// Advance after the learner has made 3 moves:
{ id: 'practice', gate: { action: 'move' }, advanceWhen: { ...afterTurns(3) } }

// Advance when an action becomes the ONLY option:
{ id: 'forced-action', gate: { action: 'capture' }, advanceWhen: { ...whenForced('capture') } }
```

`afterTurns(n)` reads `game.getFlowState().position` (`iterations` + `playerIndex`). It assumes the learner acts first within each round and requires an outer `loop` node. If either assumption does not hold, write a custom predicate instead.

`whenForced(actionName)` fires when `game.getAvailableActions(player)` returns exactly one action matching `actionName`. Do not use it as a substitute for a custom predicate that reads a specific game property (see the checkers `capture-tip` step, which uses `playerHasCaptures` directly because `move` is never the sole available action — `endTurn` is always also offered).

### Auto-advance caveat (R-05)

When a step's `advanceWhen` is already true at the moment the tutorial starts (or immediately after the previous step fires), the auto-advance pump advances through it in the same pump iteration. The step IS taught — it transitions — but it may not appear separately in `simulateTutorial`'s `stepsVisited` if the pump advances past it before the step snapshot is captured. This is a known dwell-time UX limitation (R-05 backlog). Design teaching beats that require at least one learner action to advance whenever possible; instant auto-advance steps are best used as brief contextual tips between interactive beats.

---

## 3. CI-Verifiable Tutorial Tests

### simulateTutorial and assertTutorialCompletes

Import from `boardsmith/testing`:

```typescript
import {
  TestGame,
  simulateTutorial,
  assertTutorialCompletes,
  assertTutorialStep,
} from 'boardsmith/testing';
import type { TutorialScenarioMove } from 'boardsmith/testing';
```

**Pattern:**

```typescript
const testGame = TestGame.create(MyGame, {
  playerCount: 2,
  seed: 'pinned-seed',    // reproducible
  tutorialSetup: true,    // applies your game's tutorial board preset
});

const scenario: TutorialScenarioMove[] = [
  { action: 'move', args: { ... }, expectStep: 'step-2-id' },
  { action: 'endTurn' },
];

const result = simulateTutorial(testGame, MY_TUTORIAL, {
  seat: 1,
  scenario,
  seed: 'pinned-seed',
});

assertTutorialCompletes(result);

// Assert specific teaching beats were visited
expect(result.stepsVisited).toContain('step-1-id');
expect(result.stepsVisited).toContain('step-2-id');
```

`simulateTutorial` runs the scripted scenario through the engine's own `autoAdvanceTutorial` pump and `getTutorialDisabledActions` gate — no second evaluator. Three drift dimensions are detected:

1. **Gate drift** — a scripted action excluded by the active step's gate throws with the step id and gate reason.
2. **Predicate drift** — a move with `expectStep` set throws `"Tutorial drift (predicate): ..."` if `advanceWhen` did not advance to that step.
3. **Non-completion** — `assertTutorialCompletes` throws if `result.completed` is false.

### The green→red demonstration

The tutorial test is a **living regression test** for the game rules it teaches. If a rule change breaks the mechanic the tutorial covers, the test goes red — proving the tutorial is authored against real engine behavior.

**Checkers example** (`~/BoardSmithGames/checkers/tests/tutorial.test.ts`):

```typescript
// RED: mandatory-capture rule removed
it('break: playerHasCaptures patched to false → tutorial stalls at capture-tip', () => {
  const testGame = TestGame.create(CheckersGame, {
    playerCount: 2,
    seed: 'checkers-tutorial-pinned',
    tutorialSetup: true,
  });
  // ... build args from intact state first ...

  // Simulate removing the mandatory-capture rule.
  // capture-tip.advanceWhen calls game.playerHasCaptures(player) → false → never fires.
  testGame.game.playerHasCaptures = () => false;

  expect(() =>
    simulateTutorial(testGame, CHECKERS_TUTORIAL, { seat: 1, scenario: WALKTHROUGH }),
  ).toThrow(/Tutorial drift/);
});
```

**Go Fish example** (`~/BoardSmithGames/go-fish/tests/tutorial.test.ts`):

```typescript
// RED: book-formation rule removed
it('break (primary): checkForBooks patched to never score → tutorial stalls at book-formed', () => {
  const testGame = TestGame.create(GoFishGame, {
    playerCount: 2,
    seed: 'go-fish-tutorial-pinned',
    tutorialSetup: true,
  });

  // Simulate removal of book-formation. player.bookCount is incremented ONLY
  // inside checkForBooks, so this patch is the sole change needed.
  testGame.game.checkForBooks = () => [];

  expect(() => {
    const result = simulateTutorial(testGame, GO_FISH_TUTORIAL, {
      seat: 1,
      scenario: /* two-ask walkthrough */,
    });
    // book-formed.advanceWhen (bookCount > 0) never fires → stalls.
    assertTutorialCompletes(result);
  }).toThrow(/Tutorial/);
});
```

**How to write a green→red test for your game:**

1. Write the GREEN test first: full walkthrough, `assertTutorialCompletes` passes.
2. Identify the specific rule each teaching beat depends on (the predicate reads it from game state).
3. In a separate `it`, monkey-patch that rule to break the signal the predicate checks.
4. Assert that `simulateTutorial` or `assertTutorialCompletes` throws. The throw proves the tutorial is authored against real rule behavior — not a fiction.

### Auto-advance caveat in stepsVisited

Steps that auto-advance instantly (because their `advanceWhen` is already true when the pump runs) may not appear in `stepsVisited`. The go-fish `go-fish-tip` step is an example: the pump advances through it immediately after step 2 fires, so it is never the resting step when `recordCurrentStep()` snapshots. Do not assert `stepsVisited.toContain('go-fish-tip')` in the go-fish test; assert only steps that the learner rests on. (R-05 backlog — future improvement will provide per-advance granularity.)

---

## 4. AI Teaching

### Move hints

Call `GameSession.requestHint(seat)` to fetch a move suggestion from an ephemeral MCTS search. The hint is rendered by `HintOverlay` as a highlight ring with a text bubble, cleared automatically after the next action on that seat or after an undo:

```typescript
// src/session/game-session.ts
async requestHint(seat: number): Promise<void>
```

The hint target is derived via the game's `hintTargetFromMove` hook in `GameDefinition.ai`. The hook receives the bot's suggested `BotMove` and returns an `ElementRef` (or `undefined` for a floating bubble):

```typescript
// Checkers: targets the destination square by notation
// ~/BoardSmithGames/checkers/src/rules/index.ts
hintTargetFromMove: (move) => {
  const dest = move.args.destination as { toNotation?: string } | undefined;
  return dest?.toNotation ? { notation: dest.toNotation } : undefined;
},

// Go Fish: targets the suggested rank card-group by name
// ~/BoardSmithGames/go-fish/src/rules/ai.ts
export function getGoFishHintTarget(move: BotMove): { name: string } | undefined {
  const rank = move.args?.rank;
  return rank ? { name: String(rank) } : undefined;
}
// wired in ~/BoardSmithGames/go-fish/src/rules/index.ts:
//   hintTargetFromMove: getGoFishHintTarget,
```

For the hint overlay to anchor to the right element, that element must carry `data-bs-el-name` (or `data-bs-el-notation` / `data-bs-el-id`) in the DOM. See [Section 7: Parity](#7-parity-checkers-vs-go-fish) for how this works in practice.

### AI-vs-AI demo

Call `GameSession.startDemo()` to enter demo mode: all seats are AI-controlled, and each move is announced (narration text broadcast) before it executes. Call `GameSession.stopDemo()` to restore the original AI controller:

```typescript
// src/session/game-session.ts
startDemo(options?: {
  narrator?: (action: string, player: number, args: Record<string, unknown>) => string;
  delay?: number;  // ms between announcement and execution, default 1200
}): void

stopDemo(): void
```

The default narrator formats: `"PlayerName: actionName destination"` — it uses a destination-extraction heuristic (`describeMoveDestination`) rather than dumping JSON. Supply a custom `narrator` for games with rich arg types (objects, nested references) where that heuristic cannot produce a readable move description.

Internally, `startDemo` saves the current `AIController`, builds an all-seats AI controller, installs an `onBeforeMove` hook that sets `#narrationText` and broadcasts before each move, then starts the AI loop. `stopDemo` restores the original controller and clears the narration hook.

**Caveat — AI-seat gating:** The demo affordance requires an AI seat to be present. In the `boardsmith dev` host, the "Follow-active-seat" feature hands control of whichever seat is active to the dev window, removing that seat's AI presence. Driving a seat with Follow-active-seat therefore prevents the demo from running for that seat. This is a dev-host testing caveat, not a production limitation.

### Evaluation heatmap

`GameSession.setHeatmapVisible(seat, visible)` runs an ephemeral MCTS search and shades grid cells with move-quality scores:

```typescript
// src/session/game-session.ts
async setHeatmapVisible(seat: number, visible: boolean): Promise<void>
```

**The heatmap is BOARD-ONLY.** It shades grid cells via `data-bs-el-*` anchors. A gridless card game (like go-fish) has no board cells to shade — the heatmap entries would produce no visible highlights because there are no matching DOM elements. Do not attempt to use the heatmap for move quality visualization in card games; treat it as a grid-game feature only. A card-game move-quality visualization is a deferred future idea.

**Known cosmetic quirk:** The "Show move quality" toggle in the teaching UI is gated on `showHint` (AI present), not on board presence. This means the toggle currently appears for gridless games when the session is unlocked. This is a pre-existing substrate quirk to be fixed in a future release. For now, the toggle appears but the heatmap overlay renders nothing meaningful.

---

## 5. Action Help

Add a help text string to any action via the `.help(text)` builder:

```typescript
// src/engine/action/action-builder.ts
help(text: string): this {
  this.definition.help = text;
  return this;
}
```

This sets `ActionDefinition.help` (declared in `src/engine/action/types.ts`), which propagates through `buildActionMetadata` into `ActionMetadata.help`. The `ActionHelpPopover` component surfaces it as a "?" affordance — hovering or tapping shows the help text.

```typescript
// Example from go-fish: explain the ask action
Action.create('ask')
  .help('Ask another player if they have a card of a specific rank. If they do, you take it and your turn continues.')
  .chooseFrom(...)
```

**Action help is NOT gated by `teachingDisabled`.** It is always available — even when hint, heatmap, demo, and tutorial are locked out. The "Show action help" toggle in the controls menu is gated only on `hasActionHelp` (whether any available action carries a `help` string), not on the teaching lockout flag.

---

## 6. Host Teaching Lockout

### GameSessionOptions.teachingDisabled

Set `teachingDisabled: true` when creating a `GameSession` to lock out the AI teaching features for competitive or restricted sessions:

```typescript
// src/session/game-session.ts
// Options field (line ~116):
teachingDisabled?: boolean;
```

When `teachingDisabled` is `true`, calling any of the following throws immediately with the message `"Teaching features are disabled for this session."`:

- `requestHint(seat)` — move hint
- `setHeatmapVisible(seat, visible)` — evaluation heatmap
- `startDemo(options?)` — AI-vs-AI demo
- `startTutorial(seat)` — tutorial

`exitTutorial(seat)` and per-action `.help()` text are **never** gated by `teachingDisabled`.

The UI reflects the lockout: the Teaching group in the controls menu is hidden when `teachingDisabled` is broadcast via game state.

### The --lock-teaching dev flag

Pass `--lock-teaching` to the dev server to verify your lockout behavior end-to-end:

```bash
boardsmith dev --lock-teaching
```

This sets `lockTeaching: true` in `DevOptions` (wired in `src/cli/commands/dev.ts`), which passes `teachingDisabled: true` to the session. A console message confirms the lockout:

```
Teaching lockout active (--lock-teaching): hint, heatmap, demo, and tutorial are disabled.
```

Use this during development to confirm your competitive sessions hide the right controls and surface the right errors.

---

## 7. Parity: Checkers vs Go Fish

This section shows how checkers (grid game) and go-fish (card game) implement the same teaching primitives using different anchor strategies. The central lesson is at the top; the worked examples follow.

### The parity lesson

Annotation overlays and hint rings anchor to DOM elements via `data-bs-el-*` attributes:

| Attribute | Set when |
|---|---|
| `data-bs-el-id` | element has an `id` |
| `data-bs-el-notation` | element has a `notation` |
| `data-bs-el-name` | element has a `name` |

The overlay resolution module (`src/ui/components/helpers/overlay-utils.ts`, `buildSelector`) resolves these in `id > notation > name` precedence — matching `matchesRef` in `useBoardInteraction`.

**AutoUI renderers emit `data-bs-el-*` automatically** via `useSelectable`/`anchorAttrs` inside `CardRenderer`, `GridBoardRenderer`, and related AutoUI components. You get anchoring for free.

**A custom UI must emit `data-bs-el-*` itself** or overlays and hint rings will float unanchored. The `anchorAttrs` helper from `boardsmith/ui` produces the correct attribute record:

```typescript
// src/ui/composables/useBoardInteraction.ts
export function anchorAttrs(ref: ElementRef): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (ref.id !== undefined) attrs['data-bs-el-id'] = String(ref.id);
  if (ref.notation !== undefined) attrs['data-bs-el-notation'] = String(ref.notation);
  if (ref.name !== undefined) attrs['data-bs-el-name'] = String(ref.name);
  return attrs;
}
```

Spread it with `v-bind` on the element's root node in your custom Vue component.

### Axis 1: Tutorial definition

Both games anchor tutorial annotations to game elements, but via different ref fields:

**Checkers** — board squares carry `notation`; pieces have a `name` but no `notation`. The checkers tutorial gates the piece selection by `name` and the destination annotation by `notation`:

```typescript
// ~/BoardSmithGames/checkers/src/rules/tutorial.ts — Step 2
{
  id: 'execute-capture',
  suppressAutoFill: true,
  gate: {
    action: 'move',
    selections: {
      piece: { name: TUTORIAL_PIECE_NAME },  // 'tutorial-p1'
    },
  },
  content: [
    {
      text: 'Select your piece.',
      target: { kind: 'element', ref: { name: TUTORIAL_PIECE_NAME } },
    },
    {
      text: `Jump to ${TUTORIAL_LAND1_NOTATION} to capture!`,
      target: { kind: 'element', ref: { notation: TUTORIAL_LAND1_NOTATION } },  // 'd4'
    },
  ],
}
```

**Go Fish** — cards are named by their rank+suit (e.g. `'7H'`). The go-fish tutorial anchors the annotation to a specific card by name:

```typescript
// ~/BoardSmithGames/go-fish/src/rules/tutorial.ts — Step 1
{
  id: 'ask-for-rank',
  suppressAutoFill: true,
  gate: {
    action: 'ask',
    selections: {
      target: { value: 2 },   // opponent at seat 2; { value, display } choice object — matched via field equality
      rank: { value: '7' },   // rank '7' as primitive string — matched via the { value } primitive branch
    },
  },
  content: [
    {
      text: 'Ask your opponent for a rank you hold. Select a 7 and ask your opponent!',
      target: { kind: 'element', ref: { name: '7H' } },
      placement: 'top',
    },
  ],
}
```

### Axis 2: Overlay anchoring

**Checkers** uses `GridBoardRenderer` (AutoUI). Grid squares emit `data-bs-el-notation` automatically via `cellAttrs` in the AutoUI renderer — no custom code required.

**Go Fish** uses a custom `GameTable.vue`. It must emit `anchorAttrs` explicitly. The go-fish custom UI spreads `anchorAttrs` on both individual cards and the rank card-group (the clickable group the learner interacts with to select a rank):

```vue
<!-- ~/BoardSmithGames/go-fish/src/ui/components/GameTable.vue -->
<script setup lang="ts">
import { anchorAttrs } from 'boardsmith/ui';
</script>

<template>
  <!-- rank card-group: hint ring anchors here via { name: rank } -->
  <div
    v-for="[rank, cards] of myCardsByRank"
    class="card-group"
    v-bind="anchorAttrs({ name: rank })"
    @click="handleCardClick(rank)"
  >
    <!-- individual card: annotation ring anchors here via { id, name: rank+suit } -->
    <div
      v-for="card in cards"
      class="card"
      v-bind="anchorAttrs({ id: card.id, name: `${card.rank}${card.suit}` })"
    >
      <!-- card content -->
    </div>
  </div>
</template>
```

The rank group carries `data-bs-el-name` with the rank string (e.g. `'7'`). The hint target from `getGoFishHintTarget` returns `{ name: rank }`, so `buildSelector` resolves to `[data-bs-el-name="7"]` — matching the rank group's node. Without this `v-bind`, the hint ring floats in the center of the screen with no visual anchor.

### Axis 3: Hint target

Both games implement `hintTargetFromMove` in their `GameDefinition.ai` block. The hook returns an `ElementRef` that the hint overlay uses to anchor its ring:

| Game | Hook return | Anchors to |
|---|---|---|
| Checkers | `{ notation: dest.toNotation }` | destination square (e.g. `d4`) |
| Go Fish | `{ name: String(rank) }` | rank card-group (e.g. rank `'7'`) |

```typescript
// Checkers: ~/BoardSmithGames/checkers/src/rules/index.ts
hintTargetFromMove: (move) => {
  const dest = move.args.destination as { toNotation?: string } | undefined;
  return dest?.toNotation ? { notation: dest.toNotation } : undefined;
},

// Go Fish: ~/BoardSmithGames/go-fish/src/rules/ai.ts (wired via index.ts)
export function getGoFishHintTarget(move: BotMove): { name: string } | undefined {
  const rank = move.args?.rank;
  return rank ? { name: String(rank) } : undefined;
}
```

For the checkers hint to work, the destination square must carry `data-bs-el-notation`. `GridBoardRenderer` emits this automatically. For the go-fish hint to work, the rank card-group must carry `data-bs-el-name`. The custom `GameTable.vue` emits this via `v-bind="anchorAttrs({ name: rank })"`.

### CI tests for both games

Both tutorials are verified by CI tests that walk the full tutorial and assert `assertTutorialCompletes`:

- `~/BoardSmithGames/checkers/tests/tutorial.test.ts` — walks capture-tip → execute-capture → multi-jump-continue → confirm-turn; includes a green→red break (mandatory-capture rule removed).
- `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` — walks ask-for-rank → turn-continuation → book-formed via two seat-1 asks; includes green→red breaks (book-formation removed; turn continuation disabled).

### Summary: anchoring rules for new games

| Game type | How to anchor overlays/hints | Who emits the attributes |
|---|---|---|
| Grid game using AutoUI | Annotate by `{ notation }` on squares, `{ name }` on pieces | AutoUI `GridBoardRenderer` — automatic |
| Card game using AutoUI | Annotate by `{ name }` on cards | AutoUI `CardRenderer` — automatic |
| Any game with a custom UI | Spread `v-bind="anchorAttrs({ id, name, notation })"` on each interactive element | **Your custom UI — manual, required** |

If you have a custom UI and skip `anchorAttrs`, annotation rings and hint bubbles will render without a visual anchor — they will float rather than pointing at the right element. This is the lesson from the go-fish v4.2 work: AutoUI gets it for free; custom UIs must opt in.
