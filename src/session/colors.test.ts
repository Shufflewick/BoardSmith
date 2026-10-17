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

  it('copies a custom palette, so a game cannot mutate the caller\'s list', () => {
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
