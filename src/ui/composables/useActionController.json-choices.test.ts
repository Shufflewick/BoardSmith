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

import { describe, it, expect, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useActionController, type ActionMetadata } from './useActionController.js';
import { createMockSendAction } from './useActionController.helpers.js';
import { findMatchingChoice } from '../../engine/action/choice-matching.js';

const OPERATIVES = [
  { id: 'operative:1:1', name: 'Agent Null' },
  { id: 'operative:1:2', name: 'Agent Vex' },
];

function assignSpyMetadata(): Record<string, ActionMetadata> {
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
      availableActions: ref(['assignSpy', 'assignSquad', 'guardedAssign']),
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
