/**
 * BOARDSMITH #270, THE OTHER HALF: A STEP THAT OPENS ON NOTHING SAYS SO.
 *
 * Offering an action on its first unsatisfied step is the fix, and it moves one
 * failure rather than removing it: a verb the engine now offers can walk the
 * player to a later question that, once its input is bound, genuinely has no
 * answer. Left alone that is an empty list under a prompt -- a silent dead end
 * traded for a silent absence, which is no trade at all.
 *
 * So the step refuses, on the channel a refused pick already travels
 * (`success: false` + `error`, BoardSmith #227), which both shells watch. The
 * message names the question, the verb, and the answers that narrowed it, so a
 * player reads what was asked for and why nothing qualifies rather than "no
 * options".
 *
 * Two things are NOT dead ends and must not refuse:
 *   - an OPTIONAL step with nothing to pick -- skipping it is the answer;
 *   - a step whose candidates are all DISABLED -- every row carries its own
 *     reason, which is more than this message could say.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { createHeadlessSession, type HeadlessSession } from './headless-session.js';
import { succeeded } from './op-result.test-helper.js';
import { ErrorCode } from '../types/protocol.js';

class Item extends Piece<EquipGame> {
  slot!: string;
}

class Pack extends Space<EquipGame> {}

const INVENTORY = [
  { name: 'Oak Shield', slot: 'hand' },
  { name: 'Short Sword', slot: 'hand' },
];

class EquipGame extends Game<EquipGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    const pack = this.create(Pack, 'pack');
    for (const item of INVENTORY) pack.create(Item, item.name, { slot: item.slot });

    // The issue's verb. Nothing fits 'head', so answering 'head' walks the
    // player into a question with no answer.
    this.registerAction(
      Action.create('equip')
        .prompt('Equip an item')
        .chooseFrom('slot', { prompt: 'Slot', choices: ['head', 'hand'] })
        .chooseFrom('item', {
          prompt: 'Item',
          choices: (ctx) => {
            const slot = ctx.args.slot as string | undefined;
            if (slot === undefined) return [];
            return [...ctx.game.all(Item)].filter((i) => i.slot === slot).map((i) => i.name!);
          },
        })
        .execute(() => ({ success: true }))
    );

    // The same shape with the second step OPTIONAL: nothing to pick is an
    // answer here, so it must come back as an empty list and not a refusal.
    this.registerAction(
      Action.create('equipMaybe')
        .chooseFrom('slot', { prompt: 'Slot', choices: ['head', 'hand'] })
        .chooseFrom('item', {
          prompt: 'Item',
          optional: true,
          choices: () => [] as string[],
        })
        .execute(() => ({ success: true }))
    );

    // Candidates that exist and are every one of them greyed: each row says
    // why, which is better than anything a step-level message could add.
    this.registerAction(
      Action.create('equipGreyed')
        .chooseElement('item', {
          prompt: 'Item',
          elements: (ctx) => [...ctx.game.all(Item)],
          disabled: () => 'Too heavy to lift',
        })
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['equip', 'equipMaybe', 'equipGreyed'] }),
    }));
  }
}

describe('#270 — a step with nothing to pick refuses, and says what was asked and why', () => {
  let session: HeadlessSession<EquipGame>;

  beforeEach(async () => {
    session = createHeadlessSession(
      { gameClass: EquipGame, gameType: 'test-dead-end', minPlayers: 2, maxPlayers: 2 },
      { playerCount: 2, playerNames: ['Alice', 'Bob'] },
    );
    await session.start();
  });

  /** Seat 1 asks for `selectionName`'s answers in `actionName`, given the answers in `args`. */
  const choicesFor = (actionName: string, selectionName: string, args: Record<string, unknown> = {}) =>
    session.send(1, { type: 'resolveChoices', actionName, selectionName, player: 1, args });

  test('refuses the step, on the channel a refused pick already travels', async () => {
    const result = await choicesFor('equip', 'item', { slot: 'head' });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCode.PICK_HAS_NO_CANDIDATES);
  });

  test('names the question, the verb, and the answer that narrowed it', async () => {
    const { error } = await choicesFor('equip', 'item', { slot: 'head' });

    expect(error).toContain('Item');          // what is being asked for
    expect(error).toContain('Equip an item'); // which verb is asking
    expect(error).toContain('slot');          // why there is nothing
    expect(error).toContain('head');
  });

  test('tells the player what to do about it', async () => {
    const { error } = await choicesFor('equip', 'item', { slot: 'head' });

    expect(error?.toLowerCase()).toContain('cancel');
  });

  test('says nothing of the kind when the step CAN be answered', async () => {
    const result = succeeded(await choicesFor('equip', 'item', { slot: 'hand' }));

    expect(result.choices?.map((c) => c.value)).toEqual(['Oak Shield', 'Short Sword']);
  });

  test('leaves an OPTIONAL step alone: skipping it is the answer', async () => {
    const result = succeeded(await choicesFor('equipMaybe', 'item', { slot: 'head' }));

    expect(result.choices).toEqual([]);
  });

  test('leaves an all-greyed step alone: every row already carries its reason', async () => {
    const result = succeeded(await choicesFor('equipGreyed', 'item'));

    expect(result.validElements).toHaveLength(2);
    expect(result.validElements?.every((e) => e.disabled === 'Too heavy to lift')).toBe(true);
  });
});
