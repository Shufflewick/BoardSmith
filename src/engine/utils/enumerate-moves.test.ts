/**
 * Tests for enumerateLegalMoves — the public engine utility extracted from MCTSBot.
 *
 * INTRO-04: Full enumeration + in-process element objects + maxPerAction + bot parity.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  GameElement,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../index.js';
import { MCTSBot } from '../../ai/mcts-bot.js';
import { enumerateLegalMoves } from './enumerate-moves.js';

// ============================================================================
// Test game: 3 Piece tokens on a board, action picks one via chooseElement.
// ≥2 choices satisfies the MCTS memory note (bot short-circuits with only 1 move).
// ============================================================================

class TokenGame extends Game<TokenGame, Player> {
  board!: Space<TokenGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<TokenGame>, 'board');

    // 3 tokens → 3 concrete moves for the pick action
    this.board.create(Piece<TokenGame>, 'token-a');
    this.board.create(Piece<TokenGame>, 'token-b');
    this.board.create(Piece<TokenGame>, 'token-c');

    this.registerAction(
      Action.create<TokenGame>('pick')
        .chooseElement('target', {
          prompt: 'Choose a token',
          elementClass: Piece,
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 10,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      }),
    );
  }
}

function createTokenGame(): TokenGame {
  const game = new TokenGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'enumerate-test',
  });
  game.startFlow();
  return game;
}

describe('enumerateLegalMoves', () => {
  let game: TokenGame;

  beforeEach(() => {
    game = createTokenGame();
  });

  // ─── Test 1: Full enumeration returns all concrete moves ───────────────────

  it('returns one move per legal target element (full enumeration default)', () => {
    const moves = enumerateLegalMoves(game, 1);

    // 3 tokens → 3 moves for action 'pick'
    expect(moves).toHaveLength(3);
    expect(moves.every(m => m.action === 'pick')).toBe(true);
  });

  // ─── Test 2: Args contain in-process element objects, NOT numeric IDs ──────

  it('returns element objects in args (not serialized IDs)', () => {
    const moves = enumerateLegalMoves(game, 1);

    for (const move of moves) {
      const target = move.args.target;

      // CRITICAL INVARIANT: must be a GameElement object, not a bare number
      expect(typeof target).not.toBe('number');
      expect(target).toBeInstanceOf(GameElement);

      // Element objects carry expected structural fields
      const el = target as GameElement;
      expect(typeof el.id).toBe('number');
      expect(el.name).toBeDefined();
    }
  });

  // ─── Test 3: maxPerAction truncates per-action move count ──────────────────

  it('maxPerAction truncates moves per action when provided', () => {
    const moves = enumerateLegalMoves(game, 1, { maxPerAction: 2 });

    // With maxPerAction: 2, only 2 of the 3 token moves should be returned
    expect(moves.length).toBeLessThanOrEqual(2);
    expect(moves.every(m => m.action === 'pick')).toBe(true);
  });

  it('returns all moves when maxPerAction exceeds available count', () => {
    const moves = enumerateLegalMoves(game, 1, { maxPerAction: 10 });

    // 3 tokens < 10 cap → still 3
    expect(moves).toHaveLength(3);
  });

  // ─── Test 4: Parity with MCTSBot enumeration on identical state ────────────
  //
  // After extraction, enumerateLegalMoves must surface the same concrete moves
  // as the bot's full (noSampling=true) enumeration. The bot serializes element
  // args to numeric IDs; we project our element-object args to IDs for the
  // set-equality comparison.

  it('returns the same move set as MCTSBot.enumerateAllMoves on identical state', () => {
    const flowState = game.getFlowState()!;

    // Seed the bot so its results are deterministic (though noSampling path is used here)
    const bot = new MCTSBot(game, TokenGame, 'token-game', 1, [], {
      iterations: 1,
      playoutDepth: 1,
      seed: 'parity-test',
    });

    // Access bot's full enumeration (noSampling=true) via private method
    const botMoves: Array<{ action: string; args: Record<string, unknown> }> =
      (bot as any).enumerateAllMoves(game, flowState);

    // Project enumerateLegalMoves results: element → numeric ID for comparison
    const coreMoves = enumerateLegalMoves(game, 1);

    const coreNormalized = coreMoves
      .map(m => ({
        action: m.action,
        targetId: (m.args.target as GameElement).id,
      }))
      .sort((a, b) => a.targetId - b.targetId);

    const botNormalized = botMoves
      .map(m => ({
        action: m.action,
        targetId: m.args.target as number,
      }))
      .sort((a, b) => a.targetId - b.targetId);

    expect(coreNormalized).toEqual(botNormalized);
  });

  // ─── Test 5: No moves available returns empty array ───────────────────────

  it('returns empty array when seat has no available actions', () => {
    // Seat 2 is not the active player on the first turn
    const moves = enumerateLegalMoves(game, 2);
    expect(moves).toHaveLength(0);
  });
});
