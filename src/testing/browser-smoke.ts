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
 *      from the keyboard when the control takes no pointer by design;
 *   3. starts a new game when a game ends with listed actions still to take, and stops taking an
 *      action again once taking it has ended every game it was taken in;
 *   4. fails on any uncaught error in the page, any console error, any failed request to the dev
 *      host, and any offered action that then fails, and on an action the game offers that the
 *      spec does not list, or one it lists that the walk never took.
 *
 * A game with no actions yet lists none, and its walk still loads, seats a player and fails on
 * any error. Each chunk that adds an action adds its name to `actions`, and names it in
 * `unreachable` too, with the reason, when no walk from a fresh game can reach it.
 *
 * This file runs under Playwright, never under vitest. `boardsmith verify` bundles the spec with
 * this module, so the game needs no Playwright of its own: it imports only this module.
 *
 * @module
 */
import { test, type Frame, type Locator, type Page } from '@playwright/test';
import { requiredUntaken, SMOKE_ANNOTATION, smokeProblems, smokeRecord, type SmokeWalk } from './browser-smoke-verdict.js';

export interface SmokeTestOptions {
  /**
   * Every action a player can take in this game, by the name its rules give it. The walk must take
   * each one at least once, unless {@link unreachable} names it, and fails on an action the game
   * offers that is not listed here. The chunk that adds an action adds its name here.
   */
  readonly actions: readonly string[];
  /**
   * The listed actions no walk from a fresh game can reach, each with a sentence saying why: one
   * offered only in a position play does not get to, such as a draw by threefold repetition. The
   * walk does not require them, still takes one when it is offered, and fails if it fails. One it
   * takes anyway is reported, so the declaration can be removed. An action that ends the game, or
   * that needs another seat to act first, does not belong here: the walk starts a new game when a
   * game ends, and acts for every seat at a table.
   */
  readonly unreachable?: Readonly<Record<string, string>>;
  /** How many actions the walk takes at most. The default is {@link DEFAULT_SMOKE_STEPS}. */
  readonly steps?: number;
}

/** How many actions a walk takes at most, unless the spec asks for more. */
const DEFAULT_SMOKE_STEPS = 60;

/** The iframe path the table's dev host serves the game at, and the world's. */
const GAME_FRAME_PATHS = ['/__boardsmith-play', '/__boardsmith-world'];

/** How long the game gets to show its shell after the page opens: Vite prepares it on first load. */
const SHELL_WAIT_MS = 90_000;

/** How long the walk waits for the other seats (bots at a table) to hand it a turn. */
const TURN_WAIT_MS = 30_000;

/** How long one press gets before it counts as not pressable. */
const PRESS_MS = 5_000;

/** How many presses on one open action may leave it unchanged before the walk calls it stuck. */
const STUCK_AFTER = 3;

/** How many actions the walk goes on taking after it has seen nothing new, before it stops. */
const IDLE_STEPS = 5;

/**
 * Registers the smoke test for the game `boardsmith dev` serves at the configured base URL. Call it
 * once, at the top level of `tests/browser/smoke.spec.ts`.
 */
export function defineSmokeTest(options: SmokeTestOptions): void {
  test('seat a player, take every offered action, press every board control', async ({ page }) => {
    const walk = newWalk(options);
    const memory = newMemory();
    watchForErrors(page, walk);
    await recordResolvedActions(page);
    try {
      await page.goto('/');
      await takeASeat(page);
      await followTheActiveSeat(page);
      await walkTheGame(page, walk, memory);
    } catch (error) {
      // Reported after the errors the page showed first, which usually say why the walk stopped.
      note(walk, `The walk could not go on: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
    const record = smokeRecord(walk, { controls: memory.controls, games: memory.games });
    test.info().annotations.push({ type: SMOKE_ANNOTATION, description: JSON.stringify(record) });
    const problems = smokeProblems(walk);
    if (problems.length > 0) {
      throw new Error(
        `The smoke walk found ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:\n` +
          problems.map((p) => `  - ${p}`).join('\n'),
      );
    }
  });
}

function newWalk(options: SmokeTestOptions): SmokeWalk {
  return {
    listed: [...options.actions],
    unreachable: { ...options.unreachable },
    offered: new Set(),
    taken: new Set(),
    steps: options.steps ?? DEFAULT_SMOKE_STEPS,
    errors: [],
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
    if (success) {
      walk.taken.add(action);
      memory.resolved.set(action, (memory.resolved.get(action) ?? 0) + 1);
      memory.lastResolved = action;
    } else {
      walk.errors.push(`The panel offered "${action}", and taking it failed: ${error ?? 'no reason given'}`);
    }
  }
  return resolved.length;
}

/** Reports each error toast the game shows a player, once. */
async function noteErrorToasts(frame: Frame, walk: SmokeWalk): Promise<void> {
  for (const text of await frame.locator('.toast.error').allInnerTexts()) note(walk, `The game showed an error: ${text.trim()}`);
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
  if (await lobbySeat.isVisible()) await lobbySeat.click();
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
  if ((await switcher.count()) === 0 || (await switcher.getAttribute('data-following')) === 'true') return;
  await switcher.click({ timeout: PRESS_MS });
  await page.getByTestId('follow-active-seat').click({ timeout: PRESS_MS });
  await page.locator('[data-testid="seat-switcher"][data-following="true"]').waitFor({ timeout: TURN_WAIT_MS }).catch(() => {
    throw new Error(
      `The dev host did not follow the active seat ${TURN_WAIT_MS / 1000}s after "Follow active seat" was pressed. ` +
        'Run `boardsmith dev` and press it to see why.',
    );
  });
}

/**
 * Starts a new game from the dev host's "New game" (pressed twice: once to arm it, once to confirm),
 * waits for the game-over card to go, and follows the active seat again, which a restart turns off.
 * Returns false when the dev host has no "New game", as a world's has not.
 */
async function startANewGame(page: Page): Promise<boolean> {
  const newGame = page.getByTestId('new-game').filter({ visible: true }).first();
  if ((await newGame.count()) === 0) return false;
  await newGame.click({ timeout: PRESS_MS });
  await newGame.click({ timeout: PRESS_MS });
  await (await gameFrame(page)).locator('.game-over-card').waitFor({ state: 'hidden', timeout: TURN_WAIT_MS }).catch(() => {
    throw new Error(`The game was still over ${TURN_WAIT_MS / 1000}s after "New game" was confirmed.`);
  });
  await followTheActiveSeat(page);
  return true;
}

// -------------------------------------------------------------------------------------------
// The walk
// -------------------------------------------------------------------------------------------

/** Waits until the panel has its offers, and the page has painted what the last press changed. */
async function settle(frame: Frame): Promise<void> {
  await frame.locator('[data-testid="bs-actions-pending"]').waitFor({ state: 'detached', timeout: TURN_WAIT_MS }).catch(() => {
    throw new Error(`The panel was still loading its actions after ${TURN_WAIT_MS / 1000}s.`);
  });
  await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
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
  return { enabled: offers.enabled, groups: offers.groups, inGroup: offers.inGroup, open: offers.open };
}

/** The first of `candidates` that is on the page and can be pressed, or undefined. */
async function firstPressable(frame: Frame, selectors: readonly string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const found = frame.locator(selector).filter({ visible: true });
    const count = await found.count();
    for (let i = 0; i < count; i++) {
      const candidate = found.nth(i);
      if ((await candidate.getAttribute('aria-disabled')) !== 'true' && (await candidate.isEnabled())) return candidate;
    }
  }
  return undefined;
}

/** How a control reads to a person: its label, else its text. */
async function labelOf(target: Locator): Promise<string> {
  const label = (await target.getAttribute('aria-label')) ?? (await target.getAttribute('title')) ?? (await target.innerText());
  return label.replace(/\s+/g, ' ').trim();
}

/**
 * Whether `target` takes no pointer by design (`pointer-events: none`), as a keyboard board laid
 * invisibly over a canvas for keyboard and screen-reader players does. Its players press it from
 * the keyboard, so the walk does too.
 */
async function takesNoPointer(target: Locator): Promise<boolean> {
  return target.evaluate((element) => getComputedStyle(element).pointerEvents === 'none', undefined, { timeout: PRESS_MS });
}

/**
 * Presses `target` as a player would: with the pointer, or, for a control that takes no pointer by
 * design, by focusing it and pressing Enter. A press the page does not take, because something
 * covers the control or it never becomes pressable, is reported and the walk goes on. Returns
 * whether the press landed.
 */
async function press(target: Locator, what: string, walk: SmokeWalk): Promise<boolean> {
  try {
    if (await takesNoPointer(target)) await target.press('Enter', { timeout: PRESS_MS });
    else await target.click({ timeout: PRESS_MS });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const why = /intercepts pointer events/.test(message)
      ? 'another element covers it, so a pointer cannot reach it'
      : message.split('\n')[0];
    note(walk, `Pressing ${what} did not work: ${why}.`);
    return false;
  }
}

/** Records a problem once. */
function note(walk: SmokeWalk, problem: string): void {
  if (!walk.errors.includes(problem)) walk.errors.push(problem);
}

/** A board candidate of the open pick that this pick has not chosen yet, recorded in `picked`. */
async function unpickedCandidate(frame: Frame, picked: Set<string>): Promise<Locator | undefined> {
  const candidates = frame.locator('[data-testid="bs-board"] [data-bs-candidate]').filter({ visible: true });
  for (let i = 0; i < (await candidates.count()); i++) {
    const candidate = candidates.nth(i);
    const key = (await candidate.getAttribute('data-bs-el-id')) ?? (await candidate.getAttribute('data-bs-candidate')) ?? '';
    if (picked.has(key) || (await candidate.getAttribute('aria-disabled')) === 'true') continue;
    picked.add(key);
    return candidate;
  }
  return undefined;
}

/**
 * Answers one step of an open multi-select pick (#459), as a player makes one: one more distinct
 * choice (an unticked box in the panel, else a board candidate the pick has not chosen) until the
 * pick has at least one and its Done button is ready, then Done. The pick's own min and max decide
 * through the panel: Done is ready from min on, every box left is refused at max, and a pick whose
 * min is its max has no Done at all and completes on its last choice. `picked` is the board
 * candidates this pick has chosen, since the board does not mark them.
 */
async function answerMultiSelect(frame: Frame, walk: SmokeWalk, name: string, picked: Set<string>): Promise<boolean> {
  const boxes = frame.locator('.action-config .multi-select-choice input[type="checkbox"]');
  const inPanel = (await boxes.count()) > 0;
  const chosen = inPanel ? await frame.locator('.action-config .multi-select-choice input:checked').count() : picked.size;
  const done = await firstPressable(frame, ['.action-config .done-button']);
  const next =
    done !== undefined && chosen > 0
      ? done
      : ((inPanel
          ? await firstPressable(frame, ['.action-config .multi-select-choice input[type="checkbox"]:not(:checked)'])
          : await unpickedCandidate(frame, picked)) ?? done);
  if (next === undefined) return false;
  await press(next, `"${await labelOf(next)}" while answering "${name}"`, walk);
  return true;
}

/**
 * Answers one choice of the open action `name`, as a player would: a multi-select pick one choice
 * at a time, else the board's own candidate first (so the board's controls are pressed, not only
 * the panel's), then the panel's choices, a value for a number or text field, and the button that
 * finishes a step. Returns false when there was nothing to answer.
 */
async function answerOneChoice(frame: Frame, walk: SmokeWalk, name: string, picked: Set<string>): Promise<boolean> {
  const field = await firstPressable(frame, ['.action-config .text-input input', '.action-config .text-input textarea']);
  if (field && (await field.inputValue()) === '') await field.fill('smoke test');
  // An ordered list shows a count too, and is answered by its Add buttons below.
  const multiSelect = frame.locator('.action-config .multi-select-count:not(.ordered-list-count)');
  if ((await multiSelect.count()) > 0) return answerMultiSelect(frame, walk, name, picked);

  const target = await firstPressable(frame, [
    '.action-config [data-bs-confirm]',
    '[data-testid="bs-board"] [data-bs-candidate]',
    '.action-config .board-handoff-btn',
    '.action-config .choice-btn',
    '.action-config .ordered-list-add',
    '.action-config .done-button',
    '.action-config .skip-btn',
  ]);
  if (target === undefined) return false;
  await press(target, `"${await labelOf(target)}" while answering "${name}"`, walk);
  return true;
}

/** {@link answerOneChoice}, given the time a pick's choices take to arrive from the game. */
async function answerWhenOffered(frame: Frame, walk: SmokeWalk, name: string, picked: Set<string>): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    if (await answerOneChoice(frame, walk, name, picked)) return true;
    if (Date.now() - started > PRESS_MS) return false;
    await frame.waitForTimeout(100);
  }
}

/** The open action's panel, as text, to tell whether a press changed anything. */
async function openActionState(frame: Frame): Promise<string> {
  return frame.locator('.action-config').innerText().catch(() => '');
}

/**
 * Fills the open action one choice at a time until it resolves or closes. An action whose panel
 * offers nothing to choose, or does not change when its choices are pressed, is reported and
 * cancelled.
 */
async function finishOpenAction(frame: Frame, walk: SmokeWalk, memory: WalkMemory, name: string): Promise<void> {
  const picked = new Set<string>();
  let unchanged = 0;
  let before = await openActionState(frame);
  while ((await readOffers(frame, walk)).open === name) {
    const answered = await answerWhenOffered(frame, walk, name, picked);
    await settle(frame);
    // Resolved: whatever is open now (the same action again on a later turn) is a later step's.
    if ((await drainResolved(frame, walk, memory)) > 0) return;
    const after = await openActionState(frame);
    unchanged = after === before ? unchanged + 1 : 0;
    before = after;
    if (!answered || unchanged >= STUCK_AFTER) {
      note(
        walk,
        answered
          ? `The panel opened "${name}", and pressing its choices changed nothing: ${after.replace(/\s+/g, ' ').trim()}`
          : `The panel opened "${name}" and offered nothing to choose or press: ${after.replace(/\s+/g, ' ').trim()}`,
      );
      await frame.locator('.action-config .cancel-btn').click({ timeout: PRESS_MS }).catch(() => undefined);
      return;
    }
  }
}

/**
 * The board's own controls: every button on it a keyboard can reach, other than a pick's candidate
 * (an element that is only focusable by script, such as a card in a stack, is not one). That
 * includes a control only a keyboard can reach, invisible and taking no pointer, which `press`
 * presses from the keyboard (#457). Each is known by
 * the game element it stands for when it has one, since its label can change with the game
 * ("deck, 30 cards"), else by its label.
 */
async function boardControls(frame: Frame): Promise<Array<{ key: string; label: string; control: Locator }>> {
  const controls = frame
    .locator('[data-testid="bs-board"] :is(button, [role="button"]):not([data-bs-candidate]):not([tabindex="-1"])')
    .filter({ visible: true });
  const found: Array<{ key: string; label: string; control: Locator }> = [];
  for (let i = 0; i < (await controls.count()); i++) {
    const control = controls.nth(i);
    const label =
      (await control.getAttribute('aria-label')) ?? (await control.getAttribute('title')) ?? (await control.innerText()).trim();
    const element = await control.getAttribute('data-bs-el-id');
    const key = element === null ? `label:${label}` : `element:${element}`;
    if ((await control.getAttribute('aria-disabled')) !== 'true' && (await control.isEnabled())) found.push({ key, label, control });
  }
  return found;
}

/** Presses one board control the walk has not pressed yet. Returns false when every one was pressed. */
async function pressAnUntriedControl(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  for (const { key, label, control } of await boardControls(frame)) {
    if (memory.pressed.has(key)) continue;
    memory.pressed.add(key);
    narrate(step, `pressing the board's "${label}"${(await takesNoPointer(control)) ? ' from the keyboard' : ''}`);
    if (await press(control, `the board's "${label}"`, walk)) memory.controls++;
    return true;
  }
  return false;
}

/** What the walk presses next when no action is open and every board control has been pressed. */
type NextPress = { press: string } | { take: string } | undefined;

/**
 * Whether taking `name` has ended every game it was taken in, as resigning does. The walk takes
 * such an action again only when the panel offers nothing else, so it does not cut each game short.
 */
function endsTheGame(name: string, memory: WalkMemory): boolean {
  const ended = memory.endings.get(name) ?? 0;
  return ended > 0 && ended >= (memory.resolved.get(name) ?? 0);
}

/**
 * An action not taken yet, else a group of actions not opened yet, else the way back out of a
 * group, else the action taken least, preferring one that has not ended the game. Undefined when
 * the panel offers nothing.
 */
function nextPress(offers: Offers, walk: SmokeWalk, memory: WalkMemory): NextPress {
  const untaken = offers.enabled.find((name) => !walk.taken.has(name));
  if (untaken) return { take: untaken };
  const group = offers.groups.find((label) => !memory.opened.has(label));
  if (group !== undefined) {
    memory.opened.add(group);
    return { press: `[data-bs-action-group=${JSON.stringify(group)}]` };
  }
  if (offers.inGroup) return { press: '[data-bs-menu-back]' };
  const byTimes = (a: string, b: string) => (memory.times.get(a) ?? 0) - (memory.times.get(b) ?? 0);
  const goesOn = offers.enabled.filter((name) => !endsTheGame(name, memory));
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

/** What the walk remembers from step to step, and from game to game. */
interface WalkMemory {
  /** The board controls tried, by key. */
  readonly pressed: Set<string>;
  /** How many board-control presses landed. */
  controls: number;
  /** The panel's action groups opened, by label. */
  readonly opened: Set<string>;
  /** How many times each action was pressed. */
  readonly times: Map<string, number>;
  /** How many times each action was taken and resolved. */
  readonly resolved: Map<string, number>;
  /** How many games ended right after each action resolved. */
  readonly endings: Map<string, number>;
  /** The action resolved last, which a game that is now over ended on. */
  lastResolved: string | undefined;
  /** How many games the walk has played, this one included. */
  games: number;
}

function newMemory(): WalkMemory {
  return {
    pressed: new Set(),
    controls: 0,
    opened: new Set(),
    times: new Map(),
    resolved: new Map(),
    endings: new Map(),
    lastResolved: undefined,
    games: 1,
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
    return waitForATurn(frame);
  }
  if ('take' in next) {
    memory.times.set(next.take, (memory.times.get(next.take) ?? 0) + 1);
    narrate(step, `taking "${next.take}"`);
    await press(frame.locator(`[data-bs-action=${JSON.stringify(next.take)}]`).first(), `the panel's "${next.take}"`, walk);
    return true;
  }
  narrate(step, `opening ${next.press}`);
  await press(frame.locator(next.press).first(), `the panel's ${next.press}`, walk);
  return true;
}

/**
 * The game is over. Credits the action it ended on, then starts a new game when listed actions are
 * still to take. Returns false when the walk is over: everything required is taken, or the dev host
 * cannot start a new game.
 */
async function afterTheGame(page: Page, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  if (memory.lastResolved !== undefined) memory.endings.set(memory.lastResolved, (memory.endings.get(memory.lastResolved) ?? 0) + 1);
  memory.lastResolved = undefined;
  const left = requiredUntaken(walk);
  if (left.length === 0) {
    narrate(step, 'the game is over');
    return false;
  }
  narrate(step, `the game is over with ${left.map((name) => `"${name}"`).join(', ')} still to take; starting a new game`);
  if (!(await startANewGame(page))) return false;
  memory.games++;
  return true;
}

/**
 * One step of the walk: start a new game after one that ended, press an untried board control,
 * answer the open action, or press what the panel offers. A board control comes before the open
 * action because a player can press the board while a pick is open, and because the walk acts for
 * every seat at a table, where a game that opens each turn's action by itself never has a moment
 * with nothing open.
 */
async function walkOneStep(page: Page, frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  await drainResolved(frame, walk, memory);
  await noteErrorToasts(frame, walk);
  if (await frame.locator('.game-over-card').isVisible()) return afterTheGame(page, walk, memory, step);
  const offers = await readOffers(frame, walk);
  if (await pressAnUntriedControl(frame, walk, memory, step)) return true;
  if (offers.open) {
    narrate(step, `answering "${offers.open}"`);
    await finishOpenAction(frame, walk, memory, offers.open);
    return true;
  }
  return pressWhatThePanelOffers(frame, walk, memory, offers, step);
}

/**
 * Walks the game a step at a time (`walkOneStep`) until the steps run out, the walk is over, or
 * every required action and every offer has been taken and a few more steps turned up nothing new.
 */
async function walkTheGame(page: Page, walk: SmokeWalk, memory: WalkMemory): Promise<void> {
  let idle = 0;
  for (let step = 1; step <= walk.steps && idle < IDLE_STEPS; step++) {
    // Looked up at every step: the dev host puts up a new frame when the game restarts.
    const frame = await gameFrame(page);
    await settle(frame);
    const seenBefore = walk.offered.size + memory.pressed.size;
    if (!(await walkOneStep(page, frame, walk, memory, step))) break;
    const nothingNew = walk.offered.size + memory.pressed.size === seenBefore;
    const allTaken = requiredUntaken(walk).length === 0 && [...walk.offered].every((name) => walk.taken.has(name));
    idle = nothingNew && allTaken ? idle + 1 : 0;
  }
  const frame = await gameFrame(page);
  await settle(frame);
  await drainResolved(frame, walk, memory);
  await noteErrorToasts(frame, walk);
  // Errors the last press raised reach the page's listeners a moment after it; let them land.
  await page.waitForTimeout(250);
}

/** Says what the walk does at each step, for whoever watches `boardsmith smoke`. */
function narrate(step: number, what: string): void {
  console.log(`smoke step ${step}: ${what}`);
}
