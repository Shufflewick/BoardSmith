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
import { generateGameTs, generateTestTs } from './init.js';

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

describe('generateTestTs — scaffolded game test template', () => {
  const test = generateTestTs('Demo');

  it('iterates players via game.players (not all(Player), which excludes unregistered players)', () => {
    expect(test).toContain('game.players');
    expect(test).not.toContain('game.all(DemoPlayer)');
  });

  it('asserts the deck count consistent with the constructor dealing 5 cards per player', () => {
    // The game deals in its constructor, so the deck no longer holds all 52
    // cards post-construction. Guard against regressing to the stale toBe(52)
    // deck assertion that fails for every freshly scaffolded game.
    expect(test).toContain('game.deck.all(Card).length).toBe(52 - game.players.length * 5)');
    expect(test).not.toContain('game.deck.all().length).toBe(52)');
  });

  it('does not call setup() — the scaffold game does all setup in its constructor', () => {
    expect(test).not.toContain('game.setup()');
  });
});
