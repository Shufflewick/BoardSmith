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
 *      candidate for a pick the board shows, and presses every other control on the board once,
 *      from the keyboard when the control is invisible and takes no pointer. While a modal dialog
 *      is open it presses only what is in it, then closes it with Escape, as a player must;
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
import { MODAL_DIALOGS, numberToEnter, pageControls, pageDialogs, type PageControl } from './browser-smoke-page.js';
import {
  answered,
  DEFAULT_SMOKE_SEED,
  requiredUntaken,
  SMOKE_ANNOTATION,
  SMOKE_SPEC_PATH,
  smokeFailure,
  smokeProblems,
  smokeRecord,
  smokeSeeds,
  startAnswering,
  walkStopped,
  type SmokeWalk,
} from './browser-smoke-verdict.js';

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
    const seeds = smokeSeeds(options.seed);
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
        if (options.seed !== undefined) note(walk, WORLD_TAKES_NO_SEED);
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
  `${SMOKE_SPEC_PATH} cannot choose its deal. Remove \`seed\` there.`;

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

/** What the page's `boardsmith:action-resolved` events carry, in every frame. */
interface ResolvedAction {
  action: string;
  success: boolean;
  error?: string;
}

/** Keeps every `boardsmith:action-resolved` event a frame fires, for {@link drainResolved}. */
async function recordResolvedActions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const resolved: unknown[] = [];
    Object.defineProperty(window, '__boardsmithSmokeResolved', { value: resolved });
    window.addEventListener('boardsmith:action-resolved', (event) => resolved.push((event as CustomEvent).detail));
  });
}

/** The actions resolved in `frame` since the last call: taken ones recorded, failed ones reported. */
async function drainResolved(frame: Frame, walk: SmokeWalk, memory: WalkMemory): Promise<number> {
  const resolved = await frame.evaluate(() => {
    const log = (window as unknown as { __boardsmithSmokeResolved?: unknown[] }).__boardsmithSmokeResolved ?? [];
    return log.splice(0, log.length) as ResolvedAction[];
  });
  for (const { action, success, error } of resolved) {
    walk.offered.add(action);
    walk.enabled.add(action);
    if (success) {
      walk.taken.add(action);
      memory.resolved.set(action, (memory.resolved.get(action) ?? 0) + 1);
      memory.lastResolved = action;
    } else if (!refusedANumber(action, error, memory)) {
      memory.failed.add(action);
      const refused = memory.refused.get(action) ?? 0;
      const each = refused > 0 ? ` The game refused each of the ${refused + 1} numbers the walk entered.` : '';
      note(walk, `The panel offered "${action}", and taking it failed: ${error ?? 'no reason given'}${each}`);
    }
  }
  return resolved.length;
}

/** How many numbers the walk enters in an action whose game refuses them, before it reports the action (#466). */
const NUMBER_TRIES = 3;

/**
 * Whether `action` failed because the game's own rules refused a number the walk typed in it, with
 * tries left: then the walk takes it again with the next number up (`numberToEnter`), and the refusal,
 * and the error toast that repeats it, are the game working, not a problem (#466).
 */
function refusedANumber(action: string, error: string | undefined, memory: WalkMemory): boolean {
  const refused = memory.refused.get(action) ?? 0;
  if (!memory.numbered.delete(action) || refused >= NUMBER_TRIES - 1) return false;
  memory.refused.set(action, refused + 1);
  if (error !== undefined) memory.refusals.add(error);
  return true;
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

/** A control one look at the page found (`pageControls`), the locator that presses it, and its frame. */
interface Control extends PageControl {
  readonly target: Locator;
  readonly frame: Frame;
}

/**
 * The visible controls `selector` matches in `frame` (within `within` when given) that a player can
 * reach, read in one look at the page, so none can go away between being found and being read (#464).
 */
async function controlsOf(frame: Frame, selector: string, within?: Locator): Promise<Control[]> {
  const visible = (within ?? frame).locator(selector).filter({ visible: true });
  return (await visible.evaluateAll(pageControls)).map((control) => ({ ...control, target: visible.nth(control.index), frame }));
}

/** The first enabled control matched by the first of `selectors` that matches one, or undefined. */
async function firstPressable(frame: Frame, selectors: readonly string[]): Promise<Control | undefined> {
  for (const selector of selectors) {
    const enabled = (await controlsOf(frame, selector)).find((control) => control.enabled);
    if (enabled) return enabled;
  }
  return undefined;
}

/** Why a press did not land, as a player would put it. */
async function whyNotPressed(target: Locator, error: unknown): Promise<string> {
  if ((await target.count()) === 0) return 'it went away before the press landed';
  const message = error instanceof Error ? error.message : String(error);
  if (/intercepts pointer events/.test(message)) return 'another element covers it, so a pointer cannot reach it';
  if (error instanceof Error && error.name === 'TimeoutError') return `it did not become pressable within ${PRESS_MS / 1000}s`;
  return message.split('\n')[0];
}

/**
 * Presses `control` as a player would: with the pointer, or, for a keyboard-only control (invisible
 * and taking no pointer, `pageControls`), by focusing it and pressing Enter (#457). A press the page
 * does not take within {@link PRESS_MS}, because the control went away, something covers it or it
 * never becomes pressable, is reported and the walk goes on. Returns whether the press landed.
 */
async function press(control: Control, what: string, walk: SmokeWalk): Promise<boolean> {
  const pressIt = () =>
    control.keyboardOnly ? control.target.press('Enter', { timeout: PRESS_MS }) : control.target.click({ timeout: PRESS_MS });
  try {
    await pressIt().catch(async (error: unknown) => {
      if (!coveredByAToast(error)) throw error;
      // A toast over the control goes by itself; a player waits for it, and so does the walk.
      await control.frame.waitForFunction(() => document.querySelector('.toast') === null, undefined, { timeout: TOAST_WAIT_MS });
      await pressIt();
    });
    return true;
  } catch (error) {
    note(walk, `Pressing ${what} did not work: ${await whyNotPressed(control.target, error)}.`);
    return false;
  }
}

/** The longest a toast stays: an error toast goes after 4 seconds. */
const TOAST_WAIT_MS = 8_000;

/** Whether a press failed because a toast lay over the control. */
function coveredByAToast(error: unknown): boolean {
  return error instanceof Error && /class="[^"]*\btoast\b[^"]*"[^\n]*intercepts pointer events/.test(error.message);
}

/** Presses what `selector` matches first in `frame`, as the panel's `what`; false when it has gone. */
async function pressThePanels(frame: Frame, selector: string, what: string, walk: SmokeWalk): Promise<boolean> {
  const [control] = await controlsOf(frame, selector);
  if (control === undefined) return false;
  return press(control, `the panel's ${what}`, walk);
}

/** Records a problem once. */
function note(walk: SmokeWalk, problem: string): void {
  if (!walk.errors.includes(problem)) walk.errors.push(problem);
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
}

/** A board candidate of the open pick that this pick has not chosen yet, recorded in `picked`. */
async function unpickedCandidate({ frame, picked }: Answering): Promise<Control | undefined> {
  for (const candidate of await controlsOf(frame, '[data-testid="bs-board"] [data-bs-candidate]')) {
    if (picked.has(candidate.key) || !candidate.enabled) continue;
    picked.add(candidate.key);
    return candidate;
  }
  return undefined;
}

/** How the walk names a control: its label, else, for one with no words on it, what it stands for. */
const nameOf = (control: Control) => (control.label === '' ? control.key : control.label);

/** Presses `answer` to a choice of the open action, saying what it pressed. Returns its name. */
async function pressAnswer(answer: Control, { walk, name, step }: Answering): Promise<string> {
  narrate(step, `pressing "${nameOf(answer)}" for "${name}"`);
  await press(answer, `"${nameOf(answer)}" while answering "${name}"`, walk);
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
  // An ordered list shows a count too, and is answered by its Add buttons below.
  const multiSelect = frame.locator('.action-config .multi-select-count:not(.ordered-list-count)');
  if ((await multiSelect.count()) > 0) return answerMultiSelect(answering);

  const target = await firstPressable(frame, [
    '.action-config [data-bs-confirm]',
    '[data-testid="bs-board"] [data-bs-candidate]',
    '.action-config .board-handoff-btn',
    '.action-config .choice-btn',
    '.action-config .ordered-list-add',
    '.action-config .done-button',
    '.action-config .skip-btn',
  ]);
  return target === undefined ? undefined : pressAnswer(target, answering);
}

/**
 * Fills the open action's text or number field when it is empty, as a player types before pressing
 * Done: "smoke test" in a text field, and in a number field a value its own min, max and step accept,
 * moved up past each one the game refused before (#465, #466, `numberToEnter`).
 */
async function fillAnEmptyField({ frame, memory, name, step }: Answering): Promise<void> {
  const field = await firstPressable(frame, [
    '.action-config .text-input input',
    '.action-config .text-input textarea',
    '.action-config .number-input input[type="number"]',
  ]);
  if (field === undefined || (await field.target.inputValue({ timeout: PRESS_MS })) !== '') return;
  const isNumber = (await field.target.getAttribute('type', { timeout: PRESS_MS })) === 'number';
  const value = isNumber
    ? await field.target.evaluate(numberToEnter, memory.refused.get(name) ?? 0, { timeout: PRESS_MS })
    : 'smoke test';
  if (isNumber) memory.numbered.add(name);
  narrate(step, `entering "${value}" for "${name}"`);
  await field.target.fill(value, { timeout: PRESS_MS });
}

/** {@link answerOneChoice}, given the time a pick's choices take to arrive from the game. */
async function answerWhenOffered(answering: Answering): Promise<string | undefined> {
  const started = Date.now();
  for (;;) {
    const pressed = await answerOneChoice(answering);
    if (pressed !== undefined || Date.now() - started > PRESS_MS) return pressed;
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
  await pressThePanels(frame, '.action-config .cancel-btn', 'Cancel', walk);
}

/**
 * Fills the open action one choice at a time until it resolves or closes, and gives up on it when
 * {@link answered} says to (#463): nothing to press, no change, a loop back to a state it showed, or
 * too many presses.
 */
async function finishOpenAction(frame: Frame, walk: SmokeWalk, memory: WalkMemory, name: string, step: number): Promise<void> {
  const answering: Answering = { frame, walk, memory, name, step, picked: new Set() };
  const where = `at step ${step}${memory.dealt === null ? '' : ` of the game dealt from seed "${memory.dealt}"`}`;
  const trail = startAnswering(name, where, await openActionState(frame));
  while ((await readOffers(frame, walk)).open === name) {
    const answer = await answerWhenOffered(answering);
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

/** Presses `control`, one of the board's or a dialog's, named `what`, saying so; counts it when the press lands. */
async function pressABoardControl(control: Control, what: string, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<void> {
  narrate(step, `pressing ${what}${control.keyboardOnly ? ' from the keyboard' : ''}`);
  if (await press(control, what, walk)) memory.controls++;
}

/** Presses one board control the walk has not pressed yet. Returns false when every one was pressed. */
async function pressAnUntriedControl(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  for (const control of await boardControls(frame)) {
    if (memory.pressed.has(control.key)) continue;
    memory.pressed.add(control.key);
    await pressABoardControl(control, `the board's "${nameOf(control)}"`, walk, memory, step);
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

/**
 * While a modal dialog is open, it is all a player can reach (#461): presses each of its controls
 * once for each time it opens, so a dialog opened again is closed again, then Escape, the key a modal
 * dialog closes on. A dialog still open after that is reported, and ends the walk: a player in it
 * has no way back to the game. Returns whether the walk goes on.
 */
async function answerTheDialog(
  frame: Frame,
  dialog: { name: string; target: Locator },
  walk: SmokeWalk,
  memory: WalkMemory,
  step: number,
): Promise<boolean> {
  if (!memory.inDialog) memory.dialogsOpened++;
  memory.inDialog = true;
  for (const control of (await controlsOf(frame, BOARD_CONTROLS, dialog.target)).filter((c) => c.enabled)) {
    const key = `dialog ${memory.dialogsOpened}: ${control.key}`;
    if (memory.pressed.has(key)) continue;
    memory.pressed.add(key);
    await pressABoardControl(control, `"${nameOf(control)}" in the dialog "${dialog.name}"`, walk, memory, step);
    return true;
  }
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

/**
 * An action not taken (or failed) yet, else a group of actions not opened yet, else the way back
 * out of a group, else the action taken least, preferring one that has neither ended the game nor
 * failed. Undefined when the panel offers nothing.
 */
function nextPress(offers: Offers, walk: SmokeWalk, memory: WalkMemory): NextPress {
  const untaken = offers.enabled.find((name) => !walk.taken.has(name) && !memory.failed.has(name));
  if (untaken) return { take: untaken };
  const group = offers.groups.find((label) => !memory.opened.has(label));
  if (group !== undefined) {
    memory.opened.add(group);
    return { press: `[data-bs-action-group=${JSON.stringify(group)}]`, what: `group "${group}"` };
  }
  if (offers.inGroup) return { press: '[data-bs-menu-back]', what: 'way back' };
  const byTimes = (a: string, b: string) => (memory.times.get(a) ?? 0) - (memory.times.get(b) ?? 0);
  const goesOn = offers.enabled.filter((name) => !endsTheGame(name, memory) && !memory.failed.has(name));
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

/** What the walk remembers from step to step, and from game to game, on one deal. */
interface WalkMemory {
  /** The controls tried, by key: the board's, and each dialog opening's. */
  readonly pressed: Set<string>;
  /** How many board and dialog control presses landed. */
  controls: number;
  /** The panel's action groups opened, by label. */
  readonly opened: Set<string>;
  /** How many times each action was pressed. */
  readonly times: Map<string, number>;
  /** How many times each action was taken and resolved. */
  readonly resolved: Map<string, number>;
  /** How many games ended right after each action resolved. */
  readonly endings: Map<string, number>;
  /** The actions that failed when taken: reported once, and not tried again while anything else is offered. */
  readonly failed: Set<string>;
  /** The action resolved last, which a game that is now over ended on. */
  lastResolved: string | undefined;
  /** How many games the walk has played on this deal, this one included. */
  games: number;
  /** The seed the spec dealt this walk from; null in a world, which `boardsmith dev` deals itself. */
  readonly seed: string | null;
  /** The seed the game being played was dealt from: `seed`, then `seed/2`, `seed/3`... for each new game. */
  dealt: string | null;
  /** Whether the last step found a modal dialog open (#461). */
  inDialog: boolean;
  /** How many times a modal dialog has opened, so each opening's controls are pressed afresh. */
  dialogsOpened: number;
  /** The actions the walk typed a number in on its last attempt at them (#466). */
  readonly numbered: Set<string>;
  /** How many numbers the game's own rules have refused in each action, so the walk types the next one up. */
  readonly refused: Map<string, number>;
  /** What the game said when it refused a number, which its error toasts repeat. */
  readonly refusals: Set<string>;
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
    dialogsOpened: 0,
    numbered: new Set(),
    refused: new Map(),
    refusals: new Set(),
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
    await pressThePanels(frame, `[data-bs-action=${JSON.stringify(next.take)}]`, `"${next.take}"`, walk);
    return true;
  }
  narrate(step, `opening the panel's ${next.what}`);
  await pressThePanels(frame, next.press, next.what, walk);
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
  const dialog = await openDialog(frame);
  if (dialog !== undefined) return answerTheDialog(frame, dialog, walk, memory, step);
  memory.inDialog = false;
  const offers = await readOffers(frame, walk);
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
