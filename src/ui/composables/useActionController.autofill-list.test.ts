/**
 * #769: an auto-filled pick that takes a list is sent as a list.
 *
 * A chooseElements, multiSelect or ordered-list pick with one legal choice is
 * filled for the player. The engine refuses a bare value for these, so the
 * controller must wrap the lone choice in an array.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.test-helper.js';

const ONE = [{ value: 'x', display: 'X' }];

const metadata: Record<string, EnrichedActionMetadata> = {
  pickCards: {
    name: 'pickCards', prompt: 'Pick cards',
    selections: [{ name: 'cards', type: 'elements', prompt: 'Which?', validElements: [{ id: 7, display: 'Seven' }] }],
  },
  pickMany: {
    name: 'pickMany', prompt: 'Pick some',
    selections: [{ name: 'many', type: 'choice', prompt: 'Which?', choices: ONE, multiSelect: { min: 1, max: 2 } }],
  },
  pickOrder: {
    name: 'pickOrder', prompt: 'Order',
    selections: [{ name: 'order', type: 'choice', prompt: 'Which?', choices: ONE, orderedList: { min: 1, max: 2 } }],
  },
  pickNone: {
    name: 'pickNone', prompt: 'Allocate',
    selections: [{ name: 'none', type: 'choice', prompt: 'Which?', choices: ONE, multiSelect: { min: 0, max: 0 } }],
  },
  orderNone: {
    name: 'orderNone', prompt: 'Order none',
    selections: [{ name: 'none', type: 'choice', prompt: 'Which?', choices: ONE, orderedList: { min: 0, max: 0 } }],
  },
  pickTwo: {
    name: 'pickTwo', prompt: 'Pick two',
    selections: [{ name: 'two', type: 'choice', prompt: 'Which?', choices: ONE, multiSelect: { min: 2, max: 3 } }],
  },
  pickOne: {
    name: 'pickOne', prompt: 'Pick one',
    selections: [{ name: 'one', type: 'choice', prompt: 'Which?', choices: ONE }],
  },
};

async function autoFilled(action: string) {
  const sendAction = createMockSendAction();
  const controller = useActionController({
    sendAction,
    availableActions: ref(Object.keys(metadata)),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoFill: true,
    autoExecute: true,
  });
  await controller.start(action);
  await new Promise((r) => setTimeout(r, 0));
  return sendAction;
}

describe('auto-fill of a one-choice list pick (#769)', () => {
  it.each([
    ['pickCards', { cards: [7] }],
    ['pickMany', { many: ['x'] }],
    ['pickOrder', { order: ['x'] }],
    ['pickOne', { one: 'x' }],
  ])('%s sends %j', async (action, args) => {
    const sendAction = await autoFilled(action);
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0][1]).toEqual(args);
  });
});

describe('auto-fill of a list pick a list of one does not fit (#1562)', () => {
  it.each([
    ['pickNone', { none: [] }],
    ['orderNone', { none: [] }],
  ])('%s, whose max is 0, sends the empty list', async (action, args) => {
    const sendAction = await autoFilled(action);
    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0][1]).toEqual(args);
  });

  it('a pick of at least two is left to the player, not sent the one choice', async () => {
    const sendAction = await autoFilled('pickTwo');
    expect(sendAction).not.toHaveBeenCalled();
  });
});
