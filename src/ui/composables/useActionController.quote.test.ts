/**
 * #248: THE PRICE IS ASKED FOR BEFORE THE PURCHASE, AND SHOWN ONLY WHILE IT IS TRUE.
 *
 * A world action that charges for a typed number had no way to tell the player
 * the total. Everything the controller already had came too late or too early:
 * the offer is enumerated with nothing bound, `validate` runs at submit, a
 * receipt is written after the money, and filling the last selection
 * auto-executed on the spot -- so there was no moment between "the draft is
 * complete" and "the world has been charged" for anything to be rendered in.
 *
 * So an action that declares `.quote()` is walked differently here, and these
 * are the four rules of it:
 *
 *   THE DRAFT IS WHAT IS PRICED, not the bound args. A number typed into the
 *     editor and never submitted is in the args the quote is asked with, which
 *     is the entire point -- and an omitted optional quantity stays omitted, so
 *     the game's own default applies to the preview exactly as it applies to the
 *     purchase.
 *   A QUOTE IS STAMPED WITH THE DRAFT IT IS FOR. A price for `weeks: 2` is
 *     unreadable the moment the field says 3. There is no way to render a stale
 *     price, because a quote whose stamp does not match the live draft is not
 *     exposed at all.
 *   THE LAST PICK IS NOT THE PURCHASE. Auto-execute is off for a quoted action:
 *     filling everything leaves the player in front of the quote, and confirming
 *     is what sends the order.
 *   AND IT IS ONE QUESTION AT A TIME. Only one quote is in flight; a draft that
 *     moves while one is outstanding is asked about when it comes back, so a
 *     player holding a key down cannot open a request per keystroke.
 *
 * An action with no quote is untouched by every one of those, which the last
 * describe block holds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { useActionController, type ActionMetadata } from './useActionController.js';
import type { ActionQuoteResult } from './useActionControllerTypes.js';
import { _clearShownWarnings } from '../../utils/dev.js';

beforeEach(() => { _clearShownWarnings(); });

/** The reporter's own action: an optional quantity, then a required resource. */
const BOOST: ActionMetadata = {
  name: 'boost',
  prompt: 'Purchase boost',
  quote: true,
  selections: [
    {
      name: 'resource',
      type: 'choice',
      prompt: 'Resource',
      choices: [
        { value: 'food', display: 'Food' },
        { value: 'storage', display: 'Storage' },
      ],
    },
    {
      name: 'weeks',
      type: 'number',
      prompt: 'Weeks',
      min: 0,
      integer: true,
      optional: 'skip for one week',
    },
  ],
};

/** The same shape with no quote declared, which is every other action. */
const PLAIN: ActionMetadata = {
  name: 'plain',
  prompt: 'Plain purchase',
  selections: [
    { name: 'resource', type: 'choice', prompt: 'Resource', choices: [{ value: 'food', display: 'Food' }] },
  ],
};

/** The game's own arithmetic, so a test asserts a price and not a mock. */
function priceOf(args: Record<string, unknown>): ActionQuoteResult {
  const resource = args.resource as string | undefined;
  if (resource === undefined) return { success: true, lines: null };
  const weeks = args.weeks === undefined ? 1 : (args.weeks as number);
  return {
    success: true,
    lines: [`${weeks * 5} Essentia`, weeks === 0 ? 'adds no time' : `${resource} for ${weeks} week(s)`],
  };
}

function controllerOver(actions: ActionMetadata[], quote = async (
  _action: string,
  args: Record<string, unknown>,
): Promise<ActionQuoteResult> => priceOf(args)) {
  const metadata: Record<string, ActionMetadata> = {};
  for (const action of actions) metadata[action.name] = action;
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const fetchActionQuote = vi.fn(quote);
  const controller = useActionController({
    sendAction,
    availableActions: ref(actions.map((a) => a.name)),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoFill: false,
    fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
    fetchActionQuote,
  });
  return { controller, sendAction, fetchActionQuote };
}

/** Let the quote's own round trip settle. */
const settled = async () => {
  for (let i = 0; i < 6; i++) await nextTick();
};

describe('the draft in front of the player is what gets priced', () => {
  it('prices a number the player has TYPED and not yet submitted', async () => {
    const { controller, fetchActionQuote } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();

    controller.setPickDraft(2);
    await settled();

    expect(fetchActionQuote).toHaveBeenCalledWith('boost', { resource: 'storage', weeks: 2 }, 0);
    // The total the reporter's bar could not show, on screen before Done.
    expect(controller.actionQuote.value).toEqual(['10 Essentia', 'storage for 2 week(s)']);
  });

  it('re-prices as the draft moves', async () => {
    const { controller } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    controller.setPickDraft(2);
    await settled();
    expect(controller.actionQuote.value?.[0]).toBe('10 Essentia');

    controller.setPickDraft(3);
    await settled();

    expect(controller.actionQuote.value?.[0]).toBe('15 Essentia');
  });

  it('prices what is bound before anything is typed at all', async () => {
    // An omitted quantity is the game's own default -- five, not zero -- and the
    // player is shown that before they touch the field.
    const { controller } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();

    expect(controller.actionQuote.value).toEqual(['5 Essentia', 'storage for 1 week(s)']);
  });

  it('prices a ZERO draft as zero, which is not the same as omitting it', async () => {
    const { controller, fetchActionQuote } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    controller.setPickDraft(0);
    await settled();

    expect(fetchActionQuote).toHaveBeenCalledWith('boost', { resource: 'storage', weeks: 0 }, 0);
    expect(controller.actionQuote.value).toEqual(['0 Essentia', 'adds no time']);
  });

  it('keeps a SKIPPED quantity out of the draft entirely', async () => {
    const { controller, fetchActionQuote } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();
    controller.skip('weeks');
    await settled();

    const last = fetchActionQuote.mock.calls.at(-1)!;
    expect(last[1]).toEqual({ resource: 'storage' });
    expect(Object.keys(last[1] as object)).not.toContain('weeks');
  });

  it('asks for nothing at all until an action that quotes is open', async () => {
    const { controller, fetchActionQuote } = controllerOver([BOOST]);
    expect(fetchActionQuote).not.toHaveBeenCalled();
    await controller.start('boost', {});
    await settled();
    // Opened, nothing drafted: the game is asked, and says there is nothing to
    // price yet rather than the controller guessing that for it.
    expect(fetchActionQuote).toHaveBeenCalledWith('boost', {}, 0);
    expect(controller.actionQuote.value).toBeNull();
  });
});

describe('a price is shown only while it is the price of what is on screen', () => {
  it('never exposes a quote for a draft the player has moved on from', async () => {
    // The answer for `weeks: 2` arrives AFTER the field has become 3. It is
    // dropped rather than rendered beside the 3, because a price for a draft
    // nobody is holding is worse than no price at all.
    let release: ((value: ActionQuoteResult) => void) | null = null;
    const { controller } = controllerOver([BOOST], (_action, args) => {
      if (args.weeks === 2) {
        return new Promise<ActionQuoteResult>((resolve) => { release = resolve; });
      }
      return Promise.resolve(priceOf(args));
    });
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();
    controller.setPickDraft(2);
    await settled();
    controller.setPickDraft(3);
    await settled();

    release!(priceOf({ resource: 'storage', weeks: 2 }));
    await settled();

    expect(controller.actionQuote.value).not.toContain('10 Essentia');
    expect(controller.actionQuote.value?.[0]).toBe('15 Essentia');
  });

  it('says a price is being worked out rather than showing the last one', async () => {
    let release: ((value: ActionQuoteResult) => void) | null = null;
    const { controller } = controllerOver([BOOST], (_action, args) => {
      if (args.weeks === 4) {
        return new Promise<ActionQuoteResult>((resolve) => { release = resolve; });
      }
      return Promise.resolve(priceOf(args));
    });
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    controller.setPickDraft(2);
    await settled();
    expect(controller.quotePending.value).toBe(false);

    controller.setPickDraft(4);
    await settled();

    expect(controller.quotePending.value).toBe(true);
    expect(controller.actionQuote.value).toBeNull();

    release!(priceOf({ resource: 'storage', weeks: 4 }));
    await settled();
    expect(controller.quotePending.value).toBe(false);
    expect(controller.actionQuote.value?.[0]).toBe('20 Essentia');
  });

  it('reports a refusal as a refusal, and shows no price with it', async () => {
    const { controller } = controllerOver([BOOST], async () => ({
      success: false,
      error: 'That empire is no longer yours.',
    }));
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();

    expect(controller.quoteError.value).toBe('That empire is no longer yours.');
    expect(controller.actionQuote.value).toBeNull();
  });

  it('keeps ONE quote in flight, and asks again for the draft it ended on', async () => {
    const releases: Array<() => void> = [];
    const { controller, fetchActionQuote } = controllerOver([BOOST], (_action, args) =>
      new Promise<ActionQuoteResult>((resolve) => {
        releases.push(() => resolve(priceOf(args)));
      }),
    );
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();
    expect(fetchActionQuote).toHaveBeenCalledTimes(1);

    // Four keystrokes while the first answer is still outstanding.
    for (const typed of [1, 12, 123, 1234]) {
      controller.setPickDraft(typed);
      await settled();
    }
    expect(fetchActionQuote).toHaveBeenCalledTimes(1);

    releases[0]!();
    await settled();

    // Exactly one more, and it is about where the typing STOPPED.
    expect(fetchActionQuote).toHaveBeenCalledTimes(2);
    expect(fetchActionQuote.mock.calls[1]![1]).toEqual({ resource: 'storage', weeks: 1234 });
  });

  it('forgets the quote when the action is cancelled', async () => {
    const { controller } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await settled();
    expect(controller.actionQuote.value).not.toBeNull();

    controller.cancel();
    await settled();

    expect(controller.actionQuote.value).toBeNull();
    expect(controller.quotePending.value).toBe(false);
  });
});

describe('the last pick is not the purchase', () => {
  it('does NOT auto-execute a quoted action when every selection is filled', async () => {
    const { controller, sendAction } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await controller.fill('weeks', 2);
    await settled();

    expect(sendAction).not.toHaveBeenCalled();
    expect(controller.isReady.value).toBe(true);
    expect(controller.awaitingConfirmation.value).toBe(true);
  });

  it('shows the price of the completed draft while it waits to be confirmed', async () => {
    const { controller } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await controller.fill('weeks', 2);
    await settled();

    expect(controller.actionQuote.value).toEqual(['10 Essentia', 'storage for 2 week(s)']);
  });

  it('sends the order when the player confirms, with the drafted args', async () => {
    const { controller, sendAction } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await controller.fill('weeks', 2);
    await settled();

    const result = await controller.confirm();

    expect(result.success).toBe(true);
    expect(sendAction).toHaveBeenCalledWith('boost', { resource: 'storage', weeks: 2 });
    expect(controller.awaitingConfirmation.value).toBe(false);
  });

  it('submits an omitted quantity as omitted, exactly as before', async () => {
    const { controller, sendAction } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    controller.skip('weeks');
    await settled();

    await controller.confirm();

    expect(sendAction).toHaveBeenCalledWith('boost', { resource: 'storage' });
  });

  it('submits a zero quantity as zero', async () => {
    const { controller, sendAction } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await controller.fill('weeks', 0);
    await settled();

    await controller.confirm();

    expect(sendAction).toHaveBeenCalledWith('boost', { resource: 'storage', weeks: 0 });
  });

  it('refuses to confirm a draft that is not finished', async () => {
    const { controller, sendAction } = controllerOver([BOOST]);
    await controller.start('boost', {});
    await settled();

    const result = await controller.confirm();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Resource/i);
    expect(sendAction).not.toHaveBeenCalled();
  });

  it('refuses to confirm while the price of the final draft is still unknown', async () => {
    // The one thing this feature exists to prevent: pressing the button with no
    // price on screen.
    const { controller, sendAction } = controllerOver([BOOST], () => new Promise(() => {}));
    await controller.start('boost', {});
    await controller.fill('resource', 'storage');
    await controller.fill('weeks', 2);
    await settled();

    expect(controller.confirmDisabledReason.value).toMatch(/price/i);
    const result = await controller.confirm();

    expect(result.success).toBe(false);
    expect(sendAction).not.toHaveBeenCalled();
  });
});

describe('an action that declares no quote is walked exactly as before', () => {
  it('auto-executes on the last pick, and asks for no price', async () => {
    const { controller, sendAction, fetchActionQuote } = controllerOver([PLAIN]);
    await controller.start('plain', {});
    await controller.fill('resource', 'food');
    await settled();

    expect(sendAction).toHaveBeenCalledWith('plain', { resource: 'food' });
    expect(fetchActionQuote).not.toHaveBeenCalled();
    expect(controller.awaitingConfirmation.value).toBe(false);
    expect(controller.actionQuote.value).toBeNull();
  });
});
