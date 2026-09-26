// @vitest-environment jsdom
/**
 * #394: THE PANEL REFUSES WHAT THE ENGINE WOULD, BEFORE THE PLAYER SUBMITS IT.
 *
 * The engine now refuses control characters and unpaired surrogates, bounds a
 * field's stored bytes by `maxBytes`, and refuses a pattern mismatch with the
 * game's own sentence. The panel applies the same rules from the same module
 * (`text-rules.ts`) off what the wire carries, so the player reads the
 * engine's sentence before the round trip. The expected sentences are read out
 * of that module rather than spelled here, so a panel that grew its own
 * wording fails.
 */
import { describe, it, expect } from 'vitest';

import { mountPanelAt as panelAt, submitText as submit } from './action-panel-editor.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';
import { textRuleErrors } from '../../../engine/action/text-rules.js';

const shout: EnrichedActionMetadata = {
  name: 'shout',
  prompt: 'Shout',
  selections: [{ name: 'message', type: 'text', prompt: 'What to shout', maxLength: 200, maxBytes: 300 }],
};

const letter: EnrichedActionMetadata = {
  name: 'letter',
  prompt: 'Write a letter',
  selections: [{ name: 'body', type: 'text', prompt: 'Your letter', maxLength: 200, multiline: true }],
};

const handle: EnrichedActionMetadata = {
  name: 'handle',
  prompt: 'Pick a handle',
  selections: [
    {
      name: 'handle',
      type: 'text',
      prompt: 'Handle',
      maxLength: 20,
      pattern: { source: '^[a-z]+$', message: 'Use lowercase letters only.' },
    },
  ],
};

describe('the text editor refuses what cannot be stored (#394)', () => {
  it('refuses control characters with the engine sentence', async () => {
    const { wrapper, controller } = await panelAt(shout);
    await submit(wrapper, 'input[type="text"]', 'hi\u0001');
    expect(wrapper.find('.text-input .selection-error').text()).toBe(
      textRuleErrors('message', 'hi\u0001', { maxLength: 200 })[0],
    );
    expect(controller.currentArgs.value.message).toBeUndefined();
    wrapper.unmount();
  });

  it('refuses text over maxBytes with the engine sentence', async () => {
    const { wrapper, controller } = await panelAt(shout);
    const value = '🔥'.repeat(100);
    await submit(wrapper, 'input[type="text"]', value);
    expect(wrapper.find('.text-input .selection-error').text()).toBe(
      textRuleErrors('message', value, { maxLength: 200, maxBytes: 300 })[0],
    );
    expect(controller.currentArgs.value.message).toBeUndefined();
    wrapper.unmount();
  });

  it('accepts line breaks in a multiline field', async () => {
    const { wrapper, controller } = await panelAt(letter);
    await submit(wrapper, 'textarea', 'Dear Oak,\nthe well is dry.');
    expect(wrapper.find('.text-input .selection-error').exists()).toBe(false);
    expect(controller.currentArgs.value.body).toBe('Dear Oak,\nthe well is dry.');
    wrapper.unmount();
  });

  it("refuses a pattern mismatch with the game's own sentence", async () => {
    const { wrapper } = await panelAt(handle);
    await submit(wrapper, 'input[type="text"]', 'Bad1');
    expect(wrapper.find('.text-input .selection-error').text()).toBe('Use lowercase letters only.');
    wrapper.unmount();
  });
});
