// @vitest-environment jsdom
/**
 * SIM-04 / D27 — simultaneous-step seat-status contradiction + commit-leak
 * regression (Phase 160 Plan 03).
 *
 * Two distinct defects, closed together because both stem from the shell
 * deriving seat status from turn-based (single `currentPlayer`) assumptions
 * during a simultaneous step:
 *
 *  1. SELF-FILTER (T-160-28, Information Disclosure): `GameShell.vue`'s
 *     `awaitingPlayerNames` / `awaitingPlayerSeats` computeds list every
 *     awaiting-and-not-completed seat WITHOUT excluding the viewer's own
 *     seat. To a Seven player mid-step this renders the contradiction: the
 *     ActionPanel shows "act now" (action buttons, because the viewer's own
 *     seat IS awaiting and not completed) while the sidebar/waiting-list
 *     ALSO names the viewer as one of the players being "waited on" — the
 *     "Your move" + "waiting" contradiction.
 *
 *     `GameShell.vue` does not expose these computeds for import (they live
 *     inside <script setup>, same as `showHintProp` elsewhere in this test
 *     suite), so the harness below mirrors the computed body exactly — same
 *     pattern as the `showHintProp` harness above in this file's sibling
 *     `GameShell.test.ts`. If GameShell's computed changes, this harness
 *     must be updated to match (documented at each call site below).
 *
 *  2. COMMIT LEAK (T-160-27, Tampering): `ActionPanel.vue`'s `executeAction`
 *     (:726) gates only on `isExecuting` and `!props.isMyTurn` — NOT on the
 *     viewer's own `completed` flag. `isMyTurn` is itself derived
 *     server-side from `canSeatAct` (already completed-aware), but nothing
 *     in the ActionPanel's own prop contract enforces that invariant: a
 *     stale/optimistic `isMyTurn=true` prop (WS ordering race, re-render
 *     before the next broadcast lands) lets a seat that already committed
 *     this step re-submit — a client-side double-commit. The engine's
 *     `playerState.completed` race guard is the authoritative backstop;
 *     this test proves the CLIENT-side leak is closed defensively.
 *
 * PROC-01: this task (RED) proves both defects failing against CURRENT
 * source with NO production changes. Task 2 (GREEN) fixes both. Task 3 adds
 * adversarial repeat-attempt / multi-seat / mid-step-flip coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import type { ActionMetadata } from '../../composables/useActionController.js';

// ─────────────────────────────────────────────────────────────────────────
// Part 1: self-filter — GameShell awaitingPlayerNames/awaitingPlayerSeats
// ─────────────────────────────────────────────────────────────────────────

interface AwaitingPlayerLike {
  playerIndex: number;
  completed: boolean;
  availableActions: string[];
}
interface FlowStateLike {
  awaitingPlayers?: AwaitingPlayerLike[];
}
interface PlayerLike {
  seat: number;
  name?: string;
  color?: string;
}

/**
 * Mirrors `GameShell.vue`'s `awaitingPlayerSeats` / `awaitingPlayerNames`
 * computeds AS FIXED (D27, Plan 03 Task 2): both filter on
 * `!p.completed && p.availableActions.length > 0 && p.playerIndex !==
 * playerSeat` — the viewer's own seat is excluded from its own "Waiting
 * for: ..." list. If GameShell's computed changes, this harness must be
 * updated to match (same convention as the `showHintProp` harness above in
 * this file's sibling `GameShell.test.ts`).
 */
function buildAwaitingHarness(
  playerSeatValue: number,
  flowStateValue: FlowStateLike,
  playersValue: PlayerLike[],
) {
  const playerSeat = ref(playerSeatValue);
  const flowState = ref<FlowStateLike>(flowStateValue);
  const players = ref<PlayerLike[]>(playersValue);

  const awaitingPlayerSeats = computed(() => {
    const fs = flowState.value;
    if (!fs?.awaitingPlayers?.length) return [];
    return fs.awaitingPlayers
      .filter((p) => !p.completed && p.availableActions.length > 0 && p.playerIndex !== playerSeat.value)
      .map((p) => p.playerIndex);
  });

  const awaitingPlayerNames = computed(() => {
    const fs = flowState.value;
    if (!fs?.awaitingPlayers?.length) return [];
    return fs.awaitingPlayers
      .filter((p) => !p.completed && p.availableActions.length > 0 && p.playerIndex !== playerSeat.value)
      .map((p) => {
        const player = players.value.find((pl) => pl.seat === p.playerIndex);
        return {
          seat: p.playerIndex,
          name: player?.name || `Player ${p.playerIndex}`,
          color: player?.color,
        };
      });
  });

  return { playerSeat, flowState, players, awaitingPlayerSeats, awaitingPlayerNames };
}

describe('GameShell awaitingPlayerNames/awaitingPlayerSeats — self-filter (D27, SIM-04)', () => {
  it('SF-1: the viewer\'s OWN seat never appears in its own "Waiting for" list', () => {
    // Viewer is seat 0; both seat 0 and seat 1 are awaiting and not completed.
    const { awaitingPlayerNames, awaitingPlayerSeats } = buildAwaitingHarness(
      0,
      {
        awaitingPlayers: [
          { playerIndex: 0, completed: false, availableActions: ['confirm'] },
          { playerIndex: 1, completed: false, availableActions: ['confirm'] },
        ],
      },
      [
        { seat: 0, name: 'You' },
        { seat: 1, name: 'Ari' },
      ],
    );

    expect(awaitingPlayerNames.value.map((p) => p.name)).not.toContain('You');
    expect(awaitingPlayerSeats.value).not.toContain(0);

    // Co-decider must still be present (negative control).
    expect(awaitingPlayerNames.value.map((p) => p.name)).toContain('Ari');
    expect(awaitingPlayerSeats.value).toContain(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Part 2: commit leak — ActionPanel executeAction gated on own `completed`
// ─────────────────────────────────────────────────────────────────────────

const noArgsAction: ActionMetadata = {
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
    global: { provide: { actionController: controller } },
    props: {
      availableActions: ['confirm'],
      playerSeat: 0,
      isMyTurn: true,
      completed: opts.completed,
    } as Record<string, unknown>,
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
});
