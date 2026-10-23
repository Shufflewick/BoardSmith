// @vitest-environment jsdom
/**
 * A BOARD HOLDS ACTIONS ON THIS SCREEN ONLY, AND THE PANEL AGREES (#1450).
 *
 * The board places a hold with `useActionHolds`; the real GameShell's Action
 * Panel greys the action out with the hold's reason, the way it shows a rule's
 * own `disabled()` reason, and the board is handed the same `disabledActions`.
 * Lifting the hold, or unmounting the board, restores the action at once.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref, useAttrs } from 'vue';
import { leaveIframe, mountTableWithDebugPanel } from './GameShell.platform-mount.test-helper.js';
import { useActionHolds } from '../composables/actionHolds.js';

const WAIT = 'Moving waits until the battle playback ends. Skip to end to move now.';

/** What the board was last handed as `disabledActions`. */
let boardSees: unknown;

const ReplayBoard = defineComponent({
  inheritAttrs: false,
  setup() {
    const replaying = ref(false);
    useActionHolds(() => (replaying.value ? { move: WAIT } : null));
    const attrs = useAttrs();
    return () => {
      boardSees = attrs['disabled-actions'] ?? attrs.disabledActions;
      return h('div', [
        h('button', { 'data-testid': 'replay', onClick: () => { replaying.value = !replaying.value; } }, 'Replay'),
      ]);
    };
  },
});

afterEach(() => {
  boardSees = undefined;
  leaveIframe();
  document.body.innerHTML = '';
});

// Two actions, so neither is the sole one the shell starts by itself.
const seatState = {
  availableActions: ['move', 'pass'],
  actionMetadata: {
    move: { name: 'move', prompt: 'Move', selections: [] },
    pass: { name: 'pass', prompt: 'Pass', selections: [] },
  },
};

describe('GameShell action holds (#1450)', () => {
  it('greys the held action out in the panel with its reason, and restores it when the hold lifts', async () => {
    const { wrapper } = await mountTableWithDebugPanel(ReplayBoard, seatState);
    const move = () => wrapper.get('[data-bs-action="move"]');
    expect(move().attributes('aria-disabled')).toBeUndefined();

    await wrapper.get('[data-testid="replay"]').trigger('click');
    expect(move().attributes('aria-disabled')).toBe('true');
    expect(move().attributes('data-bs-disabled-reason')).toBe(WAIT);
    expect(boardSees).toEqual({ move: WAIT });

    await wrapper.get('[data-testid="replay"]').trigger('click');
    expect(move().attributes('aria-disabled')).toBeUndefined();
    expect(boardSees ?? {}).toEqual({});
    wrapper.unmount();
  });

  it('cancels the held action when it is open, and tells the player why without an error (#1461)', async () => {
    const { wrapper } = await mountTableWithDebugPanel(ReplayBoard, {
      ...seatState,
      actionMetadata: {
        ...seatState.actionMetadata,
        move: { name: 'move', prompt: 'Move', selections: [{ name: 'to', type: 'choice', prompt: 'Where to?', choices: [{ value: 1, display: 'North' }, { value: 2, display: 'South' }] }] },
      },
    });
    await wrapper.get('[data-bs-action="move"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.cancel-btn').exists()).toBe(true);

    await wrapper.get('[data-testid="replay"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.cancel-btn').exists()).toBe(false);
    expect(wrapper.get('[data-bs-action="move"]').attributes('data-bs-disabled-reason')).toBe(WAIT);
    // The hold is this screen's own state, not a failed action, so it is told as a notice (#1461).
    expect(document.querySelector('.toast.info')?.textContent).toContain(WAIT);
    expect(document.querySelector('.toast.error')).toBeNull();
    wrapper.unmount();
  });

  it("shows the rules' own reason over a hold", async () => {
    const { wrapper } = await mountTableWithDebugPanel(ReplayBoard, {
      ...seatState,
      disabledActions: { move: 'Not yet' },
    });
    await wrapper.get('[data-testid="replay"]').trigger('click');
    await nextTick();
    expect(wrapper.get('[data-bs-action="move"]').attributes('data-bs-disabled-reason')).toBe('Not yet');
    wrapper.unmount();
  });
});
