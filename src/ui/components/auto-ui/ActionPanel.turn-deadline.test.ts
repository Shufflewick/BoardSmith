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

function mountPanel(
  deadline: TurnDeadline | null | 'unprovided',
  isMyTurn = true,
  formatTurnDeadline?: (remainingMs: number) => string,
) {
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
      formatTurnDeadline,
    },
    { provide },
  );
}

/** A deadline with `remainingMs` left and no watching. */
const at = (remainingMs: number): TurnDeadline => ({ deadlineAt: 1, remainingMs, watchEndsAt: null, watchRemainingMs: 0 });

const countdown = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.find('[data-testid="bs-turn-deadline"]');

describe('ActionPanel turn deadline (#301)', () => {
  it('shows the time left when the host has set a deadline', () => {
    const wrapper = mountPanel(at(72_400));
    expect(countdown(wrapper).exists()).toBe(true);
    // Rounded up: a second with any time left in it is still a second left.
    expect(countdown(wrapper).text()).toBe('Time left: 1:13');
  });

  it('writes hours once an hour or more is left, up to a 48-hour turn (#1830)', () => {
    expect(countdown(mountPanel(at(48 * 3_600_000))).text()).toBe('Time left: 48:00:00');
    expect(countdown(mountPanel(at(3_600_000))).text()).toBe('Time left: 1:00:00');
    expect(countdown(mountPanel(at(3_599_500))).text()).toBe('Time left: 1:00:00');
    expect(countdown(mountPanel(at(3_599_000))).text()).toBe('Time left: 59:59');
  });

  it('shows it while waiting on another player too, because the deadline is the table\'s', () => {
    const wrapper = mountPanel(at(9_000), false);
    expect(countdown(wrapper).text()).toBe('Time left: 0:09');
  });

  it('draws no countdown when there is no deadline', () => {
    expect(countdown(mountPanel(null)).exists()).toBe(false);
  });

  it('draws no countdown in a world, which publishes no deadline at all', () => {
    expect(countdown(mountPanel('unprovided')).exists()).toBe(false);
  });

  it('says it is waiting for the server at zero, and leaves the actions operable', () => {
    const wrapper = mountPanel(at(0));
    expect(countdown(wrapper).text()).toBe('Time is up. Waiting for the server…');
    const pass = wrapper.findAll('button').find((b) => b.text().includes('Pass'));
    expect(pass).toBeDefined();
    expect(pass!.attributes('disabled')).toBeUndefined();
    expect(pass!.attributes('aria-disabled')).not.toBe('true');
  });

  it('says how long the watching lasts, then the time to act, while the turn opens on watch time (#1831)', () => {
    const watching = { deadlineAt: 1, remainingMs: 162_000, watchEndsAt: 1, watchRemainingMs: 42_000 };
    expect(countdown(mountPanel(watching)).text()).toBe('Watching: 0:42, then 2:00 to act');
    expect(countdown(mountPanel(watching, true, () => 'not while watching')).text()).toBe('Watching: 0:42, then 2:00 to act');
    expect(countdown(mountPanel({ ...watching, remainingMs: 120_000, watchRemainingMs: 0 })).text()).toBe('Time left: 2:00');
  });

  it('writes the line with the game\'s formatter when it supplies one (#1437)', () => {
    const wrapper = mountPanel(at(72_400), true, (ms) => `${Math.ceil(ms / 1000)}s`);
    expect(countdown(wrapper).text()).toBe('73s');
  });

  it('keeps the waiting line at zero even with a formatter, because the host closes the step (#1437)', () => {
    const wrapper = mountPanel(at(0), true, () => 'never shown');
    expect(countdown(wrapper).text()).toBe('Time is up. Waiting for the server…');
  });

  it('is a timer, not a live region, so a screen reader is not told every second', () => {
    const el = countdown(mountPanel(at(30_000)));
    expect(el.attributes('role')).toBe('timer');
    expect(el.attributes('aria-live')).toBeUndefined();
    expect(el.find('[aria-live]').exists()).toBe(false);
  });
});
