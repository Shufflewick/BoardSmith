// @vitest-environment jsdom
/**
 * PlayerToken emphasis ring — it must be the TOKEN'S shape, not a circle.
 *
 * The regression this guards (B15): the action bar drew the viewer's "you"
 * indicator with a caller-side `border-radius: 50%` outline. The token's shape
 * is chosen per seat from eight silhouettes, so the ring matched exactly one
 * seat in eight — a designer's hexagon sat inside a circular halo and read as
 * unexplained decoration. It also worked directly against shape being the
 * stable, colour-independent identity glyph: the ring is the element drawing
 * the eye, and it was the wrong shape. In a colourless game shape is the ONLY
 * identity channel.
 *
 * The fix is structural, so the test is too: glyph and ring derive from ONE
 * `--tok-clip` per shape, and what is asserted here is that no shape can have a
 * ring that disagrees with it — including any shape added later.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import PlayerToken from './PlayerToken.vue';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PlayerToken.vue'),
  'utf8',
);

/** Every shape class the component defines a silhouette for. */
const SHAPE_CLASSES = [...source.matchAll(/^\.(sh-[a-z]+)\s*\{\s*--tok-clip:/gm)].map((m) => m[1]);

/**
 * The file with block comments stripped — the comments deliberately QUOTE the
 * old buggy CSS to explain why it is gone, so matching against raw source would
 * flag the explanation as the defect.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

describe('emphasis ring follows the token silhouette', () => {
  it('defines a silhouette for all eight shapes', () => {
    // If this drops, the loop below would vacuously pass.
    expect(SHAPE_CLASSES.length).toBe(8);
  });

  it.each(SHAPE_CLASSES)('%s derives glyph and ring from the same variable', (cls) => {
    // Exactly one `--tok-clip` per shape, and both `.shape` and `.halo` read it —
    // so a shape physically cannot carry a ring of a different outline.
    const defs = [...source.matchAll(new RegExp(`^\\.${cls}\\s*\\{\\s*--tok-clip:`, 'gm'))];
    expect(defs).toHaveLength(1);
  });

  it('applies the shared variable to both the glyph and the ring', () => {
    expect(source).toMatch(/\.tok \.shape \{[^}]*clip-path: var\(--tok-clip\)/s);
    expect(source).toMatch(/\.tok \.halo \{[^}]*clip-path: var\(--tok-clip\)/s);
  });

  it('leaves no per-shape clip-path that could diverge from the variable', () => {
    // The old form was `.sh-hexagon .shape { clip-path: polygon(...) }` — a
    // second source of truth the ring knew nothing about.
    expect(code).not.toMatch(/\.sh-[a-z]+ \.(shape|halo)\s*\{/);
  });

  it('never hardcodes a circular ring', () => {
    expect(code).not.toMatch(/border-radius:\s*50%/);
  });
});

describe('emphasis rendering', () => {
  it('renders no ring by default', () => {
    const wrapper = mount(PlayerToken, { props: { name: 'Alice', seat: 2 } });
    expect(wrapper.find('.halo').exists()).toBe(false);
    expect(wrapper.find('.tok').classes()).not.toContain('is-emphasized');
  });

  it('renders a ring when emphasized, on the same element as the shape class', () => {
    const wrapper = mount(PlayerToken, { props: { name: 'Alice', seat: 2, emphasis: true } });
    const tok = wrapper.find('.tok');
    expect(wrapper.find('.halo').exists()).toBe(true);
    // The shape class lives on `.tok`, and `--tok-clip` cascades from there to
    // BOTH children — that co-location is what makes them inseparable.
    expect(tok.classes()).toContain('sh-hexagon');
    expect(tok.classes()).toContain('is-emphasized');
    expect(tok.find('.halo').exists()).toBe(true);
    expect(tok.find('.shape').exists()).toBe(true);
  });

  it('does not change which shape is drawn', () => {
    // Emphasis is presentation only — it must not perturb identity.
    const plain = mount(PlayerToken, { props: { name: 'Bob', seat: 5 } });
    const ringed = mount(PlayerToken, { props: { name: 'Bob', seat: 5, emphasis: true } });
    const shapeOf = (w: typeof plain) => w.find('.tok').classes().find((c) => c.startsWith('sh-'));
    expect(shapeOf(ringed)).toBe(shapeOf(plain));
  });

  it('does not dim the glyph it is meant to emphasise', () => {
    // The companion issue in the same rule: `opacity: 0.85` highlighted and
    // de-emphasised the token at once.
    expect(source).not.toMatch(/\.tok\.is-emphasized[^}]*opacity/s);
    const wrapper = mount(PlayerToken, { props: { name: 'Alice', seat: 0, emphasis: true } });
    expect(wrapper.find('.tok').attributes('style') ?? '').not.toContain('opacity');
  });
});

describe('GameShell asks the token to draw its own ring', () => {
  const shell = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'GameShell.vue'),
    'utf8',
  );

  it('passes emphasis for the "you" token instead of styling a ring itself', () => {
    expect(shell).toMatch(/:emphasis="panelToken\.kind === 'you'"/);
  });

  it('no longer draws a caller-side outline over the token', () => {
    const rule = shell.match(/\.turn-token\.is-you\s*\{[^}]*\}/s);
    expect(
      rule?.[0] ?? '',
      'a ring drawn from GameShell cannot know which of the eight shapes was rendered',
    ).toBe('');
  });
});
