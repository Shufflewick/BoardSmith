/**
 * GameSession broadcast — flow-debug + pending-action introspection (Phase 123 Plan 04)
 *
 * Covers:
 * - flowDebugInfo.description is a non-empty string on every connected seat's broadcast state
 * - pendingAction is injected per-seat via GameSession.getPendingAction(effectivePosition)
 * - Perspective isolation (T-123-07): seat 2's broadcast NEVER contains seat 1's
 *   accumulated pending-action args
 */

import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import type { PlayerGameState, BroadcastAdapter } from './types.js';
import type { StorageAdapter } from './types.js';

// Two-step action (chooseFrom color -> chooseFrom size), awaited by seat 1 only,
// so we can leave it mid-flight while seat 2 is also connected.
class TwoStepGame extends Game<TwoStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute(() => {})
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['pick'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      })
    );
  }
}

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
  return GameSession.create({
    gameType: 'flow-debug-test',
    GameClass: TwoStepGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
  });
}

describe('GameSession broadcast — flowDebugInfo', () => {
  it('every connected seat receives a non-empty flowDebugInfo.description', () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [
        { playerSeat: 1, isSpectator: false },
        { playerSeat: 2, isSpectator: false },
      ],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    expect(captured).toHaveLength(2);
    for (const { state } of captured) {
      expect(state.flowDebugInfo).toBeDefined();
      expect(typeof state.flowDebugInfo!.description).toBe('string');
      expect(state.flowDebugInfo!.description.length).toBeGreaterThan(0);
      expect(Array.isArray(state.flowDebugInfo!.path)).toBe(true);
    }
  });
});

describe('GameSession broadcast — pendingAction perspective isolation (T-123-07)', () => {
  it("seat 2's broadcast never contains seat 1's accumulated pending-action args", () => {
    const session = makeSession();

    // Seat 1 begins (but does not complete) the two-step 'pick' action.
    const start = session.startPendingAction('pick', 1);
    expect(start.success).toBe(true);

    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [
        { playerSeat: 1, isSpectator: false },
        { playerSeat: 2, isSpectator: false },
      ],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    const seat1State = captured.find((c) => c.seat === 1)!.state;
    const seat2State = captured.find((c) => c.seat === 2)!.state;

    // Seat 1 sees its OWN pending action.
    expect(seat1State.pendingAction).toBeDefined();
    expect(seat1State.pendingAction!.actionName).toBe('pick');

    // Seat 2 must never see seat 1's pending action — the primary flagged threat.
    expect(seat2State.pendingAction).toBeUndefined();
  });

  it('a spectator (effectivePosition 0) receives flowDebugInfo but no pending action', () => {
    const session = makeSession();
    session.startPendingAction('pick', 1);

    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: true }],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    const spectatorState = captured[0]!.state;
    expect(spectatorState.flowDebugInfo).toBeDefined();
    expect(spectatorState.pendingAction).toBeUndefined();
  });
});

// Action with an onSelect callback so `onSelectFired` (a Set<number> on the
// live engine state) is actually populated — needed to exercise CR-01's
// Set -> Array wire-safety bug.
class OnSelectGame extends Game<OnSelectGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'], onSelect: () => {} })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute(() => {})
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['pick'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      })
    );
  }
}

describe('GameSession broadcast — pendingAction is serialized, not the live state (CR-01)', () => {
  it('broadcasts a JSON-safe copy: onSelectFired is an array, and mutating live state after broadcast does not affect the captured payload', async () => {
    const session = GameSession.create({
      gameType: 'onselect-test',
      GameClass: OnSelectGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    // Trigger the 'color' selection's onSelect callback, populating
    // onSelectFired on the live PendingActionState.
    const step = await session.processSelectionStep(1, 'color', 'red', 'pick');
    expect(step.success).toBe(true);

    // Sanity: the live manager state really does hold a Set (proves the test
    // is exercising the bug, not a no-op).
    const live = session.getPendingAction(1);
    expect(live).toBeDefined();
    expect(live!.onSelectFired).toBeInstanceOf(Set);

    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: false }],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    const broadcastPending = captured[0]!.state.pendingAction;
    expect(broadcastPending).toBeDefined();

    // The broadcast payload must be JSON-safe: a plain array, not a Set (a
    // Set silently serializes to "{}" over JSON.stringify).
    expect(Array.isArray(broadcastPending!.onSelectFired)).toBe(true);
    expect(broadcastPending!.onSelectFired).toEqual([0]);

    // The broadcast payload must be a copy, not the live mutable object: it
    // must NOT be identity-equal to the manager's live state, nor share the
    // same collectedArgs object.
    const liveAfter = session.getPendingAction(1);
    expect(broadcastPending).not.toBe(liveAfter);
    expect(broadcastPending!.collectedArgs).not.toBe(liveAfter!.collectedArgs);

    // Mutating the live manager's state after broadcast must never retroactively
    // change the already-captured broadcast payload (proves it was a real copy,
    // not an alias to the same object the engine keeps mutating).
    (liveAfter as { collectedArgs: Record<string, unknown> }).collectedArgs.color = 'mutated';
    expect(broadcastPending!.collectedArgs.color).toBe('red');
  });
});

// ============================================
// Persistence hook + persistenceHealthy (Phase 126 Plan 02, ERR-03)
// ============================================

// Player 1 repeats a no-op 'move' action indefinitely, so a single test can
// drive multiple consecutive performAction()-triggered saves.
class RepeatMoveGame extends Game<RepeatMoveGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('move').execute(() => ({ success: true }))
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({
            actions: ['move'],
            player: (ctx) => ctx.game.getPlayer(1)!,
          }),
        }),
      })
    );
  }
}

function makeFailingStorage(shouldFail: () => boolean): StorageAdapter {
  return {
    save: vi.fn(async () => {
      if (shouldFail()) throw new Error('disk full: /var/lib/boardsmith/state.json');
    }),
    load: async () => null,
  };
}

function makeRepeatMoveSession(storage: StorageAdapter, onPersistenceError?: (error: { message: string; timestamp: number }, count: number, healthy: boolean) => void) {
  return GameSession.create({
    gameType: 'repeat-move-test',
    GameClass: RepeatMoveGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
    storage,
    onPersistenceError,
  });
}

describe('GameSession persistence hook (ERR-03)', () => {
  it('a rejecting storage save on a normal action resolves performAction (never throws) and sets lastPersistenceError + fires onPersistenceError', async () => {
    const storage = makeFailingStorage(() => true);
    const captured: Array<{ error: { message: string; timestamp: number }; count: number; healthy: boolean }> = [];
    const session = makeRepeatMoveSession(storage, (error, count, healthy) => {
      captured.push({ error, count, healthy });
    });

    // The initial create() save also fails; wait a tick so it lands first.
    await new Promise(resolve => setTimeout(resolve, 0));
    captured.length = 0;

    await expect(session.performAction('move', 1, {})).resolves.not.toThrow();

    expect(session.lastPersistenceError).not.toBeNull();
    expect(session.lastPersistenceError!.message).toContain('disk full');
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]!.healthy).toBe(true); // 1st failure — still healthy
  });

  it('a successful save resets the consecutive-failure counter and keeps persistenceHealthy true', async () => {
    const storage = makeFailingStorage(() => false);
    const session = makeRepeatMoveSession(storage);

    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(true);
    expect(session.lastPersistenceError).toBeNull();
  });

  it('persistenceHealthy stays true for 1-2 consecutive failures and flips false on the 3rd, with onPersistenceError receiving healthy=false on that call', async () => {
    // create()'s own initial save shares the same consecutive-failure counter
    // as every other save site, so it must succeed here — the 3 failures
    // measured below are the ones under test, not conflated with create()'s.
    let fail = false;
    const storage = makeFailingStorage(() => fail);
    const healthyArgs: boolean[] = [];
    const session = makeRepeatMoveSession(storage, (_error, _count, healthy) => {
      healthyArgs.push(healthy);
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    fail = true;

    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(true);

    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(true);

    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(false);

    expect(healthyArgs.at(-1)).toBe(false);
  });

  it('recovers persistenceHealthy to true on the next successful save after flipping unhealthy', async () => {
    let fail = true;
    const storage = makeFailingStorage(() => fail);
    const session = makeRepeatMoveSession(storage);

    await new Promise(resolve => setTimeout(resolve, 0));

    await session.performAction('move', 1, {});
    await session.performAction('move', 1, {});
    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(false);

    fail = false;
    await session.performAction('move', 1, {});
    expect(session.persistenceHealthy).toBe(true);
  });

  it('lastPersistenceError.message never contains a stack trace', async () => {
    const storage = makeFailingStorage(() => true);
    const session = makeRepeatMoveSession(storage);

    await session.performAction('move', 1, {});

    const message = session.lastPersistenceError!.message;
    expect(message).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // no stack-frame text
    expect(message).not.toContain('.ts:');
    expect(message).not.toContain('.js:');
  });

  it('an onPersistenceError hook that itself throws is swallowed — never crashes gameplay', async () => {
    const storage = makeFailingStorage(() => true);
    const session = makeRepeatMoveSession(storage, () => {
      throw new Error('hook exploded');
    });

    await expect(session.performAction('move', 1, {})).resolves.not.toThrow();
    expect(session.lastPersistenceError).not.toBeNull();
  });
});
