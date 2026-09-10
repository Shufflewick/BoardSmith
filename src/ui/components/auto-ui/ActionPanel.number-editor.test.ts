// @vitest-environment jsdom
/**
 * #199: THE NUMBER AND TEXT EDITORS ARE SELECTIONS LIKE ANY OTHER.
 *
 * Every other pick the shared panel draws says WHAT IT IS ASKING FOR: a choice
 * pick, an element pick and a board hand-off all render `.selection-prompt`
 * with the selection's own prompt. The number and text editors rendered only a
 * bare range hint -- so "Waste to recycle" never reached the player, and the
 * hint was doing double duty as a label it is not.
 *
 * It was also SITTING ON the input: `.input-hint` was an inline span whose
 * vertical margin does not separate it from the block below, so the focus ring
 * -- a 4px box-shadow, not an outline, and therefore drawn OUTSIDE the border
 * box -- crossed it the moment the field took focus.
 *
 * A component test cannot see an overlap. What it can hold is everything the
 * fix rests on: the prompt is rendered, it is a real label bound to the input,
 * and the editor's own layout declares the vertical flow and the space the ring
 * needs -- so a future edit that flattens it back has to delete an assertion
 * that says why.
 */
import { describe, it, expect } from 'vitest';

import {
  mountPanelAt as panelAt,
  panelRuleFor as ruleFor,
} from './action-panel-editor.test-helper.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

const recycle: ActionMetadata = {
  name: 'recycle',
  prompt: 'Recycle waste',
  selections: [
    { name: 'waste', type: 'number', prompt: 'Waste to recycle', min: 1, integer: true },
  ],
};

const anyNumber: ActionMetadata = {
  name: 'wager',
  prompt: 'Place a wager',
  selections: [
    { name: 'amount', type: 'number', prompt: 'How much' },
  ],
};

const rename: ActionMetadata = {
  name: 'rename',
  prompt: 'Rename the colony',
  selections: [
    { name: 'title', type: 'text', prompt: 'What to call it', minLength: 1, maxLength: 24 },
  ],
};

describe('the number editor says what it is asking for (#199)', () => {
  it('renders the selection prompt, not just the range', async () => {
    const { wrapper } = await panelAt(recycle);
    expect(wrapper.find('.number-input .selection-prompt').text()).toContain('Waste to recycle');
    wrapper.unmount();
  });

  it('binds that prompt to the input as a real label', async () => {
    // A sighted player reads the line above the field; a screen reader reads
    // the field. Both have to hear the same sentence, and a `<span>` above an
    // input says nothing to the second.
    const { wrapper } = await panelAt(recycle);
    const input = wrapper.find('.number-input input');
    const label = wrapper.find('.number-input label');
    expect(label.exists()).toBe(true);
    expect(label.attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('id')).toBeTruthy();
    wrapper.unmount();
  });

  it('keeps the range hint, which is not a label but is still the rule', async () => {
    // CHANGED DELIBERATELY BY #234. This pinned `(1-?, integer)`, which is what
    // the panel really rendered for a pick with a floor and no ceiling -- and
    // #199 was about the prompt, so it pinned the copy it found rather than
    // endorsing it. A range with one end is not a range: it now states the
    // bound it has, in the wording `numberRangeHint` gives every number pick.
    const { wrapper } = await panelAt(recycle);
    const hint = wrapper.find('.number-input .input-hint').text();
    expect(hint).toBe('(at least 1, whole numbers)');
    expect(hint).not.toContain('?');
    wrapper.unmount();
  });

  it('draws no hint at all for a pick with no rule to state', async () => {
    // The hint is the rule. With no bound and no integer rule there is nothing
    // to say, and an empty pair of brackets says it worse than silence.
    const { wrapper } = await panelAt(anyNumber);
    expect(wrapper.find('.number-input .input-hint').exists()).toBe(false);
    wrapper.unmount();
  });

  it('the text editor gets the same treatment', async () => {
    const { wrapper } = await panelAt(rename);
    expect(wrapper.find('.text-input .selection-prompt').text()).toContain('What to call it');
    const input = wrapper.find('.text-input input');
    expect(wrapper.find('.text-input label').attributes('for')).toBe(input.attributes('id'));
    wrapper.unmount();
  });

  it('lays the editor out down the page, with room for the focus ring', async () => {
    // The ring is `box-shadow: 0 0 0 2px, 0 0 0 4px` (GameShell), so it is
    // drawn OUTSIDE the border box and no border-box margin can be relied on
    // to clear it. The editor states the column and the gap instead.
    for (const selector of ['.number-input', '.text-input']) {
      const rule = ruleFor(selector);
      expect(rule, `${selector} states its direction`).toMatch(/flex-direction:\s*column/);
      expect(rule, `${selector} states the space between its rows`).toMatch(/gap:\s*/);
    }
    // And the hint is a block in that column rather than an inline span leaning
    // on a vertical margin that does not apply to it.
    expect(ruleFor('.input-hint')).not.toMatch(/margin-bottom/);
  });
});
