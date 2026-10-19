/**
 * #964: a pick that takes a list (chooseElements, multiSelect, ordered list)
 * can be prefilled with an array, each entry matched against the choices.
 */
import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.test-helper.js';

const XYZ = [{ value: 'x', display: 'X' }, { value: 'y', display: 'Y' }, { value: 'z', display: 'Z' }];

const metadata: Record<string, EnrichedActionMetadata> = {
  pickCards: {
    name: 'pickCards', prompt: 'Pick cards',
    selections: [{
      name: 'cards', type: 'elements', prompt: 'Which cards?',
      validElements: [{ id: 7, display: 'Seven' }, { id: 8, display: 'Eight' }, { id: 9, display: 'Nine' }],
    }],
  },
  pickMany: {
    name: 'pickMany', prompt: 'Pick some',
    selections: [{ name: 'many', type: 'choice', prompt: 'Which?', choices: XYZ, multiSelect: { min: 1, max: 3 } }],
  },
  pickOrder: {
    name: 'pickOrder', prompt: 'Order',
    selections: [{ name: 'order', type: 'choice', prompt: 'Which order?', choices: XYZ, orderedList: { min: 1, max: 3 } }],
  },
};

async function prefilled(action: string, prefill: Record<string, unknown>) {
  const sendAction = createMockSendAction();
  const controller = useActionController({
    sendAction,
    availableActions: ref(Object.keys(metadata)),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoExecute: true,
  });
  await controller.start(action, { prefill });
  for (let i = 0; i < 10; i++) await nextTick();
  return { sendAction, controller };
}

describe('an array prefill for a list pick (#964)', () => {
  it.each([
    ['pickCards', { cards: [9, 7] }],
    ['pickMany', { many: ['x', 'z'] }],
    ['pickOrder', { order: ['z', 'x', 'y'] }],
  ])('%s submits %j', async (action, prefill) => {
    const { sendAction, controller } = await prefilled(action, prefill);
    expect(controller.lastError.value).toBeNull();
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0][1]).toEqual(prefill);
  });

  it.each([
    ['pickCards', { cards: [7, 42] }],
    ['pickMany', { many: ['x', 'nope'] }],
  ])('%s refuses %j, naming the pick', async (action, prefill) => {
    const { sendAction, controller } = await prefilled(action, prefill);
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toMatch(/^Cannot prefill "Which/);
  });
});
