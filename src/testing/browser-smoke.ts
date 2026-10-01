/**
 * THE IN-BROWSER SMOKE TEST (#453), `boardsmith/testing/browser`.
 *
 * A game's `tests/browser/smoke.spec.ts` calls {@link defineSmokeTest} once. `boardsmith verify`
 * (and `boardsmith smoke`) serves the game with `boardsmith dev` from a fresh state and runs that
 * file in Chromium, where the walk:
 *
 *   1. opens the dev host and takes a seat, at a table or in a world, as a player's browser does;
 *   2. takes every action the action panel offers, following the panel's own offers so it keeps
 *      up with the game: it answers each choice the panel asks for, pressing the board's own
 *      candidate for a pick the board shows, and presses every other control on the board once;
 *   3. fails on any uncaught error in the page, any console error, any failed request to the dev
 *      host, and any offered action that then fails, and on an action the game offers that the
 *      spec does not list, or one it lists that the walk never took.
 *
 * A game with no actions yet lists none, and its walk still loads, seats a player and fails on
 * any error. Each chunk that adds an action adds its name to `actions`.
 *
 * This file runs under Playwright, never under vitest. `boardsmith verify` bundles the spec with
 * this module, so the game needs no Playwright of its own: it imports only this module.
 *
 * @module
 */
import { test, type Frame, type Locator, type Page } from '@playwright/test';
import { SMOKE_ANNOTATION, smokeProblems, type SmokeWalk } from './browser-smoke-verdict.js';

export interface SmokeTestOptions {
  /**
   * Every action a player can take in this game, by the name its rules give it. The walk must take
   * each one at least once, and fails on an action the game offers that is not listed here. The
   * chunk that adds an action adds its name here.
   */
  readonly actions: readonly string[];
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
    watchForErrors(page, walk);
    await recordResolvedActions(page);
    let controls = 0;
    try {
      await page.goto('/');
      await takeASeat(page);
      controls = await walkTheGame(page, walk, options.steps ?? DEFAULT_SMOKE_STEPS);
    } catch (error) {
      // Reported after the errors the page showed first, which usually say why the walk stopped.
      note(walk, `The walk could not go on: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
    test.info().annotations.push({ type: SMOKE_ANNOTATION, description: JSON.stringify({ taken: [...walk.taken].sort(), controls }) });
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
async function drainResolved(frame: Frame, walk: SmokeWalk): Promise<number> {
  const resolved = await frame.evaluate(() => {
    const log = (window as unknown as { __boardsmithSmokeResolved?: unknown[] }).__boardsmithSmokeResolved ?? [];
    return log.splice(0, log.length) as ResolvedAction[];
  });
  for (const { action, success, error } of resolved) {
    walk.offered.add(action);
    if (success) walk.taken.add(action);
    else walk.errors.push(`The panel offered "${action}", and taking it failed: ${error ?? 'no reason given'}`);
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
 * Presses `target` as a player would. A press the page does not take, because something covers
 * the control or it never becomes pressable, is reported and the walk goes on. Returns whether the
 * press landed.
 */
async function press(target: Locator, what: string, walk: SmokeWalk): Promise<boolean> {
  try {
    await target.click({ timeout: PRESS_MS });
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

/**
 * Answers one choice of the open action `name`, as a player would: the board's own candidate
 * first (so the board's controls are pressed, not only the panel's), then the panel's choices, a
 * value for a number or text field, and the button that finishes a step. Returns false when there
 * was nothing to answer.
 */
async function answerOneChoice(frame: Frame, walk: SmokeWalk, name: string): Promise<boolean> {
  const field = await firstPressable(frame, ['.action-config .text-input input', '.action-config .text-input textarea']);
  if (field && (await field.inputValue()) === '') await field.fill('smoke test');
  const box = await firstPressable(frame, ['.action-config .multi-select-choice input[type="checkbox"]:not(:checked)']);
  if (box && !(await frame.locator('.action-config .multi-select-choice input:checked').count())) await box.check();

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
async function answerWhenOffered(frame: Frame, walk: SmokeWalk, name: string): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    if (await answerOneChoice(frame, walk, name)) return true;
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
async function finishOpenAction(frame: Frame, walk: SmokeWalk, name: string): Promise<void> {
  let unchanged = 0;
  let before = await openActionState(frame);
  while ((await readOffers(frame, walk)).open === name) {
    const answered = await answerWhenOffered(frame, walk, name);
    await settle(frame);
    // Resolved: whatever is open now (the same action again on a later turn) is a later step's.
    if ((await drainResolved(frame, walk)) > 0) return;
    const after = await openActionState(frame);
    unchanged = after === before ? unchanged + 1 : 0;
    before = after;
    if (!answered || unchanged >= STUCK_AFTER) {
      walk.errors.push(
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
 * (an element that is only focusable by script, such as a card in a stack, is not one). Each is known by
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
async function pressAnUntriedControl(frame: Frame, walk: SmokeWalk, pressed: Set<string>, step: number): Promise<boolean> {
  for (const { key, label, control } of await boardControls(frame)) {
    if (pressed.has(key)) continue;
    pressed.add(key);
    narrate(step, `pressing the board's "${label}"`);
    await press(control, `the board's "${label}"`, walk);
    return true;
  }
  return false;
}

/** What the walk presses next when no action is open and every board control has been pressed. */
type NextPress = { press: string } | { take: string } | undefined;

/**
 * An action not taken yet, else a group of actions not opened yet, else the way back out of a
 * group, else the action taken least. Undefined when the panel offers nothing.
 */
function nextPress(offers: Offers, walk: SmokeWalk, times: Map<string, number>, opened: Set<string>): NextPress {
  const untaken = offers.enabled.find((name) => !walk.taken.has(name));
  if (untaken) return { take: untaken };
  const group = offers.groups.find((label) => !opened.has(label));
  if (group !== undefined) {
    opened.add(group);
    return { press: `[data-bs-action-group=${JSON.stringify(group)}]` };
  }
  if (offers.inGroup) return { press: '[data-bs-menu-back]' };
  const least = [...offers.enabled].sort((a, b) => (times.get(a) ?? 0) - (times.get(b) ?? 0))[0];
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

/** What the walk remembers from step to step. */
interface WalkMemory {
  /** The board controls pressed, by key. */
  readonly pressed: Set<string>;
  /** The panel's action groups opened, by label. */
  readonly opened: Set<string>;
  /** How many times each action was pressed. */
  readonly times: Map<string, number>;
}

/**
 * Presses what the panel offers next (see `nextPress`), after waiting for a turn when it offers
 * nothing. Returns false when it still offers nothing, which ends the walk.
 */
async function pressWhatThePanelOffers(frame: Frame, walk: SmokeWalk, memory: WalkMemory, offers: Offers, step: number): Promise<boolean> {
  const next = nextPress(offers, walk, memory.times, memory.opened);
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
 * One step of the walk: answer the open action, press an untried board control, or press what the
 * panel offers. Returns false when the walk is over: the game ended, or nothing is offered.
 */
async function walkOneStep(frame: Frame, walk: SmokeWalk, memory: WalkMemory, step: number): Promise<boolean> {
  await drainResolved(frame, walk);
  await noteErrorToasts(frame, walk);
  if (await frame.locator('.game-over-card').isVisible()) {
    narrate(step, 'the game is over');
    return false;
  }
  const offers = await readOffers(frame, walk);
  if (offers.open) {
    narrate(step, `answering "${offers.open}"`);
    await finishOpenAction(frame, walk, offers.open);
    return true;
  }
  if (await pressAnUntriedControl(frame, walk, memory.pressed, step)) return true;
  return pressWhatThePanelOffers(frame, walk, memory, offers, step);
}

/**
 * Walks the game a step at a time (`walkOneStep`) until the steps run out, the walk is over, or
 * every offer has been taken and a few more steps turned up nothing new. Returns how many board
 * controls it pressed.
 */
async function walkTheGame(page: Page, walk: SmokeWalk, steps: number): Promise<number> {
  const memory: WalkMemory = { pressed: new Set(), opened: new Set(), times: new Map() };
  let idle = 0;
  for (let step = 1; step <= steps && idle < IDLE_STEPS; step++) {
    // Looked up at every step: the dev host puts up a new frame when the game restarts.
    const frame = await gameFrame(page);
    await settle(frame);
    const seenBefore = walk.offered.size + memory.pressed.size;
    if (!(await walkOneStep(frame, walk, memory, step))) break;
    const nothingNew = walk.offered.size + memory.pressed.size === seenBefore;
    idle = nothingNew && [...walk.offered].every((name) => walk.taken.has(name)) ? idle + 1 : 0;
  }
  const frame = await gameFrame(page);
  await settle(frame);
  await drainResolved(frame, walk);
  await noteErrorToasts(frame, walk);
  // Errors the last press raised reach the page's listeners a moment after it; let them land.
  await page.waitForTimeout(250);
  return memory.pressed.size;
}

/** Says what the walk does at each step, for whoever watches `boardsmith smoke`. */
function narrate(step: number, what: string): void {
  console.log(`smoke step ${step}: ${what}`);
}
