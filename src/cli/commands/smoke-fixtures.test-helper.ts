/**
 * FIXTURE GAMES FOR THE SMOKE WALK (#457, #458, #459), written over the table scaffold that
 * `smokeProject` makes (its game is `dev-game`, so its classes are `DevGameGame` and
 * `DevGamePlayer`).
 */

/** A smoke spec listing `actions`, with `unreachable` declared when given. */
export function smokeSpec(actions: readonly string[], unreachable?: Record<string, string>): string {
  const declared = unreachable === undefined ? '' : `\n  unreachable: ${JSON.stringify(unreachable, null, 2).replace(/\n/g, '\n  ')},`;
  return `import { defineSmokeTest } from 'boardsmith/testing/browser';

defineSmokeTest({
  actions: ${JSON.stringify(actions)},${declared}
});
`;
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
 */
export const TRUCE_GAME: Record<string, string> = {
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
        game.truce = true;
        return { success: true };
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
 * A BOARD WITH A KEYBOARD-ONLY CONTROL (#457), as chess has over its 3D canvas: a surface that
 * takes the pointer, and over it a button for keyboard and screen-reader players that is invisible
 * and takes no pointer (`opacity: 0`, `pointer-events: none`). Pressing it draws a card.
 */
export const KEYBOARD_ONLY_BOARD: Record<string, string> = {
  'src/ui/components/GameTable.vue': `<script setup lang="ts">
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{ availableActions: string[]; actionController: UseActionControllerReturn }>();

function draw(): void {
  if (props.availableActions.includes('draw')) void props.actionController.start('draw');
}
</script>

<template>
  <div class="table">
    <div class="surface">The table, drawn for the pointer</div>
    <div class="keys">
      <button type="button" aria-label="Draw a card (keyboard)" @click="draw">Draw</button>
    </div>
  </div>
</template>

<style scoped>
.table { position: relative; width: 320px; height: 200px; }
.surface { position: absolute; inset: 0; }
.keys { position: absolute; inset: 0; opacity: 0; pointer-events: none; }
.keys button { width: 100%; height: 100%; pointer-events: none; }
</style>
`,
  'src/ui/uis.ts': PLAYERS_GET_THE_TABLE,
};
