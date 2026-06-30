/**
 * INTRO-01 + INTRO-02 integration tests for getActionSpace / getActionSchema.
 *
 * These tests drive a real Game through the full engine→session metadata chain
 * to verify the new introspection surface (CLAUDE.md: trace one real value
 * through the full stack per cross-layer boundary).
 *
 * RED phase: getActionSpace and getActionSchema do not exist yet — all tests
 * referencing them will fail until Task 2 implements the methods.
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

// ============================================================================
// Test game: a board with two tokens. One action has a required element pick
// and one optional choice pick; another action has only required picks.
// This gives us both null (optional) and { __required: true } (required)
// in the argTemplate (D-01).
// ============================================================================

class Token extends Piece<SpaceGame> {}
class Board extends Space<SpaceGame> {}

class SpaceGame extends Game<SpaceGame, Player> {
  board!: Board;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);

    this.board = this.create(Board, 'board');
    this.board.create(Token, 'token-a');
    this.board.create(Token, 'token-b');

    /**
     * 'move': required element selection 'target' + optional choice 'note'
     * argTemplate must have:
     *   { target: { __required: true }, note: null }
     */
    this.registerAction(
      Action.create<SpaceGame>('move')
        .chooseElement('target', {
          prompt: 'Pick a token',
          elementClass: Token,
        })
        .chooseFrom('note', {
          prompt: 'Add a note (optional)',
          choices: ['quiet', 'loud'],
          optional: true,
        })
        .execute(() => {}),
    );

    /**
     * 'pass': no selections — argTemplate must be {}
     */
    this.registerAction(
      Action.create<SpaceGame>('pass')
        .prompt('Pass your turn')
        .execute(() => {}),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['move', 'pass'] }),
          }),
        }),
      }),
    );
  }
}

function createGame(): SpaceGame {
  const game = new SpaceGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'get-action-space-test',
  });
  game.startFlow();
  return game;
}

// ============================================================================
// Tests (RED — getActionSpace / getActionSchema do not exist yet)
// ============================================================================

describe('getActionSpace (INTRO-01)', () => {
  let game: SpaceGame;

  beforeEach(() => {
    game = createGame();
  });

  // ─── Cross-seat scoping ──────────────────────────────────────────────────

  it('returns only actions legal for the requested seat (seat 1 vs seat 2)', () => {
    const seat1Space = (game as any).getActionSpace(1);
    const seat2Space = (game as any).getActionSpace(2);

    // Seat 1 is the active sequential player and has actions
    expect(seat1Space.actions.length).toBeGreaterThan(0);
    const actionNames1 = seat1Space.actions.map((a: any) => a.name);
    expect(actionNames1).toContain('move');
    expect(actionNames1).toContain('pass');

    // Seat 2 is waiting: no actions available in a sequential step
    expect(seat2Space.actions).toHaveLength(0);
  });

  it('returns { actions: [] } when the seat has no player', () => {
    const result = (game as any).getActionSpace(99);
    expect(result).toEqual({ actions: [] });
  });

  // ─── D-01: argTemplate sentinel values ──────────────────────────────────

  it('argTemplate has null for optional selections and { __required: true } for required ones (D-01)', () => {
    const space = (game as any).getActionSpace(1);
    const moveView = space.actions.find((a: any) => a.name === 'move');
    expect(moveView).toBeDefined();

    const tmpl = moveView.argTemplate as Record<string, unknown>;
    // 'target' is required
    expect(tmpl['target']).toEqual({ __required: true });
    // 'note' is optional
    expect(tmpl['note']).toBeNull();
  });

  it('argTemplate is empty object {} for actions with no selections', () => {
    const space = (game as any).getActionSpace(1);
    const passView = space.actions.find((a: any) => a.name === 'pass');
    expect(passView).toBeDefined();
    expect(passView.argTemplate).toEqual({});
  });

  // ─── Action schema view shape ────────────────────────────────────────────

  it('each ActionSchemaView carries name, prompt/help, and selections (PickMetadata[])', () => {
    const space = (game as any).getActionSpace(1);
    const moveView = space.actions.find((a: any) => a.name === 'move');
    expect(moveView).toBeDefined();
    expect(moveView.name).toBe('move');
    // selections must be an array with two entries: 'target' and 'note'
    expect(Array.isArray(moveView.selections)).toBe(true);
    expect(moveView.selections).toHaveLength(2);
    expect(moveView.selections[0].name).toBe('target');
    expect(moveView.selections[1].name).toBe('note');
    expect(moveView.selections[1].optional).toBe(true);
  });

  // ─── JSON-serializability ────────────────────────────────────────────────

  it('ActionSpaceView survives JSON.stringify → JSON.parse unchanged', () => {
    const space = (game as any).getActionSpace(1);
    const roundTripped = JSON.parse(JSON.stringify(space));

    // Top-level shape must survive
    expect(roundTripped.actions).toBeDefined();
    expect(Array.isArray(roundTripped.actions)).toBe(true);

    // D-01 argTemplate must survive
    const moveView = roundTripped.actions.find((a: any) => a.name === 'move');
    expect(moveView).toBeDefined();
    expect(moveView.argTemplate['target']).toEqual({ __required: true });
    expect(moveView.argTemplate['note']).toBeNull();
  });
});

describe('getActionSchema (INTRO-02)', () => {
  let game: SpaceGame;

  beforeEach(() => {
    game = createGame();
  });

  it('returns ActionMetadata with expected selections for a known action + seat', () => {
    const schema = (game as any).getActionSchema('move', 1);
    expect(schema).toBeDefined();
    expect(schema.name).toBe('move');
    expect(Array.isArray(schema.selections)).toBe(true);
    expect(schema.selections).toHaveLength(2);
    expect(schema.selections[0].name).toBe('target');
    expect(schema.selections[1].name).toBe('note');
  });

  it('returns undefined for an unknown action name', () => {
    const schema = (game as any).getActionSchema('nonexistent', 1);
    expect(schema).toBeUndefined();
  });

  it('returns undefined when the seat has no player', () => {
    const schema = (game as any).getActionSchema('move', 99);
    expect(schema).toBeUndefined();
  });
});
