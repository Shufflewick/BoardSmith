/**
 * A step holds a seat while it has a pending follow-up (#494).
 *
 * The rule, in both kinds of step:
 *
 * - a follow-up belongs to the seat whose action returned it, and each seat
 *   has its own: another seat's action never replaces it;
 * - a step never ends a seat's part (turn-based) or marks it done
 *   (simultaneous) while that seat holds a follow-up;
 * - there is no explicit decline: the seat drops its follow-up only by taking
 *   another action the step offers it.
 *
 * Each case is driven through the session-free GameRunner, a GameSession and
 * the stateless op executor, so every host reads the same per-seat state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  enumerateLegalMoves,
  type FlowNode,
  type FlowState,
  type GameOptions,
} from '../engine/index.js';
import { _clearShownWarnings } from '../utils/dev.js';
import { GameRunner } from '../runtime/runner.js';
import { MCTSBot } from '../bot/mcts-bot.js';
import { GameSession } from './game-session.js';
import { executeOp, type GameDefinitionLike, type OpResult } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

type Shape = 'turn' | 'simultaneous';

/**
 * `scout` (once per seat) returns a follow-up into `loot`, which the step does
 * not list. `rest` is listed only by the decline variants: taking it is how a
 * seat drops its follow-up.
 */
class RaidGame extends Game<RaidGame, Player> {
  scouted: number[] = [];
  looted: number[] = [];
  rested: number[] = [];
  /** Where `loot` may look; empty makes the follow-up impossible. */
  sites = ['north', 'south'];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<RaidGame>('scout')
        .prompt('Scout')
        .condition({ 'has not scouted': (ctx) => !(ctx.game as RaidGame).scouted.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as RaidGame).scouted.push(ctx.player.seat);
          return { success: true, followUp: { action: 'loot', args: { by: ctx.player.seat } } };
        }),
      // Two selections, so a player collects it as a pending action. Its
      // condition is false for everyone: a follow-up bypasses it.
      Action.create<RaidGame>('loot')
        .prompt('Loot')
        .condition({ 'only as a follow-up': () => false })
        .chooseFrom('where', { choices: (ctx) => (ctx.game as RaidGame).sites })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute((args, ctx) => {
          const by = (args as Record<string, unknown>).by;
          if (by !== ctx.player.seat) throw new Error(`loot carried by ${String(by)}`);
          (ctx.game as RaidGame).looted.push(ctx.player.seat);
        }),
      Action.create<RaidGame>('rest')
        .prompt('Rest')
        .condition({ 'has not rested': (ctx) => !(ctx.game as RaidGame).rested.includes(ctx.player.seat) })
        .execute((_a, ctx) => {
          (ctx.game as RaidGame).rested.push(ctx.player.seat);
        }),
    );
  }
}

/** The raid goes on until every seat has scouted or rested. */
function raiding(ctx: { game: unknown }): boolean {
  const game = ctx.game as RaidGame;
  return game.players.some((p) => !game.scouted.includes(p.seat) && !game.rested.includes(p.seat));
}

function flowFor(shape: Shape, actions: string[]): FlowNode<RaidGame> {
  return shape === 'turn'
    ? loop({ maxIterations: 3, while: raiding, do: eachPlayer({ do: actionStep({ actions, turnScope: 'restart' }) }) })
    : loop({ maxIterations: 3, while: raiding, do: simultaneousActionStep({ actions }) });
}

const classes = new Map<string, typeof RaidGame>();
function raidClass(shape: Shape, decline: boolean): typeof RaidGame {
  const key = `${shape}:${decline}`;
  let cls = classes.get(key);
  if (!cls) {
    const actions = decline ? ['scout', 'rest'] : ['scout'];
    cls = class extends RaidGame {
      constructor(options: GameOptions) {
        super(options);
        this.setFlow(defineFlow({ root: flowFor(shape, actions) }));
      }
    };
    classes.set(key, cls);
  }
  return cls;
}

const gameOptions = { playerCount: 3, seed: 'follow-up-hold' };
const NOT_YOURS = "'loot' is not one of your actions right now.";

function runner(shape: Shape, decline = false): GameRunner<RaidGame> {
  const r = new GameRunner({ GameClass: raidClass(shape, decline), gameType: 'raid', gameOptions });
  r.start();
  return r;
}

/** Take seat's own loot through the pending (pick by pick) path. */
function lootByPicks(r: GameRunner<RaidGame>, seat: number) {
  r.startPendingAction('loot', seat);
  const first = r.processSelectionStep(seat, 'where', 'north');
  if (!first.success) return first;
  return r.processSelectionStep(seat, 'what', 'gold');
}

describe('GameRunner', () => {
  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', () => {
    const r = runner('simultaneous');
    expect(r.performAction('scout', 1, {}).success).toBe(true);
    expect(r.performAction('scout', 2, {}).success).toBe(true);

    expect(r.getFlowState()?.followUps).toEqual([
      { action: 'loot', args: { by: 1 }, seat: 1 },
      { action: 'loot', args: { by: 2 }, seat: 2 },
    ]);
    // Both are held: nothing else is listed for them, yet neither is done.
    const awaiting = r.getFlowState()!.awaitingPlayers!;
    expect(awaiting.find((p) => p.playerIndex === 1)).toMatchObject({ completed: false, availableActions: [] });
    expect(awaiting.find((p) => p.playerIndex === 2)).toMatchObject({ completed: false, availableActions: [] });

    // Neither may take the other's (seat 3 holds none at all).
    r.startPendingAction('loot', 3);
    expect(r.processSelectionStep(3, 'where', 'north')).toMatchObject({ success: false, error: NOT_YOURS });

    expect(lootByPicks(r, 2)).toMatchObject({ success: true, actionComplete: true });
    expect(lootByPicks(r, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.looted).toEqual([2, 1]);
    expect(r.getFlowState()?.followUps).toBeUndefined();
    const after = r.getFlowState()!.awaitingPlayers!;
    expect(after.find((p) => p.playerIndex === 1)?.completed).toBe(true);
    expect(after.find((p) => p.playerIndex === 2)?.completed).toBe(true);
  });

  it('simultaneous: the step does not end while the last seat holds a follow-up', () => {
    const r = runner('simultaneous');
    r.performAction('scout', 1, {});
    lootByPicks(r, 1);
    r.performAction('scout', 2, {});
    lootByPicks(r, 2);
    r.performAction('scout', 3, {});

    const state = r.getFlowState()!;
    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers?.find((p) => p.playerIndex === 3)?.completed).toBe(false);
    expect(lootByPicks(r, 3)).toMatchObject({ success: true });
    expect(r.game.looted).toEqual([1, 2, 3]);
  });

  it('turn-based: the turn stays with the seat until it takes its follow-up', () => {
    const r = runner('turn');
    expect(r.performAction('scout', 1, {}).success).toBe(true);

    const held = r.getFlowState()!;
    expect(held.currentPlayer).toBe(1);
    expect(held.availableActions).toEqual([]);
    expect(held.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
    expect(r.refusalToAct('loot', 2)).toMatchObject({ errorCode: 'NOT_YOUR_TURN' });

    expect(lootByPicks(r, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(r.getFlowState()?.currentPlayer).toBe(2);
    expect(r.getFlowState()?.followUps).toBeUndefined();
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: taking another action the step offers drops the follow-up`, () => {
      const r = runner(shape, true);
      r.performAction('scout', 1, {});
      expect(r.refusalToAct('loot', 1)).toBeUndefined();

      expect(r.performAction('rest', 1, {}).success).toBe(true);

      expect(r.getFlowState()?.followUps).toBeUndefined();
      expect(r.refusalToAct('loot', 1)).toBeDefined();
      expect(r.game.looted).toEqual([]);
    });

    it(`${shape}: a refused action leaves the follow-up held`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      expect(r.performAction('scout', 1, {}).success).toBe(false);

      expect(r.getFlowState()?.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
    });

    it(`${shape}: the owner may take its follow-up as one whole action, with its own args`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      expect(r.performAction('loot', 2, { where: 'north', what: 'gold' }).success).toBe(false);
      expect(r.performAction('loot', 1, { where: 'north', what: 'gold' }).success).toBe(true);
      expect(r.game.looted).toEqual([1]);
      expect(r.actionHistory.map((a) => `${a.name}:${a.player}`)).toEqual(['scout:1', 'loot:1']);
    });

    it(`${shape}: legal moves for the owner are its follow-up, with its args bound`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const moves = enumerateLegalMoves(r.game, 1);
      expect(moves).toHaveLength(4);
      for (const move of moves) {
        expect(move.action).toBe('loot');
        expect(move.args.by).toBe(1);
      }
      expect(enumerateLegalMoves(r.game, 2).some((m) => m.action === 'loot')).toBe(false);
    });

    it(`${shape}: the hold survives a snapshot restore`, () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const restored = GameRunner.fromSnapshot(JSON.parse(JSON.stringify(r.getSnapshot())), raidClass(shape, false));

      expect(restored.getFlowState()?.followUps).toEqual([{ action: 'loot', args: { by: 1 }, seat: 1 }]);
      expect(lootByPicks(restored, 1)).toMatchObject({ success: true, actionComplete: true });
    });
  }
});

describe('a bot holding a follow-up', () => {
  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: plays it, so the step does not stall on a bot seat`, async () => {
      const r = runner(shape);
      r.performAction('scout', 1, {});

      const bot = new MCTSBot(
        r.game,
        raidClass(shape, false),
        'raid',
        1,
        r.actionHistory,
        { iterations: 8, playoutDepth: 2, seed: 'hold', async: false, usePNS: false },
        { objectives: () => ({ loot: { weight: 1, checker: (game) => (game as RaidGame).looted.length } }) },
      );
      const move = await bot.play();

      expect(move?.action).toBe('loot');
      expect(r.performAction(move!.action, 1, move!.args).success).toBe(true);
      expect(r.game.looted).toEqual([1]);
    });
  }
});

describe('a held follow-up with no valid choices warns in development', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _clearShownWarnings();
  });

  for (const shape of ['turn', 'simultaneous'] as const) {
    it(`${shape}: names the step, the seat and the follow-up`, () => {
      _clearShownWarnings();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const r = runner(shape);
      r.game.sites = [];

      r.performAction('scout', 1, {});

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => /seat 1/.test(m) && /'loot'/.test(m) && /no valid choice/.test(m))).toBe(true);
    });
  }
});

describe('GameSession', () => {
  function session(shape: Shape): GameSession<RaidGame> {
    return GameSession.create({
      gameType: 'raid',
      GameClass: raidClass(shape, false),
      playerCount: 3,
      playerNames: ['A', 'B', 'C'],
      seed: 'follow-up-hold',
    });
  }

  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', async () => {
    const s = session('simultaneous');
    const one = await s.performAction('scout', 1, {});
    const two = await s.performAction('scout', 2, {});
    expect(one.followUp).toMatchObject({ action: 'loot', args: { by: 1 } });
    expect(two.followUp).toMatchObject({ action: 'loot', args: { by: 2 } });

    // Seat 1 is refused as seat 2, then takes its own.
    expect(await s.processSelectionStep(3, 'where', 'north', 'loot', { by: 2 })).toMatchObject({
      success: false,
      error: NOT_YOURS,
    });
    expect((await s.processSelectionStep(1, 'where', 'north', 'loot', { by: 1 })).success).toBe(true);
    expect(await s.processSelectionStep(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect((await s.processSelectionStep(2, 'where', 'south', 'loot', { by: 2 })).success).toBe(true);
    expect(await s.processSelectionStep(2, 'what', 'gems')).toMatchObject({ success: true, actionComplete: true });
    expect(s.runner.game.looted).toEqual([1, 2]);
  });

  // Simultaneous only: a turn-based step does not count a chain's actions
  // toward its undo boundary yet (#495).
  for (const shape of ['simultaneous'] as const) {
    it(`${shape}: undo to the turn start takes the follow-up back with the action that returned it`, async () => {
      const s = session(shape);
      await s.performAction('scout', 1, {});
      expect(s.runner.getFlowState()?.followUps).toHaveLength(1);

      const undone = await s.undoToTurnStart(1);

      expect(undone.success).toBe(true);
      expect(s.runner.getFlowState()?.followUps).toBeUndefined();
      expect(s.runner.game.scouted).toEqual([]);
    });
  }

  it('turn-based: the turn stays with the seat until it takes its follow-up', async () => {
    const s = session('turn');
    await s.performAction('scout', 1, {});
    expect(s.runner.getFlowState()?.currentPlayer).toBe(1);

    expect((await s.processSelectionStep(1, 'where', 'north', 'loot', { by: 1 })).success).toBe(true);
    expect(await s.processSelectionStep(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect(s.runner.getFlowState()?.currentPlayer).toBe(2);
  });
});

describe('stateless ops', () => {
  async function play(shape: Shape) {
    const def: GameDefinitionLike = { gameClass: raidClass(shape, false), gameType: 'raid', minPlayers: 2, maxPlayers: 3 };
    let last: OpResult = await executeOp(def, gameOptions, null, {}, { type: 'start' });
    const action = async (seat: number, actionName: string) => {
      last = await executeOp(def, gameOptions, last.snapshot, null, {
        type: 'action', actionName, player: seat, args: {}, boundaryKey: boundaryKeyOf(last.snapshot),
      });
      return last;
    };
    const loot = async (seat: number, by: number) => {
      const first = await executeOp(def, gameOptions, last.snapshot, null, {
        type: 'selectionStep', player: seat, selectionName: 'where', value: 'north', actionName: 'loot',
        initialArgs: { by }, boundaryKey: boundaryKeyOf(last.snapshot),
      });
      if (!first.success) return first;
      last = await executeOp(def, gameOptions, first.snapshot, first.pendingState, {
        type: 'selectionStep', player: seat, selectionName: 'what', value: 'gold', actionName: 'loot',
        initialArgs: { by, where: 'north' }, boundaryKey: boundaryKeyOf(first.snapshot),
      });
      return last;
    };
    return { action, loot, get last() { return last; } };
  }

  it('simultaneous: two seats each hold their own follow-up; each takes its own, neither the other', async () => {
    const g = await play('simultaneous');
    expect((await g.action(1, 'scout')).followUp).toMatchObject({ action: 'loot', args: { by: 1 } });
    expect((await g.action(2, 'scout')).followUp).toMatchObject({ action: 'loot', args: { by: 2 } });

    expect(await g.loot(3, 1)).toMatchObject({ success: false, error: NOT_YOURS });
    expect(await g.loot(1, 1)).toMatchObject({ success: true, actionComplete: true });
    expect(await g.loot(2, 2)).toMatchObject({ success: true, actionComplete: true });
  });

  it('turn-based: the turn stays with the seat until it takes its follow-up', async () => {
    const g = await play('turn');
    await g.action(1, 'scout');
    expect((g.last.flowState as FlowState).currentPlayer).toBe(1);

    expect(await g.loot(1, 1)).toMatchObject({ success: true, actionComplete: true });
    expect((g.last.flowState as FlowState).currentPlayer).toBe(2);
  });
});
