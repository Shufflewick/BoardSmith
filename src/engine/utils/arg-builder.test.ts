/**
 * Tests for buildActionArgs — the public arg-builder utility (INTRO-03).
 *
 * Covers:
 *   1. In-process (default format) — element objects pass through unchanged;
 *      result is accepted by runner.performAction end-to-end.
 *   2. Wire format — element objects become { id, className }; the result
 *      survives JSON and is accepted by runner.performAction (#681).
 *   3. Primitive passthrough — string/number values survive both formats.
 *   4. Validation — unknown selection names are rejected with an actionable error
 *      that names the action AND the offending selection.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
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
  lastPicked: unknown[] = [];

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
        .execute((args) => {
          this.lastPicked = [args.target as Token];
        }),
    );

    // 'guess': two primitive (choice) selections
    this.registerAction(
      Action.create<ArgBuilderGame>('guess')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('number', { choices: [1, 2, 3] })
        .execute(() => ({ success: true })),
    );

    // 'pickMany': a multi-element selection
    this.registerAction(
      Action.create<ArgBuilderGame>('pickMany')
        .chooseElements('targets', { elements: () => [...this.board.all(Token)], multiSelect: { min: 1, max: 2 } })
        .execute((args) => {
          this.lastPicked = args.targets as Token[];
        }),
    );

    // 'pickPlayer': a player picked as an element (players are elements)
    this.registerAction(
      Action.create<ArgBuilderGame>('pickPlayer')
        .chooseElement('who', { elementClass: Player })
        .execute((args) => {
          this.lastPicked = [args.who as Player];
        }),
    );

    // 'attack': a player picked by seat, the playerChoices() form
    this.registerAction(
      Action.create<ArgBuilderGame>('attack')
        .chooseFrom('victim', { choices: (ctx) => this.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }) })
        .execute((args) => {
          this.lastPicked = [args.victim as number];
        }),
    );

    this.setFlow({
      root: loop({
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({ actions: ['pick', 'guess', 'pickMany', 'pickPlayer', 'attack'] }),
        }),
      }),
    });
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
    function startRunner(): GameRunner<ArgBuilderGame> {
      const runner = new GameRunner({
        GameClass: ArgBuilderGame,
        gameType: 'arg-builder-test',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'wire-test' },
      });
      runner.start();
      return runner;
    }

    /** The wire args as they arrive on the far side of a JSON hop. */
    function overTheWire(action: string, values: Record<string, unknown>, runner: GameRunner<ArgBuilderGame>) {
      return JSON.parse(JSON.stringify(buildActionArgs(action, values, runner.game, 1, { format: 'wire' })));
    }

    it('writes an element as { id, className }', () => {
      const token = game.board.first(Token)!;
      const result = buildActionArgs('pick', { target: token }, game, 1, { format: 'wire' });

      expect(result.target).toEqual({ id: token.id, className: 'Token' });
    });

    it('writes each element of a multi-element pick as { id, className }', () => {
      const [a, b] = game.board.all(Token);
      const result = buildActionArgs('pickMany', { targets: [a, b] }, game, 1, { format: 'wire' });

      expect(result.targets).toEqual([{ id: a.id, className: 'Token' }, { id: b.id, className: 'Token' }]);
    });

    it('an element pick survives JSON and is accepted by runner.performAction', () => {
      const runner = startRunner();
      const token = runner.game.board.all(Token)[1];

      const outcome = runner.performAction('pick', 1, overTheWire('pick', { target: token }, runner));

      expect(outcome.error).toBeUndefined();
      expect(outcome.success).toBe(true);
      expect(runner.game.lastPicked).toEqual([token]);
    });

    it('a multi-element pick survives JSON and is accepted by runner.performAction', () => {
      const runner = startRunner();
      const tokens = runner.game.board.all(Token);

      const outcome = runner.performAction('pickMany', 1, overTheWire('pickMany', { targets: [...tokens] }, runner));

      expect(outcome.error).toBeUndefined();
      expect(runner.game.lastPicked).toEqual([...tokens]);
    });

    it('a player picked as an element survives JSON and is accepted by runner.performAction', () => {
      const runner = startRunner();
      const bob = runner.game.getPlayer(2)!;

      const outcome = runner.performAction('pickPlayer', 1, overTheWire('pickPlayer', { who: bob }, runner));

      expect(outcome.error).toBeUndefined();
      expect(runner.game.lastPicked).toEqual([bob]);
    });

    it('a player picked by seat (playerChoices) survives JSON and is accepted by runner.performAction', () => {
      const runner = startRunner();

      const outcome = runner.performAction('attack', 1, overTheWire('attack', { victim: 2 }, runner));

      expect(outcome.error).toBeUndefined();
      expect(runner.game.lastPicked).toEqual([2]);
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
