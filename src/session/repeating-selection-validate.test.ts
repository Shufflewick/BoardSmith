/**
 * A repeating selection's own `validate` runs once per PICK, on every path that
 * submits a move (#352).
 *
 * `processRepeatingStep` owns the repeat protocol (#325), so it is the one
 * place `validate` is called: after the pick is checked against the offered
 * choices and before `onSelect`/`onEach` run for it. It receives the pick (an
 * element for `chooseElement`), and `args` holding the picks made before it. A
 * rule about the finished array belongs in the action-level `.validate()`,
 * which sees the whole submission.
 *
 * Every path is driven through the real engine: the host's `selectionStep` and
 * `action` ops, a bot's move, and `enumerateLegalMoves`.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { executeOp, type OpResult } from './stateless-ops.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import type { GameDefinitionLike } from './stateless-ops.js';
import { GameRunner } from '../runtime/runner.js';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  enumerateLegalMoves,
  type GameOptions,
  type GameStateSnapshot,
} from '../engine/index.js';

class Rune extends Piece<RuneGame> {}
class Bag extends Space<RuneGame> {}
class Hand extends Space<RuneGame> {}

const FIRE_AFTER_ICE = 'Fire cannot follow ice.';

/**
 * Pick runes one at a time, each moved into the hand by `onEach`, then 'stop'.
 * The selection's `validate` refuses 'fire' once 'ice' has been picked, a rule
 * that depends on the picks so far, so it cannot be a static `choices` filter.
 */
class RuneGame extends Game<RuneGame, Player> {
  bag!: Bag;
  hand!: Hand;
  eachCalls: string[] = [];
  /** Every (pick, picks-before-it) pair `validate` was called with. */
  validateCalls: Array<{ pick: string; before: string[] }> = [];
  cast: string[] | null = null;

  constructor(options: GameOptions) {
    super(options);
    this.bag = this.create(Bag, 'bag');
    this.hand = this.create(Hand, 'hand');
    for (const name of ['ice', 'fire']) this.bag.create(Rune, name);

    this.registerAction(
      Action.create('cast')
        .chooseFrom('rune', {
          choices: (ctx) => [...(ctx.game as RuneGame).bag.all(Rune).map((r) => r.name!), 'stop'],
          validate: (pick, args, ctx) => {
            const before = [...(args.rune as string[])];
            (ctx.game as RuneGame).validateCalls.push({ pick, before });
            return (ctx.game as RuneGame).runeRefusal(pick, before) ?? true;
          },
          repeat: {
            until: (_ctx, last) => last === 'stop',
            onEach: (ctx, pick) => {
              const game = ctx.game as RuneGame;
              game.eachCalls.push(pick);
              game.bag.all(Rune).find((r) => r.name === pick)?.putInto(game.hand);
            },
          },
        })
        .execute((args, ctx) => {
          (ctx.game as RuneGame).cast = args.rune;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({ actions: ['cast'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    );
  }

  /** The rule `validate` enforces: why `pick` may not follow `before`, or null. */
  runeRefusal(pick: string, before: string[]): string | null {
    return pick === 'fire' && before.includes('ice') ? FIRE_AFTER_ICE : null;
  }
}

/**
 * The same game with a stricter rule that leaves exactly one legal move,
 * 'fire', 'ice', 'stop', so a bot that ignored `validate` would be caught
 * playing anything else.
 */
class StrictRuneGame extends RuneGame {
  override runeRefusal(pick: string, before: string[]): string | null {
    if (pick === 'stop' && before.length < 2) return 'Cast both runes first.';
    return super.runeRefusal(pick, before);
  }
}

const runeDef: GameDefinitionLike = { gameClass: RuneGame, gameType: 'runes', minPlayers: 1, maxPlayers: 1 };
const options = { playerCount: 1, seed: 'bs352' };

function makeHost(def: GameDefinitionLike = runeDef, seed = options.seed) {
  return new SnapshotSessionHost({
    playerCount: 1,
    botSeats: [],
    executeOp: (snap, pend, op) => executeOp(def, { ...options, seed }, snap, pend, op),
    broadcast: () => {},
  });
}

function game(host: SnapshotSessionHost): RuneGame {
  return GameRunner.fromSnapshot(host.snapshot as GameStateSnapshot, RuneGame).game;
}

function step(host: SnapshotSessionHost, value: string): Promise<OpResult> {
  return host.handleOp(1, {
    type: 'selectionStep',
    player: 1,
    selectionName: 'rune',
    value,
    actionName: 'cast',
    boundaryKey: boundaryKeyOfHost(host),
  });
}

function submitWhole(host: SnapshotSessionHost, rune: unknown): Promise<OpResult> {
  return host.handleOp(1, {
    type: 'action',
    player: 1,
    actionName: 'cast',
    args: { rune },
    boundaryKey: boundaryKeyOfHost(host),
  });
}

describe("a repeating selection's validate runs per pick, on every path (#352)", () => {
  it('step by step: a pick validate forbids is refused with its message, and onEach never runs for it', async () => {
    const host = makeHost();
    await host.start();
    expect((await step(host, 'ice')).success).toBe(true);

    const refused = await step(host, 'fire');
    expect(refused.success).toBe(false);
    expect(refused.error).toContain(FIRE_AFTER_ICE);
    expect(game(host).eachCalls).toEqual(['ice']);

    // The refused pick left the repeat open: the player can still end it.
    expect((await step(host, 'stop')).success).toBe(true);
    expect(game(host).cast).toEqual(['ice', 'stop']);
  });

  it('validate receives the pick and the picks made before it', async () => {
    const host = makeHost();
    await host.start();
    for (const value of ['fire', 'ice', 'stop']) {
      expect((await step(host, value)).success).toBe(true);
    }
    expect(game(host).validateCalls).toEqual([
      { pick: 'fire', before: [] },
      { pick: 'ice', before: ['fire'] },
      { pick: 'stop', before: ['fire', 'ice'] },
    ]);
  });

  it('a whole action op containing a forbidden pick is refused by name and rolled back', async () => {
    const host = makeHost();
    await host.start();
    const result = await submitWhole(host, ['ice', 'fire', 'stop']);
    expect(result.success).toBe(false);
    expect(result.error).toBe(`Pick 2 of "rune": ${FIRE_AFTER_ICE}`);
    const after = game(host);
    expect(after.eachCalls).toEqual([]);
    expect(after.cast).toBeNull();
    expect(after.bag.all(Rune).map((r) => r.name)).toEqual(['ice', 'fire']);
  });

  it('the same picks in an order validate allows are accepted', async () => {
    const host = makeHost();
    await host.start();
    const result = await submitWhole(host, ['fire', 'ice', 'stop']);
    expect(result.error).toBeUndefined();
    expect(game(host).cast).toEqual(['fire', 'ice', 'stop']);
  });

  it('enumerateLegalMoves never offers a sequence validate forbids', () => {
    const runner = new GameRunner({ GameClass: RuneGame, gameType: 'runes', gameOptions: options });
    runner.start();
    const sequences = enumerateLegalMoves(runner.game, 1).map((m) => (m.args.rune as string[]).join(','));
    expect(sequences.sort()).toEqual(['fire,ice,stop', 'fire,stop', 'ice,stop', 'stop']);
  });

  it('a bot plays only the sequence validate allows', async () => {
    const strictDef: GameDefinitionLike = { ...runeDef, gameClass: StrictRuneGame };
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const host = makeHost(strictDef, seed);
      await host.start();
      const turn = await host.handleOp(1, { type: 'botTurn', seats: [{ seat: 1, level: 'easy' }] });
      expect({ error: turn.error, botMoved: turn.botMoved }).toEqual({ error: undefined, botMoved: true });
      const played = GameRunner.fromSnapshot(host.snapshot as GameStateSnapshot, StrictRuneGame).game;
      expect(played.cast).toEqual(['fire', 'ice', 'stop']);
    }
  });
});

class Gem extends Piece<GemGame> {}
class Heap extends Space<GemGame> {}

/** A repeating ELEMENT selection: validate receives the picked element. */
class GemGame extends Game<GemGame, Player> {
  heap!: Heap;
  seen: Array<{ pick: string; before: string[] }> = [];

  constructor(opts: GameOptions) {
    super(opts);
    this.heap = this.create(Heap, 'heap');
    for (const name of ['ruby', 'jade', 'onyx']) this.heap.create(Gem, name);
    this.registerAction(
      Action.create('take')
        .chooseElement('gems', {
          elementClass: Gem,
          validate: (gem, args, ctx) => {
            const before = (args.gems as Gem[]).map((g) => g.name!);
            (ctx.game as GemGame).seen.push({ pick: gem.name!, before });
            return gem.name !== 'onyx' || 'Onyx is cursed.';
          },
          repeat: { until: (ctx) => (ctx.args.gems as unknown[]).length >= 2 },
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow(defineFlow({ root: actionStep({ actions: ['take'], player: (ctx) => ctx.game.getPlayer(1)! }) }));
  }
}

describe("a repeating chooseElement's validate (#352)", () => {
  it('receives the picked element, with the elements picked before it in args', () => {
    const runner = new GameRunner({ GameClass: GemGame, gameType: 'gems', gameOptions: options });
    runner.start();
    const id = (name: string) => runner.game.heap.first(Gem, name)!.id;
    runner.startPendingAction('take', 1);
    expect(runner.processSelectionStep(1, 'gems', id('ruby')).success).toBe(true);
    expect(runner.processSelectionStep(1, 'gems', id('onyx')).error).toContain('Onyx is cursed.');
    expect(runner.game.seen).toEqual([
      { pick: 'ruby', before: [] },
      { pick: 'onyx', before: ['ruby'] },
    ]);
  });

  it('refuses a whole submission and is honoured by enumeration', () => {
    const runner = new GameRunner({ GameClass: GemGame, gameType: 'gems', gameOptions: options });
    runner.start();
    const id = (name: string) => runner.game.heap.first(Gem, name)!.id;
    const refused = runner.performAction('take', 1, { gems: [id('ruby'), id('onyx')] });
    expect(refused.error).toBe('Pick 2 of "gems": Onyx is cursed.');
    const moves = enumerateLegalMoves(runner.game, 1).map((m) => (m.args.gems as Gem[]).map((g) => g.name).join(','));
    // Nothing moves a picked gem, so a gem may be picked twice; onyx never is.
    expect(moves.sort()).toEqual(['jade,jade', 'jade,ruby', 'ruby,jade', 'ruby,ruby']);
  });
});

describe("a repeating selection's validate is typed per pick (#352)", () => {
  it('chooseFrom: validate receives one pick, while execute receives the array', () => {
    Action.create('viaRepeat')
      .chooseFrom('token', {
        choices: ['p1', 'p2', 'stop'],
        repeatUntil: 'stop',
        validate: (pick) => {
          expectTypeOf(pick).toEqualTypeOf<string>();
          return true;
        },
      })
      .execute((args) => {
        expectTypeOf(args.token).toEqualTypeOf<string[]>();
      });
  });

  it('chooseElement: validate receives one element', () => {
    Action.create('viaRepeat')
      .chooseElement('gems', {
        elementClass: Gem,
        repeat: { until: () => true },
        validate: (gem) => {
          expectTypeOf(gem).toEqualTypeOf<Gem>();
          return true;
        },
      })
      .execute((args) => {
        expectTypeOf(args.gems).toEqualTypeOf<Gem[]>();
      });
  });
});
