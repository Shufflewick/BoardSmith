// @vitest-environment jsdom
/**
 * Direct unit tests for useActionAnimations.
 *
 * Covers the ANIM-01/02/03 paths added in 128-06:
 *  1. Test mode - an action animation records a {kind:'action'} trace using
 *     the composable's OWN interpolated elementSelector/destinationSelector
 *     strings and resolves instantly WITHOUT delegating to useFlyingElements'
 *     fly() (no double-record).
 *  2. Real path (fake timers) - with source+destination elements present in
 *     the DOM, triggering the animation and advancing fake timers drives the
 *     setTimeout-based CSS-transition wait (and the RAF chain fly() runs
 *     internally, also faked by vi.useFakeTimers()) to completion.
 *  3. Fail-loud - a missing source element throws in dev mode / console.errors
 *     in prod mode; a missing destination element behaves the same way.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, effectScope } from 'vue';

// jsdom lacks matchMedia; modules that read it at import time would throw.
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

// jsdom lacks ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// Controllable isDevMode() override for the fail-loud throw-path tests.
// Uses vi.hoisted() so the mutable state is safely referenceable inside the
// vi.mock() factory (which vitest hoists above this file's imports).
const devModeState = vi.hoisted(() => ({ override: null as boolean | null }));

vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return {
    ...actual,
    isDevMode: () => (devModeState.override !== null ? devModeState.override : actual.isDevMode()),
    isDevThrowEnabled: () => (devModeState.override !== null ? devModeState.override : actual.isDevThrowEnabled()),
  };
});

// Dynamic (not static) import: useActionAnimations.js transitively imports
// useFlyingElements.js -> reducedMotion.js, which reads
// window.matchMedia() at module load time. A static `import` here would be
// hoisted ahead of the vi.stubGlobal() calls above (128-03/128-05 precedent).
const { useActionAnimations } = await import('./useActionAnimations.js');
const { enableAnimationTestMode, disableAnimationTestMode, getAnimationTrace, clearAnimationTrace } =
  await import('./useAnimationTestMode.js');
type ActionAnimationConfig = import('./useActionAnimations.js').ActionAnimationConfig;
type GameElement = import('../types.js').GameViewElement;
type ControllerActionResult = import('./useActionControllerTypes.js').ControllerActionResult;
type AfterAutoExecuteListener = import('./useActionControllerTypes.js').AfterAutoExecuteListener;
const { useActionController } = await import('./useActionController.js');
const { createMockSendAction, createTestMetadata } = await import('./useActionController.test-helper.js');

function makeElement(attr: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute(attr, value);
  document.body.appendChild(el);
  return el;
}

/**
 * The gameView ref's only role in these tests is to change reference identity
 * so the composable's `watch(gameView, ...)` fires - its shape is otherwise
 * irrelevant, so a minimal stand-in cast satisfies the GameElement type.
 */
function fakeGameView(): GameElement {
  return {} as GameElement;
}

/** Stands in for the controller's after-auto-execute channel, so a test can say how an action ended. */
function fakeController() {
  let listener: AfterAutoExecuteListener | undefined;
  return {
    actionController: {
      onAfterAutoExecute(l: AfterAutoExecuteListener) {
        listener = l;
        return () => { listener = undefined; };
      },
    },
    /** Tell the composable how the action ended; resolves when any flight it starts has finished. */
    async settle(result: ControllerActionResult): Promise<void> {
      await listener!(result, 1);
    },
  };
}

/**
 * The server's reply to an action, in production order: the state broadcast,
 * then the action's result (the dev bridge and platform both send them so).
 */
async function reply(gameViewRef: { value: GameElement | null }, fake: ReturnType<typeof fakeController>): Promise<void> {
  gameViewRef.value = fakeGameView();
  await nextTick();
  await fake.settle({ success: true });
}

const moveConfig: ActionAnimationConfig = {
  action: 'moveCard',
  elementSelection: 'cardId',
  elementSelector: '[data-card-id="{cardId}"]',
  destinationSelector: '[data-zone="{zone}"]',
  duration: 50,
};

const flipConfig: ActionAnimationConfig = {
  action: 'forcedPlay',
  elementSelection: 'card',
  elementSelector: '[data-card-id="{card}"]',
  destinationSelector: '[data-card-id="{card}"]',
  duration: 50,
};

describe('useActionAnimations', () => {
  let fake: ReturnType<typeof fakeController>;

  beforeEach(() => {
    disableAnimationTestMode();
    clearAnimationTrace();
    devModeState.override = null;
    fake = fakeController();
  });

  afterEach(() => {
    disableAnimationTestMode();
    clearAnimationTrace();
    devModeState.override = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function animate(config: ActionAnimationConfig) {
    const gameViewRef = ref<GameElement | null>(null);
    const animations = useActionAnimations({
      gameView: gameViewRef,
      animations: [config],
      actionController: fake.actionController,
    });
    return { gameViewRef, ...animations };
  }

  describe('test mode', () => {
    it('records a {kind:"action"} trace from its own interpolated selector strings and skips fly()', async () => {
      makeElement('data-card-id', '42');
      makeElement('data-zone', 'hand');
      const { gameViewRef, onBeforeAutoExecute } = animate(moveConfig);

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1);
      enableAnimationTestMode();
      await reply(gameViewRef, fake);

      // Exactly one trace, kind:'action': test mode never delegates to fly(),
      // whose own 'fly' trace would make it two.
      expect(getAnimationTrace()).toHaveLength(1);
      expect(getAnimationTrace()[0]).toMatchObject({
        kind: 'action',
        element: '42',
        from: '[data-card-id="42"]',
        to: '[data-zone="hand"]',
      });
    });
  });

  describe('selector values (#868)', () => {
    it('finds elements whose interpolated values hold quotes and backslashes', async () => {
      const cardId = 'ace "high" \\ 1';
      makeElement('data-card-id', cardId);
      makeElement('data-zone', 'hand');
      const { gameViewRef, onBeforeAutoExecute } = animate(moveConfig);

      await onBeforeAutoExecute('moveCard', { cardId, zone: 'hand' }, 1);
      enableAnimationTestMode();
      await reply(gameViewRef, fake);

      expect(getAnimationTrace()).toEqual([expect.objectContaining({ kind: 'action', element: cardId })]);
    });
  });

  describe('selector templates (#868)', () => {
    const setUp = (config: Partial<ActionAnimationConfig>) => animate({ ...moveConfig, ...config });

    it.each([
      ['an id selector', { elementSelector: '#card-{cardId}' }],
      ['an unquoted attribute value', { elementSelector: '[data-card-id={cardId}]' }],
      ['a single-quoted attribute value', { elementSelector: "[data-card-id='{cardId}']" }],
      ['a single-quoted string that itself holds ="..."', { elementSelector: `[data-card-id='a="{cardId}"']` }],
      ['a class name after a quoted value', { elementSelector: '[data-zone="hand"] .card-{cardId}' }],
      ['the destination selector', { destinationSelector: '.zone-{zone}' }],
    ])('refuses a placeholder in %s, naming the action and the fix', (_label, config) => {
      expect(() => setUp(config)).toThrow(/"moveCard".*\{(cardId|zone)\}.*\[data-attribute="\{(cardId|zone)\}"\]/s);
    });

    it.each([
      ["MERC's template", { elementSelector: '[data-combatant="{combatantName}"]', destinationSelector: () => null }],
      ['several attributes and operators', { elementSelector: '.card[data-player="{player}"][data-piece^="{piece}"]' }],
      ['an escaped quote inside the value', { elementSelector: '[data-card-id="a\\"{cardId}"]' }],
      ['a :not(...) around the attribute', { elementSelector: '.card:not([data-card-id="{cardId}"])' }],
      ["a single quote inside the double-quoted value", { elementSelector: `[data-card-id="it's {cardId}"]` }],
    ])('accepts placeholders inside double-quoted attribute values: %s', (_label, config) => {
      expect(() => setUp(config)).not.toThrow();
    });
  });

  describe('real path (fake timers)', () => {
    it('drives the setTimeout-based lifecycle to completion with source+destination in the DOM', async () => {
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'performance',
          'Date',
        ],
      });
      try {
        const sourceEl = makeElement('data-card-id', '42');
        const destEl = makeElement('data-zone', 'hand');
        vi.spyOn(sourceEl, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 60, 84));
        vi.spyOn(destEl, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 200, 60, 84));
        const { gameViewRef, onBeforeAutoExecute, flyingElements } = animate(moveConfig);

        await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1);
        gameViewRef.value = fakeGameView();
        await nextTick();
        const flight = fake.settle({ success: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(flyingElements.value).toHaveLength(1);

        // Past the animation duration + cleanup wait: the RAF chain and the
        // setTimeout-based cleanup both finish.
        await vi.advanceTimersByTimeAsync(1000);
        await flight;

        expect(flyingElements.value).toHaveLength(0);
        expect(getAnimationTrace()).toHaveLength(0);
        expect(destEl.hasAttribute('data-action-animating')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('test mode + missing destination (CR-03)', () => {
    it('throws in dev mode for a typo\'d destination selector even when test mode is enabled', async () => {
      devModeState.override = true;
      // No element matching the destination selector: the authoring bug ANIM-03
      // exists to catch. Test mode must not record it as a "successful" trace.
      makeElement('data-card-id', '42');
      const { gameViewRef, onBeforeAutoExecute } = animate(moveConfig);

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1);
      enableAnimationTestMode();

      await expect(reply(gameViewRef, fake)).rejects.toThrow(/Could not find destination element/i);
      expect(getAnimationTrace()).toHaveLength(0);
    });
  });

  describe('fail-loud missing source/destination element', () => {
    it('throws in dev mode when the source element is missing', async () => {
      devModeState.override = true;
      const { onBeforeAutoExecute } = animate(moveConfig);

      await expect(
        onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1),
      ).rejects.toThrow(/Could not find element for selector/i);
    });

    it('console.errors (does not throw) in prod mode when the source element is missing', async () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { onBeforeAutoExecute } = animate(moveConfig);

      await expect(
        onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/Could not find element for selector/i);
    });

    it('console.errors (does not throw) in prod mode when the destination element is missing', async () => {
      devModeState.override = false;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      makeElement('data-card-id', '42');
      const { gameViewRef, onBeforeAutoExecute } = animate(moveConfig);

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1);
      await reply(gameViewRef, fake);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(String(consoleErrorSpy.mock.calls[0]?.[0])).toMatch(/Could not find destination element/i);
    });

    it('throws in dev mode when the destination element is missing, and shows the hidden source again', async () => {
      devModeState.override = true;
      const card = makeElement('data-card-id', '42');
      const { gameViewRef, onBeforeAutoExecute } = animate({ ...moveConfig, hideDestination: true });

      await onBeforeAutoExecute('moveCard', { cardId: '42', zone: 'hand' }, 1);
      expect(card.style.opacity).toBe('0');

      await expect(reply(gameViewRef, fake)).rejects.toThrow(/Could not find destination element/i);
      expect(card.style.opacity).toBe('');
      expect(card.style.pointerEvents).toBe('');
      expect(card.hasAttribute('data-action-animating')).toBe(false);
    });
  });

  describe('hide observer lifetime (#731)', () => {
    /** Show the card again, then make a DOM change a live observer would react to. */
    async function revealAndMutate(card: HTMLElement): Promise<void> {
      card.style.removeProperty('opacity');
      card.className = 'changed';
      await nextTick();
    }

    it('stops hiding the card once a refused action is followed by another action', async () => {
      const card = makeElement('data-card-id', '42');
      const { onBeforeAutoExecute } = animate(flipConfig);

      await onBeforeAutoExecute('forcedPlay', { card: '42' }, 1);
      expect(card.style.opacity).toBe('0');

      // The player starts another action before this one was settled.
      await onBeforeAutoExecute('pass', {}, 1);
      await revealAndMutate(card);

      expect(card.style.opacity).toBe('');
    });

    it('stops hiding the card when unmounted mid-animation', async () => {
      const card = makeElement('data-card-id', '42');
      const scope = effectScope();
      const { onBeforeAutoExecute } = scope.run(() => animate(flipConfig))!;

      await onBeforeAutoExecute('forcedPlay', { card: '42' }, 1);
      scope.stop();
      await revealAndMutate(card);

      expect(card.style.opacity).toBe('');
    });
  });

  describe('an action that never happens leaves no trace (#861)', () => {
    /** A card with inline styles of its own, which the hook must put back exactly. */
    function styledCard(): HTMLElement {
      const card = makeElement('data-card-id', '42');
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 60, 84));
      card.style.setProperty('opacity', '0.5');
      card.style.setProperty('transition', 'transform 1s', 'important');
      card.style.pointerEvents = 'auto';
      return card;
    }

    function expectOriginalLook(card: HTMLElement): void {
      expect(card.style.getPropertyValue('opacity')).toBe('0.5');
      expect(card.style.getPropertyPriority('opacity')).toBe('');
      expect(card.style.getPropertyValue('transition')).toBe('transform 1s');
      expect(card.style.getPropertyPriority('transition')).toBe('important');
      expect(card.style.pointerEvents).toBe('auto');
      expect(card.hasAttribute('data-action-animating')).toBe(false);
    }

    /** Let the watcher, the send and the outcome listeners finish. */
    async function settle(): Promise<void> {
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    }

    /** The real controller auto-executing forcedPlay, with the server's answer held until `answer` is called. */
    function playThroughController() {
      let answer!: (result: ControllerActionResult) => void;
      let fail!: (err: Error) => void;
      const sendAction = createMockSendAction().mockImplementation(
        () => new Promise((resolve, reject) => { answer = resolve; fail = reject; }),
      );
      const controller = useActionController({
        sendAction,
        availableActions: ref(['forcedPlay']),
        actionMetadata: ref(createTestMetadata()),
        isMyTurn: ref(true),
        autoFill: true,
        autoExecute: true,
      });
      const gameViewRef = ref<GameElement | null>(null);
      // A flight that outlasts the test, so its count is read while it is still in the air.
      const animations = useActionAnimations({
        gameView: gameViewRef, animations: [{ ...flipConfig, duration: 60_000 }], actionController: controller,
      });
      controller.onBeforeAutoExecute(animations.onBeforeAutoExecute);
      return {
        controller, animations, gameViewRef, sendAction,
        answer: (r: ControllerActionResult) => answer(r),
        fail: (err: Error) => fail(err),
      };
    }

    it('restores the card when the server rejects the action, and a later update plays nothing', async () => {
      const card = styledCard();
      const { controller, animations, gameViewRef, answer } = playThroughController();

      await controller.start('forcedPlay');
      await settle();
      expect(card.style.opacity).toBe('0');

      answer({ success: false, error: 'Not allowed' });
      await settle();
      expectOriginalLook(card);

      gameViewRef.value = fakeGameView();
      await settle();
      expect(animations.flyingElements.value).toHaveLength(0);
      expectOriginalLook(card);
    });

    it('restores the card when the transport fails', async () => {
      const card = styledCard();
      const { controller, animations, fail } = playThroughController();

      await controller.start('forcedPlay');
      await settle();
      expect(card.style.opacity).toBe('0');

      fail(new Error('Connection lost'));
      await settle();
      expectOriginalLook(card);
      expect(animations.flyingElements.value).toHaveLength(0);
    });

    it('restores the card when the action is cancelled before it is sent', async () => {
      const card = styledCard();
      const { controller, sendAction } = playThroughController();
      controller.onBeforeAutoExecute(() => {
        expect(card.style.opacity).toBe('0');
        controller.cancel();
      });

      await controller.start('forcedPlay');
      await settle();
      expectOriginalLook(card);
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('restores the card when a game wraps the hook and does not return its value', async () => {
      const card = styledCard();
      const sendAction = createMockSendAction().mockResolvedValue({ success: false, error: 'Not allowed' });
      const controller = useActionController({
        sendAction,
        availableActions: ref(['forcedPlay']),
        actionMetadata: ref(createTestMetadata()),
        isMyTurn: ref(true),
        autoFill: true,
        autoExecute: true,
      });
      const animations = useActionAnimations({
        gameView: ref<GameElement | null>(null), animations: [flipConfig], actionController: controller,
      });
      controller.onBeforeAutoExecute(async (name, args, run) => { await animations.onBeforeAutoExecute(name, args, run); });

      await controller.start('forcedPlay');
      await settle();
      expectOriginalLook(card);
    });

    it("a cancelled action that ends late leaves the next action's flight alone (#1026)", async () => {
      const card = styledCard();
      const { controller, animations, gameViewRef, answer } = playThroughController();
      // A second hook in the game that waits on its first call, while the player cancels and plays again.
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      let firstCall = true;
      controller.onBeforeAutoExecute(async () => {
        if (!firstCall) return;
        firstCall = false;
        await held;
      });

      await controller.start('forcedPlay');
      await settle();
      controller.cancel();
      await controller.start('forcedPlay');
      await settle();
      release();
      await settle();
      expect(card.style.opacity).toBe('0');

      gameViewRef.value = fakeGameView();
      await nextTick();
      answer({ success: true });
      await settle();
      expect(animations.flyingElements.value).toHaveLength(1);
      animations.cancelAll();
    });

    it('an update that is not the reply does not play the flight; the reply plays it exactly once', async () => {
      const card = styledCard();
      const { controller, animations, gameViewRef, answer } = playThroughController();

      await controller.start('forcedPlay');
      await settle();

      // An opponent's move arrives while ours is still in flight.
      gameViewRef.value = fakeGameView();
      await settle();
      expect(animations.flyingElements.value).toHaveLength(0);
      expect(card.style.opacity).toBe('0');

      // Our own reply: its state, then its result. A later update plays nothing more.
      gameViewRef.value = fakeGameView();
      await nextTick();
      answer({ success: true });
      await settle();
      gameViewRef.value = fakeGameView();
      await settle();
      expect(animations.flyingElements.value).toHaveLength(1);
      animations.cancelAll();
    });

    it('plays the flight exactly once when the result comes before the state', async () => {
      styledCard();
      const { controller, animations, gameViewRef, answer } = playThroughController();

      await controller.start('forcedPlay');
      await settle();
      answer({ success: true });
      await settle();
      expect(animations.flyingElements.value).toHaveLength(0);

      gameViewRef.value = fakeGameView();
      await settle();
      gameViewRef.value = fakeGameView();
      await settle();
      expect(animations.flyingElements.value).toHaveLength(1);
      animations.cancelAll();
    });
  });
});
