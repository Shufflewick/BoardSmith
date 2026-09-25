/**
 * #385: THE STATE RETURNED TO THE ACTING SEAT AGREES WITH THE NEXT BROADCAST ON
 * `canUndo`.
 *
 * `canUndo` comes from `decideUndo` (#373), which asks whether the checkpoint
 * window still holds the turn start. That window is settled when the op's
 * checkpoint is recorded. A state built before that point reads the window one
 * step stale, so with a small `checkpoints.max` it offered an undo the next
 * broadcast withdrew and the server refused.
 *
 * Each case plays a prefix of one script (single-step actions and a two-pick
 * action, a pick at a time) from a fresh session, then requires, at every step:
 * the state returned to the acting seat and the next broadcast agree on
 * `canUndo`, and the undo the seat is then offered succeeds (and one it is not
 * offered is refused). The stateless executor is driven through
 * `createHeadlessSession`, the public stateless `PickHandler` directly (the
 * path whose returned state went stale), and the stateful `GameSession`
 * through its own methods.
 */
import { describe, expect, it } from 'vitest';

import {
  Action,
  Game,
  Player,
  actionStep,
  defineFlow,
  loop,
  type GameOptions,
} from '../../engine/index.js';
import { GameRunner } from '../../runtime/index.js';
import { executeOp, type GameDefinitionLike } from '../stateless-ops.js';
import { PickHandler } from '../pick-handler.js';
import { buildPlayerState } from '../utils.js';
import { createHeadlessSession } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import type { BroadcastAdapter, PlayerGameState, StateUpdate } from '../types.js';

/** One seat, one frame: `move` in one step, `pair` in two picks. */
class PickGame extends Game<PickGame, Player> {
  moves = 0;
  pairs: Array<[string, string]> = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PickGame>('move').execute((_args, ctx) => {
        ctx.game.moves += 1;
      }),
    );
    this.registerAction(
      Action.create<PickGame>('pair')
        .chooseFrom('first', { choices: ['a', 'b'] })
        .chooseFrom('second', { choices: ['c', 'd'] })
        .execute((args, ctx) => {
          ctx.game.pairs.push([args.first as string, args.second as string]);
        }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          while: (ctx) => !ctx.game.isFinished(),
          do: actionStep({
            actions: ['move', 'pair'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      }),
    );
  }
}

function pickDefinition(max: number): GameDefinitionLike {
  return {
    gameClass: PickGame,
    gameType: `pick-max-${max}`,
    minPlayers: 1,
    maxPlayers: 1,
    checkpoints: { max },
  };
}

/** One op of the script: a whole single-step action, or one pick of `pair`. */
type Step =
  | { kind: 'action'; actionName: 'move' }
  | { kind: 'pick'; selectionName: 'first' | 'second'; value: string };

/**
 * A pick-completed action first, so under `max: 1` the stale window still held
 * the turn start; under `max: 3` the second `pair` is the one it goes stale on.
 */
const SCRIPT: Step[] = [
  { kind: 'pick', selectionName: 'first', value: 'a' },
  { kind: 'pick', selectionName: 'second', value: 'c' },
  { kind: 'action', actionName: 'move' },
  { kind: 'pick', selectionName: 'first', value: 'b' },
  { kind: 'pick', selectionName: 'second', value: 'd' },
  { kind: 'action', actionName: 'move' },
];

/** What one step shows the acting seat, and what the undo then does. */
interface Observed {
  returned: boolean;
  broadcast: boolean;
  undoSucceeded: boolean;
}

/** A seat's `canUndo`, which every state a seat is sent must carry. */
function canUndoOf(state: PlayerGameState | undefined): boolean {
  expect(typeof state?.canUndo, 'the state carries canUndo').toBe('boolean');
  return state?.canUndo === true;
}

async function observeStateless(max: number, upTo: number): Promise<Observed> {
  const session = createHeadlessSession(pickDefinition(max), { playerCount: 1, seed: 'pick-385' });
  await session.start();
  let returned: PlayerGameState | undefined;
  for (const step of SCRIPT.slice(0, upTo)) {
    const res =
      step.kind === 'action'
        ? await session.send(1, { type: 'action', actionName: step.actionName, player: 1, args: {} })
        : await session.send(1, {
            type: 'selectionStep',
            actionName: 'pair',
            selectionName: step.selectionName,
            value: step.value,
            player: 1,
          });
    expect(res.success, res.error).toBe(true);
    returned = (res.playerViews[0] as { state: PlayerGameState }).state;
  }
  const broadcast = (session.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[0].state;
  const undo = await session.send(1, { type: 'undo', player: 1 });
  return { returned: canUndoOf(returned), broadcast: canUndoOf(broadcast), undoSucceeded: undo.success };
}

async function observeSession(max: number, upTo: number): Promise<Observed> {
  const broadcasts: PlayerGameState[] = [];
  const session = GameSession.create<PickGame>({
    gameType: `pick-max-${max}`,
    GameClass: PickGame,
    playerCount: 1,
    playerNames: ['Solo'],
    seed: 'pick-385',
    checkpoints: { max },
  });
  const broadcaster: BroadcastAdapter = {
    getSessions: () => [{ playerSeat: 1, isSpectator: false }],
    send: (_session, message) => {
      broadcasts.push((message as StateUpdate).state);
    },
  };
  session.setBroadcaster(broadcaster);
  let returned: PlayerGameState | undefined;
  for (const step of SCRIPT.slice(0, upTo)) {
    const res =
      step.kind === 'action'
        ? await session.performAction(step.actionName, 1, {})
        : await session.processSelectionStep(1, step.selectionName, step.value, 'pair');
    expect(res.success, res.error).toBe(true);
    returned = res.state;
  }
  const broadcast = broadcasts.at(-1)!;
  const undo = await session.undoToTurnStart(1);
  return { returned: canUndoOf(returned), broadcast: canUndoOf(broadcast), undoSucceeded: undo.success };
}

/**
 * `PickHandler`, the public stateless pick API (#385's stale path): the state it
 * returns to the acting seat, the state the executor broadcasts from the same
 * runner once the op is settled, and the undo `executeOp` then takes from the
 * snapshot that op produced.
 */
async function observePickHandler(max: number, upTo: number): Promise<Observed> {
  const def = pickDefinition(max);
  const runner = new GameRunner<PickGame>({
    GameClass: PickGame,
    gameType: def.gameType,
    gameOptions: { playerCount: 1, playerNames: ['Solo'], seed: 'pick-385' },
    checkpoints: { max },
  });
  runner.start();
  const handler = new PickHandler(runner, 1);
  let pending: Record<string, unknown> | null = null;
  let returned: PlayerGameState | undefined;
  for (const step of SCRIPT.slice(0, upTo)) {
    if (step.kind === 'action') {
      const res = runner.performAction(step.actionName, 1, {});
      expect(res.success, res.error).toBe(true);
      // A single-step action returns no state of its own; what the seat sees is the envelope.
      runner.getSnapshot();
      returned = buildPlayerState(runner, [], 1, { includeActionMetadata: true });
      continue;
    }
    const res = await handler.processSelectionStep(1, step.selectionName, step.value, 'pair', undefined, pending);
    expect(res.success, res.error).toBe(true);
    pending = res.pendingState;
    returned = res.actionComplete ? res.actionResult!.state : res.state;
    if (res.actionComplete) expect(canUndoOf(res.state)).toBe(canUndoOf(returned));
  }
  const snapshot = runner.getSnapshot();
  const broadcast = buildPlayerState(runner, [], 1, { includeActionMetadata: true });
  const undo = await executeOp(def, { playerCount: 1, seed: 'pick-385' }, snapshot, pending, { type: 'undo', player: 1 });
  return { returned: canUndoOf(returned), broadcast: canUndoOf(broadcast), undoSucceeded: undo.success };
}

const STEPS = SCRIPT.map((_, i) => i + 1);

describe.each([
  ['stateless executor', observeStateless],
  ['stateless PickHandler', observePickHandler],
  ['stateful GameSession', observeSession],
])('#385: canUndo after each step agrees everywhere (%s)', (_path, observe) => {
  describe.each([1, 2, 3])('checkpoints: { max: %i }', (max) => {
    it.each(STEPS)('after step %i, the returned state, the broadcast and the undo agree', async (upTo) => {
      const seen = await observe(max, upTo);
      expect(seen.returned, 'returned vs broadcast').toBe(seen.broadcast);
      expect(seen.undoSucceeded, 'offered vs undo outcome').toBe(seen.broadcast);
    });
  });
});
