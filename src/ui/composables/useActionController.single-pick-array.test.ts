/**
 * #661: the controller's client check treated any array as a multiSelect.
 *
 * A chooseFrom that takes one choice was checked item by item whenever a custom
 * UI submitted an array, so a list of its choices passed the client and was
 * sent (the engine refuses it since #660), while a choice whose VALUE is an
 * array was refused on the client and accepted by the engine. The client now
 * applies the engine's own rule and message: item by item only for a
 * multiSelect or ordered list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.test-helper.js';

const LETTERS = [
  { value: 'x', display: 'X' },
  { value: 'y', display: 'Y' },
];

function metadata(): Record<string, EnrichedActionMetadata> {
  return {
    pickOne: {
      name: 'pickOne',
      prompt: 'Pick one',
      selections: [{ name: 'b', type: 'choice', prompt: 'Which?', choices: LETTERS }],
    },
    pickPair: {
      name: 'pickPair',
      prompt: 'Pick a pair',
      selections: [{
        name: 'pair',
        type: 'choice',
        prompt: 'Which pair?',
        choices: [
          { value: ['x', 'y'], display: 'X and Y' },
          { value: ['z'], display: 'Z' },
        ],
      }],
    },
    pickMany: {
      name: 'pickMany',
      prompt: 'Pick some',
      selections: [{
        name: 'many', type: 'choice', prompt: 'Which?', choices: LETTERS, multiSelect: { min: 1, max: 2 },
      }],
    },
    pickOrder: {
      name: 'pickOrder',
      prompt: 'Order them',
      selections: [{
        name: 'order', type: 'choice', prompt: 'Which order?', choices: LETTERS, orderedList: { min: 1, max: 2 },
      }],
    },
  };
}

const LIST_REFUSAL = 'Selection "b" takes one choice, got a list of 2. Submit one of its choices.';

describe('a one-choice pick on the client (#661)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let controller: ReturnType<typeof useActionController>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    controller = useActionController({
      sendAction,
      availableActions: ref(['pickOne', 'pickPair', 'pickMany', 'pickOrder']),
      actionMetadata: ref(metadata()),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });
  });

  it('fill() refuses a list of its choices with the engine\'s message', async () => {
    await controller.start('pickOne');
    const result = await controller.fill('b', ['x', 'y']);

    expect(result.valid).toBe(false);
    expect(result.error).toBe(LIST_REFUSAL);
    expect(controller.lastError.value).toBe(LIST_REFUSAL);
  });

  it('execute() refuses a list of its choices before sending', async () => {
    const result = await controller.execute('pickOne', { b: ['x', 'y'] });

    expect(result.success).toBe(false);
    expect(result.error).toBe(LIST_REFUSAL);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('fill() and execute() accept a choice whose value is an array', async () => {
    await controller.start('pickPair');
    expect((await controller.fill('pair', ['x', 'y'])).valid).toBe(true);
    controller.cancel();

    const result = await controller.execute('pickPair', { pair: ['z'] });
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('refuses an array naming no offered array choice as a stale choice', async () => {
    await controller.start('pickPair');
    const result = await controller.fill('pair', ['q']);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid selection for "pair"');
  });

  it('still checks a multiSelect array item by item', async () => {
    expect((await controller.execute('pickMany', { many: ['x', 'y'] })).success).toBe(true);
    const bad = await controller.execute('pickMany', { many: ['x', 'q'] });
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('Invalid selection for "many"');
  });

  it('still checks an ordered list item by item', async () => {
    expect((await controller.execute('pickOrder', { order: ['y', 'x'] })).success).toBe(true);
    const bad = await controller.execute('pickOrder', { order: ['q'] });
    expect(bad.success).toBe(false);
    expect(bad.error).toBe('Invalid selection for "order"');
  });
});
