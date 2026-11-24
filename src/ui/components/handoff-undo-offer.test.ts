// @vitest-environment jsdom
/**
 * #1788: THE SEAT THAT MAY TAKE BACK A HANDED-OFF ACTION IS OFFERED UNDO IN
 * THE ACTION PANEL, THOUGH IT IS NOT ITS TURN.
 *
 * The state is the one the stateless executor sends seat 1 after its action
 * moves the flow to seat 2's `handoffUndo` step.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

import ActionPanel from './auto-ui/ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import { stubActionController } from './auto-ui/action-panel-controller.test-helper.js';
import { executeOp, type StateEnvelope } from '../../session/stateless-ops.js';
import type { PlayerGameState } from '../../session/types.js';
import { boundaryKeyOf } from '../../session/testing/boundary-stamp.js';
import { handoffUndoDefinition as definition } from '../../session/testing/fixtures/handoff-undo-fixture.js';
import { succeeded } from '../../session/op-result.test-helper.js';

const gameOptions = { playerCount: 2, seed: 'handoff-undo-offer' };

async function seatOneAfterHandoff(): Promise<PlayerGameState> {
  const started = succeeded(await executeOp(definition, gameOptions, null, null, { type: 'start' })) as StateEnvelope;
  const moved = succeeded(await executeOp(definition, gameOptions, started.snapshot, null, {
    type: 'action', actionName: 'move', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
  })) as StateEnvelope;
  return (moved.playerViews[0] as { state: PlayerGameState }).state;
}

describe('#1788: handoff undo in the Action Panel', () => {
  it('offers Undo to the seat that handed off, while the other seat has not acted', async () => {
    const state = await seatOneAfterHandoff();
    expect(state.isMyTurn).toBe(false);
    expect(state.canUndo).toBe(true);

    const panel = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: stubActionController({ showActionPanel: ref(state.isMyTurn) }) } },
      props: { availableActions: state.availableActions ?? [], isMyTurn: state.isMyTurn, canUndo: state.canUndo },
    });
    const undo = panel.find('.undo-btn');
    expect(undo.exists()).toBe(true);
    await undo.trigger('click');
    expect(panel.emitted('undo')).toHaveLength(1);
    panel.unmount();
  });
});
