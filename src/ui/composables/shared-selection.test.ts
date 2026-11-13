// @vitest-environment jsdom
/**
 * ONE SHARED SELECTION FOR THE BOARD AND THE PANEL (#1641).
 *
 * The controller holds the one selected thing; `select` changes it and `start`
 * starts a verb, for the board and the panel alike. A click on a thing several
 * verbs take selects it and never starts the first match; a thing one verb
 * takes still starts that verb in one click.
 *
 * Driven end to end: the engine's subject types, the live session host, and
 * the table wiring GameShell uses.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ref } from 'vue';
import { useActionController } from './useActionController.js';
import type { VueWrapper } from '@vue/test-utils';
import type { SubjectRef } from '../../types/protocol.js';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';
import { DICE, Die, TOWERS, Tower, WorkshopGame } from './shared-selection.test-helper.js';
import type { SubjectChoice } from './useActionControllerTypes.js';
import { setupDragDropOrchestration } from './useDragDropTargets.js';

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function workshop() {
  const seat = await mountLiveSeat(WorkshopGame, 'shared-selection', mounted);
  await settle();
  const game = () => seat.session.readGame();
  const die = (name: string) => game().first(Die, name)!;
  const tower = (name: string) => game().first(Tower, name)!;
  return { ...seat, controller: seat.wiring.controller, game, die, tower };
}

const thing = (ref: SubjectRef) => ({ type: ref.type, key: ref.key });

describe('the things the offered verbs take (#1641)', () => {
  it('lists each declared thing with the verbs that take it, from the state push', async () => {
    const { controller } = await workshop();
    expect(controller.subjects.value.things.map((entry) => [entry.label, [...new Set(entry.verbs.map((verb) => verb.action))]])).toEqual([
      ['red showing 1', ['reroll', 'draft']],
      ['blue showing 1', ['reroll', 'draft']],
      ['green showing 1', ['reroll', 'draft']],
      ['Chemical Works', ['upgrade']],
      ['Bank', ['upgrade']],
      ['Fire Curtain', ['buyBlueprint']],
      ['Tar Slick', ['buyBlueprint']],
      ['Brass Loan', ['buyBlueprint']],
      ['red', ['paint']],
      ['blue', ['paint']],
      ['green', ['paint']],
    ]);
  });
});

describe('a board click on a thing (#1641)', () => {
  it('selects a thing several verbs take, and starts none of them', async () => {
    const { board, controller, game, die } = await workshop();
    board.triggerElementSelect({ id: die('red').id });
    await settle();
    expect(game().log).toEqual([]);
    expect(controller.currentAction.value).toBeNull();
    expect(controller.selection.value).toMatchObject({ type: 'Dice', key: String(die('red').id), label: 'red showing 1' });
  });

  it('starts the one verb a thing takes, at once and with the thing filled in', async () => {
    const { board, controller, game, tower } = await workshop();
    board.triggerElementSelect({ id: tower('Bank').id });
    await settle();
    expect(game().log).toEqual(['upgrade Bank']);
    expect(controller.selection.value).toMatchObject({ type: 'Towers', label: 'Bank' });
  });
});

describe('a board click on a thing whose other verbs are disabled (#1641)', () => {
  it('counts only the verbs that can act on it now, so one usable verb starts at once', async () => {
    const { board, game, die } = await workshop();
    board.triggerElementSelect({ id: die('green').id });
    await settle();
    expect(game().log).toEqual(['draft green']);
  });
});

describe('a drag on a thing (#1641)', () => {
  it('selects the dragged thing before starting what the drag starts, so it never disagrees with the selection', async () => {
    const { board, controller, game, die, wiring } = await workshop();
    const stop = setupDragDropOrchestration({ boardInteraction: board, actionController: controller, actionMetadata: wiring.actionMetadata, isMyTurn: ref(true) });
    controller.select(DICE.ref(die('blue')));
    board.startDrag({ id: die('red').id });
    await settle();
    stop();
    expect(game().log).toEqual(['reroll red']);
    expect(controller.selection.value).toMatchObject({ label: 'red showing 1' });
  });
});

describe('starting a verb of a thing (#1641)', () => {
  it('fills the verb\'s first pick with the thing, whatever value the pick spells it with', async () => {
    const { controller, game, die } = await workshop();
    const red = DICE.ref(die('red'));
    controller.select(red);
    await controller.start('draft', { subject: red });
    await settle();
    expect(game().log).toEqual(['draft red']);
  });

  it('carries the thing to the later pick that lists it', async () => {
    const { controller, game, die } = await workshop();
    const blue = DICE.ref(die('blue'));
    controller.select(blue);
    await controller.start('placeDie', { subject: blue });
    await settle();
    expect(controller.currentPick.value?.name).toBe('slot');
    await controller.fill('slot', 'top');
    await settle();
    expect(game().log).toEqual(['place blue top']);
  });

  it('opens a verb whose rows belong to the thing narrowed to those rows, on the board and in the panel alike', async () => {
    const { controller, tower } = await workshop();
    const works = TOWERS.ref(tower('Chemical Works'));
    controller.select(works);
    await controller.start('buyBlueprint', { subject: works });
    await settle();
    expect(controller.currentChoices.value.map((choice) => choice.value)).toEqual(['Fire Curtain', 'Tar Slick']);
  });

  it('refuses a verb that does not take the thing, naming both', async () => {
    const { controller, die } = await workshop();
    const result = await controller.start('upgrade', { subject: DICE.ref(die('red')) });
    expect(result).toEqual({ success: false, error: 'Upgrade does not take Dice "red showing 1".' });
    expect(controller.currentAction.value).toBeNull();
  });

  it('leaves the selection alone when a board starts a verb on a thing, so it never goes stale (#1641 review F3)', async () => {
    const { controller, game, die } = await workshop();
    await controller.start('reroll', { args: { die: die('red').id } });
    await controller.start('reroll', { args: { die: die('blue').id } });
    expect(controller.selection.value).toBeNull();
    expect(game().log).toEqual(['reroll red', 'reroll blue']);
  });
});

describe('the board acting on another thing than the selection (#1641)', () => {
  it('raises a readable error naming the action and both things', async () => {
    const { controller, die } = await workshop();
    controller.select(DICE.ref(die('red')));
    await expect(controller.start('reroll', { args: { die: die('blue').id } })).rejects.toThrow(
      'The board started "Reroll" on Dice "blue showing 1" while the shared selection is Dice "red showing 1". '
      + 'Select the thing first with actionController.select(), or start the verb with { subject } set to the selection.',
    );
    expect(controller.currentAction.value).toBeNull();
  });

  it('lets a verb act on a thing that belongs to the selection, or on the selection itself', async () => {
    const { controller, game, die, tower } = await workshop();
    controller.select(TOWERS.ref(tower('Chemical Works')));
    await controller.start('buyBlueprint', { args: { blueprint: 'Tar Slick' } });
    await settle();
    controller.select(DICE.ref(die('red')));
    await controller.start('reroll', { args: { die: die('red').id } });
    await settle();
    expect(game().log).toEqual(['buy Tar Slick', 'reroll red']);
  });
});

describe('a selection the game keeps in its own state (#1641)', () => {
  it('reads it from the game, writes it through the game, and does not judge the game\'s selecting actions', async () => {
    const { controller, game, die } = await workshop();
    const stored = ref<SubjectChoice | null>(DICE.ref(die('red')));
    const written: (SubjectChoice | null)[] = [];
    controller.bindSubjectSelection({ read: () => stored.value, write: (chosen) => { written.push(chosen); }, selects: ['draft'] });
    expect(controller.selection.value).toMatchObject({ label: 'red showing 1' });
    controller.select(DICE.ref(die('blue')));
    expect(written.map((chosen) => chosen && thing(chosen))).toEqual([thing(DICE.ref(die('blue')))]);
    expect(controller.selection.value).toMatchObject({ label: 'red showing 1' });
    await controller.start('draft', { args: { die: `die:${die('green').id}` } });
    await settle();
    expect(game().log).toEqual(['draft green']);
  });
});

describe('a start with every pick given (#1641)', () => {
  it('runs the action and resolves to the server\'s answer, as execute did, so a board needs no execute', async () => {
    const { controller, game, die } = await workshop();
    const result = await controller.start('reroll', { args: { die: die('red').id } });
    expect(result.success).toBe(true);
    expect(game().log).toEqual(['reroll red']);
    expect(await controller.start('pass')).toMatchObject({ success: true });
    expect(game().log).toEqual(['reroll red', 'pass']);
  });
});

describe('a start with every pick given, around the send (#1641 review F1, F2)', () => {
  const metadata = {
    buy: { name: 'buy', quote: true, selections: [{ name: 'item', type: 'choice' as const, choices: [{ value: 7, display: 'Lamp' }] }] },
    move: { name: 'move', selections: [{ name: 'to', type: 'choice' as const, choices: [{ value: 'a', display: 'A' }] }] },
  };
  const controllerFor = (sent: string[]) => useActionController({
    sendAction: async (name) => { sent.push(name); return { success: true }; },
    availableActions: ref(['buy', 'move']),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
  });

  it('opens a quoted action for confirm instead of sending it, whatever was open before', async () => {
    const sent: string[] = [];
    const controller = controllerFor(sent);
    await controller.start('buy', { args: { item: 7 } });
    expect(sent).toEqual([]);
    expect(controller.currentAction.value).toBe('buy');
  });

  it('runs the auto-execute hooks and tells the listeners, as an action filled in the panel does', async () => {
    const sent: string[] = [];
    const controller = controllerFor(sent);
    const heard: string[] = [];
    controller.onBeforeAutoExecute(async (name) => { heard.push(`before ${name}`); });
    controller.onAfterAutoExecute((result) => { heard.push(`after ${result.success}`); });
    await controller.start('move', { args: { to: 'a' } });
    await Promise.resolve();
    expect(sent).toEqual(['move']);
    expect(heard).toEqual(['before move', 'after true']);
  });
});
