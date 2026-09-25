// @vitest-environment jsdom
/**
 * #258: THE NUMBER FIELD OPENS ON A VALUE, AND SAYS WHAT THE VALUE MEANS.
 *
 * The reported game asks for an age between 16 and 65, wants the field to open
 * on 35, and wants the life stage the number falls into shown as the player
 * changes it. The panel could do neither: it opened empty, and the only place
 * the meaning could be said was the prompt, which is a sentence rather than a
 * control.
 *
 * What these cases hold, and why each one is a separate risk:
 *
 *   THE PRE-FILL IS A DRAFT, NOT A LOCK. It lands in the same
 *     `currentPickDraft` everything else the player types lands in -- so a
 *     custom UI reading `useBoardInteraction` sees the same 35 the panel draws,
 *     which is the parity rule, and there is no second place a starting value
 *     could live.
 *   CLEARING IT STAYS CLEARED. A pre-fill that reappeared the moment the player
 *     emptied the box would be a field fighting its own player, and it is the
 *     obvious way to get this wrong: an initial resolved on every read cannot
 *     tell "not answered yet" from "deliberately emptied".
 *   THE LABEL FOLLOWS THE VALUE. It is about the number in the box right now,
 *     so it moves with every keystroke and disappears when there is no number.
 */
import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';

import { mountPanelAt, panelsOver } from './action-panel-editor.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';
import { Action, Game, Player } from '../../../engine/index.js';
import type { GameOptions } from '../../../engine/index.js';
import { buildActionMetadata } from '../../../engine/element/action-metadata.js';

/** The ticket's game, written the way a game author writes it. */
class PrefillGame extends Game<PrefillGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PrefillGame>('ask-age')
        .prompt('Tell the census your age')
        .enterNumber('age', {
          prompt: 'How old are you?',
          min: 16,
          max: 65,
          integer: true,
          initial: 35,
          display: (age) =>
            age <= 20
              ? 'barely grown'
              : age <= 30
                ? 'young'
                : age <= 50
                  ? 'in your prime'
                  : 'seasoned',
        })
        .execute(() => ({ success: true })),
    );
  }
}

/** The ticket's own bands, as they reach a host: one label per value. */
const AGE_LABELS: Record<string, string> = {};
for (let age = 16; age <= 65; age++) {
  AGE_LABELS[String(age)] =
    age <= 20 ? 'barely grown' : age <= 30 ? 'young' : age <= 50 ? 'in your prime' : 'seasoned';
}

const ASK_AGE: EnrichedActionMetadata = {
  name: 'ask-age',
  prompt: 'Tell the census your age',
  selections: [
    {
      name: 'age',
      type: 'number',
      prompt: 'How old are you?',
      min: 16,
      max: 65,
      integer: true,
      initial: 35,
      valueLabels: AGE_LABELS,
    },
  ],
};

const BARE_NUMBER: EnrichedActionMetadata = {
  name: 'wager',
  prompt: 'Place a wager',
  selections: [{ name: 'amount', type: 'number', prompt: 'How much', min: 1 }],
};

const fieldOf = (wrapper: { find: (s: string) => { element: Element } }) =>
  wrapper.find('.number-input input[type="number"]').element as HTMLInputElement;

describe('#258 — the field opens on the value the game named', () => {
  it('renders the starting value in the box', async () => {
    const { wrapper } = await mountPanelAt(ASK_AGE);

    expect(fieldOf(wrapper).value).toBe('35');
    wrapper.unmount();
  });

  it('puts it in the SAME draft a custom UI reads, not a second place', async () => {
    const { wrapper, controller } = await mountPanelAt(ASK_AGE);

    expect(controller.currentPickDraft.value).toBe(35);
    wrapper.unmount();
  });

  it('submits it unchanged when the player accepts it as it stands', async () => {
    const { wrapper, controller } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input .done-button').trigger('click');
    await nextTick();

    expect(controller.currentArgs.value.age).toBe(35);
    wrapper.unmount();
  });

  it('lets the player type over it', async () => {
    const { wrapper, controller } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input input[type="number"]').setValue('22');

    expect(controller.currentPickDraft.value).toBe(22);
    wrapper.unmount();
  });

  it('STAYS EMPTY once the player clears it', async () => {
    const { wrapper, controller } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input input[type="number"]').setValue('');
    await nextTick();

    expect(controller.currentPickDraft.value).toBeNull();
    expect(fieldOf(wrapper).value).toBe('');
    wrapper.unmount();
  });

  it('opens empty for a pick that named no starting value', async () => {
    const { wrapper, controller } = await mountPanelAt(BARE_NUMBER);

    expect(fieldOf(wrapper).value).toBe('');
    expect(controller.currentPickDraft.value).toBeNull();
    wrapper.unmount();
  });
});

describe('#258 — the field says what the value in it means', () => {
  it('shows the label of the value it opened on', async () => {
    const { wrapper } = await mountPanelAt(ASK_AGE);

    expect(wrapper.find('.number-input .value-label').text()).toBe('in your prime');
    wrapper.unmount();
  });

  it('moves the label with the value', async () => {
    const { wrapper } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input input[type="number"]').setValue('18');
    await nextTick();

    expect(wrapper.find('.number-input .value-label').text()).toBe('barely grown');
    wrapper.unmount();
  });

  it('says nothing when there is no value to be about', async () => {
    const { wrapper } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input input[type="number"]').setValue('');
    await nextTick();

    expect(wrapper.find('.number-input .value-label').exists()).toBe(false);
    wrapper.unmount();
  });

  it('says nothing about a value outside the range the game labelled', async () => {
    // The panel refuses the value separately; what it must not do is invent a
    // meaning for a number the game never described.
    const { wrapper } = await mountPanelAt(ASK_AGE);

    await wrapper.find('.number-input input[type="number"]').setValue('99');
    await nextTick();

    expect(wrapper.find('.number-input .value-label').exists()).toBe(false);
    wrapper.unmount();
  });

  it('ANNOUNCES the label, because a change with no keystroke is silent otherwise', async () => {
    const { wrapper } = await mountPanelAt(ASK_AGE);

    expect(wrapper.find('.number-input .value-label').attributes('role')).toBe('status');
    wrapper.unmount();
  });

  it('renders no label region at all for a pick the game did not label', async () => {
    const { wrapper } = await mountPanelAt(BARE_NUMBER);

    expect(wrapper.find('.number-input .value-label').exists()).toBe(false);
    wrapper.unmount();
  });
});

/**
 * THE FIXTURES ABOVE ARE HAND-BUILT, AND THIS IS THE ONE THAT IS NOT.
 *
 * `docs/TEST-FIXTURES.md`: a literal `EnrichedActionMetadata` asserts against a shape
 * the engine might have stopped sending, which is twice now how a green suite
 * hid the exact defect it existed to catch. So one case drives the real thing --
 * a real `Action.create(...).enterNumber(...)` declaration, through the real
 * `buildActionMetadata`, into the real panel -- and it is the case that proves
 * the whole path the ticket is about: declaration, selection descriptor, offer,
 * render.
 */
describe('#258 — end to end, from the declaration a game actually writes', () => {
  it('opens on the declared value and shows the declared label', async () => {
    const game = new PrefillGame({ playerCount: 1, playerNames: ['Solo'] });
    const offered = buildActionMetadata(game, game.getPlayer(1)!, ['ask-age']);

    const { controller, mountPanel } = panelsOver([offered['ask-age']!]);
    await controller.start('ask-age', {});
    await nextTick();
    const wrapper = await mountPanel();

    expect(fieldOf(wrapper).value).toBe('35');
    expect(controller.currentPickDraft.value).toBe(35);
    expect(wrapper.find('.number-input .value-label').text()).toBe('in your prime');

    await wrapper.find('.number-input input[type="number"]').setValue('18');
    await nextTick();
    expect(wrapper.find('.number-input .value-label').text()).toBe('barely grown');

    await wrapper.find('.number-input .done-button').trigger('click');
    await nextTick();
    expect(controller.currentArgs.value.age).toBe(18);
    wrapper.unmount();
  });
});
