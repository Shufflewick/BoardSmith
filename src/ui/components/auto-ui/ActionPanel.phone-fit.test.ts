// @vitest-environment jsdom
/**
 * #444: at phone width the open Action Panel fits the two rows the shell
 * reserves for it.
 *
 * The case from the issue: a pick handed to the board after an earlier choice.
 * The panel shows the action's name and its cancel, the chosen item's chip, the
 * prompt and "Choose on the board". Laid out as one sentence that was four rows
 * at 375px and covered the bottom of the board. At phone width it is two:
 *
 *   row 1  [⋯] [seat]  [ action name  ✕ ]   <- the action's context, stacked
 *                      [ chosen item ✕ ]
 *   row 2  [ prompt, up to two lines ] [ Choose on  ]
 *                                      [ the board ]
 *
 * jsdom lays nothing out, so the arithmetic is held in a real browser (see the
 * issue's reproduction). What is held here: the DOM grouping the stacked
 * context needs, without changing the reading order, and the phone-width rules
 * in the component's real `<style scoped>` block, as
 * GameShell.panel-footprint.test.ts does for the shell.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS } from '../../theme.js';
import { stubActionController, mountPanel } from './action-panel-controller.test-helper.js';

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ActionPanel.vue'),
  'utf-8',
);
const STYLE = SOURCE.slice(SOURCE.indexOf('<style scoped>'));

/** The shell's short-landscape tier, where the strip is ONE row (PlayShell). */
const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 600px)';

/**
 * The compact media block of the panel's stylesheet: phone width, and short
 * landscape screens (#486), one block so the two cannot drift apart.
 */
function phoneBlock(): string {
  const query = `@media (max-width: ${BREAKPOINTS.compact - 1}px), ${SHORT_LANDSCAPE} {`;
  const at = STYLE.indexOf(query);
  expect(at, `ActionPanel.vue has no ${query} block`).toBeGreaterThan(-1);
  return STYLE.slice(at, STYLE.indexOf('\n}\n', at));
}

/** The declarations of `selector` inside `css` (first block for it). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} { … } not found`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

/** The base (outside any media query) rule for `selector`. */
function baseRule(selector: string): string {
  return rule(STYLE, `\n${selector}`);
}

function mountHandoffAfterChoice() {
  const controller = stubActionController({
    currentAction: ref('placePack'),
    actionSnapshot: ref({ actionName: 'placePack', metadata: { prompt: 'Buy and place a pack' } }),
    currentArgs: ref({ unit: 'Scuttlers' }),
    currentPick: ref({ name: 'space', type: 'element', prompt: 'Choose where the middle of the front row goes' }),
    validElements: ref(
      Array.from({ length: 50 }, (_, i) => ({
        id: i,
        display: `s${i}`,
        refs: [{ role: 'target' as const, ref: { id: i, notation: `n${i}` } }],
      })),
    ),
  });
  return mountPanel(controller);
}

describe('#444: the open Action Panel fits the reserved strip at phone width', () => {
  it("groups the action's name, its cancel and the chosen items into one context, in reading order", () => {
    const wrapper = mountHandoffAfterChoice();
    const context = wrapper.find('.config-context');
    expect(context.exists()).toBe(true);

    const order = Array.from(
      context.element.querySelectorAll('.config-title, .cancel-btn, .selected-value'),
      (el) => el.className.split(' ')[0],
    );
    expect(order).toEqual(['config-title', 'cancel-btn', 'selected-value']);

    // The question and its control follow the context; they are not part of it.
    expect(context.find('.selection-prompt').exists()).toBe(false);
    expect(context.find('.board-handoff-btn').exists()).toBe(false);
    const panelText = wrapper.text();
    expect(panelText.indexOf('Scuttlers')).toBeLessThan(panelText.indexOf('Choose where'));
    expect(panelText.indexOf('Choose where')).toBeLessThan(panelText.indexOf('Choose on the board'));
  });

  it('keeps the one-sentence flow above phone width: the new grouping lays out as nothing', () => {
    expect(baseRule('.config-context')).toMatch(/display:\s*contents;/);
    expect(baseRule('.config-header')).toMatch(/display:\s*contents;/);
  });

  it('stacks the context into one control row at phone width', () => {
    const phone = phoneBlock();
    const context = rule(phone, '.config-context');
    expect(context).toMatch(/display:\s*flex;/);
    expect(context).toMatch(/flex-direction:\s*column;/);
    expect(rule(phone, '.config-header')).toMatch(/display:\s*flex;/);
  });

  it('lets the prompt and the board handoff wrap so they share the second row', () => {
    const phone = phoneBlock();
    // The prompt is `nowrap` in the sentence flow; on a phone that alone took a row.
    expect(baseRule('.selection-prompt')).toMatch(/white-space:\s*nowrap;/);
    // Only the prompt that sits in the bar's row: an editor's label is the same
    // class in a COLUMN, where a flex basis is a height (it laid out 144px tall).
    expect(phone).not.toMatch(/(^|\n)\s*\.selection-prompt \{/);
    expect(rule(phone, '.selection-input > .selection-prompt')).toMatch(/white-space:\s*normal;/);
    const handoff = rule(phone, '.board-handoff-btn');
    expect(handoff).toMatch(/white-space:\s*normal;/);
    expect(handoff).toMatch(/max-width:/);
  });
});

describe('#444: the action buttons fit two rows at phone width', () => {
  it('compacts the action buttons, keeping the 44px touch target', () => {
    const btn = rule(phoneBlock(), '.action-btn');
    expect(btn).toMatch(/padding:/);
    expect(btn).not.toMatch(/min-height/);
    expect(baseRule('.action-btn')).toMatch(/min-height:\s*44px;/);
  });
});

describe('#486: a short landscape screen gets the same compact layout', () => {
  it('applies the compact block where the strip is one row, so a pick after a choice fits it', () => {
    // At 844x390 the sentence flow put "Choose on the board" on a second row of
    // a one-row strip, and the bar scrolled. The stacked context and the
    // wrapping prompt and handoff are what make it one row.
    const block = phoneBlock();
    expect(rule(block, '.config-context')).toMatch(/flex-direction:\s*column;/);
    expect(rule(block, '.board-handoff-btn')).toMatch(/white-space:\s*normal;/);
  });

  it('never cuts the prompt short: it carries rules text the player must read', () => {
    const prompt = rule(phoneBlock(), '.selection-input > .selection-prompt');
    expect(prompt).not.toMatch(/text-overflow|overflow:\s*hidden|line-clamp/);
  });
});
