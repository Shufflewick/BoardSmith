/**
 * Test suite for useActionController prefill handling.
 *
 * Covers the case a custom UI relies on: start() is handed every selection's
 * value up front and the action must submit without asking the player again.
 * The choices for each selection arrive asynchronously from the server, which
 * is how world mode works: the frozen metadata carries no choices at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import {
  useActionController,
  type ActionMetadata,
  type PickChoicesResult,
} from './useActionController.js';
import { createMockSendAction } from './useActionController.helpers.js';

/** Settle every queued watcher and every pending fetch microtask. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await nextTick();
  }
}

/**
 * Metadata shaped like a world-mode broadcast: the selections are declared but
 * every choice list is server-side, so nothing can be resolved without a fetch.
 */
function buildMetadata(): Record<string, ActionMetadata> {
  return {
    build: {
      name: 'build',
      prompt: 'Construct a building',
      selections: [
        {
          name: 'plot',
          type: 'element',
          prompt: 'Select a plot',
        },
        {
          name: 'building',
          type: 'choice',
          prompt: 'Select a building',
          dependsOn: 'plot',
        },
      ],
    },
  };
}

describe('useActionController prefill', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref(['build']);
    actionMetadata = ref(buildMetadata());
    isMyTurn = ref(true);
  });

  /**
   * Server stub whose choices only ever arrive after a real await, and whose
   * building list depends on the plot already collected.
   */
  function createFetchPickChoices() {
    return vi.fn(async (
      _actionName: string,
      selectionName: string,
      _player: number,
      args: Record<string, unknown>
    ): Promise<PickChoicesResult> => {
      await Promise.resolve();
      await Promise.resolve();

      if (selectionName === 'plot') {
        return {
          success: true,
          validElements: [
            { id: 41, display: 'Plot -2,1' },
            { id: 42, display: 'Plot 0,0' },
          ],
        };
      }

      if (selectionName === 'building') {
        if (args.plot === undefined) {
          return { success: false, error: 'building choices need a plot' };
        }
        return {
          success: true,
          choices: [
            { value: 'university', display: 'University' },
            { value: 'mine', display: 'Mine' },
          ],
        };
      }

      return { success: false, error: `unexpected selection ${selectionName}` };
    });
  }

  function createController(fetchPickChoices: ReturnType<typeof createFetchPickChoices>) {
    return useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: true,
      playerSeat: ref(0),
      fetchPickChoices,
    });
  }

  it('consumes both prefills and submits the action once', async () => {
    const fetchPickChoices = createFetchPickChoices();
    const controller = createController(fetchPickChoices);

    await controller.start('build', {
      prefill: { plot: 41, building: 'university' },
    });
    await flush();

    expect(controller.currentPick.value).toBeNull();
    // One request per selection: the watcher joins the fetch start() has in
    // flight rather than issuing its own.
    expect(fetchPickChoices).toHaveBeenCalledTimes(2);
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('build', {
      plot: 41,
      building: 'university',
    });
  });

  it('leaves an invalid prefill unapplied and keeps asking for that selection', async () => {
    const fetchPickChoices = createFetchPickChoices();
    const controller = createController(fetchPickChoices);

    await controller.start('build', {
      prefill: { plot: 41, building: 'observatory' },
    });
    await flush();

    expect(controller.currentPick.value?.name).toBe('building');
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toBe(
      'Cannot prefill "Select a building" with "observatory". Pick one of: University, Mine.'
    );
  });
});
