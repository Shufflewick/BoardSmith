/**
 * BUILDING AN ORDERED, REPEATABLE LIST FROM THE UI (#249).
 *
 * The engine can take a list whose entries repeat and whose order is the rule.
 * A capability no player can reach is a bug (#167), so the draft that carries
 * one lives HERE, in the shared controller, for the same reason the multiSelect
 * draft does: the Action Panel and a custom board are two views of one
 * in-progress selection, and a draft held inside the panel cannot be read by a
 * board.
 *
 * `appendListEntry` is deliberately not `toggleMultiSelect`: a toggle cannot
 * express "again" -- pressing the same option twice in a set REMOVES it, which
 * is exactly the gesture a list needs to mean a second entry. Removal is by
 * INDEX for the same reason: with repeats, "remove university" does not name
 * one entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { useActionController, type ActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.helpers.js';

/** One action: repair up to three buildings, in order, repeats allowed. */
function repairMetadata(): Record<string, ActionMetadata> {
  return {
    repair: {
      name: 'repair',
      prompt: 'Repair buildings',
      selections: [
        {
          name: 'buildings',
          type: 'choice',
          prompt: 'Repair, in order',
          orderedList: { min: 1, max: 3 },
          choices: [
            { value: 'university', display: 'University' },
            { value: 'shipyard', display: 'Shipyard' },
          ],
        },
      ],
    },
  };
}

describe('useActionController ordered lists (#249)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref(['repair']);
    actionMetadata = ref(repairMetadata());
    isMyTurn = ref(true);
  });

  function newController() {
    return useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: false,
      autoFill: false,
      playerSeat: ref(0),
    });
  }

  it('appends the SAME choice twice, in order, instead of toggling it off', async () => {
    const controller = newController();
    await controller.start('repair');

    await controller.appendListEntry('buildings', 'university');
    await controller.appendListEntry('buildings', 'university');

    expect(controller.multiSelectDraft.value).toEqual({
      selectionName: 'buildings',
      values: ['university', 'university'],
    });
  });

  it('keeps the order the player built, not the order the choices were offered', async () => {
    const controller = newController();
    await controller.start('repair');

    await controller.appendListEntry('buildings', 'shipyard');
    await controller.appendListEntry('buildings', 'university');
    await controller.appendListEntry('buildings', 'shipyard');

    expect(controller.multiSelectDraft.value?.values).toEqual([
      'shipyard',
      'university',
      'shipyard',
    ]);
  });

  it('removes ONE entry by index, leaving its twin in place', async () => {
    const controller = newController();
    await controller.start('repair');
    await controller.appendListEntry('buildings', 'university');
    await controller.appendListEntry('buildings', 'shipyard');
    await controller.appendListEntry('buildings', 'university');

    controller.removeListEntry('buildings', 1);

    expect(controller.multiSelectDraft.value?.values).toEqual(['university', 'university']);
  });

  it('stops appending at the ENTRY cap', async () => {
    const controller = newController();
    await controller.start('repair');

    for (let i = 0; i < 5; i++) await controller.appendListEntry('buildings', 'university');

    expect(controller.multiSelectDraft.value?.values).toEqual([
      'university',
      'university',
      'university',
    ]);
  });

  it('submits the list, order and repeats intact, through the ordinary confirm path', async () => {
    // autoExecute on, because a confirmed last selection is what the panel's Done
    // button reaches: the point is that the ARRAY the server receives is the
    // sequence the player built, repeats and all.
    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: true,
      autoFill: false,
      playerSeat: ref(0),
    });
    await controller.start('repair');
    await controller.appendListEntry('buildings', 'shipyard');
    await controller.appendListEntry('buildings', 'shipyard');

    await controller.confirmMultiSelect();

    expect(sendAction).toHaveBeenCalledWith(
      'repair',
      { buildings: ['shipyard', 'shipyard'] },
    );
  });

  it('REFUSES a scalar through fill(), the way a multiSelect pick does', async () => {
    const controller = newController();
    await controller.start('repair');

    const result = await controller.fill('buildings', 'university');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('buildings');
    expect(result.error).toContain('requires an array');
    expect(controller.currentArgs.value.buildings).toBeUndefined();
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('IGNORES an append on a pick that is not a list, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    actionMetadata.value = {
      plain: {
        name: 'plain',
        prompt: 'Pick one',
        selections: [
          {
            name: 'card',
            type: 'choice',
            prompt: 'Pick one',
            choices: [{ value: 1, display: 'One' }],
          },
        ],
      },
    };
    availableActions.value = ['plain'];
    const controller = newController();
    await controller.start('plain');

    await controller.appendListEntry('card', 1);

    expect(controller.multiSelectDraft.value).toBeNull();
    expect(controller.currentArgs.value.card).toBeUndefined();
    warn.mockRestore();
  });

  it('prefers the SERVER-resolved bounds for this step over the static metadata', async () => {
    // The same rule multiSelect follows (v4.8-WR01): a function-valued bound is
    // resolved against the arguments bound so far, and the fetched snapshot is
    // the only thing that knows them.
    actionMetadata.value = {
      repair: {
        name: 'repair',
        prompt: 'Repair buildings',
        selections: [
          { name: 'budget', type: 'choice', prompt: 'Budget', choices: [{ value: 3, display: '3' }] },
          {
            name: 'buildings',
            type: 'choice',
            prompt: 'Repair, in order',
            // Stale: baked at metadata time with no arguments bound.
            orderedList: { min: 1, max: 1 },
            choices: [{ value: 'university', display: 'University' }],
          },
        ],
      },
    };
    const fetchPickChoices = vi.fn().mockImplementation(async (_seat, selectionName, _action, currentArgs) => {
      if (selectionName === 'buildings') {
        return {
          success: true,
          choices: [{ value: 'university', display: 'University' }],
          orderedList: { min: 1, max: currentArgs.budget as number },
        };
      }
      return { success: true, choices: [{ value: 3, display: '3' }] };
    });
    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: false,
      autoFill: false,
      playerSeat: ref(0),
      fetchPickChoices,
    });

    await controller.start('repair');
    await controller.fill('budget', 3);
    for (let i = 0; i < 4; i++) await controller.appendListEntry('buildings', 'university');

    expect(controller.multiSelectDraft.value?.values).toEqual([
      'university',
      'university',
      'university',
    ]);
  });
});
