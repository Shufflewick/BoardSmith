/**
 * #219: the action controller refused JSON choice objects the engine accepts.
 *
 * Lacuna's operative actions offer choices like
 * `{ id: 'operative:1:1', name: 'Agent Null' }` with `display: spy => spy.name`,
 * so the id stays stable while the player sees the name. A custom UI reads the
 * offered choice out of its game view and submits it back -- and the value it
 * holds is a DESERIALIZED COPY, because object identity cannot survive the
 * wire. The controller compared by identity, so the browser answered
 * `Invalid selection for "spy"` for the same object the native runner applied
 * cleanly.
 *
 * Every submission below is round-tripped through JSON before it is offered to
 * the controller. A test that reuses the offered object proves nothing here:
 * it is the one case the old code got right.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { useActionController, type EnrichedActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.test-helper.js';
import { findMatchingChoice } from '../../engine/action/choice-matching.js';

const OPERATIVES = [
  { id: 'operative:1:1', name: 'Agent Null' },
  { id: 'operative:1:2', name: 'Agent Vex' },
];

function assignSpyMetadata(): Record<string, EnrichedActionMetadata> {
  return {
    assignSpy: {
      name: 'assignSpy',
      prompt: 'Assign an operative',
      selections: [
        {
          name: 'spy',
          type: 'choice',
          prompt: 'Which operative?',
          choices: OPERATIVES.map((spy) => ({ value: spy, display: spy.name })),
        },
        {
          name: 'task',
          type: 'choice',
          prompt: 'Which task?',
          choices: [
            { value: 'propaganda', display: 'Propaganda' },
            { value: 'sabotage', display: 'Sabotage' },
          ],
        },
      ],
    },
    assignSquad: {
      name: 'assignSquad',
      prompt: 'Assign operatives',
      selections: [
        {
          name: 'squad',
          type: 'choice',
          prompt: 'Which operatives?',
          multiSelect: { min: 1, max: 2 },
          choices: OPERATIVES.map((spy) => ({ value: spy, display: spy.name })),
        },
      ],
    },
    guardedSquad: {
      name: 'guardedSquad',
      prompt: 'Assign operatives',
      selections: [
        {
          name: 'squad',
          type: 'choice',
          prompt: 'Which operatives?',
          multiSelect: { min: 1, max: 2 },
          choices: [
            { value: OPERATIVES[0], display: 'Agent Null', disabled: 'Already deployed' },
            { value: OPERATIVES[1], display: 'Agent Vex' },
          ],
        },
      ],
    },
    orderSquad: {
      name: 'orderSquad',
      prompt: 'Order operatives',
      selections: [
        {
          name: 'order',
          type: 'choice',
          prompt: 'In what order?',
          orderedList: { min: 1, max: 3 },
          choices: OPERATIVES.map((spy) => ({ value: spy, display: spy.name })),
        },
      ],
    },
    guardedAssign: {
      name: 'guardedAssign',
      prompt: 'Assign an operative',
      selections: [
        {
          name: 'spy',
          type: 'choice',
          prompt: 'Which operative?',
          choices: [
            { value: OPERATIVES[0], display: 'Agent Null', disabled: 'Already deployed' },
            { value: OPERATIVES[1], display: 'Agent Vex' },
          ],
        },
      ],
    },
  };
}

/** What a custom UI actually holds: a copy, not the offered object. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('JSON-valued choices survive the wire (#219)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let controller: ReturnType<typeof useActionController>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    controller = useActionController({
      sendAction,
      availableActions: ref(['assignSpy', 'assignSquad', 'guardedSquad', 'orderSquad', 'guardedAssign']),
      actionMetadata: ref(assignSpyMetadata()),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });
  });

  it('execute() accepts a deserialized copy of an offered choice object', async () => {
    const result = await controller.execute('assignSpy', {
      spy: overTheWire(OPERATIVES[0]),
      task: 'propaganda',
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('fill() accepts a deserialized copy of an offered choice object', async () => {
    await controller.start('assignSpy');
    const result = await controller.fill('spy', overTheWire(OPERATIVES[1]));

    expect(result.valid).toBe(true);
    expect(controller.lastError.value).toBe(null);
  });

  it('accepts the id on its own, so ID shorthand still works', async () => {
    await controller.start('assignSpy');
    const result = await controller.fill('spy', 'operative:1:1');

    expect(result.valid).toBe(true);
  });

  it('accepts a multiSelect array of deserialized copies', async () => {
    const result = await controller.execute('assignSquad', {
      squad: overTheWire(OPERATIVES),
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('still refuses an object that names no offered choice', async () => {
    await controller.start('assignSpy');
    const result = await controller.fill('spy', { id: 'operative:9:9', name: 'Nobody' });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid selection');
  });

  it('still refuses a DISABLED choice submitted as a deserialized copy', async () => {
    await controller.start('guardedAssign');
    const result = await controller.fill('spy', overTheWire(OPERATIVES[0]));

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Already deployed');
  });
});

describe('findMatchingChoice is the one matcher both sides use (#219)', () => {
  const choices = OPERATIVES.map((spy) => ({ value: spy }));

  it('matches a structurally equal object', () => {
    expect(findMatchingChoice(overTheWire(OPERATIVES[0]), choices)?.value).toBe(OPERATIVES[0]);
  });

  it('matches a string id exactly and case-sensitively', () => {
    expect(findMatchingChoice('operative:1:2', choices)?.value).toBe(OPERATIVES[1]);
    expect(findMatchingChoice('OPERATIVE:1:2', choices)).toBeUndefined();
  });

  it('matches an object carrying only the identifying fields', () => {
    expect(findMatchingChoice({ id: 'operative:1:1' }, choices)?.value).toBe(OPERATIVES[0]);
  });

  it('refuses an ambiguous subset rather than guessing', () => {
    const ambiguous = [{ value: { team: 'red', n: 1 } }, { value: { team: 'red', n: 2 } }];
    expect(findMatchingChoice({ team: 'red' }, ambiguous)).toBeUndefined();
  });

  it('refuses a value that names nothing', () => {
    expect(findMatchingChoice({ id: 'operative:9:9' }, choices)).toBeUndefined();
  });
});

describe('the draft and prefills judge a pick value by the same rule as fill (#857)', () => {
  let sendAction: ReturnType<typeof createMockSendAction>;
  let controller: ReturnType<typeof useActionController>;

  beforeEach(() => {
    sendAction = createMockSendAction();
    controller = useActionController({
      sendAction,
      availableActions: ref(['assignSpy', 'assignSquad', 'guardedSquad', 'orderSquad', 'guardedAssign']),
      actionMetadata: ref(assignSpyMetadata()),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });
  });

  it('a second toggle of a copied object deselects it', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', overTheWire(OPERATIVES[0]));
    await controller.toggleMultiSelect('squad', overTheWire(OPERATIVES[0]));

    expect(controller.multiSelectDraft.value?.values).toEqual([]);
  });

  it('reports a copied object as selected while the draft holds it', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', overTheWire(OPERATIVES[1]));

    expect(controller.isMultiSelectSelected('squad', overTheWire(OPERATIVES[1]))).toBe(true);
  });

  it('applies a prefill holding a copied object, as fill does', async () => {
    await controller.start('assignSpy', { prefill: { spy: overTheWire(OPERATIVES[1]) } });

    expect(controller.lastError.value).toBe(null);
    expect(controller.currentArgs.value.spy).toEqual(OPERATIVES[1]);
    expect(controller.currentPick.value?.name).toBe('task');
  });

  it('refuses a prefill naming a disabled choice by shorthand, and says why', async () => {
    await controller.start('guardedAssign', { prefill: { spy: 'operative:1:1' } });

    expect(controller.lastError.value).toBe('Cannot prefill "Which operative?" with "operative:1:1": Already deployed.');
    expect(controller.currentArgs.value.spy).toBeUndefined();
    expect(controller.currentPick.value?.name).toBe('spy');
  });

  it('holds the offered value when a toggle names a choice by shorthand', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', 'Agent Vex');

    expect(controller.multiSelectDraft.value?.values).toEqual([OPERATIVES[1]]);
    expect(controller.isMultiSelectSelected('squad', OPERATIVES[1])).toBe(true);
  });

  it('refuses a toggle that names no offered choice, as fill does', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', 'Agent Nobody');

    expect(controller.multiSelectDraft.value).toBe(null);
    expect(controller.lastError.value).toBe('Invalid selection for "squad"');
  });

  it('reports a toggled item as selected by either shorthand', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', 'Agent Vex');

    expect(controller.isMultiSelectSelected('squad', 'Agent Vex')).toBe(true);
    expect(controller.isMultiSelectSelected('squad', 'operative:1:2')).toBe(true);
    expect(controller.isMultiSelectSelected('squad', 'Agent Null')).toBe(false);
  });

  it('removes an entry added as an object when toggled by its display text', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', overTheWire(OPERATIVES[1]));
    await controller.toggleMultiSelect('squad', 'Agent Vex');

    expect(controller.multiSelectDraft.value?.values).toEqual([]);
  });

  it('removes an entry added by display text when toggled by its id', async () => {
    await controller.start('assignSquad');
    await controller.toggleMultiSelect('squad', 'Agent Vex');
    await controller.toggleMultiSelect('squad', 'operative:1:2');

    expect(controller.multiSelectDraft.value?.values).toEqual([]);
  });

  it('refuses a toggle naming a disabled choice, and says why', async () => {
    await controller.start('guardedSquad');
    await controller.toggleMultiSelect('squad', 'Agent Null');

    expect(controller.multiSelectDraft.value).toBe(null);
    expect(controller.lastError.value).toBe('Selection disabled: Already deployed');
  });

  it('never refuses removing an entry whose choice was disabled after it was added', async () => {
    await controller.start('guardedSquad');
    await controller.toggleMultiSelect('squad', 'Agent Vex');
    const vex = controller.currentChoices.value.find((c) => c.display === 'Agent Vex')!;
    vex.disabled = 'Called away';

    await controller.toggleMultiSelect('squad', 'operative:1:2');

    expect(controller.multiSelectDraft.value?.values).toEqual([]);
    expect(controller.lastError.value).toBe(null);
  });

  it('holds the offered value when a list entry names a choice by shorthand', async () => {
    await controller.start('orderSquad');
    await controller.appendListEntry('order', 'operative:1:2');

    expect(controller.multiSelectDraft.value?.values).toEqual([OPERATIVES[1]]);
  });

  it('holds and labels the offered value when fill names a choice by its id', async () => {
    await controller.start('assignSpy');
    await controller.fill('spy', 'operative:1:2');

    expect(controller.currentArgs.value.spy).toEqual(OPERATIVES[1]);
    expect(controller.getCollectedPick('spy')?.display).toBe('Agent Vex');
  });

  it('sends the offered value when execute() names a choice by shorthand', async () => {
    await controller.execute('assignSpy', { spy: 'Agent Vex', task: 'propaganda' });

    expect(sendAction).toHaveBeenCalledWith('assignSpy', { spy: OPERATIVES[1], task: 'propaganda' });
  });
});

describe('every call that takes a pick value resolves it by the same rule (#857)', () => {
  const FRUIT = [{ id: 'a', name: 'Apple' }, { id: 'b', name: 'Banana' }];
  const fruitChoices = FRUIT.map((f) => ({ value: f, display: f.name }));

  function fruitController(selection: Partial<EnrichedActionMetadata['selections'][number]>) {
    const pickStep = vi.fn().mockResolvedValue({ success: true, done: false });
    const controller = useActionController({
      sendAction: createMockSendAction(),
      availableActions: ref(['eat']),
      actionMetadata: ref<Record<string, EnrichedActionMetadata>>({
        eat: {
          name: 'eat',
          prompt: 'Eat',
          selections: [
            { name: 'fruit', type: 'choice', prompt: 'Which fruit?', choices: fruitChoices, ...selection },
            { name: 'note', type: 'text', prompt: 'Note' },
          ],
        },
      }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      pickStep,
    });
    return { controller, pickStep };
  }

  it('sends a repeat pick the offered value and labels it as its button', async () => {
    const { controller, pickStep } = fruitController({ repeat: { hasOnEach: false } });
    pickStep.mockResolvedValueOnce({ success: true, done: false }).mockResolvedValueOnce({ success: true, done: true });

    await controller.start('eat');
    await controller.fill('fruit', 'a');
    await controller.fill('fruit', 'Banana');

    expect(pickStep.mock.calls.map((c) => c[2])).toEqual([FRUIT[0], FRUIT[1]]);
    expect(controller.getCollectedPick('fruit')).toEqual({ value: FRUIT, display: 'Apple, Banana', skipped: false });
  });

  it('sends an onSelect pick the offered value and labels it as its button', async () => {
    const { controller, pickStep } = fruitController({ hasOnSelect: true });

    await controller.start('eat');
    await controller.fill('fruit', 'b');

    expect(pickStep.mock.calls[0][2]).toEqual(FRUIT[1]);
    expect(controller.getCollectedPick('fruit')).toEqual({ value: FRUIT[1], display: 'Banana', skipped: false });
  });

  it('starts an action holding an arg as given, for the server to judge', async () => {
    const { controller } = fruitController({});

    await controller.start('eat', { args: { fruit: 'a' } });

    expect(controller.currentArgs.value.fruit).toBe('a');
    expect(controller.getCollectedPick('fruit')).toEqual({ value: 'a', display: 'a', skipped: false });
  });

  it('refuses to start an action with a list for a pick that takes one element, and says why', async () => {
    const { controller } = fruitController({ type: 'element' });

    const result = await controller.start('eat', { args: { fruit: [1, 2] } });

    const error = 'Selection "fruit" expects a single element, got an array of 2. '
      + 'Submit one element or element ID; use chooseElements for multi-element selections.';
    expect(result).toEqual({ success: false, error });
    expect(controller.lastError.value).toBe(error);
    expect(controller.currentAction.value).toBe(null);
  });
});

describe('execute() resolves against the choices of the action it runs (#857)', () => {
  const SCOUT_IN_A = { id: 'scout', name: 'Scout', onlyInA: true };
  const SCOUT_IN_B = { id: 'scout', name: 'Scout' };

  function twoActionTable(autoFill = false) {
    const sendAction = createMockSendAction();
    const target = (choices?: Array<{ value: unknown; display: string }>) =>
      [{ name: 'target', type: 'choice' as const, prompt: 'Which?', ...(choices && { choices }) }];
    const controller = useActionController({
      sendAction,
      availableActions: ref(['scoutA', 'scoutB', 'scoutC']),
      actionMetadata: ref<Record<string, EnrichedActionMetadata>>({
        // manual: with auto-fill on, scoutA's one fetched choice stays on offer instead of filling itself.
        scoutA: { name: 'scoutA', prompt: 'A', manual: true, selections: target() },
        scoutB: { name: 'scoutB', prompt: 'B', selections: target([{ value: SCOUT_IN_B, display: 'Scout' }]) },
        scoutC: { name: 'scoutC', prompt: 'C', selections: target() },
      }),
      fetchPickChoices: vi.fn(async () => ({ success: true, choices: [{ value: SCOUT_IN_A, display: 'Scout' }] })),
      isMyTurn: ref(true),
      autoFill,
      autoExecute: false,
    });
    return { controller, sendAction };
  }

  it("sends the executed action's own choice, not the open action's", async () => {
    const { controller, sendAction } = twoActionTable();
    await controller.start('scoutA');
    expect(controller.currentChoices.value[0]?.value).toEqual(SCOUT_IN_A);

    await controller.execute('scoutB', { target: 'Scout' });

    expect(sendAction).toHaveBeenCalledWith('scoutB', { target: SCOUT_IN_B });
  });

  it('leaves the value for the server when the executed action offers nothing here', async () => {
    const { controller, sendAction } = twoActionTable();
    await controller.start('scoutA');

    await controller.execute('scoutC', { target: 'Scout' });

    expect(sendAction).toHaveBeenCalledWith('scoutC', { target: 'Scout' });
  });

  it("auto-fills from the executed action's own choice, never the open action's", async () => {
    const { controller, sendAction } = twoActionTable(true);
    await controller.start('scoutA');
    expect(controller.currentChoices.value[0]?.value).toEqual(SCOUT_IN_A);

    await controller.execute('scoutB');
    expect(sendAction).toHaveBeenCalledWith('scoutB', { target: SCOUT_IN_B });

    const result = await controller.execute('scoutC');
    expect(result).toEqual({ success: false, error: 'Missing required selection: "target"' });
    expect(sendAction).not.toHaveBeenCalledWith('scoutC', expect.anything());
  });
});
