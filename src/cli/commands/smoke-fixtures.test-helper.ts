/**
 * FIXTURE GAMES FOR THE SMOKE WALK (#457 to #468), written over the table scaffold that
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
 * With `closeFirst`, as one-two-punch's has it, "Close discards" comes before "Sort", and the opener
 * keeps its label, so a walk reaches "Sort" only by opening the dialog again with the same button.
 *
 * With `brokenCopy`, a copy of the viewer for the opponent's discards comes to the board once both
 * of the game's actions have resolved (so the walk has taken everything, and nothing else is left
 * for it to do): "Look through the opponent's discards" opens the dialog "Opponent's discards",
 * whose "Close discards" marks the pile looked through but never closes the dialog, the copy's bug.
 * Escape closes it. A walk that presses a "Close discards" because one closed a dialog before, and
 * never notices that this one did not, presses it until it runs out of things to do, and passes.
 */
export function boardWithDialogs(options: { rulesStayOpen: boolean; closeFirst?: boolean; brokenCopy?: boolean }): Record<string, string> {
  const discards = ['<button type="button" @click="sorted = !sorted">Sort</button>', '<button type="button" @click="closeDiscards">Close discards</button>'];
  if (options.closeFirst) discards.reverse();
  const opener = options.closeFirst ? 'Look through discards' : "{{ looked ? 'Look through discards again' : 'Look through discards' }}";
  const copy = options.brokenCopy
    ? `\n    <button v-if="resolved.size >= 2" type="button" @click="show('opponent')">Look through the opponent's discards</button>`
    : '';
  const copyDialog = options.brokenCopy ? `\n        <button v-if="open === 'opponent'" type="button" @click="looked = true">Close discards</button>` : '';
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

const open = ref<'discards' | 'rules' | 'opponent' | null>(null);
const looked = ref(false);
const sorted = ref(false);
const plans = ref<string[]>([]);
const resolved = ref(new Set<string>());
const dialog = ref<HTMLElement | null>(null);
const names = { discards: 'Discards', rules: 'Rules', opponent: "Opponent's discards" };

async function show(which: 'discards' | 'rules' | 'opponent') {
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
function onResolved(event: Event) {
  resolved.value.add((event as CustomEvent<{ action: string }>).detail.action);
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('boardsmith:action-resolved', onResolved);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('boardsmith:action-resolved', onResolved);
});
</script>

<template>
  <div class="board">
    <button type="button" @click="show('discards')">${opener}</button>
    <button type="button" @click="show('rules')">Read the rules</button>
    <button type="button" @click="plans.push('A')">Plan A</button>
    <button type="button" @click="plans.push('B')">Plan B</button>${copy}
    <p>Planned: {{ plans.join(', ') || 'nothing' }}</p>
    <div v-if="open" class="scrim">
      <div ref="dialog" role="dialog" aria-modal="true" tabindex="-1" :aria-label="names[open]">
        <template v-if="open === 'discards'">
          ${discards.join('\n          ')}
        </template>
        <p v-else-if="open === 'rules'">Play a card or draw one.</p>${copyDialog}
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
 * A BOARD CONTROL THAT IS DISABLED BY THE TIME IT IS PRESSED: "Timid button" is redrawn as a disabled
 * button, a new element with the same label, the moment the pointer is over it, so the control the walk
 * found enabled is disabled when the walk finds it again to press it, and stays so.
 */
export function boardWithATimidControl(): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { ref } from 'vue';

const shy = ref(false);
</script>

<template>
  <div class="board">
    <button v-if="!shy" type="button" @pointerenter="shy = true">Timid button</button>
    <button v-else type="button" disabled>Timid button</button>
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
 * A BOARD CONTROL THAT REPLACES THE GAME'S FRAME: "Start over" puts a new game frame in place of the
 * one it is pressed in, as the page around the game does when the game restarts, so the frame the
 * walk pressed in is gone the moment the press lands. The new frame is never handed the game, so the
 * walk finds nothing offered in it and stops that deal.
 */
export function boardThatReplacesItsFrame(): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
function startOver() {
  const frame = window.parent.document.querySelector('iframe')!;
  frame.replaceWith(frame.cloneNode() as HTMLIFrameElement);
}
</script>

<template>
  <div class="board">
    <button type="button" @click="startOver">Start over</button>
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
 * that went on taking an action it had given up on would never take the others. With
 * `kindleCrashesAtOne`, `kindle` has no rule refusing 1: its rules throw on 1 log and work on 2, a
 * bug the walk must report rather than step around (#466).
 */
export function fieldsGame(options: { kindleCrashesAtOne?: boolean } = {}): Record<string, string> {
  const kindleRule = options.kindleCrashesAtOne ? '' : `
        validate: (logs) => (logs >= 2 ? true : 'A fire needs at least two logs.'),`;
  const kindleCrash = options.kindleCrashesAtOne ? `
        if (args.logs === 1) throw new Error('the hearth cracked');` : '';
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
        integer: true,${kindleRule}
      })
      .execute((args, ctx) => {${kindleCrash}
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

/**
 * A POINTER-AIMED BOARD (#468), as Windup Warfare's battlefield is: `claim` picks one of a hundred
 * cells, more than the panel lists, so it hands the pick to the board, and the board is one surface
 * that stands for "the cell under the pointer". Moving the pointer over it re-aims it, so its
 * `data-bs-candidate` names the cell under the pointer, refused (`aria-disabled`) on the middle row,
 * which belongs to nobody; a click or Enter claims the cell it is aimed at. It opens aimed at a cell
 * anyone may claim, and its centre is on the middle row.
 */
export function pointerAimedGame(): Record<string, string> {
  return {
    ...fieldRules(),
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { computed, ref } from 'vue';
import { candidateAttrs, useBoardInteraction } from 'boardsmith/ui';

const board = useBoardInteraction();
const cursor = ref({ row: 2, col: 2 });
const name = computed(() => \`r\${cursor.value.row}c\${cursor.value.col}\`);
const choosing = computed(() => board.currentAction === 'claim' && board.currentPickName === 'cell');
// The board knows a candidate by its element id; the panel names each cell's candidate by the cell's name.
const target = computed(() => board.validElements.find((candidate) => candidate.display === name.value));
const refused = computed(() => target.value === undefined || target.value.disabled !== undefined);

function aim(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const at = (offset: number, size: number) => Math.min(9, Math.max(0, Math.floor((offset / size) * 10)));
  cursor.value = { row: at(event.clientY - box.top, box.height), col: at(event.clientX - box.left, box.width) };
}
function claim() {
  if (choosing.value && target.value !== undefined && !refused.value) board.triggerElementSelect({ id: target.value.id });
}
</script>

<template>
  <div class="board">
    <div
      class="field"
      role="button"
      tabindex="0"
      :aria-label="\`The field, aimed at row \${cursor.row}, column \${cursor.col}\`"
      v-bind="choosing && target ? candidateAttrs(board.candidateLabel({ id: target.id })) : {}"
      :aria-disabled="choosing && refused ? 'true' : undefined"
      @pointermove="aim"
      @click="claim"
      @keydown.enter="claim"
    >
      Aimed at row {{ cursor.row }}, column {{ cursor.col }}
    </div>
  </div>
</template>

<style scoped>
.board { width: 400px; height: 400px; }
.field { width: 400px; height: 400px; background: #ddd; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * THE FIELD GAME'S RULES (#468): `claim` picks one of a hundred cells (more than the panel lists,
 * so the panel hands the pick to the board), refused on the middle row, and `rest` passes. A board
 * for it is written by each fixture.
 */
function fieldRules(): Record<string, string> {
  return {
    'src/rules/game.ts': `import { Game, Player, Space, type GameOptions } from 'boardsmith';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class Cell extends Space<DevGameGame> {
  row = 0;
  col = 0;
}

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  claimed = 0;
}

export class DevGameGame extends Game<DevGameGame, DevGamePlayer> {
  static PlayerClass = DevGamePlayer;

  rounds = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Cell]);
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) this.create(Cell, \`r\${row}c\${col}\`, { row, col });
    }
    for (const action of createTurnActions(this)) this.registerAction(action);
    this.setFlow(createGameFlow(this));
  }

  cells(): Cell[] {
    return [...this.all(Cell)];
  }

  override isFinished(): boolean {
    return this.rounds >= 30;
  }

  override getWinners(): DevGamePlayer[] {
    return [];
  }
}
`,
    'src/rules/actions.ts': `import { Action, type ActionDefinition } from 'boardsmith';
import type { Cell, DevGameGame, DevGamePlayer } from './game.js';

export function createTurnActions(game: DevGameGame): ActionDefinition[] {
  return [
    Action.create('claim')
      .prompt('Claim a cell')
      .chooseElement('cell', {
        prompt: 'Which cell?',
        elements: () => game.cells(),
        disabled: (cell) => ((cell as Cell).row === 5 ? 'The middle row belongs to nobody.' : false),
      })
      .execute((_args, ctx) => {
        (ctx.player as DevGamePlayer).claimed++;
        game.rounds++;
        return { success: true };
      }),
    Action.create('rest')
      .prompt('Rest')
      .execute(() => {
        game.rounds++;
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
        do: actionStep({ name: 'turn', actions: ['claim', 'rest'], skipIf: () => game.isFinished() }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
`,
    'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the field game', () => {
  it('has a hundred cells', () => {
    expect(new DevGameGame({ playerCount: 2, seed: 'test' }).cells()).toHaveLength(100);
  });
});
`,
  };
}

/** What each candidate board (`candidateBoard`) does to a walk that points at it (#468). */
type CandidateBoard = 'lifts' | 'restless' | 'partlyCovered' | 'covered' | 'toast';

/** The candidate markup and styles of each `CandidateBoard`, around the three cells it offers. */
const CANDIDATE_BOARDS: Record<CandidateBoard, { template: string; style: string }> = {
  // Each card lifts when pointed at, moving under the pointer for a third of a second.
  lifts: {
    template: `<button v-for="cell in cells" :key="cell" type="button" class="card" v-bind="attrs(cell)" @click="claim(cell)">{{ cell }}</button>`,
    style: `.card { width: 60px; height: 90px; margin: 8px; transition: transform 0.3s; } .card:hover { transform: translateY(-16px); }`,
  },
  // Each card sways for ever, so it never stands still.
  restless: {
    template: `<button v-for="cell in cells" :key="cell" type="button" class="card" v-bind="attrs(cell)" @click="claim(cell)">{{ cell }}</button>`,
    style: `.card { width: 60px; height: 90px; margin: 8px; animation: sway 0.4s ease-in-out infinite alternate; } @keyframes sway { from { transform: translateX(0); } to { transform: translateX(8px); } }`,
  },
  // A tray covers the left two thirds of each card, centre included; its right edge shows.
  partlyCovered: {
    template: `<div v-for="cell in cells" :key="cell" class="slot"><button type="button" class="card" v-bind="attrs(cell)" @click="claim(cell)">{{ cell }}</button><div class="tray"></div></div>`,
    style: `.slot { position: relative; width: 240px; height: 60px; margin: 8px; } .card { width: 240px; height: 60px; } .tray { position: absolute; left: 0; top: 0; width: 160px; height: 60px; background: #888; }`,
  },
  // A tray covers each card whole.
  covered: {
    template: `<div v-for="cell in cells" :key="cell" class="slot"><button type="button" class="card" v-bind="attrs(cell)" @click="claim(cell)">{{ cell }}</button><div class="tray"></div></div>`,
    style: `.slot { position: relative; width: 240px; height: 60px; margin: 8px; } .card { width: 240px; height: 60px; } .tray { position: absolute; inset: 0; background: #888; }`,
  },
  // The first time the bell, or a card, is pointed at, an error toast covers the board for a second
  // and a half, and a second one follows the moment the first goes, as a game that reports twice does.
  toast: {
    template: `<button type="button" class="bell" @pointerenter="warn">Ring the bell</button>
      <button v-for="cell in cells" :key="cell" type="button" class="card" v-bind="attrs(cell)" @pointerenter="warn" @click="claim(cell)">{{ cell }}</button>
      <div v-if="warning" class="toast error">The ravens are loud.</div>`,
    style: `.bell, .card { width: 120px; height: 60px; margin: 8px; } .toast { position: absolute; inset: 0; background: #c33; color: #fff; }`,
  },
};

/**
 * A BOARD OF CANDIDATES THAT ARE HARD TO POINT AT (#468), for the field game: three cells offered
 * as cards on the board, with `claim` handed to the board. See `CandidateBoard` for each kind.
 */
export function candidateBoard(kind: CandidateBoard): Record<string, string> {
  const { template, style } = CANDIDATE_BOARDS[kind];
  return {
    ...fieldRules(),
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { computed, ref } from 'vue';
import { candidateAttrs, useBoardInteraction } from 'boardsmith/ui';

const board = useBoardInteraction();
const cells = ['r0c0', 'r1c1', 'r2c2'];
const choosing = computed(() => board.currentAction === 'claim' && board.currentPickName === 'cell');
const targetOf = (cell: string) => board.validElements.find((candidate) => candidate.display === cell);
const attrs = (cell: string) => {
  const target = targetOf(cell);
  return choosing.value && target ? candidateAttrs(board.candidateLabel({ id: target.id })) : {};
};
function claim(cell: string) {
  const target = targetOf(cell);
  if (choosing.value && target !== undefined) board.triggerElementSelect({ id: target.id });
}
const warning = ref(false);
let warned = 0;
function warn() {
  if (warned >= 2 || warning.value) return;
  warned++;
  warning.value = true;
  setTimeout(() => {
    warning.value = false;
    setTimeout(() => {
      warning.value = true;
      setTimeout(() => (warning.value = false), 1500);
    }, 50);
  }, 1500);
}
</script>

<template>
  <div class="board">
    ${template}
  </div>
</template>

<style scoped>
.board { position: relative; width: 420px; height: 420px; }
${style}
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * A BOARD TALLER THAN THE PAGE (#468), with "Ring the far bell" at its foot: scrolled only as far as
 * needed to show it, the bell sits under the action panel along the bottom of the page, as
 * doom-machine's shield slots do, so a walk must scroll it clear of the panel to press it.
 */
export function boardWithAControlAtItsFoot(): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { ref } from 'vue';

const rung = ref(0);
</script>

<template>
  <div class="board">
    <p>Rung {{ rung }} times.</p>
    <button type="button" class="far" @click="rung++">Ring the far bell</button>
  </div>
</template>

<style scoped>
.board { position: relative; width: 320px; height: 2000px; }
.far { position: absolute; left: 20px; bottom: 4px; width: 160px; height: 24px; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/**
 * A PANEL THAT REDRAWS FOR A MOMENT (#468 review): "Look away" hides the panel's action buttons for
 * two seconds, as a panel redrawing its buttons after a board press does for a moment, so the panel's
 * buttons the walk read are not there when it first goes to press one. They come back by themselves,
 * unless `forGood`: then the panel took back what it offered, and never shows the buttons again.
 */
export function boardThatHidesThePanelForAMoment(options: { forGood?: boolean } = {}): Record<string, string> {
  const comeBack = options.forGood ? '' : `\n  setTimeout(() => buttons.forEach((button) => (button.style.display = '')), 2000);`;
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
function lookAway() {
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-bs-action]')];
  for (const button of buttons) button.style.display = 'none';${comeBack}
}
</script>

<template>
  <div class="board">
    <button type="button" @click="lookAway">Look away</button>
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
 * A BOARD THAT KEEPS REORDERING ITS CONTROLS (#464 review): "North", "South" and "East" trade
 * places every 60 milliseconds (a keyed list, so each button moves rather than being redrawn), so
 * whichever button sat at a place when the walk looked has often moved by the time it presses. A
 * button pressed twice says so on the console, which fails the walk; a walk that presses the button
 * it meant to presses each once.
 */
export function boardThatKeepsReordering(): Record<string, string> {
  return {
    'src/ui/components/GameTable.vue': `<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const order = ref(['North', 'South', 'East']);
const pressed = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => order.value.push(order.value.shift()!), 60);
});
onUnmounted(() => clearInterval(timer));
function pressIt(name: string) {
  if (pressed.has(name)) console.error(\`\${name} was pressed twice\`);
  pressed.add(name);
}
</script>

<template>
  <div class="board">
    <button v-for="name in order" :key="name" type="button" @click="pressIt(name)">{{ name }}</button>
  </div>
</template>

<style scoped>
.board { width: 320px; height: 200px; }
</style>
`,
    'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
  };
}

/** What `greet` and `wave` say when the name typed is not the other player's (#470). */
export const NOBODY_CALLED_THAT = 'Nobody at the table is called that.';

/**
 * THE GREETINGS GAME (#470): actions whose typed value the game itself checks, as Survival of the
 * Fittest's attack names a survivor standing in the same square. Each turn a player may `greet` or
 * `wave` at the other player by name (a text field the game refuses unless it is the other
 * player's name, which the players panel shows), `pledge` coins (a number field, 1 to 10, the game
 * refuses unless it is 7), write a `note` (free text, any of it accepted) or `draw`, which the log
 * says.
 */
export function greetingsGame(): Record<string, string> {
  return {
    'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  hand!: Hand;
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
  const toTheOther = (verb: string) =>
    Action.create(verb)
      .prompt(\`\${verb} at the other player\`)
      .enterText('whom', { prompt: 'Their name' })
      .execute((args, ctx) => {
        const other = game.players.find((player) => player !== ctx.player);
        if (args.whom !== other?.name) return { success: false, error: ${JSON.stringify(NOBODY_CALLED_THAT)} };
        return { success: true };
      });
  return [
    toTheOther('greet'),
    toTheOther('wave'),
    Action.create('pledge')
      .prompt('Pledge coins')
      .enterNumber('coins', { prompt: 'How many coins?', min: 1, max: 10, integer: true })
      .execute((args) => (args.coins === 7 ? { success: true } : { success: false, error: 'The pot takes seven coins.' })),
    Action.create('note')
      .prompt('Write a note')
      .enterText('words', { prompt: 'What does it say?' })
      .execute(() => ({ success: true })),
    Action.create('draw')
      .prompt('Draw a card')
      .execute((_args, ctx) => {
        game.deck.first(Card)?.putInto((ctx.player as DevGamePlayer).hand);
        game.message('{{player}} drew a card.', { player: ctx.player });
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
        do: actionStep({ name: 'turn', actions: ['greet', 'wave', 'pledge', 'note', 'draw'], skipIf: () => game.isFinished() }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
`,
    'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the greetings game', () => {
  it('starts with forty cards in the deck', () => {
    expect(new DevGameGame({ playerCount: 2, seed: 'test' }).deck.all().length).toBe(40);
  });
});
`,
  };
}

/** The players panel's name for the player other than the one the page is seated as. */
const OTHER_PLAYER = '.player-name-row:not(:has(.you-badge)) .player-name';

/**
 * A smoke spec for {@link greetingsGame} whose `inputs` are `inputs`, written as source (#470), so a
 * spec can give a function of the page.
 */
export function greetingsSpec(inputs: string): string {
  return `import { defineSmokeTest, type SmokeInputView } from 'boardsmith/testing/browser';

// The other player's name, as the players panel shows it, and the lines of the game's log.
const theOther = async ({ texts }: SmokeInputView) => (await texts(${JSON.stringify(OTHER_PLAYER)}))[0];
const LOG = '.game-history .message .text';

defineSmokeTest({
  actions: ['greet', 'wave', 'pledge', 'note', 'draw'],
  inputs: ${inputs},
});
`;
}

/**
 * THE KETTLE GAME (#473): a table that hangs. Seat 1 may `draw` once, and then the flow waits on
 * `wait`, an action the game greys out until a kettle boils, which it never does: no seat is
 * offered anything it can take, and the game is never over.
 */
export function kettleGame(): Record<string, string> {
  return {
    'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Card, Hand, Deck } from './elements.js';
import { createGameFlow } from './flow.js';
import { createTurnActions } from './actions.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {
  hand!: Hand;
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
    for (let i = 0; i < 10; i++) this.deck.create(Card, \`card-\${i}\`, { suit: 'H', rank: 'A' });
    for (const action of createTurnActions(this)) this.registerAction(action);
    this.setFlow(createGameFlow(this));
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
    Action.create('wait')
      .prompt('Pour the tea')
      .disabled(() => ${JSON.stringify(KETTLE_REASON)})
      .execute(() => ({ success: true })),
  ];
}
`,
    'src/rules/flow.ts': `import { sequence, actionStep, type FlowDefinition } from 'boardsmith';
import type { DevGameGame } from './game.js';

export function createGameFlow(game: DevGameGame): FlowDefinition {
  return {
    root: sequence(actionStep({ name: 'draw-once', actions: ['draw'] }), actionStep({ name: 'tea', actions: ['wait'] })),
    isComplete: () => false,
    getWinners: () => [],
  };
}
`,
    'tests/game.test.ts': `import { describe, expect, it } from 'vitest';
import { DevGameGame } from '../src/rules/game.js';

describe('the kettle game', () => {
  it('starts with ten cards in the deck', () => {
    expect(new DevGameGame({ playerCount: 2, seed: 'test' }).deck.all().length).toBe(10);
  });
});
`,
  };
}

/** Why the kettle game greys out `wait`, every time. */
const KETTLE_REASON = 'The kettle has not boiled.';

/** Why the glade world greys out `greet` for a seat standing alone. */
export const ALONE_REASON = 'There is nobody else in this glade to greet.';

/**
 * THE GLADE WORLD (#471, #472, #474), written over the world scaffold. Three glades in a ring, and
 * a seat `arrive`s in glade `seat % 3`, so seats 1 and 4 meet and seats 1 and 2 never do. A seat
 * may `greet` another seat standing in its glade, by the name the board's "Who else is here" list
 * shows, which the game checks; the list shows who the seat saw at its last `look`, as Survival of
 * the Fittest's does, so it is empty on arrival. `greet` is greyed out, with its reason, for a seat
 * alone. A seat may also `rest` (a slow command with nothing to choose: the panel greys every button
 * while it is in flight) and `stroll` on to the next glade. The panel offers them in that order
 * (arrive, greet, look, rest, stroll), so a walk that took the first untaken action strolls away
 * before it greets anyone it did not see at first.
 */
export function gladeWorld(): Record<string, string> {
  return {
    'src/rules/elements.ts': `import { Space } from 'boardsmith';

/** A glade, and one partition: the seats standing in it, in the order they arrived. */
export class Glade extends Space {
  visitors: number[] = [];
}

/** One seat's wanderer, and one partition: the glade it stands in (-1 before it arrives), and who it saw there. */
export class Wanderer extends Space {
  glade = -1;
  seen: number[] = [];
}
`,
    'src/rules/game.ts': `import { Game, Player, type GameOptions } from 'boardsmith';
import { Glade, Wanderer } from './elements.js';

export class DevGamePlayer extends Player<DevGameGame, DevGamePlayer> {}

export class DevGameGame extends Game<DevGameGame, DevGamePlayer> {
  static PlayerClass = DevGamePlayer;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Glade, Wanderer]);
  }
}
`,
    'src/rules/world.ts': `import { PlayerFacingError, type GameElement } from 'boardsmith';
import { worldAction } from 'boardsmith/world';
import type { WorldDefinition, WorldViewDeclaration } from 'boardsmith/world';
import type { DevGameGame } from './game.js';
import { Glade, Wanderer } from './elements.js';

export const WORLD_SEATS = 8;

const GLADES = 3;
const gladePartition = (glade: number) => \`glade:\${glade}\`;
const wandererPartition = (seat: number) => \`wanderer:\${seat}\`;

function wandererOf(game: DevGameGame, seat: number): Wanderer {
  const wanderer = game.first(Wanderer, \`wanderer-\${seat}\`);
  if (wanderer === undefined) throw new Error(\`Seat \${seat}'s wanderer is not resident.\`);
  return wanderer;
}

function gladeOf(game: DevGameGame, glade: number): Glade {
  const found = game.first(Glade, \`glade-\${glade}\`);
  if (found === undefined) throw new Error(\`Glade \${glade} is not resident.\`);
  return found;
}

/** The glade a seat stands in, named once its wanderer is loaded; none before it arrives. */
const whereItStands = ({ game, player }: { game: DevGameGame; player: { seat: number } }) => {
  const glade = wandererOf(game, player.seat).glade;
  return glade < 0 ? [] : [gladePartition(glade)];
};

export const worldGenesis: NonNullable<WorldDefinition['genesis']> = (game) => {
  const partitions: Record<string, GameElement> = {};
  for (let i = 0; i < GLADES; i++) partitions[gladePartition(i)] = game.create(Glade, \`glade-\${i}\`);
  for (const player of game.players) partitions[wandererPartition(player.seat)] = game.create(Wanderer, \`wanderer-\${player.seat}\`);
  return partitions;
};

export const worldView: WorldViewDeclaration = (seat) => [wandererPartition(seat)];

const notArrived = (game: DevGameGame, seat: number) => (wandererOf(game, seat).glade < 0 ? 'Arrive first.' : false);

const arrive = worldAction<DevGameGame>('arrive')
  .prompt('Walk into your glade')
  .needs(({ player }) => [wandererPartition(player.seat), gladePartition(player.seat % GLADES)])
  .disabled(({ game, player }) => (wandererOf(game, player.seat).glade < 0 ? false : 'You are already here.'))
  .execute((_args, ctx) => {
    const wanderer = ctx.world.partition(wandererPartition(ctx.player.seat)) as Wanderer;
    const glade = ctx.world.partition(gladePartition(ctx.player.seat % GLADES)) as Glade;
    wanderer.glade = ctx.player.seat % GLADES;
    glade.visitors = [...glade.visitors, ctx.player.seat];
  });

const greet = worldAction<DevGameGame>('greet')
  .prompt('Greet someone here')
  .needs(({ player }) => [wandererPartition(player.seat)])
  .needs(whereItStands)
  .disabled(({ game, player }) => {
    const away = notArrived(game, player.seat);
    if (away !== false) return away;
    const glade = gladeOf(game, wandererOf(game, player.seat).glade);
    return glade.visitors.some((seat) => seat !== player.seat) ? false : ${JSON.stringify(ALONE_REASON)};
  })
  .enterText('whom', { prompt: 'Who are you greeting?' })
  .execute(({ whom }, ctx) => {
    const glade = gladeOf(ctx.game, wandererOf(ctx.game, ctx.player.seat).glade);
    if (!glade.visitors.some((seat) => seat !== ctx.player.seat && whom === \`seat \${seat}\`)) {
      throw new PlayerFacingError('Nobody in this glade is called that.');
    }
  });

const look = worldAction<DevGameGame>('look')
  .prompt('Look around')
  .needs(({ player }) => [wandererPartition(player.seat)])
  .needs(whereItStands)
  .disabled(({ game, player }) => notArrived(game, player.seat))
  .execute((_args, ctx) => {
    const wanderer = wandererOf(ctx.game, ctx.player.seat);
    wanderer.seen = gladeOf(ctx.game, wanderer.glade).visitors.filter((seat) => seat !== ctx.player.seat);
  });

const rest = worldAction<DevGameGame>('rest')
  .prompt('Rest a while')
  .needs(({ player }) => [wandererPartition(player.seat)])
  .disabled(({ game, player }) => notArrived(game, player.seat))
  .execute(() => {
    // Slow on purpose: the panel greys every button while a command is in flight (#474).
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      // resting
    }
  });

const stroll = worldAction<DevGameGame>('stroll')
  .prompt('Stroll on to the next glade')
  .needs(({ player }) => [wandererPartition(player.seat)])
  .needs(({ game, player }) => {
    const glade = wandererOf(game, player.seat).glade;
    return glade < 0 ? [] : [gladePartition(glade), gladePartition((glade + 1) % GLADES)];
  })
  .disabled(({ game, player }) => notArrived(game, player.seat))
  .execute((_args, ctx) => {
    const wanderer = wandererOf(ctx.game, ctx.player.seat);
    const from = gladeOf(ctx.game, wanderer.glade);
    const to = gladeOf(ctx.game, (wanderer.glade + 1) % GLADES);
    from.visitors = from.visitors.filter((seat) => seat !== ctx.player.seat);
    to.visitors = [...to.visitors, ctx.player.seat];
    wanderer.glade = (wanderer.glade + 1) % GLADES;
    wanderer.seen = [];
  });

export const worldActions: WorldDefinition['actions'] = [arrive, greet, look, rest, stroll];
`,
    'src/ui/components/WorldBoard.vue': `<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ gameView: unknown }>();

interface ViewNode {
  attributes?: { seen?: number[] };
  children?: ViewNode[];
}

/** Who this seat saw at its last look, off its wanderer in the view. */
function seenIn(node: ViewNode | null | undefined): number[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node.attributes?.seen)) return node.attributes.seen;
  for (const child of node.children ?? []) {
    const found = seenIn(child);
    if (found.length > 0) return found;
  }
  return [];
}

const seen = computed(() => seenIn(props.gameView as ViewNode));
</script>

<template>
  <main class="glade">
    <h2>Who else is here</h2>
    <ul class="here">
      <li v-for="seat in seen" :key="seat">seat {{ seat }}</li>
    </ul>
  </main>
</template>
`,
  };
}

/**
 * A smoke spec for {@link gladeWorld} playing `seats` (#471), whose `greet` names the other seat the
 * board shows standing here.
 */
export function gladeSpec(more: { seats?: string; steps: number }): string {
  return `import { defineSmokeTest, type SmokeInputView } from 'boardsmith/testing/browser';

defineSmokeTest({
  actions: ['arrive', 'greet', 'look', 'rest', 'stroll'],${more.seats === undefined ? '' : `\n  seats: ${more.seats},`}
  inputs: {
    greet: {
      whom: async ({ texts, otherSeats }: SmokeInputView) =>
        (await texts('.here li')).find((name) => otherSeats.some((seat) => name === \`seat \${seat}\`)),
    },
  },
  steps: ${more.steps},
});
`;
}
