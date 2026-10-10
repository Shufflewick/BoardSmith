/**
 * Choosing from a dev host menu (#609, #610): the menu is opened again when the game's frame took
 * focus and closed it before the walk's press landed, and is never left open once the choice has
 * taken effect, since nothing in the walk would close it after that.
 */
import { describe, expect, it } from 'vitest';
import { chooseFromMenu, type DevHostMenu, type PressWithin } from './browser-smoke-menu.js';

/** A dev host menu as plain state, and the presses made into it, in order. */
function fakeMenu(options: { open: boolean }) {
  const state = { open: options.open, taken: false, presses: [] as string[] };
  const menu: DevHostMenu = {
    pressItem: async () => {
      state.presses.push('item');
      if (!state.open) throw new Error('the item was pressed while the menu was closed');
      state.open = false;
      state.taken = true;
    },
    pressToggle: async () => {
      state.presses.push('toggle');
      state.open = !state.open;
    },
    isOpen: async () => state.open,
    isTaken: async () => state.taken,
    waitTaken: async () => {
      if (!state.taken) throw new Error('not taken');
    },
  };
  return { state, menu };
}

/**
 * A press into the page that lands before the walk hears it has: `meanwhile` runs once after `act`
 * has done its work and before it is reported done, as the walk's poll does on a busy page.
 */
const landsBeforeItIsReported: PressWithin = async (_what, act, meanwhile) => {
  await act();
  await meanwhile?.();
};

/** A press that waits for the menu, which the game's frame closed: `meanwhile` runs first, then `act`. */
const findsTheMenuClosedFirst: PressWithin = async (_what, act, meanwhile) => {
  await meanwhile?.();
  await act();
};

describe('chooseFromMenu', () => {
  it('opens the menu again when the game took focus and closed it before the press landed', async () => {
    const { state, menu } = fakeMenu({ open: false });

    await chooseFromMenu(menu, findsTheMenuClosedFirst, 'choosing seat 4');

    expect(state.presses).toEqual(['toggle', 'item']);
    expect(state.taken).toBe(true);
    expect(state.open).toBe(false);
  });

  it('leaves the menu closed when the press landed and closed it before it was reported done', async () => {
    const { state, menu } = fakeMenu({ open: true });

    await chooseFromMenu(menu, landsBeforeItIsReported, 'choosing seat 4');

    expect(state.taken).toBe(true);
    expect(state.open).toBe(false);
  });

  it('closes the menu when it is found open once the choice has taken effect', async () => {
    const { state, menu } = fakeMenu({ open: true });
    // The page opens the menu again after the choice took effect, as a reopen already on its way does.
    let reopened = false;
    const reopensAfter: PressWithin = async (_what, act) => {
      await act();
      if (!reopened) state.open = reopened = true;
    };

    await chooseFromMenu(menu, reopensAfter, 'pressing "Follow active seat"');

    expect(state.taken).toBe(true);
    expect(state.open).toBe(false);
  });
});
