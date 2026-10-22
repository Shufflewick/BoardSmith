/**
 * #639: at phone width the open Debug panel is a full-width sheet.
 *
 * `.debug-panel` is `position: fixed` with `right: 0` and no `left`, so it
 * shrinks to its in-flow content, which is nothing: the drawer inside it is
 * absolutely positioned. On desktop the drawer has its own `width: 420px`, but
 * the phone sheet sizes itself to the panel (`left: 0; right: 0; width: 100%`),
 * so it came out 0px wide and only the tab content's padding (32px) showed, at
 * the right edge. The phone block must stretch the panel across the viewport.
 *
 * jsdom lays nothing out, so this holds the rule in the component's real
 * `<style scoped>` block, as ActionPanel.phone-fit.test.ts does; the layout
 * itself is checked in a browser.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS } from '../theme.js';

// Links the files this test reads by path, so `--changed` runs it when one alone changes; nothing loads (#1418).
import.meta.glob('./DebugPanel.vue');

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'DebugPanel.vue'),
  'utf-8',
);
const STYLE = SOURCE.slice(SOURCE.indexOf('<style scoped>'));

describe('#639: the Debug panel at phone width', () => {
  it('stretches the panel across the viewport so the sheet inside it is full width', () => {
    const query = `@media (max-width: ${BREAKPOINTS.compact - 1}px) {`;
    const at = STYLE.indexOf(query);
    expect(at, `DebugPanel.vue has no ${query} block`).toBeGreaterThan(-1);
    const block = STYLE.slice(at, STYLE.indexOf('\n}\n', at));
    const panelAt = block.indexOf('.debug-panel {');
    expect(panelAt, 'the phone block has no .debug-panel rule').toBeGreaterThan(-1);
    expect(block.slice(panelAt, block.indexOf('}', panelAt))).toMatch(/\bleft: 0;/);
  });
});
