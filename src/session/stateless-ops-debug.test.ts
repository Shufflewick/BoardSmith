import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike, type OpResult } from './stateless-ops.js';
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
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const passDef: GameDefinitionLike = {
  gameClass: PassGame as new (...args: unknown[]) => unknown,
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
      const res = await executeOp(passDef, passOptions, snapshot, null, { type: 'debugHistory' });
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
        });
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
      });
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
      });
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
      });
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
      });
      expect(rewind.success).toBe(true);

      const history = await executeOp(passDef, passOptions, rewind.snapshot, null, { type: 'debugHistory' });
      expect(history.actionHistory).toHaveLength(1);
    });

    it('fails for an out-of-range action index', async () => {
      const snapshot = await passNTimes(1);
      const res = await executeOp(passDef, passOptions, snapshot, null, {
        type: 'debugRewind',
        actionIndex: 99,
      });
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
      });
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
      });
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
      });
      expect(ok.success).toBe(true);

      const bad = await executeOp(collectFixtureDefinition, collectOptions, start.snapshot, null, {
        type: 'debugShuffle',
        deckId: 999999,
      });
      expect(bad.success).toBe(false);
    });
  });
});
