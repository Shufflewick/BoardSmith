// @vitest-environment jsdom
/**
 * DOM-leak test utility for hidden info (VIS-03).
 *
 * Renders a game's AutoUI headlessly as a given seat and fails when a hidden
 * element's identity (rank/suit/face-image, or any custom attribute) leaks
 * into the rendered markup.
 *
 * Forbidden markers are derived by diffing each element's FULL unfiltered
 * `el.toJSON()` identity against what actually SURVIVES into seat N's FINAL
 * per-seat tree (`game.toJSONForPlayer(seat)`, post-`playerView`,
 * game.ts:2671-2819) — never from a hardcoded field list ('rank'/'suit'/...)
 * and never by trusting the engine's own redaction allowlist
 * (`redactHiddenElementAttrs`'s `SAFE_LAYOUT_KEYS`) as ground truth. This
 * closes two blind spots:
 *   1. Unknown/custom per-game attribute names are covered (not just a fixed
 *      identity-field list).
 *   2. Content a game's `static playerView` hook strips AFTER the engine's
 *      own visibility filter is still treated as forbidden — the matcher
 *      never trusts `isVisibleTo` alone (see `visibility.ts`, VIS-01).
 *
 * @module
 */

import type { Component } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import type { default as AutoUIComponent } from '../ui/components/auto-ui/AutoUI.vue';
import type { GameViewElement as UIGameElement } from '../ui/components/auto-ui/index.js';
import type { ElementJSON } from '../engine/index.js';
import { HIDDEN_PLACEHOLDER_ATTRIBUTE, isHiddenPlaceholder } from '../engine/element/hidden-placeholder.js';
import type { BoardInteraction } from '../ui/composables/useBoardInteraction.js';
import type { TableSeat } from '../ui/composables/useTableSeat.js';
import type { WorldSeatHost } from '../ui/world/useWorldHost.js';
import type { WorldSeat } from '../ui/world/useWorldSeat.js';
import type { UseActionControllerReturn } from '../ui/composables/useActionControllerTypes.js';
import type { GameState } from '../client/types.js';
import type { PlayerGameState } from '../session/types.js';
import { buildPlayerState } from '../session/utils.js';
import { PickHandler } from '../session/pick-handler.js';
import { WorldRefusal } from '../world/index.js';
import { messageOf } from '../world/host/index.js';
import { TestGame } from './test-game.js';
import { TestWorld, type WorldSeatView } from './test-world.js';
import { importProjectTestUtils } from '#testing/project-test-utils';

/**
 * WHAT THIS GATE CAN BE AIMED AT: a table, or a persistent world.
 *
 * `createTestGame` and `createTestWorld` both answer it, and both are the real
 * thing rather than a stand-in -- a `TestGame`'s projection is the one the
 * snapshot runner sends a client, and a `TestWorld`'s is the one a world host
 * sends a browser, assembled by the host core itself (#262).
 *
 * The two members are the two halves of the diff this gate performs: what the
 * game or world HOLDS, against what this seat is actually SENT. Nothing here
 * names an identity field, which is what keeps the scan honest as a game's
 * state changes shape.
 */
export interface HiddenInfoSubject {
  /**
   * What this seat is sent -- the same payload a real client receives.
   * `state` is the redacted per-seat tree, which the scan diffs and mounts.
   */
  getPlayerView(seat: number): SeatProjection | Promise<SeatProjection>;
  /**
   * EVERY ELEMENT THIS GAME OR WORLD HOLDS, UNREDACTED.
   *
   * The ground truth a seat's frame is diffed against. A table reads it off its
   * live tree; a world reads it out of its store, because a world is resident
   * one partition at a time and there is no moment at which an engine holds all
   * of it.
   */
  unredactedElements(): readonly ElementJSON[] | Promise<readonly ElementJSON[]>;
}

/**
 * One seat's frame, in the shape both subjects answer: the redacted per-seat
 * tree. Everything else a board is given comes from the subject itself --
 * `renderAsSeat` mounts a table seat as GameShell does (#390, #406) and a world
 * seat as WorldShell does (#413).
 */
export interface SeatProjection {
  /** The redacted per-seat element tree. */
  readonly state: unknown;
}

/**
 * The shape `renderAsSeat`/`assertNoHiddenInfoLeak`'s `gameViewOverride` (and
 * the AutoUI `gameView` prop) accept — structurally identical to
 * `ElementJSON` (id/className/attributes/children/childCount/name; a hidden
 * placeholder is marked by `attributes.__hidden`, read with
 * isHiddenPlaceholder). Exported so callers constructing a
 * deliberately-leaky override (e.g. `game.toJSON()`, or a mutated
 * `getPlayerView(seat).state`) have a name for the cast instead of reaching
 * for `any`.
 */
export type HiddenInfoGameView = UIGameElement;

// ---------------------------------------------------------------------------
// THE BROWSER APIS JSDOM OMITS, supplied as a browser would answer them here.
// They do not stub or alter any BoardSmith behavior.
//
// `window.matchMedia`: `reducedMotion.ts` reads it (`prefersReducedMotion`
// top-level ref) on first read, and it is pulled in transitively by
// AutoRenderer's `useFlyingElements()` call. Importing no longer throws without
// it, but a real mount of `AutoUI` (no stubs; we need the actual renderers to
// exercise the real leak surface) still reads it, so it is installed before
// `AutoUI.vue`'s module graph is evaluated. A static `import AutoUI from '...'`
// at the top of this file would be hoisted and evaluated before ANY of this
// file's own code runs (ESM import ordering), which is too late. So `AutoUI` is
// loaded via a runtime dynamic `import()` (see `loadAutoUI`).
//
// `ResizeObserver` (#404): a board that sizes itself from its own element
// observes it once mounted, and every browser has one. jsdom lays nothing out,
// so no element ever changes size, and an observer that never reports is
// exactly what a browser would report for it.
// ---------------------------------------------------------------------------
function ensureBrowserApis(): void {
  if (typeof window === 'undefined') return;
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (typeof globalThis.ResizeObserver !== 'function') {
    class UnchangingSizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    globalThis.ResizeObserver = UnchangingSizeObserver as unknown as typeof ResizeObserver;
    window.ResizeObserver = globalThis.ResizeObserver;
  }
}

let autoUIComponentPromise: Promise<typeof AutoUIComponent> | undefined;

/** Supply the browser APIs jsdom omits, then dynamically import AutoUI (cached). */
function loadAutoUI(): Promise<typeof AutoUIComponent> {
  if (!autoUIComponentPromise) {
    ensureBrowserApis();
    autoUIComponentPromise = import('../ui/components/auto-ui/AutoUI.vue').then(
      (mod) => mod.default,
    );
  }
  return autoUIComponentPromise;
}

let boardInteractionModulePromise:
  | Promise<typeof import('../ui/composables/useBoardInteraction.js')>
  | undefined;

/**
 * Dynamically import the board-interaction module (cached).
 *
 * Deferred for the same reason as `loadAutoUI`/`loadMount`: it pulls in Vue,
 * and a static import here would make every consumer of the
 * `boardsmith/testing` barrel resolve Vue whether or not it ever renders.
 */
function loadBoardInteractionModule(): Promise<
  typeof import('../ui/composables/useBoardInteraction.js')
> {
  if (!boardInteractionModulePromise) {
    boardInteractionModulePromise = import('../ui/composables/useBoardInteraction.js');
  }
  return boardInteractionModulePromise;
}

let tableSeatModulesPromise:
  | Promise<[typeof import('../ui/composables/useTableSeat.js'), typeof import('../ui/composables/useTurnDeadline.js')]>
  | undefined;

/** Dynamically import the seat wiring GameShell uses (cached); deferred like `loadBoardInteractionModule`. */
function loadTableSeatModules(): Promise<
  [typeof import('../ui/composables/useTableSeat.js'), typeof import('../ui/composables/useTurnDeadline.js')]
> {
  tableSeatModulesPromise ??= Promise.all([
    import('../ui/composables/useTableSeat.js'),
    import('../ui/composables/useTurnDeadline.js'),
  ]);
  return tableSeatModulesPromise;
}

// ---------------------------------------------------------------------------
// THE PROJECT'S OWN `@vue/test-utils`, NEVER THIS PACKAGE'S (#389).
//
// A game installs `boardsmith` as a symlink to a checkout, and the checkout
// carries its own devDependencies, `vue` and `@vue/test-utils` among them. The
// game's `resolve.dedupe: ['vue']` points every `import 'vue'` -- its
// components' and BoardSmith's UI source alike -- at the game's copy, but it
// cannot reach a bare `import('@vue/test-utils')` written here: vitest hands a
// package in `node_modules` to Node, and Node resolves it from this file's real
// location, the checkout, whose `@vue/test-utils` loads the checkout's `vue`.
// The board then rendered on one Vue runtime while its computeds ran on the
// other, so `setProps` changed nothing on screen.
//
// So it is resolved from the project the tests run in (vitest's working
// directory, the root its config resolves `dedupe` against), exactly as the
// project's own test files resolve it, and it then loads the project's `vue`.
// It is loaded on first use, never at import time, so a consumer of the
// `boardsmith/testing` barrel that never renders needs no `@vue/test-utils`
// installed at all (MERC has none). The resolving takes Node, so it lives in
// `project-test-utils.node.ts`, which a game's compiler never sees (#411).
// ---------------------------------------------------------------------------
let mountFnPromise: Promise<typeof import('@vue/test-utils').mount> | undefined;

/** The project's `@vue/test-utils` `mount`, checked to share BoardSmith's Vue (cached). */
function loadMount(): Promise<typeof import('@vue/test-utils').mount> {
  mountFnPromise ??= loadProjectMount();
  return mountFnPromise;
}

async function loadProjectMount(): Promise<typeof import('@vue/test-utils').mount> {
  const { mount } = await importProjectTestUtils();
  await requireOneVue(mount);
  return mount;
}

/**
 * Refuse to render when the project's `@vue/test-utils` and BoardSmith's UI
 * run on two copies of Vue.
 *
 * `import('vue')` here resolves the way BoardSmith's UI source does in this
 * project, so it is the Vue the board interaction, the action controller and
 * (with the scaffold's dedupe) the game's own components use. A mount on any
 * other copy renders once and then never updates, which is the silent failure
 * of #389. The check is a render, because that is the one thing the two copies
 * do not share: Vue deliberately shares the current component instance across
 * copies, so `getCurrentInstance()` cannot tell them apart.
 */
async function requireOneVue(mount: typeof import('@vue/test-utils').mount): Promise<void> {
  const { h, ref } = await import('vue');
  const shown = ref('before');
  const probe = mount({ render: () => h('i', shown.value) });
  shown.value = 'after';
  await probe.vm.$nextTick();
  const oneVue = probe.text() === 'after';
  probe.unmount();
  if (oneVue) return;
  throw new Error(
    "renderAsSeat found two copies of Vue in this test run: BoardSmith's UI uses one and your project's " +
      '@vue/test-utils loads another, so a board would render once and then never update. ' +
      "Make every import of 'vue' resolve to your project's one copy: keep `resolve: { dedupe: ['vue'] }` " +
      'in the vite config your vitest config uses (the one `boardsmith init` writes has it), and do not ' +
      'alias `vue` to another build of it. Then run the tests again.',
  );
}

/** Every entry point that renders needs jsdom; say so rather than fail inside Vue. */
function requireDom(): void {
  if (typeof document === 'undefined') {
    throw new Error(
      'renderAsSeat/assertNoHiddenInfoLeak require a DOM environment. ' +
        'Add `// @vitest-environment jsdom` as the first line of this test file.',
    );
  }
}

let worldSeatModulePromise: Promise<typeof import('../ui/world/useWorldSeat.js')> | undefined;

/** Dynamically import the seat wiring WorldShell uses (cached); deferred like `loadBoardInteractionModule`. */
function loadWorldSeatModule(): Promise<typeof import('../ui/world/useWorldSeat.js')> {
  worldSeatModulePromise ??= import('../ui/world/useWorldSeat.js');
  return worldSeatModulePromise;
}

/** A table's shell or a world's: what a stub stands in for, and what its refusals name. */
type ShellKind = 'table' | 'world';

const SHELL_NAME: Record<ShellKind, string> = { table: 'GameShell', world: 'WorldShell' };

let shellProvidedKeysPromise: Promise<Record<ShellKind, ReadonlySet<symbol>>> | undefined;

/**
 * THE KEYS EACH SHELL PROVIDES THE BOARD IT MOUNTS (#453), read from the same
 * key constants `useTableSeat` and `useWorldSeat` publish under.
 *
 * A stub needs its own shell's keys, which it has from the seat it built, and
 * the other shell's, to refuse a key only the other one provides. The parity
 * tests (`dom-leak-shell-context.test.ts`, `dom-leak-world-context.test.ts`)
 * hold both lists equal to what the real GameShell and WorldShell are probed
 * to provide, so a key added to a shell fails there until it is added here.
 * Loaded when first asked for, like the seat wiring, so a test that never
 * renders never loads Vue.
 */
export function shellProvidedKeys(): Promise<Record<ShellKind, ReadonlySet<symbol>>> {
  shellProvidedKeysPromise ??= Promise.all([
    loadBoardInteractionModule(),
    import('../ui/composables/useGameContext.js'),
    import('../ui/composables/useAnimationEvents.js'),
    import('../ui/composables/useAnnouncer.js'),
    import('../ui/composables/useGameOverReveal.js'),
    import('../ui/world/useWorld.js'),
  ]).then(([interaction, context, animation, announcer, gameOver, world]) => {
    const key = (k: unknown) => k as symbol;
    const allContext = Object.values(context.GAME_CONTEXT_KEYS).map(key);
    const playContext = context.PLAY_CONTEXT_KEY_NAMES.map((name) => key(context.GAME_CONTEXT_KEYS[name]));
    return {
      table: new Set([
        key(interaction.BOARD_INTERACTION_KEY),
        key(animation.ANIMATION_EVENTS_KEY),
        key(announcer.ANNOUNCER_KEY),
        key(gameOver.GAME_OVER_HOLDS_KEY),
        ...allContext,
      ]),
      world: new Set([key(interaction.BOARD_INTERACTION_KEY), ...playContext, key(world.WORLD_CONTEXT_KEY)]),
    };
  });
  return shellProvidedKeysPromise;
}

/** Why a stub for `kind` will not provide `key`, which only the other shell provides. */
function keyTheShellLacks(kind: ShellKind, caller: string, key: string): string {
  const shell = SHELL_NAME[kind];
  const where = kind === 'world' ? 'in a real world' : 'at a real table';
  const instead =
    kind === 'world'
      ? "A world's board reads the world with useWorld() and the play context with usePlayContext(); " +
        'useGameContext() reads a table\'s whole context and throws in a world.'
      : "If this board belongs to a world, stub a world's shell with worldShellContext (or renderAsSeat with the TestWorld).";
  return (
    `${caller} was asked to provide ${key}, which ${shell} never provides, so a board that reads it would ` +
    `pass this test and throw ${where}. ${instead} Remove ${key} from provide.`
  );
}

/** Refuses any key in `provide` that the other shell provides and `kind`'s does not. */
async function refuseKeysTheShellLacks(kind: ShellKind, provide: Record<string | symbol, unknown>, caller: string): Promise<void> {
  const keys = await shellProvidedKeys();
  const other: ShellKind = kind === 'table' ? 'world' : 'table';
  for (const key of Object.getOwnPropertySymbols(provide)) {
    if (keys[other].has(key) && !keys[kind].has(key)) {
      throw new Error(keyTheShellLacks(kind, caller, key.description ?? key.toString()));
    }
  }
}

let seatRendererPromise: Promise<void> | undefined;

/**
 * Load everything `renderAsSeat` and `assertNoHiddenInfoLeak` render with:
 * your project's `@vue/test-utils`, AutoUI's module graph, the
 * board-interaction module and the table and world seat wiring.
 *
 * Call it with a top-level `await` in a test file that renders:
 *
 * ```ts
 * await preloadSeatRenderer();
 * ```
 *
 * Loading AutoUI compiles and evaluates its Vue components the first time, and
 * that is by far the slowest part of a render: seconds on a busy machine,
 * against a render of a few milliseconds (#354). Without this call the first
 * test in the file pays it inside its own timeout. At the top level it runs
 * while Vitest collects the file, where no test timeout applies. It loads once
 * per test file, and every later call returns the same promise.
 *
 * @throws Outside a jsdom test environment, with the same message a render gives.
 *   The promise rejects when the project has no `@vue/test-utils` installed, or
 *   when it and BoardSmith's UI run on two copies of Vue; each message says what
 *   to change.
 */
export function preloadSeatRenderer(): Promise<void> {
  requireDom();
  seatRendererPromise ??= Promise.all([
    loadMount(),
    loadAutoUI(),
    loadBoardInteractionModule(),
    loadTableSeatModules(),
    loadWorldSeatModule(),
    shellProvidedKeys(),
  ]).then(() => undefined);
  return seatRendererPromise;
}

/**
 * What to render for a seat. `component` is the seam that lets this utility
 * check a game's OWN board instead of AutoUI — see {@link renderAsSeat}.
 */
/**
 * The instance type of the component `renderAsSeat` mounted.
 *
 * A game passing its own board gets a wrapper over THAT board -- so
 * `wrapper.props('actionController')` names a prop the board declares. Before
 * this the return type was hard-wired to AutoUI's instance no matter what was
 * mounted, which made every custom-board caller's `props()` call a type error
 * the moment its tests were type-checked (ShufflewickPub #260).
 */
type RenderedInstance<C> = C extends abstract new (...args: never[]) => infer I ? I : unknown;

export interface RenderAsSeatOptions<C extends Component = Component> {
  /**
   * TESTING-ONLY: render this view instead of the real per-seat view.
   *
   * Exists ONLY so `assertNoHiddenInfoLeak`'s own tests can prove the matcher
   * fails on a deliberately-injected leak (a leak-detector with no failing
   * case is unproven) — real callers should never pass it, since it renders
   * something other than what a real client would receive.
   */
  gameViewOverride?: UIGameElement | null;
  /**
   * The game's own root UI component. When omitted, AutoUI is rendered.
   *
   * A game with a custom board is exactly the case where a hidden-info leak
   * matters most, and AutoUI's markup says nothing about markup the game
   * wrote itself: a card AutoUI never renders can still be painted, face-up,
   * by a custom renderer. Pass the component a real client mounts (the one
   * `src/ui/uis.ts` registers) and the scan runs against that instead.
   */
  component?: C;
  /**
   * Props merged OVER the standard contract props this function supplies
   * (`gameView`, `playerSeat`, `isMyTurn`, `availableActions`,
   * `disabledActions`, `actionController`). Use it for props specific to your
   * component.
   *
   * `gameView` is deliberately re-applied after this merge and cannot be
   * overridden here: rendering anything but the real per-seat view would make
   * a green result meaningless. Use `gameViewOverride` if you genuinely need
   * to (its own doc explains why you almost certainly do not).
   */
  componentProps?: Record<string, unknown>;
  /**
   * Values to `provide` to the mounted tree, merged OVER the defaults this
   * function supplies.
   *
   * A board reads some of what it needs from props and the rest by injection,
   * from what its shell provides. So this function stands in for the shell and
   * provides the same things, built by the same function. A table seat gets
   * what `<GameShell>` gives it (`useTableSeat`, #406): board interaction, the
   * game context (`useGameContext()`), the announcer and animation events. A
   * world seat gets what `<WorldShell>` gives it (`useWorldSeat`, #413): board
   * interaction, the shared half of the game context and the world itself
   * (`useWorld()`). A board that runs inside its shell mounts here with no
   * wiring from the caller.
   *
   * Pass your own interaction under `BOARD_INTERACTION_KEY` to hold a handle on
   * it: it is then the one the seat's controller drives, as the shell's is, so
   * its targets come from starting an action on the controller rather than
   * from pre-loading. Pass anything else your own board asks for.
   *
   * A key only the OTHER shell provides is refused (#453): a world's board
   * handed a table's `gameState` would pass here and throw in a real world.
   */
  provide?: Record<string | symbol, unknown>;
  /**
   * An action to open on the seat's controller once the board has mounted, as
   * a player would by choosing it (#405, #413 for a world seat).
   *
   * A board draws its targets while an action is open, and a target can carry
   * what it hides -- a blind pick labelled with the card's face. Those targets
   * come from the seat's own controller, as in GameShell, so this is the way to
   * render or scan that state: the targets and their labels are the game's own.
   * `args` fills the action's first picks, as `actionController.start(name,
   * { args })` does, to reach a later one.
   *
   * The action must be one the seat may take now and must still be open once
   * started; an action with nothing left to choose completes at once, and the
   * controller refuses to take a move, so that is an error rather than a render.
   * A world action that quotes stays open awaiting confirmation, with the
   * world's own quote for the draft.
   */
  startAction?: { name: string; args?: Record<string, unknown> };
}

/**
 * Mount a game UI headlessly as `seat`, using the real per-seat wire view
 * (`testGame.getPlayerView(seat).state`) unless `gameViewOverride` is given.
 *
 * Renders AutoUI by default, or `options.component` when supplied — the
 * latter is how a game checks the surface its players actually look at. The
 * board is given the seat's own actions and a real action controller, wired as
 * its shell wires it (see `seatContextFor`); the controller refuses to take a
 * move, so rendering never changes the game or the world.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to render as
 * @param options - What to render (see {@link RenderAsSeatOptions})
 * @throws If called outside a jsdom test environment (WR-03) — this file's
 *   own `// @vitest-environment jsdom` pragma only applies to tests IN THIS
 *   FILE, not to a caller's test file.
 */
export async function renderAsSeat<C extends Component = typeof AutoUIComponent>(
  subject: HiddenInfoSubject,
  seat: number,
  options: RenderAsSeatOptions<C> = {},
): Promise<VueWrapper<RenderedInstance<C>>> {
  const { wrapper } = await mountForSeat(subject, seat, options);
  return wrapper;
}

/**
 * What {@link tableShellContext} and {@link worldShellContext} take: values to
 * provide over the shell's own, as {@link RenderAsSeatOptions.provide} takes
 * them. A key the shell provides may be replaced (your own board interaction,
 * or a recording action controller), and a key no shell provides (your game's
 * own) may be added. A key only the other shell provides is refused.
 */
export interface ShellContextOptions {
  provide?: Record<string | symbol, unknown>;
}

/** A seat's shell context, for a test that mounts a component itself. */
export interface ShellContext {
  /**
   * Pass as `global.provide` to `mount()`. It holds exactly the keys the real
   * shell provides the board it mounts, built by the function the shell builds
   * them with, plus what `options.provide` added.
   */
  readonly provide: Record<string | symbol, unknown>;
  /** The seat's action controller, the one `provide` holds, for a board's `actionController` prop. */
  readonly actionController: UseActionControllerReturn;
  /** Stops the seat's watchers. Call it once the component is unmounted. */
  stop(): void;
}

async function shellContext(
  subject: HiddenInfoSubject,
  seat: number,
  options: ShellContextOptions,
  caller: string,
): Promise<ShellContext> {
  const seatContext = await stubbedSeat(subject, seat, options, caller);
  return { provide: seatContext.provide, actionController: seatContext.controller, stop: seatContext.stop };
}

/**
 * THE TABLE STUB (#453): what `GameShell` provides the board it mounts, for a
 * test that mounts a component with `mount()` rather than
 * {@link renderAsSeat}, built for `seat` of `game` by `useTableSeat`, the one
 * function GameShell builds it with. Use it instead of providing
 * `GAME_CONTEXT_KEYS` by hand: a hand-built context can offer what the shell
 * does not, and the board then passes its test and throws in play.
 *
 * @example
 * ```ts
 * const shell = await tableShellContext(testGame, 1);
 * const wrapper = mount(ScorePanel, { global: { provide: shell.provide } });
 * // ...
 * wrapper.unmount();
 * shell.stop();
 * ```
 * @throws Outside jsdom, for a subject that is not a TestGame, and for a
 *   provided key only a world's shell gives.
 */
export function tableShellContext(game: TestGame, seat: number, options: ShellContextOptions = {}): Promise<ShellContext> {
  if (!(game instanceof TestGame)) {
    return Promise.reject(
      new Error('tableShellContext stubs a table seat: hand it the TestGame from createTestGame. For a world, use worldShellContext.'),
    );
  }
  return shellContext(game, seat, options, 'tableShellContext');
}

/**
 * THE WORLD STUB (#453): what `WorldShell` provides the board it mounts, built
 * for `seat` of `world` by `useWorldSeat`, the one function WorldShell builds it
 * with. A world provides only the shared half of the game context, never a
 * table's `gameState`, `dueSeats`, `timeTravelDiff` or `turnDeadline`, so a
 * component that calls `useGameContext()` throws here exactly as it does in a
 * real world.
 *
 * @throws Outside jsdom, for a subject that is not a TestWorld, and for a
 *   provided key only a table's shell gives.
 */
export function worldShellContext(world: TestWorld, seat: number, options: ShellContextOptions = {}): Promise<ShellContext> {
  if (!(world instanceof TestWorld)) {
    return Promise.reject(
      new Error('worldShellContext stubs a world seat: hand it the TestWorld from createTestWorld. For a table, use tableShellContext.'),
    );
  }
  return shellContext(world, seat, options, 'worldShellContext');
}

/** A mounted board, and everything it has failed with so far. */
interface MountedForSeat<C extends Component> {
  readonly wrapper: VueWrapper<RenderedInstance<C>>;
  readonly raised: unknown[];
}

/**
 * Let the mounted tree finish what it deferred, then raise anything it failed
 * with. A macrotask, because a board's deferred work is a promise chain and a
 * chain of any length has settled by the time one of those has run.
 */
async function raiseWhatTheBoardDeferred(raised: unknown[], seat: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failures = raised.splice(0, raised.length);
  const first = failures[0];
  if (first === undefined) return;
  const detail = first instanceof Error ? first.message : String(first);
  const others = failures.length > 1 ? ` (and ${failures.length - 1} more after it)` : '';
  throw new Error(
    `The board rendered for seat ${seat} failed after it rendered${others}: ${detail}\n` +
      'It is raised here, as a failed assertion, because a failure that arrives after this ' +
      'assertion has resolved is reported as an unhandled rejection and leaves the run GREEN -- ' +
      'so the hidden-information scan would have reported a clean result having checked nothing. ' +
      "Fix the board's deferred work (an async lifecycle hook, a watcher, or a promise started " +
      'in setup()), then run this scan again.',
    { cause: first },
  );
}

/**
 * ONE MOUNT, PLUS WHATEVER IT RAISED AFTER IT RENDERED (#267).
 *
 * `mount()` returns as soon as the first paint is done, and a board's work is
 * not always finished by then: an async lifecycle hook, a watcher, or a promise
 * started in `setup()` all fail LATER. Vue routes those into the app's own
 * error handler, and with no handler installed they escape to the process as an
 * unhandled rejection -- which arrives after this gate's assertion has already
 * resolved. Vitest then attributes the failure to nothing and the test PASSES,
 * so a suite whose only hidden-information check is this gate goes green while
 * checking nothing. That is the defect in #267 and it is the reason this
 * function exists rather than `renderAsSeat` mounting directly.
 *
 * So the app collects instead of escaping, the mount is given a turn to finish
 * what it deferred, and anything collected is RAISED TO THE CALLER as a failed
 * assertion. `raised` stays live afterwards because a board can still fail
 * during unmount, which the scan checks after its own `finally`.
 */
async function mountForSeat<C extends Component = typeof AutoUIComponent>(
  subject: HiddenInfoSubject,
  seat: number,
  options: RenderAsSeatOptions<C> = {},
): Promise<MountedForSeat<C>> {
  const mount = await loadMount();
  const component: Component = options.component ?? (await loadAutoUI());

  const seatContext = await stubbedSeat(subject, seat, options, 'renderAsSeat');
  const { gameView, provide } = seatContext;

  // AutoUI takes only (gameView, playerSeat); a scaffolded custom board also
  // takes (isMyTurn, availableActions, actionController, disabledActions).
  // Supplying the whole contract means the common custom-UI case needs no
  // `componentProps` at all — but it is then FILTERED to what the component
  // actually declares. An undeclared prop would otherwise fall through to the
  // root element as a real DOM attribute, which both spams Vue warnings and
  // adds attacker-free surface strings this very scan would go on to inspect.
  const props: Record<string, unknown> = options.component
    ? {
        ...retainDeclaredProps(options.component, {
          ...seatContext.contract,
          ...options.componentProps,
        }),
        // Non-negotiable: the scan is only meaningful against the real
        // per-seat view, so this wins over any caller-supplied `gameView`.
        gameView,
      }
    : { gameView, playerSeat: seat };

  // The props are assembled at runtime (filtered to what the component declares),
  // so they cannot be checked against one component's prop type -- hence mount's
  // own generic pinned to the base `Component`. The wrapper is then re-stated as
  // being over the component that was passed, which is what the signature promises
  // and what a caller inspecting its own board's props needs.
  //
  // COLLECTED, NEVER ESCAPED. See {@link raiseWhatTheBoardDeferred} -- this
  // handler is the whole of why a deferred failure can reach the caller at all.
  // The seat's wiring lives exactly as long as the app it was made for.
  const raised: unknown[] = [];
  let wrapper: VueWrapper<RenderedInstance<C>>;
  try {
    wrapper = mount<Component>(component, {
      props,
      global: {
        provide,
        config: { errorHandler: (error: unknown) => raised.push(error) },
        plugins: [{ install: (app) => app.onUnmount(seatContext.stop) }],
      },
    }) as VueWrapper<RenderedInstance<C>>;
  } catch (failure) {
    seatContext.stop();
    throw failure;
  }

  try {
    await raiseWhatTheBoardDeferred(raised, seat);
    if (options.startAction) {
      await seatContext.openAction(options.startAction);
      await raiseWhatTheBoardDeferred(raised, seat);
    }
  } catch (failure) {
    wrapper.unmount();
    throw failure;
  }
  return { wrapper, raised };
}

/** What a seat's board is mounted with, and how to let go of it afterwards. */
interface SeatContext {
  /** The per-seat tree the board draws. */
  readonly gameView: UIGameElement | null;
  /** The scaffold's contract props, before they are filtered to what the board declares. */
  readonly contract: Record<string, unknown>;
  /** The seat's action controller, as its shell wires it. */
  readonly controller: UseActionControllerReturn;
  /** What the board can inject, as GameShell provides it; the caller's `provide` is merged over it. */
  readonly provide: Record<string | symbol, unknown>;
  /** Opens an action on the seat's controller, for `startAction`; throws, saying why, when it cannot. */
  readonly openAction: (request: NonNullable<RenderAsSeatOptions['startAction']>) => Promise<void>;
  /** Stops whatever was wired for this mount. */
  readonly stop: () => void;
}

/**
 * WHAT A TEST MOUNTS A SEAT'S BOARD UNDER, standing in for its shell (#406,
 * #413, #453): the seat built the way its shell builds it (`seatContextFor`),
 * with the caller's `provide` merged over. A key only the other shell provides
 * is refused, since a board reading it would pass its test and throw in play.
 *
 * The interaction is the REAL one, not an inert shape: a board reads it in
 * setup() and again on every render. A caller's own interaction replaces it,
 * and is then the one a table's controller feeds, so the board and its
 * controller still share one.
 */
async function stubbedSeat(
  subject: HiddenInfoSubject,
  seat: number,
  options: Pick<RenderAsSeatOptions<Component>, 'provide' | 'gameViewOverride'>,
  caller: string,
): Promise<SeatContext> {
  requireDom();
  ensureBrowserApis();
  const shell = shellOf(subject, seat, caller);
  await refuseKeysTheShellLacks(shell.kind, options.provide ?? {}, caller);
  const { BOARD_INTERACTION_KEY, createBoardInteraction } = await loadBoardInteractionModule();
  const boardInteraction =
    (options.provide?.[BOARD_INTERACTION_KEY as symbol] as BoardInteraction | undefined) ?? createBoardInteraction();
  const seatContext = await seatContextFor(shell, seat, options, boardInteraction);
  return {
    ...seatContext,
    provide: { ...seatContext.provide, ...options.provide, [BOARD_INTERACTION_KEY as symbol]: boardInteraction },
  };
}

/** A seat's subject, as the shell it is mounted in. */
type ShellSubject = { kind: 'table'; table: TestGame } | { kind: 'world'; world: TestWorld };

/** Which shell `subject`'s seat is mounted in, or a refusal naming what `caller` takes. */
function shellOf(subject: HiddenInfoSubject, seat: number, caller: string): ShellSubject {
  if (subject instanceof TestGame) return { kind: 'table', table: subject };
  if (subject instanceof TestWorld) return { kind: 'world', world: subject };
  throw new Error(
    `${caller} mounts a seat of a table or a world, built with createTestGame or createTestWorld, and ` +
      `seat ${seat}'s subject is neither. Hand it the TestGame or TestWorld your test drove.`,
  );
}

/**
 * The seat's view and the scaffold's contract props.
 *
 * A TABLE IS MOUNTED THE WAY GAMESHELL MOUNTS IT (#390, #406). Its frame is the
 * one a session publishes (`buildPlayerState`, action metadata included, under
 * the runner's flow state), and everything the board is given -- its
 * controller and board bridge, the game context, the announcer and animation
 * events -- comes from `useTableSeat`, the one function GameShell builds them
 * with, fed the same interaction the board injects. Reading the seat's actions
 * off `getPlayerView(seat)` instead is what #390 was: a table's player view
 * carries them under `flowState`, so every table board was told it had nothing
 * to do.
 *
 * A WORLD IS MOUNTED THE WAY WORLDSHELL MOUNTS IT (#413): from the frame a host
 * sends the seat, through `useWorldSeat`, the one function WorldShell builds
 * its seat with.
 */
async function seatContextFor(
  shell: ShellSubject,
  seat: number,
  options: Pick<RenderAsSeatOptions<Component>, 'gameViewOverride'>,
  boardInteraction: BoardInteraction,
): Promise<SeatContext> {
  if (shell.kind === 'table') {
    const { table } = shell;
    const seatState = buildPlayerState(
      table.runner,
      table.game.players.map((player: { name: string }) => player.name),
      seat,
      { includeActionMetadata: true },
    );
    const gameView =
      options.gameViewOverride !== undefined ? options.gameViewOverride : (seatState.view as UIGameElement);
    return wireTableSeat(table, seat, seatState, gameView, boardInteraction);
  }
  // AWAITED, because a world's projection is a read of its store: `viewsFor`
  // settles the bundle's own `world.view` declaration and hydrates whatever it
  // names before it can answer.
  const frame = await shell.world.getPlayerView(seat);
  const gameView = options.gameViewOverride !== undefined ? options.gameViewOverride : (frame.state as UIGameElement);
  return wireWorldSeat(shell.world, seat, frame, gameView, boardInteraction);
}

/**
 * Build a table seat with `useTableSeat`, inside an effect scope the mount stops
 * when it unmounts.
 *
 * Where GameShell's inputs come from a host, these say there is none. Two more
 * things differ from a live shell, and both keep a render a render. Auto mode is
 * off (GameShell's player-facing toggle), so mounting never starts or completes
 * an action by itself. And the transport answers a pick's choices from the game
 * but refuses to take a move, saying how to take it: a hidden-information scan
 * that changed the game would not be a scan, and a board that has moved must be
 * rendered again to show it.
 */
async function wireTableSeat(
  table: TestGame,
  seat: number,
  seatState: PlayerGameState,
  gameView: UIGameElement | null,
  boardInteraction: BoardInteraction,
): Promise<SeatContext> {
  const [{ computed, effectScope, ref }, [{ useTableSeat }, { useTurnDeadline }]] = await Promise.all([
    import('vue'),
    loadTableSeatModules(),
  ]);
  const picks = new PickHandler(table.runner, table.game.players.length);
  // The frame a host hands GameShell: the session's seat state under the flow state.
  const frame = {
    flowState: table.runner.getFlowState(),
    state: seatState,
    playerSeat: seat,
    isSpectator: false,
  } as GameState;
  const scope = effectScope(true);
  let tableSeat!: TableSeat;
  scope.run(() => {
    tableSeat = useTableSeat({
      state: ref(frame),
      gameView: computed(() => gameView),
      playerSeat: ref(seat),
      isMyTurn: ref(seatState.isMyTurn),
      boardInteraction,
      autoEndTurn: ref(false),
      isViewingHistory: ref(false),
      timeTravelDiff: ref(null),
      platformRequest: async (op) => {
        throw new Error(
          `renderAsSeat mounted seat ${seat}'s board with no host page, so the host request "${op}" has ` +
            'nothing to answer it. It is made by the debug tools, which run only inside boardsmith dev.',
        );
      },
      presentation: ref(undefined),
      debugHighlight: ref(null),
      turnDeadline: useTurnDeadline(ref(null)),
      sendAction: async (actionName) => ({
        success: false,
        error:
          `renderAsSeat mounted seat ${seat}'s board to render it, so "${actionName}" was not sent to the game. ` +
          `Take the move with testGame.doAction(${seat}, '${actionName}', args), then render the seat again.`,
      }),
      fetchPickChoices: async (actionName, pickName, player, args) =>
        picks.getPickChoices(actionName, pickName, player, args),
    });
  });
  return {
    gameView,
    contract: {
      playerSeat: seat,
      isMyTurn: seatState.isMyTurn,
      availableActions: tableSeat.availableActions.value,
      disabledActions: tableSeat.disabledActions.value,
      actionController: tableSeat.controller,
    },
    controller: tableSeat.controller,
    provide: Object.fromEntries(tableSeat.provisions),
    openAction: (request) => openSeatAction(tableSeat.controller, request, seat, seatState.availableActions ?? []),
    stop: () => scope.stop(),
  };
}

/**
 * Build a world seat with `useWorldSeat`, inside an effect scope the mount
 * stops when it unmounts.
 *
 * Where WorldShell's host is a window it listens on, this one is the frame a
 * host would send (`TestWorld.getPlayerView`) and the world itself. It answers
 * a pick and a quote by asking the world, as a host does, and refuses to take
 * a move, saying how to take it: a render that changed the world would not be
 * a render. It has heard no narration, as a page that has just attached has not.
 */
async function wireWorldSeat(
  world: TestWorld,
  seat: number,
  frame: WorldSeatView,
  gameView: UIGameElement | null,
  boardInteraction: BoardInteraction,
): Promise<SeatContext> {
  const [{ effectScope, ref, shallowRef }, { useWorldSeat }] = await Promise.all([
    import('vue'),
    loadWorldSeatModule(),
  ]);
  const host: WorldSeatHost = {
    phase: ref('watching'),
    // The envelope a host sends, carrying the tree the board is handed, so the
    // board's props and everything it injects agree.
    view: shallowRef(Object.assign({}, frame.view, { state: gameView })),
    seat: ref(seat),
    actions: shallowRef(frame.offers),
    offersPending: ref(false),
    notice: ref(null),
    worldName: ref(null),
    presence: ref(frame.presence),
    players: shallowRef([]),
    events: shallowRef([]),
    acting: ref(false),
    act: async (command) => ({
      ok: false,
      message:
        `renderAsSeat mounted seat ${seat}'s board to render it, so "${command}" was not sent to the world. ` +
        `Take the move with world.take(${seat}, '${command}', args), then render the seat again.`,
    }),
    resolvePick: async (action, selection, args) => {
      try {
        return { ok: true, selection: await world.resolvePick(seat, action, selection, args) };
      } catch (error) {
        return refusedQuestion(error);
      }
    },
    quoteDraft: async (action, args) => {
      try {
        return { ok: true, quote: await world.quote(seat, action, args) };
      } catch (error) {
        return refusedQuestion(error);
      }
    },
  };
  const scope = effectScope(true);
  let worldSeat!: WorldSeat;
  scope.run(() => {
    worldSeat = useWorldSeat({ host, boardInteraction });
  });
  return {
    gameView,
    contract: {
      playerSeat: seat,
      isMyTurn: worldSeat.play.mayAct.value,
      availableActions: worldSeat.play.availableActions.value,
      disabledActions: worldSeat.play.disabledActions.value,
      actionController: worldSeat.controller,
    },
    controller: worldSeat.controller,
    provide: Object.fromEntries(worldSeat.provisions),
    openAction: (request) =>
      openSeatAction(worldSeat.controller, request, seat, worldSeat.play.availableActions.value),
    stop: () => scope.stop(),
  };
}

/** A pick or quote the world refused, answered as a host answers it. */
function refusedQuestion(error: unknown): { ok: false; message: string; code?: string } {
  return { ok: false, message: messageOf(error), ...(error instanceof WorldRefusal ? { code: error.code } : {}) };
}

/**
 * Open `request` on a seat's controller and wait for its targets to reach the
 * board, or say why it could not be held open.
 */
async function openSeatAction(
  controller: UseActionControllerReturn,
  { name, args }: NonNullable<RenderAsSeatOptions['startAction']>,
  seat: number,
  seatActions: readonly string[],
): Promise<void> {
  const started = await controller.start(name, args ? { args } : undefined);
  const mayTake = seatActions.length > 0 ? seatActions.map((action) => `"${action}"`).join(', ') : 'nothing';
  if (!started.success) {
    throw new Error(
      `renderAsSeat could not open "${name}" for seat ${seat}: ${started.error ?? 'the controller refused it'}. ` +
        `startAction opens an action the seat may take now, and seat ${seat} may take ${mayTake}.`,
    );
  }
  // The first pick's choices are fetched and handed to the board by watchers;
  // a macrotask is after every one of them has run.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (controller.currentAction.value !== name) {
    const reason = controller.lastError.value ?? 'it completed or was cancelled as soon as it started';
    throw new Error(
      `"${name}" did not stay open for seat ${seat}: ${reason}. startAction holds an action open so the ` +
        'board shows its choices, and an action with nothing left to choose completes at once. Open one ' +
        'with a choice still to make (leave out any `args` that fill its last pick).',
    );
  }
}

/**
 * Drop any entry the component does not declare as a prop, so it cannot fall
 * through to the rendered root as a DOM attribute. When a component's props
 * cannot be introspected (no `props` option at all — a render function taking
 * only attrs), everything is kept: filtering to nothing would render a board
 * with no state, and a scan of an empty board proves nothing.
 */
function retainDeclaredProps(
  component: Component,
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const declared = (component as { props?: string[] | Record<string, unknown> }).props;
  if (declared === undefined) return candidate;

  const names = new Set(Array.isArray(declared) ? declared : Object.keys(declared));
  if (names.size === 0) return candidate;

  return Object.fromEntries(Object.entries(candidate).filter(([key]) => names.has(key)));
}

/**
 * A predicate allowlist: returns `true` for a marker that is a known,
 * legitimate false positive (e.g. a visible turn counter that happens to
 * equal a hidden card's rank) and should NOT fail the assertion.
 *
 * A narrow predicate (scoped to specific marker values/attributes) cannot
 * silently mask a real leak the way a broad allowlist could — the allowlist
 * test in dom-leak.test.ts proves a real leak still fails when a legitimate
 * overlapping value is exempted.
 *
 * **Scope allowances to `elementId`, not just `attribute`.** An attribute-wide
 * exemption (e.g. `ctx.attribute === 'rank'`) allows that attribute for EVERY
 * element, including ones the predicate's author never reasoned about — a
 * future element with a same-named attribute would be silently exempted too.
 * Prefer proving redundancy per-element, using `ctx.elementId` to look up
 * something you already know is safe about THAT specific element:
 *
 * ```ts
 * // Build elementId -> compound-name map from the actual game state.
 * const cardNamesById = new Map<number, string>();
 * for (const card of testGame.game.all(Card)) {
 *   if (card.name) cardNamesById.set(card.id, card.name);
 * }
 *
 * const allow: HiddenInfoLeakAllowPredicate = (marker, ctx) => {
 *   if (ctx.attribute !== 'rank' && ctx.attribute !== 'suit') return false;
 *   // Only exempt THIS element's rank/suit, and only because its own
 *   // compound `name` (a superset) is proven to already cover it.
 *   const name = cardNamesById.get(ctx.elementId);
 *   return typeof name === 'string' && name.includes(marker);
 * };
 * ```
 *
 * This still cannot detect a leak of the bare rank/suit *without* the
 * compound name also leaking (structurally redundant fields are redundant by
 * definition) — pair a scoped allowlist like this with a dedicated
 * regression test that injects a bare-field-only leak (no `allow` predicate)
 * to prove that gap is covered too. See go-fish's
 * `tests/no-hidden-info-dom-leak.test.ts` for a worked example of both.
 */
export type HiddenInfoLeakAllowPredicate = (
  marker: string,
  context: { attribute?: string; elementId: number; elementLabel: string },
) => boolean;

export interface AssertNoHiddenInfoLeakOptions extends RenderAsSeatOptions {
  /** Caller-supplied allowlist predicate — see {@link HiddenInfoLeakAllowPredicate}. */
  allow?: HiddenInfoLeakAllowPredicate;
}

interface ForbiddenMarker {
  value: string;
  attribute?: string;
  elementId: number;
  elementLabel: string;
}

/** Depth-first index of an ElementJSON tree by node id (real ids AND synthetic negative ids). */
function indexNodesById(node: ElementJSON, into: Map<number, ElementJSON>): void {
  into.set(node.id, node);
  if (node.children) {
    for (const child of node.children) {
      indexNodesById(child, into);
    }
  }
}

/**
 * Coerce a primitive attribute value to its string identity form (rank/suit/etc.).
 *
 * Booleans are deliberately excluded: `true`/`false` are near-universal
 * substrings (e.g. `data-animatable="true"`, `aria-pressed="true"` appear on
 * essentially every interactive element), so treating a boolean attribute
 * (like `Card.faceUp`) as an identity candidate would false-positive on
 * almost any rendered page — the same class of problem as the short-numeric
 * collision risk this utility already scopes its DOM scan to avoid
 * (RESEARCH Pitfall 3), just guaranteed rather than merely likely.
 */
function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Coerce a `$image`/`$images.<side>` value (string URL or sprite descriptor) to an identity string. */
function stringifyImageValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'sprite' in (value as Record<string, unknown>)) {
    const sprite = (value as { sprite?: unknown }).sprite;
    return typeof sprite === 'string' ? sprite : undefined;
  }
  return undefined;
}

/**
 * Extract identity candidate values from an element's FULL unfiltered
 * `toJSON()` output: `name` plus every non-`$`-prefixed attribute (game data
 * like rank/suit/etc.), plus `$image`/`$images.face` specifically (the
 * identity-bearing image refs). Other `$`-prefixed keys ($type, $layout,
 * $direction, ...) are structural/layout metadata shared by every element of
 * that shape, never per-element secret identity, so they are not candidates
 * (this is an independent judgment call, NOT a reliance on
 * `redactHiddenElementAttrs`'s allowlist as ground truth for what is caught).
 *
 * `$images.back` is deliberately excluded too: by design (and by every
 * renderer's own T-93-04 behavior) a card's back image is shown for EVERY
 * hidden card of that type regardless of identity — it is intentionally
 * NOT identity-bearing (the whole point of a card back is that it looks the
 * same face-down). Treating it as forbidden would false-positive on every
 * correctly-redacted hidden card whose anonymized placeholder legitimately
 * renders that same back image (see `redactHiddenElementAttrs`, which keeps
 * `$images.back` for exactly this reason).
 */
function extractIdentityCandidates(
  json: ElementJSON,
): Array<{ attribute?: string; value: string }> {
  const candidates: Array<{ attribute?: string; value: string }> = [];

  if (json.name) {
    candidates.push({ attribute: 'name', value: json.name });
  }

  for (const [key, value] of Object.entries(json.attributes ?? {})) {
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) candidates.push({ attribute: '$image', value: s });
      continue;
    }
    if (key === '$images') {
      const images = value as Record<string, unknown> | undefined;
      if (images && typeof images === 'object') {
        for (const [side, imgVal] of Object.entries(images)) {
          if (side === 'back') continue; // not identity-bearing — see doc comment above
          const s = stringifyImageValue(imgVal);
          if (s) candidates.push({ attribute: `$images.${side}`, value: s });
        }
      }
      continue;
    }
    if (key.startsWith('$')) continue; // structural/layout system metadata — not identity
    for (const s of identityStringsIn(value)) {
      candidates.push({ attribute: key, value: s });
    }
  }

  return candidates;
}

/** @internal exported for the library's own shape test — not public API. */
export const _identityCandidatesForTests = extractIdentityCandidates;

/**
 * Every identity-bearing string reachable inside an attribute value.
 *
 * A bare `stringifyScalar` returned `undefined` for anything that was not a
 * string or a number, so a game that packs private state into positional arrays
 * or nested objects contributed ZERO forbidden markers for those fields (#20) —
 * and the assertion then passed over an almost-empty marker set, which is worse
 * than no coverage because it reads as coverage.
 *
 * Booleans stay excluded at every depth for the same reason `stringifyScalar`
 * excluded them: "true" and "false" appear on almost any rendered page, so they
 * would false-positive rather than detect.
 *
 * So are serialized ELEMENT and PLAYER references. Their contents are ids and
 * seat numbers — public handles that the page is expected to render, and short
 * numerics besides, which is the collision class this utility already scopes
 * its DOM scan to avoid. A ref's identity, if it is secret, is the referenced
 * element's own to protect, and that element is walked in its own right.
 */
function identityStringsIn(value: unknown, seen = new Set<unknown>()): string[] {
  const direct = stringifyScalar(value);
  if (direct !== undefined) return [direct];
  return nestedIdentityStrings(value, seen);
}

/**
 * The shortest numeric marker worth trusting from INSIDE a container.
 *
 * A container of small integers — a positional stat block, a per-skill array —
 * contributes markers like "3", and this utility's whole surface-scoping
 * discipline exists because a short numeric collides with the turn counters,
 * scores and indices any page is full of (RESEARCH Pitfall 3). A one- or
 * two-digit number reached by recursion is not evidence of anything: it says a
 * "3" is on screen, not that THIS "3" is.
 *
 * Strings are kept at any length — a species name or a card face is distinctive
 * in a way a digit is not — and a number that is an attribute's WHOLE value is
 * still a marker at any length, because that was already the contract and the
 * attribute name scopes it.
 */
const MIN_NESTED_NUMERIC_MARKER_DIGITS = 3;

/** {@link identityStringsIn}, for a value that is not itself a scalar. */
function nestedIdentityStrings(value: unknown, seen: Set<unknown>): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (isReferenceLike(value)) return [];
  // A game's state can hold a cycle (an element referencing its container);
  // walking one is not worth crashing the assertion that exists to protect it.
  if (seen.has(value)) return [];
  seen.add(value);

  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return entries.flatMap((entry) => {
    const scalar = stringifyScalar(entry);
    if (scalar === undefined) return nestedIdentityStrings(entry, seen);
    if (typeof entry === 'number' && scalar.replace('-', '').length < MIN_NESTED_NUMERIC_MARKER_DIGITS) {
      return [];
    }
    return [scalar];
  });
}

/**
 * A serialized element/player reference, or a live Player. Either way its
 * contents are public handles rather than identity — see `identityStringsIn`.
 */
function isReferenceLike(value: object): boolean {
  return (
    '__elementRef' in value ||
    '__elementId' in value ||
    '__playerRef' in value ||
    // A live Player object reachable off an attribute (e.g. `player`): its seat
    // and name are on screen by design.
    ('seat' in value && 'name' in value)
  );
}

/** Every attribute value (+ name) that survives on a FINAL tree node (excluding `__hidden`). */
function collectSurvivingValues(node: ElementJSON): Set<string> {
  const values = new Set<string>();
  if (node.name) values.add(node.name);

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (key === HIDDEN_PLACEHOLDER_ATTRIBUTE) continue;
    if (key === '$images' && value && typeof value === 'object') {
      for (const imgVal of Object.values(value as Record<string, unknown>)) {
        const s = stringifyImageValue(imgVal);
        if (s) values.add(s);
      }
      continue;
    }
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) values.add(s);
      continue;
    }
    // The SAME extraction the forbidden-marker walk uses. It has to be: a value
    // that survived redaction inside an array or a nested object would
    // otherwise be absent from this set and therefore read as forbidden, so
    // every game packing state positionally would fail on its own data (#20).
    for (const identity of identityStringsIn(value)) {
      values.add(identity);
    }
  }

  return values;
}

/** Result of {@link deriveLeakDetectionData}: forbidden markers plus, for every
 * VISIBLE element, the set of values that are that element's OWN legitimate
 * rendered identity (name/attributes it is actually allowed to show). */
interface LeakDetectionData {
  markers: ForbiddenMarker[];
  /** elementId -> the element's own surviving (legitimate) identity values. */
  ownValuesById: Map<number, Set<string>>;
}

/**
 * Derive the forbidden-marker set for `seat` (for every live element, compare
 * its FULL unfiltered identity against what survives into seat N's FINAL
 * per-seat tree — `game.toJSONForPlayer(seat)`, post-`playerView`) AND, for
 * every element that IS visible, its own surviving identity values.
 *
 * The `ownValuesById` map is what makes the D20/CR-01 exemption precise (see
 * {@link assertNoHiddenInfoLeak}): a surface attributed to an ancestor/owner
 * element can only be exempted from a marker check when the collision is
 * fully explained by THAT owner's own legitimate content — never merely
 * because the owner's id differs from the marker's element id.
 */
function deriveLeakDetectionData(
  unredacted: readonly ElementJSON[],
  finalTree: ElementJSON,
): LeakDetectionData {
  const nodesById = new Map<number, ElementJSON>();
  indexNodesById(finalTree, nodesById);

  const markers: ForbiddenMarker[] = [];
  const ownValuesById = new Map<number, Set<string>>();

  for (const unfiltered of unredacted) {
    const candidates = extractIdentityCandidates(unfiltered);
    if (candidates.length === 0) continue;

    const elementLabel = `${unfiltered.className}#${unfiltered.id}`;
    const node = nodesById.get(unfiltered.id);
    const elementHidden = !node || isHiddenPlaceholder(node);

    if (elementHidden) {
      // Absent from the final tree, or present only as a `__hidden` placeholder:
      // every identity candidate is forbidden.
      for (const c of candidates) {
        markers.push({
          value: c.value,
          attribute: c.attribute,
          elementId: unfiltered.id,
          elementLabel,
        });
      }
    } else {
      // Element is visible in the final tree — only candidates the final tree
      // did NOT preserve (stripped by redaction OR a `static playerView` hook)
      // are forbidden. The full surviving set is this element's OWN
      // legitimate identity, recorded for the surface-exemption check.
      const surviving = collectSurvivingValues(node);
      ownValuesById.set(unfiltered.id, surviving);
      for (const c of candidates) {
        if (!surviving.has(c.value)) {
          markers.push({
            value: c.value,
            attribute: c.attribute,
            elementId: unfiltered.id,
            elementLabel,
          });
        }
      }
    }
  }

  // Never treat an empty string as a marker — every value would trivially match.
  return { markers: markers.filter((m) => m.value.length > 0), ownValuesById };
}

/**
 * Text-bearing accessibility/metadata attributes scanned in addition to
 * `data-*`. BoardSmith's own `AutoUI` renderers actively write
 * element-derived identity (e.g. a card's `name`/notation) into exactly
 * these attributes — `CardRenderer.vue`'s `ariaLabel`/`displayLabel`
 * (aria-label/alt), `GridBoardRenderer.vue`'s cell `title`, and similar
 * `aria-label` bindings across `PieceRenderer.vue`/`DieRenderer.vue`/
 * `SpaceRenderer.vue`/`DeckRenderer.vue`/`HexBoardRenderer.vue`. A hidden
 * element's identity leaking through any of these would otherwise go
 * completely undetected (CR-01).
 */
const IDENTITY_BEARING_ATTRS = ['aria-label', 'alt', 'title', 'aria-description', 'aria-roledescription'];

/**
 * A DOM surface string plus the id of the element it is ATTRIBUTED to (the
 * nearest ancestor, inclusive, carrying `data-element-id` — the same anchor
 * `useFLIP` reads). `undefined` means the surface could not be
 * attributed to any specific element (no `data-element-id` ancestor at all)
 * and must be checked conservatively against every marker (D20).
 */
interface SurfaceString {
  value: string;
  ownerId?: number;
}

/**
 * Walk up from `el` (inclusive) to the nearest ancestor carrying
 * `data-element-id`, returning its numeric value. This is what makes a
 * scanned surface string attributable to a specific element (D20): every
 * `AutoUI` renderer (CardRenderer, PieceRenderer, DieRenderer,
 * SpaceRenderer, ...) stamps its element's own id onto `data-element-id`, so
 * a `data-*`/aria/img-src/style surface INSIDE that subtree belongs to that
 * element, not to a same-named sibling elsewhere in the tree.
 */
function findOwningElementId(el: Element): number | undefined {
  let current: Element | null = el;
  while (current) {
    const raw = current.getAttribute('data-element-id');
    if (raw !== null) {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
    current = current.parentElement;
  }
  return undefined;
}

/**
 * Scan ONLY the surfaces a hidden identity value could realistically leak
 * through: `data-*` attribute values, `img[src]`, inline
 * `style="background-image: url(...)"` fragments (sprite-sheet rendering),
 * and the text-bearing accessibility/metadata attributes in
 * {@link IDENTITY_BEARING_ATTRS} (aria-label/alt/title/etc. — CR-01).
 *
 * Deliberately NOT a blind `wrapper.text()` substring search — a bare text
 * scan false-positives on short numeric ranks/suits colliding with visible
 * turn counters, scores, or player names (RESEARCH Pitfall 3).
 *
 * Each surface is attributed to its owning element id (D20 — see
 * {@link findOwningElementId}) so symmetric-deck siblings sharing an
 * identity `value` (e.g. two same-named cards) remain distinguishable by
 * WHICH element actually rendered the surface. The owner is only the
 * NEAREST ancestor carrying `data-element-id` — it may be a container that
 * merely happens to enclose the surface (e.g. an aggregating cell, or the
 * enclosing Space when nothing closer stamps its own id), not necessarily
 * the element whose identity the surface displays. See {@link
 * assertNoHiddenInfoLeak}'s exemption logic (CR-01) for how that distinction
 * is enforced.
 */
function collectScopedSurfaceStrings(wrapper: VueWrapper<unknown>): SurfaceString[] {
  const root = wrapper.element as HTMLElement;
  const surfaces: SurfaceString[] = [];

  const visit = (el: Element) => {
    const ownerId = findOwningElementId(el);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        surfaces.push({ value: attr.value, ownerId });
      }
    }
    for (const attrName of IDENTITY_BEARING_ATTRS) {
      const value = el.getAttribute(attrName);
      if (value) surfaces.push({ value, ownerId });
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src');
      if (src) surfaces.push({ value: src, ownerId });
    }
    const style = el.getAttribute('style');
    if (style && style.includes('background-image')) {
      surfaces.push({ value: style, ownerId });
    }
  };

  visit(root);
  root.querySelectorAll('*').forEach(visit);

  return surfaces;
}

/**
 * Render `testGame` as `seat` (headlessly, via `renderAsSeat`) and throw if
 * any hidden element's identity leaks into the rendered markup.
 *
 * By default this renders AutoUI. **If your game ships a custom board, pass
 * `options.component`** — otherwise a green result says nothing about the
 * surface your players actually look at, which for a hidden-information game
 * is the only surface that matters:
 *
 * ```ts
 * import GameTable from '../src/ui/components/GameTable.vue';
 *
 * await assertNoHiddenInfoLeak(testGame, 1, { component: GameTable });
 * ```
 *
 * The standard scaffold props (`playerSeat`, `isMyTurn`, `availableActions`,
 * `actionController`) are supplied automatically from the real game state, so
 * most games need nothing else; add `options.componentProps` for props your
 * component declares beyond that contract.
 *
 * Forbidden markers are auto-derived from the difference between each
 * element's FULL unfiltered `toJSON()` identity and what survives into
 * seat N's FINAL per-seat tree — see {@link deriveForbiddenMarkers}. This
 * honors a game's `static playerView` hook (content the hook strips is
 * forbidden too) and never relies on a hardcoded identity-field list.
 *
 * KNOWN LIMITATION (WR-01): boolean-valued attributes are NEVER treated as
 * identity candidates (see {@link stringifyScalar}) — `true`/`false` collide
 * with near-universal DOM substrings (`data-animatable="true"`,
 * `aria-pressed="true"`, etc.), so including them would false-positive on
 * almost any rendered page. This is safe for boolean *state* flags like
 * `Card.faceUp`, but if your game's HIDDEN information is itself a boolean
 * (e.g. a secret "isSpy" role flag, a hidden coin-flip result), this
 * assertion will NEVER catch it leaking. Supplement with `assertHidden`/
 * `isElementVisible` checks (see `visibility.ts`) for boolean secrets.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to check for leaks
 * @param options - Allowlist predicate + (test-only) render override
 * @throws If a forbidden marker appears in a scoped DOM surface (data-*
 *   attribute value, img[src], inline background-image style, or a
 *   text-bearing accessibility/metadata attribute — aria-label, alt, title,
 *   aria-description, aria-roledescription), naming the leaked marker, the
 *   owning element, the seat, and the DOM surface.
 * @throws If called outside a jsdom test environment (WR-03) — add
 *   `// @vitest-environment jsdom` as the first line of your test file.
 */
export async function assertNoHiddenInfoLeak(
  subject: HiddenInfoSubject,
  seat: number,
  options: AssertNoHiddenInfoLeakOptions = {},
): Promise<void> {
  // THE DIFF, AND BOTH HALVES OF IT COME FROM THE SUBJECT. What it holds
  // against what this seat is sent -- never a hand-written field list, and
  // never a second implementation of the projection (#262).
  const unredacted = await subject.unredactedElements();
  // A GATE WITH NOTHING ON THE OTHER SIDE OF THE DIFF CANNOT FAIL (#267). The
  // same rule as the allowlist check below, one step earlier: a subject holding
  // no elements makes every marker set empty, so the scan would report a clean
  // result for any board at all -- including one painting the whole world.
  if (unredacted.length === 0) {
    throw new Error(
      'assertNoHiddenInfoLeak: the subject holds no elements at all, so there is nothing for ' +
        `seat ${seat}'s frame to be diffed against and this assertion cannot fail. Build the ` +
        'subject with createTestGame (a table) or createTestWorld (a world, whose genesis must ' +
        'have run), and check that the one handed here is the one the test drove.',
    );
  }
  const { markers, ownValuesById } = deriveLeakDetectionData(
    unredacted,
    (await subject.getPlayerView(seat)).state as ElementJSON,
  );
  const { allow } = options;
  const activeMarkers = allow
    ? markers.filter(
        (m) =>
          !allow(m.value, {
            attribute: m.attribute,
            elementId: m.elementId,
            elementLabel: m.elementLabel,
          }),
      )
    : markers;

  // IN-01: a matcher that can't fail is worse than none. If there WERE
  // forbidden markers to check but the caller's allowlist predicate
  // suppressed every single one, the predicate is over-broad -- fail loud
  // rather than silently passing with zero real coverage.
  if (markers.length > 0 && activeMarkers.length === 0) {
    throw new Error(
      `assertNoHiddenInfoLeak: the \`allow\` predicate filtered out all ${markers.length} ` +
        `forbidden marker(s) for seat ${seat} -- the allowlist masked every marker, making ` +
        'this assertion a no-op. Scope the predicate to the exact elementId/attribute pair ' +
        'you intend to allowlist, not a condition broad enough to match every marker.',
    );
  }

  if (activeMarkers.length === 0) return;

  // Every render option reaches the mount. Picking them out one by one is how
  // `provide` was accepted here and silently dropped (#405).
  const { wrapper, raised } = await mountForSeat(subject, seat, options);
  try {
    const surfaces = collectScopedSurfaceStrings(wrapper);

    for (const marker of activeMarkers) {
      for (const surface of surfaces) {
        // D20/CR-01: a surface attributed to a DIFFERENT element than the
        // marker's owning element is exempted ONLY when that owner's OWN
        // legitimate rendered identity (ownValuesById) already explains the
        // collision — e.g. a same-named symmetric-deck sibling showing its
        // own name. It is NOT exempted merely because the ids differ: an
        // ancestor that AGGREGATES a hidden descendant's identity into its
        // own surface (HexBoardRenderer's cell aria-label/<title> folding in
        // occupant piece names — CR-01) is not explained by the owner's own
        // identity and must still be checked. Un-attributed surfaces (no
        // owning `data-element-id` found) are always checked against every
        // marker — never drop a possible leak just because it couldn't be
        // attributed.
        if (
          surface.ownerId !== undefined &&
          surface.ownerId !== marker.elementId &&
          ownValuesById.get(surface.ownerId)?.has(marker.value)
        ) {
          continue;
        }
        if (surface.value.includes(marker.value)) {
          throw new Error(
            `Hidden-info leak: "${marker.value}"` +
              `${marker.attribute ? ` (attribute "${marker.attribute}")` : ''} ` +
              `from ${marker.elementLabel} is visible in the DOM rendered for seat ${seat}. ` +
              `Leaked via surface: ${surface.value.slice(0, 200)}`,
          );
        }
      }
    }
  } finally {
    wrapper.unmount();
  }
  // A BOARD CAN STILL FAIL ON THE WAY OUT -- an unmounted watcher, a teardown
  // hook -- and that failure is as deferred as any other. Checked after the
  // scan rather than inside its `finally` so a real leak is still the error the
  // caller is told about.
  await raiseWhatTheBoardDeferred(raised, seat);
}
