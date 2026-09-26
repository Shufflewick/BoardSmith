// @vitest-environment jsdom
/**
 * #392: THE PANEL ASKS AN OPTIONAL PICK WHERE THE ACTION DECLARES IT.
 *
 * sotf's `sendMail` asks `to`, then an optional `recipient` narrowed by `to`,
 * then `message`. The panel used to ask `message` second and leave "Who
 * exactly?" to the end, where it read as an afterthought and got skipped. The
 * controller test (`useActionController.pick-order.test.ts`) holds the order;
 * this holds that the panel shows it, with the pick's own Skip label in place.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { EnrichedActionMetadata, PickChoicesResult } from '../../composables/useActionControllerTypes.js';
import { settle } from '../../composables/table-wiring.test-helper.js';
import { PEOPLE, recipientChoices } from '../../composables/send-mail.test-helper.js';


const sendMail: EnrichedActionMetadata = {
  name: 'sendMail',
  prompt: 'Send mail',
  selections: [
    { name: 'to', type: 'text', prompt: 'To' },
    {
      name: 'recipient',
      type: 'choice',
      prompt: 'Who exactly?',
      optional: 'Whoever matches',
      choices: PEOPLE.map((p) => ({ value: p, display: p })),
    },
    { name: 'message', type: 'text', prompt: 'Message' },
  ],
};

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function panel() {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const controller = useActionController({
    sendAction,
    availableActions: ref(['sendMail']),
    actionMetadata: ref({ sendMail }),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
    fetchPickChoices: vi.fn(async (_a: string, pick: string, _p: number, args: Record<string, unknown>): Promise<PickChoicesResult> => {
      if (pick !== 'recipient') return { success: true };
      return { success: true, choices: recipientChoices(args.to) };
    }),
  });
  await controller.start('sendMail');
  const wrapper = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    attachTo: document.body,
    props: {
      availableActions: ['sendMail'],
      actionMetadata: { sendMail },
      playerSeat: 1,
      isMyTurn: true,
    },
  });
  mounted.push(wrapper);
  await nextTick();
  return { wrapper, controller };
}

describe('the Action Panel asks an optional pick in declared order (#392)', () => {
  it('asks "Who exactly?" right after "To", with its Skip label beside the narrowed list', async () => {
    const { wrapper } = await panel();
    expect(wrapper.find('.selection-prompt').text()).toContain('To');

    await wrapper.find('.text-input input[type="text"]').setValue('Player 3');
    await wrapper.find('.text-input .done-button').trigger('click');
    await settle();

    expect(wrapper.find('.selection-prompt').text()).toContain('Who exactly?');
    const buttons = wrapper.findAll('.choice-buttons .choice-btn').map((b) => b.text());
    expect(buttons).toEqual(['Player 3', 'Player 30', 'Whoever matches']);
  });

  it('moves on to "Message" when the optional pick is skipped in place', async () => {
    const { wrapper, controller } = await panel();
    await wrapper.find('.text-input input[type="text"]').setValue('Player 4');
    await wrapper.find('.text-input .done-button').trigger('click');
    await settle();

    await wrapper.find('.skip-btn').trigger('click');
    await settle();

    expect(controller.currentArgs.value.recipient).toBeNull();
    expect(wrapper.find('.selection-prompt').text()).toContain('Message');
  });
});

/**
 * AN OPTIONAL PICK OFFERS SKIP WHATEVER SHAPE IT TAKES.
 *
 * Driving #392 in a browser found that the panel drew no Skip for an optional
 * pick that `dependsOn` an earlier one, nor for an optional multi-select: those
 * templates never had one, so a player could not skip the pick at all. Every
 * optional pick now offers its Skip label beside its choices.
 */
describe('an optional pick offers Skip in every shape (#392)', () => {
  async function panelAt(action: EnrichedActionMetadata) {
    const controller = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref([action.name]),
      actionMetadata: ref({ [action.name]: action }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      // Answers each pick with what its metadata carries, as a server would.
      fetchPickChoices: vi.fn(async (_a: string, pick: string): Promise<PickChoicesResult> => {
        const { choices, validElements, multiSelect } = action.selections.find((s) => s.name === pick)!;
        return { success: true, choices, validElements, multiSelect: typeof multiSelect === 'object' ? multiSelect : undefined };
      }),
    });
    await controller.start(action.name, action.name === 'narrow' ? { args: { to: 'Player 3' } } : undefined);
    const wrapper = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      attachTo: document.body,
      props: { availableActions: [action.name], actionMetadata: { [action.name]: action }, playerSeat: 1, isMyTurn: true },
    });
    mounted.push(wrapper);
    await settle();
    return { wrapper, controller };
  }

  const people = PEOPLE.map((p) => ({ value: p, display: p }));
  const shapes: Array<[string, EnrichedActionMetadata, string]> = [
    [
      'a choice that dependsOn an earlier pick',
      {
        name: 'narrow',
        prompt: 'Narrow',
        selections: [
          { name: 'to', type: 'choice', prompt: 'To', choices: [{ value: 'Player 3', display: 'Player 3' }] },
          {
            name: 'recipient',
            type: 'choice',
            prompt: 'Who exactly?',
            optional: 'Whoever matches',
            dependsOn: 'to',
            choicesByDependentValue: { 'Player 3': recipientChoices('Player 3') },
          },
        ],
      },
      'recipient',
    ],
    [
      'a multi-select choice',
      {
        name: 'invite',
        prompt: 'Invite',
        selections: [
          { name: 'guests', type: 'choice', prompt: 'Guests', optional: 'Nobody', multiSelect: { min: 1, max: 2 }, choices: people },
        ],
      },
      'guests',
    ],
    [
      'a multi-select of elements',
      {
        name: 'discard',
        prompt: 'Discard',
        selections: [
          {
            name: 'cards',
            type: 'elements',
            prompt: 'Cards',
            optional: 'Keep them',
            multiSelect: { min: 1, max: 2 },
            validElements: [{ id: 11, display: 'Ace' }, { id: 12, display: 'King' }],
          },
        ],
      },
      'cards',
    ],
    [
      'an element pick with nothing left to choose',
      {
        name: 'target',
        prompt: 'Target',
        selections: [{ name: 'unit', type: 'element', prompt: 'Unit', optional: 'Pass', validElements: [] }],
      },
      'unit',
    ],
  ];

  it.each(shapes)('%s', async (_shape, action, pickName) => {
    const { wrapper, controller } = await panelAt(action);
    const pick = action.selections.find((s) => s.name === pickName)!;
    expect(controller.currentPick.value?.name).toBe(pickName);
    expect(wrapper.find('.selection-input').text()).toContain('(optional)');

    const skip = wrapper.find('.skip-btn');
    expect(skip.exists()).toBe(true);
    expect(skip.text()).toBe(pick.optional);
    await skip.trigger('click');
    await settle();
    expect(controller.currentArgs.value[pickName]).toBeNull();
  });
});
