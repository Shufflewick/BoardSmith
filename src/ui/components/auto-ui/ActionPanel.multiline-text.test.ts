// @vitest-environment jsdom
/**
 * #229: A 1,000 CHARACTER DESCRIPTION NEEDS A BOX, NOT A LINE.
 *
 * Lacuna Expanse declares `enterText('description', { maxLength: 1000 })` and
 * the panel drew a 120px single-line input for it. Writing an empire
 * description in that is impractical and REVIEWING one is impossible: the
 * player can see about four words of what they wrote.
 *
 * The panel is not an optional surface -- it is the keyboard and screen-reader
 * path for every action, and a game's custom board is in addition to it. So the
 * textarea is not a nicety for the one game that asked; it is the only place a
 * screen-reader user can compose long text at all.
 *
 * WHAT THESE TESTS CAN AND CANNOT HOLD. They hold the markup, the copy, the
 * bindings, the branches and the values handed to the controller. They CANNOT
 * hold that the box is usable at a real size -- jsdom applies no stylesheet and
 * lays nothing out -- which is why this change was also driven in a real
 * browser (`scripts/multiline-text-browser.mjs`, which MEASURES the box). The
 * layout assertions below read the component's own style block through
 * `panelRuleFor`, so an edit that flattens the textarea back onto one line has
 * to delete an assertion that says why.
 */
import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import type { VueWrapper } from '@vue/test-utils';

import {
  mountPanelAt as panelAt,
  panelRuleFor as ruleFor,
} from './action-panel-editor.test-helper.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

/** Lacuna's own declaration, which is what the ticket is about. */
const setDescription: ActionMetadata = {
  name: 'setDescription',
  prompt: 'Describe your empire',
  selections: [
    {
      name: 'description',
      type: 'text',
      prompt: 'Empire description',
      maxLength: 1000,
      multiline: true,
    },
  ],
};

/** The same field with a floor, so the error path has something to report. */
const setCreed: ActionMetadata = {
  name: 'setCreed',
  prompt: 'Set your creed',
  selections: [
    {
      name: 'creed',
      type: 'text',
      prompt: 'Your creed',
      minLength: 20,
      maxLength: 200,
      multiline: true,
    },
  ],
};

const setNickname: ActionMetadata = {
  name: 'setNickname',
  prompt: 'Pick a nickname',
  selections: [
    { name: 'nickname', type: 'text', prompt: 'Your nickname', maxLength: 20 },
  ],
};

/** Type a value into the editor and press its submit button. */
async function submit(wrapper: VueWrapper, control: string, value: string) {
  await wrapper.find(`.text-input ${control}`).setValue(value);
  await wrapper.find('.text-input .done-button').trigger('click');
  await nextTick();
}

describe('the multiline text editor (#229)', () => {
  it('draws a textarea instead of a single-line input', async () => {
    const { wrapper } = await panelAt(setDescription);
    expect(wrapper.find('.text-input textarea').exists()).toBe(true);
    expect(wrapper.find('.text-input input[type="text"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('leaves a field that did not ask for it on one line', async () => {
    // The flag is opt-in. Every game that never heard of it keeps the field it
    // has, which is the whole reason this is an option and not a new kind.
    const { wrapper } = await panelAt(setNickname);
    expect(wrapper.find('.text-input input[type="text"]').exists()).toBe(true);
    expect(wrapper.find('.text-input textarea').exists()).toBe(false);
    wrapper.unmount();
  });

  it('binds the prompt to the textarea as a real label', async () => {
    const { wrapper } = await panelAt(setDescription);
    const area = wrapper.find('.text-input textarea');
    const label = wrapper.find('.text-input label');
    expect(label.text()).toContain('Empire description');
    expect(label.attributes('for')).toBe(area.attributes('id'));
    expect(area.attributes('id')).toBeTruthy();
    wrapper.unmount();
  });

  it('carries the engine bound onto the control, so the limit is real', async () => {
    const { wrapper } = await panelAt(setDescription);
    expect(wrapper.find('.text-input textarea').attributes('maxlength')).toBe('1000');
    wrapper.unmount();
  });

  it('states the maximum through the count, with no hint repeating it', async () => {
    // The reported bug was `(?-1000 chars)`. On a box the answer is not a fixed
    // hint at all: "0 of 1000 characters" already carries the ceiling and where
    // the player stands in it, and a hint beside it saying "up to 1000
    // characters" is the same fact twice -- costing a row of an action bar that
    // caps its height and scrolls, which is how the count went out of sight
    // while the line duplicating it stayed.
    const { wrapper } = await panelAt(setDescription);
    expect(wrapper.find('.text-input .input-hint').exists()).toBe(false);
    expect(wrapper.find('.text-input .char-count').text()).toBe('0 of 1000 characters');
    wrapper.unmount();
  });

  it('fixes that hint for the single-line field too', async () => {
    // Same code, same defect. Fixing one and leaving the other is how the two
    // representations of a text pick start disagreeing.
    const { wrapper } = await panelAt(setNickname);
    const hint = wrapper.find('.text-input .input-hint');
    expect(hint.text()).toContain('up to 20 characters');
    expect(hint.text()).not.toContain('?');
    wrapper.unmount();
  });

  it('still states a floor the count cannot express', async () => {
    // The one bound a character count says nothing about.
    const { wrapper } = await panelAt(setCreed);
    const hint = wrapper.find('.text-input .input-hint');
    expect(hint.text()).toContain('at least 20 characters');
    expect(hint.text()).not.toContain('?');
    expect(wrapper.find('.text-input .char-count').text()).toBe('0 of 200 characters');
    wrapper.unmount();
  });

  it('describes the field with its hint, so the rule is not sight-only', async () => {
    const { wrapper } = await panelAt(setCreed);
    const area = wrapper.find('.text-input textarea');
    const hintId = wrapper.find('.text-input .input-hint').attributes('id');
    expect(hintId).toBeTruthy();
    expect(area.attributes('aria-describedby')?.split(/\s+/)).toContain(hintId);
    wrapper.unmount();
  });

  it('counts characters, and describes the field with the count', async () => {
    const { wrapper } = await panelAt(setDescription);
    const area = wrapper.find('.text-input textarea');
    const count = wrapper.find('.text-input .char-count');
    expect(count.text()).toBe('0 of 1000 characters');
    await area.setValue('Ancient and long-lived.');
    expect(count.text()).toBe('23 of 1000 characters');
    // Above the submit button, inside the editor's own row: the bar scrolls
    // past its cap, and a count under the button is the one that gets cut off.
    const row = wrapper.find('.text-input .input-row');
    expect(row.element.querySelector('.char-count')).not.toBeNull();
    // In `aria-describedby` rather than a live region, so it is read when the
    // player arrives at the field instead of after every keystroke.
    expect(area.attributes('aria-describedby')?.split(/\s+/)).toContain(count.attributes('id'));
    wrapper.unmount();
  });

  it('announces the limit at the moment a keystroke stops working', async () => {
    // The one instant a sighted player sees and a screen-reader player does
    // not: the field silently refusing input. So the live region says exactly
    // this and nothing else -- a polite region that changed on every keystroke
    // would talk over the player for a thousand characters.
    const { wrapper } = await panelAt(setCreed);
    const area = wrapper.find('.text-input textarea');
    const live = wrapper.find('.text-input [role="status"]');
    expect(live.exists()).toBe(true);
    expect(live.text()).toBe('');
    await area.setValue('x'.repeat(200));
    expect(live.text()).toContain('200 character limit');
    await area.setValue('x'.repeat(199));
    expect(live.text()).toBe('');
    wrapper.unmount();
  });

  it('reports a value the rules refuse, instead of doing nothing', async () => {
    // Before this the submit handler returned silently on a short value: the
    // button moved and nothing happened, with no way to find out why.
    const { wrapper, controller } = await panelAt(setCreed);
    await submit(wrapper, 'textarea', 'Too short.');
    const error = wrapper.find('.text-input .selection-error');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('at least 20 characters');
    expect(controller.currentArgs.value.creed).toBeUndefined();
    wrapper.unmount();
  });

  it('associates that error with the field and marks it invalid', async () => {
    const { wrapper } = await panelAt(setCreed);
    await submit(wrapper, 'textarea', 'Too short.');
    const area = wrapper.find('.text-input textarea');
    const errorId = wrapper.find('.text-input .selection-error').attributes('id');
    expect(errorId).toBeTruthy();
    expect(area.attributes('aria-describedby')?.split(/\s+/)).toContain(errorId);
    expect(area.attributes('aria-invalid')).toBe('true');
    expect(wrapper.find('.text-input .selection-error').attributes('role')).toBe('alert');
    wrapper.unmount();
  });

  it('clears the error as soon as the player starts fixing it', async () => {
    const { wrapper } = await panelAt(setCreed);
    await submit(wrapper, 'textarea', 'Too short.');
    expect(wrapper.find('.text-input .selection-error').exists()).toBe(true);
    const area = wrapper.find('.text-input textarea');
    await area.setValue('Too short, but getting longer now.');
    expect(wrapper.find('.text-input .selection-error').exists()).toBe(false);
    expect(area.attributes('aria-invalid')).toBeUndefined();
    wrapper.unmount();
  });

  it('reports a refused single-line value the same way', async () => {
    // One submit path, one error path. The single-line field silently returned
    // for the same reason, and it is the same handler.
    const short: ActionMetadata = {
      name: 'setTag',
      prompt: 'Tag it',
      selections: [
        { name: 'tag', type: 'text', prompt: 'Tag', minLength: 4, maxLength: 8 },
      ],
    };
    const { wrapper } = await panelAt(short);
    await submit(wrapper, 'input[type="text"]', 'ab');
    expect(wrapper.find('.text-input .selection-error').text()).toContain('at least 4 characters');
    wrapper.unmount();
  });

  it('lets Enter insert a newline rather than submitting', async () => {
    // A textarea whose Enter submits cannot be used to write a paragraph. The
    // submit button is the only way out, which is the ticket's own wording.
    const { wrapper, controller } = await panelAt(setDescription);
    const area = wrapper.find('.text-input textarea');
    await area.setValue('First line.');
    await area.trigger('keyup', { key: 'Enter' });
    await area.trigger('keydown', { key: 'Enter' });
    await nextTick();
    expect(controller.currentArgs.value.description).toBeUndefined();
    wrapper.unmount();
  });

  it('preserves the line breaks in the value it submits', async () => {
    const { wrapper, controller } = await panelAt(setDescription);
    const written = 'The first age.\n\nThe second age.\nAnd after that, nothing.';
    await submit(wrapper, 'textarea', written);
    expect(controller.currentArgs.value.description).toBe(written);
    wrapper.unmount();
  });

  it('declares a box with room to write in and a handle to resize it', () => {
    // jsdom lays nothing out, so what a component test can hold is what the
    // file DECLARES. A textarea inheriting the single-line field's `width:
    // 120px` is the failure this is here to catch.
    const rule = ruleFor('.text-input textarea');
    expect(rule, 'the box is as wide as the editor').toMatch(/width:\s*100%/);
    expect(rule, 'the box is more than one line tall').toMatch(/min-height:\s*/);
    expect(rule, 'the player can make it taller').toMatch(/resize:\s*vertical/);
    // The box takes a whole flex line of a wrapping row, so the count and the
    // submit button share the next one. One row for the two of them is what
    // keeps the editor inside the action bar's own height cap.
    expect(rule, 'the box claims a whole flex line').toMatch(/flex:\s*1 1 100%/);
    expect(ruleFor('.text-input-multiline .input-row')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('gives the editor a whole row of the action bar to sit in', () => {
    // The bar is a wrapping flex row and ActionPanel's own wrappers are
    // `display: contents`, so this box is itself a bar item sitting between the
    // ⋯ menu and the player token. Nothing but its own flex basis can make it
    // take the row, and without the row the `width: 100%` above resolves
    // against a shrink-wrapped item.
    expect(ruleFor('.text-input-multiline')).toMatch(/flex:\s*1 1 100%/);
  });
});

/**
 * A DEFECT THE BROWSER FOUND, AND THE ERROR MESSAGE MADE VISIBLE (#229).
 *
 * `textInputValue` and `numberInputValue` are one ref each for the whole panel,
 * and nothing reset them. `submitTextInput` cleared on a successful submit; every
 * other way out of a pick -- cancelling, a refusal, stepping to the next
 * selection -- left the typed value behind. So the next text pick opened
 * prefilled with what the player had typed into a different field of a
 * different action, and a shorter field opened already refusing its own
 * contents.
 *
 * It was invisible while a refused submit did nothing at all. It is not
 * invisible now, which is the argument for fixing it here rather than filing it.
 */
describe('an editor opens empty on a new pick', () => {
  const twoFields: ActionMetadata = {
    name: 'describeThenName',
    prompt: 'Describe, then name',
    selections: [
      { name: 'description', type: 'text', prompt: 'Description', maxLength: 200, multiline: true },
      { name: 'nickname', type: 'text', prompt: 'Nickname', maxLength: 20 },
    ],
  };

  it('does not carry the last field\'s text into the next one', async () => {
    const { wrapper } = await panelAt(twoFields);
    await submit(wrapper, 'textarea', 'A long description, well over twenty characters.');
    await nextTick();
    const input = wrapper.find('.text-input input[type="text"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });

  it('does not carry a standing error into the next one either', async () => {
    const floored: ActionMetadata = {
      name: 'creedThenName',
      prompt: 'Creed, then name',
      selections: [
        { name: 'creed', type: 'text', prompt: 'Creed', minLength: 20, maxLength: 200, multiline: true },
        { name: 'nickname', type: 'text', prompt: 'Nickname', maxLength: 20 },
      ],
    };
    const { wrapper } = await panelAt(floored);
    await submit(wrapper, 'textarea', 'Too short.');
    expect(wrapper.find('.text-input .selection-error').exists()).toBe(true);
    await submit(wrapper, 'textarea', 'Long enough to be accepted by the rules.');
    await nextTick();
    expect(wrapper.find('.text-input .selection-error').exists()).toBe(false);
    wrapper.unmount();
  });
});
