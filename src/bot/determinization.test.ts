import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  RedactedAttributeError,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { DeterminizationError, applyDeterminization } from './determinization.js';
import type { BotConfig, BotStrategy, DeterminizeSampler } from './types.js';

// ============================================================================
// #73: determinization — sampling a world consistent with the seat's own
// information set, so a bot can SEARCH hidden state instead of skipping it.
//
// The game below is the smallest shape that makes the property visible:
// three doors, one of them trapped. Which door is trapped is the keeper's
// secret and is withheld from every other seat. What every seat DOES know is
// `notTrapped`: one door the keeper has publicly declared safe.
//
// So the information set holds two worlds, and the three moves separate:
//   open(notTrapped)  wins in BOTH worlds          -> 1.0
//   open(other)       wins in exactly one of them  -> 0.5
//   walkAway          draws in both                -> 0.5
//
// A single determinization cannot tell `open(notTrapped)` from whichever
// other door happens to be safe in the one world it sampled. Only aggregating
// across re-sampled worlds separates them, which is the whole point of the
// feature and is what the strength test below pins.
// ============================================================================

class Keeper extends Player<VaultGame, Keeper> {
  /** `notTrapped` is public; `secret` is not. */
  static override visibleAttributes = ['seat', 'name', 'status', 'notTrapped'];
  /** The trapped door. Withheld: `0` is a real door. */
  secret = 0;
  /** A door the keeper has declared safe. Public, and never the trapped one. */
  notTrapped = 0;
}

class VaultGame extends Game<VaultGame, Keeper> {
  static override PlayerClass = Keeper;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('open')
        .chooseFrom('door', {
          prompt: 'Which door?',
          // Reads the keeper's secret, exactly as the reporting game's
          // `travel` reads a map seat it cannot see. In a redacted sandbox
          // with no determinization this throws, the enumerator drops the
          // action, and `open` is never searched at all.
          choices: (ctx) => {
            const keeper = (ctx.game as VaultGame).keeper;
            return keeper.secret >= 0 ? [0, 1, 2] : [];
          },
        })
        .execute((args, ctx) => {
          const game = ctx.game as VaultGame;
          const winner = args.door === game.keeper.secret ? game.keeper : game.getPlayer(1)!;
          game.finish([winner]);
          return { success: true };
        })
    );

    this.registerAction(
      Action.create('walkAway').execute((_args, ctx) => {
        (ctx.game as VaultGame).finish([]);
        return { success: true };
      })
    );

    this.setFlow(defineFlow({
      root: actionStep({
        actions: ['open', 'walkAway'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
      isComplete: (ctx) => ctx.game.isFinished(),
      getWinners: (ctx) => (ctx.game as VaultGame).winnerPlayers(),
    }));
  }

  /** Seat 2 keeps the vault; seat 1 is the one deciding. */
  get keeper(): Keeper {
    return this.getPlayer(2)!;
  }

  winnerPlayers(): Keeper[] {
    const winners = (this.settings.winners ?? []) as number[];
    return winners.map((seat) => this.getPlayer(seat)!);
  }
}

function createVault(secret: number, notTrapped: number, seed = 'vault'): VaultGame {
  const game = new VaultGame({ playerCount: 2, playerNames: ['Opener', 'Keeper'], seed });
  const keeper = game.getPlayer(2)!;
  keeper.secret = secret;
  keeper.notTrapped = notTrapped;
  game.startFlow();
  return game;
}

/** Sample a trapped door consistent with the one public fact about it. */
const honestSampler: DeterminizeSampler = (sandbox, seat, rng) => {
  const keeper = (sandbox as VaultGame).keeper;
  if (keeper.seat === seat || !keeper.isAttributeRedacted('secret')) return;
  const candidates = [0, 1, 2].filter((door) => door !== keeper.notTrapped);
  keeper.secret = candidates[Math.floor(rng() * candidates.length)];
};

function makeBot(
  game: VaultGame,
  strategy: BotStrategy,
  seed = 'search',
  config: Partial<BotConfig> = {},
): MCTSBot<VaultGame> {
  return new MCTSBot(
    game,
    VaultGame,
    'vault',
    1,
    [],
    { iterations: 240, playoutDepth: 2, seed, async: false, timeout: Infinity, usePNS: false, ...config },
    strategy,
  );
}

describe('#73 determinization: the sampler contract', () => {
  it('hands the sampler the seat\'s REDACTED sandbox, never the authoritative game', () => {
    const game = createVault(1, 0);
    const seen: Array<{ isSandbox: boolean; redacted: boolean; seat: number }> = [];

    const bot = makeBot(game, {
      determinize: (sandbox, seat) => {
        const keeper = (sandbox as VaultGame).keeper;
        seen.push({
          isSandbox: sandbox !== (game as Game),
          redacted: keeper.isAttributeRedacted('secret'),
          seat,
        });
        honestSampler(sandbox, seat, () => 0);
      },
    });

    return bot.play().then(() => {
      expect(seen.length).toBeGreaterThan(0);
      for (const entry of seen) {
        expect(entry.isSandbox).toBe(true);
        expect(entry.redacted).toBe(true);
        expect(entry.seat).toBe(1);
      }
      // The authoritative game is untouched by anything the sampler wrote.
      expect(game.keeper.secret).toBe(1);
      expect(game.keeper.isAttributeRedacted('secret')).toBe(false);
    });
  });

  it('re-samples once per search iteration, not once per move', async () => {
    const game = createVault(1, 0);
    let calls = 0;
    const bot = makeBot(game, {
      determinize: (sandbox, seat, rng) => {
        calls++;
        honestSampler(sandbox, seat, rng);
      },
    });

    await bot.play();
    // One world per MCTS iteration (plus the root world the search starts in).
    expect(calls).toBeGreaterThan(50);
  });

  it('samples only worlds consistent with what the seat legitimately knows', async () => {
    const game = createVault(2, 0);
    const sampled: number[] = [];
    const bot = makeBot(game, {
      determinize: (sandbox, seat, rng) => {
        honestSampler(sandbox, seat, rng);
        sampled.push((sandbox as VaultGame).keeper.secret);
      },
    });

    await bot.play();

    expect(sampled.length).toBeGreaterThan(0);
    // Every sampled world agrees with the public fact, and both consistent
    // worlds actually come up (the sampler is not collapsing to one guess).
    expect(sampled.every((s) => s !== 0)).toBe(true);
    expect(new Set(sampled)).toEqual(new Set([1, 2]));
  });

  it('refuses a sampler that overwrites something the seat already knows', async () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {
      determinize: (sandbox) => {
        // `notTrapped` is public. Rewriting it invents a world that
        // contradicts the seat's own view — #19's defect, through the front
        // door and with the game's blessing.
        (sandbox as VaultGame).keeper.notTrapped = 2;
      },
    });

    await expect(bot.play()).rejects.toThrow(DeterminizationError);
    await expect(bot.play()).rejects.toThrow(/notTrapped/);
  });

  it('names the element and the attribute when a sampler contradicts the view', async () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {
      determinize: (sandbox) => {
        (sandbox as VaultGame).keeper.notTrapped = 2;
      },
    });

    await expect(bot.play()).rejects.toThrow(/Keeper/);
    await expect(bot.play()).rejects.toThrow(/determinize/);
  });

  it('refuses a sampler that removes an element the seat can see', async () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {
      determinize: (sandbox) => {
        (sandbox as VaultGame).keeper.notTrapped = 0; // no-op write, still known
        (sandbox as VaultGame)._t.children.length = 0;
      },
    });

    await expect(bot.play()).rejects.toThrow(DeterminizationError);
  });

  it('reports a sampler that reads the very attribute it was asked to sample', async () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {
      determinize: (sandbox) => {
        // No `isAttributeRedacted` guard: this reads a value the sandbox was
        // never told, which is the one thing a sampler must never do.
        const keeper = (sandbox as VaultGame).keeper;
        keeper.secret = keeper.secret;
      },
    });

    await expect(bot.play()).rejects.toThrow(DeterminizationError);
    await expect(bot.play()).rejects.toThrow(/RedactedAttributeError|never told|does not have/);
  });

  it('leaves the withheld attribute unreadable when the sampler declines to fill it', async () => {
    const game = createVault(1, 0);
    let stillRedacted: boolean | undefined;
    const bot = makeBot(game, {
      determinize: (sandbox) => {
        stillRedacted = (sandbox as VaultGame).keeper.isAttributeRedacted('secret');
      },
    });

    const move = await bot.play();
    expect(stillRedacted).toBe(true);
    // Unsampled means unsearchable, exactly as before the feature existed.
    expect(move?.action).toBe('walkAway');
  });
});

describe('#73 determinization: the search sees only the information set', () => {
  it('returns the same move and the same statistics for two different truths', async () => {
    // Same public view (notTrapped = 0), different hidden truth.
    const stats = await Promise.all([1, 2].map(async (secret) => {
      const bot = makeBot(createVault(secret, 0), {
          determinize: honestSampler,
      }, 'leak-check');
      return bot.playWithStats();
    }));

    expect(stats[0].move).toEqual(stats[1].move);
    expect(stats[0].stats).toEqual(stats[1].stats);
  });

  it('still refuses to read a withheld attribute outside the sampler', () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {});
    const sandbox = (bot as unknown as {
      restoreGame(s: unknown): VaultGame;
      captureSnapshot(): unknown;
    });
    const clone = sandbox.restoreGame(sandbox.captureSnapshot());
    expect(() => clone.keeper.secret).toThrow(RedactedAttributeError);
  });
});

describe('#73 determinization: aggregation beats skipping', () => {
  const baselineStrategy: BotStrategy = {};
  const determinizingStrategy: BotStrategy = { determinize: honestSampler };

  it('the skip-hidden baseline can only walk away', async () => {
    for (const notTrapped of [0, 1, 2]) {
      const secret = (notTrapped + 1) % 3;
      const move = await makeBot(createVault(secret, notTrapped), baselineStrategy).play();
      expect(move).toEqual({ action: 'walkAway', args: {} });
    }
  });

  it('the determinizing bot opens the door that wins in EVERY consistent world', async () => {
    for (const notTrapped of [0, 1, 2]) {
      const secret = (notTrapped + 1) % 3;
      const move = await makeBot(createVault(secret, notTrapped), determinizingStrategy).play();
      expect(move?.action).toBe('open');
      expect(move?.args.door).toBe(notTrapped);
    }
  });

  it('scores the always-safe door above the doors that only sometimes win', async () => {
    // RAVE off: it blends a GLOBAL per-move average into a low-visit child's
    // score, which is the wrong lens for reading a child's own aggregated
    // value. What is under test is the per-child average over sampled worlds.
    const { stats } = await makeBot(
      createVault(1, 0), determinizingStrategy, 'search', { useRAVE: false },
    ).playWithStats();
    const byDoor = new Map<unknown, number>();
    for (const s of stats) {
      if (s.move.action === 'open') byDoor.set(s.move.args.door, s.value);
      else byDoor.set('walkAway', s.value);
    }
    expect(byDoor.get(0)!).toBeGreaterThan(byDoor.get(1)!);
    expect(byDoor.get(0)!).toBeGreaterThan(byDoor.get(2)!);
    expect(byDoor.get(0)!).toBeGreaterThan(byDoor.get('walkAway')!);
  });

  it('wins where the baseline draws, over every truth in the information set', async () => {
    const outcome = async (strategy: BotStrategy, secret: number) => {
      const game = createVault(secret, 0);
      const move = await makeBot(game, strategy).play();
      if (!move || move.action !== 'open') return 0.5;      // walked away: a draw
      return move.args.door === secret ? 0 : 1;             // opened: trapped or not
    };

    const truths = [1, 2];
    const baseline = await Promise.all(truths.map((s) => outcome(baselineStrategy, s)));
    const determinized = await Promise.all(truths.map((s) => outcome(determinizingStrategy, s)));

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(baseline)).toBe(0.5);
    expect(mean(determinized)).toBe(1);
  });
});

describe('#73 determinization: games without hidden state pay nothing', () => {
  it('does not run a sampler that was never declared', async () => {
    const game = createVault(1, 0);
    const bot = makeBot(game, {});
    const move = await bot.play();
    expect(move).toEqual({ action: 'walkAway', args: {} });
  });
});

// ============================================================================
// #147 acceptance: hidden ELEMENTS are samplable too.
//
// A card game's hidden state is not a withheld attribute on a visible element,
// it is a whole element the seat cannot see. Until #147 those placeholders
// restored with their class-field defaults, which the consistency check read as
// information the seat holds -- so writing a rank into an opponent's card was
// refused and no card game could determinize at all.
//
// The fixture is the smallest hand-of-cards shape: four cards, two per seat, in
// owner-visible hands. Seat 1 must name a rank seat 2 holds.
// ============================================================================

class HandCard extends Piece<CardGame> {
  rank = 0;
}

class CardGame extends Game<CardGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HandCard, Space]);

    const ranks = [[1, 2], [3, 4]];
    for (const player of this.players) {
      const hand = this.create(Space<CardGame>, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (const rank of ranks[player.seat - 1]) {
        hand.create(HandCard, `card-${rank}`, { rank });
      }
    }

    this.registerAction(
      Action.create('claim')
        .chooseFrom('rank', {
          prompt: 'Name a rank the opponent holds',
          // Reads the OPPONENT's cards. Without a sample every one of them is
          // withheld, the read throws, and the enumerator drops the action.
          choices: (ctx) => (ctx.game as CardGame).opponentRanks(),
        })
        .execute((args, ctx) => {
          const game = ctx.game as CardGame;
          game.finish(game.opponentRanks().includes(args.rank as number)
            ? [game.getPlayer(1)!]
            : [game.getPlayer(2)!]);
          return { success: true };
        })
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['claim'], player: (ctx) => ctx.game.getPlayer(1)! }),
      isComplete: (ctx) => ctx.game.isFinished(),
    }));
  }

  hand(seat: number): Space<CardGame> {
    return this.first(Space<CardGame>, `hand-${seat}`)!;
  }

  opponentRanks(): number[] {
    return [...this.hand(2).all(HandCard)].map((card) => card.rank);
  }
}

function createCardGame(): CardGame {
  const game = new CardGame({ playerCount: 2, playerNames: ['Asker', 'Holder'], seed: 'cards' });
  game.startFlow();
  return game;
}

/** Seat 1's sandbox, exactly as the bot builds it. */
function sandboxForSeat1(): CardGame {
  const sandbox = new CardGame({ playerCount: 2, playerNames: ['Asker', 'Holder'], seed: 'cards' });
  sandbox.loadSerializedState(createCardGame().toJSONForPlayer(1) as ReturnType<Game['toJSON']>);
  return sandbox;
}

describe('#147/#73: a card game can determinize a hidden hand', () => {
  it('reports an opponent\'s hidden card as unknown rather than rank 0', () => {
    const card = sandboxForSeat1().hand(2).all(HandCard)[0];

    expect(card.isAttributeRedacted('rank')).toBe(true);
    expect(() => card.rank).toThrow(RedactedAttributeError);
  });

  it('accepts a sampler that supposes a rank for every hidden card', () => {
    const sandbox = sandboxForSeat1();
    const held = new Set([...sandbox.hand(1).all(HandCard)].map((card) => card.rank));

    applyDeterminization(sandbox, 1, (game, seat, rng) => {
      const pool = [1, 2, 3, 4].filter((rank) => !held.has(rank));
      for (const card of (game as CardGame).hand(2).all(HandCard)) {
        if (!card.isAttributeRedacted('rank')) continue;
        card.rank = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      }
    }, () => 0.5);

    expect(sandbox.opponentRanks().sort()).toEqual([3, 4]);
    // The seat's own hand is untouched, and still says so.
    expect([...sandbox.hand(1).all(HandCard)].map((c) => c.rank).sort()).toEqual([1, 2]);
  });

  it('still refuses a sampler that rewrites a card the seat CAN see', () => {
    const sandbox = sandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, (game) => {
      (game as CardGame).hand(1).all(HandCard)[0].rank = 99;
    }, () => 0.5)).toThrow(DeterminizationError);
  });

  it('searches a move the information set alone cannot resolve', async () => {
    const game = createCardGame();
    const sampler: DeterminizeSampler = (sandbox, _seat, rng) => {
      const held = new Set([...(sandbox as CardGame).hand(1).all(HandCard)]
        .filter((card) => !card.isAttributeRedacted('rank'))
        .map((card) => card.rank));
      const pool = [1, 2, 3, 4].filter((rank) => !held.has(rank));
      for (const card of (sandbox as CardGame).hand(2).all(HandCard)) {
        if (!card.isAttributeRedacted('rank')) continue;
        card.rank = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      }
    };

    const bot = new MCTSBot(
      game, CardGame, 'cards', 1, [],
      { iterations: 60, playoutDepth: 1, seed: 'cards', async: false, timeout: Infinity, usePNS: false },
      { determinize: sampler },
    );

    const move = await bot.play();
    expect(move!.action).toBe('claim');
    expect([3, 4]).toContain(move!.args.rank);
  });
});
