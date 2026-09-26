// @vitest-environment jsdom
/**
 * #392: PICKS ARE ASKED IN THE ORDER THE ACTION DECLARES THEM.
 *
 * `currentPick` used to walk every unanswered REQUIRED selection first and only
 * then the optional ones. For Survival of the Fittest's `sendMail` -- `to`, then
 * an optional `recipient` narrowed by `to`, then `message`, then `item` -- the
 * narrowing question ("who exactly?") came up last, after the form looked
 * finished, with Skip beside it. Players skipped it and mail went to the wrong
 * person, while the list itself had been fetched correctly right after `to`.
 *
 * An optional pick is asked where it is declared and is skippable THERE. The
 * question order and the fetch order are then the same order, and the same order
 * the engine's own step-wise path (`processSelectionStep`) insists on.
 *
 * The Action Panel and a custom UI read the same `currentPick`, so both are held
 * here: the world-shaped action through the controller a world wires, and a
 * table action with `dependsOn` through `useTableActionWiring` over a real
 * `GameSession` -- the wiring GameShell and a game's own board test use.
 * `ActionPanel.pick-order.test.ts` holds the mounted panel.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { useActionController } from './useActionController.js';
import type { EnrichedActionMetadata, PickChoicesResult } from './useActionControllerTypes.js';
import { PEOPLE, recipientChoices, mailPicks } from './send-mail.test-helper.js';
import type { TableActionWiring } from './useTableActionWiring.js';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';
import type { GameSession } from '../../session/game-session.js';
import {
  Game,
  Player,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../../engine/index.js';


/** sotf's `sendMail`, as a world offers it: no `dependsOn`, the list re-asked with args bound. */
const sendMail: EnrichedActionMetadata = {
  name: 'sendMail',
  prompt: 'Send mail',
  selections: [
    { name: 'to', type: 'text', prompt: 'To' },
    {
      name: 'recipient',
      type: 'choice',
      prompt: 'Who exactly?',
      optional: 'skip',
      choices: PEOPLE.map((p) => ({ value: p, display: p })),
    },
    { name: 'message', type: 'text', prompt: 'Message' },
    {
      name: 'item',
      type: 'choice',
      prompt: 'Enclose an item',
      choices: [
        { value: 'none', display: 'Nothing' },
        { value: 'coin', display: 'A coin' },
      ],
    },
  ],
};

/** Answers a pick the way a world's `resolvePick` does: the recipient list narrowed by `to`. */
function worldFetch() {
  return vi.fn(async (_action: string, pick: string, _player: number, args: Record<string, unknown>): Promise<PickChoicesResult> => {
    if (pick === 'recipient') return { success: true, choices: recipientChoices(args.to) };
    const selection = sendMail.selections.find((s) => s.name === pick);
    return { success: true, choices: selection?.choices ?? [] };
  });
}

function worldController() {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const fetchPickChoices = worldFetch();
  const controller = useActionController({
    sendAction,
    availableActions: ref(['sendMail']),
    actionMetadata: ref({ sendMail }),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: true,
    playerSeat: ref(1),
    fetchPickChoices,
  });
  return { controller, sendAction, fetchPickChoices };
}

/** The pick on screen is "who exactly?", narrowed by `to: 'Player 3'`. */
function expectAskedWhoExactly(controller: ReturnType<typeof useActionController>): void {
  expect(controller.currentPick.value?.name).toBe('recipient');
  expect(controller.getChoices(controller.currentPick.value!).map((c) => c.value)).toEqual(['Player 3', 'Player 30']);
}

describe('a world action asks its optional pick where it is declared (#392)', () => {
  it('asks the narrowing pick straight after the answer it narrows', async () => {
    const { controller } = worldController();
    await controller.start('sendMail');
    expect(controller.currentPick.value?.name).toBe('to');

    await controller.fill('to', 'Player 3');
    expectAskedWhoExactly(controller);

    await controller.fill('recipient', 'Player 30');
    expect(controller.currentPick.value?.name).toBe('message');
    await controller.fill('message', 'hi');
    expect(controller.currentPick.value?.name).toBe('item');
  });

  it('skips the optional pick in place and moves on to the next declared one', async () => {
    const { controller, sendAction } = worldController();
    await controller.start('sendMail');
    await controller.fill('to', 'Player 4');
    expect(controller.currentPick.value?.name).toBe('recipient');

    controller.skip('recipient');
    await nextTick();
    expect(controller.currentPick.value?.name).toBe('message');

    await controller.fill('message', 'hello');
    await controller.fill('item', 'coin');
    await nextTick();
    await nextTick();

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction.mock.calls[0]![0]).toBe('sendMail');
    expect(sendAction.mock.calls[0]![1]).toEqual({ to: 'Player 4', message: 'hello', item: 'coin' });
  });
});

// ---------------------------------------------------------------------------
// A table action with `dependsOn`, driven through the real engine.
// ---------------------------------------------------------------------------

class MailGame extends Game<MailGame, Player> {
  /** What each `sendMail` executed with. */
  sent: Record<string, unknown>[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      mailPicks<MailGame>()
        .chooseFrom('item', { choices: ['none', 'coin'] })
        .execute((args, ctx) => {
          (ctx.game as MailGame).sent.push({ ...args });
          return { success: true };
        })
    );
    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['sendMail'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      })
    );
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** A mail table at seat 1, with `sendMail` started and `to` answered. */
async function answeredTo(to: string): Promise<{ session: GameSession<MailGame>; controller: TableActionWiring['controller'] }> {
  const { session, wiring } = mountLiveSeat(MailGame, 'bs392', mounted);
  const { controller } = wiring;
  await controller.start('sendMail');
  await settle();
  expect(controller.currentPick.value?.name).toBe('to');
  await controller.fill('to', to);
  await settle();
  return { session, controller };
}

describe('a table action asks a dependsOn optional pick where it is declared (#392)', () => {
  it('asks the dependent optional pick before the later required one', async () => {
    const { session, controller } = await answeredTo('Player 3');
    expectAskedWhoExactly(controller);

    await controller.fill('recipient', 'Player 30');
    await settle();
    expect(controller.currentPick.value?.name).toBe('item');
    await controller.fill('item', 'coin');
    await settle();

    expect(session.runner.game.sent).toEqual([{ to: 'Player 3', recipient: 'Player 30', item: 'coin' }]);
  });

  it('skips the dependent optional pick in place', async () => {
    const { session, controller } = await answeredTo('Player 4');
    expect(controller.currentPick.value?.name).toBe('recipient');

    controller.skip('recipient');
    await settle();
    expect(controller.currentPick.value?.name).toBe('item');
    await controller.fill('item', 'none');
    await settle();

    expect(session.runner.game.sent).toEqual([{ to: 'Player 4', item: 'none' }]);
  });
});
