/**
 * #1362: `searchCopyForSeat` builds a seat's search copy the way the bot's own
 * search does, so a game can test its sampler and `afterRestore` hooks against
 * the copy the bot really searches: the seat's redacted view read as the seat
 * was shown it, the turn, the element id sequence and a seeded random state,
 * then the sampler, then the hooks.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Action, loop, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { SeededRandom } from '../utils/random.js';
import { searchCopyForSeat } from './index.js';

class HiddenPage extends Space<PagesGame> {
  static override visibleAttributes = ['name'];
  data: { kind: string } | null = null;
  protected override afterRestore(): void {
    if (!this.isAttributeRedacted('data') && this.data) Object.freeze(this.data);
  }
}

class PagesGame extends Game<PagesGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HiddenPage]);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }) });
  }
}

/** Seat 1 has passed, so seat 2 is to move. */
function truthWithSecondSeatToMove(): PagesGame {
  const truth = new PagesGame({ playerCount: 2, seed: 'truth' });
  truth.create(HiddenPage, 'page').data = { kind: 'real' };
  truth.startFlow();
  truth.continueFlow('pass', {}, 1);
  return truth;
}

describe('searchCopyForSeat (#1362)', () => {
  it('gives the sampler the turn and id sequence the truth has, and a random state from the seed', () => {
    const truth = truthWithSecondSeatToMove();
    const seen: { seat?: number; sequence?: number; random?: unknown } = {};

    const copy = searchCopyForSeat(truth, 2, 'search', {
      determinize: (game) => {
        seen.seat = game.getFlowState()?.currentPlayer;
        seen.sequence = game._ctx.sequence;
        seen.random = game.getRandomState();
        game.first(HiddenPage)!.data = { kind: 'sampled' };
      },
      rng: () => 0.5,
    });

    expect(seen).toEqual({ seat: 2, sequence: truth._ctx.sequence, random: new SeededRandom('search').getState() });
    expect(copy.getFlowState()?.currentPlayer).toBe(2);
  });

  it('runs the afterRestore hooks after the sampler, on the world it drew', () => {
    const copy = searchCopyForSeat(truthWithSecondSeatToMove(), 2, 'search', {
      determinize: (game) => {
        game.first(HiddenPage)!.data = { kind: 'sampled' };
      },
      rng: () => 0.5,
    });

    const page = copy.first(HiddenPage)!;
    expect(page.data).toEqual({ kind: 'sampled' });
    expect(Object.isFrozen(page.data)).toBe(true);
  });

  it('leaves what the seat was not told redacted when there is no sampler', () => {
    const copy = searchCopyForSeat(truthWithSecondSeatToMove(), 2, 'search');

    expect(copy.first(HiddenPage)!.isAttributeRedacted('data')).toBe(true);
  });

  it('refuses a sampler that rewrites what the seat can see', () => {
    expect(() =>
      searchCopyForSeat(truthWithSecondSeatToMove(), 2, 'search', {
        determinize: (game) => {
          game.first(HiddenPage)!.name = 'renamed';
        },
        rng: () => 0.5,
      }),
    ).toThrow(/contradicts what the seat can see/);
  });
});
