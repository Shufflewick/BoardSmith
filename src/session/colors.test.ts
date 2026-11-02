/**
 * The option factory games declare player colours with. Its default is the
 * engine's own palette and names, so there is one player-colour list (#814).
 */
import { describe, it, expect } from 'vitest';
import { createColorOption, dealSeatColors, type ColorOptionDefinition } from './colors.js';
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

describe('the colour option\'s label (#1304)', () => {
  it('is always "Color": nothing reads another, so the type takes no other', () => {
    // @ts-expect-error a hand-written colour option cannot carry a label that would be silently ignored
    const relabelled: ColorOptionDefinition = { type: 'color', label: 'Team colour', choices: [] };
    expect(createColorOption().label).toBe('Color');
    expect(relabelled.type).toBe('color');
  });
});

describe('dealSeatColors (#1569)', () => {
  const palette = ['#e74c3c', '#3498db', '#27ae60'];

  it('gives each seat with no colour the first palette colour no seat holds', () => {
    expect(dealSeatColors([undefined, '#e74c3c', undefined], palette)).toEqual(['#3498db', '#e74c3c', '#27ae60']);
  });

  it('keeps the colours seats chose', () => {
    expect(dealSeatColors(['#27ae60', undefined], palette)).toEqual(['#27ae60', '#e74c3c']);
  });

  it('deals a colour an earlier seat has again while the palette has one for every seat', () => {
    expect(dealSeatColors(['#e74c3c', '#e74c3c'], palette)).toEqual(['#e74c3c', '#3498db']);
  });

  it('lets seats share a colour once the table has more seats than the palette has colours', () => {
    expect(dealSeatColors(['#e74c3c', '#e74c3c', '#3498db', '#27ae60'], palette)).toEqual(['#e74c3c', '#e74c3c', '#3498db', '#27ae60']);
  });

  it('leaves a seat uncoloured once the palette has no colour left for it', () => {
    expect(dealSeatColors(['#e74c3c', '#3498db', '#27ae60', undefined], palette)).toEqual([...palette, undefined]);
  });
});
