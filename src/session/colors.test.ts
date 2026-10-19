/**
 * The option factory games declare player colours with. Its default is the
 * engine's own palette and names, so there is one player-colour list (#814).
 */
import { describe, it, expect } from 'vitest';
import { createColorOption } from './colors.js';
import { DEFAULT_COLOR_PALETTE } from '../engine/index.js';

describe('createColorOption', () => {
  it('builds a colour-typed player option', () => {
    expect(createColorOption().type).toBe('color');
  });

  it('defaults to the engine palette, in its order', () => {
    expect(createColorOption().choices.map((c) => c.value)).toEqual([...DEFAULT_COLOR_PALETTE]);
  });

  it('names each default colour as the engine does, so Black is the dark #2c3e50', () => {
    const { choices } = createColorOption();
    expect(choices.find((c) => c.label === 'Black')?.value).toBe('#2c3e50');
    expect(choices.slice(0, 4).map((c) => c.label)).toEqual(['Red', 'Blue', 'Green', 'Yellow']);
    expect(new Set(choices.map((c) => c.label)).size).toBe(DEFAULT_COLOR_PALETTE.length);
  });

  it('is labelled Color', () => {
    expect(createColorOption().label).toBe('Color');
  });

  it('takes no arguments, since neither dev nor the lobby would read them (#1196)', () => {
    // @ts-expect-error the lobby builds colour from boardsmith.json's colorPalette, so a label would go unread
    expect(createColorOption('Team Colour').label).toBe('Color');
  });

  it('gives each call its own choices array', () => {
    expect(createColorOption().choices).not.toBe(createColorOption().choices);
  });
});
