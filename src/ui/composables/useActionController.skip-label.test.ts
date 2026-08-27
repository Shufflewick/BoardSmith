/**
 * A custom Skip label is still a skip (#152).
 *
 * `BaseSelection.optional` is `boolean | string`, where a string is the label
 * the Skip button carries. `skip()` gates on `selection.optional` being truthy,
 * and #92's history around that gate is the reason this is pinned rather than
 * reasoned about: a non-empty label must behave exactly like `optional: true`,
 * and `false` must still refuse.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type ActionMetadata } from './useActionController.js';
import { createMockSendAction, createTestMetadata } from './useActionController.helpers.js';

const SKIP_LABEL = 'Keep them all';

/** One action with a single optional selection, whose `optional` we vary. */
function metaWithOptional(optional: boolean | string): Record<string, ActionMetadata> {
  return {
    donate: {
      name: 'donate',
      prompt: 'Donate a card',
      selections: [
        {
          name: 'card',
          type: 'choice',
          prompt: 'Which card?',
          optional,
          choices: [
            { value: 'coin', display: 'Coin' },
            { value: 'gem', display: 'Gem' },
          ],
        },
      ],
    },
  };
}

describe('skip() with a custom Skip label (#152)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let availableActions: ReturnType<typeof ref<string[]>>;
  let actionMetadata: ReturnType<typeof ref<Record<string, ActionMetadata> | undefined>>;
  let isMyTurn: ReturnType<typeof ref<boolean>>;

  function controllerFor(optional: boolean | string, autoExecute = false) {
    actionMetadata.value = { ...createTestMetadata(), ...metaWithOptional(optional) };
    availableActions.value = ['endTurn', 'donate'];
    return useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute,
      autoFill: false,
      playerSeat: ref(0),
    });
  }

  beforeEach(() => {
    sendAction = createMockSendAction();
    availableActions = ref(['endTurn']);
    actionMetadata = ref(createTestMetadata());
    isMyTurn = ref(true);
  });

  it('skips a selection whose optional is a label string', async () => {
    const controller = controllerFor(SKIP_LABEL);
    await controller.start('donate');
    expect(controller.currentAction.value).toBe('donate');

    controller.skip('card');
    await nextTick();

    expect(controller.currentArgs.value.card).toBeNull();
    expect(controller.getCollectedPick('card')?.skipped).toBe(true);
  });

  it('records the same skip that optional: true records', async () => {
    const labelled = controllerFor(SKIP_LABEL);
    await labelled.start('donate');
    labelled.skip('card');
    await nextTick();
    const withLabel = labelled.getCollectedPick('card');

    const plain = controllerFor(true);
    await plain.start('donate');
    plain.skip('card');
    await nextTick();

    expect(withLabel).toEqual(plain.getCollectedPick('card'));
    expect(withLabel?.skipped).toBe(true);
  });

  it('leaves the skipped selection out of the submitted args, label and all', async () => {
    const controller = controllerFor(SKIP_LABEL, true);
    await controller.start('donate');
    controller.skip('card');
    await nextTick();
    await nextTick();

    const call = sendAction.mock.calls.at(-1);
    expect(call?.[0]).toBe('donate');
    const args = call?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('card');
  });

  it('still refuses to skip a selection that is not optional', async () => {
    const controller = controllerFor(false);
    await controller.start('donate');

    controller.skip('card');
    await nextTick();

    expect(controller.currentArgs.value.card).toBeUndefined();
    expect(controller.getCollectedPick('card')).toBeUndefined();
  });
});
