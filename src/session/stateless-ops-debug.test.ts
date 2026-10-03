import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, DEBUG_OP_TYPES, type GameDefinitionLike, type Op, type OpResult } from './stateless-ops.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { GameSession } from './game-session.js';
import { boundaryKeyOf, boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { collectFixtureDefinition } from './testing/fixtures/collect-fixture.js';

// ---------------------------------------------------------------------------
// Inline game: player 1 repeatedly passes in a loop (player 1 stays current, so
// history/state-at/rewind have a clean linear timeline to walk).
// ---------------------------------------------------------------------------

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! , turnScope: 'restart' }),
        }),
      }),
    );
  }
}

const passDef: GameDefinitionLike = {
  gameClass: PassGame,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
};
const passOptions = { playerCount: 2, seed: 'debug-seed' };

/** Start a PassGame and apply N pass actions; return the latest snapshot. */
async function passNTimes(n: number): Promise<unknown> {
  let snapshot = (await executeOp(passDef, passOptions, null, null, { type: 'start' })).snapshot;
  for (let i = 0; i < n; i++) {
    const res = await executeOp(passDef, passOptions, snapshot, null, {
      type: 'action',
      actionName: 'pass',
      player: 1,
      args: {},
      boundaryKey: boundaryKeyOf(snapshot),
    });
    expect(res.success).toBe(true);
    snapshot = res.snapshot;
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// View-tree helpers for deck-surgery assertions
// ---------------------------------------------------------------------------

interface ViewNode {
  id?: number;
  className?: string;
  children?: ViewNode[];
}

/** The view tree for player 1 from an OpResult. */
function view(res: OpResult): ViewNode {
  return (res.playerViews[0] as { state: { view: ViewNode } }).state.view;
}

/** Find the first node of a given element className anywhere in the tree. */
function findByClass(root: ViewNode, className: string): ViewNode | null {
  if (root.className === className) return root;
  for (const child of root.children ?? []) {
    const hit = findByClass(child, className);
    if (hit) return hit;
  }
  return null;
}

/** Find a node by id anywhere in the tree. */
function findById(root: ViewNode, id: number): ViewNode | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeOp debug ops', () => {
  describe('debugHistory', () => {
    it('returns the full action history', async () => {
      const snapshot = await passNTimes(3);
      const res = await executeOp(passDef, passOptions, snapshot, null, { type: 'debugHistory' }, { debug: true });
      expect(res.success).toBe(true);
      expect(res.actionHistory).toHaveLength(3);
    });
  });

  describe('debugStateAt', () => {
    it('returns a player state for each historical index', async () => {
      const snapshot = await passNTimes(2);
      for (const actionIndex of [0, 1, 2]) {
        const res = await executeOp(passDef, passOptions, snapshot, null, {
          type: 'debugStateAt',
          actionIndex,
          player: 1,
        }, { debug: true });
        expect(res.success).toBe(true);
        expect(res.historicalState).toBeTruthy();
        expect((res.historicalState as { view: unknown }).view).toBeTruthy();
      }
    });

    it('fails for an out-of-range action index', async () => {
      const snapshot = await passNTimes(1);
      const res = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugStateAt',
        actionIndex: 99,
        player: 1,
      }, { debug: true });
      expect(res.success).toBe(false);
    });
  });

  describe('debugStateDiff', () => {
    it('returns added/removed/changed id lists', async () => {
      const snapshot = await passNTimes(2);
      const res = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugStateDiff',
        fromIndex: 0,
        toIndex: 2,
        player: 1,
      }, { debug: true });
      expect(res.success).toBe(true);
      const diff = res.diff as { added: number[]; removed: number[]; changed: number[] };
      expect(Array.isArray(diff.added)).toBe(true);
      expect(Array.isArray(diff.removed)).toBe(true);
      expect(Array.isArray(diff.changed)).toBe(true);
    });
  });

  describe('debugActionTraces', () => {
    it('returns traces and flow context for the current player', async () => {
      const snapshot = await passNTimes(1);
      const res = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugActionTraces',
        player: 1,
      }, { debug: true });
      expect(res.success).toBe(true);
      expect(Array.isArray(res.traces)).toBe(true);
      const flow = res.flowContext as { currentPlayer?: number; isMyTurn: boolean };
      expect(flow.currentPlayer).toBe(1);
      expect(flow.isMyTurn).toBe(true);
    });
  });

  describe('debugRewind', () => {
    it('truncates the action history to the rewind point', async () => {
      const snapshot = await passNTimes(3);
      const rewind = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugRewind',
        actionIndex: 1,
      }, { debug: true });
      expect(rewind.success).toBe(true);

      const history = await executeOp(passDef, passOptions, rewind.snapshot, null, { type: 'debugHistory' }, { debug: true });
      expect(history.actionHistory).toHaveLength(1);
    });

    it('fails for an out-of-range action index', async () => {
      const snapshot = await passNTimes(1);
      const res = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugRewind',
        actionIndex: 99,
      }, { debug: true });
      expect(res.success).toBe(false);
    });
  });

  describe('deck surgery', () => {
    const collectOptions = { playerCount: 2, seed: 's' };
    const startCollect = () => executeOp(collectFixtureDefinition, collectOptions, null, null, { type: 'start' });

    it('debugReorder moves a card to the target index within its deck', async () => {
      const start = await startCollect();
      const stash = findByClass(view(start), 'Stash')!;
      expect(stash.children!.length).toBeGreaterThanOrEqual(3);
      const movedId = stash.children![0].id!;

      const res = await executeOp(collectFixtureDefinition, collectOptions, start.snapshot, null, {
        type: 'debugReorder',
        cardId: movedId,
        targetIndex: stash.children!.length - 1,
      }, { debug: true });
      expect(res.success).toBe(true);

      const newStash = findById(view(res), stash.id!)!;
      expect(newStash.children![newStash.children!.length - 1].id).toBe(movedId);
    });

    it('debugTransfer moves a card into a different deck', async () => {
      const start = await startCollect();
      const stash = findByClass(view(start), 'Stash')!;
      const held = findByClass(view(start), 'Held')!;
      const movedId = stash.children![0].id!;

      const res = await executeOp(collectFixtureDefinition, collectOptions, start.snapshot, null, {
        type: 'debugTransfer',
        cardId: movedId,
        targetDeckId: held.id!,
        position: 'last',
      }, { debug: true });
      expect(res.success).toBe(true);

      const newHeld = findById(view(res), held.id!)!;
      expect(findById(newHeld, movedId)).toBeTruthy();
    });

    it('debugShuffle succeeds on a real deck and fails on an unknown id', async () => {
      const start = await startCollect();
      const stash = findByClass(view(start), 'Stash')!;

      const ok = await executeOp(collectFixtureDefinition, collectOptions, start.snapshot, null, {
        type: 'debugShuffle',
        deckId: stash.id!,
      }, { debug: true });
      expect(ok.success).toBe(true);

      const bad = await executeOp(collectFixtureDefinition, collectOptions, start.snapshot, null, {
        type: 'debugShuffle',
        deckId: 999999,
      }, { debug: true });
      expect(bad.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// #481: debug ops run only when the host turns debugging on, and a seat can
// never use one to read another seat's view. Three hosts run debug ops: the
// pure `executeOp` (ShufflewickPub's executor and the dev host),
// `SnapshotSessionHost`, and `GameSession`. The dev host's wire bridge is
// checked in `src/cli/dev-host/bridge.test.ts`.
// ---------------------------------------------------------------------------

/** One instance of every debug op, each valid against a two-pass game. */
const EVERY_DEBUG_OP: Op[] = [
  { type: 'debugHistory' },
  { type: 'debugStateAt', actionIndex: 1, player: 1 },
  { type: 'debugStateDiff', fromIndex: 0, toIndex: 1, player: 1 },
  { type: 'debugActionTraces', player: 1 },
  { type: 'debugFlowState', player: 1 },
  { type: 'debugRewind', actionIndex: 1 },
  { type: 'debugReorder', cardId: 1, targetIndex: 0 },
  { type: 'debugTransfer', cardId: 1, targetDeckId: 1, position: 'first' },
  { type: 'debugShuffle', deckId: 1 },
];

/** The debug ops that report one seat's view. */
const SEAT_VIEW_OPS: Op[] = [
  { type: 'debugStateAt', actionIndex: 1, player: 2 },
  { type: 'debugStateDiff', fromIndex: 0, toIndex: 1, player: 2 },
  { type: 'debugActionTraces', player: 2 },
  { type: 'debugFlowState', player: 2 },
];

describe('#481 debug op gate', () => {
  it('the test list names every debug op the engine has', () => {
    expect(new Set(EVERY_DEBUG_OP.map((op) => op.type))).toEqual(new Set(DEBUG_OP_TYPES));
  });

  describe('executeOp', () => {
    for (const op of EVERY_DEBUG_OP) {
      it(`refuses ${op.type} when the host has not turned debugging on`, async () => {
        const snapshot = await passNTimes(2);
        for (const hostOptions of [undefined, null, {}, { debug: false }]) {
          const res = await executeOp(passDef, passOptions, snapshot, null, op, hostOptions);
          expect(res.success).toBe(false);
          expect(res.error).toMatch(/debugging is not turned on/i);
          expect(res.snapshot).toBeNull();
        }
      });
    }

    it('runs a debug op when the host turns debugging on', async () => {
      const snapshot = await passNTimes(2);
      const res = await executeOp(passDef, passOptions, snapshot, null, { type: 'debugHistory' }, { debug: true });
      expect(res.success).toBe(true);
      expect(res.actionHistory).toHaveLength(2);
    });
  });

  describe('SnapshotSessionHost', () => {
    /** A host whose executor would run any debug op, so only the host's own gate can refuse. */
    async function startedHost(debug: boolean | undefined) {
      const executed: Op['type'][] = [];
      const host = new SnapshotSessionHost({
        playerCount: 2,
        debug,
        executeOp: (snap, pend, op) => {
          executed.push(op.type);
          return executeOp(passDef, op.type === 'start' ? passOptions : { playerCount: 2 }, snap, pend, op, { debug: true });
        },
        broadcast: () => {},
      });
      await host.start();
      for (let i = 0; i < 2; i++) {
        const res = await host.handleOp(1, {
          type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
        });
        expect(res.success).toBe(true);
      }
      executed.length = 0;
      return { host, executed };
    }

    for (const debug of [undefined, false]) {
      it(`refuses every debug op, without running it, when debug is ${String(debug)}`, async () => {
        const { host, executed } = await startedHost(debug);
        for (const op of EVERY_DEBUG_OP) {
          const res = await host.handleOp(1, op);
          expect(res.success, op.type).toBe(false);
          expect(res.error).toMatch(/debugging is not turned on/i);
        }
        expect(executed).toEqual([]);
      });
    }

    it('runs debug ops when debugging is on', async () => {
      const { host } = await startedHost(true);
      const res = await host.handleOp(1, { type: 'debugHistory' });
      expect(res.success).toBe(true);
      expect(res.actionHistory).toHaveLength(2);
    });

    for (const op of SEAT_VIEW_OPS) {
      it(`refuses ${op.type} for another seat's view even with debugging on`, async () => {
        const { host, executed } = await startedHost(true);
        const res = await host.handleOp(1, op);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/seat 1 asked for seat 2's view/i);
        expect(executed).toEqual([]);
      });

      it(`runs ${op.type} for the requesting seat's own view`, async () => {
        const { host } = await startedHost(true);
        const res = await host.handleOp(2, op);
        expect(res.success).toBe(true);
      });
    }
  });

  describe('GameSession', () => {
    function session(debugEnabled?: boolean) {
      return GameSession.create<PassGame>({
        gameType: 'pass',
        GameClass: PassGame,
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'debug-gate',
        debugEnabled,
      });
    }

    async function passTwice(s: GameSession<PassGame>) {
      for (let i = 0; i < 2; i++) {
        const res = await s.performAction('pass', 1, {});
        expect(res.success).toBe(true);
      }
    }

    const calls: Array<[string, (s: GameSession<PassGame>) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string }]> = [
      ['getStateAtAction', (s) => s.getStateAtAction(1, 1)],
      ['getStateDiff', (s) => s.getStateDiff(0, 1, 1)],
      ['getActionTraces', (s) => s.getActionTraces(1)],
      ['rewindToAction', (s) => s.rewindToAction(1)],
      ['executeDebugCommand', (s) => s.executeDebugCommand({ type: 'SHUFFLE', spaceId: 1 })],
      ['moveCardToTop', (s) => s.moveCardToTop(1)],
      ['reorderCard', (s) => s.reorderCard(1, 0)],
      ['transferCard', (s) => s.transferCard(1, 1)],
      ['shuffleDeck', (s) => s.shuffleDeck(1)],
    ];

    for (const [name, call] of calls) {
      it(`${name} is refused unless the session was created with debugEnabled`, async () => {
        const s = session();
        await passTwice(s);
        const res = await call(s);
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/debugging is not turned on/i);
        expect(s.getHistory().actionHistory).toHaveLength(2);
      });
    }

    it('debug calls run when the session was created with debugEnabled', async () => {
      const s = session(true);
      await passTwice(s);
      expect(s.getStateAtAction(1, 1).success).toBe(true);
      expect((await s.rewindToAction(1)).success).toBe(true);
    });

    it('a session restored without debugEnabled refuses debug calls, even if the saved one had it on', async () => {
      const original = session(true);
      await passTwice(original);
      const stored = JSON.parse(JSON.stringify(original.storedState));

      const restored = GameSession.restore<PassGame>(stored, PassGame);
      for (const [name, call] of calls) {
        const res = await call(restored);
        expect(res.success, name).toBe(false);
        expect(res.error).toMatch(/debugging is not turned on/i);
      }

      const restoredWithDebug = GameSession.restore<PassGame>(
        JSON.parse(JSON.stringify(original.storedState)), PassGame,
        undefined, undefined, undefined, undefined, undefined, undefined, true,
      );
      const at = restoredWithDebug.getStateAtAction(0, 1);
      expect(at.success, at.error).toBe(true);
    });
  });
});
