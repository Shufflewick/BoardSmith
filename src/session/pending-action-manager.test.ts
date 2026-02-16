import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { PendingActionManager } from './pending-action-manager.js';
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
        .chooseFrom<string>('color', {
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
        .chooseFrom<string>('unit', {
          choices: ['warrior', 'archer'],
          onSelect: (value, ctx) => {
            ctx.animate('equip-start', { unit: value });
          },
        })
        .chooseElement<Equipment>('equipment', {
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
        .chooseFrom<string>('slot', { choices: ['weapon', 'armor'] })
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
  return { manager, callbacks, game: runner.game };
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
  return { manager, callbacks, game: runner.game };
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
});
