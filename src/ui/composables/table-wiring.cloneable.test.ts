// @vitest-environment jsdom
/**
 * #568: THE TABLE-WIRING HELPER SENDS OPS THE WAY PRODUCTION DOES.
 *
 * GameShell's transport strips Vue reactivity from every op through
 * `toCloneablePayload` before the op crosses postMessage. The helper used to
 * hand the controller's args to the session as they were, so an action whose
 * pick holds an object (a reactive proxy once the controller stores it) threw a
 * `DataCloneError` that production never hits, and tests fell back to a stub
 * controller. A live seat now plays such an action through to the game.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../../engine/index.js';

interface Card { suit: string; rank: number }

const CARDS: Card[] = [{ suit: 'hearts', rank: 3 }, { suit: 'spades', rank: 7 }];

class CardGame extends Game<CardGame, Player> {
  /** The card `play` executed with. */
  played: Card | undefined;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<CardGame>('play')
        .chooseFrom('card', { choices: CARDS, display: (c: Card) => `${c.rank} of ${c.suit}` })
        .execute((args, ctx) => {
          (ctx.game as CardGame).played = { ...(args.card as Card) };
          return { success: true };
        }),
    );
    this.setFlow(defineFlow({ root: actionStep({ actions: ['play'] }) }));
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the table-wiring helper sends cloneable ops (#568)', () => {
  it('plays an action whose pick is an object through a live seat', async () => {
    const { session, wiring } = await mountLiveSeat(CardGame, 'bs568', mounted);
    const { controller } = wiring;
    await settle();

    await controller.start('play');
    const spades = controller.getChoices(controller.currentPick.value!).find((c) => c.display === '7 of spades');
    expect(spades).toBeDefined();
    const result = await controller.fill('card', spades!.value);
    await settle();

    expect(result).toMatchObject({ valid: true });
    // A reactive proxy in the args failed here as "#<Object> could not be cloned."
    expect(controller.lastError.value).toBeNull();
    expect(session.readGame().played).toEqual({ suit: 'spades', rank: 7 });
  });
});
