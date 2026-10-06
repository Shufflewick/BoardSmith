import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  actionStep,
  defineFlow,
  execute,
  loop,
  sequence,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { simulateRandomGames, replayRandomGame, noSeatHasEnabledAction } from './random-simulation.js';

/**
 * Both seats spend coins in one simultaneous step that never ends on its own,
 * and `spend` is `.disabled()` once a seat is out of coins. So the game has no
 * ending: once every seat is broke no move exists. That is the shape of a game
 * built chunk by chunk before the chunk that ends it (#317), and the shape of
 * an action the panel greys out rather than hides (#318).
 *
 * `coins` is a game option listing each seat's starting coins, seat 1 first.
 */
class CoinGame extends Game<CoinGame, Player> {
  readonly coins: number[];
  spent = 0;

  constructor(options: GameOptions) {
    super(options);
    this.coins = [...((options as { coins?: number[] }).coins ?? [3, 3])];

    this.registerAction(
      Action.create<CoinGame>('spend')
        .disabled((ctx) => (ctx.game.coins[ctx.player.seat - 1] < 1 ? 'You have no coins.' : false))
        .execute((_args, ctx) => {
          ctx.game.coins[ctx.player.seat - 1] -= 1;
          ctx.game.spent += 1;
        }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({ actions: ['spend'], playerDone: () => false }),
      }),
    );
  }
}

const NO_ENABLED_ACTION = /^Game is awaiting input but no player has an enabled action to take\./;

describe('#318: a .disabled() action is not a playable move', () => {
  it('stops a game on "no enabled action" once every seat is refused, not on repeated rejections', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'disabled-318',
      gameOptions: { coins: [3, 3] },
    });

    expect(results.crashed).toBe(0);
    for (const game of results.games) {
      expect(game.stuck).toBe(true);
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.error).not.toMatch(/consecutive actions/);
      expect(game.actionCount).toBe(6);
      expect(game.error).toContain("Refused: player 1's 'spend' (You have no coins); player 2's 'spend' (You have no coins).");
    }
  });

  it('keeps playing the seat that still has an enabled action while the other is refused', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'disabled-318-lopsided',
      gameOptions: { coins: [0, 25] },
    });

    for (const game of results.games) {
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.actionCount).toBe(25);
    }
  });
});

/** The rest CoinGame is built to reach: nobody can spend, because nobody has a coin. */
const broke = (game: CoinGame): string | false =>
  game.coins.every((c) => c === 0) ? 'every seat has spent its coins; the ending is not built yet' : false;

describe('#317: a game can declare where it is meant to rest', () => {
  it('reports a game stopped at its declared rest as resting, with the reason, and not as stuck', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 4,
      playerCounts: [2],
      seed: 'rest-317',
      gameOptions: { coins: [2, 3] },
      isResting: broke,
    });

    expect(results.resting).toBe(4);
    expect(results.stuck).toBe(0);
    expect(results.completed).toBe(0);
    expect(results.errors).toEqual([]);
    for (const game of results.games) {
      expect(game.resting).toBe(true);
      expect(game.stuck).toBe(false);
      expect(game.restReason).toBe('every seat has spent its coins; the ending is not built yet');
      expect(game.error).toBeUndefined();
      expect(game.actionCount).toBe(5);
    }
  });

  it('hands isResting the game itself, so a test can check the state it rests in', async () => {
    const finals: CoinGame[] = [];
    await simulateRandomGames(CoinGame, {
      count: 2,
      playerCounts: [2],
      seed: 'rest-317-state',
      gameOptions: { coins: [1, 2] },
      isResting: (game) => {
        const reason = broke(game);
        if (reason) finals.push(game);
        return reason;
      },
    });

    expect(finals).toHaveLength(2);
    for (const game of finals) {
      expect(game).toBeInstanceOf(CoinGame);
      expect(game.spent).toBe(3);
    }
  });

  it('still reports a stop the game did not declare as stuck, and says how to declare one', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 2,
      playerCounts: [2],
      seed: 'rest-317-undeclared',
      gameOptions: { coins: [1, 1] },
      isResting: () => false,
    });

    expect(results.resting).toBe(0);
    expect(results.stuck).toBe(2);
    for (const game of results.games) {
      expect(game.resting).toBe(false);
      expect(game.restReason).toBeUndefined();
      expect(game.error).toMatch(NO_ENABLED_ACTION);
      expect(game.error).toContain('isResting');
    }
  });

  it('is not asked before a move has been applied, so it cannot hide a game the simulator could not play', async () => {
    class TextGame extends CoinGame {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(Action.create<TextGame>('name').enterText('label').execute(() => {}));
        this.setFlow(defineFlow({ root: simultaneousActionStep({ actions: ['name'], playerDone: () => false }) }));
      }
    }
    let asked = 0;
    const results = await simulateRandomGames(TextGame, {
      count: 1,
      playerCounts: [2],
      seed: 'rest-317-text',
      isResting: () => {
        asked++;
        return 'never';
      },
    });

    expect(asked).toBe(0);
    expect(results.stuck).toBe(1);
    expect(results.resting).toBe(0);
    expect(results.games[0].error).toMatch(/requires text input 'label'/);
  });

  it('replayRandomGame takes the same isResting, so a replay gives the same verdict', async () => {
    const results = await simulateRandomGames(CoinGame, {
      count: 1,
      playerCounts: [2],
      seed: 'rest-317-replay',
      gameOptions: { coins: [2, 2] },
      isResting: broke,
    });
    const [played] = results.games;

    const replay = await replayRandomGame(CoinGame, {
      seed: played.seed,
      playerCount: played.playerCount,
      gameOptions: { coins: [2, 2] },
      isResting: broke,
    });

    expect(replay.resting).toBe(true);
    expect(replay.restReason).toBe(played.restReason);
    expect(replay.actionCount).toBe(played.actionCount);
  });
});

/**
 * Every seat can always check in, even again, round after round: the flow is
 * one unbounded loop around a simultaneous step whose action is never refused.
 * So the game never stops on its own. That is the shape of a game whose seats
 * always have something to do while the rule that moves it on is not built yet
 * (#383, found in Windup Warfare's check-in chunk).
 */
class CheckInGame extends Game<CheckInGame, Player> {
  checkedIn: number[] = [];
  /** Seats that have acted in the current round; each seat acts once a round. */
  actedThisRound: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<CheckInGame>('checkIn').execute((_args, ctx) => {
        ctx.game.actedThisRound.push(ctx.player.seat);
        if (!ctx.game.checkedIn.includes(ctx.player.seat)) ctx.game.checkedIn.push(ctx.player.seat);
      }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          unbounded: true,
          do: sequence(
            execute((ctx) => {
              ctx.game.actedThisRound = [];
            }),
            simultaneousActionStep({
              actions: ['checkIn'],
              playerDone: (ctx, player) => ctx.game.actedThisRound.includes(player.seat),
            }),
          ),
        }),
      }),
    );
  }
}

/** The rest CheckInGame is built to reach: every seat has checked in. */
const allCheckedIn = (game: CheckInGame): string | false =>
  game.checkedIn.length === game.players.length ? 'every seat has checked in; battle is not built yet' : false;

describe('#383: a game whose seats can always act can still rest', () => {
  it('without isResting, never stops on its own: it runs to maxActions', async () => {
    const results = await simulateRandomGames(CheckInGame, {
      count: 2,
      playerCounts: [3],
      seed: 'rest-383-none',
      maxActions: 40,
    });

    expect(results.exceededMaxActions).toBe(2);
    expect(results.resting).toBe(0);
  });

  it('reports the game resting the moment isResting names a rest, not timed out or over maxActions', async () => {
    const results = await simulateRandomGames(CheckInGame, {
      count: 4,
      playerCounts: [3],
      seed: 'rest-383',
      maxActions: 40,
      isResting: allCheckedIn,
    });

    expect(results.resting).toBe(4);
    expect(results.exceededMaxActions).toBe(0);
    expect(results.timedOut).toBe(0);
    expect(results.stuck).toBe(0);
    expect(results.crashed).toBe(0);
    expect(results.errors).toEqual([]);
    for (const game of results.games) {
      expect(game.restReason).toBe('every seat has checked in; battle is not built yet');
      // Three seats each act once per round, so the third move completes the check-in.
      expect(game.actionCount).toBe(3);
    }
  });

  it('is asked after every applied move, with the game as that move left it', async () => {
    const seen: number[] = [];
    const results = await simulateRandomGames(CheckInGame, {
      count: 1,
      playerCounts: [3],
      seed: 'rest-383-asked',
      maxActions: 40,
      isResting: (game) => {
        seen.push(game.checkedIn.length);
        return allCheckedIn(game);
      },
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(results.games[0].actionCount).toBe(3);
  });

  it('still reports a game that never reaches its declared rest as over maxActions', async () => {
    const results = await simulateRandomGames(CheckInGame, {
      count: 2,
      playerCounts: [3],
      seed: 'rest-383-never',
      maxActions: 40,
      isResting: () => false,
    });

    expect(results.exceededMaxActions).toBe(2);
    expect(results.resting).toBe(0);
  });

  it('is not asked about a game the move ended, so a finished game is completed, not resting', async () => {
    class OneMoveGame extends Game<OneMoveGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(Action.create<OneMoveGame>('finish').execute(() => {}));
        this.setFlow(defineFlow({ root: actionStep({ actions: ['finish'] }) }));
      }
    }
    let asked = 0;
    const results = await simulateRandomGames(OneMoveGame, {
      count: 1,
      playerCounts: [2],
      seed: 'rest-383-ended',
      isResting: () => {
        asked++;
        return 'always';
      },
    });

    expect(asked).toBe(0);
    expect(results.completed).toBe(1);
    expect(results.resting).toBe(0);
  });

  it('replayRandomGame asks the same isResting the same way, so a replay gives the same verdict', async () => {
    const replay = await replayRandomGame(CheckInGame, {
      seed: 'rest-383-replay',
      playerCount: 2,
      maxActions: 40,
      isResting: allCheckedIn,
    });

    expect(replay.resting).toBe(true);
    expect(replay.actionCount).toBe(2);
  });
});

describe('#518: the simulator asks dueSeats which seats may act', () => {
  it('offers the awaiting seats of a simultaneous step, not a stale currentPlayer', () => {
    // Seat 1 has coins but has finished the step; seat 2 is still due and is
    // broke, so its only action is refused. The flow state also carries a stale
    // currentPlayer (seat 1) with its old actions, the shape #321 once produced.
    const game = new CoinGame({ playerCount: 2, seed: 'stale-current-518', coins: [3, 0] } as GameOptions);
    game.startFlow();
    expect(game.isAwaitingInput()).toBe(true);
    const real = game.getFlowState()!;
    vi.spyOn(game, 'getFlowState').mockReturnValue({
      ...real,
      currentPlayer: 1,
      availableActions: ['spend'],
      awaitingPlayers: [
        { playerIndex: 1, availableActions: [], completed: true },
        { playerIndex: 2, availableActions: ['spend'], completed: false },
      ],
    });

    // Only seat 2 is due, and its one action is refused: nobody can move.
    expect(noSeatHasEnabledAction(game)).toBe(true);
  });
});
