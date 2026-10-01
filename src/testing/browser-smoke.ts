/**
 * THE IN-BROWSER SMOKE TEST (#453), `boardsmith/testing/browser`.
 *
 * A game's `tests/browser/smoke.spec.ts` calls {@link defineSmokeTest} once. `boardsmith verify`
 * (and `boardsmith smoke`) serves the game with `boardsmith dev` from a fresh state and runs that
 * file in Chromium, where the walk:
 *
 *   1. opens the dev host and takes a seat, at a table or in a world, as a player's browser does. At
 *      a table it then follows the active seat (the dev host's "Follow active seat"), so it acts
 *      for every seat in turn and reaches an action one seat has only after another acts;
 *   2. takes every action the action panel offers, following the panel's own offers so it keeps
 *      up with the game: it answers each choice the panel asks for, pressing the board's own
 *      candidate for a pick the board shows and typing the value the spec's `inputs` give a field
 *      the game checks (#470), and presses every other control on the board once,
 *      from the keyboard when the control is invisible and takes no pointer. While a modal dialog
 *      is open it presses only what is in it, each control once, then closes it as a player does;
 *   3. at a table, deals each game from a seed (#460): the spec's `seed`, one or a list walked in
 *      turn, else {@link DEFAULT_SMOKE_SEED}, so every run walks the same games and a failure can be
 *      walked again with `boardsmith smoke`. A world is dealt by `boardsmith dev` from its own seed;
 *   4. starts a new game when a game ends with listed actions still to take, and stops taking an
 *      action again once taking it has ended every game it was taken in;
 *   5. fails on any uncaught error in the page, any console error, any failed request to the dev
 *      host, and any offered action that then fails, and on an action the game offers that the
 *      spec does not list, or one it lists that the walk never took.
 *
 * A game with no actions yet lists none, and its walk still loads, seats a player and fails on
 * any error. Each chunk that adds an action adds its name to `actions`. One the deal decides (offered
 * only when a player is dealt the right cards) is reached by choosing a `seed` whose deal offers it;
 * one no walk from a fresh game can reach whatever the deal is named in `unreachable`, with the reason.
 *
 * This file runs under Playwright, never under vitest. `boardsmith verify` bundles the spec with
 * this module, so the game needs no Playwright of its own: it imports only this module.
 *
 * @module
 */
import { test, type Frame, type Locator, type Page } from '@playwright/test';
import {
  clickReached,
  guardClicks,
  MODAL_DIALOGS,
  numberToEnter,
  pageControls,
  pageDialogs,
  PRESS_MARK,
  type PageControl,
  type Reached,
} from './browser-smoke-page.js';
import {
  answered,
  DEFAULT_SMOKE_SEED,
  inputFor,
  note,
  recordResolved,
  requiredUntaken,
  SMOKE_ANNOTATION,
  SMOKE_SEEDS_ENV,
  SMOKE_SPEC_PATH,
  smokeFailure,
  smokeProblems,
  smokeRecord,
  smokeSeeds,
  startAnswering,
  walkStopped,
  type ResolvedAction,
  type ResolvedMemory,
  type SmokeInputs,
  type SmokeInputView,
  type SmokeWalk,
  type TypedValue,
} from './browser-smoke-verdict.js';

export type { SmokeInput, SmokeInputs, SmokeInputView } from './browser-smoke-verdict.js';

export interface SmokeTestOptions {
  /**
   * Every action a player can take in this game, by the name its rules give it. The walk must take
   * each one at least once, unless {@link unreachable} names it, and fails on an action the game
   * offers that is not listed here. The chunk that adds an action adds its name here.
   */
  readonly actions: readonly string[];
  /**
   * The seed a table's games are dealt from, or a list of seeds, each walked in turn (#460). The
   * default is {@link DEFAULT_SMOKE_SEED}. Every run with the same seeds walks the same games, so a
   * failure is walked again exactly by `boardsmith smoke`. Choose a seed whose deal offers an action
   * that only some deals offer (the cards a player is dealt decide it, say), rather than naming that
   * action in {@link unreachable}. A world is dealt by `boardsmith dev` from its own seed and takes none.
   */
  readonly seed?: string | readonly string[];
  /**
   * The listed actions no walk from a fresh game can reach, whatever the deal, each with a sentence
   * saying why: one offered only in a position play does not get to, such as a draw by threefold
   * repetition. The
   * walk does not require them unless it sees one enabled, which it then must take like any other;
   * it fails if one fails. One it takes anyway is reported, so the declaration can be removed. An action that ends the game, or
   * that needs another seat to act first, does not belong here: the walk starts a new game when a
   * game ends, and acts for every seat at a table.
   */
  readonly unreachable?: Readonly<Record<string, string>>;
  /** How many actions the walk takes at most on each deal. The default is {@link DEFAULT_SMOKE_STEPS}. */
  readonly steps?: number;
  /**
   * The values the walk types in an action's text or number fields, by action and then by pick
   * name, for a field whose value the game checks (#470): a name only another player has, a number
   * only the rules accept. Without one the walk types "smoke test" in a text field and the field's
   * least number in a number field. A value is the text or number itself, or a function of what the
   * page shows (`texts(selector)`), for a value known only once the game is under way, such as the
   * name of a player standing in the same square. A function that returns nothing has the walk
   * cancel the action and take it again once the game has moved on; it is still required. The game
   * refusing a value given here fails the walk, as any failed action does.
   */
  readonly inputs?: SmokeInputs;
}

/** How many actions a walk takes at most on each deal, unless the spec asks for more. */
const DEFAULT_SMOKE_STEPS = 60;

/** The iframe path the table's dev host serves the game at, and the world's. */
const GAME_FRAME_PATHS = ['/__boardsmith-play', '/__boardsmith-world'];

/** How long the game gets to show its shell after the page opens: Vite prepares it on first load. */
const SHELL_WAIT_MS = 90_000;

/** How long the walk waits for the other seats (bots at a table) to hand it a turn. */
const TURN_WAIT_MS = 30_000;

/** How long one press, or one read of an element, gets before it counts as not pressable (#464). */
const PRESS_MS = 5_000;

/** How many actions the walk goes on taking after it has seen nothing new, before it stops. */
const IDLE_STEPS = 5;

/**
 * Registers the smoke test for the game `boardsmith dev` serves at the configured base URL. Call it
 * once, at the top level of `tests/browser/smoke.spec.ts`.
 */
export function defineSmokeTest(options: SmokeTestOptions): void {
  test('seat a player, take every offered action, press every board control', async ({ page }) => {
    const chosen = process.env[SMOKE_SEEDS_ENV];
    const seeds = smokeSeeds(options.seed, chosen === undefined ? undefined : (JSON.parse(chosen) as string[]));
    const walk = newWalk(options);
    const memories: WalkMemory[] = [];
    watchForErrors(page, walk);
    await recordResolvedActions(page);
    try {
      await page.goto('/');
      await takeASeat(page);
      await followTheActiveSeat(page);
      if (await canDeal(page)) {
        for (const seed of seeds) {
          walk.seeds.push(seed);
          await dealFrom(page, seed);
          memories.push(newMemory(seed));
          await walkTheGame(page, walk, memories[memories.length - 1]);
        }
      } else {
        if (options.seed !== undefined || chosen !== undefined) note(walk, WORLD_TAKES_NO_SEED);
        memories.push(newMemory(null));
        await walkTheGame(page, walk, memories[0]);
      }
    } catch (error) {
      // Reported after the errors the page showed first, which usually say why the walk stopped.
      note(walk, walkStopped(error, PRESS_MS / 1000));
    }
    const played = memories.reduce((sum, m) => ({ controls: sum.controls + m.controls, games: sum.games + m.games }), { controls: 0, games: 0 });
    const record = smokeRecord(walk, played);
    test.info().annotations.push({ type: SMOKE_ANNOTATION, description: JSON.stringify(record) });
    const problems = smokeProblems(walk);
    if (problems.length > 0) throw new Error(smokeFailure(walk, problems));
  });
}

/** Why a world's spec cannot name a seed. */
const WORLD_TAKES_NO_SEED =
  `This game is a persistent world, which \`boardsmith dev\` deals from the one seed it gives that world, so \`seed\` in ` +
  `${SMOKE_SPEC_PATH} cannot choose its deal. Remove \`seed\` there (and run \`boardsmith smoke\` without \`--seed\`).`;

function newWalk(options: SmokeTestOptions): SmokeWalk {
  return {
    listed: [...options.actions],
    unreachable: { ...options.unreachable },
    offered: new Set(),
    enabled: new Set(),
    taken: new Set(),
    steps: options.steps ?? DEFAULT_SMOKE_STEPS,
    errors: [],
    seeds: [],
    stalls: [],
    inputs: { ...options.inputs },
    wanting: new Map(),
    fieldsMet: new Map(),
  };
}

// -------------------------------------------------------------------------------------------
// What counts as an error
// -------------------------------------------------------------------------------------------

/** Records every uncaught error, console error and failed request to the dev host, once each. */
function watchForErrors(page: Page, walk: SmokeWalk): void {
  const devHost = (url: string) => {
    const base = page.url();
    return base.startsWith('http') && new URL(url).origin === new URL(base).origin;
  };
  page.on('pageerror', (error) => note(walk, `An uncaught error in the page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url } = message.location();
    note(walk, `A console error: ${message.text()}${url ? ` (from ${new URL(url).pathname})` : ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && devHost(response.url())) {
      note(walk, `${response.request().method()} ${new URL(response.url()).pathname} was answered ${response.status()}.`);
    }
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'no reason given';
    // An aborted request is one the page itself stopped, by navigating on; nothing failed.
    if (reason !== 'net::ERR_ABORTED' && devHost(request.url())) {
      note(walk, `${request.method()} ${new URL(request.url()).pathname} failed: ${reason}.`);
    }
  });
}

/** Keeps every `boardsmith:action-resolved` event a frame fires, for {@link drainResolved}. */
async function recordResolvedActions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const resolved: unknown[] = [];
    Object.defineProperty(window, '__boardsmithSmokeResolved', { value: resolved });
    window.addEventListener('boardsmith:action-resolved', (event) => resolved.push((event as CustomEvent).detail));
  });
}

/** The actions resolved in `frame` since the last call, recorded (`recordResolved`): taken ones taken, failed ones reported. */
async function drainResolved(frame: Frame, walk: SmokeWalk, memory: WalkMemory): Promise<number> {
  const resolved = await frame.evaluate(() => {
    const log = (window as unknown as { __boardsmithSmokeResolved?: unknown[] }).__boardsmithSmokeResolved ?? [];
    return log.splice(0, log.length) as ResolvedAction[];
  });
  recordResolved(resolved, walk, memory);
  return resolved.length;
}

/** Reports each error toast the game shows a player, once, except one repeating a refused number (#466). */
async function noteErrorToasts(frame: Frame, walk: SmokeWalk, memory: WalkMemory): Promise<void> {
  for (const text of await frame.locator('.toast.error').allInnerTexts()) {
    if (![...memory.refusals].some((refusal) => text.includes(refusal))) note(walk, `The game showed an error: ${text.trim()}`);
  }
}

// -------------------------------------------------------------------------------------------
// Taking a seat
// -------------------------------------------------------------------------------------------

/** The frame the game renders in, once the dev host has put it on the page. */
async function gameFrame(page: Page): Promise<Frame> {
  const found = () => page.frames().find((f) => GAME_FRAME_PATHS.some((path) => new URL(f.url(), 'http://x').pathname === path));
  const started = Date.now();
  for (;;) {
    const frame = found();
    if (frame) return frame;
    if (Date.now() - started > SHELL_WAIT_MS) {
      throw new Error(
        `The dev host never showed the game: no frame at ${GAME_FRAME_PATHS.join(' or ')} after ${SHELL_WAIT_MS / 1000}s. ` +
          'Run `boardsmith dev` and open it to see what it shows instead.',
      );
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Takes a seat as a player's browser does. A table seats the first browser by itself and a world
 * attaches it to a free seat; a table that shows its lobby instead is asked for the first open seat.
 */
async function takeASeat(page: Page): Promise<void> {
  const lobbySeat = page.locator('button[aria-label^="Take seat"]').first();
  const frameShown = page.locator('iframe.dev-host__frame, iframe.world-dev__frame').first();
  await Promise.race([lobbySeat.waitFor({ timeout: SHELL_WAIT_MS }), frameShown.waitFor({ timeout: SHELL_WAIT_MS })]).catch(() => {
    throw new Error(
      `The dev host showed neither a seat nor the game after ${SHELL_WAIT_MS / 1000}s. ` +
        'Run `boardsmith dev` and open it to see what it shows instead.',
    );
  });
  if (await lobbySeat.isVisible()) await lobbySeat.click({ timeout: PRESS_MS });
  const frame = await gameFrame(page);
  await frame.locator('[data-testid="bs-actionbar"]').waitFor({ state: 'attached', timeout: SHELL_WAIT_MS }).catch(() => {
    throw new Error(
      `The game frame never showed its action bar after ${SHELL_WAIT_MS / 1000}s, so the game did not render. ` +
        'The errors above say why; run `boardsmith dev` to see it.',
    );
  });
}

/**
 * At a table, turns on the dev host's "Follow active seat", so the page acts for whichever seat is
 * due and the bots stand down. A world's dev host has no seats to follow, and is left as it is.
 */
async function followTheActiveSeat(page: Page): Promise<void> {
  const switcher = page.getByTestId('seat-switcher');
  if ((await switcher.count()) === 0) return;
  await switcher.click({ timeout: PRESS_MS });
  await page.getByTestId('follow-active-seat').click({ timeout: PRESS_MS });
  await page.locator('[data-testid="seat-switcher"][data-following="true"]').waitFor({ timeout: TURN_WAIT_MS }).catch(() => {
    throw new Error(
      `The dev host did not follow the active seat ${TURN_WAIT_MS / 1000}s after "Follow active seat" was pressed. ` +
        'Run `boardsmith dev` and press it to see why.',
    );
  });
}

/** The dev host's "Table setup" toggle, which a table's dev host has and a world's has not. */
const tableSetup = (page: Page) => page.getByTestId('table-setup-toggle').filter({ visible: true }).first();

/** Whether the dev host deals its games from a seed the page names: a table's does, a world's does not. */
async function canDeal(page: Page): Promise<boolean> {
  return (await tableSetup(page).count()) > 0;
}

/**
 * Deals a new game from `seed` in the dev host's Table setup (#460), and waits until the game frame
 * has been handed that game. Follow-mode carries over the new game, so no bot moves in it: the same
 * seed and the same walk make the same game.
 */
async function dealFrom(page: Page, seed: string): Promise<void> {
  console.log(`smoke: dealing a game from seed "${seed}"`);
  await tableSetup(page).click({ timeout: PRESS_MS });
  await page.getByTestId('deal-seed').fill(seed, { timeout: PRESS_MS });
  await page.getByTestId('deal').click({ timeout: PRESS_MS });
  await page
    .waitForFunction((dealt) => document.querySelector('[data-testid="game-seed"]')?.textContent === dealt, seed, { timeout: TURN_WAIT_MS })
    .catch(() => {
      throw new Error(`The dev host had not dealt a game from seed "${seed}" ${TURN_WAIT_MS / 1000}s after Deal was pressed.`);
    });
  await tableSetup(page).click({ timeout: PRESS_MS });
}

// -------------------------------------------------------------------------------------------
// The walk
// -------------------------------------------------------------------------------------------

/** Waits until the panel has its offers, and the page has painted what the last press changed. */
async function settle(frame: Frame): Promise<void> {
  await frame.locator('[data-testid="bs-actions-pending"]').waitFor({ state: 'detached', timeout: TURN_WAIT_MS }).catch(() => {
    throw new Error(`The panel was still loading its actions after ${TURN_WAIT_MS / 1000}s.`);
  });
  // Two frames painted, or a second gone by in a frame the browser does not paint.
  await frame.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(done));
        setTimeout(done, 1000);
      }),
  );
}

/** What the page offers now: its action buttons, the open action, and the board's untried controls. */
interface Offers {
  /** The actions the panel shows that may be taken now. */
  enabled: string[];
  /** The groups the panel shows, each a menu of more actions. */
  groups: string[];
  /** Whether the panel is showing a group's menu, which has a way back. */
  inGroup: boolean;
  /** The action the panel has open, if any. */
  open: string | null;
}

async function readOffers(frame: Frame, walk: SmokeWalk): Promise<Offers> {
  const offers = await frame.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>('[data-bs-action]')];
    return {
      all: buttons.map((b) => b.dataset.bsAction ?? ''),
      enabled: buttons.filter((b) => b.getAttribute('aria-disabled') !== 'true').map((b) => b.dataset.bsAction ?? ''),
      groups: [...document.querySelectorAll<HTMLElement>('[data-bs-action-group]')].map((g) => g.dataset.bsActionGroup ?? ''),
      inGroup: document.querySelector('[data-bs-menu-back]') !== null,
      open: document.querySelector<HTMLElement>('[data-bs-open-action]')?.dataset.bsOpenAction ?? null,
    };
  });
  for (const name of [...offers.all, ...(offers.open ? [offers.open] : [])]) walk.offered.add(name);
  for (const name of [...offers.enabled, ...(offers.open ? [offers.open] : [])]) walk.enabled.add(name);
  return { enabled: offers.enabled, groups: offers.groups, inGroup: offers.inGroup, open: offers.open };
}

/**
 * A control one look at the page found (`pageControls`), the locator that presses it, its frame,
 * and how it was found, so it can be found again just before it is pressed (`stillThere`).
 */
interface Control extends PageControl {
  /**
   * The control's own element: the one at its place among the matches when it was found, until
   * `stillThere` has found it again for a press and marked it, which pins it wherever the page moves it.
   */
  readonly target: Locator;
  readonly frame: Frame;
  readonly selector: string;
  readonly within: Locator | undefined;
}

/**
 * The visible controls `selector` matches in `frame` (within `within` when given) that a player can
 * reach, read in one look at the page, so none can go away between being found and being read (#464).
 */
async function controlsOf(frame: Frame, selector: string, within?: Locator): Promise<Control[]> {
  const visible = visibleMatches(frame, selector, within);
  return (await visible.evaluateAll(pageControls)).map((control) => ({
    ...control,
    target: visible.nth(control.index),
    frame,
    selector,
    within,
  }));
}

/**
 * `control` as the page has it now, pinned to its element: the page may have moved another element
 * into its place among the matches since it was found, so it is found again by what it stands for
 * and marked in the same look (`pageControls`), and the press reaches the marked element wherever the
 * page moves it. A redraw can take it away for a moment, so it is looked for again until it comes
 * back; one still gone after {@link PRESS_MS} went away. It must still be pressable too: one found
 * disabled is waited for the same way, and reported if it stays so. A pick's candidate is the one
 * exception, since what it stands for, and whether the game refuses that, can depend on where the
 * pointer is, which `aimAndClick` settles once it has pointed at it.
 */
async function stillThere(control: Control): Promise<Control> {
  const { frame, selector, within } = control;
  const mark = String(++pressMarks);
  const started = Date.now();
  for (;;) {
    const now = await visibleMatches(frame, selector, within).evaluateAll(pageControls, { key: control.key, index: control.index, mark });
    const same = now.find((c) => c.marked);
    if (same !== undefined && (same.enabled || control.candidate)) {
      return { ...same, target: frame.locator(`[${PRESS_MARK}="${mark}"]`), frame, selector, within };
    }
    if (Date.now() - started > PRESS_MS) throw new Error(same === undefined ? GONE : DISABLED);
    await frame.waitForTimeout(100);
  }
}

/** The elements `selector` matches in `frame` (within `within` when given) that a player can see. */
function visibleMatches(frame: Frame, selector: string, within?: Locator): Locator {
  return (within ?? frame).locator(selector).filter({ visible: true });
}

/** How many controls the walk has marked to press (`stillThere`), so each mark is its own. */
let pressMarks = 0;

/** Takes the walk's press marks off the page again, so the game's page is left as the game drew it. */
async function unmark(frame: Frame): Promise<void> {
  await frame.locator(`[${PRESS_MARK}]`).evaluateAll((marked, name) => marked.forEach((element) => element.removeAttribute(name)), PRESS_MARK);
}

/** The first enabled control matched by the first of `selectors` that matches one, or undefined. */
async function firstPressable(frame: Frame, selectors: readonly string[]): Promise<Control | undefined> {
  for (const selector of selectors) {
    const enabled = (await controlsOf(frame, selector)).find((control) => control.enabled);
    if (enabled) return enabled;
  }
  return undefined;
}

/** Why a press failed when something in front of a control kept the pointer from it. */
const COVERED = 'another element covers it, so a pointer cannot reach it';

/** Why a press failed when the control left the page between being found and being pressed. */
const GONE = 'it went away before the press landed';

/** Why a press failed when the control was disabled by the time the walk went to press it, and stayed so. */
const DISABLED = `it was disabled when the walk went to press it, and still was ${PRESS_MS / 1000}s later`;

/** A press that found a toast over the control, which goes by itself. */
class UnderAToast extends Error {}

/** Why a press did not land, as a player would put it. */
async function whyNotPressed(target: Locator, error: unknown): Promise<string> {
  if ((await target.count()) === 0) return GONE;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnderAToast || /intercepts pointer events/.test(message)) return COVERED;
  if (error instanceof Error && error.name === 'TimeoutError') return `it did not become pressable within ${PRESS_MS / 1000}s`;
  return message.split('\n')[0];
}

/** `error` as an {@link UnderAToast} when it is Playwright's click finding a toast on top of the control, else itself. */
function toastOnTop(error: unknown): unknown {
  const toast = error instanceof Error && /class="[^"]*\btoast\b[^"]*"[^\n]*intercepts pointer events/.test(error.message);
  return toast ? new UnderAToast(COVERED) : error;
}

/**
 * Presses `control` as a player would: with the pointer, or, for a keyboard-only control (invisible
 * and taking no pointer, `pageControls`), by focusing it and pressing Enter (#457). A pick's
 * candidate is aimed at first (`aimAndClick`, #468), and any other control on the board is clicked
 * where it shows (`clickWhereReachable`): the walk points at both itself, so a card that lifts, a
 * board that never stands still and a control partly under a tray are pressed as a player presses
 * them. A control in the panel is clicked by Playwright. A toast over the control goes by itself, so
 * the walk reads it, waits for it to go, as a player does, and presses again. A press
 * that does not land, because the control went away, something covers it or it never becomes
 * pressable, is reported and the walk goes on. So is one that replaced the game's page, taking the
 * frame the walk pressed in away with whatever the press did: the walk goes on in the frame the
 * page shows next. Returns whether the press landed.
 */
async function press(control: Control, what: string, walk: SmokeWalk, memory: WalkMemory): Promise<boolean> {
  const replaced = `Pressing ${what} replaced the game's page, so the walk could not see what the press did.`;
  // A page that redraws the control as a new element mid-press takes away the element marked for
  // it, and one look at the control (LOOK_MS) may run out before it stands still or is uncovered:
  // the walk finds the control again and presses that, for PRESS_MS in all. What was on top when
  // the time ran out says whether a toast covered it.
  const pressIt = async () => {
    const deadline = Date.now() + PRESS_MS;
    for (;;) {
      const now = await stillThere(control);
      try {
        return await pressOnce(now);
      } catch (error) {
        if (error instanceof UnderAToast || control.frame.isDetached()) throw error;
        if (Date.now() > deadline) throw toastOnTop(error);
        const lookRanOut = error instanceof Error && error.name === 'TimeoutError';
        if (!lookRanOut && (await now.target.count()) > 0) throw error;
      }
    }
  };
  try {
    // A toast on top is waited out on its own time, not the press's, and the press starts afresh
    // once it has gone: a game may show a second toast as the first leaves.
    for (let toasts = 0; ; toasts++) {
      try {
        await pressIt();
        return true;
      } catch (error) {
        if (!(error instanceof UnderAToast) || toasts >= TOASTS_WAITED) throw error;
        await waitOutTheToast(control.frame, walk, memory);
      }
    }
  } catch (error) {
    note(walk, control.frame.isDetached() ? replaced : `Pressing ${what} did not work: ${await whyNotPressed(control.target, error)}.`);
    return false;
  } finally {
    // The marks went with the page that was replaced; the press is reported once, whichever read saw it go.
    await unmark(control.frame).catch(() => note(walk, replaced));
  }
}

/**
 * One attempt at pressing `control`, as `press` describes. A control off the board is clicked by
 * Playwright, which waits for it to be visible, still and on top, for one look ({@link LOOK_MS}):
 * a panel that redraws its buttons as new elements takes the element away, and `press` finds the
 * control again rather than waiting on an element that is gone.
 */
function pressOnce(control: Control): Promise<void> {
  if (control.keyboardOnly) return control.target.press('Enter', { timeout: PRESS_MS });
  if (control.candidate) return aimAndClick(control);
  return control.onBoard ? clickWhereReachable(control) : control.target.click({ timeout: LOOK_MS });
}

/** The longest a toast stays: an error toast goes after 4 seconds. */
const TOAST_WAIT_MS = 8_000;

/** How many toasts in a row the walk waits out for one press, before what is on top counts as covering the control. */
const TOASTS_WAITED = 3;

/**
 * Waits for every toast on the page to go, as a player does before pressing what is under one. What
 * an error toast says is read before it goes, so waiting it out hides nothing. A toast still there
 * after {@link TOAST_WAIT_MS} covers the control for good (an {@link UnderAToast}).
 */
async function waitOutTheToast(frame: Frame, walk: SmokeWalk, memory: WalkMemory): Promise<void> {
  await noteErrorToasts(frame, walk, memory);
  await frame.waitForFunction(() => document.querySelector('.toast') === null, undefined, { timeout: TOAST_WAIT_MS }).catch(() => {
    throw new UnderAToast(COVERED);
  });
}

/**
 * Where on a board control the walk points (#468), as fractions of its width and height: its centre
 * first, then a grid over the rest of it, for a control partly covered or a candidate refused at its
 * centre.
 */
const AIM_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  ...[0.1, 0.3, 0.5, 0.7, 0.9].flatMap((y) => [0.1, 0.3, 0.5, 0.7, 0.9].map((x) => [x, y] as const)).filter(([x, y]) => x !== 0.5 || y !== 0.5),
];

/** What lies on top at a point of a control: the control itself, a toast, or something else. */
type OnTop = 'it' | 'toast' | 'other';

/**
 * How long one look at a control the walk is pointing at may wait for it: one that went away is
 * found again by `press` while its time lasts, rather than waited on.
 */
const LOOK_MS = 1_000;

/** What lies on top at fractions (x, y) of `control`'s box, scrolled into view where it shows. */
function onTopAt(control: Control, x: number, y: number): Promise<OnTop> {
  return control.target.evaluate(
    (element, [fx, fy]): OnTop => {
      // Scrolled into view as little as it takes first, then to the middle, the top and the bottom
      // of its scroller, as a player scrolls a control out from under a bar fixed along an edge.
      let hit: Element | null = null;
      for (const block of ['nearest', 'center', 'start', 'end'] as const) {
        element.scrollIntoView({ block, inline: 'nearest' });
        const box = element.getBoundingClientRect();
        hit = element.ownerDocument.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
        if (hit !== null && (hit === element || element.contains(hit))) return 'it';
      }
      return hit?.closest('.toast') ? 'toast' : 'other';
    },
    [x, y] as const,
    { timeout: LOOK_MS },
  );
}

/** Where fractions (x, y) of `control`'s box are on the page. */
async function placeOf(control: Control, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await control.target.boundingBox({ timeout: LOOK_MS });
  if (box === null) throw new Error(GONE);
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

/**
 * Moves the pointer to fractions (x, y) of `control`'s box when the control is on top there, and
 * returns where that is on the page, else what lies on top. It moves the mouse itself rather than
 * waiting for the control to stand still, as a player does: a board that animates, or pans as the
 * pointer moves over it, is pointed at all the same.
 */
async function pointAt(control: Control, x: number, y: number): Promise<{ x: number; y: number } | Exclude<OnTop, 'it'>> {
  const top = await onTopAt(control, x, y);
  if (top !== 'it') return top;
  const at = await placeOf(control, x, y);
  await control.frame.page().mouse.move(at.x, at.y);
  return at;
}

/** How far, in pixels, a control may move between two looks and still count as where it was. */
const STILL_PX = 2;

/** How many looks, two painted frames apart, the walk gives a control to settle under the pointer. */
const SETTLE_LOOKS = 10;

/** Waits for the page to paint twice, or a second in a frame the browser does not paint. */
async function framesPass(frame: Frame): Promise<void> {
  await frame.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(done));
        setTimeout(done, 1000);
      }),
  );
}

/**
 * Clicks fractions (x, y) of `control`, where the pointer was moved to `at`, provided the control is
 * still on top there. A control that pointing at it removed (#464) or covered is not pressed. One
 * that moves when pointed at (a card that lifts under the pointer) is followed until it settles, and
 * one that never settles (a board that keeps panning) is clicked where it is once it has had its
 * looks. A click that would land on anything but the control, because the page moved something
 * else under the pointer at that instant, is stopped (`landsOnlyOn`), and the walk looks again.
 */
async function clickAt(control: Control, at: { x: number; y: number }, x: number, y: number): Promise<void> {
  const mouse = control.frame.page().mouse;
  let pointer = at;
  for (let looks = 1; looks <= 2 * SETTLE_LOOKS; looks++) {
    await framesPass(control.frame);
    if ((await control.target.count()) === 0) throw new Error(GONE);
    const top = await onTopAt(control, x, y);
    if (top === 'toast') throw new UnderAToast(COVERED);
    if (top === 'other') throw new Error(COVERED);
    const now = await placeOf(control, x, y);
    const still = Math.abs(now.x - pointer.x) <= STILL_PX && Math.abs(now.y - pointer.y) <= STILL_PX;
    if ((still || looks >= SETTLE_LOOKS) && (await landsOnlyOn(control, () => mouse.click(now.x, now.y)))) return;
    await mouse.move(now.x, now.y);
    pointer = now;
  }
  throw new Error('it kept moving out from under the pointer, so no click landed on it');
}

/** Why a press failed when the click reached nothing in the game's frame. */
const OVER_THE_FRAME = "the click reached nothing in the game, so something over the game's frame (the page around it) took it";

/**
 * Runs `click` with every pointer and mouse event that would reach anything but `control` stopped
 * before the page sees it, as Playwright's own click does (`guardClicks`), and says whether the
 * click reached `control` (`clickReached`). A click that reached something else did nothing, so the
 * walk can look again and click once more. One that reached nothing in the game's frame landed on
 * whatever the page around the game has over the frame, where no look inside the frame can see it,
 * so the control is not pressable.
 */
async function landsOnlyOn(control: Control, click: () => Promise<void>): Promise<boolean> {
  await control.target.evaluate(guardClicks, undefined, { timeout: PRESS_MS });
  let reached: Reached = 'nothing';
  try {
    await click();
  } finally {
    reached = await control.frame.evaluate(clickReached);
  }
  if (reached === 'nothing') throw new Error(OVER_THE_FRAME);
  return reached === 'it';
}

/**
 * Clicks a board control at the first of {@link AIM_POINTS} where it, not something on top of it, is
 * under the pointer (`clickAt`), as a player clicks the part of a card a tray leaves showing.
 */
async function clickWhereReachable(control: Control): Promise<void> {
  const covers = new Set<Exclude<OnTop, 'it'>>();
  for (const [x, y] of AIM_POINTS) {
    const at = await pointAt(control, x, y);
    if (typeof at !== 'string') return clickAt(control, at, x, y);
    covers.add(at);
  }
  unreachable(covers);
}

/** Throws why no point of a control could be pressed: a toast over it, or something else. */
function unreachable(covers: ReadonlySet<Exclude<OnTop, 'it'>>): never {
  if (covers.has('toast')) throw new UnderAToast(COVERED);
  throw new Error(COVERED);
}

/**
 * Clicks a pick's candidate as a player does: points at it, and clicks where it then stands for a
 * choice the game accepts (#468). A candidate that stands for one choice accepts the click at its
 * centre. One that stands for whatever lies under the pointer (a placement surface whose
 * `data-bs-candidate` follows the pointer) may be refused (`aria-disabled`) at its centre, so the
 * walk aims at other points on it until one is accepted, and clicks there.
 */
async function aimAndClick(control: Control): Promise<void> {
  const covers = new Set<Exclude<OnTop, 'it'>>();
  let reached = false;
  for (const [x, y] of AIM_POINTS) {
    const at = await pointAt(control, x, y);
    if (typeof at === 'string') {
      covers.add(at);
      continue;
    }
    reached = true;
    const accepted = await control.target.evaluate(
      (element) => element.getAttribute('aria-disabled') !== 'true' && element.hasAttribute('data-bs-candidate'),
      undefined,
      { timeout: PRESS_MS },
    );
    if (accepted) return clickAt(control, at, x, y);
  }
  if (reached) throw new Error('wherever the pointer aims on it, it stands for a choice the game refuses');
  unreachable(covers);
}

/**
 * Presses what `selector` matches first in `frame`, the panel's `what`, which the panel showed a
 * moment before. A panel redrawing its buttons has none for a moment, so one not there is looked for
 * again until it comes back; one still gone after {@link PRESS_MS} is reported, not skipped: the
 * panel took back what it offered.
 */
async function pressThePanels(frame: Frame, selector: string, what: string, walk: SmokeWalk, memory: WalkMemory): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    const [control] = await controlsOf(frame, selector);
    if (control !== undefined) return press(control, `the panel's ${what}`, walk, memory);
    if (Date.now() - started > PRESS_MS) break;
    await frame.waitForTimeout(100);
  }
  note(walk, `The panel showed its ${what}, and it was still gone ${PRESS_MS / 1000}s later, when the walk went to press it.`);
  return false;
}

/**
 * One open action being answered: the walk, what it remembers, the action, the step, and the board
 * candidates this pick has chosen, since the board does not mark them.
 */
interface Answering {
  readonly frame: Frame;
  readonly walk: SmokeWalk;
  readonly memory: WalkMemory;
  readonly name: string;
  readonly step: number;
  readonly picked: Set<string>;
  /** The refused board candidates that name the same choice wherever they are pointed at (#468). */
  readonly refused: Set<string>;
  /**
   * Why the walk stops answering before the action resolves (#470): a field the spec's `inputs`
   * give no value for yet, or a spec input that failed.
   */
  stop?: { readonly wanting: string } | { readonly problem: string };
}

/** A board candidate of the open pick that this pick has not chosen yet, recorded in `picked`. */
async function unpickedCandidate({ frame, picked }: Answering): Promise<Control | undefined> {
  for (const candidate of await controlsOf(frame, BOARD_CANDIDATES)) {
    if (picked.has(candidate.key) || !candidate.enabled) continue;
    picked.add(candidate.key);
    return candidate;
  }
  return undefined;
}

/** How the walk names a control: its label, else, for one with no words on it, what it stands for. */
const nameOf = (control: Control) => (control.label === '' ? control.key : control.label);

/** Presses `answer` to a choice of the open action, saying what it pressed. Returns its name. */
async function pressAnswer(answer: Control, { walk, memory, name, step }: Answering): Promise<string> {
  narrate(step, `pressing "${nameOf(answer)}" for "${name}"`);
  await press(answer, `"${nameOf(answer)}" while answering "${name}"`, walk, memory);
  return nameOf(answer);
}

/**
 * Answers one step of an open multi-select pick (#459), as a player makes one: one more distinct
 * choice (an unticked box in the panel, else a board candidate the pick has not chosen) until the
 * pick has at least one and its Done button is ready, then Done. The pick's own min and max decide
 * through the panel: Done is ready from min on, every box left is refused at max, and a pick whose
 * min is its max has no Done at all and completes on its last choice. Returns what it pressed.
 */
async function answerMultiSelect(answering: Answering): Promise<string | undefined> {
  const { frame, picked } = answering;
  const inPanel = (await frame.locator('.action-config .multi-select-choice input[type="checkbox"]').count()) > 0;
  const chosen = inPanel ? await frame.locator('.action-config .multi-select-choice input:checked').count() : picked.size;
  const done = await firstPressable(frame, ['.action-config .done-button']);
  const next =
    done !== undefined && chosen > 0
      ? done
      : ((inPanel
          ? await firstPressable(frame, ['.action-config .multi-select-choice input[type="checkbox"]:not(:checked)'])
          : await unpickedCandidate(answering)) ?? done);
  return next === undefined ? undefined : pressAnswer(next, answering);
}

/**
 * Answers one choice of the open action, as a player would: a multi-select pick one choice at a
 * time, else the board's own candidate first (so the board's controls are pressed, not only the
 * panel's), then the panel's choices, a value for a number or text field, and the button that
 * finishes a step. Returns what it pressed, or undefined when there was nothing to answer.
 */
async function answerOneChoice(answering: Answering): Promise<string | undefined> {
  const { frame } = answering;
  await fillAnEmptyField(answering);
  if (answering.stop !== undefined) return undefined;
  // An ordered list shows a count too, and is answered by its Add buttons below.
  const multiSelect = frame.locator('.action-config .multi-select-count:not(.ordered-list-count)');
  if ((await multiSelect.count()) > 0) return answerMultiSelect(answering);

  const target =
    (await firstPressable(frame, ['.action-config [data-bs-confirm]', BOARD_CANDIDATES])) ??
    (await aimedElsewhere(answering)) ??
    (await firstPressable(frame, [
      '.action-config .board-handoff-btn',
      '.action-config .choice-btn',
      '.action-config .ordered-list-add',
      '.action-config .done-button',
      '.action-config .skip-btn',
    ]));
  return target === undefined ? undefined : pressAnswer(target, answering);
}

/** A pick's candidates on the board. */
const BOARD_CANDIDATES = '[data-testid="bs-board"] [data-bs-candidate]';

/**
 * A refused board candidate that stands for whatever lies under the pointer (#468), found by
 * pointing at two corners of it and seeing it name two different choices: aimed elsewhere, it may
 * stand for one the game accepts, so it is pressed (`aimAndClick` finds where). A refused candidate
 * that names the same choice wherever it is pointed at is refused, and is not looked at again while
 * this action is answered. Each candidate is pinned to its element (`stillThere`) before the pointer
 * moves, since pointing at it changes what it stands for, which is how it was known.
 */
async function aimedElsewhere(answering: Answering): Promise<Control | undefined> {
  const { frame, refused } = answering;
  try {
    for (const candidate of await controlsOf(frame, BOARD_CANDIDATES)) {
      if (candidate.enabled || candidate.keyboardOnly || refused.has(candidate.key)) continue;
      const pinned = await stillThere(candidate);
      const named = async (x: number, y: number) =>
        typeof (await pointAt(pinned, x, y)) === 'string' ? undefined : pinned.target.getAttribute('data-bs-candidate', { timeout: LOOK_MS });
      const first = await named(0.1, 0.1);
      if (first !== undefined && first !== (await named(0.9, 0.9))) return asItStandsNow(pinned);
      refused.add(candidate.key);
    }
    return undefined;
  } finally {
    await unmark(frame);
  }
}

/**
 * `control`, pinned to its element by `stillThere`, read again as that element stands now: pointing
 * at it changed what it stands for. Its place among the matches is its target again, as `controlsOf`
 * gives it, since the pin comes off once the pointing is done.
 */
async function asItStandsNow(control: Control): Promise<Control> {
  const [now] = await control.target.evaluateAll(pageControls);
  if (now === undefined) throw new Error(GONE);
  const { frame, selector, within } = control;
  return { ...control, label: now.label, key: now.key, enabled: now.enabled, target: visibleMatches(frame, selector, within).nth(control.index) };
}

/** What a spec's `inputs` function reads of the game's frame (#470): the visible text a player reads. */
function inputView(frame: Frame): SmokeInputView {
  return {
    texts: async (selector) =>
      (await frame.locator(selector).filter({ visible: true }).allInnerTexts())
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) => text !== ''),
  };
}

/**
 * Fills the open action's text or number field when it is empty, as a player types before pressing
 * Done: the value the spec's `inputs` give that field (`data-bs-pick` names it, #470), else "smoke
 * test" in a text field, and in a number field a value its own min, max and step accept, moved up
 * past each one the game refused before (#465, #466, `numberToEnter`). An input that gives no value
 * yet, or fails, stops the answering (`Answering.stop`) with the field left empty.
 */
async function fillAnEmptyField(answering: Answering): Promise<void> {
  const { frame, memory, name, step } = answering;
  const field = await firstPressable(frame, [
    '.action-config .text-input input',
    '.action-config .text-input textarea',
    '.action-config .number-input input[type="number"]',
  ]);
  if (field === undefined || (await field.target.inputValue({ timeout: PRESS_MS })) !== '') return;
  const typed = await valueToType(answering, field);
  if (typed === undefined) return;
  memory.typed.set(name, [...(memory.typed.get(name) ?? []).filter((t) => t.field !== typed.field), typed]);
  narrate(step, `entering "${typed.value}" for "${name}"${typed.from === 'inputs' ? ', from `inputs`' : ''}`);
  await field.target.fill(typed.value, { timeout: PRESS_MS });
}

/**
 * The value to type in the open action's empty `field`: the spec's input for its pick (#470), else
 * the walk's own, recording the field as met (`SmokeWalk.fieldsMet`). Undefined, with the answering
 * stopped (`Answering.stop`), when the spec's input gives no value yet or fails.
 */
async function valueToType(answering: Answering, field: Control): Promise<TypedValue | undefined> {
  const { frame, walk, memory, name } = answering;
  const pick = await field.target.evaluate((input) => input.closest('[data-bs-pick]')?.getAttribute('data-bs-pick') ?? '', undefined, {
    timeout: PRESS_MS,
  });
  walk.fieldsMet.get(name)?.add(pick);
  const kind = (await field.target.getAttribute('type', { timeout: PRESS_MS })) === 'number' ? 'number' : 'text';
  const given = await inputFor(walk.inputs, name, pick, kind, inputView(frame));
  if (given !== undefined) {
    if ('value' in given) return { field: pick, value: given.value, from: 'inputs', kind };
    answering.stop = 'wanting' in given ? { wanting: pick } : given;
    return undefined;
  }
  if (kind === 'text') return { field: pick, value: 'smoke test', from: 'walk', kind };
  return { field: pick, value: await field.target.evaluate(numberToEnter, memory.refused.get(name) ?? 0, { timeout: PRESS_MS }), from: 'walk', kind };
}

/** {@link answerOneChoice}, given the time a pick's choices take to arrive from the game. */
async function answerWhenOffered(answering: Answering): Promise<string | undefined> {
  const started = Date.now();
  for (;;) {
    const pressed = await answerOneChoice(answering);
    if (pressed !== undefined || answering.stop !== undefined || Date.now() - started > PRESS_MS) return pressed;
    await answering.frame.waitForTimeout(100);
  }
}

/** The open action's panel, as text, to tell whether a press changed anything: empty when it has closed. */
async function openActionState(frame: Frame): Promise<string> {
  const texts = await frame.locator('.action-config').evaluateAll((panels) => panels.map((panel) => (panel as HTMLElement).innerText));
  return texts.join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * Gives up on the open action `name` after `problem`, pressing its Cancel when it has one. The
 * action counts as failed (#467): it is not taken again while the panel offers anything else, so
 * the rest of the game still gets its steps.
 */
async function abandon(frame: Frame, walk: SmokeWalk, memory: WalkMemory, name: string, problem: string): Promise<void> {
  note(walk, problem);
  memory.failed.add(name);
  // An action that closed by itself, or that has no way to back out of it, has no Cancel to press.
  const cancel = '.action-config .cancel-btn';
  if ((await frame.locator(cancel).count()) > 0) await pressThePanels(frame, cancel, 'Cancel', walk, memory);
}

/**
 * Cancels the open action `name` because the spec's `inputs` give no value for its field `field`
 * yet (#470). It is not failed: once another action has been taken, the page may show the value,
 * so the walk takes it again in its turn among the actions taken before (`nextPress`). It stays
 * required, so an input that never gives one fails the walk (`smokeProblems`).
 */
async function putOff(frame: Frame, walk: SmokeWalk, memory: WalkMemory, name: string, field: string, step: number): Promise<void> {
  narrate(step, `\`inputs\` gives no value for "${field}" of "${name}" yet; cancelling it until the game moves on`);
  walk.wanting.set(name, field);
  memory.putOff.set(name, memory.moves);
  await pressThePanels(frame, '.action-config .cancel-btn', 'Cancel', walk, memory);
}

/**
 * Fills the open action one choice at a time until it resolves or closes, and gives up on it when
 * {@link answered} says to (#463): nothing to press, no change, a loop back to a state it showed, or
 * too many presses.
 */
async function finishOpenAction(frame: Frame, walk: SmokeWalk, memory: WalkMemory, name: string, step: number): Promise<void> {
  const answering: Answering = { frame, walk, memory, name, step, picked: new Set(), refused: new Set() };
  const where = `at step ${step}${memory.dealt === null ? '' : ` of the game dealt from seed "${memory.dealt}"`}`;
  const trail = startAnswering(name, where, await openActionState(frame));
  memory.typed.delete(name);
  if (!walk.fieldsMet.has(name)) walk.fieldsMet.set(name, new Set());
  while ((await readOffers(frame, walk)).open === name) {
    const answer = await answerWhenOffered(answering);
    if (answering.stop !== undefined) {
      return 'wanting' in answering.stop
        ? putOff(frame, walk, memory, name, answering.stop.wanting, step)
        : abandon(frame, walk, memory, name, answering.stop.problem);
    }
    await settle(frame);
    // Resolved: whatever is open now (the same action again on a later turn) is a later step's.
    if ((await drainResolved(frame, walk, memory)) > 0) return;
    const problem = answered(trail, answer, await openActionState(frame), [...answering.picked]);
    if (problem !== undefined) return abandon(frame, walk, memory, name, problem);
  }
}

/** The board's controls: every button or `[role="button"]` on it a keyboard can reach, other than a pick's candidate. */
const BOARD_CONTROLS = ':is(button, [role="button"]):not([data-bs-candidate]):not([tabindex="-1"])';

/**
 * The board's own controls (`BOARD_CONTROLS` inside the board), read in one look. An element only
 * script can focus, such as a card in a stack, is not one; a keyboard-only control, invisible and
 * taking no pointer, is (#457). Each is known by the game element it stands for when it has one,
 * since its label can change with the game ("deck, 30 cards"), else by its label.
 */
async function boardControls(frame: Frame): Promise<Control[]> {
  return (await controlsOf(frame, `[data-testid="bs-board"] ${BOARD_CONTROLS}`)).filter((control) => control.enabled);
}

/**
 * Presses `control`, one of the board's or a dialog's, named `what`, saying so (`said`, else
 * "pressing" and `what`); counts it when the press lands. Returns whether it did.
 */
async function pressABoardControl(
  control: Control,
  what: string,
  walk: SmokeWalk,
  memory: WalkMemory,
  step: number,
  said = `pressing ${what}`,
): Promise<boolean> {
  narrate(step, `${said}${control.keyboardOnly ? ' from the keyboard' : ''}`);
  const landed = await press(control, what, walk, memory);
  if (landed) memory.controls++;
  return landed;
}

/** Presses one board control the walk has not pressed yet. Returns false when every one was pressed. */
async function pressAnUntriedControl(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  for (const control of await boardControls(frame)) {
    if (memory.pressed.has(control.key)) continue;
    memory.pressed.add(control.key);
    memory.boardPress = control.key;
    await pressABoardControl(control, `the board's "${nameOf(control)}"`, walk, memory, step);
    return true;
  }
  return false;
}

/** How many times the walk opens a dialog again to reach one control in it, before it leaves that control be. */
const REOPENS = 2;

/**
 * Opens a dialog again, with the board control that opened it, while a control seen in it has not
 * been pressed (#461): a dialog whose first control closes it, as a discard viewer whose Close comes
 * first does, shows the rest only to a player who opens it again. Returns false when no dialog has a
 * control left to reach, or what opened it is no longer on the board.
 */
async function reopenADialog(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  for (const [key, opener] of memory.dialogControls) {
    const tries = memory.reopened.get(key) ?? 0;
    if (memory.pressed.has(`dialog:${key}`) || opener === undefined || tries >= REOPENS) continue;
    const control = (await boardControls(frame)).find((c) => c.key === opener);
    if (control === undefined) continue;
    memory.reopened.set(key, tries + 1);
    memory.boardPress = control.key;
    await pressABoardControl(control, `the board's "${nameOf(control)}" again, to reach what is left in the dialog it opens`, walk, memory, step);
    return true;
  }
  return false;
}

/** The open modal dialog on top, if any (`pageDialogs`), and the locator that reaches it. */
async function openDialog(frame: Frame): Promise<{ name: string; target: Locator } | undefined> {
  const dialogs = frame.locator(MODAL_DIALOGS).filter({ visible: true });
  const top = (await dialogs.evaluateAll(pageDialogs)).at(-1);
  return top === undefined ? undefined : { name: top.name, target: dialogs.nth(top.index) };
}

/** What the last step did to the dialog found open now, as the walk remembers it (`WalkMemory`). */
interface LastStep {
  /** The board control the last step pressed, which opened this dialog. */
  readonly opener: string | undefined;
  /** The control the last step pressed to close this dialog, which did not close it. */
  readonly didNotClose: string | undefined;
}

/**
 * While a modal dialog is open, it is all a player can reach (#461). The walk presses each control
 * in it once, whichever opening of the dialog shows it, remembering the board control that opened
 * the dialog (so `reopenADialog` can open it again for the controls one that closed it hid) and
 * which controls closed it. Once every control in it has been pressed, it closes the dialog as a
 * player would: with a control that closed a dialog before, else with Escape, the key a modal dialog
 * closes on. A dialog that control left open is reported, since a player who presses it stays in the
 * dialog, and Escape is pressed instead; one still open after Escape is reported too, and ends the
 * walk: a player in it has no way back to the game. Returns whether the walk goes on.
 */
async function answerTheDialog(
  frame: Frame,
  dialog: { name: string; target: Locator },
  last: LastStep,
  walk: SmokeWalk,
  memory: WalkMemory,
  step: number,
): Promise<boolean> {
  const opening = !memory.inDialog;
  memory.inDialog = true;
  const controls = (await controlsOf(frame, BOARD_CONTROLS, dialog.target)).filter((c) => c.enabled);
  for (const control of controls) {
    if (!memory.dialogControls.has(control.key)) memory.dialogControls.set(control.key, opening ? last.opener : undefined);
  }
  const untried = controls.find((control) => !memory.pressed.has(`dialog:${control.key}`));
  if (untried !== undefined) {
    memory.pressed.add(`dialog:${untried.key}`);
    memory.dialogPress = untried.key;
    await pressABoardControl(untried, `"${nameOf(untried)}" in the dialog "${dialog.name}"`, walk, memory, step);
    return true;
  }
  return closeTheDialog(frame, dialog, controls, last, walk, memory, step);
}

/**
 * Closes `dialog`, every one of its `controls` pressed, as `answerTheDialog` says: with a control that
 * closed a dialog before, unless the last step pressed one (`last.didNotClose`) and the dialog is
 * still open, which is reported; else with Escape. Returns whether the walk goes on.
 */
async function closeTheDialog(
  frame: Frame,
  dialog: { name: string; target: Locator },
  controls: readonly Control[],
  last: LastStep,
  walk: SmokeWalk,
  memory: WalkMemory,
  step: number,
): Promise<boolean> {
  const closer = last.didNotClose === undefined ? controls.find((control) => memory.closers.has(control.key)) : undefined;
  if (closer !== undefined) {
    memory.dialogPress = closer.key;
    const said = `closing the dialog "${dialog.name}" with "${nameOf(closer)}"`;
    if (await pressABoardControl(closer, `"${nameOf(closer)}" to close the dialog "${dialog.name}"`, walk, memory, step, said)) {
      memory.closing = { dialog: dialog.name, closer: nameOf(closer) };
    }
    return true;
  }
  if (last.didNotClose !== undefined) {
    note(
      walk,
      `The dialog "${dialog.name}" stayed open after the walk pressed "${last.didNotClose}" in it to close it, as that had closed ` +
        'a dialog before, so a player who presses it stays in the dialog.',
    );
  }
  memory.dialogPress = undefined;
  narrate(step, `closing the dialog "${dialog.name}" with Escape`);
  await dialog.target.press('Escape', { timeout: PRESS_MS }).catch(() => undefined);
  const closed = await dialog.target.waitFor({ state: 'hidden', timeout: PRESS_MS }).then(
    () => true,
    () => false,
  );
  if (closed) return true;
  note(
    walk,
    `The dialog "${dialog.name}" stayed open after the walk pressed everything in it and then Escape, so a player in it ` +
      'has no way back to the game.',
  );
  return false;
}

/** What the walk presses next when no action is open and every board control has been pressed. */
type NextPress = { press: string; what: string } | { take: string } | undefined;

/**
 * Whether taking `name` has ended every game it was taken in, as resigning does. The walk takes
 * such an action again only when the panel offers nothing else, so it does not cut each game short.
 */
function endsTheGame(name: string, memory: WalkMemory): boolean {
  const ended = memory.endings.get(name) ?? 0;
  return ended > 0 && ended >= (memory.resolved.get(name) ?? 0);
}

/**
 * The required actions still to take, less those that failed when taken: the failure is already a
 * problem, and trying them again would only spend the steps the rest of the game needs.
 */
function stillToTake(walk: SmokeWalk, memory: WalkMemory): string[] {
  return requiredUntaken(walk).filter((name) => !memory.failed.has(name));
}

/** Whether `name` was put off for want of an input (#470) and no action has been taken since. */
function puttingOff(name: string, memory: WalkMemory): boolean {
  return memory.putOff.get(name) === memory.moves;
}

/**
 * An action not taken, failed or put off for want of an input (#470) yet, else a group of actions
 * not opened yet, else the way back out of a group, else the action taken least, preferring one
 * that has neither ended the game nor failed, nor been put off with no action taken since. So an
 * action put off is tried again in turn with the actions taken before, not after every move, and
 * however many are put off, the rest of the game keeps its steps. Undefined when the panel offers
 * nothing.
 */
function nextPress(offers: Offers, walk: SmokeWalk, memory: WalkMemory): NextPress {
  const untaken = offers.enabled.find((name) => !walk.taken.has(name) && !memory.failed.has(name) && !memory.putOff.has(name));
  if (untaken) return { take: untaken };
  const group = offers.groups.find((label) => !memory.opened.has(label));
  if (group !== undefined) {
    memory.opened.add(group);
    return { press: `[data-bs-action-group=${JSON.stringify(group)}]`, what: `group "${group}"` };
  }
  if (offers.inGroup) return { press: '[data-bs-menu-back]', what: 'way back' };
  const byTimes = (a: string, b: string) => (memory.times.get(a) ?? 0) - (memory.times.get(b) ?? 0);
  const goesOn = offers.enabled.filter((name) => !endsTheGame(name, memory) && !memory.failed.has(name) && !puttingOff(name, memory));
  const least = [...(goesOn.length > 0 ? goesOn : offers.enabled)].sort(byTimes)[0];
  return least === undefined ? undefined : { take: least };
}

/** Waits for the panel to offer this seat something: its turn at a table, its offers in a world. */
async function waitForATurn(frame: Frame): Promise<boolean> {
  return frame
    .locator('[data-bs-action]:not([aria-disabled="true"]), [data-bs-open-action], .game-over-card')
    .first()
    .waitFor({ timeout: TURN_WAIT_MS })
    .then(
      () => true,
      () => false,
    );
}

/**
 * What the walk remembers from step to step, and from game to game, on one deal: what recording a
 * resolved action keeps (`ResolvedMemory`), and the rest.
 */
interface WalkMemory extends ResolvedMemory {
  /** The controls tried, by key: the board's, and each dialog opening's. */
  readonly pressed: Set<string>;
  /** How many board and dialog control presses landed. */
  controls: number;
  /** The panel's action groups opened, by label. */
  readonly opened: Set<string>;
  /** How many times each action was pressed. */
  readonly times: Map<string, number>;
  /** How many games ended right after each action resolved. */
  readonly endings: Map<string, number>;
  /** How many games the walk has played on this deal, this one included. */
  games: number;
  /** The seed the spec dealt this walk from; null in a world, which `boardsmith dev` deals itself. */
  readonly seed: string | null;
  /** The seed the game being played was dealt from: `seed`, then `seed/2`, `seed/3`... for each new game. */
  dealt: string | null;
  /** Whether the last step found a modal dialog open (#461). */
  inDialog: boolean;
  /** The board control the last step pressed, which opened a dialog the next step finds open. */
  boardPress: string | undefined;
  /** The dialog control the last step pressed, which closed its dialog when the next step finds none. */
  dialogPress: string | undefined;
  /**
   * The dialog the last step pressed a control to close, and that control by name: one that did not
   * close it leaves the next step finding the same dialog still open.
   */
  closing: { readonly dialog: string; readonly closer: string } | undefined;
  /** Every control seen in a dialog, with the board control that opened the dialog it was seen in. */
  readonly dialogControls: Map<string, string | undefined>;
  /** The dialog controls that closed their dialog when pressed. */
  readonly closers: Set<string>;
  /** How many times the walk has opened a dialog again to reach each of its controls. */
  readonly reopened: Map<string, number>;
  /** The actions put off for want of an input (#470), with how many actions had been taken then. */
  readonly putOff: Map<string, number>;
}

function newMemory(seed: string | null): WalkMemory {
  return {
    seed,
    dealt: seed,
    pressed: new Set(),
    controls: 0,
    opened: new Set(),
    times: new Map(),
    resolved: new Map(),
    endings: new Map(),
    failed: new Set(),
    lastResolved: undefined,
    games: 1,
    inDialog: false,
    boardPress: undefined,
    dialogPress: undefined,
    closing: undefined,
    dialogControls: new Map(),
    closers: new Set(),
    reopened: new Map(),
    refused: new Map(),
    refusals: new Set(),
    typed: new Map(),
    moves: 0,
    putOff: new Map(),
  };
}

/**
 * Presses what the panel offers next (see `nextPress`), after waiting for a turn when it offers
 * nothing. Returns false when it still offers nothing, which ends the walk.
 */
async function pressWhatThePanelOffers(frame: Frame, walk: SmokeWalk, memory: WalkMemory, offers: Offers, step: number): Promise<boolean> {
  const next = nextPress(offers, walk, memory);
  if (next === undefined) {
    narrate(step, 'nothing is offered; waiting for a turn');
    if (await waitForATurn(frame)) return true;
    narrate(step, `nothing was offered for ${TURN_WAIT_MS / 1000}s; the walk stops`);
    walk.stalls.push({ step, seed: memory.dealt, seconds: TURN_WAIT_MS / 1000 });
    return false;
  }
  if ('take' in next) {
    memory.times.set(next.take, (memory.times.get(next.take) ?? 0) + 1);
    narrate(step, `taking "${next.take}"`);
    await pressThePanels(frame, `[data-bs-action=${JSON.stringify(next.take)}]`, `"${next.take}"`, walk, memory);
    return true;
  }
  narrate(step, `opening the panel's ${next.what}`);
  await pressThePanels(frame, next.press, next.what, walk, memory);
  return true;
}

/**
 * The game is over. Credits the action it ended on, then deals a new game when listed actions are
 * still to take, from the next seed of this walk's deal (`seed/2`, `seed/3`...), so the run repeats.
 * Returns false when the walk is over: everything required is taken, or it is a world's, which has
 * no new game.
 */
async function afterTheGame(page: Page, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  if (memory.lastResolved !== undefined) memory.endings.set(memory.lastResolved, (memory.endings.get(memory.lastResolved) ?? 0) + 1);
  memory.lastResolved = undefined;
  const left = stillToTake(walk, memory);
  if (left.length === 0) {
    narrate(step, 'the game is over');
    return false;
  }
  if (memory.seed === null) {
    narrate(step, 'the game is over, and a world has no new game');
    return false;
  }
  narrate(step, `the game is over with ${left.map((name) => `"${name}"`).join(', ')} still to take; dealing a new game`);
  memory.games++;
  memory.dealt = `${memory.seed}/${memory.games}`;
  await dealFrom(page, memory.dealt);
  return true;
}

/**
 * Answers the modal dialog open now, if any (`answerTheDialog`), with what the last step did to it:
 * pressed the board control that opened it, or pressed a control to close it that did not. With no
 * dialog open, a dialog control the last step pressed closed its dialog, and is remembered as a
 * closer. Returns whether the walk goes on, or undefined when no dialog is open.
 */
async function answerAnOpenDialog(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean | undefined> {
  const { boardPress, dialogPress, closing } = memory;
  memory.boardPress = undefined;
  memory.dialogPress = undefined;
  memory.closing = undefined;
  const dialog = await openDialog(frame);
  if (dialog !== undefined) {
    const didNotClose = closing?.dialog === dialog.name ? closing.closer : undefined;
    return answerTheDialog(frame, dialog, { opener: boardPress, didNotClose }, walk, memory, step);
  }
  if (memory.inDialog && dialogPress !== undefined) memory.closers.add(dialogPress);
  memory.inDialog = false;
  return undefined;
}

/**
 * One step of the walk: deal a new game after one that ended, press a control of an open modal
 * dialog (#461), press an untried board control, answer the open action, or press what the panel
 * offers. Game over is looked for first, and the game-over card's own controls are never the
 * board's (#462), so the walk cannot dismiss the end of a game it has not seen. A board control
 * comes before the open action because a player can press the board while a pick is open, and
 * because the walk acts for every seat at a table, where a game that opens each turn's action by
 * itself never has a moment with nothing open.
 */
async function walkOneStep(page: Page, frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  await drainResolved(frame, walk, memory);
  await noteErrorToasts(frame, walk, memory);
  if (await frame.locator('.game-over-card').isVisible()) return afterTheGame(page, walk, memory, step);
  const inDialog = await answerAnOpenDialog(frame, walk, memory, step);
  if (inDialog !== undefined) return inDialog;
  const offers = await readOffers(frame, walk);
  if (await reopenADialog(frame, walk, memory, step)) return true;
  if (await pressAnUntriedControl(frame, walk, memory, step)) return true;
  if (offers.open) {
    narrate(step, `answering "${offers.open}"`);
    await finishOpenAction(frame, walk, memory, offers.open, step);
    return true;
  }
  return pressWhatThePanelOffers(frame, walk, memory, offers, step);
}

/**
 * Walks the game a step at a time (`walkOneStep`) until the steps run out, the walk is over, or
 * every required action and every offer has been taken and a few more steps turned up nothing new.
 * A step that cannot go on (a page that stops answering, #464) is reported with the step it was,
 * and ends the walk of this deal.
 */
async function walkTheGame(page: Page, walk: SmokeWalk, memory: WalkMemory): Promise<void> {
  let idle = 0;
  for (let step = 1; step <= walk.steps && idle < IDLE_STEPS; step++) {
    try {
      // Looked up at every step: the dev host puts up a new frame when the game restarts.
      const frame = await gameFrame(page);
      await settle(frame);
      const seenBefore = walk.offered.size + memory.pressed.size;
      if (!(await walkOneStep(page, frame, walk, memory, step))) break;
      const nothingNew = walk.offered.size + memory.pressed.size === seenBefore;
      const allTaken =
        stillToTake(walk, memory).length === 0 && [...walk.offered].every((name) => walk.taken.has(name) || memory.failed.has(name));
      idle = nothingNew && allTaken ? idle + 1 : 0;
    } catch (error) {
      note(walk, walkStopped(error, PRESS_MS / 1000, { step, seed: memory.dealt }));
      return;
    }
  }
  const frame = await gameFrame(page);
  await settle(frame);
  await drainResolved(frame, walk, memory);
  await noteErrorToasts(frame, walk, memory);
  // Errors the last press raised reach the page's listeners a moment after it; let them land.
  await page.waitForTimeout(250);
}

/** Says what the walk does at each step, for whoever watches `boardsmith smoke`. */
function narrate(step: number, what: string): void {
  console.log(`smoke step ${step}: ${what}`);
}
