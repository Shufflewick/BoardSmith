// @vitest-environment jsdom
/**
 * BUG-017 / BUG-012, client half — an action's `ActionResult.data` must reach the
 * board no matter which transport ran the action.
 *
 * `src/session/action-result-data-propagation.test.ts` proves the value survives
 * the engine, the runner, the session, the ops envelope and the dev-host
 * whitelist. It stops at the op boundary. THIS file starts there: it wires the
 * REAL `useActionController` to `executeOp` + `shapeResult` — the exact functions
 * a host calls — and asserts on what a board component can actually read.
 *
 * That boundary is where the fix was initially incomplete. `execute()` returns
 * its `ActionResult` verbatim, so single-step actions looked fine. A pick-driven
 * action (an `onSelect` selection, or a repeating one) completes INSIDE `fill()`,
 * usually from an ActionPanel click no board code called, so there is no caller
 * to return to: the controller has to publish the result, and it did not. The
 * board got `undefined` with the action point already spent — the original
 * BUG-017 symptom, one layer above where the report looked.
 *
 * Nothing here is a stub. `actionMetadata` is the engine's own metadata as it
 * arrives in the player view (which is where `hasOnSelect` — the flag that routes
 * `fill()` through `pickStep` at all — comes from); a hand-written metadata
 * object would decide the routing the test exists to exercise.
 */

import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  loop,
  type GameOptions,
  type OnSelectContext,
} from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/stateless-ops.js';
import { shapeResult } from '../../cli/dev-host/bridge.js';
import { useActionController } from './useActionController.js';
import type { ActionMetadata, ActionResult, PickStepResult, PickChoicesResult } from './useActionControllerTypes.js';

const CARTOGRAPHY = { sectors: ['a1', 'b2', 'c3'], gps: false };
const NARRATION = 'You recall the shape of the coastline.';

async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

/**
 * Three ways to reach the same `execute()`: no selections, an `onSelect`
 * selection (server-routed per step), and a repeating selection.
 */
class ReportingGame extends Game<ReportingGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('viewMap').execute(() => ({
        success: true,
        data: { cartography: CARTOGRAPHY },
        message: NARRATION,
      }))
    );

    this.registerAction(
      Action.create('scout')
        .chooseFrom('sector', {
          choices: ['a1', 'b2', 'c3'],
          // An onSelect callback is what makes the engine mark the selection
          // `hasOnSelect`, which is what routes fill() through the server per
          // step. Its body is irrelevant here — its presence is the fixture.
          onSelect: (value: string, context: OnSelectContext) => {
            context.animate('scouted', { sector: value });
          },
        })
        .execute((args: Record<string, unknown>) => ({
          success: true,
          data: { report: `scouted ${args.sector as string}` },
          message: NARRATION,
        }))
    );

    this.registerAction(
      Action.create('survey')
        .chooseFrom('legs', { choices: ['north', 'south', 'done'], repeatUntil: 'done' })
        .execute((args: Record<string, unknown>) => ({
          success: true,
          data: { route: (args.legs as string[]).join('>') },
          message: NARRATION,
        }))
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({
            actions: ['viewMap', 'scout', 'survey'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      })
    );
  }
}

const gameDef: GameDefinitionLike = {
  gameClass: ReportingGame,
  gameType: 'reporting',
  minPlayers: 1,
  maxPlayers: 2,
};

const gameOptions = { playerCount: 2, seed: 'bug-017-client' };

interface PlayerView {
  flowState?: { availableActions?: string[] };
  state?: { actionMetadata?: Record<string, ActionMetadata> };
}

/**
 * A host, built the way a real one is: it holds the snapshot + pending state
 * between ops and shapes each response through the dev-host whitelist, then
 * hands the controller exactly what a board would receive.
 */
function createHost() {
  let snapshot: unknown = null;
  let pendingState: unknown = null;

  const availableActions = ref<string[]>([]);
  const actionMetadata = ref<Record<string, ActionMetadata> | undefined>(undefined);

  function absorb(result: Record<string, unknown>): void {
    if (result.snapshot !== undefined) snapshot = result.snapshot;
    // `pendingState` is cleared (to null) by the op that completes the action —
    // absorbing it unconditionally is what keeps the next op well-formed.
    if ('pendingState' in result) pendingState = result.pendingState;

    const views = result.playerViews as PlayerView[] | undefined;
    const seatOne = views?.[0];
    if (!seatOne) return;
    availableActions.value = seatOne.flowState?.availableActions ?? [];
    actionMetadata.value = seatOne.state?.actionMetadata;
  }

  return {
    availableActions,
    actionMetadata,
    async start(): Promise<void> {
      const result = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });
      absorb(result as unknown as Record<string, unknown>);
    },
    async sendAction(actionName: string, args: Record<string, unknown>): Promise<ActionResult> {
      const result = await executeOp(gameDef, gameOptions, snapshot, pendingState, {
        type: 'action',
        actionName,
        player: 1,
        args,
      });
      absorb(result as unknown as Record<string, unknown>);
      return shapeResult('action', result) as unknown as ActionResult;
    },
    async pickStep(
      player: number,
      selectionName: string,
      value: unknown,
      actionName: string,
      initialArgs?: Record<string, unknown>,
    ): Promise<PickStepResult> {
      const result = await executeOp(gameDef, gameOptions, snapshot, pendingState, {
        type: 'selectionStep',
        actionName,
        player,
        selectionName,
        value,
        initialArgs,
      });
      absorb(result as unknown as Record<string, unknown>);
      return shapeResult('selection_step', result) as unknown as PickStepResult;
    },
    async fetchPickChoices(
      actionName: string,
      selectionName: string,
      player: number,
      currentArgs: Record<string, unknown>,
    ): Promise<PickChoicesResult> {
      const result = await executeOp(gameDef, gameOptions, snapshot, pendingState, {
        type: 'resolveChoices',
        actionName,
        selectionName,
        player,
        args: currentArgs,
      });
      return shapeResult('resolve_choices', result) as unknown as PickChoicesResult;
    },
  };
}

function createController(host: ReturnType<typeof createHost>) {
  return useActionController({
    sendAction: host.sendAction,
    availableActions: host.availableActions,
    actionMetadata: host.actionMetadata,
    isMyTurn: ref(true),
    playerSeat: ref(1),
    fetchPickChoices: host.fetchPickChoices,
    pickStep: host.pickStep,
    // Off: the point is to observe each transport deliberately, not to have the
    // controller auto-fill a sole choice and pick the transport for us.
    autoFill: false,
  });
}

describe('BUG-017 — an action result reaches the board on every transport', () => {
  it('single-step: execute() returns data and publishes lastActionResult', async () => {
    const host = createHost();
    await host.start();
    const controller = createController(host);
    await flush();

    const result = await controller.execute('viewMap', {});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ cartography: CARTOGRAPHY });
    expect(result.message).toBe(NARRATION);

    expect(controller.lastActionResult.value).toEqual({
      action: 'viewMap',
      seat: 1,
      result,
    });
  });

  it('onSelect-routed: fill() completes the action and publishes its data', async () => {
    const host = createHost();
    await host.start();
    const controller = createController(host);
    await flush();

    await controller.start('scout');
    await flush();

    // Proof the routing under test is the server one: the engine only sets
    // hasOnSelect for a selection with an onSelect callback, and that flag is
    // what sends fill() through pickStep instead of collecting locally.
    expect(host.actionMetadata.value?.scout?.selections?.[0]?.hasOnSelect).toBe(true);

    const filled = await controller.fill('sector', 'b2');
    expect(filled).toEqual({ valid: true });

    // The action ran on the server (single selection => that step completed it),
    // so its return value has to arrive here or it arrives nowhere.
    expect(controller.lastActionResult.value?.action).toBe('scout');
    expect(controller.lastActionResult.value?.seat).toBe(1);
    expect(controller.lastActionResult.value?.result.success).toBe(true);
    expect(controller.lastActionResult.value?.result.data).toEqual({ report: 'scouted b2' });
    expect(controller.lastActionResult.value?.result.message).toBe(NARRATION);
  });

  it('repeating selection: the terminating fill() publishes the completed data', async () => {
    const host = createHost();
    await host.start();
    const controller = createController(host);
    await flush();

    await controller.start('survey');
    await flush();

    await controller.fill('legs', 'north');
    await flush();
    // Mid-chain: nothing has executed yet, so there is nothing to publish.
    expect(controller.lastActionResult.value).toBeNull();

    await controller.fill('legs', 'south');
    await flush();
    expect(controller.lastActionResult.value).toBeNull();

    await controller.fill('legs', 'done');
    await flush();

    expect(controller.lastActionResult.value?.action).toBe('survey');
    expect(controller.lastActionResult.value?.result.data).toEqual({ route: 'north>south>done' });
    expect(controller.lastActionResult.value?.result.message).toBe(NARRATION);
  });

  it('publishes a fresh object per resolution, so a watcher sees repeats', async () => {
    const host = createHost();
    await host.start();
    const controller = createController(host);
    await flush();

    await controller.execute('viewMap', {});
    const first = controller.lastActionResult.value;
    await controller.execute('viewMap', {});
    const second = controller.lastActionResult.value;

    // Value-identical results — a ref holding the same object would not re-fire
    // a watcher, and the second map recall would silently not render.
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('publishes failures too, so a board is never left reading a stale result', async () => {
    const host = createHost();
    await host.start();
    const controller = createController(host);
    await flush();

    await controller.execute('viewMap', {});
    expect(controller.lastActionResult.value?.result.success).toBe(true);

    const failed = await controller.execute('scout', { sector: 'nowhere' });
    expect(failed.success).toBe(false);
    expect(controller.lastActionResult.value?.action).toBe('scout');
    expect(controller.lastActionResult.value?.result.success).toBe(false);
    expect(controller.lastActionResult.value?.result.data).toBeUndefined();
  });
});
