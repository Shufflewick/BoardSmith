/**
 * Tests for buildPickMetadata's resolution of function-valued `multiSelect` —
 * AI-01 / C.2 (the panel half of the shared root cause closed by Plan 01's
 * `resolveMultiSelect` for MCTS enumeration).
 *
 * Pre-fix: `buildPickMetadata` emits `base.multiSelect` ONLY when
 * `typeof multiSelect !== 'function'` (choice `:148-158`, elements `:202-212`).
 * For a function-valued `multiSelect` this means the panel never sees a
 * resolved config even when the function resolves to a concrete `{min,max}`
 * in the current state — the checkbox widget is skipped and the pick falls
 * back to single-select (Doom BS-5, "requires >=2, got 1").
 *
 * Post-fix: both sites resolve via the SAME shared `resolveMultiSelect`
 * helper Plan 01 created for MCTS enumeration — panel and MCTS can never
 * disagree about whether a selection is multi-select in the current state.
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
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
import { buildPickMetadata } from './action-metadata.js';
import { resolveMultiSelect } from '../utils/resolve-multiselect.js';
import { useActionController, type ActionMetadata } from '../../ui/composables/useActionController.js';
import type { ChoiceSelection, ElementsSelection } from '../action/types.js';
import { GameRunner } from '../../runtime/index.js';
import { buildPlayerState } from '../../session/utils.js';

// ============================================================================
// Test game: registers one action per case (choice/elements x
// function-concrete/function-undefined/static) so each selection can be
// pulled off the registered ActionDefinition and fed directly into
// buildPickMetadata, exactly as the plan's interface contract specifies.
// ============================================================================

class MultiSelectMetadataGame extends Game<MultiSelectMetadataGame, Player> {
  board!: Space<MultiSelectMetadataGame>;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<MultiSelectMetadataGame>, 'board');
    this.board.create(Piece<MultiSelectMetadataGame>, 'token-a');
    this.board.create(Piece<MultiSelectMetadataGame>, 'token-b');
    this.board.create(Piece<MultiSelectMetadataGame>, 'token-c');

    // choice: function multiSelect resolving to a concrete {min:2,max:2}
    this.registerAction(
      Action.create<MultiSelectMetadataGame>('pickChoice')
        .chooseFrom('flavor', {
          prompt: 'Choose flavors',
          choices: ['vanilla', 'chocolate', 'mint'],
          multiSelect: () => ({ min: 2, max: 2 }),
        })
        .execute(() => ({ success: true })),
    );

    // choice: function multiSelect legitimately returning undefined -> single-select
    this.registerAction(
      Action.create<MultiSelectMetadataGame>('pickChoiceUndefined')
        .chooseFrom('flavor', {
          prompt: 'Choose a flavor',
          choices: ['vanilla', 'chocolate', 'mint'],
          multiSelect: () => undefined,
        })
        .execute(() => ({ success: true })),
    );

    // choice: static number multiSelect (negative control — must not regress)
    this.registerAction(
      Action.create<MultiSelectMetadataGame>('pickChoiceStaticNumber')
        .chooseFrom('flavor', {
          prompt: 'Choose flavors',
          choices: ['vanilla', 'chocolate', 'mint'],
          multiSelect: 2,
        })
        .execute(() => ({ success: true })),
    );

    // elements: function multiSelect resolving to a concrete {min:1,max:3}
    this.registerAction(
      Action.create<MultiSelectMetadataGame>('pickElements')
        .chooseElements('items', {
          prompt: 'Choose one to three tokens',
          elements: (ctx) => [...(ctx.game as MultiSelectMetadataGame).board.all(Piece)],
          multiSelect: () => ({ min: 1, max: 3 }),
        })
        .execute(() => ({ success: true })),
    );

    // elements: static {min,max} multiSelect (negative control — must not regress)
    this.registerAction(
      Action.create<MultiSelectMetadataGame>('pickElementsStaticConfig')
        .chooseElements('items', {
          prompt: 'Choose tokens',
          elements: (ctx) => [...(ctx.game as MultiSelectMetadataGame).board.all(Piece)],
          multiSelect: { min: 1, max: 2 },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 10,
          do: eachPlayer({
            do: actionStep({ actions: ['pickChoice'] }),
          }),
        }),
      }),
    );
  }
}

function makeGame(): { game: MultiSelectMetadataGame; player: Player } {
  const game = new MultiSelectMetadataGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'metadata-multiselect-test',
  });
  game.startFlow();
  const player = game.getPlayer(1)!;
  return { game, player };
}

function getSelection(
  game: MultiSelectMetadataGame,
  actionName: string,
): ChoiceSelection | ElementsSelection {
  const actions = (game as any)._actions as Map<string, { selections: unknown[] }>;
  const actionDef = actions.get(actionName);
  if (!actionDef) throw new Error(`action "${actionName}" not registered`);
  return actionDef.selections[0] as ChoiceSelection | ElementsSelection;
}

describe('buildPickMetadata: function-valued multiSelect (AI-01 / C.2)', () => {
  it('resolves a function-valued multiSelect to a concrete {min,max} on a choice selection', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickChoice');

    const meta = buildPickMetadata(game, player, selection);

    expect(meta.multiSelect).toEqual({ min: 2, max: 2 });
  });

  it('resolves a function-valued multiSelect to a concrete {min,max} on an elements selection', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickElements');

    const meta = buildPickMetadata(game, player, selection);

    expect(meta.multiSelect).toEqual({ min: 1, max: 3 });
  });

  it('omits multiSelect metadata when the function legitimately returns undefined (choice)', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickChoiceUndefined');

    const meta = buildPickMetadata(game, player, selection);

    expect(meta.multiSelect).toBeUndefined();
  });

  it('still emits a static number multiSelect on a choice selection (negative control)', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickChoiceStaticNumber');

    const meta = buildPickMetadata(game, player, selection);

    expect(meta.multiSelect).toEqual({ min: 1, max: 2 });
  });

  it('still emits a static {min,max} multiSelect on an elements selection (negative control)', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickElementsStaticConfig');

    const meta = buildPickMetadata(game, player, selection);

    expect(meta.multiSelect).toEqual({ min: 1, max: 2 });
  });

  // ==========================================================================
  // C.2 single-source-of-truth: panel and MCTS resolve the SAME multiSelect
  // config through the SAME resolveMultiSelect helper (CONTEXT D-01).
  // ==========================================================================

  it('parity: buildPickMetadata (panel) and resolveMultiSelect (enumeration) agree on the resolved config', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickElements');
    const ctx = { game, player, args: {} };

    const panelResolved = buildPickMetadata(game, player, selection).multiSelect;
    const enumerationResolved = resolveMultiSelect(selection, ctx);

    expect(panelResolved).toEqual(enumerationResolved);
    expect(panelResolved).toEqual({ min: 1, max: 3 });
  });

  it('parity holds for a choice selection too', () => {
    const { game, player } = makeGame();
    const selection = getSelection(game, 'pickChoice');
    const ctx = { game, player, args: {} };

    const panelResolved = buildPickMetadata(game, player, selection).multiSelect;
    const enumerationResolved = resolveMultiSelect(selection, ctx);

    expect(panelResolved).toEqual(enumerationResolved);
    expect(panelResolved).toEqual({ min: 2, max: 2 });
  });

  // ==========================================================================
  // C.2 panel-completable: once metadata carries the resolved config, the
  // controller's checkbox-multiSelect seam (toggleMultiSelect ->
  // resolveMultiSelectConfig -> selection.multiSelect) engages natively — no
  // ActionPanel.vue / useActionController.ts source change required.
  // ==========================================================================

  describe('panel completion (C.2): the controller drives a dynamic multiSelect natively', () => {
    it('toggleMultiSelect accepts values for a dynamic-multiSelect pick instead of falling back to single-select', async () => {
      const { game, player } = makeGame();
      const selection = getSelection(game, 'pickElements');
      const pickMeta = buildPickMetadata(game, player, selection);

      // Resolved metadata carries a concrete multiSelect config (proven above) —
      // this is exactly what a real server response would send to the client.
      expect(pickMeta.multiSelect).toEqual({ min: 1, max: 3 });

      const actionMetadata = ref<Record<string, ActionMetadata> | undefined>({
        pickElements: {
          name: 'pickElements',
          prompt: 'Choose one to three tokens',
          selections: [pickMeta],
        },
      });
      const availableActions = ref<string[]>(['pickElements']);
      const isMyTurn = ref(true);
      const sendAction = vi.fn().mockResolvedValue({ success: true });

      const controller = useActionController({
        sendAction,
        availableActions,
        actionMetadata,
        isMyTurn,
        autoExecute: false,
      });

      await controller.start('pickElements');
      await controller.toggleMultiSelect('items', 1);

      // If the panel had fallen back to single-select (the pre-fix bug), this
      // would be a no-op devWarn and the draft would stay null — the exact
      // "requires >=2, got 1" dead end (Doom BS-5). Post-fix the checkbox
      // widget's toggle path engages and records the draft.
      expect(controller.multiSelectDraft.value).toEqual({
        selectionName: 'items',
        values: [1],
      });
    });
  });
});

// ============================================================================
// SPACE-05 / D26: availableActions vs actionMetadata divergence (163-04)
//
// Root cause: `flowState.availableActions` (consumed via `availableActionsForSeat`
// in `buildPlayerState`, utils.ts:453) is a SNAPSHOT computed once when the
// action-step is entered (engine.ts:1494 `this.game.getAvailableActions(player)`).
// `state.actionMetadata` (utils.ts:530 `buildActionMetadata`) re-checks each
// action's `condition` LIVE at broadcast time and drops any action whose
// condition is now false. If the condition flips false between step-entry and
// broadcast (without the flow itself advancing), `availableActions` keeps the
// stale entry while `actionMetadata` drops it -- the client offers an action it
// cannot start, and `useActionController.start()` throws "No metadata for
// action", stranding the panel.
// ============================================================================

class DivergenceGame extends Game<DivergenceGame, Player> {
  board!: Space<DivergenceGame>;
  conditionOpen = true;

  constructor(options: GameOptions) {
    super(options);
    this.board = this.create(Space<DivergenceGame>, 'board');

    this.registerAction(
      Action.create<DivergenceGame>('conditional')
        .condition((ctx) => (ctx.game as DivergenceGame).conditionOpen)
        .execute(() => ({ success: true })),
    );

    this.registerAction(
      Action.create<DivergenceGame>('always')
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['conditional', 'always'] }),
          }),
        }),
      }),
    );
  }
}

function makeDivergenceRunner(): GameRunner<DivergenceGame> {
  const runner = new GameRunner<DivergenceGame>({
    GameClass: DivergenceGame,
    gameType: 'divergence-test',
    gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'divergence-test' },
  });
  runner.start();
  return runner;
}

describe('SPACE-05 (D26): availableActions and actionMetadata cannot diverge', () => {
  it('drops a now-false-condition action from BOTH availableActions and actionMetadata (no divergence)', () => {
    const runner = makeDivergenceRunner();

    // Confirm the action-step snapshot captured 'conditional' while the
    // condition was still true.
    const preFlip = runner.getFlowState();
    expect(preFlip?.availableActions).toContain('conditional');

    // Flip the condition false WITHOUT advancing the flow -- this is the
    // mid-step state mutation that produces the stale snapshot.
    runner.game.conditionOpen = false;

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1, { includeActionMetadata: true });

    const metadataKeys = Object.keys(state.actionMetadata ?? {});

    // The two sets must agree -- neither contains the now-unavailable action.
    expect(state.availableActions).not.toContain('conditional');
    expect(metadataKeys).not.toContain('conditional');
    expect(state.availableActions.slice().sort()).toEqual(metadataKeys.slice().sort());
  });

  it('negative control: a condition-true action appears in both sets', () => {
    const runner = makeDivergenceRunner();

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1, { includeActionMetadata: true });
    const metadataKeys = Object.keys(state.actionMetadata ?? {});

    expect(state.availableActions).toContain('conditional');
    expect(metadataKeys).toContain('conditional');
    expect(state.availableActions).toContain('always');
    expect(metadataKeys).toContain('always');
    expect(state.availableActions.slice().sort()).toEqual(metadataKeys.slice().sort());
  });

  it('UI defense-in-depth: start() on a metadata-missing action does not throw and does not strand the board', async () => {
    const actionMetadata = ref<Record<string, ActionMetadata> | undefined>({});
    const availableActions = ref<string[]>(['ghostAction']);
    const isMyTurn = ref(true);
    const sendAction = vi.fn().mockResolvedValue({ success: true });

    const controller = useActionController({
      sendAction,
      availableActions,
      actionMetadata,
      isMyTurn,
      autoExecute: false,
    });

    let thrown: unknown = null;
    let result: { success: boolean; error?: string } | undefined;
    try {
      result = await controller.start('ghostAction');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeNull();
    expect(result?.success).toBe(false);
    // The board stays interactive -- no wizard-mode action got pinned in place.
    expect(controller.currentAction.value).toBeNull();
  });
});
