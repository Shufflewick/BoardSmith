import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
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
  static override visibleAttributes = ['notTrapped'];
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

    this.setFlow({
      root: actionStep({
        actions: ['open', 'walkAway'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
    });
  }

  /** Seat 2 keeps the vault; seat 1 is the one deciding. */
  get keeper(): Keeper {
    return this.getPlayer(2)!;
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

    this.setFlow({
      root: actionStep({ actions: ['claim'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }

  hand(seat: number): Space<CardGame> {
    return this.first(Space<CardGame>, `hand-${seat}`)!;
  }

  opponentRanks(): number[] {
    return [...this.hand(2).all(HandCard)].map((card) => card.rank);
  }
}

function createCardGame(): CardGame {
  const game = new CardGame({ playerCount: 2, playerNames: ['Asker', 'Holder'], seed: 'cards', elementIdKey: '00000000000000b4' });
  game.startFlow();
  return game;
}

/** Seat 1's sandbox, exactly as the bot builds it. */
function sandboxForSeat1(): CardGame {
  const sandbox = new CardGame({ playerCount: 2, playerNames: ['Asker', 'Holder'], seed: 'cards', elementIdKey: '00000000000000b4' });
  sandbox.loadSerializedState(createCardGame().toJSONForPlayer(1));
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
      game, CardGame, 'cards', 1,
      { iterations: 60, playoutDepth: 1, seed: 'cards', async: false, timeout: Infinity, usePNS: false },
      { determinize: sampler },
    );

    const move = await bot.play();
    expect(move!.action).toBe('claim');
    expect([3, 4]).toContain(move!.args.rank);
  });
});

// ============================================================================
// #871: the contract checks which container each known element sits in, not
// the order of a container's children. Seat 1 sees its own two cards; the other
// hands reach it as anonymous placeholders, whose identity means nothing but
// whose COUNT per hand, by back, the seat does know. Each hand holds one red-
// and one blue-backed card. A face-down card on the open table keeps its real
// id, so where it sits is known too.
// ============================================================================

class TrickGame extends Game<TrickGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HandCard, Space]);
    for (const player of this.players) {
      const hand = this.create(Space<TrickGame>, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (const [rank, back] of [[player.seat * 10 + 1, 'red'], [player.seat * 10 + 2, 'blue']] as const) {
        hand.create(HandCard, `card-${rank}`, { rank, $images: { face: `${rank}.svg`, back } });
      }
    }
    this.create(Space<TrickGame>, 'table').create(HandCard, 'face-down', { rank: 99 }).showOnlyTo(2);
    this.create(Space<TrickGame>, 'pond').contentsHidden();
    this.setFlow({ root: actionStep({ actions: [], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }

  hand(seat: number): Space<TrickGame> {
    return this.first(Space<TrickGame>, `hand-${seat}`)!;
  }

  get table(): Space<TrickGame> {
    return this.first(Space<TrickGame>, 'table')!;
  }

  get pond(): Space<TrickGame> {
    return this.first(Space<TrickGame>, 'pond')!;
  }
}

function trickSandboxForSeat1(): TrickGame {
  const options = { playerCount: 3, seed: 'tricks', elementIdKey: '0000000000000871' };
  const truth = new TrickGame(options);
  const sandbox = new TrickGame(options);
  sandbox.loadSerializedState(truth.toJSONForPlayer(1));
  return sandbox;
}

describe('#871 determinization: which container an element sits in is known', () => {
  it('refuses a sampler that moves a card the seat can see into another hand, naming both hands', () => {
    const sandbox = trickSandboxForSeat1();
    const card = sandbox.hand(1).first(HandCard)!;

    expect(() => applyDeterminization(sandbox, 1, (game) => {
      card.putInto((game as TrickGame).hand(2));
    }, () => 0.5)).toThrow(
      new RegExp(`moved HandCard#${card.id} "card-11" from Space#${sandbox.hand(1).id} "hand-1" to Space#${sandbox.hand(2).id} "hand-2"`),
    );
  });

  it('accepts a sampler that reorders the cards of a hand the seat can see', () => {
    const sandbox = trickSandboxForSeat1();
    const last = sandbox.hand(1).last(HandCard)!;

    applyDeterminization(sandbox, 1, (game) => {
      last.putInto((game as TrickGame).hand(1), { position: 'first' });
    }, () => 0.5);

    expect(sandbox.hand(1).first(HandCard)).toBe(last);
  });

  it('accepts a sampler that shuffles face-down placeholders within their hand', () => {
    const sandbox = trickSandboxForSeat1();
    const [a, b] = sandbox.hand(2).all(HandCard);

    applyDeterminization(sandbox, 1, () => {
      a.putInto(sandbox.hand(2), { position: 'last' });
    }, () => 0.5);

    expect(sandbox.hand(2).all(HandCard)).toEqual([b, a]);
  });

  it('accepts a sampler that swaps face-down placeholders between hidden hands', () => {
    const sandbox = trickSandboxForSeat1();
    const fromTwo = sandbox.hand(2).first(HandCard)!;
    const fromThree = sandbox.hand(3).first(HandCard)!;

    applyDeterminization(sandbox, 1, () => {
      fromTwo.putInto(sandbox.hand(3));
      fromThree.putInto(sandbox.hand(2));
    }, () => 0.5);

    expect(fromTwo.parent).toBe(sandbox.hand(3));
  });

  it('refuses a sampler that moves a placeholder so a hidden hand changes size', () => {
    const sandbox = trickSandboxForSeat1();
    const placeholder = sandbox.hand(2).first(HandCard)!;

    expect(() => applyDeterminization(sandbox, 1, () => {
      placeholder.putInto(sandbox.hand(3));
    }, () => 0.5)).toThrow(
      `Space#${sandbox.hand(2).id} "hand-2" held 1 face-down HandCard with $images: {back: "red"} placeholder and now holds 0.`,
    );
  });

  it('refuses a sampler that swaps placeholders with different backs between hidden hands', () => {
    const sandbox = trickSandboxForSeat1();
    const red = sandbox.hand(2).first(HandCard)!;
    const blue = sandbox.hand(3).last(HandCard)!;

    expect(() => applyDeterminization(sandbox, 1, () => {
      red.putInto(sandbox.hand(3));
      blue.putInto(sandbox.hand(2));
    }, () => 0.5)).toThrow('"hand-2" held 1 face-down HandCard with $images: {back: "red"} placeholder and now holds 0.');
  });

  it('shows a changed attribute\'s values as the game author wrote them', () => {
    const sandbox = trickSandboxForSeat1();
    const card = sandbox.hand(1).first(HandCard)!;

    expect(() => applyDeterminization(sandbox, 1, () => {
      card.$images = { face: '11.svg', back: 'green' };
    }, () => 0.5)).toThrow(
      `it changed HandCard#${card.id}.$images from {back: "red", face: "11.svg"} to {back: "green", face: "11.svg"}.`,
    );
  });

  it('refuses a change of type alone, quoting both values', () => {
    const sandbox = trickSandboxForSeat1();
    const card = sandbox.hand(1).first(HandCard)!;
    card.rank = 5;

    expect(() => applyDeterminization(sandbox, 1, () => {
      (card as unknown as { rank: unknown }).rank = '5';
    }, () => 0.5)).toThrow(`it changed HandCard#${card.id}.rank from 5 to "5".`);
  });

  it('refuses a change from null to undefined', () => {
    const sandbox = trickSandboxForSeat1();
    const card = sandbox.hand(1).first(HandCard)!;
    (card as unknown as { rank: unknown }).rank = null;

    expect(() => applyDeterminization(sandbox, 1, () => {
      (card as unknown as { rank: unknown }).rank = undefined;
    }, () => 0.5)).toThrow(`it changed HandCard#${card.id}.rank from null to undefined.`);
  });

  it('accepts an attribute holding an id-bearing object with no prototype', () => {
    const sandbox = trickSandboxForSeat1();
    (sandbox.hand(1).first(HandCard)! as unknown as { ref: unknown }).ref =
      Object.assign(Object.create(null) as object, { _t: { id: 7 } });

    applyDeterminization(sandbox, 1, () => {}, () => 0.5);
  });

  it('counts placeholders in the plural when a hand held more than one', () => {
    const sandbox = trickSandboxForSeat1();
    sandbox.hand(3).first(HandCard)!.putInto(sandbox.hand(2));
    const red = sandbox.hand(2).first(HandCard)!;

    expect(() => applyDeterminization(sandbox, 1, () => {
      red.putInto(sandbox.hand(3));
    }, () => 0.5)).toThrow('"hand-2" held 2 face-down HandCard with $images: {back: "red"} placeholders and now holds 1.');
  });

  it('refuses a sampler that moves a face-down card off the open table', () => {
    const sandbox = trickSandboxForSeat1();
    const faceDown = sandbox.table.first(HandCard)!;
    expect(faceDown.isAttributeRedacted('rank')).toBe(true);

    expect(() => applyDeterminization(sandbox, 1, () => {
      faceDown.putInto(sandbox.hand(2));
    }, () => 0.5)).toThrow(
      new RegExp(`moved HandCard#${faceDown.id} from Space#${sandbox.table.id} "table" to Space#${sandbox.hand(2).id} "hand-2"`),
    );
  });
});

// #1032: an element the sampler creates was never in the before-record, so its
// container is checked instead. A container whose contents the seat can see
// cannot gain a card; a hidden one (Go Fish's pond) can.
describe('#1032 determinization: a new element may appear only where the seat cannot see', () => {
  it('refuses a sampler that adds a card to the seat\'s own hand, naming the hand', () => {
    const sandbox = trickSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.hand(1).create(HandCard, 'extra', { rank: 5 });
    }, () => 0.5)).toThrow(
      new RegExp(`added HandCard#\\d+ "extra" to Space#${sandbox.hand(1).id} "hand-1"`),
    );
  });

  it('says a sampler may create elements where the seat cannot see, not only write redacted attributes', () => {
    const sandbox = trickSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.hand(1).create(HandCard, 'extra', { rank: 5 });
    }, () => 0.5)).toThrow(
      'A sampler may write only attributes this sandbox was never told (the ones ' +
      'element.isAttributeRedacted(key) reports true for) and create elements only where the seat cannot see them.',
    );
  });

  it('refuses a sampler that adds a face-down card to the open table', () => {
    const sandbox = trickSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.table.create(HandCard, 'extra', { rank: 5 }).showOnlyTo(2);
    }, () => 0.5)).toThrow(new RegExp(`added HandCard#\\d+ "extra" to Space#${sandbox.table.id} "table"\\. ` +
      `The seat can see what that container holds, so it knows that element was not there\\.`));
  });

  it('refuses a sampler that adds a face-up card to a hidden pond', () => {
    const sandbox = trickSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.pond.create(HandCard, 'extra', { rank: 5 }).showToAll();
    }, () => 0.5)).toThrow(new RegExp(`added HandCard#\\d+ "extra" to Space#${sandbox.pond.id} "pond"\\. ` +
      `The seat can see that element itself, so it knows that element was not there\\.`));
  });

  it('accepts a sampler that rebuilds a hidden pond', () => {
    const sandbox = trickSandboxForSeat1();

    applyDeterminization(sandbox, 1, () => {
      sandbox.pond.create(HandCard, 'supposed', { rank: 5 });
    }, () => 0.5);

    expect(sandbox.pond.count(HandCard)).toBe(1);
  });
});

// #1098: a hand whose cards the seat cannot see still shows how many it holds,
// so a sampler may not add a card to it, even one the seat cannot see.
describe('#1098 determinization: a container the seat can count keeps its count', () => {
  it('refuses a sampler that adds a hidden card to an opponent\'s hand, naming the hand and both counts', () => {
    const sandbox = trickSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.hand(2).create(HandCard, 'extra', { rank: 5 });
    }, () => 0.5)).toThrow(
      `Space#${sandbox.hand(2).id} "hand-2" held 2 elements and now holds 3. The seat can count what that ` +
      `container holds even where it cannot see them, so a sampler may not change how many it holds.`,
    );
  });
});

// #1108: the sandbox keeps what the seat's view says about elements it cannot
// see. Seat 1 is denied seat 2's hand (`hideContentsFrom`), so it is sent one
// face-down placeholder per card; a count-only box on the table is sent with
// how many it holds; a face-down card covers a token nobody is sent.
class PeekGame extends Game<PeekGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HandCard, Space]);
    const hand = this.create(Space<PeekGame>, 'hand-2');
    hand.hideContentsFrom(1);
    hand.create(HandCard, 'card-1', { rank: 1 });
    hand.create(HandCard, 'card-2', { rank: 2 });
    const table = this.create(Space<PeekGame>, 'table');
    const box = table.create(Space<PeekGame>, 'box');
    box.setVisibility('count-only');
    for (const rank of [3, 4, 5]) box.create(HandCard, `card-${rank}`, { rank });
    table.create(HandCard, 'covered', { rank: 6 }).hideFromAll();
    this.setFlow({ root: actionStep({ actions: [], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }

  get hand(): Space<PeekGame> {
    return this.first(Space<PeekGame>, 'hand-2')!;
  }

  // By position: a seat's placeholders carry no name.
  get box(): Space<PeekGame> {
    return this.first(Space<PeekGame>, 'table')!.first(Space<PeekGame>)!;
  }

  get covered(): HandCard {
    return this.first(Space<PeekGame>, 'table')!.first(HandCard, (card) => card.parent!.name === 'table')!;
  }
}

const peekOptions = { playerCount: 2, seed: 'peek', elementIdKey: '0000000000001108' };

function peekSandboxForSeat1(truth = new PeekGame(peekOptions)): PeekGame {
  const sandbox = new PeekGame(peekOptions);
  sandbox.loadSerializedState(truth.toJSONForPlayer(1));
  return sandbox;
}

describe('#1108 determinization: the sandbox keeps what the seat view says about hidden elements', () => {
  it('refuses a sampler that adds a card to a hand hidden from the seat, which it can still count', () => {
    const sandbox = peekSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      sandbox.hand.create(HandCard, 'extra', { rank: 7 });
    }, () => 0.5)).toThrow(
      `Space#${sandbox.hand.id} "hand-2" held 2 elements and now holds 3. The seat can count what that ` +
      `container holds even where it cannot see them, so a sampler may not change how many it holds.`,
    );
  });

  it('refuses a sampler that fills a count-only box with more cards than the seat counted', () => {
    const sandbox = peekSandboxForSeat1();

    expect(() => applyDeterminization(sandbox, 1, () => {
      for (const rank of [3, 4, 5, 6, 7]) sandbox.box.create(HandCard, `supposed-${rank}`, { rank });
    }, () => 0.5)).toThrow(
      `Space#${sandbox.box.id} held 3 elements and now holds 5. The seat can count what that ` +
      `container holds even where it cannot see them, so a sampler may not change how many it holds.`,
    );
  });

  it('accepts a sampler that fills a count-only box and a face-down card the seat cannot see into', () => {
    const sandbox = peekSandboxForSeat1();

    applyDeterminization(sandbox, 1, () => {
      for (const rank of [3, 4, 5]) sandbox.box.create(HandCard, `supposed-${rank}`, { rank });
      sandbox.covered.create(HandCard, 'under', { rank: 8 });
    }, () => 0.5);

    expect(sandbox.box.count(HandCard)).toBe(3);
  });

  it('builds the same sandbox from two truths the seat cannot tell apart', () => {
    const truth = (ranks: number[], under: number) => {
      const game = new PeekGame(peekOptions);
      for (const [i, card] of game.hand.all(HandCard).entries()) card.rank = ranks[i];
      for (const card of game.box.all(HandCard)) card.rank = ranks[0] + 10;
      for (let i = 0; i < under; i++) game.covered.create(HandCard, `under-${i}`, { rank: i });
      return game;
    };

    const one = peekSandboxForSeat1(truth([1, 2], 0));
    const other = peekSandboxForSeat1(truth([8, 9], 4));

    expect(other.toJSON()).toEqual(one.toJSON());
  });
});

// #1206: a seat granted a container below a hidden deck's hidden child is sent
// it inside the deck (#961). With a zone rule of its own that shows its
// contents (the pouch), every card in it reaches the seat, whole or face down,
// so the seat counts it. With none (the bag), its cards inherit the deck's
// hidden rule and only the granted ones are sent, so the seat cannot count it.
class CrateGame extends Game<CrateGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HandCard, Space]);
    const deck = this.create(Space<CrateGame>, 'deck');
    deck.contentsHidden();
    const crate = deck.create(Space<CrateGame>, 'crate');
    const pouch = crate.create(Space<CrateGame>, 'pouch');
    pouch.showOnlyTo(1);
    pouch.contentsVisible();
    pouch.create(HandCard, 'open', { rank: 1 });
    pouch.create(HandCard, 'face-down', { rank: 2 }).hideFromAll();
    const bag = crate.create(Space<CrateGame>, 'bag');
    bag.showOnlyTo(1);
    bag.create(HandCard, 'granted', { rank: 3 }).showOnlyTo(1);
    bag.create(HandCard, 'withheld', { rank: 4 });
    const chest = deck.create(Space<CrateGame>, 'chest');
    chest.showOnlyTo(1);
    const box = chest.create(Space<CrateGame>, 'box');
    box.setVisibility('count-only');
    for (const rank of [5, 6, 7, 8]) box.create(HandCard, `boxed-${rank}`, { rank });
    this.setFlow({ root: actionStep({ actions: [], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }

  granted(name: string): Space<CrateGame> {
    return this.first(Space<CrateGame>, 'deck')!.first(Space<CrateGame>, name)!;
  }

  // By position: a count-only box is sent with no name.
  get box(): Space<CrateGame> {
    return this.granted('chest').first(Space<CrateGame>)!;
  }
}

const crateOptions = { playerCount: 2, seed: 'crate', elementIdKey: '0000000000001206' };

function crateSandboxForSeat1(): CrateGame {
  const sandbox = new CrateGame(crateOptions);
  sandbox.loadSerializedState(new CrateGame(crateOptions).toJSONForPlayer(1));
  return sandbox;
}

describe('#1206 determinization: a granted container below a concealer keeps what the seat sees of it', () => {
  it('refuses a sampler that adds a face-down card to a granted pouch the seat can count', () => {
    const sandbox = crateSandboxForSeat1();
    const pouch = sandbox.granted('pouch');

    expect(() => applyDeterminization(sandbox, 1, () => {
      pouch.create(HandCard, 'extra', { rank: 5 }).hideFromAll();
    }, () => 0.5)).toThrow(
      `Space#${pouch.id} "pouch" held 2 elements and now holds 3. The seat can count what that ` +
      `container holds even where it cannot see them, so a sampler may not change how many it holds.`,
    );
  });

  it('accepts a sampler that adds a card the seat cannot see to a granted bag it is sent only part of', () => {
    const sandbox = crateSandboxForSeat1();
    const bag = sandbox.granted('bag');
    expect(bag.all(HandCard).map((card) => card.name)).toEqual(['granted']);

    applyDeterminization(sandbox, 1, () => {
      bag.create(HandCard, 'supposed', { rank: 4 });
    }, () => 0.5);

    expect(bag.count(HandCard)).toBe(2);
  });

  it('refuses a sampler that fills a count-only box sent in a granted chest with other than its count', () => {
    for (const fill of [1, 7]) {
      const sandbox = crateSandboxForSeat1();
      const box = sandbox.box;

      expect(() => applyDeterminization(sandbox, 1, () => {
        for (let i = 0; i < fill; i++) box.create(HandCard, `supposed-${i}`, { rank: i });
      }, () => 0.5)).toThrow(
        `Space#${box.id} held 4 elements and now holds ${fill}. The seat can count what that ` +
        `container holds even where it cannot see them, so a sampler may not change how many it holds.`,
      );
    }
  });

  it('accepts a sampler that fills a count-only box sent in a granted chest to its count', () => {
    const sandbox = crateSandboxForSeat1();
    const box = sandbox.box;

    applyDeterminization(sandbox, 1, () => {
      for (let i = 0; i < 4; i++) box.create(HandCard, `supposed-${i}`, { rank: i });
    }, () => 0.5);

    expect(box.count(HandCard)).toBe(4);
  });
});
