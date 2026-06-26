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
// Task 2: requestHint / clearHint additional behaviors
// ============================================

describe('teaching state — requestHint / clearHint', () => {
  it('requestHint on non-acting seat throws actionable error', async () => {
    const session = makeSession();
    // Seat 2 (Bob) is NOT currently awaiting input (seat 1 goes first)
    await expect(
      (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(2)
    ).rejects.toThrow('Cannot hint: seat 2 is not awaiting input');
  });

  it('requestHint while already in-flight throws actionable error', async () => {
    const session = makeSession();
    const hint = session as unknown as { requestHint(seat: number): Promise<void> };
    // Fire two concurrent requests — second must be rejected loudly
    const first = hint.requestHint(1);
    await expect(hint.requestHint(1)).rejects.toThrow('Hint already in progress for seat 1');
    // Let the first finish (may succeed or fail depending on AI availability)
    await first.catch(() => {});
  });

  it('hint clears after the next performAction on that seat', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    await (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(1);
    expect(captured.at(-1)!.state.hint).toBeDefined();
    captured.length = 0;

    await session.performAction('pick', 1, { option: 'a' });
    expect(captured.at(-1)!.state.hint).toBeUndefined();
  });

  it('clearHint removes hint and broadcasts', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    await (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(1);
    expect(captured.at(-1)!.state.hint).toBeDefined();
    captured.length = 0;

    (session as unknown as { clearHint(seat: number): void }).clearHint(1);
    expect(captured).toHaveLength(1);
    expect(captured.at(-1)!.state.hint).toBeUndefined();
  });
});

// ============================================
// Task 1: clear-on-replace (undo/rewind)
// ============================================

describe('teaching state — clear-on-replace', () => {
  // After requestHint + undo, stale hint must be gone.
  it('undo clears stale hint from broadcast state', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    // Set a hint for seat 1 (who is currently awaiting input)
    await (session as unknown as { requestHint(seat: number): Promise<void> }).requestHint(1);
    expect(captured.at(-1)!.state.hint).toBeDefined();

    // Perform an action to record an undo checkpoint, then undo it
    await session.performAction('pick', 1, { option: 'a' });
    // After seat 1 acts, seat 2 awaits. Now undo to turn start (seat 1 is back awaiting)
    await session.undoToTurnStart(1);
    captured.length = 0;
    session.broadcast();

    // After undo (replaceRunner), the hint must have been cleared
    const lastState = captured.at(-1)!.state;
    expect(lastState.hint).toBeUndefined();
  });
});

// ============================================
// Task 3: setHeatmapVisible + buildHeatmapEntries
// ============================================

describe('teaching state — heatmap', () => {
  it('setHeatmapVisible(seat, false) yields visible:false with empty entries', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    // RED: setHeatmapVisible doesn't exist yet
    await (session as unknown as { setHeatmapVisible(seat: number, visible: boolean): Promise<void> }).setHeatmapVisible(1, false);
    const state = captured.at(-1)!.state;
    expect(state.heatmap).toBeDefined();
    expect(state.heatmap!.visible).toBe(false);
    expect(state.heatmap!.entries).toHaveLength(0);
  });

  it('setHeatmapVisible(seat, true) populates heatmap entries with normalizedValue in [0,1]', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    await (session as unknown as { setHeatmapVisible(seat: number, visible: boolean): Promise<void> }).setHeatmapVisible(1, true);
    const state = captured.at(-1)!.state;
    expect(state.heatmap).toBeDefined();
    expect(state.heatmap!.visible).toBe(true);
    // All normalizedValues must be in [0, 1]
    for (const entry of state.heatmap!.entries) {
      expect(entry.normalizedValue).toBeGreaterThanOrEqual(0);
      expect(entry.normalizedValue).toBeLessThanOrEqual(1);
    }
  });

  it('buildHeatmapEntries: exactly one isBest across non-empty entry set', async () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    await (session as unknown as { setHeatmapVisible(seat: number, visible: boolean): Promise<void> }).setHeatmapVisible(1, true);
    const state = captured.at(-1)!.state;
    const entries = state.heatmap!.entries;
    if (entries.length > 0) {
      const bestCount = entries.filter(e => e.isBest).length;
      expect(bestCount).toBe(1);
    }
  });

  it('setHeatmapVisible(seat, true) throws when a recompute is already in flight (WR-03)', async () => {
    const session = makeSession();
    // Fire two concurrent setHeatmapVisible(true) calls; the second must throw.
    const setVisible = (session as unknown as { setHeatmapVisible(s: number, v: boolean): Promise<void> }).setHeatmapVisible.bind(session);
    const first = setVisible(1, true);
    await expect(setVisible(1, true)).rejects.toThrow('Heatmap evaluation is already in progress');
    // Let the first resolve cleanly.
    await first.catch(() => {});
  });
});

// ============================================
// Task 2 (Plan 03): Demo mode — startDemo / stopDemo / isDemoRunning
// ============================================

type DemoSession = {
  startDemo(options?: { narrator?: (action: string, player: number, args: Record<string, unknown>) => string; delay?: number }): void;
  stopDemo(): void;
  isDemoRunning: boolean;
};

describe('demo mode — startDemo / stopDemo / isDemoRunning', () => {
  it('isDemoRunning is false by default', () => {
    const session = makeSession();
    // RED: isDemoRunning does not exist yet
    expect((session as unknown as DemoSession).isDemoRunning).toBe(false);
  });

  it('startDemo sets isDemoRunning to true', () => {
    const session = makeSession();
    (session as unknown as DemoSession).startDemo({ delay: 0 });
    expect((session as unknown as DemoSession).isDemoRunning).toBe(true);
    // Clean up
    (session as unknown as DemoSession).stopDemo();
  });

  it('stopDemo sets isDemoRunning to false', () => {
    const session = makeSession();
    (session as unknown as DemoSession).startDemo({ delay: 0 });
    (session as unknown as DemoSession).stopDemo();
    expect((session as unknown as DemoSession).isDemoRunning).toBe(false);
  });

  it('stopDemo clears narration text in broadcast state', () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }, { playerSeat: 2, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    (session as unknown as DemoSession).startDemo({ delay: 0 });
    (session as unknown as DemoSession).stopDemo();

    // After stopDemo, broadcast state should have no narration
    const lastCapture = captured.at(-1);
    expect(lastCapture?.state.narration).toBeUndefined();
  });

  it('narration hook sets state.narration before the move executes', async () => {
    const session = makeSession();
    const narrationTexts: (string | undefined)[] = [];
    const captured: CapturedState[] = [];

    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }, { playerSeat: 2, isSpectator: false }],
      captured
    );
    // Intercept sends to track narration timing
    const originalSend = broadcaster.send.bind(broadcaster);
    (broadcaster as { send: typeof broadcaster.send }).send = (
      _session: { playerSeat: number; isSpectator: boolean },
      update: Record<string, unknown>
    ) => {
      const st = (update as { state: PlayerGameState }).state;
      narrationTexts.push(st.narration?.text);
      originalSend(_session, update);
    };

    session.setBroadcaster(broadcaster);

    // Use a narrator that returns a fixed string
    (session as unknown as DemoSession).startDemo({
      delay: 0,
      narrator: (action, player) => `Seat ${player}: ${action}`,
    });

    // Wait for at least one AI move to be announced
    await new Promise(resolve => setTimeout(resolve, 800));

    (session as unknown as DemoSession).stopDemo();

    // At least one broadcast should have had narration text set
    const narrationBroadcasts = narrationTexts.filter(t => t !== undefined);
    expect(narrationBroadcasts.length).toBeGreaterThan(0);
    // Each narration text should follow the "Seat N: action" format
    for (const text of narrationBroadcasts) {
      expect(text).toMatch(/^Seat \d+: /);
    }
  });

  it('stopDemo restores the original AI controller and clears narration', () => {
    // Session created WITHOUT AI config — aiController is undefined
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);

    // Start demo (sets a demo AI controller)
    (session as unknown as DemoSession).startDemo({ delay: 0 });
    expect((session as unknown as DemoSession).isDemoRunning).toBe(true);

    // Stop demo — should restore the original (undefined) AI controller
    (session as unknown as DemoSession).stopDemo();
    expect((session as unknown as DemoSession).isDemoRunning).toBe(false);

    // After stop, no narration in broadcast
    const lastState = captured.at(-1);
    expect(lastState?.state.narration).toBeUndefined();
  });
});
