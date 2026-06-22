/**
 * Regression guard for the scaffolded placeholder game template.
 *
 * Bug (found by the Phase 95 playability gate): the generated game created each
 * player's Hand inside the Player constructor. The engine pre-creates players
 * during super(), which runs BEFORE the game body calls registerElements([...]).
 * A Hand created at that point is never registered, so getPlayerHand() returns
 * undefined and the constructor's deal loop crashes with
 * "Cannot read properties of undefined (reading '_t')" on the first putInto().
 *
 * The fix mirrors the working reference games (e.g. Cribbage): create hands in
 * the game body, after registerElements(), iterating this.players. These tests
 * pin that pattern so the template can't regress to the crashing shape.
 */
import { describe, it, expect } from 'vitest';
import { generateGameTs } from './init.js';

describe('generateGameTs — scaffolded game template', () => {
  const src = generateGameTs('Demo');

  it('creates player hands in the game body after registerElements (not in the Player constructor)', () => {
    const registerIdx = src.indexOf('this.registerElements([Card, Hand, Deck]);');
    const handCreateIdx = src.indexOf('this.create(Hand, `hand-${player.seat}`)');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(handCreateIdx).toBeGreaterThan(-1);
    // Hand creation must come AFTER registerElements so the Hand class is registered.
    expect(handCreateIdx).toBeGreaterThan(registerIdx);
  });

  it('does NOT create the player hand inside the Player constructor', () => {
    // Isolate the Player class body and assert it does not call game.create(Hand, ...).
    const playerClassIdx = src.indexOf('export class DemoPlayer extends Player');
    expect(playerClassIdx).toBeGreaterThan(-1);
    const playerBody = src.slice(playerClassIdx);
    expect(playerBody).not.toContain('game.create(Hand');
  });

  it('assigns each player.hand so downstream code keeps a typed reference', () => {
    expect(src).toContain('player.hand = hand;');
  });
});
