/**
 * A multi-step action whose condition another seat has taken away is refused
 * (#493).
 *
 * Hosts hide an action whose `condition` fails, and a whole submission is
 * refused when it fails, but the pick-by-pick path used to check the condition
 * nowhere. In a simultaneous step seat 1 could start a two-pick action, seat 2
 * could then take its condition away, and seat 1 could still complete it.
 *
 * The rule (GameRunner.refusalToPick): before each step of a pending action the
 * condition is evaluated against the game as it stands. At the first step it
 * must hold. At a later step the action is refused only when the condition
 * held right after the seat's own previous pick and does not hold now: only
 * then is it certain that something other than the action's own picks took it
 * away. An action whose own picks (a repeat's `onEach`) end its condition
 * still completes, and a held follow-up is never gated by its condition.
 *
 * Each case is driven through all three pending-action paths: the session-free
 * GameRunner, a GameSession, and the stateless `selectionStep` op.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { GameSession } from './game-session.js';
import { executeOp, type GameDefinitionLike, type OpResult } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { historyLabels } from './testing/history-labels.js';

class QuarryGame extends Game<QuarryGame, Player> {
  /** Whether the one shared stone is still in the quarry. */
  stoneInQuarry = true;
  /** Each seat's energy, by seat (index 0 unused). */
  energy = [0, 1, 1, 1];
  /** Every action body that actually ran, as `name:seat`. */
  ran: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      // Two picks, so it is collected as a pending action.
      Action.create<QuarryGame>('build')
        .prompt('Build with the stone')
        .condition({ 'the stone is still in the quarry': (ctx) => ctx.game.stoneInQuarry })
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['wall', 'tower'] })
        .execute((_a, ctx) => {
          ctx.game.ran.push(`build:${ctx.player.seat}`);
        }),
      Action.create<QuarryGame>('take').prompt('Take the stone').execute((_a, ctx) => {
        ctx.game.stoneInQuarry = false;
        ctx.game.ran.push(`take:${ctx.player.seat}`);
      }),
      Action.create<QuarryGame>('rest').prompt('Rest').execute((_a, ctx) => {
        ctx.game.ran.push(`rest:${ctx.player.seat}`);
      }),
      // Each pick spends the seat's own energy, so its own first pick ends its
      // condition. It must still complete.
      Action.create<QuarryGame>('dig')
        .prompt('Dig')
        .condition({ 'you have energy left': (ctx) => ctx.game.energy[ctx.player.seat] > 0 })
        .chooseFrom('spot', {
          choices: ['east', 'west', 'stop'],
          repeat: {
            until: (_ctx, last) => last === 'stop',
            onEach: (ctx) => {
              (ctx.game as QuarryGame).energy[ctx.player.seat] -= 1;
            },
          },
        })
        .execute((_a, ctx) => {
          ctx.game.ran.push(`dig:${ctx.player.seat}`);
        }),
      Action.create<QuarryGame>('scout').prompt('Scout').execute(() => ({
        success: true,
        followUp: { action: 'loot' },
      })),
      // Never offered by the step and its condition never holds: only a
      // follow-up reaches it, and a follow-up is offered by the chain.
      Action.create<QuarryGame>('loot')
        .prompt('Loot')
        .condition({ 'only through scouting': () => false })
        .chooseFrom('where', { choices: ['north', 'south'] })
        .chooseFrom('what', { choices: ['gold', 'gems'] })
        .execute((_a, ctx) => {
          ctx.game.ran.push(`loot:${ctx.player.seat}`);
        }),
    );
    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 10,
        do: simultaneousActionStep({ actions: ['build', 'take', 'rest', 'dig', 'scout'] }),
      }),
    }));
  }
}

const gameOptions = { playerCount: 3, seed: 'pending-condition' };
const gameDef: GameDefinitionLike = { gameClass: QuarryGame, gameType: 'quarry', minPlayers: 2, maxPlayers: 3 };

const STONE_GONE =
  "'build' is no longer available to you: the game changed since your last choice, " +
  "and 'the stone is still in the quarry' no longer holds.";
const STONE_GONE_AT_START =
  "'build' is not available to you right now: 'the stone is still in the quarry' does not hold.";

function runner(): GameRunner<QuarryGame> {
  const r = new GameRunner({ GameClass: QuarryGame, gameType: 'quarry', gameOptions });
  r.start();
  return r;
}

function session(): GameSession<QuarryGame> {
  return GameSession.create({
    gameType: 'quarry',
    GameClass: QuarryGame,
    playerCount: 3,
    playerNames: ['A', 'B', 'C'],
    seed: 'pending-condition',
  });
}

describe('GameRunner', () => {
  it("refuses to complete a pending action once another seat's move took its condition away", () => {
    const r = runner();
    r.startPendingAction('build', 1);
    expect(r.processSelectionStep(1, 'where', 'north').success).toBe(true);

    expect(r.performAction('take', 2, {}).success).toBe(true);
    const historyBefore = historyLabels(r.actionHistory);

    const step = r.processSelectionStep(1, 'what', 'wall');

    expect(step).toEqual({ success: false, error: STONE_GONE });
    expect(r.game.ran).toEqual(['take:2']);
    expect(historyLabels(r.actionHistory)).toEqual(historyBefore);
  });

  it('refuses the first pick of an action whose condition does not hold', () => {
    const r = runner();
    expect(r.performAction('take', 2, {}).success).toBe(true);
    r.startPendingAction('build', 1);

    expect(r.processSelectionStep(1, 'where', 'north')).toEqual({ success: false, error: STONE_GONE_AT_START });
    expect(r.game.ran).toEqual(['take:2']);
  });

  it("completes an action whose own picks end its condition, with another seat's move in between", () => {
    const r = runner();
    r.startPendingAction('dig', 1);
    expect(r.processSelectionStep(1, 'spot', 'east').success).toBe(true);
    expect(r.game.energy[1]).toBe(0);

    expect(r.performAction('rest', 2, {}).success).toBe(true);
    const step = r.processSelectionStep(1, 'spot', 'stop');

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(r.game.ran).toEqual(['rest:2', 'dig:1']);
    expect(historyLabels(r.actionHistory)).toEqual(['rest:2', 'dig:1']);
  });

  it("refuses an action whose picks change the game once another seat's move took its condition away", () => {
    const r = runner();
    r.game.energy[1] = 3;
    r.startPendingAction('dig', 1);
    expect(r.processSelectionStep(1, 'spot', 'east').success).toBe(true);
    expect(r.game.energy[1]).toBe(2);

    // Another seat's move drains seat 1's energy: not the action's own doing.
    r.game.energy[1] = 0;
    expect(r.performAction('rest', 2, {}).success).toBe(true);

    expect(r.processSelectionStep(1, 'spot', 'stop')).toEqual({
      success: false,
      error:
        "'dig' is no longer available to you: the game changed since your last choice, " +
        "and 'you have energy left' no longer holds.",
    });
    expect(r.game.ran).toEqual(['rest:2']);
  });

  it('completes a held follow-up pick by pick although its condition does not hold', () => {
    const r = runner();
    expect(r.performAction('scout', 1, {}).success).toBe(true);
    r.startPendingAction('loot', 1);
    expect(r.processSelectionStep(1, 'where', 'north').success).toBe(true);
    expect(r.performAction('take', 2, {}).success).toBe(true);

    expect(r.processSelectionStep(1, 'what', 'gold')).toMatchObject({ success: true, actionComplete: true });
    expect(historyLabels(r.actionHistory)).toEqual(['scout:1', 'take:2', 'loot:1']);
  });

  it('still refuses a seat that does not hold the follow-up, as before', () => {
    const r = runner();
    expect(r.performAction('scout', 1, {}).success).toBe(true);
    r.startPendingAction('loot', 2);

    expect(r.processSelectionStep(2, 'where', 'north')).toEqual({
      success: false,
      error: "'loot' is not one of your actions right now.",
    });
  });
});

describe('GameSession', () => {
  it("refuses to complete a pending action once another seat's move took its condition away", async () => {
    const s = session();
    expect((await s.processSelectionStep(1, 'where', 'north', 'build')).success).toBe(true);
    expect((await s.performAction('take', 2, {})).success).toBe(true);
    const historyBefore = historyLabels(s.runner.actionHistory);

    const step = await s.processSelectionStep(1, 'what', 'wall');

    expect(step).toMatchObject({ success: false, error: STONE_GONE, errorCode: 'ACTION_NOT_AVAILABLE' });
    expect(s.runner.game.ran).toEqual(['take:2']);
    expect(historyLabels(s.runner.actionHistory)).toEqual(historyBefore);
  });

  it('refuses the first pick of an action whose condition does not hold', async () => {
    const s = session();
    expect((await s.performAction('take', 2, {})).success).toBe(true);

    const step = await s.processSelectionStep(1, 'where', 'north', 'build');

    expect(step).toMatchObject({ success: false, error: STONE_GONE_AT_START, errorCode: 'ACTION_NOT_AVAILABLE' });
  });

  it("completes an action whose own picks end its condition, with another seat's move in between", async () => {
    const s = session();
    expect((await s.processSelectionStep(1, 'spot', 'east', 'dig')).success).toBe(true);
    expect((await s.performAction('rest', 2, {})).success).toBe(true);

    const step = await s.processSelectionStep(1, 'spot', 'stop');

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(historyLabels(s.runner.actionHistory)).toEqual(['rest:2', 'dig:1']);
  });

  it('completes a held follow-up pick by pick although its condition does not hold', async () => {
    const s = session();
    expect((await s.performAction('scout', 1, {})).followUp?.action).toBe('loot');
    expect((await s.processSelectionStep(1, 'where', 'north', 'loot')).success).toBe(true);

    const step = await s.processSelectionStep(1, 'what', 'gold');

    expect(step).toMatchObject({ success: true, actionComplete: true });
    expect(s.runner.game.ran).toEqual(['loot:1']);
  });
});

describe('stateless selectionStep op', () => {
  async function start(): Promise<OpResult> {
    return executeOp(gameDef, gameOptions, null, {}, { type: 'start' });
  }

  async function act(after: OpResult, actionName: string, player: number): Promise<OpResult> {
    const res = await executeOp(gameDef, gameOptions, after.snapshot, null, {
      type: 'action', actionName, player, args: {}, boundaryKey: boundaryKeyOf(after.snapshot),
    });
    expect(res.success).toBe(true);
    return res;
  }

  /** Seat 1's pick, on the game `after` left, continuing the pending state `pending` holds. */
  function pick(after: OpResult, pending: OpResult | null, actionName: string, selectionName: string, value: string) {
    return executeOp(gameDef, gameOptions, after.snapshot, pending?.pendingState ?? null, {
      type: 'selectionStep', player: 1, selectionName, value, actionName,
      boundaryKey: boundaryKeyOf(after.snapshot),
    });
  }

  it("refuses to complete a pending action once another seat's move took its condition away", async () => {
    const first = await pick(await start(), null, 'build', 'where', 'north');
    expect(first.success).toBe(true);
    const taken = await act(first, 'take', 2);

    const step = await pick(taken, first, 'build', 'what', 'wall');

    expect(step).toMatchObject({ success: false, error: STONE_GONE, errorCode: 'ACTION_NOT_AVAILABLE' });
  });

  it('refuses the first pick of an action whose condition does not hold', async () => {
    const taken = await act(await start(), 'take', 2);

    const step = await pick(taken, null, 'build', 'where', 'north');

    expect(step).toMatchObject({ success: false, error: STONE_GONE_AT_START, errorCode: 'ACTION_NOT_AVAILABLE' });
  });

  it("completes an action whose own picks end its condition, with another seat's move in between", async () => {
    const first = await pick(await start(), null, 'dig', 'spot', 'east');
    expect(first.success).toBe(true);
    const rested = await act(first, 'rest', 2);

    const step = await pick(rested, first, 'dig', 'spot', 'stop');

    expect(step).toMatchObject({ success: true, actionComplete: true });
  });

  it('completes a held follow-up pick by pick although its condition does not hold', async () => {
    const first = await pick(await act(await start(), 'scout', 1), null, 'loot', 'where', 'north');
    expect(first.success).toBe(true);

    const step = await pick(first, first, 'loot', 'what', 'gold');

    expect(step).toMatchObject({ success: true, actionComplete: true });
  });
});
