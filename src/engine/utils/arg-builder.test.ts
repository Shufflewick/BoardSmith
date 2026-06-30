/**
 * Tests for buildActionArgs — the public arg-builder utility (INTRO-03).
 *
 * Covers:
 *   1. In-process (default format) — element objects pass through unchanged;
 *      result is accepted by runner.performAction end-to-end.
 *   2. Wire format — element objects become { __elementId } refs; result is
 *      JSON.stringify-safe.
 *   3. Primitive passthrough — string/number values survive both formats.
 *   4. Validation — unknown selection names are rejected with an actionable error
 *      that names the action AND the offending selection.
 *
 * This is the RED phase: buildActionArgs does not exist yet, so all imports will fail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { buildActionArgs } from './arg-builder.js';

// ============================================================================
// Test game: Piece tokens on a board (element selection) + a choice selection.
// ============================================================================

class Token extends Piece<ArgBuilderGame> {}
class Board extends Space<ArgBuilderGame> {}

class ArgBuilderGame extends Game<ArgBuilderGame, Player> {
  board!: Board;
  token!: Token;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);

    this.board = this.create(Board, 'board');
    // Two tokens so flow can continue (and MCTS/arg tests have >1 move)
    this.token = this.board.create(Token, 'token-a');
    this.board.create(Token, 'token-b');

    // 'pick': element selection 'target' + a follow-on choice 'color'
    this.registerAction(
      Action.create<ArgBuilderGame>('pick')
        .chooseElement('target', {
          prompt: 'Choose a token',
          elementClass: Token,
        })
        .execute(() => ({ success: true })),
    );

    // 'guess': two primitive (choice) selections
    this.registerAction(
      Action.create<ArgBuilderGame>('guess')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('number', { choices: [1, 2, 3] })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 10,
          do: eachPlayer({
            do: actionStep({ actions: ['pick', 'guess'] }),
          }),
        }),
      }),
    );
  }
}

function createGame(): ArgBuilderGame {
  const game = new ArgBuilderGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'arg-builder-test',
  });
  game.startFlow();
  return game;
}

// ============================================================================
// Tests
// ============================================================================

describe('buildActionArgs', () => {
  let game: ArgBuilderGame;

  beforeEach(() => {
    game = createGame();
  });

  // ── 1. In-process (default) ──────────────────────────────────────────────

  describe('in-process format (default)', () => {
    it('returns element objects unchanged for element selections', () => {
      const token = game.board.first(Token)!;
      expect(token).toBeDefined();

      const result = buildActionArgs('pick', { target: token }, game, 1);

      // The same object reference must survive
      expect(result.target).toBe(token);
    });

    it('result is accepted by runner.performAction without error', () => {
      // GameRunner constructs its own game — build args from runner.game
      const runner = new GameRunner({
        GameClass: ArgBuilderGame,
        gameType: 'arg-builder-test',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'runner-test' },
      });
      runner.start();

      const token = runner.game.board.first(Token)!;
      expect(token).toBeDefined();

      const args = buildActionArgs('pick', { target: token }, runner.game, 1);
      const outcome = runner.performAction('pick', 1, args);

      expect(outcome.success).toBe(true);
    });

    it('returns primitive values unchanged', () => {
      const result = buildActionArgs('guess', { color: 'red', number: 2 }, game, 1);

      expect(result.color).toBe('red');
      expect(result.number).toBe(2);
    });

    it('does not mutate the original selectionValues object', () => {
      const token = game.board.first(Token)!;
      const original = { target: token };

      buildActionArgs('pick', original, game, 1);

      // original must not have been modified
      expect(Object.keys(original)).toEqual(['target']);
      expect(original.target).toBe(token);
    });
  });

  // ── 2. Wire format ───────────────────────────────────────────────────────

  describe('wire format', () => {
    it('converts element objects to { __elementId } references', () => {
      const token = game.board.first(Token)!;
      const result = buildActionArgs('pick', { target: token }, game, 1, { format: 'wire' });

      expect(result.target).toEqual({ __elementId: token.id });
    });

    it('result is JSON.stringify-safe (no circular refs or non-serialisable values)', () => {
      const token = game.board.first(Token)!;
      const result = buildActionArgs('pick', { target: token }, game, 1, { format: 'wire' });

      expect(() => JSON.stringify(result)).not.toThrow();
      const parsed = JSON.parse(JSON.stringify(result));
      expect(parsed.target).toEqual({ __elementId: token.id });
    });

    it('passes primitives through unchanged in wire format', () => {
      const result = buildActionArgs('guess', { color: 'blue', number: 3 }, game, 1, { format: 'wire' });

      expect(result.color).toBe('blue');
      expect(result.number).toBe(3);
    });
  });

  // ── 3. Validation ────────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws an actionable error for an unknown selection name', () => {
      expect(() => buildActionArgs('pick', { typo: 'oops' }, game, 1)).toThrow(/typo/);
    });

    it('error message names the action', () => {
      expect(() => buildActionArgs('pick', { typo: 'oops' }, game, 1)).toThrow(/pick/);
    });

    it('throws when the action itself does not exist', () => {
      expect(() => buildActionArgs('nonexistent', {}, game, 1)).toThrow(/nonexistent/);
    });

    it('does not throw for valid selection names', () => {
      const token = game.board.first(Token)!;
      expect(() => buildActionArgs('pick', { target: token }, game, 1)).not.toThrow();
    });

    it('throws when a required selection is missing', () => {
      // 'pick' has a required 'target' element selection — empty args must throw
      expect(() => buildActionArgs('pick', {}, game, 1)).toThrow(/required selection "target"/);
    });

    it('error for missing required selection names the action', () => {
      expect(() => buildActionArgs('pick', {}, game, 1)).toThrow(/pick/);
    });

    it('throws with invalid seat number', () => {
      const token = game.board.first(Token)!;
      expect(() => buildActionArgs('pick', { target: token }, game, 99)).toThrow(/seat 99/);
    });
  });
});
