/**
 * #964: a pick that takes a list (chooseElements, multiSelect, ordered list)
 * can be prefilled with an array, each entry matched against the choices.
 */
import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.test-helper.js';

const XYZ = [{ value: 'x', display: 'X' }, { value: 'y', display: 'Y' }, { value: 'z', display: 'Z', disabled: 'Z is spent' }];

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
  pickOne: {
    name: 'pickOne', prompt: 'Pick one',
    selections: [{ name: 'one', type: 'choice', prompt: 'Which one?', choices: XYZ }],
  },
};

async function prefilled(action: string, prefill: Record<string, unknown>, autoExecute = true) {
  const sendAction = createMockSendAction();
  const controller = useActionController({
    sendAction,
    availableActions: ref(Object.keys(metadata)),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoExecute,
  });
  await controller.start(action, { prefill });
  for (let i = 0; i < 10; i++) await nextTick();
  return { sendAction, controller };
}

describe('an array prefill for a list pick (#964)', () => {
  it.each([
    ['pickCards', { cards: [9, 7] }],
    ['pickMany', { many: ['x', 'y'] }],
    ['pickOrder', { order: ['y', 'x', 'y'] }],
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

  it.each([
    ['pickCards', { cards: 7 }],
    ['pickMany', { many: 'x' }],
    ['pickOrder', { order: 'x' }],
  ])('%s refuses the lone value %j, asking for a list', async (action, prefill) => {
    const { sendAction, controller } = await prefilled(action, prefill);
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toMatch(/^Cannot prefill "Which.*": it takes a list, so pass an array\.$/);
  });

  it('gives the reason a disabled entry carries', async () => {
    const { sendAction, controller } = await prefilled('pickMany', { many: ['x', 'z'] });
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toBe('Cannot prefill "Which?" with "X, Z": Z is spent.');
  });
});

describe('the label a filled pick is shown by (#1298)', () => {
  it.each([
    ['pickCards', { cards: [9, 7] }, 'cards', 'Nine, Seven'],
    ['pickMany', { many: ['x', 'y'] }, 'many', 'X, Y'],
    ['pickOne', { one: 'x' }, 'one', 'X'],
  ])('%s prefilled with %j reads its choices\' labels', async (action, prefill, pick, label) => {
    const { controller } = await prefilled(action, prefill, false);
    expect(controller.lastError.value).toBeNull();
    expect(controller.getCollectedPick(pick)?.display).toBe(label);
  });

  it('reads a filled list by its entries\' labels', async () => {
    const { controller } = await prefilled('pickMany', {}, false);
    await controller.fill('many', ['x', 'y']);
    expect(controller.getCollectedPick('many')?.display).toBe('X, Y');
  });
});
