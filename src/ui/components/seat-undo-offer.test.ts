// @vitest-environment jsdom
/**
 * #1526: IN A STEP THAT UNDOES PER SEAT, A SEAT'S UNDO CONTROLS FOLLOW ITS OWN
 * ACTIONS ALONE.
 *
 * The state is the seat state the stateless executor sends after real moves,
 * so this holds the road from the step's `seatUndo: true` to the Action Panel's
 * Undo button and the menu's "Undo last action": seat 2's controls stay as
 * they are while seat 1 acts and undoes, and seat 1's follow its own actions.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import ControlsMenu from './ControlsMenu.vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import { stubActionController } from './auto-ui/action-panel-controller.test-helper.js';
import { executeOp, type StateEnvelope } from '../../session/stateless-ops.js';
import type { PlayerGameState } from '../../session/types.js';
import { boundaryKeyOf } from '../../session/testing/boundary-stamp.js';
import { seatUndoDefinition } from '../../session/testing/fixtures/seat-undo-fixture.js';
import { succeeded } from '../../session/op-result.test-helper.js';

const gameOptions = { playerCount: 2, seed: 'seat-undo-controls' };

async function seatTable() {
  let last = succeeded(await executeOp(seatUndoDefinition, gameOptions, null, null, { type: 'start' })) as StateEnvelope;
  const keep = (envelope: StateEnvelope) => {
    last = JSON.parse(JSON.stringify(envelope));
  };
  return {
    seat: (seat: number) => (last.playerViews[seat - 1] as { state: PlayerGameState }).state,
    async act(seat: number) {
      keep(succeeded(await executeOp(seatUndoDefinition, gameOptions, last.snapshot, null, {
        type: 'action', actionName: 'placePack', player: seat, args: {}, boundaryKey: boundaryKeyOf(last.snapshot),
      })) as StateEnvelope);
    },
    async undo(seat: number) {
      keep(succeeded(await executeOp(seatUndoDefinition, gameOptions, last.snapshot, null, { type: 'undo', player: seat })) as StateEnvelope);
    },
  };
}

async function menuUndoDisabled(state: PlayerGameState): Promise<string | null> {
  document.body.innerHTML = '';
  const wrapper = mount(ControlsMenu, {
    props: { play: { autoEndTurn: false, zoom: 1, zoomSupported: true, canUndo: state.canUndo ?? false } },
    attachTo: document.body,
  });
  await wrapper.find('button.menubtn').trigger('click');
  const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((b) => b.textContent?.includes('Undo last action'));
  const disabled = item?.getAttribute('aria-disabled') ?? null;
  wrapper.unmount();
  return disabled;
}

function panelHasUndo(state: PlayerGameState): boolean {
  const panel = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: stubActionController() } },
    attachTo: document.body,
    props: {
      availableActions: state.availableActions ?? [],
      actionMetadata: state.actionMetadata,
      isMyTurn: state.isMyTurn,
      canUndo: state.canUndo,
    },
  });
  const shown = panel.find('.undo-btn').exists();
  panel.unmount();
  return shown;
}

describe('#1526: per-seat undo controls', () => {
  it("keep seat 2's Undo while seat 1 acts and undoes, and follow seat 1's own actions", async () => {
    const table = await seatTable();
    await table.act(2);
    await table.act(1);

    expect(panelHasUndo(table.seat(2))).toBe(true);
    expect(await menuUndoDisabled(table.seat(2))).toBe('false');
    expect(panelHasUndo(table.seat(1))).toBe(true);

    await table.undo(1);
    expect(panelHasUndo(table.seat(1))).toBe(false);
    expect(await menuUndoDisabled(table.seat(1))).toBe('true');
    expect(panelHasUndo(table.seat(2))).toBe(true);
    expect(await menuUndoDisabled(table.seat(2))).toBe('false');
  });
});
