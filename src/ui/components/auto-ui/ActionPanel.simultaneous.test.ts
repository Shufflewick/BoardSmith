// @vitest-environment jsdom
/**
 * SIM-04 / D27 — simultaneous-step commit-leak regression (Phase 160 Plan 03).
 *
 * The COMMIT LEAK (T-160-27, Tampering): `ActionPanel.vue`'s `executeAction`
 * gated only on `isExecuting` and `!props.isMyTurn` -- NOT on the viewer's own
 * `completed` flag. `isMyTurn` is itself derived server-side from `canSeatAct`
 * (already completed-aware), but nothing in the ActionPanel's own prop contract
 * enforces that invariant: a stale/optimistic `isMyTurn=true` prop (WS ordering
 * race, re-render before the next broadcast lands) lets a seat that already
 * committed this step re-submit -- a client-side double-commit. The engine's
 * `playerState.completed` race guard is the authoritative backstop; this test
 * proves the CLIENT-side leak is closed defensively.
 *
 * The other half of D27, that the viewer never appears in its own "waiting on"
 * line, is asserted on the real shell in `GameShell.simultaneous-turn.test.ts`
 * (#337), beside the players panel that DOES show the viewer as acting.
 */

import { describe, it, expect, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import type { EnrichedActionMetadata } from '../../composables/useActionController.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

// ─────────────────────────────────────────────────────────────────────────
// Commit leak — ActionPanel executeAction gated on own `completed`
// ─────────────────────────────────────────────────────────────────────────

const noArgsAction: EnrichedActionMetadata = {
  name: 'confirm',
  prompt: 'Confirm',
  selections: [],
};

/**
 * Mounts a REAL ActionPanel wired to a REAL useActionController (same
 * pattern as ActionPanel.interaction.test.ts) so the click -> executeAction
 * -> controller.execute -> sendAction chain is exercised end to end, not
 * mocked at the boundary we're testing.
 *
 * `isMyTurn: true` deliberately models the vulnerable case: the viewer's
 * own seat has ALREADY completed this simultaneous step, but the `isMyTurn`
 * prop is (for whatever client-side reason — stale broadcast, optimistic
 * render) still true. Pre-fix, ActionPanel's executeAction has no way to
 * know the seat is committed and fires the submit anyway.
 */
function mountConfirmPanel(opts: { completed: boolean; sendAction: ReturnType<typeof vi.fn> }) {
  const controller = useActionController({
    sendAction: opts.sendAction,
    availableActions: ref(['confirm']),
    actionMetadata: ref({ confirm: noArgsAction }),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
  });

  const wrapper = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    props: {
      availableActions: ['confirm'],
      isMyTurn: true,
      completed: opts.completed,
    },
  });

  return { wrapper, controller };
}

describe('ActionPanel executeAction — commit-leak gate on own completed flag (D27, SIM-04)', () => {
  it('CL-1: a completed seat cannot trigger executeAction (the leak is closed)', async () => {
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const { wrapper } = mountConfirmPanel({ completed: true, sendAction });

    const button = wrapper.get('[data-bs-action="confirm"]');
    await button.trigger('click');
    await nextTick();
    await nextTick();

    expect(sendAction).not.toHaveBeenCalled();
  });

  it('CL-2 (negative control): a NOT-yet-completed viewer CAN execute', async () => {
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const { wrapper } = mountConfirmPanel({ completed: false, sendAction });

    const button = wrapper.get('[data-bs-action="confirm"]');
    await button.trigger('click');
    await nextTick();
    await nextTick();

    expect(sendAction).toHaveBeenCalledTimes(1);
    expect(sendAction).toHaveBeenCalledWith('confirm', {});
  });

  // ── Task 3: adversarial ────────────────────────────────────────────────

  it('CL-3 (adversarial, repeat submit): a completed seat that clicks repeatedly emits ZERO executes', async () => {
    // Models a double-submit / stale-client re-trigger: the button is clicked
    // five times in quick succession (some in the same tick, some across
    // ticks). The gate must hold on every single attempt, not just the first.
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const { wrapper } = mountConfirmPanel({ completed: true, sendAction });
    const button = wrapper.get('[data-bs-action="confirm"]');

    await button.trigger('click');
    await button.trigger('click');
    await nextTick();
    await button.trigger('click');
    await nextTick();
    await button.trigger('click');
    await button.trigger('click');
    await nextTick();
    await nextTick();

    expect(sendAction).not.toHaveBeenCalled();
  });

  it('CL-4 (adversarial, mid-step completed flip): a click that races a completed:true update emits ZERO executes once the flip lands', async () => {
    // Models the realistic race this gate defends against: the viewer clicks
    // right as the seat's own completed flag flips true (e.g. a co-decider's
    // commit resolves the step and the broadcast lands mid-interaction).
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const controller = useActionController({
      sendAction,
      availableActions: ref(['confirm']),
      actionMetadata: ref({ confirm: noArgsAction }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });

    const wrapper = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      props: { availableActions: ['confirm'], isMyTurn: true, completed: false },
    });

    // Confirm the pre-flip state genuinely can execute (sanity, not yet clicked).
    expect(wrapper.find('[data-bs-action="confirm"]').exists()).toBe(true);

    // Flip completed BEFORE the click lands (the race).
    await wrapper.setProps({ completed: true });
    await wrapper.get('[data-bs-action="confirm"]').trigger('click');
    await nextTick();
    await nextTick();

    expect(sendAction).not.toHaveBeenCalled();
  });
});
