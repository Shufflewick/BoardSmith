/**
 * #1362: `searchCopyForSeat` builds a seat's search copy the way the bot's own
 * search does, so a game can test its sampler and `afterRestore` hooks against
 * the copy the bot really searches: the seat's redacted view read as the seat
 * was shown it, the turn, the element id sequence and a seeded random state,
 * then the sampler, then the hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Game, Player, Space, Card, Action, loop, eachPlayer, actionStep, sequence, simultaneousActionStep, execute, RedactedAttributeError,
  type GameOptions,
} from '../engine/index.js';
import { SeededRandom } from '../utils/random.js';
import { _clearShownWarnings } from '../utils/dev.js';
import { dueSeatOffers } from '../engine/flow/seat-activity.js';
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

  it('refuses, by name, a seat the game does not have', () => {
    expect(() => searchCopyForSeat(truthWithSecondSeatToMove(), 3, 'search')).toThrow(
      'searchCopyForSeat was given seat 3, but this game has seats 1 to 2. Seats count from 1.',
    );
  });
});

/** Seven's card (#1433): its own `color` and `seat` share names with a player's identity fields. */
class TintedCard extends Card<TintedGame> {
  color = 'red';
  seat = 2;
}

class TintedGame extends Game<TintedGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([TintedCard]);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }) });
    const hand = this.create(Space, 'hand');
    hand.player = this.getPlayer(2)!;
    hand.contentsVisibleToOwner();
    hand.create(TintedCard, 'card');
  }
}

describe('a sampler and a hidden card\'s own color (#1433)', () => {
  it('may write the color the seat was never told', () => {
    const truth = new TintedGame({ playerCount: 2, seed: 'truth' });
    truth.startFlow();

    const copy = searchCopyForSeat(truth, 1, 'search', {
      determinize: (game) => {
        game.first(TintedCard)!.color = 'blue';
      },
      rng: () => 0.5,
    });

    expect(copy.first(TintedCard)!.color).toBe('blue');
  });

  it('throws on reading a hidden piece\'s own seat, so a lookup by owner needs a sampler (#1434)', () => {
    const truth = new TintedGame({ playerCount: 2, seed: 'truth' });
    truth.startFlow();

    const copy = searchCopyForSeat(truth, 1, 'search');

    expect(() => copy.first(TintedCard, (card) => card.seat === 2)).toThrow(RedactedAttributeError);
  });
});

/** Both seats plan at once, then a rule fails while the plans resolve: one-two-punch's shape (#1428). */
class PlanGame extends Game<PlanGame, Player> {
  planned: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('plan').execute((_args, ctx) => {
      this.planned = [...this.planned, ctx.player.seat];
    }));
    this.setFlow({
      root: sequence(
        simultaneousActionStep({ actions: ['plan'], playerDone: (_ctx, player) => this.planned.includes(player.seat) }),
        execute(() => {
          throw new Error('the reveal failed');
        }),
      ),
    });
  }
}

const turnAndPrompt = (game: PlanGame) => ({ turn: game.currentPlayer?.seat, prompted: game.getCurrentFlowPlayer()?.seat });

/** Seat 1 has planned; seat 2's plan closes the step and runs the failing rule. */
function planToTheFailedReveal(game: PlanGame): void {
  expect(() => game.continueFlow('plan', {}, 2)).toThrow(/the reveal failed/);
}

describe('the turn and the prompted seat in a search copy (#1428)', () => {
  it('match the live game at rest and after a rule fails mid-flow', () => {
    const truth = new PlanGame({ playerCount: 2, seed: 'truth' });
    truth.startFlow();
    truth.continueFlow('plan', {}, 1);
    const copy = searchCopyForSeat(truth, 2, 'search');
    expect(turnAndPrompt(truth)).toEqual({ turn: undefined, prompted: undefined });
    expect(turnAndPrompt(copy)).toEqual(turnAndPrompt(truth));

    planToTheFailedReveal(truth);
    planToTheFailedReveal(copy);

    // They differ by design: seat 1 holds the turn from the flow's start and nothing moved it,
    // but the flow stopped in an execute, so no step is prompting anyone.
    expect(turnAndPrompt(truth)).toEqual({ turn: 1, prompted: undefined });
    expect(turnAndPrompt(copy)).toEqual(turnAndPrompt(truth));
  });
});

class Holder extends Player<RoundGame, Holder> {
  static override visibleAttributes: string[] = [];
  /** Withheld from every seat but its own, like a hand of cards. */
  secret = 0;
}

/** Seven's shape (#1431): discard, then draw, then score, each step for both seats at once; only `score` reads the seat's secret. */
class RoundGame extends Game<RoundGame, Holder> {
  static override PlayerClass = Holder;
  discarded: number[] = [];
  drawn: number[] = [];
  scored: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('discard').execute((_args, ctx) => { this.discarded = [...this.discarded, ctx.player.seat]; }));
    this.registerAction(Action.create('draw').execute((_args, ctx) => { this.drawn = [...this.drawn, ctx.player.seat]; }));
    this.registerAction(Action.create('score')
      .chooseFrom('points', { prompt: 'Score', choices: (ctx) => [(ctx.player as Holder).secret] })
      .execute((_args, ctx) => { this.scored = [...this.scored, ctx.player.seat]; }));
    this.setFlow({
      root: sequence(
        simultaneousActionStep({ actions: ['discard'], playerDone: (_ctx, player) => this.discarded.includes(player.seat) }),
        simultaneousActionStep({ actions: ['draw'], playerDone: (_ctx, player) => this.drawn.includes(player.seat) }),
        simultaneousActionStep({ actions: ['score'], playerDone: (_ctx, player) => this.scored.includes(player.seat) }),
      ),
    });
  }
}

const offered = (game: RoundGame) => game.getFlowState()?.awaitingPlayers?.map((p) => [p.playerIndex, p.availableActions]);

/** Seat 2 has discarded; seat 1's copy is waiting on seat 1's discard. */
function copyBeforeTheLastDiscard(): RoundGame {
  const truth = new RoundGame({ playerCount: 2, seed: 'truth' });
  truth.getPlayer(1)!.secret = 3;
  truth.getPlayer(2)!.secret = 5;
  truth.startFlow();
  truth.continueFlow('discard', {}, 2);
  return searchCopyForSeat(truth, 1, 'search');
}

describe('the actions a step offers in a search copy (#1431)', () => {
  it('checks only the actions the step declares, so an undeclared one that reads a hidden secret never runs', () => {
    const copy = copyBeforeTheLastDiscard();

    copy.continueFlow('discard', {}, 1);

    expect(offered(copy)).toEqual([[1, ['draw']], [2, ['draw']]]);
  });

  it('offers no move to a seat whose declared action reads its withheld secret, and names the action and attribute', () => {
    const copy = copyBeforeTheLastDiscard();
    copy.continueFlow('discard', {}, 1);
    copy.continueFlow('draw', {}, 1);
    _clearShownWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      copy.continueFlow('draw', {}, 2);

      expect(offered(copy)).toEqual([[1, ['score']]]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Action "score" .* seat 2 .*"secret" on Holder/));
    } finally {
      warn.mockRestore();
    }
  });
});

/** Both seats have discarded and drawn; seat 1's copy is where both are offered `score`, as the truth offered it. */
function copyAtTheScore(): RoundGame {
  const truth = new RoundGame({ playerCount: 2, seed: 'truth' });
  truth.getPlayer(1)!.secret = 3;
  truth.getPlayer(2)!.secret = 5;
  truth.startFlow();
  for (const action of ['discard', 'draw']) for (const seat of [1, 2]) truth.continueFlow(action, {}, seat);
  return searchCopyForSeat(truth, 1, 'search');
}

describe('the reasons a seat\'s actions are disabled in a search copy (#1432)', () => {
  it('checks only the actions the seat is offered, so an undeclared one that reads a hidden secret never runs', () => {
    const copy = copyBeforeTheLastDiscard();

    expect(copy.getDisabledActions(2)).toEqual({});
  });

  it('gives a seat whose offered action reads its withheld secret no move, and names the action and attribute', () => {
    const copy = copyAtTheScore();
    _clearShownWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const offers = dueSeatOffers(copy.getFlowState(), copy);

      expect(offers.map(({ seat, enabled, canMove }) => ({ seat, enabled, canMove }))).toEqual([
        { seat: 1, enabled: ['score'], canMove: true },
        { seat: 2, enabled: [], canMove: false },
      ]);
      expect(offers[1].refused.score).toMatch(/"secret" on Holder/);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Action "score" .* seat 2 .*"secret" on Holder/));
    } finally {
      warn.mockRestore();
    }
  });
});
