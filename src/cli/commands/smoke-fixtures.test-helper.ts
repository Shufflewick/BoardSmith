/**
 * FIXTURE GAMES FOR THE SMOKE WALK (#457 to #467), written over the table scaffold that
 * `smokeProject` makes (its game is `dev-game`, so its classes are `DevGameGame` and
 * `DevGamePlayer`).
 */

/** A smoke spec listing `actions`, with `unreachable`, `seed` and `steps` given when they are. */
export function smokeSpec(
  actions: readonly string[],
  unreachable?: Record<string, string>,
  more: { seed?: string | readonly string[]; steps?: number } = {},
): string {
  const declared = unreachable === undefined ? '' : `\n  unreachable: ${JSON.stringify(unreachable, null, 2).replace(/\n/g, '\n  ')},`;
  const seed = more.seed === undefined ? '' : `\n  seed: ${JSON.stringify(more.seed)},`;
  const steps = more.steps === undefined ? '' : `\n  steps: ${more.steps},`;
  return `import { defineSmokeTest } from 'boardsmith/testing/browser';

defineSmokeTest({
  actions: ${JSON.stringify(actions)},${declared}${seed}${steps}
});
`;
}

/**
 * Seeds for {@link aceGame} (#460): a deal from `WITHOUT` gives neither seat the ace of hearts, a
 * deal from `WITH` gives it to seat 1. The engine's own shuffle decides it, so a change to the
 * shuffle changes them.
 */
export const ACE_SEEDS = { WITHOUT: 'plain', WITH: '4' } as const;

/**
 * THE ACE GAME (#460): an action the DEAL decides. Each seat is dealt five cards from a shuffled
 * deck; on its turn it may `draw` or `play` a card, and `showAce` is offered only to a seat that was
 * dealt the ace of hearts, which about one deal in five does. Twenty steps never end a game, so a
 * walk sees exactly the deal it was dealt.
 */
export function aceGame(): Record<string, string> {
  return {
    'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  hand!: Hand;
  dealtTheAce = false;
}

export class DevGameGame extends Game<DevGameGame, DevGamePlayer> {
  static PlayerClass = DevGamePlayer;

  deck!: Deck;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck]);
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      player.hand = hand;
    }
    this.deck = this.create(Deck, 'deck');
    this.deck.setOrder('stacking');
    for (const suit of ['H', 'D', 'C', 'S'] as const) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const) {
        this.deck.create(Card, \`\${rank}\${suit}\`, { suit, rank });
      }
    }
    this.deck.shuffle();
    for (const player of this.players) {
      for (let i = 0; i < 5; i++) this.deck.first(Card)?.putInto(player.hand);
      player.dealtTheAce = player.hand.all(Card).some((card) => card.name === 'AH');
    }
    for (const action of createTurnActions(this)) this.registerAction(action);
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): DevGamePlayer[] {
    return [];
  }
}
`,
    'src/rules/actions.ts': `import { Action, type ActionDefinition } from 'boardsmith';
import type { DevGameGame, DevGamePlayer } from './game.js';
import { Card } from './elements.js';

export function createTurnActions(game: DevGameGame): ActionDefinition[] {
  return [
    Action.create('draw')
      .prompt('Draw a card')
      .execute((_args, ctx) => {
        game.deck.first(Card)?.putInto((ctx.player as DevGamePlayer).hand);
        return { success: true };
      }),
    Action.create('play')
      .prompt('Play a card')
      .chooseFrom('card', {
        prompt: 'Choose a card to play',
        choices: (ctx) => [...(ctx.player as DevGamePlayer).hand.all(Card)],
      })
      .condition({ 'a card in hand': (ctx) => (ctx.player as DevGamePlayer).hand.count(Card) >= 1 })
      .execute((args) => {
        (args.card as Card).remove();
        return { success: true };
      }),
    Action.create('showAce')
      .prompt('Show the ace of hearts you were dealt')
      .condition({ 'dealt the ace of hearts': (ctx) => (ctx.player as DevGamePlayer).dealtTheAce })
      .execute(() => ({ success: true })),
  ];
}
`,
    'src/rules/flow.ts': `import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { DevGameGame } from './game.js';

export function createGameFlow(game: DevGameGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        do: actionStep({ name: 'turn', actions: ['draw', 'play', 'showAce'], skipIf: () => game.isFinished() }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
`,
    'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the ace game', () => {
  it('deals five cards to each player', () => {
    const game = new DevGameGame({ playerCount: 2, seed: 'test' });
    expect(game.players.map((player) => player.hand.all().length)).toEqual([5, 5]);
  });
});
`,
  };
}

/** The truce game's action that no walk from a fresh game reaches, and why. */
export const QUIET_CLAIM_REASON =
  'Offered only after forty rounds in which nobody played a card, and the walk plays cards every round.';

/**
 * THE TRUCE GAME. Each turn a player takes one action:
 *
 * - `draw` draws a card, and `play` plays exactly two cards from the hand (a multi-select pick with
 *   min 2 and max 2, which the panel completes by itself on the second card, #459);
 * - `trade` returns two or three of the thirty cards in the market to the deck (a multi-select pick
 *   with min 2 and max 3, finished with Done; with more than 24 candidates the panel hands it to
 *   the board, so it is answered there, #459);
 * - `concede` ends the game at once (#458: a game-ending action). It is the first action the panel
 *   offers, so a walk that took actions again in the panel's order would concede every game;
 * - `rally` is offered once trades have taken four cards from the market, which needs a game that
 *   goes on after the walk has taken every other action once (#458: why the walk stops taking an
 *   action that ended every game it was taken in);
 * - `offerTruce` puts a truce on the table, and only the OTHER seat may `acceptTruce`, which ends
 *   the game (#458: an action that needs another seat's action first);
 * - `claimTruce` is offered only after forty quiet rounds, which a walk from a fresh game never
 *   reaches (#458: an action the spec declares).
 *
 * A walk concedes the first game at once (`concede` is offered first), so `acceptTruce` is first
 * taken in the second game. With `acceptTruceFails`, taking it throws: an error raised only in a
 * later game.
 */
export function truceGame(options: { acceptTruceFails?: boolean } = {}): Record<string, string> {
  const acceptTruce = options.acceptTruceFails
    ? `throw new Error('the truce table collapsed');`
    : `game.truce = true;
        return { success: true };`;
  return {
  'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck, PlayArea } from './elements.js';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  hand!: Hand;
  score: number = 0;
}

export class DevGameGame extends Game<DevGameGame, DevGamePlayer> {
  static PlayerClass = DevGamePlayer;

  deck!: Deck;
  market!: PlayArea;
  concededBy: number | null = null;
  truceOfferedBy: number | null = null;
  truce = false;
  quietRounds = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck, PlayArea]);
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      player.hand = hand;
    }
    this.deck = this.create(Deck, 'deck');
    this.deck.setOrder('stacking');
    for (const suit of ['H', 'D', 'C', 'S'] as const) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const) {
        this.deck.create(Card, \`\${rank}\${suit}\`, { suit, rank });
      }
    }
    this.deck.shuffle();
    for (const player of this.players) {
      for (let i = 0; i < 5; i++) this.deck.first(Card)?.putInto(player.hand);
    }
    this.market = this.create(PlayArea, 'market');
    for (let i = 0; i < 30; i++) this.deck.first(Card)?.putInto(this.market);
    for (const action of createTurnActions(this)) this.registerAction(action);
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.concededBy !== null || this.truce || this.deck.count(Card) === 0;
  }

  override getWinners(): DevGamePlayer[] {
    if (this.concededBy === null) return [];
    return this.players.filter((player) => player.seat !== this.concededBy);
  }
}
`,
  'src/rules/actions.ts': `import { Action, type ActionDefinition } from 'boardsmith';
import type { DevGameGame, DevGamePlayer } from './game.js';
import { Card } from './elements.js';

export function createTurnActions(game: DevGameGame): ActionDefinition[] {
  return [
    Action.create('draw')
      .prompt('Draw a card')
      .execute((_args, ctx) => {
        game.deck.first(Card)?.putInto((ctx.player as DevGamePlayer).hand);
        return { success: true };
      }),
    Action.create('play')
      .prompt('Play two cards')
      .chooseFrom('cards', {
        prompt: 'Choose two cards to play',
        choices: (ctx) => [...(ctx.player as DevGamePlayer).hand.all(Card)],
        multiSelect: { min: 2, max: 2 },
      })
      .condition({ 'two cards in hand': (ctx) => (ctx.player as DevGamePlayer).hand.count(Card) >= 2 })
      .execute((args, ctx) => {
        for (const card of args.cards as Card[]) card.remove();
        (ctx.player as DevGamePlayer).score += 2;
        return { success: true };
      }),
    Action.create('trade')
      .prompt('Trade cards from the market')
      .chooseElements('cards', {
        prompt: 'Choose two or three market cards to return to the deck',
        elements: () => [...game.market.all(Card)],
        multiSelect: { min: 2, max: 3 },
      })
      .execute((args) => {
        for (const card of args.cards as Card[]) card.putInto(game.deck);
        return { success: true };
      }),
    Action.create('rally')
      .prompt('Rally')
      .condition({ 'the market is down to 26 cards': () => game.market.count(Card) <= 26 })
      .execute(() => ({ success: true })),
    Action.create('concede')
      .prompt('Concede the game')
      .execute((_args, ctx) => {
        game.concededBy = ctx.player.seat;
        return { success: true };
      }),
    Action.create('offerTruce')
      .prompt('Offer a truce')
      .condition({ 'no truce is on the table': () => game.truceOfferedBy === null })
      .execute((_args, ctx) => {
        game.truceOfferedBy = ctx.player.seat;
        return { success: true };
      }),
    Action.create('acceptTruce')
      .prompt('Accept the truce')
      .condition({
        'the other side offered a truce': (ctx) => game.truceOfferedBy !== null && game.truceOfferedBy !== ctx.player.seat,
      })
      .execute(() => {
        ${acceptTruce}
      }),
    Action.create('claimTruce')
      .prompt('Claim a truce after forty quiet rounds')
      .condition({ 'forty quiet rounds': () => game.quietRounds >= 40 })
      .execute(() => {
        game.truce = true;
        return { success: true };
      }),
  ];
}
`,
  'src/rules/flow.ts': `import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { DevGameGame } from './game.js';

export function createGameFlow(game: DevGameGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        do: actionStep({
          name: 'turn',
          actions: ['concede', 'draw', 'play', 'trade', 'offerTruce', 'acceptTruce', 'rally', 'claimTruce'],
          skipIf: () => game.isFinished(),
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
`,
  'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the truce game', () => {
  it('deals five cards to each player', () => {
    const game = new DevGameGame({ playerCount: 2, seed: 'test' });
    expect(game.players.map((player) => player.hand.all().length)).toEqual([5, 5]);
  });
});
`,
  };
}

/** The scaffold's UI registry with its own board made the one players get, as a finished game has it. */
export const PLAYERS_GET_THE_TABLE = `import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';
import AutoUI from 'boardsmith/ui/auto-ui';
import GameTable from './components/GameTable.vue';

export default defineGameUIs({
  Table: defaultUI(GameTable),
  Auto: devUI(AutoUI),
});
`;

/**
 * A BOARD WITH A CONTROL THAT TAKES NO POINTER (#457), as chess has over its 3D canvas: a surface
 * that takes the pointer, and over it a "lantern" button that takes no pointer
 * (`pointer-events: none`). Pressing the lantern lights a second, ordinary button, "Walk through
 * the door", which is the only way that one appears: a walk that presses both reports 2 board
 * controls. With `invisible` the lantern layer has `opacity: 0`, a keyboard-only control for
 * keyboard and screen-reader players; without it the lantern is a visible button a mouse cannot
 * press.
 */
export function boardWithAPointerlessControl(options: { invisible: boolean }): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { ref } from 'vue';

const lit = ref(false);
</script>

<template>
  <div class="room">
    <div class="table">
      <div class="surface">The table, drawn for the pointer</div>
      <div class="keys">
        <button type="button" aria-label="Light the lantern" @click="lit = true">Lantern</button>
      </div>
    </div>
    <button v-if="lit" type="button">Walk through the door</button>
  </div>
</template>

<style scoped>
.table { position: relative; width: 320px; height: 200px; }
.surface { position: absolute; inset: 0; }
.keys { position: absolute; inset: 0; pointer-events: none;${options.invisible ? ' opacity: 0;' : ''} }
.keys button { width: 100%; height: 100%; pointer-events: none; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * A BOARD WITH MODAL DIALOGS (#461), as one-two-punch's discard-pile viewer is: a "Look through
 * discards" button opens a modal dialog over the board, with "Sort" and "Close discards" in it, and
 * once closed it reads "Look through discards again", which opens the same dialog again. "Read the
 * rules" opens a dialog with nothing to press, which Escape closes unless `rulesStayOpen`. "Plan A"
 * and "Plan B" sit behind both dialogs, where no player can press them while one is open.
 *
 * A walk that presses only what a player can reach presses 9 board controls: look, sort, close,
 * look again, sort, close, rules, then the two plans.
 */
export function boardWithDialogs(options: { rulesStayOpen: boolean }): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const open = ref<'discards' | 'rules' | null>(null);
const looked = ref(false);
const sorted = ref(false);
const plans = ref<string[]>([]);
const dialog = ref<HTMLElement | null>(null);

async function show(which: 'discards' | 'rules') {
  open.value = which;
  await nextTick();
  dialog.value?.focus();
}
function closeDiscards() {
  open.value = null;
  looked.value = true;
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && ${options.rulesStayOpen ? "open.value !== 'rules'" : 'true'}) open.value = null;
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="board">
    <button type="button" @click="show('discards')">{{ looked ? 'Look through discards again' : 'Look through discards' }}</button>
    <button type="button" @click="show('rules')">Read the rules</button>
    <button type="button" @click="plans.push('A')">Plan A</button>
    <button type="button" @click="plans.push('B')">Plan B</button>
    <p>Planned: {{ plans.join(', ') || 'nothing' }}</p>
    <div v-if="open" class="scrim">
      <div ref="dialog" role="dialog" aria-modal="true" tabindex="-1" :aria-label="open === 'discards' ? 'Discards' : 'Rules'">
        <template v-if="open === 'discards'">
          <button type="button" @click="sorted = !sorted">Sort</button>
          <button type="button" @click="closeDiscards">Close discards</button>
        </template>
        <p v-else>Play a card or draw one.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board { position: relative; width: 420px; height: 260px; }
.scrim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * A BOARD CONTROL THAT GOES AWAY WHEN THE POINTER REACHES IT (#464): "Shy button" leaves the board
 * the moment the pointer is over it, so a press never lands and the element is gone for good.
 */
export function boardWithAVanishingControl(): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { ref } from 'vue';

const gone = ref(false);
</script>

<template>
  <div class="board">
    <button v-if="!gone" type="button" @pointerenter="gone = true">Shy button</button>
  </div>
</template>

<style scoped>
.board { width: 320px; height: 200px; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * THE FIELDS GAME (#465 to #467): each turn a player may `code` (a text field that takes digits only,
 * so the walk's "smoke test" never satisfies it and the action never finishes), `kindle` (a number
 * field, "How many logs?", 1 to 5, whose own rule refuses 1), `draw` or `rest`. `code` is the panel's first offer, so a walk
 * that went on taking an action it had given up on would never take the others.
 */
export function fieldsGame(): Record<string, string> {
  return {
    'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  hand!: Hand;
  logs = 0;
}

export class DevGameGame extends Game<DevGameGame, DevGamePlayer> {
  static PlayerClass = DevGamePlayer;

  deck!: Deck;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck]);
    for (const player of this.players) {
      const hand = this.create(Hand, \`hand-\${player.seat}\`);
      hand.player = player;
      player.hand = hand;
    }
    this.deck = this.create(Deck, 'deck');
    for (let i = 0; i < 40; i++) this.deck.create(Card, \`card-\${i}\`, { suit: 'H', rank: 'A' });
    for (const action of createTurnActions(this)) this.registerAction(action);
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): DevGamePlayer[] {
    return [];
  }
}
`,
    'src/rules/actions.ts': `import { Action, type ActionDefinition } from 'boardsmith';
import type { DevGameGame, DevGamePlayer } from './game.js';
import { Card } from './elements.js';

export function createTurnActions(game: DevGameGame): ActionDefinition[] {
  return [
    Action.create('code')
      .prompt('Enter the code')
      .enterText('code', { prompt: 'The code, in digits', pattern: { regex: /^[0-9]+$/, message: 'Digits only.' } })
      .execute(() => ({ success: true })),
    Action.create('kindle')
      .prompt('Kindle the fire')
      .enterNumber('logs', {
        prompt: 'How many logs?',
        min: 1,
        max: 5,
        integer: true,
        validate: (logs) => (logs >= 2 ? true : 'A fire needs at least two logs.'),
      })
      .execute((args, ctx) => {
        (ctx.player as DevGamePlayer).logs += args.logs as number;
        return { success: true };
      }),
    Action.create('draw')
      .prompt('Draw a card')
      .execute((_args, ctx) => {
        game.deck.first(Card)?.putInto((ctx.player as DevGamePlayer).hand);
        return { success: true };
      }),
    Action.create('rest')
      .prompt('Rest')
      .execute(() => ({ success: true })),
  ];
}
`,
    'src/rules/flow.ts': `import { loop, eachPlayer, actionStep, type FlowDefinition } from 'boardsmith';
import type { DevGameGame } from './game.js';

export function createGameFlow(game: DevGameGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        do: actionStep({ name: 'turn', actions: ['code', 'kindle', 'draw', 'rest'], skipIf: () => game.isFinished() }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
`,
    'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the fields game', () => {
  it('starts with forty cards in the deck', () => {
    expect(new DevGameGame({ playerCount: 2, seed: 'test' }).deck.all().length).toBe(40);
  });
});
`,
  };
}
