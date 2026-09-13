// @vitest-environment jsdom
/**
 * #248: THE STANDARD PANEL SHOWS THE PRICE OF THE DRAFT, BEFORE DONE.
 *
 * The reporter's bar, with a 2 in the spinbutton and nothing else on it:
 *
 *   Purchase boost
 *   storage · 5 Essentia per week
 *   Weeks · 5 Essentia per week (skip for one week; zero adds no time) (optional)
 *   (at least 0, whole numbers)
 *   Done
 *
 * Every line there is the game's own prompt copy. What is missing is the one
 * thing only the game can compute and only the panel can show: ten Essentia, and
 * the date the boost would then run to. So the panel now renders the quote the
 * controller holds, and -- because a price rendered in the same tick as the
 * charge is no price at all -- draws a CONFIRM for an action that quotes instead
 * of submitting the moment the last field is answered.
 *
 * WHAT A COMPONENT TEST CAN HOLD, and what it cannot: the markup, the copy, the
 * live region, which control is reachable and what pressing it calls. Whether
 * ten Essentia is legible beside the field is measured in a real browser by
 * `scripts/draft-quote-browser.mjs`.
 */
import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';
import type { ActionQuoteResult } from '../../composables/useActionControllerTypes.js';

const BOOST: ActionMetadata = {
  name: 'boost',
  prompt: 'Purchase boost',
  quote: true,
  selections: [
    {
      name: 'resource',
      type: 'choice',
      prompt: 'Resource',
      choices: [{ value: 'storage', display: 'Storage' }],
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

/** The game's arithmetic, so what is asserted is a price and not a fixture. */
const priceOf = (args: Record<string, unknown>): ActionQuoteResult => {
  if (args.resource === undefined) return { success: true, lines: null };
  const weeks = args.weeks === undefined ? 1 : (args.weeks as number);
  return { success: true, lines: [`${weeks * 5} Essentia`, `storage boosted for ${weeks} week(s)`] };
};

function panelOver(
  quote: (action: string, args: Record<string, unknown>) => Promise<ActionQuoteResult> = async (
    _action,
    args,
  ) => priceOf(args),
) {
  const metadata: Record<string, ActionMetadata> = { boost: BOOST };
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const controller = useActionController({
    sendAction,
    availableActions: ref(['boost']),
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoFill: false,
    fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
    fetchActionQuote: vi.fn(quote),
  });

  const mountPanel = async () => {
    const wrapper = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      attachTo: document.body,
      props: {
        availableActions: ['boost'],
        actionMetadata: metadata,
        playerSeat: 1,
        isMyTurn: true,
      },
    });
    await nextTick();
    return wrapper;
  };

  return { controller, mountPanel, sendAction };
}

/** Let the quote's round trip and the render that follows it settle. */
const settled = async () => {
  for (let i = 0; i < 8; i++) await nextTick();
};

/**
 * A MOUNTED PANEL WITH THE RESOURCE ANSWERED, WHICH IS WHERE EVERY CASE STARTS.
 *
 * The draft reaches the number field only once something is bound, because the
 * controller asks the required pick first -- so "storage, then the field" is the
 * arrangement and not the subject of any of these.
 */
async function bar(quote?: Parameters<typeof panelOver>[0]) {
  const over = panelOver(quote);
  void over.controller.start('boost', {});
  await settled();
  const wrapper = await over.mountPanel();
  await over.controller.fill('resource', 'storage');
  await settled();
  return { ...over, wrapper };
}

/** Type into the number field without submitting it, and let the price arrive. */
async function type(wrapper: Awaited<ReturnType<typeof bar>>['wrapper'], weeks: number) {
  await wrapper.find('.number-input input').setValue(weeks);
  await settled();
}

/** What the bar says the draft costs. */
const quoteOn = (wrapper: Awaited<ReturnType<typeof bar>>['wrapper']) =>
  wrapper.find('[data-bs-quote]');

describe('the price of the draft is on the bar before Done (#248)', () => {
  it('shows the total for a number the player has TYPED and not submitted', async () => {
    const { wrapper } = await bar();

    // The field, answered but not submitted -- exactly the reporter's state.
    await type(wrapper, 2);

    const quote = quoteOn(wrapper);
    expect(quote.exists()).toBe(true);
    expect(quote.text()).toContain('10 Essentia');
    expect(quote.text()).toContain('storage boosted for 2 week(s)');
    // And Done is still there: the quote is beside the question, not instead of it.
    expect(wrapper.find('.number-input button').exists()).toBe(true);
    wrapper.unmount();
  });

  it('re-prices as the field changes', async () => {
    const { wrapper } = await bar();

    await type(wrapper, 2);
    expect(quoteOn(wrapper).text()).toContain('10 Essentia');

    await type(wrapper, 3);

    expect(quoteOn(wrapper).text()).toContain('15 Essentia');
    expect(quoteOn(wrapper).text()).not.toContain('10 Essentia');
    wrapper.unmount();
  });

  it('is a live region, so a screen reader hears the price move', async () => {
    const { wrapper } = await bar();

    const quote = quoteOn(wrapper);
    expect(quote.attributes('role')).toBe('status');
    expect(quote.attributes('aria-live')).toBe('polite');
    wrapper.unmount();
  });

  it('says it is working the price out rather than showing the old one', async () => {
    let release: ((value: ActionQuoteResult) => void) | null = null;
    const { wrapper } = await bar((_action, args) => {
      if (args.weeks === 4) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve(priceOf(args));
    });
    await type(wrapper, 2);

    await type(wrapper, 4);

    const quote = quoteOn(wrapper);
    expect(quote.text()).not.toContain('10 Essentia');
    expect(quote.text().toLowerCase()).toContain('price');

    release!(priceOf({ resource: 'storage', weeks: 4 }));
    await settled();
    expect(quoteOn(wrapper).text()).toContain('20 Essentia');
    wrapper.unmount();
  });

  it("shows the world's refusal in place of a price", async () => {
    const { wrapper } = await bar(async () => ({
      success: false,
      error: 'That empire is no longer yours.',
    }));

    expect(quoteOn(wrapper).text()).toContain('That empire is no longer yours.');
    wrapper.unmount();
  });

  it('draws no quote region at all for an action that does not quote', async () => {
    const plain: ActionMetadata = {
      name: 'plain',
      prompt: 'Plain',
      selections: [{ name: 'weeks', type: 'number', prompt: 'Weeks' }],
    };
    const controller = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref(['plain']),
      actionMetadata: ref({ plain }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
    });
    void controller.start('plain', {});
    await nextTick();
    const wrapper = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      attachTo: document.body,
      props: { availableActions: ['plain'], actionMetadata: { plain }, playerSeat: 1, isMyTurn: true },
    });
    await settled();

    expect(wrapper.find('[data-bs-quote]').exists()).toBe(false);
    wrapper.unmount();
  });
});

/** A COMPLETED draft, submitted as far as the panel will take it -- which for a
 *  quoted action is the confirmation and not the purchase. */
async function drafted(weeks: number, quote?: Parameters<typeof panelOver>[0]) {
  const over = await bar(quote);
  await type(over.wrapper, weeks);
  await over.wrapper.find('.number-input button').trigger('click');
  await settled();
  return over;
}

describe('the last field is not the purchase (#248)', () => {
  it('offers a confirmation instead of submitting when the draft completes', async () => {
    const { wrapper, sendAction } = await drafted(2);

    expect(sendAction).not.toHaveBeenCalled();
    const confirm = wrapper.find('[data-bs-confirm]');
    expect(confirm.exists()).toBe(true);
    // The price is still on screen at the moment of deciding, which is the whole
    // requirement: it was shown BEFORE the purchase, not after it.
    expect(quoteOn(wrapper).text()).toContain('10 Essentia');
    wrapper.unmount();
  });

  it('sends the order when that confirmation is pressed', async () => {
    const { wrapper, sendAction } = await drafted(2);

    await wrapper.find('[data-bs-confirm]').trigger('click');
    await settled();

    expect(sendAction).toHaveBeenCalledWith('boost', { resource: 'storage', weeks: 2 });
    wrapper.unmount();
  });

  it('refuses the confirmation while the price of the final draft is unknown', async () => {
    const { wrapper, sendAction } = await drafted(2, () => new Promise(() => {}));

    const confirm = wrapper.find('[data-bs-confirm]');
    // Reachable by keyboard and carrying the reason, which is what
    // `v-disabled-reason` is for: a natively disabled button takes the reason
    // with it.
    expect(confirm.attributes('aria-disabled')).toBe('true');
    await confirm.trigger('click');
    await settled();
    expect(sendAction).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('lets the player skip the optional quantity and confirm the default', async () => {
    const { wrapper, sendAction } = await bar();

    await wrapper.find('.number-input .skip-btn').trigger('click');
    await settled();

    expect(quoteOn(wrapper).text()).toContain('5 Essentia');
    await wrapper.find('[data-bs-confirm]').trigger('click');
    await settled();

    // Omitted stays omitted: the game's own default, not a zero the panel made up.
    expect(sendAction).toHaveBeenCalledWith('boost', { resource: 'storage' });
    wrapper.unmount();
  });
});
