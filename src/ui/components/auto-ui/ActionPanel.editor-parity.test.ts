// @vitest-environment jsdom
/**
 * THE TWO EDITORS ARE ONE EDITOR, AND THIS IS WHAT SAYS SO (#237).
 *
 * The panel draws a typed field for exactly two picks, a number and a text, and
 * three times running a fix landed on one of them and not the other. #199 bound
 * the prompt to the field as a real label on both, then #229 gave the text
 * editor a hint the field actually points at and a refusal message the player
 * can read -- and left the number editor with a hint that is a line of text to a
 * sighted player and nothing at all to a screen reader, and a submit button that
 * moved and did nothing. #234 then had to fix the number hint's WORDING
 * separately, which is the same divergence again from the other end.
 *
 * The fix for that is structural: the label, the hint, the description list,
 * the invalid marking, the error and the submit are written ONCE and shared by
 * both controls, so there is no per-editor copy left to fix twice. This file is
 * the alarm on top of it. Every case below runs the same assertions against
 * both editors from one table, so a change that serves one kind and not the
 * other fails here rather than being found by a player a ticket later.
 *
 * The wording assertions do not spell the sentences out. They derive them from
 * the ENGINE's own rule modules, which is the other half of not forking: what
 * the panel refuses before submitting has to be what the server would answer
 * with, and a panel that grew its own copy of the wording would pass a literal
 * string and fail this.
 */
import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';

import { panelsOver } from './action-panel-editor.test-helper.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';
import { textRuleErrors } from '../../../engine/action/text-rules.js';
import { numberRuleErrors } from '../../../engine/action/number-rules.js';

const RECYCLE: ActionMetadata = {
  name: 'recycle',
  prompt: 'Recycle waste',
  selections: [
    { name: 'waste', type: 'number', prompt: 'Waste to recycle', min: 3, max: 9, integer: true },
  ],
};

const RENAME: ActionMetadata = {
  name: 'rename',
  prompt: 'Rename the colony',
  selections: [
    { name: 'title', type: 'text', prompt: 'What to call it', minLength: 4, maxLength: 12 },
  ],
};

/**
 * One editor, described in the terms the assertions below are written in.
 *
 * `refused` and `accepted` are values, `repaired` is what the player types on
 * their way to fixing the refused one, and `engineSentence` is the refusal the
 * ENGINE would produce for the same value -- read out of the shared rule module
 * rather than spelled out here, so a forked wording in the panel fails.
 */
type EditorCase = {
  kind: string;
  action: ActionMetadata;
  editor: string;
  control: string;
  hint: string;
  refused: string;
  repaired: string;
  accepted: string;
  submitted: unknown;
  engineSentence: string;
};

const CASES: EditorCase[] = [
  {
    kind: 'the number editor',
    action: RECYCLE,
    editor: '.number-input',
    control: 'input[type="number"]',
    hint: '(3 to 9, whole numbers)',
    refused: '1',
    repaired: '5',
    accepted: '5',
    submitted: 5,
    engineSentence: numberRuleErrors('waste', 1, { min: 3, max: 9, integer: true })[0]!,
  },
  {
    kind: 'the text editor',
    action: RENAME,
    editor: '.text-input',
    control: 'input[type="text"]',
    hint: '(4 to 12 characters)',
    refused: 'ab',
    repaired: 'abcdef',
    accepted: 'Hollow',
    submitted: 'Hollow',
    engineSentence: textRuleErrors('title', 'ab', { minLength: 4, maxLength: 12 })[0]!,
  },
];

/** The panel, mounted with the action already started at its editor. */
async function atEditor(action: ActionMetadata) {
  const over = panelsOver([action]);
  await over.controller.start(action.name, {});
  await nextTick();
  return { ...over, wrapper: await over.mountPanel() };
}

describe.each(CASES)('$kind describes its field to a screen reader (#237)', (c) => {
  it('states its rule where the field points at it', async () => {
    // The hint is the rule, and a rule the field does not point at is read by
    // nobody using a screen reader. This is #199's defect on the PROMPT, still
    // standing on the hint beside it.
    const { wrapper } = await atEditor(c.action);
    const hint = wrapper.find(`${c.editor} .input-hint`);
    expect(hint.text()).toBe(c.hint);
    const id = hint.attributes('id');
    expect(id).toBeTruthy();
    const control = wrapper.find(`${c.editor} ${c.control}`);
    expect(control.attributes('aria-describedby')?.split(/\s+/)).toContain(id);
    wrapper.unmount();
  });

  it('binds its prompt to the field as a real label', async () => {
    const { wrapper } = await atEditor(c.action);
    const control = wrapper.find(`${c.editor} ${c.control}`);
    expect(wrapper.find(`${c.editor} label`).attributes('for')).toBe(control.attributes('id'));
    expect(control.attributes('id')).toBeTruthy();
    wrapper.unmount();
  });
});

describe.each(CASES)('$kind says why a value was refused (#237)', (c) => {
  const submit = async (wrapper: Awaited<ReturnType<typeof atEditor>>['wrapper'], value: string) => {
    await wrapper.find(`${c.editor} ${c.control}`).setValue(value);
    await wrapper.find(`${c.editor} .done-button`).trigger('click');
    await nextTick();
  };

  it('shows the sentence the engine would have answered with', async () => {
    // Not a literal: the expectation is read out of the engine's own rule
    // module, so a panel that grew its own wording fails here.
    const { wrapper, controller } = await atEditor(c.action);
    await submit(wrapper, c.refused);
    const error = wrapper.find(`${c.editor} .selection-error`);
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe(c.engineSentence);
    expect(controller.currentArgs.value[c.action.selections![0]!.name]).toBeUndefined();
    wrapper.unmount();
  });

  it('announces it, marks the field invalid, and describes the field with it', async () => {
    const { wrapper } = await atEditor(c.action);
    await submit(wrapper, c.refused);
    const error = wrapper.find(`${c.editor} .selection-error`);
    expect(error.attributes('role')).toBe('alert');
    const control = wrapper.find(`${c.editor} ${c.control}`);
    expect(control.attributes('aria-describedby')?.split(/\s+/)).toContain(error.attributes('id'));
    expect(control.attributes('aria-invalid')).toBe('true');
    wrapper.unmount();
  });

  it('leaves the refused value in the field to be fixed', async () => {
    // A refusal that emptied the field would make the player type it again to
    // find out what was wrong with it.
    const { wrapper } = await atEditor(c.action);
    await submit(wrapper, c.refused);
    const control = wrapper.find(`${c.editor} ${c.control}`);
    expect((control.element as HTMLInputElement).value).toBe(c.refused);
    wrapper.unmount();
  });

  it('clears it as soon as the player starts fixing it', async () => {
    const { wrapper } = await atEditor(c.action);
    await submit(wrapper, c.refused);
    expect(wrapper.find(`${c.editor} .selection-error`).exists()).toBe(true);
    await wrapper.find(`${c.editor} ${c.control}`).setValue(c.repaired);
    await nextTick();
    expect(wrapper.find(`${c.editor} .selection-error`).exists()).toBe(false);
    expect(wrapper.find(`${c.editor} ${c.control}`).attributes('aria-invalid')).toBeUndefined();
    wrapper.unmount();
  });

  it('accepts a value the rules allow, and takes the editor away', async () => {
    const { wrapper, controller } = await atEditor(c.action);
    await submit(wrapper, c.accepted);
    expect(controller.currentArgs.value[c.action.selections![0]!.name]).toBe(c.submitted);
    expect(wrapper.find(`${c.editor} .selection-error`).exists()).toBe(false);
    wrapper.unmount();
  });
});

describe.each(CASES)('$kind keeps #235\'s distinction across an unmount', (c) => {
  it('gives the refused value back but not the refusal', async () => {
    // The value comes back because the player wrote it; the refusal does not,
    // because it is about a press they have not made in the panel now in front
    // of them. A refused value is still a draft, and the controller holds it.
    const { controller, mountPanel } = panelsOver([c.action]);
    await controller.start(c.action.name, {});

    const first = await mountPanel();
    await first.find(`${c.editor} ${c.control}`).setValue(c.refused);
    await first.find(`${c.editor} .done-button`).trigger('click');
    await nextTick();
    expect(first.find(`${c.editor} .selection-error`).exists()).toBe(true);
    first.unmount();

    const second = await mountPanel();
    const control = second.find(`${c.editor} ${c.control}`);
    expect((control.element as HTMLInputElement).value).toBe(c.refused);
    expect(second.find(`${c.editor} .selection-error`).exists()).toBe(false);
    expect(control.attributes('aria-invalid')).toBeUndefined();
    second.unmount();
  });
});
