import { describe, it, expect } from 'vitest';
import { Game, Player, DEFAULT_COLOR_PALETTE } from '../index.js';

/**
 * Default player-color palette coverage.
 *
 * The palette used to hold 8 entries while the platform seats up to 16, so any
 * game above 8 players hit a runtime throw unless it hand-supplied a `colors`
 * array — friction that surfaced as a crash rather than as authoring guidance.
 * The default now covers the full platform range; a game that supplies its own
 * palette is untouched, and overrunning a palette still fails fast with a message
 * that names the fix.
 *
 * Colour distinctness is measured, not asserted here — see the palette's own doc
 * comment in `game.ts` for the CIEDE2000 figures.
 */
class PaletteGame extends Game<PaletteGame, Player> {}

describe('default color palette', () => {
  it('covers the platform maximum of 16 seats', () => {
    expect(DEFAULT_COLOR_PALETTE).toHaveLength(16);
  });

  it('has no duplicate entries and all are 6-digit hex', () => {
    expect(new Set(DEFAULT_COLOR_PALETTE).size).toBe(DEFAULT_COLOR_PALETTE.length);
    for (const hex of DEFAULT_COLOR_PALETTE) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('seats a 16-player game with no custom palette, one distinct color each', async () => {
    const game = await new PaletteGame({ playerCount: 16 }).ready();

    expect(game.players).toHaveLength(16);
    const colors = game.players.map((p) => p.color);
    expect(new Set(colors).size).toBe(16);
    expect(colors).toEqual([...DEFAULT_COLOR_PALETTE]);
  });

  it('gives every default color a human-readable label', async () => {
    const game = await new PaletteGame({ playerCount: 16 }).ready();

    const labels = game.players.map((p) => p.colorLabel);
    expect(labels.every((l) => typeof l === 'string' && l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(16);
    // Seat order is stable, so the first eight games' colors are unchanged.
    expect(labels.slice(0, 8)).toEqual(['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Teal', 'Orange', 'Black']);
  });

  it('does not renumber the colors existing games already show', async () => {
    const game = await new PaletteGame({ playerCount: 8 }).ready();
    expect(game.players.map((p) => p.color)).toEqual([
      '#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#2c3e50',
    ]);
  });

  it('a game-supplied palette still wins', async () => {
    const game = await new PaletteGame({
      playerCount: 3,
      colors: ['#111111', '#222222', '#333333'],
    }).ready();

    expect(game.players.map((p) => p.color)).toEqual(['#111111', '#222222', '#333333']);
  });

  it('overrunning a game-supplied palette names that palette in the error', () => {
    expect(() => new PaletteGame({ playerCount: 4, colors: ['#111111', '#222222'] })).toThrow(
      /gameOptions\.colors supplies only 2/
    );
  });

  it('overrunning the default palette names the default and how to extend it', () => {
    expect(() => new PaletteGame({ playerCount: 17 })).toThrow(/default palette covers 16/);
    expect(() => new PaletteGame({ playerCount: 17 })).toThrow(/gameOptions\.colors/);
  });
});
