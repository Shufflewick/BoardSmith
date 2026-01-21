# Dice Aspect

**Documentation:** Read `docs/dice-and-scoring.md` before using this template.

## Element Setup (game.ts)

```typescript
import { Game, Die, type GameOptions } from 'boardsmith';
import { DicePool, MyPlayer } from './elements.js';

export class MyGame extends Game<MyGame, MyPlayer> {
  dicePool!: DicePool;

  // HMR-SAFE: Use a getter to access dice, not a stored array
  // WRONG: dice: Die[] = [];  // Won't survive hot reload!
  // CORRECT: Query the element tree each time
  get dice(): Die[] {
    return this.dicePool?.all(Die) ?? [];
  }

  constructor(options: MyGameOptions) {
    super(options);

    this.registerElements([DicePool, Die]);

    // Create dice pool and dice
    this.dicePool = this.create(DicePool, 'dice-pool');
    this.dicePool.createMany(2, Die, 'd6', { sides: 6 });
  }
}
```

## Elements (elements.ts)

```typescript
import { Space, Player } from 'boardsmith';
import type { MyGame } from './game.js';

export class DicePool extends Space<MyGame, MyPlayer> {}

export class MyPlayer extends Player {
  score: number = 0;
}
```

## Roll Action Pattern (actions.ts)

```typescript
import { Action, Die, type ActionDefinition } from 'boardsmith';
import type { MyGame } from './game.js';

export function createRollAction(game: MyGame): ActionDefinition {
  return Action.create('roll')
    .prompt('Roll the dice')
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      const dice = currentGame.dicePool.all(Die);

      let total = 0;
      for (const die of dice) {
        const rolled = die.roll();  // Returns value AND triggers animation
        total += rolled;
      }

      currentGame.message(`${ctx.player.name} rolled ${total}!`);
      return { success: true };
    });
}
```

## Custom UI Component (GameBoard.vue)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { Die3D, findElements, getPlayerAttribute, type UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

// findElements searches the entire tree recursively
const dice = computed(() => {
  if (!props.gameView) return [];
  return findElements(props.gameView, { className: 'Die' });
});

// Access custom player attributes from the element tree
// NOTE: gameView.players is for display only (names, basic info)
// For custom attributes, use getPlayerAttribute() which searches the element tree
const myScore = computed(() => getPlayerAttribute(props.gameView, props.playerPosition, 'score', 0));

// Game over detection - check isFinished property (NOT a method call)
const isGameOver = computed(() => props.gameView?.isFinished ?? false);
const winners = computed(() => props.gameView?.settings?.winners ?? []);
const didIWin = computed(() => winners.value.includes(props.playerPosition));

// Check if roll action is available
const canRoll = computed(() => props.availableActions.includes('roll'));

// Handle roll - use execute() since roll takes no input
function handleRoll() {
  props.actionController.execute('roll', {});
}
</script>

<template>
  <div class="game-board">
    <!-- Game Over Panel -->
    <div v-if="isGameOver" class="game-over-panel">
      <h2 class="game-over-title">{{ didIWin ? 'You Win!' : 'Game Over' }}</h2>
    </div>

    <template v-else>
      <div class="dice-area">
        <!-- CORRECT: Die3D always renders, with safe defaults via ?? -->
        <!-- WRONG: <Die3D v-if="die" ... /> hides die when not found -->
        <Die3D
          v-for="(die, index) in dice"
          :key="die?.id ?? `die-${index}`"
          :sides="die?.attributes?.sides ?? 6"
          :value="die?.attributes?.value ?? 1"
          :roll-count="die?.attributes?.rollCount ?? 0"
          :die-id="die?.id ?? `die-${index}`"
          :size="80"
        />
        <!-- Fallback if no dice found (still shows something) -->
        <Die3D
          v-if="dice.length === 0"
          :sides="6"
          :value="1"
          :roll-count="0"
          die-id="placeholder"
          :size="80"
        />
      </div>

      <button
        v-if="canRoll && isMyTurn"
        @click="handleRoll"
        class="roll-button"
      >
        Roll Dice
      </button>

      <p v-if="!isMyTurn" class="waiting">Waiting for other player...</p>
    </template>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 20px;
}

.game-over-panel {
  text-align: center;
  padding: 40px;
}

.game-over-title {
  font-size: 2.5rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.dice-area {
  display: flex;
  gap: 16px;
  justify-content: center;
  min-height: 100px;
}

.roll-button {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  border: none;
  padding: 12px 32px;
  border-radius: 8px;
  font-weight: bold;
  font-size: 1.1rem;
  cursor: pointer;
}

.roll-button:hover {
  transform: scale(1.05);
}

.waiting {
  color: #888;
}
</style>
```

## Key Rules

1. **Always use `die.roll()`** - Returns value AND triggers animation. Never use `Math.random()`.
2. **Use `findElements()`** - Searches entire tree recursively to find nested elements.
3. **No `v-if` on Die3D** - Always render with `??` fallbacks.
4. **Pass `:roll-count`** - Required for animation to work.
5. **Use `execute()` for roll** - Roll takes no user input.
6. **HMR-safe element access** - Use getters (`get dice()`) not stored arrays (`dice: Die[] = []`).
7. **Player attributes** - Use `getPlayerAttribute()` to access custom player properties from the element tree.
