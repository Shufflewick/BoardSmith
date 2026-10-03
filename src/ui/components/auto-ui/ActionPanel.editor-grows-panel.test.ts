// @vitest-environment jsdom
/**
 * The one exception to the Action Panel's two-row cap (issue 444, ruled for
 * the #229 / #237 typed editors).
 *
 * The bar is capped at the strip the board region reserves, so it never covers
 * the board. A multi-line text box cannot be written in two rows: it needs six
 * rows of text plus its count and submit. So WHILE that editor is open, and
 * only then, the bar may grow past the strip and cover part of the board. The
 * board never refits (the reservation does not change), and the cap comes back
 * the moment the editor closes.
 *
 * The editor marks itself (`data-bs-grows-panel`) and the shell's bar lifts its
 * cap for a bar that contains the mark (`:has(...)`). So the exception lives
 * exactly as long as the editor's DOM does: closing it by submitting, cancelling
 * or putting the bar down all unmount it. Held here: the mark appears with the
 * multi-line editor and nothing else, and leaves with it. The CSS that reads it
 * is held against PlayShell's real stylesheet; jsdom applies no styles.
 */
import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountPanelAt, submitText } from './action-panel-editor.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';

const MARK = '[data-bs-grows-panel]';

const setDescription: EnrichedActionMetadata = {
  name: 'setDescription',
  prompt: 'Describe your empire',
  selections: [
    { name: 'description', type: 'text', prompt: 'Empire description', maxLength: 1000, multiline: true },
  ],
};

const setNickname: EnrichedActionMetadata = {
  name: 'setNickname',
  prompt: 'Pick a nickname',
  selections: [{ name: 'nickname', type: 'text', prompt: 'Your nickname', maxLength: 20 }],
};

const setTithe: EnrichedActionMetadata = {
  name: 'setTithe',
  prompt: 'Set your tithe',
  selections: [{ name: 'tithe', type: 'number', prompt: 'Tithe', min: 0, max: 10 }],
};

describe('a multi-line text editor may grow the panel past the strip, and only while it is open', () => {
  it('marks the open multi-line editor', async () => {
    const { wrapper } = await mountPanelAt(setDescription);
    const marked = wrapper.findAll(MARK);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.find('textarea').exists()).toBe(true);
    wrapper.unmount();
  });

  it('does not mark a one-line text field or a number field', async () => {
    for (const action of [setNickname, setTithe]) {
      const { wrapper } = await mountPanelAt(action);
      expect(wrapper.find('.text-input, .number-input').exists(), action.name).toBe(true);
      expect(wrapper.find(MARK).exists(), action.name).toBe(false);
      wrapper.unmount();
    }
  });

  it('drops the mark when the editor is cancelled', async () => {
    const { wrapper } = await mountPanelAt(setDescription);
    expect(wrapper.find(MARK).exists()).toBe(true);
    await wrapper.find('.cancel-btn').trigger('click');
    await nextTick();
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find(MARK).exists()).toBe(false);
    wrapper.unmount();
  });

  it('drops the mark when the text is submitted', async () => {
    const { wrapper, controller } = await mountPanelAt(setDescription);
    expect(wrapper.find(MARK).exists()).toBe(true);
    await submitText(wrapper, 'textarea', 'Ancient and long-lived.');
    await vi_flush();
    expect(controller.currentArgs.value.description).toBe('Ancient and long-lived.');
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.find(MARK).exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("the shell's bar lifts its cap for the marked editor, and for nothing else", () => {
  const shell = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'PlayShell.vue'),
    'utf-8',
  );
  const style = shell.slice(shell.indexOf('<style scoped>'));

  /** The body of the rule whose selector is exactly `selector`. */
  function rule(selector: string): string {
    const at = style.indexOf(`\n${selector} {`);
    expect(at, `${selector} { … } not found in PlayShell.vue`).toBeGreaterThan(-1);
    return style.slice(at, style.indexOf('\n}', at));
  }

  it('keeps the strip as the cap everywhere else', () => {
    expect(rule('.actionbar')).toMatch(/max-height:\s*var\(--bsg-panel-reserved\);/);
  });

  it('caps a bar holding the marked editor at the editor ceiling, never below the strip', () => {
    const lifted = rule(`.actionbar:has(${MARK})`);
    expect(lifted).toMatch(
      /max-height:\s*max\(var\(--bsg-panel-reserved\),\s*var\(--bsg-panel-editor-max\)\);/,
    );
  });

  it('sizes the editor ceiling to what the editor needs, bounded by the screen', () => {
    // Not a fixed five rows: on a short landscape screen five rows is more than
    // the screen, and on a phone it was less than the editor, so its submit and
    // count sat below the bar's visible edge.
    const tokens = rule('.game-shell__game');
    const editorMax = tokens.match(/--bsg-panel-editor-max\s*:\s*([^;]+);/)?.[1] ?? '';
    expect(editorMax).toContain('var(--bsg-editor-chrome)');
    expect(editorMax).toContain('var(--bsg-editor-text-rest)');
    expect(editorMax).toMatch(/^min\(/);
    expect(editorMax).toContain('60dvh');
    expect(tokens).toMatch(/--bsg-editor-chrome\s*:/);
    expect(tokens).toMatch(/--bsg-editor-text-rest\s*:/);
    // One definition, for every tier: no media query restates the ceiling.
    expect(style.match(/--bsg-panel-editor-max\s*:/g)).toHaveLength(1);
  });

  it('never moves the board: nothing about the region changes with the editor', () => {
    // The reservation is the region's padding and nothing else sets it; no rule
    // keyed on the mark reaches the board region or the reservation token.
    const lifted = rule(`.actionbar:has(${MARK})`);
    expect(lifted).not.toMatch(/--bsg-panel-reserved\s*:/);
    expect(style).not.toMatch(/boardregion[^{]*\[data-bs-grows-panel\]/);
    expect(style).not.toMatch(/:has\(\[data-bs-grows-panel\]\)[^{]*boardregion/);
  });
});

/** Let the controller's async submit settle. */
async function vi_flush() {
  for (let i = 0; i < 5; i++) await nextTick();
}

describe('the box gives way so the action, prompt, count and submit always fit', () => {
  const panel = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ActionPanel.vue'),
    'utf-8',
  );
  const style = panel.slice(panel.indexOf('<style scoped>'));
  const textarea = style.slice(style.indexOf('\n.text-input textarea {'), style.indexOf('\n}', style.indexOf('\n.text-input textarea {')));

  it('rests at the height the shell budgets for it', () => {
    expect(textarea).toMatch(/height:\s*var\(--bsg-editor-text-rest\);/);
  });

  it('cannot grow, even by dragging, past what the ceiling leaves it', () => {
    expect(textarea).toMatch(/resize:\s*vertical;/);
    expect(textarea).toMatch(
      /max-height:\s*calc\(var\(--bsg-panel-editor-max\)\s*-\s*var\(--bsg-editor-chrome\)\);/,
    );
  });

  it('may shrink below its resting height when the screen is short', () => {
    expect(textarea).toMatch(/min-height:\s*min\(/);
    expect(textarea).toMatch(/min-height:[^;]*var\(--bsg-panel-editor-max\)\s*-\s*var\(--bsg-editor-chrome\)/);
  });
});
