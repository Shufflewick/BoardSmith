/**
 * FEAT-01 / PROC-01 — Seed-to-state PoC integration test.
 *
 * Proves the `--seed` wiring (stateless-ops.ts `handleStart` /
 * multiplayer-host.ts `MultiplayerHostOptions.seedSnapshot` /
 * commands/dev.ts `--seed <file>`) end to end WITHOUT spinning up a real dev
 * server: it drives `executeOp` directly, exactly the way `MultiplayerHost`
 * does (`hostOptions.seedSnapshot` threaded into the `start` op).
 *
 * Uses a small IN-REPO `Game` subclass rather than the sibling reference game
 * `~/BoardSmithGames/go-fish`: go-fish is not a dependency of this repo (it
 * symlinks BoardSmith the other direction) and cannot be imported from a
 * library vitest test. 168-CONTEXT.md sanctions an in-repo TestGame-based
 * target when go-fish is not cleanly reachable — the PoC proves the
 * DETERMINISTIC-LOAD capability, which is target-agnostic, not anything
 * specific to go-fish's rules.
 *
 * Four legs:
 *   1. RECORD           — drive CounterGame to a distinct mid-game state via
 *                          TestGame, capture TestGame.getSnapshot() as the seed.
 *   2. PASS-WITH seed    — executeOp({ type: 'start' }, { seedSnapshot }) yields
 *                          state equal to the recorded snapshot's element tree /
 *                          flowState / current player, and the seeded game can
 *                          take the next legal action.
 *   3. FAIL-WITHOUT seed — executeOp({ type: 'start' }) with NO seed (fresh
 *                          start) yields state that DIFFERS from the recorded
 *                          mid-game state (the wiring is load-bearing).
 *   4. LOAD-TWICE-IDENTICAL — loading the same seed twice is byte-identical
 *                          (RNG randomState pinned by the snapshot).
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  loop,
  type GameOptions,
} from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { TestGame } from '../testing/test-game.js';

// ---------------------------------------------------------------------------
// CounterGame: player 1 repeatedly takes a 'draw' action that moves the top
// token from the deck into the hand — a measurable, provable mutation of the
// element tree (not just a flow counter), so a mid-game snapshot is
// deterministically distinguishable from a fresh start.
// ---------------------------------------------------------------------------

class Token extends Piece<CounterGame> {}

class CounterGame extends Game<CounterGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerElements([Token]);

    const deck = this.create(Space, 'deck');
    this.create(Space, 'hand');
    for (let i = 0; i < 5; i++) {
      deck.create(Token, `token-${i}`);
    }

    this.registerAction(
      Action.create<CounterGame>('draw').execute((_args, ctx) => {
        const game = ctx.game as CounterGame;
        const deckSpace = game.first(Space, 'deck')!;
        const handSpace = game.first(Space, 'hand')!;
        const top = deckSpace.all(Token)[0];
        if (!top) return { success: false, error: 'Deck is empty' };
        top.putInto(handSpace);
        return { success: true };
      }),
    );

    // Mirrors stateless-ops.test.ts's SimpleGame: repeatUntil never true, so
    // the SAME actionStep frame stays open across repeated 'draw' actions —
    // player 1 always has a legal 'draw' available, before AND after a
    // seeded load, as long as the deck is non-empty.
    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({
          actions: ['draw'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
        }),
      }),
    }));
  }
}

const counterGameDef: GameDefinitionLike = {
  gameClass: CounterGame as new (...args: unknown[]) => unknown,
  gameType: 'counter',
  minPlayers: 1,
  maxPlayers: 4,
};

function deckCount(state: unknown): number {
  const children = (state as { children?: Array<{ name?: string; children?: unknown[] }> }).children ?? [];
  const deck = children.find((c) => c.name === 'deck');
  return (deck?.children ?? []).length;
}

function handCount(state: unknown): number {
  const children = (state as { children?: Array<{ name?: string; children?: unknown[] }> }).children ?? [];
  const hand = children.find((c) => c.name === 'hand');
  return (hand?.children ?? []).length;
}

// ---------------------------------------------------------------------------
// 1. RECORD — drive a real TestGame to a distinct mid-game state.
// ---------------------------------------------------------------------------

const testGame = TestGame.create(CounterGame, { playerCount: 1, seed: 'seed-to-state-fixture' });
testGame.doAction(1, 'draw');
testGame.doAction(1, 'draw');

// Round-trip through JSON exactly like a real `--seed <file>` would (the seed
// fixture on disk, then `JSON.parse` in commands/dev.ts's parseSeedFile).
const recordedSnapshot = JSON.parse(JSON.stringify(testGame.getSnapshot()));

const gameOptions = { playerCount: 1, seed: 'seed-to-state-fixture' };

describe('FEAT-01: seed-to-state PoC — deterministic load via executeOp start', () => {
  it('RECORD: the captured seed is a distinct mid-game state (2 tokens drawn, not a fresh 5/0 split)', () => {
    expect(deckCount(recordedSnapshot.state)).toBe(3);
    expect(handCount(recordedSnapshot.state)).toBe(2);
  });

  it('PASS-WITH seed: the loaded state matches the recorded element tree, flowState, and current player', async () => {
    const result = await executeOp(
      counterGameDef,
      gameOptions,
      null,
      null,
      { type: 'start' },
      { seedSnapshot: recordedSnapshot },
    );

    expect(result.success).toBe(true);
    const loadedSnapshot = result.snapshot as typeof recordedSnapshot;

    // Element tree: byte-identical (this IS the load-bearing proof the seed
    // reached the game, not a fresh construction).
    expect(loadedSnapshot.state).toEqual(recordedSnapshot.state);

    // flowState: compare the meaningful fields, not internal frame-bookkeeping
    // keys — GameRunner.fromSnapshot's restoreFlowState normalizes/pre-fills
    // some internal frameData counters on every restore (this is inherent to
    // the EXISTING fromSnapshot path this plan reuses, not something the
    // seed wiring introduces — see LOAD-TWICE-IDENTICAL below, which proves
    // that normalization is itself deterministic).
    const recordedFlow = recordedSnapshot.flowState as {
      currentPlayer?: number;
      awaitingInput?: boolean;
      availableActions?: string[];
      moveCount?: number;
      position?: { path?: number[]; playerIndex?: number };
    };
    const loadedFlow = loadedSnapshot.flowState as typeof recordedFlow;
    expect(loadedFlow.currentPlayer).toBe(recordedFlow.currentPlayer);
    expect(loadedFlow.awaitingInput).toBe(recordedFlow.awaitingInput);
    expect(loadedFlow.availableActions).toEqual(recordedFlow.availableActions);
    expect(loadedFlow.moveCount).toBe(recordedFlow.moveCount);
    expect(loadedFlow.position?.path).toEqual(recordedFlow.position?.path);
    expect(loadedFlow.position?.playerIndex).toBe(recordedFlow.position?.playerIndex);

    expect((result.flowState as { currentPlayer?: number })?.currentPlayer).toBe(1);

    // Deck/hand split proves this ISN'T a fresh start under the hood, not just
    // a structurally-matching coincidence.
    expect(deckCount(loadedSnapshot.state)).toBe(3);
    expect(handCount(loadedSnapshot.state)).toBe(2);
  });

  it('PASS-WITH seed: the seeded game can take the next legal action from the recorded state', async () => {
    const started = await executeOp(
      counterGameDef,
      gameOptions,
      null,
      null,
      { type: 'start' },
      { seedSnapshot: recordedSnapshot },
    );
    expect(started.success).toBe(true);

    const drawn = await executeOp(
      counterGameDef,
      gameOptions,
      started.snapshot,
      null,
      { type: 'action', actionName: 'draw', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot) },
    );

    expect(drawn.success).toBe(true);
    const nextState = (drawn.snapshot as { state: unknown }).state;
    expect(deckCount(nextState)).toBe(2);
    expect(handCount(nextState)).toBe(3);
  });

  it('FAIL-WITHOUT seed: a fresh start (no seed threaded) does NOT match the recorded mid-game state', async () => {
    const result = await executeOp(
      counterGameDef,
      gameOptions,
      null,
      null,
      { type: 'start' },
      // No hostOptions at all — the pre-wiring behavior this test must catch
      // if handleStart ever regresses to ignoring a threaded seed.
      null,
    );

    expect(result.success).toBe(true);
    const freshSnapshot = result.snapshot as typeof recordedSnapshot;

    expect(freshSnapshot.state).not.toEqual(recordedSnapshot.state);
    expect(deckCount(freshSnapshot.state)).toBe(5);
    expect(handCount(freshSnapshot.state)).toBe(0);
  });

  it('LOAD-TWICE-IDENTICAL: loading the same seed twice yields byte-identical state (RNG randomState pinned)', async () => {
    const first = await executeOp(
      counterGameDef,
      gameOptions,
      null,
      null,
      { type: 'start' },
      { seedSnapshot: recordedSnapshot },
    );
    const second = await executeOp(
      counterGameDef,
      gameOptions,
      null,
      null,
      { type: 'start' },
      { seedSnapshot: recordedSnapshot },
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.snapshot).toEqual(second.snapshot);

    const firstRandomState = (first.snapshot as { randomState?: unknown }).randomState;
    const secondRandomState = (second.snapshot as { randomState?: unknown }).randomState;
    expect(firstRandomState).toBeDefined();
    expect(firstRandomState).toEqual(secondRandomState);
  });
});
