import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, actionStep, deserializeAction, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
import { computeUndoInfo } from './utils.js';
import type { StoredGameState } from './types.js';

class Equipment extends Piece<EquipGame> {
  slot!: string;
}
class Stash extends Space<EquipGame> {}

class TwoStepGame extends Game<TwoStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', {
          choices: ['red', 'blue', 'green'],
          onSelect: (value, ctx) => {
            ctx.animate('color-picked', { color: value });
          },
        })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute(() => {})
    );

    this.setFlow(defineFlow({
      root: actionStep({
        actions: ['pick'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
    }));
  }
}

class EquipGame extends Game<EquipGame, Player> {
  stash!: Stash;

  constructor(options: GameOptions) {
    super(options);

    this.stash = this.create(Stash, 'stash');
    this.stash.create(Equipment, 'Sword', { slot: 'weapon' });
    this.stash.create(Equipment, 'Shield', { slot: 'armor' });
    this.stash.create(Equipment, 'Bow', { slot: 'weapon' });

    this.registerAction(
      Action.create('reEquip')
        .chooseFrom('unit', {
          choices: ['warrior', 'archer'],
          onSelect: (value, ctx) => {
            ctx.animate('equip-start', { unit: value });
          },
        })
        .chooseElement('equipment', {
          elementClass: Equipment,
          filter: (element) => (element as Equipment).slot === 'weapon',
        })
        .execute(() => {
          return {
            success: true,
            followUp: { action: 'reEquipContinue', args: { unitId: 1 } },
          };
        })
    );

    this.registerAction(
      Action.create('reEquipContinue')
        .chooseFrom('slot', { choices: ['weapon', 'armor'] })
        .execute(() => {})
    );

    this.setFlow(defineFlow({
      root: actionStep({
        actions: ['reEquip', 'reEquipContinue'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
    }));
  }
}

class OptionalGame extends Game<OptionalGame, Player> {
  stash!: Stash;

  constructor(options: GameOptions) {
    super(options);

    this.stash = this.create(Stash, 'stash');
    this.stash.create(Equipment, 'Sword', { slot: 'weapon' });

    this.registerAction(
      Action.create('collect')
        .chooseElement('item', {
          optional: true,
          elementClass: Equipment,
        })
        .execute(() => {})
    );

    this.setFlow(defineFlow({
      root: actionStep({
        actions: ['collect'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
    }));
  }
}

function createOptionalManager() {
  const gameOptions = { playerCount: 1, playerNames: ['Alice'], seed: 'test' };

  const runner = new GameRunner({
    GameClass: OptionalGame,
    gameType: 'optional',
    gameOptions,
  });
  runner.start();

  const storedState: StoredGameState = {
    playerCount: 1,
    playerNames: ['Alice'],
    gameType: 'optional',
    actionHistory: [],
    createdAt: Date.now(),
  };

  const callbacks = {
    save: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
    scheduleAICheck: vi.fn(),
  };

  const manager = new PendingActionManager(runner, storedState, undefined, callbacks);
  return { manager, callbacks, game: runner.game };
}

function createEquipManager() {
  const gameOptions = {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
  };

  const runner = new GameRunner({
    GameClass: EquipGame,
    gameType: 'equip',
    gameOptions,
  });
  runner.start();

  const storedState: StoredGameState = {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    gameType: 'test',
    actionHistory: [],
    createdAt: Date.now(),
  };

  const callbacks = {
    save: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
    scheduleAICheck: vi.fn(),
  };

  const manager = new PendingActionManager(runner, storedState, undefined, callbacks);
  return { manager, callbacks, game: runner.game, runner };
}

function createManager() {
  const gameOptions = {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
  };

  const runner = new GameRunner({
    GameClass: TwoStepGame,
    gameType: 'two-step',
    gameOptions,
  });
  runner.start();

  const storedState: StoredGameState = {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    gameType: 'test',
    actionHistory: [],
    createdAt: Date.now(),
  };

  const callbacks = {
    save: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn(),
    scheduleAICheck: vi.fn(),
  };

  const manager = new PendingActionManager(runner, storedState, undefined, callbacks);
  return { manager, callbacks, game: runner.game, runner };
}

describe('PendingActionManager', () => {
  it('broadcasts during intermediate selection steps so onSelect animations reach clients', async () => {
    const { manager, callbacks } = createManager();

    // Process the first selection (color) — action is NOT complete yet (size remains)
    const result = await manager.processSelectionStep(1, 'color', 'red', 'pick');

    expect(result.success).toBe(true);
    expect(result.actionComplete).toBe(false);
    expect(callbacks.broadcast).toHaveBeenCalled();
  });

  it('includes animation events from onSelect in the returned state', async () => {
    const { manager } = createManager();

    const result = await manager.processSelectionStep(1, 'color', 'red', 'pick');

    expect(result.state).toBeDefined();
    expect(result.state!.animationEvents).toHaveLength(1);
    expect(result.state!.animationEvents![0].type).toBe('color-picked');
  });

  it('processes chooseElement step after chooseFrom with onSelect (element ID resolution)', async () => {
    const { manager, game } = createEquipManager();

    // Step 1: chooseFrom with onSelect — routes through server
    const step1 = await manager.processSelectionStep(1, 'unit', 'warrior', 'reEquip');
    expect(step1.success).toBe(true);
    expect(step1.actionComplete).toBe(false);

    // Step 2: chooseElement — client sends raw element ID (number), not a GameElement object
    // This is what the client sends when pendingOnServer is true
    const sword = game.all(Equipment).find(e => e.name === 'Sword')!;
    const step2 = await manager.processSelectionStep(1, 'equipment', sword.id);
    expect(step2.success).toBe(true);
    expect(step2.actionComplete).toBe(true);
  });

  it('treats a null value on an optional selection as a skip that completes the action', async () => {
    const { manager } = createOptionalManager();

    // A null value for an optional selection must complete the action (not error
    // with "Invalid selection"), mirroring the bulk validateAction skip path.
    const result = await manager.processSelectionStep(1, 'item', null, 'collect');

    expect(result.success).toBe(true);
    expect(result.actionComplete).toBe(true);
  });

  it('returns followUp when action execute returns one through processSelectionStep', async () => {
    const { manager, game } = createEquipManager();

    // Step 1: chooseFrom with onSelect
    await manager.processSelectionStep(1, 'unit', 'warrior', 'reEquip');

    // Step 2: completes the action — execute returns a followUp
    const sword = game.all(Equipment).find(e => e.name === 'Sword')!;
    const step2 = await manager.processSelectionStep(1, 'equipment', sword.id);

    expect(step2.success).toBe(true);
    expect(step2.actionComplete).toBe(true);
    expect(step2.followUp).toBeDefined();
    expect(step2.followUp!.action).toBe('reEquipContinue');
    expect(step2.followUp!.args).toEqual({ unitId: 1 });
  });

  // F43: completed pending/multi-step selection actions must be appended to
  // runner.actionHistory so replay, undo counts, and AI history see them.
  describe('F43: records completed multi-step actions in actionHistory', () => {
    it('appends a serialized entry (name, player, fully-collected args) after a multi-step action completes', async () => {
      const { manager, runner } = createManager();

      expect(runner.actionHistory).toHaveLength(0);

      // First step does NOT complete the action — nothing recorded yet.
      await manager.processSelectionStep(1, 'color', 'red', 'pick');
      expect(runner.actionHistory).toHaveLength(0);

      // Second (final) step completes the action — now it must be recorded.
      const result = await manager.processSelectionStep(1, 'size', 'M');
      expect(result.actionComplete).toBe(true);

      expect(runner.actionHistory).toHaveLength(1);
      const entry = runner.actionHistory[0];
      expect(entry.name).toBe('pick');
      expect(entry.player).toBe(1);
      // Fully-collected args from BOTH steps, not a partial.
      expect(entry.args).toEqual({ color: 'red', size: 'M' });
    });

    it('serializes element-reference args so they survive restoration', async () => {
      const { manager, game, runner } = createEquipManager();

      await manager.processSelectionStep(1, 'unit', 'warrior', 'reEquip');
      const sword = game.all(Equipment).find(e => e.name === 'Sword')!;
      const step2 = await manager.processSelectionStep(1, 'equipment', sword.id);
      expect(step2.actionComplete).toBe(true);

      expect(runner.actionHistory).toHaveLength(1);
      const entry = runner.actionHistory[0];
      expect(entry.name).toBe('reEquip');
      expect(entry.player).toBe(1);
      expect(entry.args.unit).toBe('warrior');
      // The element arg is serialized as a resolvable reference, not a raw id.
      expect(entry.args.equipment).not.toBe(sword.id);
      expect(typeof entry.args.equipment).toBe('object');
    });

    it('does not record a turn that only had a failed/cancelled pending action', async () => {
      const { manager, runner } = createManager();

      // Only the first step — action never completes.
      await manager.processSelectionStep(1, 'color', 'red', 'pick');
      expect(runner.actionHistory).toHaveLength(0);
    });

    it('reports an undoable action for a turn whose only action was multi-step', async () => {
      const { manager, runner } = createManager();

      // Before completion, computeUndoInfo sees nothing to undo.
      expect(computeUndoInfo(runner.actionHistory, 1).actionsThisTurn).toBe(0);

      await manager.processSelectionStep(1, 'color', 'red', 'pick');
      await manager.processSelectionStep(1, 'size', 'M');

      // After completion, the multi-step action is counted — undo is possible.
      const undoInfo = computeUndoInfo(runner.actionHistory, 1);
      expect(undoInfo.actionsThisTurn).toBeGreaterThanOrEqual(1);
    });

    it('replay/clone from actionHistory reproduces the completed multi-step action', async () => {
      const { manager, game, runner } = createEquipManager();

      await manager.processSelectionStep(1, 'unit', 'warrior', 'reEquip');
      const sword = game.all(Equipment).find(e => e.name === 'Sword')!;
      await manager.processSelectionStep(1, 'equipment', sword.id);

      expect(runner.actionHistory).toHaveLength(1);

      // Rebuild a fresh runner and replay the recorded history through the normal
      // single-step action funnel — the multi-step entry must be indistinguishable
      // from a normal action: it deserializes, re-resolves its element ref, and runs.
      const replayRunner = new GameRunner({
        GameClass: EquipGame,
        gameType: 'equip',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
      });
      replayRunner.start();

      for (const recorded of runner.actionHistory) {
        const { actionName, player, args } = deserializeAction(recorded, replayRunner.game);
        const replayResult = replayRunner.performAction(actionName, player.seat, args);
        expect(replayResult.success).toBe(true);
      }

      expect(replayRunner.actionHistory).toHaveLength(runner.actionHistory.length);
      // The re-serialized entry matches the original (ignoring timestamp).
      const { name, player, args } = runner.actionHistory[0];
      const replayed = replayRunner.actionHistory[0];
      expect({ name: replayed.name, player: replayed.player, args: replayed.args })
        .toEqual({ name, player, args });
    });
  });
});
