/**
 * BOARDSMITH #270: AN ACTION IS OFFERED ON ITS FIRST UNSATISFIED STEP.
 *
 * A dependent `chooseFrom` has nothing to narrow by until the answer it depends
 * on exists, so the natural way to write it --
 *
 *   if (args.slot === undefined) return [];
 *
 * -- used to take the WHOLE VERB off the seat's panel: availability walked every
 * selection with `args: {}`, read the second step's empty list as "impossible",
 * and dropped the action with no warning anywhere. The documented way out was to
 * over-offer the union of every slot's items while `args.slot` was undefined,
 * which shows the player rows they will not be allowed to pick, and every
 * multi-step verb in a game had to remember to pay that tax.
 *
 * A step the player has not reached is now "not yet askable", never "empty,
 * therefore impossible". Pruning survives exactly where it is a real answer:
 * the FIRST step (the one the player is actually asked next), and a step whose
 * dependency is DECLARED (`dependsOn` / `filterBy`), which availability
 * enumerates with the earlier value bound. Both now say so out loud.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Game, Player, Action, ActionExecutor } from '../index.js';
import type { ActionDefinition } from '../index.js';
import { _clearShownWarnings } from '../../utils/dev.js';

class EquipGame extends Game<EquipGame, Player> {}

type Item = { name: string; slot: string };

const INVENTORY: Item[] = [
  { name: 'Iron Helm', slot: 'head' },
  { name: 'Oak Shield', slot: 'hand' },
  { name: 'Short Sword', slot: 'hand' },
];

/**
 * The issue's own verb, written the natural way: the item step answers nothing
 * until it knows the slot.
 */
function equipAction() {
  return Action.create('equip')
    .chooseFrom('slot', { choices: ['head', 'hand'] })
    .chooseFrom('item', {
      choices: ({ args }) => {
        const slot = args.slot as string | undefined;
        if (slot === undefined) return [];
        return INVENTORY.filter((item) => item.slot === slot).map((item) => item.name);
      },
    })
    .execute(() => {});
}

describe('#270 — a dependent choice does not take the verb off the panel', () => {
  let game: EquipGame;
  let executor: ActionExecutor;

  beforeEach(() => {
    game = new EquipGame({ playerCount: 2 });
    executor = new ActionExecutor(game);
    _clearShownWarnings();
  });

  it('offers the two-step equip verb on the strength of its first question', () => {
    expect(executor.isActionAvailable(equipAction(), game.getPlayer(1)!)).toBe(true);
  });

  it('keeps it beside the single-step verbs in a seat\'s own action list', () => {
    game.registerActions(Action.create('look').execute(() => {}), equipAction());

    const offered = game.getAvailableActions(game.getPlayer(1)!).map((a) => a.name);
    expect(offered).toEqual(['look', 'equip']);
  });

  it('answers the item step from the slot the player chose, and nothing wider', () => {
    const action = equipAction();
    const player = game.getPlayer(1)!;
    const item = action.selections[1];

    const forHand = executor.getChoices(item, player, { slot: 'hand' });
    expect(forHand.map((c) => c.value)).toEqual(['Oak Shield', 'Short Sword']);

    const forHead = executor.getChoices(item, player, { slot: 'head' });
    expect(forHead.map((c) => c.value)).toEqual(['Iron Helm']);
  });

  it('still refuses a submission the narrowed list does not contain', () => {
    const action = equipAction();
    const player = game.getPlayer(1)!;

    const wrongSlot = executor.validateAction(action, player, { slot: 'head', item: 'Oak Shield' });
    expect(wrongSlot.valid).toBe(false);

    const rightSlot = executor.validateAction(action, player, { slot: 'head', item: 'Iron Helm' });
    expect(rightSlot.valid).toBe(true);
  });
});

describe('#270 — the pruning that remains is observable', () => {
  let game: EquipGame;
  let executor: ActionExecutor;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    game = new EquipGame({ playerCount: 2 });
    executor = new ActionExecutor(game);
    _clearShownWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  /** Drop the action, and hand back everything the engine said while doing it. */
  const dropped = (action: ActionDefinition): string => {
    expect(executor.isActionAvailable(action, game.getPlayer(1)!)).toBe(false);
    return warn.mock.calls.map((call) => String(call[0])).join('\n');
  };

  it('still drops an action whose FIRST question has no answer, and says which', () => {
    const said = dropped(
      Action.create('equip')
        .chooseFrom('slot', { choices: [] as string[] })
        .chooseFrom('item', { choices: ['Iron Helm'] })
        .execute(() => {}),
    );

    expect(said).toContain("'equip'");
    expect(said).toContain("'slot'");
  });

  it('still drops a DECLARED dependency no first answer can satisfy, and says so', () => {
    const said = dropped(
      Action.create('equip')
        .chooseFrom('slot', { choices: ['head', 'hand'] })
        .chooseFrom('item', { dependsOn: 'slot', choices: () => [] as string[] })
        .execute(() => {}),
    );

    expect(said).toContain("'equip'");
    expect(said).toContain("'item'");
  });

  it('says nothing at all about a verb it offers', () => {
    expect(executor.isActionAvailable(equipAction(), game.getPlayer(1)!)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
