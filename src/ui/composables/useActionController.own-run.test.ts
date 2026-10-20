/**
 * Work that belongs to one run of an action reads that run, never whichever
 * action happens to be open when it gets round to reading (#1051).
 */
import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController } from './useActionController.js';
import type { ControllerActionResult, EnrichedActionMetadata, PickStepResponse } from './useActionControllerTypes.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await nextTick();
    await Promise.resolve();
  }
}

const cards = [{ value: 1, display: 'One' }, { value: 2, display: 'Two' }];

describe('execute() of an action that is not open reads its own args for dependent picks (#1030)', () => {
  const metadata: Record<string, EnrichedActionMetadata> = {
    // Open while the custom UI executes `trade`; it has its own pick named `suit`.
    survey: {
      name: 'survey',
      prompt: 'Survey',
      selections: [
        { name: 'suit', type: 'choice', prompt: 'Suit', choices: [{ value: 'H', display: 'Hearts' }, { value: 'S', display: 'Spades' }] },
        { name: 'note', type: 'choice', prompt: 'Note', choices: [{ value: 'a', display: 'A' }, { value: 'b', display: 'B' }] },
      ],
    },
    trade: {
      name: 'trade',
      prompt: 'Trade',
      selections: [
        { name: 'suit', type: 'choice', prompt: 'Suit', choices: [{ value: 'H', display: 'Hearts' }, { value: 'S', display: 'Spades' }] },
        {
          name: 'card',
          type: 'choice',
          prompt: 'Card',
          dependsOn: 'suit',
          choicesByDependentValue: { H: [{ value: 'H3', display: '3 of Hearts' }], S: [{ value: 'S9', display: '9 of Spades' }] },
        },
        {
          name: 'swap',
          type: 'choice',
          prompt: 'Swap',
          filterBy: { key: 'suit', selectionName: 'suit' },
          choices: [{ value: { suit: 'H', rank: 5 }, display: '5 of Hearts' }, { value: { suit: 'S', rank: 7 }, display: '7 of Spades' }],
        },
      ],
    },
  };

  it('auto-fills the dependent and filtered picks from the executed args, not the open action', async () => {
    const sendAction = vi.fn(async (): Promise<ControllerActionResult> => ({ success: true }));
    const controller = useActionController({
      sendAction,
      availableActions: ref(['survey', 'trade']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      autoFill: true,
      autoExecute: false,
    });
    await controller.start('survey');
    await controller.fill('suit', 'S');

    await controller.execute('trade', { suit: 'H' });

    expect(sendAction).toHaveBeenCalledWith('trade', { suit: 'H', card: 'H3', swap: { suit: 'H', rank: 5 } });
  });
});

describe('auto-execute hooks and listeners are told which run they belong to (#1026)', () => {
  const metadata: Record<string, EnrichedActionMetadata> = {
    play: { name: 'play', prompt: 'Play', selections: [{ name: 'card', type: 'choice', prompt: 'Card', choices: cards }] },
  };

  /**
   * A game with a second before-hook that awaits on its first call. The player
   * plays card 1, cancels while that hook waits, then plays card 2, which runs
   * to the end before the first run's hook finishes.
   */
  async function cancelDuringHookThenPlayAgain() {
    const sendAction = vi.fn(async (): Promise<ControllerActionResult> => ({ success: true }));
    const controller = useActionController({
      sendAction,
      availableActions: ref(['play']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: true,
    });
    const hookRuns: number[] = [];
    const lateHook: Array<{ actionName: string; args: Record<string, unknown>; run: number }> = [];
    const outcomes: Array<{ run: number; result: ControllerActionResult }> = [];
    const gate = deferred<void>();
    let firstCall = true;
    controller.onBeforeAutoExecute((_name, _args, run) => { hookRuns.push(run); });
    controller.onBeforeAutoExecute(async () => {
      if (!firstCall) return;
      firstCall = false;
      await gate.promise;
    });
    controller.onBeforeAutoExecute((actionName, args, run) => { lateHook.push({ actionName, args, run }); });
    controller.onAfterAutoExecute((result, run) => { outcomes.push({ run, result }); });

    await controller.start('play');
    await controller.fill('card', 1);
    await flush();
    controller.cancel();
    await controller.start('play');
    await controller.fill('card', 2);
    await flush();
    gate.resolve();
    await flush();
    return { controller, sendAction, hookRuns, lateHook, outcomes };
  }

  it("a hook that runs after the player moved on is handed its own run's args", async () => {
    const { lateHook, hookRuns } = await cancelDuringHookThenPlayAgain();

    expect(lateHook).toEqual([
      { actionName: 'play', args: { card: 2 }, run: hookRuns[1] },
      { actionName: 'play', args: { card: 1 }, run: hookRuns[0] },
    ]);
  });

  it('each outcome carries the run its hooks were given', async () => {
    const { hookRuns, outcomes, sendAction } = await cancelDuringHookThenPlayAgain();

    expect(hookRuns[0]).not.toBe(hookRuns[1]);
    expect(outcomes).toEqual([
      { run: hookRuns[1], result: { success: true } },
      { run: hookRuns[0], result: { success: false, error: 'Action was cancelled' } },
    ]);
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it('a manual execute() tells no after-listener', async () => {
    const controller = useActionController({
      sendAction: vi.fn(async (): Promise<ControllerActionResult> => ({ success: true })),
      availableActions: ref(['play']),
      actionMetadata: ref(metadata),
      isMyTurn: ref(true),
      autoExecute: true,
    });
    const listener = vi.fn();
    controller.onAfterAutoExecute(listener);

    expect(await controller.execute('play', { card: 1 })).toEqual({ success: true });
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("a repeating pick's reply after the player moved on leaves the new run's state alone", () => {
  it('does not mark the new run as no longer waiting for the server', async () => {
    const replies: Array<ReturnType<typeof deferred<PickStepResponse>>> = [];
    const pickStep = vi.fn(() => {
      const reply = deferred<PickStepResponse>();
      replies.push(reply);
      return reply.promise;
    });
    const controller = useActionController({
      sendAction: vi.fn(async (): Promise<ControllerActionResult> => ({ success: true })),
      availableActions: ref(['collect']),
      actionMetadata: ref({
        collect: {
          name: 'collect',
          prompt: 'Collect',
          selections: [{ name: 'gem', type: 'choice', prompt: 'Gem', repeat: { hasOnEach: false }, choices: cards }],
        },
      }),
      isMyTurn: ref(true),
      pickStep,
      cancelPendingAction: vi.fn(async () => {}),
      autoFill: false,
    });

    await controller.start('collect');
    const stale = controller.fill('gem', 1);
    controller.cancel();
    await controller.start('collect');
    const fresh = controller.fill('gem', 2);
    replies[0].resolve({ success: true });
    await stale;
    await flush();

    expect(controller.repeatingState.value?.awaitingServer).toBe(true);
    replies[1].resolve({ success: true });
    await fresh;
    expect(controller.repeatingState.value?.awaitingServer).toBe(false);
  });
});
