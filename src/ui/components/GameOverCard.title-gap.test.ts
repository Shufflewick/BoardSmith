/**
 * #1061: the title must never run into the Close button, at any card width.
 *
 * The button sits in the card's top-right corner, over the card's padding, so
 * the title reserves the button's own size on both sides (both, to stay
 * centred). jsdom lays nothing out, so this holds the rule in the component's
 * `<style scoped>` block; the layout itself is checked in a browser.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Links the files this test reads by path, so `--changed` runs it when one alone changes; nothing loads (#1418).
import.meta.glob('./GameOverCard.vue');

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'GameOverCard.vue'),
  'utf-8',
);
const STYLE = SOURCE.slice(SOURCE.indexOf('<style scoped>'));

function rule(selector: string): string {
  const at = STYLE.indexOf(`\n${selector} {`);
  expect(at, `GameOverCard.vue has no ${selector} rule`).toBeGreaterThan(-1);
  return STYLE.slice(at, STYLE.indexOf('}', at));
}

describe('#1061: GameOverCard title clears the Close button', () => {
  it('sizes the Close button from one custom property', () => {
    const close = rule('.goc-close');
    expect(close).toMatch(/\bwidth: var\(--goc-close\);/);
    expect(close).toMatch(/\bheight: var\(--goc-close\);/);
  });

  it('pads the card sides from one custom property', () => {
    const card = rule('.game-over-card');
    expect(card).toMatch(/ --goc-pad-x: var\(--bsg-s5\);/);
    expect(card).toMatch(/\bpadding: var\(--bsg-s6\) var\(--goc-pad-x\);/);
  });

  it('pads the title inline by the button size, less that same card padding the button already covers', () => {
    expect(rule('.game-over-title')).toMatch(
      /\bpadding-inline: calc\(var\(--goc-close\) \+ var\(--bsg-s2\) - var\(--goc-pad-x\)\);/,
    );
  });

  it('lets a word too long for the reserved space break, so it never widens the title past the card into the button', () => {
    expect(rule('.game-over-title')).toMatch(/\boverflow-wrap: anywhere;/);
  });
});
