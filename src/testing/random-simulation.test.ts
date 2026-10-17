import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  Piece,
  Space,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { simulateRandomGames, replayRandomGame, type SimulateRandomGamesOptions } from './random-simulation.js';

/**
 * Minimal game whose only action takes an argument (a numeric choice). The
 * random simulator must generate a valid `value` arg for every move, or the
 * game can never progress — exactly the case the old harness silently failed.
 */
class PickGame extends Game<PickGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<PickGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.total < 6,
        maxIterations: 100,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

/**
 * A game whose length is gated by a GAME OPTION, not by player count. The
 * harness can only reach the longer configuration if it forwards
 * `gameOptions` to the game constructor.
 */
class TargetGame extends Game<TargetGame, Player> {
  total = 0;
  readonly target: number;

  constructor(options: GameOptions) {
    super(options);
    this.target = (options as { target?: number }).target ?? 6;

    this.registerAction(
      Action.create<TargetGame>('pick')
        .chooseFrom('value', { choices: [1] })
        .execute((args, ctx) => {
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.total < ctx.game.target,
        maxIterations: 200,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

/**
 * A game whose one action asks for text with `optional: ''`. An empty string is
 * falsy, so the engine and the action panel treat the step as REQUIRED, and the
 * simulator must too (#476): skipping it would send a move the engine refuses.
 */
class EmptyLabelTextGame extends Game<EmptyLabelTextGame, Player> {
  done = false;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<EmptyLabelTextGame>('note')
        .enterText('text', { optional: '' })
        .execute((_args, ctx) => {
          ctx.game.done = true;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => !ctx.game.done,
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['note'] }) }),
      }),
    });
  }
}

class Gem extends Piece<GemDraftGame> {
  value!: number;
}

class Pile extends Space<GemDraftGame> {}

/**
 * A draft whose moves are an element pick (`take`), a multi-element pick
 * (`discard`) and a repeating element pick (`hoard`), so the simulator's
 * element args reach the engine on both of its paths. Each execute
 * refuses an arg that is not the live game's own element, and the winner
 * depends on which gems were taken, so a seeded run's outcome pins the picks.
 */
class GemDraftGame extends Game<GemDraftGame, Player> {
  gems!: Pile;
  discards!: Pile;

  constructor(options: GameOptions) {
    super(options);
    this.gems = this.create(Pile, 'gems');
    this.discards = this.create(Pile, 'discards');
    for (let v = 1; v <= 9; v++) this.gems.create(Gem, `gem-${v}`, { value: v });
    for (const p of this.all(Player)) this.create(Pile, `hand-${p.seat}`);

    const isLive = (game: GemDraftGame, gem: unknown) =>
      gem instanceof Gem && game.getElementById(gem.id) === gem;

    this.registerAction(
      Action.create<GemDraftGame>('take')
        .chooseElement('gem', { elementClass: Gem, from: (ctx) => ctx.game.gems })
        .execute((args, ctx) => {
          if (!isLive(ctx.game, args.gem)) throw new Error('take was handed a gem that is not the live element');
          args.gem.putInto(ctx.game.handOf(ctx.player));
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create<GemDraftGame>('discard')
        .chooseElements('gems', { elements: (ctx) => [...ctx.game.gems.all(Gem)], multiSelect: 2 })
        .execute((args, ctx) => {
          if (!args.gems.every((g) => isLive(ctx.game, g))) {
            throw new Error('discard was handed a gem that is not the live element');
          }
          for (const g of args.gems) g.putInto(ctx.game.discards);
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create<GemDraftGame>('hoard')
        .chooseElement('picks', {
          elementClass: Gem,
          from: (ctx) => ctx.game.gems,
          repeat: {
            until: (ctx, gem) => gem.value >= 5 || ctx.game.gems.count(Gem) === 0,
            onEach: (ctx, gem) => {
              if (!isLive(ctx.game, gem)) throw new Error('hoard was handed a gem that is not the live element');
              gem.putInto(ctx.game.handOf(ctx.player));
            },
          },
        })
        .execute((args, ctx) => {
          if (!args.picks.every((g) => isLive(ctx.game, g))) {
            throw new Error('hoard was handed a gem that is not the live element');
          }
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.gems.count(Gem) > 0,
        maxIterations: 100,
        do: eachPlayer({ do: actionStep({ actions: ['take', 'discard', 'hoard'] }) }),
      }),
    });
  }

  handOf(player: Player): Pile {
    return this.first(Pile, `hand-${player.seat}`)!;
  }

  scoreOf(player: Player): number {
    return this.handOf(player).all(Gem).reduce((sum, g) => sum + g.value, 0);
  }

  override isFinished(): boolean {
    return this.gems.count(Gem) === 0;
  }

  override getWinners(): Player[] {
    if (!this.isFinished()) return [];
    const best = Math.max(...this.all(Player).map((p) => this.scoreOf(p)));
    return [...this.all(Player)].filter((p) => this.scoreOf(p) === best);
  }
}

/** A PickGame to 30 whose `validate` refuses 3, a value the engine still offers as enabled (#910). */
class RejectThreeGame extends Game<RejectThreeGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<RejectThreeGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3], validate: (v) => v !== 3 })
        .execute((args, ctx) => {
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.total < 30,
        maxIterations: 100,
        do: eachPlayer({ do: actionStep({ actions: ['pick'] }) }),
      }),
    });
  }
}

describe('simulateRandomGames', () => {
  it("treats an empty-string `optional` as required, as the engine does (#476)", async () => {
    const results = await simulateRandomGames(EmptyLabelTextGame, {
      count: 1,
      playerCounts: [2],
      seed: 'empty-label',
      timeout: 5000,
    });

    expect(results.stuck).toBe(1);
    expect(results.games[0]!.error).toContain("requires text input 'text'");
  });

  it('submits element, multi-element and repeating element picks the engine plays as live elements, with a pinned seeded outcome (#686)', async () => {
    const results = await simulateRandomGames(GemDraftGame, {
      count: 8,
      playerCounts: [2, 3],
      seed: 'bs686',
      timeout: 5000,
    });

    expect(results.games.map((g) => g.error)).toEqual(Array(8).fill(undefined));
    expect(results.completed).toBe(8);
    expect(results.games.map((g) => g.actionCount)).toEqual([4, 5, 5, 8, 7, 5, 6, 7]);
    expect(results.games.map((g) => g.winners)).toEqual([[2], [1], [1, 2], [2], [2], [2], [1], [3]]);
  });

  it('fails a game on the first engine-generated move its validation rejects, naming the action and move (#910)', async () => {
    const results = await simulateRandomGames(RejectThreeGame, {
      count: 20,
      playerCounts: [2],
      seed: 'bs910',
      timeout: 5000,
    });

    expect(results.completed).toBe(0);
    expect(results.stuck).toBe(20);
    for (const game of results.games) {
      expect(game.error).toMatch(/^Action 'pick' rejected the move \{"value":3\} that the engine offered as enabled: /);
    }
  });

  it('generates valid arguments so arg-based games complete (F49)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 12,
      playerCounts: [2, 3],
      seed: 'fixed-base',
      timeout: 5000,
    });

    expect(results.total).toBe(12);
    expect(results.completed).toBe(12);
    expect(results.crashed).toBe(0);
    expect(results.stuck).toBe(0);
    expect(results.timedOut).toBe(0);
    // Every completed game must have actually executed arg-bearing actions.
    expect(results.averageActions).toBeGreaterThan(0);
  });

  it('is deterministic and reproducible from the base seed (F50)', async () => {
    const opts: SimulateRandomGamesOptions = {
      count: 6,
      playerCounts: [2],
      seed: 'repro-seed',
      timeout: 5000,
    };

    const a = await simulateRandomGames(PickGame, opts);
    const b = await simulateRandomGames(PickGame, opts);

    // The reported base seed is the one we provided (no Date.now() drift).
    expect(a.seed).toBe('repro-seed');
    expect(b.seed).toBe('repro-seed');

    // Per-game seeds and outcomes match across identical runs.
    expect(a.games.map(g => g.seed)).toEqual(b.games.map(g => g.seed));
    expect(a.games.map(g => g.actionCount)).toEqual(b.games.map(g => g.actionCount));
    expect(a.games.map(g => g.winners)).toEqual(b.games.map(g => g.winners));
  });

  it('returns a base seed that can be regenerated when none is provided (F50)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 2,
      playerCounts: [2],
      timeout: 5000,
    });
    expect(typeof results.seed).toBe('string');
    expect(results.seed.length).toBeGreaterThan(0);
    // Per-game seeds are derived from the generated base seed.
    expect(results.games[0].seed.startsWith(results.seed)).toBe(true);
  });

  it('replays a single game deterministically by its seed (F50)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 4,
      playerCounts: [2],
      seed: 'replay-base',
      timeout: 5000,
    });

    const target = results.games[0];
    const replay = await replayRandomGame(PickGame, {
      seed: target.seed,
      playerCount: target.playerCount,
    });

    expect(replay.seed).toBe(target.seed);
    expect(replay.actionCount).toBe(target.actionCount);
    expect(replay.completed).toBe(target.completed);
    expect(replay.winners).toEqual(target.winners);
  });

  describe('gameOptions forwarding (issue 141)', () => {
    it('reaches a game-option-gated configuration', async () => {
      const base = await simulateRandomGames(TargetGame, {
        count: 2,
        playerCounts: [2],
        seed: 'option-base',
        timeout: 5000,
      });
      const gated = await simulateRandomGames(TargetGame, {
        count: 2,
        playerCounts: [2],
        seed: 'option-base',
        timeout: 5000,
        gameOptions: { target: 30 },
      });

      expect(base.completed).toBe(2);
      expect(gated.completed).toBe(2);
      expect(base.games[0].actionCount).toBe(6);
      expect(gated.games[0].actionCount).toBe(30);
    });

    it('forwards gameOptions through replayRandomGame so a failure reproduces', async () => {
      const gated = await simulateRandomGames(TargetGame, {
        count: 1,
        playerCounts: [2],
        seed: 'option-replay',
        timeout: 5000,
        gameOptions: { target: 12 },
      });
      const target = gated.games[0];

      const replay = await replayRandomGame(TargetGame, {
        seed: target.seed,
        playerCount: target.playerCount,
        gameOptions: { target: 12 },
      });

      expect(replay.actionCount).toBe(target.actionCount);
      expect(replay.actionCount).toBe(12);
    });

    it('refuses a gameOptions key the harness owns rather than silently ignoring it', async () => {
      await expect(
        simulateRandomGames(TargetGame, {
          count: 1,
          playerCounts: [2],
          seed: 'option-clash',
          gameOptions: { playerCount: 4 },
        }),
      ).rejects.toThrow(/playerCount/);
    });
  });
});

/**
 * #172: the harness is the only thing that knows a step's REAL candidate count,
 * because a count only exists once a game is running. `onSelectionChoices` is
 * how `boardsmith validate` gets those counts without re-implementing move
 * enumeration.
 */
describe('onSelectionChoices observer', () => {
  it('reports every enumerated selection with its enabled candidate count', async () => {
    const seen: Array<{ action: string; selection: string; count: number; type: string }> = [];

    await simulateRandomGames(PickGame, {
      count: 1,
      playerCounts: [2],
      seed: 'observer-seed',
      onSelectionChoices: ({ action, selection, candidateCount }) => {
        seen.push({
          action,
          selection: selection.name,
          count: candidateCount,
          type: selection.type,
        });
      },
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.action).toBe('pick');
      expect(s.selection).toBe('value');
      expect(s.type).toBe('choice');
      // chooseFrom('value', { choices: [1, 2, 3] })
      expect(s.count).toBe(3);
    }
  });

  it('is optional — a run without it behaves identically', async () => {
    const withObserver = await simulateRandomGames(PickGame, {
      count: 1,
      playerCounts: [2],
      seed: 'same-seed',
      onSelectionChoices: () => {},
    });
    const without = await simulateRandomGames(PickGame, {
      count: 1,
      playerCounts: [2],
      seed: 'same-seed',
    });
    expect(withObserver.games[0].actionCount).toBe(without.games[0].actionCount);
    expect(withObserver.completed).toBe(without.completed);
  });
});
