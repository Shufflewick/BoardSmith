// @vitest-environment jsdom
/**
 * #373: THE UNDO CONTROLS FOLLOW THE GAME'S UNDO POLICY.
 *
 * A game with `checkpoints: { enabled: false }` can never undo, and it used to
 * show an enabled "Undo last action" menu item and an Undo button on every
 * turn anyway, each click answered with an error. The state here is not
 * written by hand: it is the seat state the stateless executor sends after a
 * real move, so this holds the whole road from the game definition to the
 * control, which a hand-built `canUndo: false` prop would skip.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';

import ControlsMenu from './ControlsMenu.vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../composables/useGameContext.js';
import { stubActionController } from './auto-ui/action-panel-controller.test-helper.js';
import { executeOp, type GameDefinitionLike } from '../../session/stateless-ops.js';
import type { PlayerGameState } from '../../session/types.js';
import { boundaryKeyOf } from '../../session/testing/boundary-stamp.js';
import {
  uncheckpointedScumDefinition,
  unfencedScumDefinition,
} from '../../session/testing/fixtures/random-scumming-fixture.js';

/** Seat 1's state after it starts a game and makes one ordinary move. */
async function stateAfterOneMove(def: GameDefinitionLike): Promise<PlayerGameState> {
  const gameOptions = { playerCount: 1, seed: 'undo-controls' };
  const started = await executeOp(def, gameOptions, null, null, { type: 'start' });
  const snapshot = JSON.parse(JSON.stringify(started.snapshot));
  const moved = await executeOp(def, gameOptions, snapshot, null, {
    type: 'action',
    actionName: 'move',
    player: 1,
    args: {},
    boundaryKey: boundaryKeyOf(snapshot),
  });
  expect(moved.success, moved.error).toBe(true);
  return (JSON.parse(JSON.stringify(moved.playerViews)) as Array<{ state: PlayerGameState }>)[0].state;
}

function undoMenuItem(): HTMLButtonElement {
  const item = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((b) => b.textContent?.includes('Undo last action'));
  expect(item, 'the menu has an "Undo last action" item').toBeDefined();
  return item!;
}

async function mountMenu(state: PlayerGameState) {
  document.body.innerHTML = '';
  const wrapper = mount(ControlsMenu, {
    props: { autoEndTurn: false, zoom: 1, canUndo: state.canUndo ?? false },
    attachTo: document.body,
  });
  await wrapper.find('button.menubtn').trigger('click');
  return wrapper;
}

function mountPanel(state: PlayerGameState) {
  return mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: stubActionController() } },
    attachTo: document.body,
    props: {
      availableActions: state.availableActions ?? [],
      actionMetadata: state.actionMetadata,
      playerSeat: 1,
      isMyTurn: state.isMyTurn,
      canUndo: state.canUndo,
    },
  });
}

describe('#373: the undo controls follow the game definition', () => {
  it('disables "Undo last action" and shows no Undo button when the game turns checkpoints off', async () => {
    const state = await stateAfterOneMove(uncheckpointedScumDefinition);

    const menu = await mountMenu(state);
    expect(undoMenuItem().disabled).toBe(true);
    expect(undoMenuItem().getAttribute('aria-disabled')).toBe('true');
    menu.unmount();

    const panel = mountPanel(state);
    expect(panel.find('[data-bs-action="move"]').exists()).toBe(true);
    expect(panel.find('.undo-btn').exists()).toBe(false);
    panel.unmount();
  });

  it('CONTROL: the same game with checkpoints on enables both', async () => {
    const state = await stateAfterOneMove(unfencedScumDefinition);

    const menu = await mountMenu(state);
    expect(undoMenuItem().disabled).toBe(false);
    menu.unmount();

    const panel = mountPanel(state);
    expect(panel.find('.undo-btn').exists()).toBe(true);
    panel.unmount();
  });
});
