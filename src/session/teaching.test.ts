/**
 * Teaching substrate tests (Phase 107)
 *
 * Covers:
 * - Task 1 (infrastructure): broadcast injection, clear-on-replace, no-serialization
 * - Task 2 (API): requestHint / clearHint lifecycle (added by Task 2)
 * - Task 3 (heatmap): setHeatmapVisible / buildHeatmapEntries (added by Task 3)
 *
 * Test game: minimal two-player loop so we can occupy a decision point.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { GameSession } from './game-session.js';
import type { PlayerGameState, BroadcastAdapter } from './types.js';

// ============================================
// Minimal test game: two players, choose from 3 options per turn.
// chooseFrom with 3+ choices means MCTS won't short-circuit the single-move path.
// ============================================

class TeachingTestGame extends Game<TeachingTestGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: ['a', 'b', 'c'],
        })
        .execute(() => {})
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      })
    );
  }
}

// ============================================
// Helpers
// ============================================

type CapturedState = {
  seat: number;
  state: PlayerGameState;
};

function makeMockBroadcaster(
  sessions: Array<{ playerSeat: number; isSpectator: boolean }>,
  captured: CapturedState[]
): BroadcastAdapter {
  return {
    getSessions: () => sessions,
    send: (_session: { playerSeat: number; isSpectator: boolean }, update: Record<string, unknown>) => {
      const seat = (_session as { playerSeat: number }).playerSeat;
      captured.push({ seat, state: (update as { state: PlayerGameState }).state });
    },
  } as unknown as BroadcastAdapter;
}

function makeSession() {
  const session = GameSession.create({
    gameType: 'teaching-test',
    GameClass: TeachingTestGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
  });
  return session;
}

// ============================================
// Task 1: no-serialization invariant
// ============================================

describe('teaching state — no-serialization invariant', () => {
  it('runner snapshot never contains hint, heatmap, or narration fields', () => {
    const session = makeSession();
    const snapshot = session.runner.getSnapshot();

    // Teaching fields are session-layer only — they must never appear in the
    // engine's serialization surface. If any of these appear, a regression
    // has leaked transient UI state into persistent storage.
    expect((snapshot as Record<string, unknown>)['hint']).toBeUndefined();
    expect((snapshot as Record<string, unknown>)['heatmap']).toBeUndefined();
    expect((snapshot as Record<string, unknown>)['narration']).toBeUndefined();
  });

  it('captureCheckpoint does not contain teaching fields', async () => {
    const session = makeSession();

    // Perform an action to generate a checkpoint
    await session.performAction('pick', 1, { option: 'a' });

    const snapshot = session.runner.getSnapshot();
    expect((snapshot as Record<string, unknown>)['hint']).toBeUndefined();
    expect((snapshot as Record<string, unknown>)['heatmap']).toBeUndefined();
    expect((snapshot as Record<string, unknown>)['narration']).toBeUndefined();
  });
});

// ============================================
// Task 1: broadcast injection
// ============================================

describe('teaching state — broadcast injection', () => {
  it('broadcast state has no hint/heatmap/narration when none is set', () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    expect(captured).toHaveLength(1);
    const state = captured[0]!.state;
    // No teaching state was set — fields should be absent (undefined)
    expect(state.hint).toBeUndefined();
    expect(state.heatmap).toBeUndefined();
    expect(state.narration).toBeUndefined();
  });

  // Injection positive case: after requestHint(), state.hint is populated.
  // This test is RED until Task 2 implements requestHint().
  it('broadcast state includes hint annotation when requestHint has been called', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    // RED: requestHint does not exist yet — this will fail with TypeError
    await (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(1);

    expect(captured.at(-1)!.state.hint).toBeDefined();
    expect(captured.at(-1)!.state.hint!.annotation.text).toBe('Suggested move');
  });
});

// ============================================
// Task 1: clear-on-replace (undo/rewind)
// ============================================

describe('teaching state — clear-on-replace', () => {
  // After requestHint + undo, stale hint must be gone.
  // RED until Task 2 implements requestHint().
  it('undo clears stale hint from broadcast state', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    // Perform an action so undo is available
    await session.performAction('pick', 1, { option: 'a' });
    captured.length = 0; // Reset captured

    // Set a hint (RED: not yet implemented)
    await (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(1);

    // Undo replaces the runner; clear-on-replace must remove the hint
    await session.undo(1);
    const lastState = captured.at(-1)!.state;
    expect(lastState.hint).toBeUndefined();
  });
});
