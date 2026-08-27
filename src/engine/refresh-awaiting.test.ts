/**
 * A seat that becomes eligible mid-step can be admitted (#28).
 *
 * `simultaneousActionStep` builds each awaiting seat's `availableActions` once,
 * at step entry, and re-derives it for exactly one seat afterwards: the seat
 * that just acted. `resumeSimultaneousAction` then gates every submission on
 * that frozen list. So a seat whose legal actions change for any reason OTHER
 * than its own action keeps a stale list for the rest of the step.
 *
 * The engine's two documented workarounds do not reach this: "keep the action
 * available" only works when the action CAN be legal from the moment the step
 * opens, and "re-enter the step" only helps at a step boundary. A change that
 * happens WHILE the step is open — a round boundary materialising a character
 * for a seat that was uninhabited when the step began — leaves that seat
 * present but frozen, which is the state the reporting game's rules forbid
 * outright.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from './index.js';

/**
 * Seat 2 starts without a character, so only `create` is legal for it. Once it
 * has one, `act` becomes legal — a change driven by seat 1's action, not its own.
 */
class LateArrivalGame extends Game<LateArrivalGame, Player> {
  hasCharacter: Record<number, boolean> = { 1: true, 2: false };
  acted: string[] = [];

  constructor(options: GameOptions) {
    super(options);

    this.registerActions(
      Action.create<LateArrivalGame>('act')
        .prompt('Act')
        .condition({ 'has a character': (ctx) => (ctx.game as LateArrivalGame).hasCharacter[ctx.player.seat] === true })
        .execute((_a, ctx) => {
          (ctx.game as LateArrivalGame).acted.push(`act:${ctx.player.seat}`);
        }),
      Action.create<LateArrivalGame>('grant')
        .prompt('Grant a character to seat 2')
        .condition({ 'seat 1 only': (ctx) => ctx.player.seat === 1 })
        .execute((_a, ctx) => {
          const game = ctx.game as LateArrivalGame;
          game.hasCharacter[2] = true;
          game.acted.push('grant');
        }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          name: 'round',
          actions: ['act', 'grant'],
          allDone: (ctx) => (ctx.game as LateArrivalGame).acted.filter((a) => a.startsWith('act:')).length >= 2,
        }),
      })
    );
  }
}

function started(): LateArrivalGame {
  const game = new LateArrivalGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'late' });
  game.startFlow();
  return game;
}

/** The actions the flow will actually accept from `seat` right now. */
function awaitingFor(game: LateArrivalGame, seat: number): string[] {
  const state = game.getFlowState();
  return state?.awaitingPlayers?.find((p) => p.playerIndex === seat)?.availableActions ?? [];
}

describe('without a refresh, a seat stays frozen at what it could do on entry', () => {
  it('starts with seat 2 offered nothing, since it has no character', () => {
    const game = started();
    expect(awaitingFor(game, 1)).toContain('act');
    expect(awaitingFor(game, 2)).toEqual([]);
  });
});

describe('game.refreshAwaitingActions() admits a seat that became eligible', () => {
  it('adds the newly-eligible seat to the awaiting set', () => {
    const game = started();
    game.continueFlow('grant', {}, 1);
    expect(awaitingFor(game, 2)).toEqual([]);

    game.refreshAwaitingActions();

    expect(awaitingFor(game, 2)).toContain('act');
  });

  it('lets that seat actually act, which is the point', () => {
    const game = started();
    game.continueFlow('grant', {}, 1);
    game.refreshAwaitingActions();

    const state = game.continueFlow('act', {}, 2);
    expect(state.actionError).toBeUndefined();
    expect(game.acted).toContain('act:2');
  });

  it('refuses that seat before the refresh, so the gate is real', () => {
    const game = started();
    game.continueFlow('grant', {}, 1);

    const state = game.continueFlow('act', {}, 2);
    expect(state.actionError).toMatch(/not available|not awaiting/i);
    expect(game.acted).not.toContain('act:2');
  });

  it('can be scoped to one seat', () => {
    const game = started();
    game.continueFlow('grant', {}, 1);

    game.refreshAwaitingActions(1);
    expect(awaitingFor(game, 2)).toEqual([]);

    game.refreshAwaitingActions(2);
    expect(awaitingFor(game, 2)).toContain('act');
  });

  it('drops a seat whose actions went away, not just adds', () => {
    const game = started();
    expect(awaitingFor(game, 1)).toContain('act');

    game.hasCharacter[1] = false;
    game.refreshAwaitingActions();

    expect(awaitingFor(game, 1)).not.toContain('act');
  });

  it('leaves a seat that already acted alone', () => {
    const game = started();
    game.continueFlow('grant', {}, 1);
    game.refreshAwaitingActions();
    game.continueFlow('act', {}, 2);

    const before = awaitingFor(game, 2);
    game.refreshAwaitingActions();
    expect(awaitingFor(game, 2)).toEqual(before);
  });

  it('is a no-op outside a simultaneous step, rather than throwing', () => {
    const game = new LateArrivalGame({ playerCount: 2, seed: 'late' });
    // Not started: there is no awaiting set to refresh, and saying so by doing
    // nothing is honest — there is no stale list to correct.
    expect(() => game.refreshAwaitingActions()).not.toThrow();
  });

  it('refuses a seat that does not exist rather than silently doing nothing', () => {
    const game = started();
    expect(() => game.refreshAwaitingActions(99)).toThrow(/seat 99/);
  });
});
