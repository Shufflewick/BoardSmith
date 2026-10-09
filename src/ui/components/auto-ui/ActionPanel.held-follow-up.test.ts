// @vitest-environment jsdom
/**
 * The Action Panel lists a held follow-up (#494).
 *
 * A seat holding a follow-up keeps its turn until it takes it or takes another
 * action the step offers. A player who cancels the follow-up must still be able
 * to start it again, above all when the step offers nothing else: the panel
 * shows a button for it whenever no action is in progress.
 */
import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import { stubActionController, mountPanel } from './action-panel-controller.test-helper.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

const held = {
  action: 'loot',
  args: { by: 1 },
  metadata: { name: 'loot', prompt: 'Loot the site', selections: [] },
};

describe('a held follow-up in the Action Panel', () => {
  it('is offered as a button when the step offers nothing else, and the button resumes it', async () => {
    const controller = stubActionController({ heldFollowUp: ref(held) });
    const wrapper = mountPanel(controller, { availableActions: [], playerSeat: 1, isMyTurn: true });

    const button = wrapper.find('[data-bs-follow-up]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Loot the site');
    await button.trigger('click');

    expect(controller.resumeFollowUp).toHaveBeenCalledTimes(1);
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('is offered once, not beside a second button, when the step lists the same action', async () => {
    const controller = stubActionController({ heldFollowUp: ref(held) });
    const wrapper = mountPanel(controller, {
      availableActions: ['loot', 'rest'],
      actionMetadata: {
        loot: { name: 'loot', prompt: 'Loot the site', selections: [] },
        rest: { name: 'rest', prompt: 'Rest', selections: [] },
      },
      playerSeat: 1,
      isMyTurn: true,
    });

    expect(wrapper.findAll('[data-bs-action="loot"]')).toHaveLength(1);
    await wrapper.find('[data-bs-action="loot"]').trigger('click');
    expect(controller.resumeFollowUp).toHaveBeenCalledTimes(1);
    expect(controller.execute).not.toHaveBeenCalled();
  });

  it('is not shown while an action is in progress, or when no follow-up is held', () => {
    const busy = stubActionController({ heldFollowUp: ref(held), currentAction: ref('loot') });
    expect(mountPanel(busy).find('[data-bs-follow-up]').exists()).toBe(false);

    const none = stubActionController();
    expect(mountPanel(none).find('[data-bs-follow-up]').exists()).toBe(false);
  });

  // The button starts through the shared action mutators (#513), so it is
  // refused by the same guards as every other start.
  it('does not resume the follow-up while the seat is viewing history', async () => {
    const controller = stubActionController({ heldFollowUp: ref(held) });
    const wrapper = mountPanel(
      controller,
      { availableActions: [], playerSeat: 1, isMyTurn: true },
      { provide: { [GAME_CONTEXT_KEYS.isViewingHistory as symbol]: ref(true) } },
    );

    await wrapper.find('[data-bs-follow-up]').trigger('click');

    expect(controller.resumeFollowUp).not.toHaveBeenCalled();
  });
});
