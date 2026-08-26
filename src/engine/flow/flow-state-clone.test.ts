/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../../session/headless-session.js';
import { GameRunner } from '../../runtime/runner.js';
import {
  Game,
  GameElement,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  type FlowContext,
  type GameOptions,
  type GameStateSnapshot,
} from '../index.js';
import { EachPlayerGame } from '../../session/testing/fixtures/each-player-fixture.js';
import type { GameDefinitionLike } from '../../session/stateless-ops.js';
import type { FlowState } from './types.js';

/**
 * BSMITH-04, second half: the `eachPlayer` clone bug is closed as a CLASS, not
 * as an instance.
 *
 * `getPosition()` serializes `variables` with the general recursive
 * `serializeFlowVariables`, so a live `GameElement`/`Player` bound by
 * `eachPlayer`/`forEach` survives the structured-clone boundary (postMessage in
 * the iframe host, the executor RPC, the DO's storage envelope). This file
 * asserts the SAME property for the whole `FlowState` — including
 * `position.frameData`, which used to be spread raw with a single hand-written
 * `previousPlayer` special case.
 *
 * The fixture list is DERIVED from `src/session/testing/fixtures/` at load time
 * (`import.meta.glob`), so a fixture added to that directory is covered here
 * automatically and cannot escape by not being added to a hand-written list.
 *
 * Deliberately NOT duplicated here: `src/session/testing/eachplayer-clone.test.ts`
 * (the narrow `eachPlayer` broadcast case) and
 * `src/runtime/flow-variable-relink.test.ts` (the `forEach` snapshot relink).
 */

// ---------------------------------------------------------------------------
// The derived fixture registry
// ---------------------------------------------------------------------------

const fixtureModules = import.meta.glob('../../session/testing/fixtures/*.ts', {
  eager: true,
}) as Record<string, Record<string, unknown>>;

function isGameDefinition(value: unknown): value is GameDefinitionLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameDefinitionLike>;
  return typeof candidate.gameType === 'string' && typeof candidate.gameClass === 'function';
}

const FIXTURES: Array<{ file: string; exportName: string; def: GameDefinitionLike }> = [];
for (const [file, module] of Object.entries(fixtureModules)) {
  for (const [exportName, value] of Object.entries(module)) {
    if (isGameDefinition(value)) {
      FIXTURES.push({ file: file.split('/').pop()!, exportName, def: value });
    }
  }
}
FIXTURES.sort((a, b) => a.exportName.localeCompare(b.exportName));

/** Every `.ts` file under fixtures/ must contribute at least one definition —
 *  otherwise the glob silently covers less than the directory holds. */
const FIXTURE_FILES = new Set(Object.keys(fixtureModules).map((f) => f.split('/').pop()!));

/** How many steps to drive each fixture. Enough for `eachPlayer`/`forEach` to
 *  bind their loop variable and for a sequence to advance past its first child. */
const STEPS = 8;

/** A serialized element marker, as `serializeFlowVariables` writes it. */
interface Marker {
  __flowElementId: number;
  className: string;
}

/** A LIVE `GameElement` is not a marker, and its parent back-references would
 *  make a naive recursion blow the stack — so it terminates the walk. */
function walkable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !(value instanceof GameElement);
}

function isMarker(value: Record<string, unknown>): value is Record<string, unknown> & Marker {
  return typeof value.__flowElementId === 'number' && typeof value.className === 'string';
}

const markerLabel = (path: string, id: number): string => `${path || '<root>'}=${id}`;
const childPath = (path: string, key: string): string => (path ? `${path}.${key}` : key);

/** Every serialized element marker in a value, as `path=elementId`. */
function findMarkers(value: unknown, path = '', found: string[] = []): string[] {
  if (!walkable(value)) return found;
  if (isMarker(value)) {
    found.push(markerLabel(path, value.__flowElementId));
    return found;
  }
  // `Object.entries` covers arrays too (index keys), so one walk handles both.
  for (const [key, entry] of Object.entries(value)) {
    findMarkers(entry, childPath(path, key), found);
  }
  return found;
}

/** The marker set of a serialized position, order-independent. */
function positionMarkers(position: { variables?: unknown; frameData?: unknown }): string[] {
  return [
    ...findMarkers(position.variables, 'variables'),
    ...findMarkers(position.frameData, 'frameData'),
  ].sort();
}

/** The live engine of a game, for asserting on RELINKED (post-restore) state. */
interface LiveFlowEngine {
  variables: Record<string, unknown>;
  stack: Array<{ data?: Record<string, unknown> }>;
}
function liveEngineOf(game: unknown): LiveFlowEngine {
  const engine = (game as { _flowEngine?: LiveFlowEngine })._flowEngine;
  if (!engine) throw new Error('game has no live flow engine — did you forget to start()?');
  return engine;
}

async function driveFixture(def: GameDefinitionLike) {
  const playerCount = def.minPlayers ?? 2;
  const seats = Array.from({ length: playerCount }, (_, i) => ({ seat: i + 1, level: 'easy' }));
  // botSeats is deliberately EMPTY: a bot roster makes the host's pump run the
  // whole game (minutes, for the MCTS fixtures). Sending `botTurn` by hand plays
  // exactly one due seat per call, which is the bounded "several steps" this
  // test needs.
  const session = createHeadlessSession(def, { playerCount, seed: 'flow-state-clone' }, []);
  await session.start();
  let steps = 0;
  for (let i = 0; i < STEPS; i++) {
    const flowState = session.host.flowState as FlowState | null;
    if (!flowState || flowState.complete) break;
    const result = await session.host.handleOp(1, { type: 'botTurn', seats });
    if (!result.success) break;
    steps++;
  }
  return { session, steps, playerCount };
}

// ---------------------------------------------------------------------------
// The general case: every fixture, the WHOLE flow state
// ---------------------------------------------------------------------------

describe('the whole serialized flow state crosses the structured-clone boundary', () => {
  it('derives its fixture list from the fixtures directory', () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
    // Every fixture FILE contributes at least one definition. If a new fixture
    // file exports its definition under a shape `isGameDefinition` does not
    // recognise, this fails rather than silently covering less.
    const contributing = new Set(FIXTURES.map((f) => f.file));
    expect([...FIXTURE_FILES].filter((f) => !contributing.has(f))).toEqual([]);
  });

  const elementBindingSeen: string[] = [];
  const framePlantedIn: string[] = [];

  for (const { exportName, def } of FIXTURES) {
    it(`${exportName}: getState(), its frameData, and a restore round-trip`, async () => {
      const { session, steps } = await driveFixture(def);
      expect(steps).toBeGreaterThan(0);

      const flowState = session.host.flowState as FlowState;
      expect(flowState).toBeTruthy();

      // (a) The WHOLE state, not just position.variables.
      expect(() => structuredClone(flowState)).not.toThrow();

      // (b) frameData explicitly, so the gap this test exists to close has its
      //     own named assertion and not merely incidental coverage.
      expect(() => structuredClone(flowState.position.frameData)).not.toThrow();

      const markersBefore = positionMarkers(flowState.position);
      if (markersBefore.length > 0) elementBindingSeen.push(exportName);

      // (c) Restore a fresh game from the CLONED snapshot and assert the live
      //     engine holds relinked elements, never a leftover marker.
      const snapshot = structuredClone(session.host.snapshot) as GameStateSnapshot;
      const restored = GameRunner.fromSnapshot(
        snapshot,
        def.gameClass as Parameters<typeof GameRunner.fromSnapshot>[1],
      );

      // Nothing that was serialized OUT is still a marker in the live engine —
      // both in the flow variables and, crucially, in every frame's data.
      const engine = liveEngineOf(restored.game);
      expect(findMarkers(engine.variables)).toEqual([]);
      for (const frame of engine.stack) {
        expect(findMarkers(frame.data ?? {})).toEqual([]);
      }

      // ...and re-serializing the restored engine reproduces the SAME element
      // bindings, by id and by position. A relink that resolved to the wrong
      // element, or dropped one, changes this set.
      const restoredPosition = restored.game.getFlowState()?.position;
      expect(restoredPosition).toBeTruthy();
      expect(positionMarkers(restoredPosition!)).toEqual(markersBefore);

      // (d) The CLASS, for every fixture: a live element that lands in a
      //     frame's data under an arbitrary field name must serialize and
      //     relink exactly as a flow variable does. Games cannot write
      //     `frame.data` themselves today, so this is planted at the engine
      //     level -- but the engine writes `frame.data` from more than a
      //     dozen sites, and only `previousPlayer` used to be handled.
      const probeFrame = engine.stack[engine.stack.length - 1];
      if (!probeFrame) {
        // The fixture ran to completion inside STEPS moves, so there is no
        // frame left to plant in. Counted below so "no fixture was probed"
        // cannot pass silently.
        return;
      }
      framePlantedIn.push(exportName);
      probeFrame.data = { ...(probeFrame.data ?? {}), __cloneProbe: restored.game.getPlayer(1)! };

      const withProbe = restored.game.getFlowState()!;
      expect(() => structuredClone(withProbe)).not.toThrow();

      const reRestored = GameRunner.fromSnapshot(
        structuredClone(restored.getSnapshot()) as GameStateSnapshot,
        def.gameClass as Parameters<typeof GameRunner.fromSnapshot>[1],
      );
      const reEngine = liveEngineOf(reRestored.game);
      const probed = reEngine.stack
        .map((frame) => frame.data?.__cloneProbe)
        .find((value) => value !== undefined);
      expect(probed, 'the planted frame-data element survived the round trip').toBeDefined();
      expect(probed).toBe(reRestored.game.getPlayer(1));
    }, 20000);
  }

  it('the frame-data probe actually ran on most fixtures', () => {
    // Guards case (d) from being vacuous: a fixture that finished inside STEPS
    // moves has an empty stack and is skipped, so assert the majority were
    // genuinely probed.
    expect(framePlantedIn.length).toBeGreaterThanOrEqual(Math.ceil(FIXTURES.length / 2));
  });

  it('at least one fixture actually bound a live element into the flow state', () => {
    // Guards the assertions above from being vacuously true: if no fixture ever
    // produces an element marker, "no markers survive restore" proves nothing.
    expect(elementBindingSeen.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The targeted case: a live element in a frame's data
// ---------------------------------------------------------------------------

describe("a live element in a frame's data", () => {
  function startEachPlayer() {
    const runner = new GameRunner({
      GameClass: EachPlayerGame as unknown as Parameters<typeof GameRunner.fromSnapshot>[1],
      gameType: 'each-player',
      gameOptions: { playerCount: 2, seed: 'frame-data' },
    });
    runner.start();
    return runner;
  }

  it('round-trips under a field name that is not `previousPlayer`', () => {
    const runner = startEachPlayer();
    const engine = liveEngineOf(runner.game);
    const spotlight = runner.game.getPlayer(2)!;
    const topFrame = engine.stack[engine.stack.length - 1];
    topFrame.data = { ...(topFrame.data ?? {}), spotlight };

    // Before frame.data is routed through the general serializer this throws
    // DataCloneError: `spotlight` is a live Player, and only `previousPlayer`
    // had a hand-written special case.
    expect(() => structuredClone(runner.game.getFlowState())).not.toThrow();

    const restored = GameRunner.fromSnapshot(
      structuredClone(runner.getSnapshot()),
      EachPlayerGame as unknown as Parameters<typeof GameRunner.fromSnapshot>[1],
    );
    const restoredEngine = liveEngineOf(restored.game);
    const restoredTop = restoredEngine.stack[restoredEngine.stack.length - 1];
    const relinked = restoredTop.data?.spotlight;
    expect(relinked).toBeInstanceOf(Player);
    expect((relinked as Player).seat).toBe(2);
    expect(relinked).toBe(restored.game.getPlayer(2));
  });

  it('leaves plain frame data untouched, including the `eligibleSeats` number[] that turnSequence reads', () => {
    // `turnSequence`/`dueSeats` (src/engine/flow/seat-activity.ts) read
    // `position.frameData.__frame_N.eligibleSeats` as a `number[]`. Routing frame
    // data through the general serializer must not disturb plain values.
    const runner = startEachPlayer();
    const position = runner.game.getFlowState()!.position;
    const frames = Object.values(position.frameData ?? {});
    const withSeats = frames.find((f) => Array.isArray(f.eligibleSeats));
    expect(withSeats, 'the eachPlayer fixture should publish eligibleSeats').toBeTruthy();
    expect(withSeats!.eligibleSeats).toEqual([1, 2]);
    for (const seat of withSeats!.eligibleSeats as unknown[]) {
      expect(typeof seat).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// The regression the fix could otherwise introduce
// ---------------------------------------------------------------------------

class PlayerOverrideGame extends Game<PlayerOverrideGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: sequence(
          // Seat 2 acts under a `player:` override, which makes the engine save
          // the PREVIOUS current player (a live Player) into the frame's data.
          actionStep({
            actions: ['pass'],
            player: (ctx: FlowContext) => (ctx.game as PlayerOverrideGame).getPlayer(2)!,
          }),
          actionStep({ actions: ['pass'] }),
        ),
      }),
    );
  }
}

describe('`previousPlayer` (the case that used to have a hand-written special case)', () => {
  it('round-trips through a cloned snapshot and still restores the overridden player', () => {
    const runner = new GameRunner({
      GameClass: PlayerOverrideGame as unknown as Parameters<typeof GameRunner.fromSnapshot>[1],
      gameType: 'player-override',
      gameOptions: { playerCount: 2, seed: 'override' },
    });
    runner.start();

    const engine = liveEngineOf(runner.game);
    const saved = engine.stack.find((f) => f.data?.playerSaved === true);
    expect(saved, 'the override step should have saved the previous player').toBeTruthy();
    expect(saved!.data!.previousPlayer).toBeInstanceOf(Player);

    expect(() => structuredClone(runner.game.getFlowState())).not.toThrow();

    const restored = GameRunner.fromSnapshot(
      structuredClone(runner.getSnapshot()),
      PlayerOverrideGame as unknown as Parameters<typeof GameRunner.fromSnapshot>[1],
    );
    const restoredEngine = liveEngineOf(restored.game);
    const restoredSaved = restoredEngine.stack.find((f) => f.data?.playerSaved === true);
    expect(restoredSaved, 'the restored stack should still carry the saved frame').toBeTruthy();
    // A LIVE Player of the RESTORED tree — not a marker, and not an element of
    // the original game.
    expect(restoredSaved!.data!.previousPlayer).toBe(restored.game.getPlayer(1));

    // And it is behaviourally load-bearing: completing the overridden step hands
    // the turn back to the saved player.
    const overridden = restored.game.getFlowState()!.currentPlayer;
    expect(overridden).toBe(2);
    const result = restored.performAction('pass', 2, {});
    expect(result.success).toBe(true);
    expect(restored.game.getFlowState()!.currentPlayer).toBe(1);
  });
});
