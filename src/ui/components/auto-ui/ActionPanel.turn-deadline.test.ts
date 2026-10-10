// @vitest-environment jsdom
/**
 * THE ACTION PANEL DRAWS THE HOST'S DEADLINE (#301).
 *
 * The panel and a custom UI read the same `turnDeadline` from the game context,
 * so a keyboard or screen-reader player sees the countdown a board draws. At
 * zero the panel says it is waiting for the server and leaves every action
 * operable: the host closes the step, never the panel on its own. The countdown
 * is a `timer`, which is not a live region, so nothing is announced each second.
 */
import { describe, it, expect } from 'vitest';
import { computed, ref } from 'vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { TurnDeadline } from '../../composables/useTurnDeadline.js';
import { mountPanel as mountOver, stubActionController } from './action-panel-controller.test-helper.js';

function mountPanel(deadline: TurnDeadline | null | 'unprovided', isMyTurn = true) {
  const provide: Record<symbol, unknown> = {};
  if (deadline !== 'unprovided') {
    provide[GAME_CONTEXT_KEYS.turnDeadline as symbol] = computed(() => deadline);
  }
  return mountOver(
    stubActionController({ showActionPanel: ref(isMyTurn) }),
    {
      availableActions: ['pass'],
      actionMetadata: { pass: { name: 'pass', prompt: 'Pass', selections: [] } },
      isMyTurn,
    },
    { provide },
  );
}

const countdown = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.find('[data-testid="bs-turn-deadline"]');

describe('ActionPanel turn deadline (#301)', () => {
  it('shows the time left when the host has set a deadline', () => {
    const wrapper = mountPanel({ deadlineAt: 1, remainingMs: 72_400 });
    expect(countdown(wrapper).exists()).toBe(true);
    // Rounded up: a second with any time left in it is still a second left.
    expect(countdown(wrapper).text()).toBe('Time left: 1:13');
  });

  it('shows it while waiting on another player too, because the deadline is the table\'s', () => {
    const wrapper = mountPanel({ deadlineAt: 1, remainingMs: 9_000 }, false);
    expect(countdown(wrapper).text()).toBe('Time left: 0:09');
  });

  it('draws no countdown when there is no deadline', () => {
    expect(countdown(mountPanel(null)).exists()).toBe(false);
  });

  it('draws no countdown in a world, which publishes no deadline at all', () => {
    expect(countdown(mountPanel('unprovided')).exists()).toBe(false);
  });

  it('says it is waiting for the server at zero, and leaves the actions operable', () => {
    const wrapper = mountPanel({ deadlineAt: 1, remainingMs: 0 });
    expect(countdown(wrapper).text()).toBe('Time is up. Waiting for the server…');
    const pass = wrapper.findAll('button').find((b) => b.text().includes('Pass'));
    expect(pass).toBeDefined();
    expect(pass!.attributes('disabled')).toBeUndefined();
    expect(pass!.attributes('aria-disabled')).not.toBe('true');
  });

  it('is a timer, not a live region, so a screen reader is not told every second', () => {
    const el = countdown(mountPanel({ deadlineAt: 1, remainingMs: 30_000 }));
    expect(el.attributes('role')).toBe('timer');
    expect(el.attributes('aria-live')).toBeUndefined();
    expect(el.find('[aria-live]').exists()).toBe(false);
  });
});
