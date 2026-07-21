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
import { describe, it, expect } from 'vitest';
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
import type { ChoiceSelection, ElementsSelection } from '../action/types.js';

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
});
