/**
 * The player-colour palette and the option factory games declare it with.
 * `color-contrast.test.ts` checks the palette's contrast — but against a
 * hardcoded COPY of the hex values, so it cannot notice the real palette
 * changing. These tests bind to the exported constant itself.
 */
import { describe, it, expect } from 'vitest';
import { STANDARD_PLAYER_COLORS, createColorOption } from './colors.js';

describe('STANDARD_PLAYER_COLORS', () => {
  it('offers eight colours, enough for the largest supported table', () => {
    expect(STANDARD_PLAYER_COLORS).toHaveLength(8);
  });

  it('gives every colour a hex value and a human-readable label', () => {
    for (const colour of STANDARD_PLAYER_COLORS) {
      expect(colour.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colour.label.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate values or labels — two players must never look alike', () => {
    expect(new Set(STANDARD_PLAYER_COLORS.map((c) => c.value)).size).toBe(8);
    expect(new Set(STANDARD_PLAYER_COLORS.map((c) => c.label)).size).toBe(8);
  });

  it('leads with the seats a two-player game gets', () => {
    expect(STANDARD_PLAYER_COLORS[0].label).toBe('Red');
    expect(STANDARD_PLAYER_COLORS[1].label).toBe('Blue');
  });

  it('names every colour in a way a player could say out loud', () => {
    expect(STANDARD_PLAYER_COLORS.map((c) => c.label)).toEqual([
      'Red', 'Blue', 'Green', 'Orange', 'Purple', 'Yellow', 'Black', 'White',
    ]);
  });
});

describe('createColorOption', () => {
  it('builds a colour-typed player option', () => {
    expect(createColorOption().type).toBe('color');
  });

  it('defaults to the standard palette', () => {
    expect(createColorOption().choices).toEqual([...STANDARD_PLAYER_COLORS]);
  });

  it('defaults its label to Color', () => {
    expect(createColorOption().label).toBe('Color');
  });

  it('accepts a custom label', () => {
    expect(createColorOption(undefined, 'Team Colour').label).toBe('Team Colour');
  });

  it('accepts a custom palette', () => {
    const custom = [
      { value: '#ff0000', label: 'Fire' },
      { value: '#0000ff', label: 'Ice' },
    ];
    expect(createColorOption(custom).choices).toEqual(custom);
  });

  it('copies the palette, so a game cannot mutate the shared constant', () => {
    const option = createColorOption();
    option.choices.push({ value: '#000000', label: 'Void' });
    expect(STANDARD_PLAYER_COLORS).toHaveLength(8);
  });

  it('copies a custom palette too', () => {
    const custom = [{ value: '#ff0000', label: 'Fire' }];
    const option = createColorOption(custom);
    option.choices.push({ value: '#000000', label: 'Void' });
    expect(custom).toHaveLength(1);
  });

  it('gives each call its own choices array', () => {
    expect(createColorOption().choices).not.toBe(createColorOption().choices);
  });

  it('accepts an empty palette without inventing a default', () => {
    expect(createColorOption([]).choices).toEqual([]);
  });
});
