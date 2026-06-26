# Phase 107: AI-Assisted Teaching - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 16 (8 new, 8 modified)
**Analogs found:** 16 / 16

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ai/mcts-bot.ts` | service | request-response | `src/ai/mcts-bot.ts` (existing `playSingle()`) | self — extend |
| `src/ai/types.ts` | model | — | `src/ai/types.ts` (existing `AIConfig`, `BotMove`) | self — extend |
| `src/ai/index.ts` | config/export | — | `src/ai/index.ts` | self — extend |
| `src/session/ai-controller.ts` | service | request-response | `src/session/ai-controller.ts` (existing `checkAndPlay`) | self — extend |
| `src/session/game-session.ts` | service | CRUD + event-driven | `src/session/game-session.ts` (existing `broadcast()`, `#checkAITurn`) | self — extend |
| `src/session/types.ts` | model | — | `src/session/types.ts` (`PlayerGameState.tutorial` field) | self — extend |
| `src/ui/components/helpers/HintOverlay.vue` | component | request-response | `src/ui/components/helpers/TutorialOverlay.vue` | exact role+flow |
| `src/ui/components/helpers/HeatmapOverlay.vue` | component | request-response | `src/ui/components/helpers/TutorialOverlay.vue` | exact role+flow |
| `src/ui/components/helpers/BoardMessage.vue` | component | request-response | `src/ui/components/helpers/BoardMessage.vue` (annotation variant) | self — extend |
| `src/ui/components/GameShell.vue` | component | event-driven | `src/ui/components/GameShell.vue` (TutorialOverlay mount) | self — extend |
| `src/ui/components/ControlsMenu.vue` | component | event-driven | `src/ui/components/ControlsMenu.vue` (Session group) | self — extend |
| `src/ai/mcts-stats.test.ts` | test | — | `src/ai/mcts-restore.test.ts` | exact |
| `src/session/teaching.test.ts` | test | — | `src/session/tutorial-controller.test.ts` | exact |
| `src/session/ai-controller.test.ts` | test | — | `src/session/ai-circuit-breaker.test.ts` | exact |
| `src/ui/components/helpers/HintOverlay.test.ts` | test | — | `src/ui/components/helpers/TutorialOverlay.test.ts` | exact |
| `src/ui/components/helpers/HeatmapOverlay.test.ts` | test | — | `src/ui/components/helpers/TutorialOverlay.test.ts` | exact |

---

## Pattern Assignments

---

### `src/ai/mcts-bot.ts` — extend: add `runSearch()` + `playWithStats()`

**Analog:** `src/ai/mcts-bot.ts` — `playSingle()` (lines 174–342)

**Extraction seam — current `play()` dispatch** (lines 93–98):
```typescript
async play(): Promise<BotMove> {
  if (this.config.parallel && this.config.parallel > 1) {
    return this.playParallel();
  }
  return this.playSingle();
}
```
After: `play()` calls `runSearch()` (new private), returns `{ move }` only.

**Critical discard point** (lines 291–293 of `playSingle()`):
```typescript
// Cleanup search state — stats MUST be captured before this:
this.searchGame = null;
this.rootSnapshot = null;

// Select best child (most visits for robustness)
```
The `root` node is a local variable in `playSingle()`. `runSearch()` must return `{ move, root }` to the caller BEFORE nulling `searchGame`/`rootSnapshot`. The cleanup moves into `runSearch()` but after the `root` reference is returned.

**Best-child selection pattern** (lines 295–341 of `playSingle()`):
```typescript
if (root.children.length === 0) {
  return this.rng.pick(moves);
}
// PNS proven-win fast path (lines 309–333)...
// Fall back to most visits:
const best = root.children.reduce((a, b) =>
  a.visits > b.visits ? a : b
);
return best.parentMove!;
```
This entire block moves into `runSearch()` and the return value becomes `{ move: best.parentMove!, root }`.

**New `playWithStats()` core pattern** (from RESEARCH.md Pattern 1):
```typescript
async playWithStats(): Promise<{ move: BotMove; stats: BotMoveStats[] }> {
  // Force single search — parallel mode loses per-child stats across independent trees.
  const { move, root } = await this.runSearch();
  const stats: BotMoveStats[] = root.children.map(child => ({
    move: child.parentMove!,
    visits: child.visits,
    value: child.visits > 0 ? child.value / child.visits : 0,
  }));
  return { move, stats };
}
```

**Import pattern** (lines 1–14):
```typescript
import type { BotConfig, BotMove, MCTSNode, AIConfig, Objective, ThreatResponse } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
```
After: also import `BotMoveStats` from `'./types.js'`.

---

### `src/ai/types.ts` — extend: add `BotMoveStats`, `hintTargetFromMove`

**Analog:** `src/ai/types.ts` — `BotMove` interface (lines 41–49), `AIConfig` interface (lines 116–194)

**BotMove pattern to copy** (lines 44–49):
```typescript
export interface BotMove {
  /** The action name to perform */
  action: string;
  /** The arguments for the action */
  args: Record<string, unknown>;
}
```
New `BotMoveStats` follows the same JSDoc-per-field style, placed immediately after `BotMove`.

**AIConfig extension insertion point** (after `moveOrdering` at line 174 / before `uctConstant`):
```typescript
  /**
   * Optional function to identify move-target extraction for hint and heatmap.
   * ...
   */
  moveOrdering?: (game: Game, playerIndex: number, moves: BotMove[]) => BotMove[];

  // INSERT hintTargetFromMove here (before uctConstant)

  uctConstant?: (game: Game, playerIndex: number) => number;
```

---

### `src/session/ai-controller.ts` — extend: add `onBeforeMove` param

**Analog:** `src/session/ai-controller.ts` — full `checkAndPlay()` (lines 70–144)

**Current `checkAndPlay` signature** (lines 70–74):
```typescript
async checkAndPlay(
  runner: GameRunner<G>,
  actionHistory: SerializedAction[],
  onMove: (action: string, player: number, args: Record<string, unknown>) => Promise<boolean>
): Promise<{ action: string; player: number; args: Record<string, unknown> } | null>
```
After: add optional fourth param `onBeforeMove?`.

**Move execution block** (lines 128–131) — insertion point:
```typescript
// Get the AI's move
const move = await bot.play();

// INSERT: if (onBeforeMove) await onBeforeMove(move.action, aiPlayer, move.args);

// Execute the move via callback
const success = await onMove(move.action, aiPlayer, move.args);
```

**Error handling pattern** (lines 136–141) — unchanged:
```typescript
} catch (error) {
  console.error(`AI error for player ${aiPlayer}:`, error);
  throw error;
} finally {
  this.#thinking = false;
}
```

---

### `src/session/game-session.ts` — extend: broadcast injection + teaching API

**Analog:** `src/session/game-session.ts`

**`broadcast()` injection point** (lines 1579–1611 — full method):
```typescript
broadcast(): void {
  this.#runner.captureCheckpoint();
  if (!this.#broadcaster) return;

  const flowState = this.#runner.getFlowState();
  const sessions = this.#broadcaster.getSessions();

  for (const session of sessions) {
    const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
    const state = buildPlayerState(
      this.#runner, this.#storedState.playerNames, effectivePosition,
      { includeActionMetadata: true, includeDebugData: true }
    );

    // INSERT teaching-state injection here, before send():
    // const hint = this.#hint.get(effectivePosition);
    // if (hint) state.hint = hint;
    // etc.

    const update: StateUpdate = { type: 'state', flowState, state, ... };
    try {
      this.#broadcaster.send(session, update);
    } catch (error) {
      console.error('Broadcast error:', error);
    }
  }
}
```

**`#checkAITurn()` call site** (lines 1636–1667) — shows existing `onMove` callback structure. The `onBeforeMove` hook is provided here via a closure that sets `this.#narrationText` and awaits delay, then clears after the move broadcasts:
```typescript
move = await this.#aiController.checkAndPlay(
  this.#runner,
  this.#storedState.actionHistory,
  async (action, player, args) => {
    const result = this.#runner.performAction(action, player, args);
    if (result.success) {
      this.#storedState.actionHistory = this.#runner.actionHistory;
      // ... tutorial auto-advance ...
      await this.#save();
      this.broadcast();
      return true;
    }
    return false;
  }
  // INSERT: , this.#onBeforeMove  (fourth argument when defined)
);
```

**`replaceRunner` callback** (lines 253–266) — the hook for clearing hint/heatmap on undo:
```typescript
replaceRunner: (newRunner) => {
  // Re-supply tutorial definition...
  if (this.#tutorialDefinition) {
    newRunner.game.tutorialDefinition = this.#tutorialDefinition;
  }
  // INSERT: this.#hint.clear(); this.#heatmap.clear();
},
```

**Existing `#aiController` field** (line 184) — mutable, precedent for demo-mode override:
```typescript
#aiController?: AIController<G>;  // Mutable for dynamic AI slot changes
```

---

### `src/session/types.ts` — extend: add teaching fields to `PlayerGameState`

**Analog:** `src/session/types.ts` — `PlayerGameState.tutorial` field (lines 409–419)

**`tutorial` field as pattern** (lines 409–419):
```typescript
  /**
   * RESERVED (Plan 104-04): Active tutorial step projected for this player.
   *
   * `undefined` when no tutorial is running for this seat. Populated by
   * `buildPlayerState` when `game.tutorialProgress.get(seat)?.status === 'running'`.
   * ...
   */
  tutorial?: TutorialStepView;
```
New `hint`, `heatmap`, `narration` fields follow the same comment block style (session-layer-only, never serialized).

**`disabledActions` field** (line 431) — shows the optional-field-at-end-of-interface pattern:
```typescript
  disabledActions?: Record<string, string>;
}
```
New teaching fields insert before this closing brace, after `disabledActions`.

---

### `src/ui/components/helpers/HintOverlay.vue` — new component

**Analog:** `src/ui/components/helpers/TutorialOverlay.vue` (lines 1–521)

**Identical infrastructure to copy verbatim:**
- `cssEscape()` polyfill (lines 65–71) — or extract to shared `overlay-utils.ts` (RESEARCH anti-pattern)
- `buildSelector()` (lines 115–135) — identical
- `readRadius()` (lines 138–141) — identical
- `measure()` structure (lines 187–268) — adapted for single annotation
- `rebuildObservers()` (lines 276–312) — adapted for single annotation
- `onScroll()` + `watchEffect` + lifecycle hooks (lines 314–346) — identical
- `ringStyle()` helper (lines 350–358) — identical
- `<Teleport to="body">` + overlay root CSS (lines 375–449) — identical with z-index 20
- `.bsg-tutorial-ring` CSS class (lines 452–486) — copy verbatim
- `bsg-ring-in` / `bsg-ring-pulse` keyframes (lines 490–519) — copy verbatim
- `prefers-reduced-motion` rule (lines 516–520) — copy verbatim

**Inject pattern** (lines 98–106):
```typescript
const gameState = inject('gameState') as
  | Ref<{ state: { tutorial?: { content?: Annotation[] } } }>
  | undefined;

const annotations = computed<Annotation[]>(
  () => gameState?.value?.state?.tutorial?.content ?? [],
);
```
HintOverlay adapts to:
```typescript
const gameState = inject('gameState') as
  | Ref<{ state: { hint?: { annotation: Annotation } } }>
  | undefined;

const annotation = computed<Annotation | null>(
  () => gameState?.value?.state?.hint?.annotation ?? null,
);
const hasContent = computed(() => annotation.value !== null);
```

**Template diff from TutorialOverlay:**
- `v-if="hasContent"` on root — same
- No `v-for` — single annotation; `resolved` is `ResolvedAnnotation | null`
- Single `<div class="bsg-tutorial-ring" ...>` + single `<BoardMessage>` (no `v-for`)
- Z-index: 20 (same as TutorialOverlay — both may coexist)
- Chip glyph: `"i"` (same as TutorialOverlay `.bsg-tutorial-ring__chip`)

---

### `src/ui/components/helpers/HeatmapOverlay.vue` — new component

**Analog:** `src/ui/components/helpers/TutorialOverlay.vue` (overlay infrastructure)

**Infrastructure to copy from TutorialOverlay (same as HintOverlay):**
- `cssEscape()` polyfill or shared import from `overlay-utils.ts`
- `buildSelector()` — identical (resolves `data-bs-el-id` anchors)
- `measure()` / `rebuildObservers()` / `onScroll` / lifecycle — adapted for entries array
- `<Teleport to="body">` structure

**Key differences from TutorialOverlay:**
- No `BoardMessage` — chips are visual-only (`aria-hidden="true"`)
- No rings — circle chips centered on cell rects
- Z-index: 15 (below TutorialOverlay/HintOverlay at 20)
- Reads `gameState.state.heatmap?.entries` (array of `HeatmapEntry`); renders only when `heatmap?.visible === true`

**Inject pattern for HeatmapOverlay:**
```typescript
const gameState = inject('gameState') as
  | Ref<{ state: { heatmap?: { visible: boolean; entries: HeatmapEntry[] } } }>
  | undefined;

const entries = computed<HeatmapEntry[]>(
  () => (gameState?.value?.state?.heatmap?.visible
    ? gameState.value.state.heatmap.entries
    : []),
);
const hasContent = computed(() => entries.value.length > 0);
```

**Chip positioning pattern** (derived from TutorialOverlay `measure()` + rect):
```typescript
// In measure(): for each entry
const el = document.querySelector(buildSelector({ kind: 'element', ref: entry.cellRef }));
if (!el) continue;
const rect = el.getBoundingClientRect();
const size = Math.max(24, Math.min(Math.floor(Math.min(rect.width, rect.height) * 0.68), 52));
const cx = rect.left + rect.width / 2;
const cy = rect.top + rect.height / 2;
// chip: position:absolute; left:cx; top:cy; transform:translate(-50%,-50%); w:size; h:size
```

**ResizeObserver pattern** (from TutorialOverlay lines 290–311) — observe `.boardregion` and each resolved `el`:
```typescript
resizeObserver = new ResizeObserver(() => {
  void nextTick(measure);
});
if (boardRegion) {
  resizeObserver.observe(boardRegion);
  // for each resolved entry element:
  resizeObserver.observe(el);
  boardRegion.addEventListener('scroll', onScroll, { passive: true });
}
```

**CSS pattern** (overlay root):
```css
.bsg-heatmap-overlay {
  position: fixed;
  inset: 0;
  z-index: 15;           /* below TutorialOverlay/HintOverlay (20) */
  pointer-events: none;
  overflow: visible;
}
```
Chip CSS uses `color-mix(in srgb, var(--bsg-accent) {intensity}%, transparent)` and `border-radius: var(--bsg-r-pill)`.

---

### `src/ui/components/helpers/BoardMessage.vue` — extend: add `variant="narration"`

**Analog:** `src/ui/components/helpers/BoardMessage.vue` — `variant="annotation"` pattern (lines 60–86, 153–196)

**Existing variant prop pattern** (lines 60–86):
```typescript
variant?: 'default' | 'annotation';
anchorStyle?: Record<string, string>;
caretSide?: 'top' | 'bottom' | 'left' | 'right';
```
After: `variant?: 'default' | 'annotation' | 'narration'`.

**Annotation CSS class binding** (lines 92–103):
```typescript
:class="
  variant === 'annotation'
    ? 'bsg-board-message--annotation'
    : `bsg-board-message--${position}`
"
```
After: three-way condition — `annotation` → annotation class, `narration` → narration class, else position class.

**Annotation content CSS** (lines 186–196):
```css
.bsg-board-message__content--annotation {
  display: block;
  text-align: left;
  padding: var(--bsg-s3) var(--bsg-s4);
  max-width: min(320px, 90vw);
  border-radius: var(--bsg-r-md);
  line-height: var(--bsg-line-normal);
  box-shadow: var(--bsg-shadow);
  position: relative;
}
```
New `.bsg-board-message__content--narration` follows the same card shape. Differences: `background: var(--bsg-surface-3)` (more prominent), `max-width: min(280px, 90%)`, `box-shadow: var(--bsg-shadow-sm)`.

**Overlay wrapper variant** (lines 159–165):
```css
.bsg-board-message--annotation {
  left: auto;
  right: auto;
  width: max-content;
  justify-content: flex-start;
}
```
New `.bsg-board-message--narration`: `top: var(--bsg-s3)` position with horizontal centering (not `left: auto`).

---

### `src/ui/components/GameShell.vue` — extend: mount new overlays

**Analog:** `src/ui/components/GameShell.vue` — TutorialOverlay import + mount (lines 39, 1697–1704)

**Import pattern** (line 39):
```typescript
import TutorialOverlay from './helpers/TutorialOverlay.vue';
```
After: add `HintOverlay` and `HeatmapOverlay` imports in the same block.

**Mount pattern** (lines 1697–1704):
```html
<!-- Tutorial annotation overlay: mounts once here so it appears over BOTH
     the #game-board slot (custom UI) and the dev UI-switcher <component>
     path. Not inside zoom-container so it measures boardregion rects
     unscaled by --zoom-level. -->
<TutorialOverlay />
```
After: add `<HintOverlay />` and `<HeatmapOverlay />` on the lines immediately following `<TutorialOverlay />` — same comment pattern, same placement rationale (outside zoom-container, measures unscaled).

**ControlsMenu teaching props pattern** — existing ControlsMenu wiring (search for `ControlsMenu` in template) shows the existing props; extend with `show-hint`, `hint-disabled`, `is-demo-running`, `is-heatmap-visible` + `@teaching-action` emit handler.

---

### `src/ui/components/ControlsMenu.vue` — extend: add Teaching group

**Analog:** `src/ui/components/ControlsMenu.vue` — Session group (lines 191–214)

**`grouplabel` + separator pattern** (lines 191–193):
```html
<div class="sep"></div>
<div class="grouplabel">Session</div>
```
New "Teaching" group follows the exact same separator-then-grouplabel pattern after the Session group.

**`menuitemcheckbox` toggle pattern** (lines 145–157):
```html
<button
  class="mi"
  type="button"
  role="menuitemcheckbox"
  :aria-checked="autoEndTurn"
  @click="emit('update:autoEndTurn', !autoEndTurn)"
>
  Auto end turn
  <span class="r">
    <span class="toggle" :class="{ on: autoEndTurn }"></span>
  </span>
</button>
```
"Show move quality" uses the identical pattern (same `toggle` CSS, same `:aria-checked`, same `class="mi"`).

**Disabled menuitem pattern** (lines 160–170):
```html
<button
  class="mi"
  type="button"
  role="menuitem"
  :disabled="!canUndo"
  :aria-disabled="!canUndo"
  @click="handleUndo"
>
```
"Get a hint" uses `:disabled="hintDisabled"` with same structure.

**Props pattern** (lines 19–33):
```typescript
const props = withDefaults(defineProps<{
  autoEndTurn: boolean;
  zoom: number;
  canUndo: boolean;
  openUp?: boolean;
  align?: 'left' | 'right';
}>(), { openUp: false, align: 'right' });
```
New teaching props add to this `defineProps<{...}>()` block:
```typescript
showHint?: boolean;        // undefined = hide Teaching group entirely
hintDisabled?: boolean;
isDemoRunning?: boolean;
isHeatmapVisible?: boolean;
```

**Emit pattern** (lines 35–40):
```typescript
const emit = defineEmits<{
  'update:autoEndTurn': [value: boolean];
  'update:zoom': [value: number];
  'undo': [];
  'menu-item-click': [id: string];
}>();
```
Add: `'teaching-action': ['hint' | 'demo-toggle' | 'heatmap-toggle']`.

---

### `src/ai/mcts-stats.test.ts` — new test file (excluded from vitest)

**Analog:** `src/ai/mcts-restore.test.ts` (lines 1–100+)

**Test file structure pattern** (lines 1–58 of `mcts-restore.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, sequence,
         actionStep, execute, loop, eachPlayer, createSnapshot,
         type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

class ExecuteFinishGame extends Game<ExecuteFinishGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('play')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: ['a', 'b', 'c'],    // 3+ choices so MCTS doesn't short-circuit
        })
        .execute((_args, ctx) => { ... })
    );
    this.setFlow(defineFlow({ root: loop({ maxIterations: 20, do: ... }) }));
  }
}
```
New file must add `// @vitest-exclude` comment (per vitest.config.ts exclusion pattern) for the checkers-bot integration tests. Unit tests with TestGame have no exclusion.

**`describe/it/expect` structure** — copy directly from `mcts-restore.test.ts`; same import block, same game class pattern, same `new MCTSBot(game, Game, 'game', 1, [], { iterations: 50 })` constructor invocation.

---

### `src/session/teaching.test.ts` — new test file

**Analog:** `src/session/tutorial-controller.test.ts` (lines 1–60+)

**Test game + GameRunner + controller pattern** (lines 1–28):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Game, Space, Piece, Player, Action, defineFlow, loop, eachPlayer, actionStep,
  type FlowContext,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { TutorialController } from './tutorial-controller.js';
```
Replace `TutorialController` with `GameSession` for teaching tests; same minimal test game class.

**Mock broadcaster pattern** (from `tutorial-controller.test.ts`):
```typescript
const broadcastSpy = vi.fn();
const runner = new GameRunner(game);
runner.startFlow();
// ... pass mock broadcaster to GameSession ...
```

---

### `src/session/ai-controller.test.ts` — new test file

**Analog:** `src/session/ai-circuit-breaker.test.ts` (lines 1–60+)

**AIController direct construction pattern** (lines 1–35 of `ai-circuit-breaker.test.ts`):
```typescript
import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import { AIController } from './ai-controller.js';

class SimpleGame extends Game<SimpleGame, Player> { ... }

const controller = new AIController(
  SimpleGame, 'simple', 2, { players: [1], level: 'easy' }
);
```
New tests invoke `controller.checkAndPlay(runner, [], onMove, onBeforeMove)` with a spy for `onBeforeMove` and assert: spy called, spy called BEFORE `onMove`, delay timing.

---

### `src/ui/components/helpers/HintOverlay.test.ts` — new test file

**Analog:** `src/ui/components/helpers/TutorialOverlay.test.ts` (lines 1–60+)

**jsdom environment + stubs pattern** (lines 1–46):
```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import TutorialOverlay from './TutorialOverlay.vue';

vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
})));
```
HintOverlay test: replace `TutorialOverlay` with `HintOverlay`; `makeGameState` returns `{ state: { hint: { annotation: Annotation } } }` instead of tutorial content.

**`makeGameState` helper pattern** (lines 50–58 of `TutorialOverlay.test.ts`):
```typescript
function makeGameState(content?: Annotation[]) {
  return ref({
    state: {
      tutorial: content ? { stepId: 'step1', content } : { stepId: 'step1' },
    },
  });
}
```
HintOverlay adapts: `makeGameState(annotation?: Annotation)` returning `{ state: { hint: annotation ? { annotation } : undefined } }`.

---

### `src/ui/components/helpers/HeatmapOverlay.test.ts` — new test file

**Analog:** `src/ui/components/helpers/TutorialOverlay.test.ts` — same jsdom stubs + mount/inject pattern.

**Game state shape for heatmap tests:**
```typescript
function makeGameState(entries: HeatmapEntry[], visible = true) {
  return ref({
    state: {
      heatmap: { visible, entries },
    },
  });
}
```
Tests assert: chips present when `visible: true` + entries populated; no chips when `visible: false`; no chips when `entries: []`.

---

## Shared Patterns

### Fixed-Position Overlay Infrastructure
**Source:** `src/ui/components/helpers/TutorialOverlay.vue`
**Apply to:** `HintOverlay.vue`, `HeatmapOverlay.vue`

Core pattern (lines 375–422):
```html
<Teleport to="body">
  <div v-if="hasContent" ref="overlayRoot" class="bsg-*-overlay">
    <!-- rings / chips here, positioned via measure() -->
  </div>
</Teleport>
```
CSS root (lines 443–449):
```css
.bsg-tutorial-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;  /* HintOverlay: 20; HeatmapOverlay: 15 */
  pointer-events: none;
  overflow: visible;
}
```

### `buildSelector` + DOM Anchoring
**Source:** `src/ui/components/helpers/TutorialOverlay.vue` lines 115–135
**Apply to:** `HintOverlay.vue`, `HeatmapOverlay.vue`

```typescript
function buildSelector(target: AnnotationTarget): string {
  switch (target.kind) {
    case 'element': {
      const { ref: elRef } = target;
      if (elRef.id !== undefined)
        return `[data-bs-el-id="${cssEscape(String(elRef.id))}"]`;
      if (elRef.notation !== undefined)
        return `[data-bs-el-notation="${cssEscape(elRef.notation)}"]`;
      if (elRef.name !== undefined)
        return `[data-bs-el-name="${cssEscape(elRef.name)}"]`;
      return '';
    }
    case 'action': return `[data-bs-action="${cssEscape(target.actionName)}"]`;
    case 'panel':  return '[data-bs-panel]';
  }
}
```
**Do not copy-paste** `cssEscape` into each overlay — extract to `src/ui/components/helpers/overlay-utils.ts` and import from there.

### ResizeObserver + Scroll Watcher
**Source:** `src/ui/components/helpers/TutorialOverlay.vue` lines 273–346
**Apply to:** `HintOverlay.vue`, `HeatmapOverlay.vue`

```typescript
let resizeObserver: ResizeObserver | null = null;
let observedElements: Element[] = [];

function rebuildObservers() {
  const boardRegion =
    overlayRoot.value?.closest('.boardregion') ??
    document.querySelector('.boardregion');
  if (resizeObserver) { resizeObserver.disconnect(); observedElements = []; }
  resizeObserver = new ResizeObserver(() => { void nextTick(measure); });
  if (boardRegion) {
    resizeObserver.observe(boardRegion);
    // + observe each resolved target element
    boardRegion.addEventListener('scroll', onScroll, { passive: true });
  }
}
watchEffect(() => {
  const _ = annotations.value;  // establish reactive dependency
  void nextTick(() => { measure(); rebuildObservers(); });
});
onMounted(() => { measure(); rebuildObservers(); });
onUnmounted(() => {
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  const boardRegion = document.querySelector('.boardregion');
  if (boardRegion) boardRegion.removeEventListener('scroll', onScroll);
});
```

### `gameState` Injection
**Source:** `src/ui/components/GameShell.vue` line 666 (provide) + `TutorialOverlay.vue` line 98 (inject)
**Apply to:** `HintOverlay.vue`, `HeatmapOverlay.vue`

```typescript
// GameShell.vue (unchanged):
provide('gameState', state);

// Overlay component:
const gameState = inject('gameState') as Ref<{ state: { ... } }> | undefined;
```

### Session State Injection in `broadcast()`
**Source:** `src/session/game-session.ts` lines 1593–1610
**Apply to:** `hint`, `heatmap`, `narration` injection in Phase 107

```typescript
for (const session of sessions) {
  const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
  const state = buildPlayerState(this.#runner, this.#storedState.playerNames,
    effectivePosition, { includeActionMetadata: true, includeDebugData: true });

  // Inject transient teaching state (Phase 107 addition):
  const hint = this.#hint.get(effectivePosition);
  if (hint) state.hint = hint;
  // ... heatmap, narration ...

  const update: StateUpdate = { type: 'state', flowState, state, ... };
  try { this.#broadcaster.send(session, update); }
  catch (error) { console.error('Broadcast error:', error); }
}
```

### Slate Token CSS Conventions
**Source:** `src/ui/components/helpers/TutorialOverlay.vue` (ring CSS, lines 452–486) + `src/ui/components/helpers/BoardMessage.vue` (content CSS, lines 168–196)
**Apply to:** `HintOverlay.vue`, `HeatmapOverlay.vue`, `BoardMessage.vue` narration variant

Rules:
- No literal color values — use `var(--bsg-*)` tokens only
- No literal spacing values (except the pinned `OFFSET = 3` in ring measurement)
- `font-family: var(--bsg-font)`, `font-size: var(--bsg-text-xs/sm)`, `font-weight: 600`
- `border-radius: var(--bsg-r-pill)` for circle/pill shapes, `var(--bsg-r-md)` for cards

---

## No Analog Found

All 16 files have strong analogs in the codebase. No file requires pattern invention.

---

## Metadata

**Analog search scope:** `src/ai/`, `src/session/`, `src/ui/components/helpers/`, `src/ui/components/`
**Files scanned:** 16 analog files read directly; 8 auxiliary files grep-inspected
**Pattern extraction date:** 2026-06-26
