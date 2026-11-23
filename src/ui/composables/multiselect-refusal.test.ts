// @vitest-environment jsdom
/**
 * #1789: a multiSelect of game elements the game refuses answers with the
 * pick's own message, and a refusal that leaves the pick open keeps what the
 * player ticked, so one tick too many or too few is fixed, not started over.
 *
 * Driven through a live table, so the choices travel engine -> session -> controller and back.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Piece, Action, actionStep, type GameOptions } from '../../engine/index.js';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';

class Stone extends Piece<StoneGame> {}

const exactlyTwo = (picked: Stone[]) => picked.length === 2 || 'Pick exactly 2.';

class StoneGame extends Game<StoneGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const player of this.all(Player)) this.create(Stone, `stone-${player.seat}`).player = player;
    this.create(Stone, 'stone-loose');
    this.registerActions(
      Action.create<StoneGame>('place')
        .chooseFrom<'stones', Stone>('stones', { choices: (ctx) => ctx.game.all(Stone), multiSelect: { min: 0, max: 2 }, validate: exactlyTwo })
        .execute(() => ({ success: true })),
      Action.create<StoneGame>('mark')
        .chooseFrom<'stones', Stone>('stones', {
          choices: (ctx) => ctx.game.all(Stone),
          multiSelect: { min: 0, max: 2 },
          validate: exactlyTwo,
          // Sends the pick through the selection step, which leaves the action open when it refuses.
          onSelect: () => {},
        })
        .chooseFrom('note', { choices: ['done'] })
        .execute(() => ({ success: true })),
      Action.create<StoneGame>('pair')
        .chooseFrom<'stones', Stone>('stones', {
          choices: (ctx) => ctx.game.all(Stone),
          multiSelect: { min: 2, max: 2 },
          validate: (picked: Stone[]) => picked.every((stone) => stone.player) || 'Only owned stones.',
          onSelect: () => {},
        })
        .chooseFrom('note', { choices: ['done'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: actionStep({ actions: ['place', 'mark', 'pair'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function tickOneStone(actionName: string, withPickStep: boolean) {
  const { wiring } = await mountLiveSeat(StoneGame, 'bs1789', mounted, { withPickStep });
  const { controller } = wiring;
  await controller.start(actionName);
  await settle();
  const [first] = controller.getChoices(controller.currentPick.value!);
  await controller.toggleMultiSelect('stones', first!.value);
  await controller.confirmMultiSelect('stones');
  await settle();
  return { controller, ticked: first!.value };
}

describe('a refused multiSelect of game elements (#1789)', () => {
  it("answers with the pick's own message", async () => {
    const { controller } = await tickOneStone('place', false);

    expect(controller.lastError.value).toContain('Pick exactly 2.');
  });

  it('keeps the ticked boxes while the pick is still open', async () => {
    const { controller, ticked } = await tickOneStone('mark', true);

    expect(controller.lastError.value).toContain('Pick exactly 2.');
    expect(controller.currentPick.value?.name).toBe('stones');
    expect(controller.isMultiSelectSelected('stones', ticked)).toBe(true);
  });

  it('holds the ticks still while the server is answering the confirm', async () => {
    const { session, wiring } = await mountLiveSeat(StoneGame, 'bs1789', mounted, { withPickStep: true });
    const { controller } = wiring;
    await controller.start('mark');
    await settle();
    const [first, second] = controller.getChoices(controller.currentPick.value!);
    const send = session.send.bind(session);
    let answer!: () => void;
    vi.spyOn(session, 'send').mockImplementation(async (seat, op) => {
      if (op.type === 'selectionStep') await new Promise<void>((resolve) => { answer = resolve; });
      return send(seat, op);
    });
    await controller.toggleMultiSelect('stones', first!.value);
    await controller.toggleMultiSelect('stones', second!.value);
    const confirming = controller.confirmMultiSelect('stones');
    await settle();

    await controller.toggleMultiSelect('stones', second!.value);

    expect(controller.lastError.value).toBe('Still waiting for the server to answer your last pick.');
    expect(controller.isMultiSelectSelected('stones', second!.value)).toBe(true);
    answer();
    await confirming;
  });

  it('takes back a refused last tick of a fixed count, so the next tick sends again', async () => {
    const { wiring } = await mountLiveSeat(StoneGame, 'bs1789', mounted, { withPickStep: true });
    const { controller } = wiring;
    await controller.start('pair');
    await settle();
    const [mine, theirs, loose] = controller.getChoices(controller.currentPick.value!);

    await controller.toggleMultiSelect('stones', mine!.value);
    await controller.toggleMultiSelect('stones', loose!.value);
    await settle();
    expect(controller.lastError.value).toContain('Only owned stones.');
    expect(controller.multiSelectDraft.value?.values).toEqual([mine!.value]);

    await controller.toggleMultiSelect('stones', theirs!.value);
    await settle();
    expect(controller.currentPick.value?.name).toBe('note');
  });
});
