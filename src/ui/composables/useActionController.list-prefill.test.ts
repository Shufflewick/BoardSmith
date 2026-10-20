/**
 * #964: a pick that takes a list (chooseElements, multiSelect, ordered list)
 * can be prefilled with an array, each entry matched against the choices.
 */
import { describe, it, expect, vi } from 'vitest';
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

describe('a prefill the pick refuses, said in the pick\'s own words (#1298)', () => {
  it('names the entry that matched nothing', async () => {
    const { controller } = await prefilled('pickMany', { many: ['nope', 'x'] });
    expect(controller.lastError.value).toMatch(/"nope"/);
  });

  it.each([
    ['pickMany', { many: [] }, /at least 1/],
    ['pickOrder', { order: ['x', 'y', 'x', 'y'] }, /at most 3/],
    ['pickMany', { many: ['x', 'x'] }, /more than once/],
  ])('%s refuses %j by its count or its repeats', async (action, prefill, said) => {
    const { sendAction, controller } = await prefilled(action, prefill);
    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toMatch(said);
  });

  it("keeps a refusal's own sentence for a list given to a one-value pick", async () => {
    const { controller } = await prefilled('pickOne', { one: ['x'] });
    expect(controller.lastError.value).toMatch(/^Cannot prefill "Which one\?": .*takes one/);
  });

  it('says a whole choice was given where its value was meant', async () => {
    const { controller } = await prefilled('pickOne', { one: { value: 'x', display: 'X' } });
    expect(controller.lastError.value).toMatch(/Did you mean to pass choice\.value/);
  });
});

describe('a list fill the pick refuses by its count or its repeats (#1298)', () => {
  it('refuses a repeated entry in a set', async () => {
    const { controller } = await prefilled('pickMany', {}, false);
    const result = await controller.fill('many', ['x', 'x']);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/more than once/);
  });
});

describe('a prefill of a pick the server takes step by step (#1298)', () => {
  it("goes to the server's step, as a fill of it does, so its onSelect runs there", async () => {
    const hooked: Record<string, EnrichedActionMetadata> = {
      pickHooked: {
        name: 'pickHooked', prompt: 'Hooked',
        selections: [{ name: 'hooked', type: 'choice', prompt: 'Which hook?', choices: XYZ, hasOnSelect: true }],
      },
    };
    const pickStep = vi.fn(async () => ({ success: true, actionComplete: true }));
    const controller = useActionController({
      sendAction: createMockSendAction(),
      availableActions: ref(Object.keys(hooked)),
      actionMetadata: ref(hooked),
      isMyTurn: ref(true),
      playerSeat: ref(1),
      pickStep,
    });

    await controller.start('pickHooked', { prefill: { hooked: 'x' } });
    for (let i = 0; i < 10; i++) await nextTick();

    expect(controller.lastError.value).toBeNull();
    expect(pickStep).toHaveBeenCalledWith(1, 'hooked', 'x', 'pickHooked', expect.anything());
  });
});

describe('a prefill queued for a later pick (#1298)', () => {
  it('is not overridden by auto-filling that pick when the one before it is filled', async () => {
    const twoPicks: Record<string, EnrichedActionMetadata> = {
      pickTwo: {
        name: 'pickTwo', prompt: 'Pick two',
        selections: [
          { name: 'first', type: 'choice', prompt: 'First?', choices: XYZ.slice(0, 2) },
          { name: 'second', type: 'choice', prompt: 'Second?', choices: [XYZ[0], XYZ[2]] },
        ],
      },
    };
    const sendAction = createMockSendAction();
    const controller = useActionController({
      sendAction, availableActions: ref(['pickTwo']), actionMetadata: ref(twoPicks), isMyTurn: ref(true),
    });
    await controller.start('pickTwo', { prefill: { second: 'z' } });

    await controller.fill('first', 'y');
    for (let i = 0; i < 10; i++) await nextTick();

    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.lastError.value).toBe('Cannot prefill "Second?" with "Z": Z is spent.');
  });
});
