// @vitest-environment jsdom
/**
 * A dimmed control's reason must not outlive the player's interest in it (#261).
 *
 * The reported symptom was a reason bubble that "never goes away": hover a
 * disabled verb, take a different one, and the bubble stays painted over
 * whatever the Action Panel draws next, through dispatch after dispatch, with
 * the pointer nowhere near it.
 *
 * The bubble the player sees afterwards is not the one they hovered. The hover
 * one closes on `mouseleave`. The panel then redraws, focus is stranded by the
 * swap, and the focus-repair watcher (#27, #228) puts focus back into the
 * panel -- onto a dimmed control when the new step offers nothing operable,
 * which is exactly what a direction row of blocked compass points is. That
 * programmatic focus fires the directive's `focus` listener and opens the
 * tooltip again, and a mouse player never blurs it, so it stays.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, provide, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { ActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';
import DisabledReasonTooltip from '../helpers/DisabledReasonTooltip.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../composables/useBoardInteraction.js';
import {
  hideDisabledReason,
  DISABLED_TOOLTIP_ID,
} from '../../composables/useDisabledReasonTooltip.js';

/** Every direction is blocked, so the step the march opens offers nothing operable. */
const march: ActionMetadata = {
  name: 'march',
  prompt: 'March',
  selections: [
    {
      name: 'direction',
      type: 'choice',
      prompt: 'Which way?',
      choices: [
        { value: 'north', display: 'North', disabled: 'A ravine blocks your way.' },
        { value: 'south', display: 'South', disabled: 'The sea blocks your way.' },
      ],
    },
  ],
};

const rest: ActionMetadata = { name: 'rest', prompt: 'Rest', selections: [] };

/** The shell's arrangement: one panel, and the one tooltip every control borrows. */
function mountShell() {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  let controller!: ReturnType<typeof useActionController>;

  const Harness = defineComponent({
    components: { ActionPanel, DisabledReasonTooltip },
    setup() {
      provideBoardInteraction(createBoardInteraction());
      controller = useActionController({
        sendAction,
        availableActions: ref(['march', 'rest']),
        actionMetadata: ref({ march, rest }),
        isMyTurn: ref(true),
        autoFill: false,
        autoExecute: false,
      });
      provide(GAME_CONTEXT_KEYS.actionController, controller);
      return { march, rest };
    },
    template: `<div><ActionPanel :available-actions="['march', 'rest']" :player-seat="1"
      :is-my-turn="true" :action-metadata="{ march, rest }"
      :disabled-actions="{ rest: 'You are not tired.' }" /><DisabledReasonTooltip /></div>`,
  });

  const wrapper = mount(Harness, { attachTo: document.body });
  return { wrapper, controller };
}

/** The bubble as the player sees it: the teleported node, or nothing. */
const bubbleText = (): string | null =>
  document.getElementById(DISABLED_TOOLTIP_ID)?.textContent?.trim() ?? null;

/** What a real pointer does on the way to clicking something else. */
function clickWithPointer(el: HTMLElement): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  el.dispatchEvent(new Event('click', { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  hideDisabledReason();
});

describe('the disabled-reason bubble after a verb is taken (#261)', () => {
  it('is gone once the pointer has left and another verb has been taken', async () => {
    const { wrapper, controller } = mountShell();
    await nextTick();

    const disabledVerb = wrapper.find('[data-bs-action="rest"]').element as HTMLElement;
    disabledVerb.dispatchEvent(new Event('mouseenter'));
    await nextTick();
    expect(bubbleText()).toContain('You are not tired.');

    // The pointer travels to the enabled verb and takes it.
    disabledVerb.dispatchEvent(new Event('mouseleave'));
    clickWithPointer(wrapper.find('[data-bs-action="march"]').element as HTMLElement);
    await nextTick();
    await nextTick();
    await nextTick();

    // The panel has redrawn into the blocked direction row.
    expect(controller.currentAction.value).toBe('march');
    const directions = wrapper.findAll('.choice-btn').map(b => b.text());
    expect(directions).toEqual(['North', 'South']);

    expect(bubbleText()).toBe(null);
    wrapper.unmount();
  });
});
