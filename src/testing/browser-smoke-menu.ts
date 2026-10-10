/**
 * CHOOSING FROM ONE OF THE DEV HOST'S OWN MENUS (#609, #610): "Follow active seat" in a table's seat
 * switcher, a seat in a world's.
 *
 * The dev host closes such a menu when its window loses focus (#610), and the game's frame takes
 * focus once it has loaded: on a machine slow to load it, after the walk opened the menu. So the walk
 * opens the menu again whenever it finds it closed while its press is still on the way. A press that
 * landed closes the menu too, and may be found to have done so before Playwright says the press is
 * done; the menu is not opened again once the choice has taken effect, and is closed if it is found
 * open once it has. Left open, nothing would close it: the walk's own presses stop every click that
 * would reach anything but their control (`guardClicks`), the dev host's outside click among them.
 *
 * Nothing here imports Playwright, so the order of these steps is tested without a browser.
 *
 * @module
 */

/** What choosing from a dev host menu needs of the page. */
export interface DevHostMenu {
  /** Presses the item chosen, once, with no time limit of its own. */
  pressItem(): Promise<unknown>;
  /** Presses the menu's toggle, which opens it when it is closed and closes it when it is open. */
  pressToggle(): Promise<unknown>;
  /** Whether the menu is open: whether it shows the items it offers. */
  isOpen(): Promise<boolean>;
  /** Whether the choice has taken effect: the dev host follows the active seat, or holds the seat chosen. */
  isTaken(): Promise<boolean>;
  /** Waits for the choice to take effect, and throws, saying so, when it does not in time. */
  waitTaken(): Promise<void>;
}

/**
 * Does `act` once within the walk's time for a press, running `meanwhile` while it waits, and throws
 * when that time has passed (`actWithinPageTime` in `browser-smoke`).
 */
export type PressWithin = (what: string, act: () => Promise<unknown>, meanwhile?: () => Promise<void>) => Promise<void>;

/**
 * Opens `menu` when it is closed and the choice has not yet taken effect, for `what`. Used while a
 * press into the menu, or a wait for it to open, is on the way.
 */
export function reopening(menu: DevHostMenu, pressWithin: PressWithin, what: string): () => Promise<void> {
  return async () => {
    if ((await menu.isTaken()) || (await menu.isOpen())) return;
    await pressWithin(`opening the menu for ${what}`, () => menu.pressToggle());
  };
}

/**
 * Presses `menu`'s item, `what`, as the module comment describes, waits for the choice to take
 * effect, and closes the menu if it is open then.
 */
export async function chooseFromMenu(menu: DevHostMenu, pressWithin: PressWithin, what: string): Promise<void> {
  await pressWithin(what, () => menu.pressItem(), reopening(menu, pressWithin, what));
  await menu.waitTaken();
  if (await menu.isOpen()) await pressWithin(`closing the menu after ${what}`, () => menu.pressToggle());
}
