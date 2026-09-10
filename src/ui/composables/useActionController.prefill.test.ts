/**
 * Test suite for useActionController prefill handling.
 *
 * Covers the case a custom UI relies on: start() is handed every selection's
 * value up front and the action must submit without asking the player again.
 * The choices for each selection arrive asynchronously from the server, which
 * is how world mode works: the frozen metadata carries no choices at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  /**
   * #227: A PICK THE GAME WOULD NOT ANSWER IS SAID OUT LOUD.
   *
   * A dependent selection's list and bounds come from a round trip, and a
   * refused one used to reach `console.error` and nowhere else -- so the panel
   * quietly kept whatever the one-shot metadata carried and the player was
   * shown a choice the game had just declined to describe. Both shells watch
   * `errorTick` and speak, so surfacing it here is what puts the sentence on
   * screen in a table AND in a world.
   */
  describe('a pick the game would not describe (#227)', () => {
    /** The plot answers; the building's own round trip fails as `fail` says. */
    function fetchWhereTheBuildingFails(fail: () => PickChoicesResult) {
      return vi.fn(async (
        _actionName: string,
        selectionName: string,
      ): Promise<PickChoicesResult> => {
        await Promise.resolve();
        if (selectionName === 'plot') {
          return { success: true, validElements: [{ id: 41, display: 'Plot -2,1' }] };
        }
        return fail();
      });
    }

    /** Walk straight into the dependent selection with the plot prefilled. */
    async function walkInto(fail: () => PickChoicesResult) {
      const controller = createController(fetchWhereTheBuildingFails(fail) as never);
      await controller.start('build', { prefill: { plot: 41 } });
      await flush();
      return controller;
    }

    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => consoleError.mockRestore());

    it("says the game's own reason, rather than only logging it", async () => {
      const controller = await walkInto(() => ({
        success: false,
        error: 'That plot is under a claim, so nothing may be built on it.',
      }));

      expect(controller.lastError.value).toBe(
        'That plot is under a claim, so nothing may be built on it.',
      );
      expect(controller.errorTick.value).toBeGreaterThan(0);
    });

    it('says something a player can act on when the fetch itself throws', async () => {
      const controller = await walkInto(() => {
        throw new Error('the socket went');
      });

      // NAMES THE SELECTION, and says nothing has been sent: the player's next
      // move is to take the action again, and a bare exception says neither.
      expect(controller.lastError.value).toContain('Select a building');
      expect(controller.lastError.value).toContain('nothing has been sent');
    });
  });
});
