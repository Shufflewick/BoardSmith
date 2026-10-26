/**
 * WHAT THE SMOKE WALK READS OFF THE PAGE (#461, #462, #464), as plain functions Playwright runs in
 * the page over the elements a locator matched (`locator.evaluateAll`).
 *
 * Each is ONE look at the page. The walk used to count a locator's matches and then read each match
 * in turn, and an element the page removed between the count and a read left that read waiting for
 * it with no end (#464). A look taken in one go cannot see an element half gone.
 *
 * Playwright sends each function's source to the page and runs it there, so each one is
 * self-contained: no imports, and nothing from outside its own body. Kept apart from
 * `browser-smoke.ts`, which needs Playwright, so a vitest test can hold them to what they pick.
 */

/** One control the walk may press, as one look at the page showed it. */
export interface PageControl {
  /** Its place among the elements the locator matched, which `locator.nth` presses. */
  readonly index: number;
  /** How it reads to a person: its `aria-label`, else its `title`, else its text. */
  readonly label: string;
  /**
   * What it stands for: the game element (`data-bs-el-id`) when it has one, else the choice a pick's
   * candidate stands for (`data-bs-candidate`), else its label.
   */
  readonly key: string;
  /** Whether a player can press it now: not `aria-disabled`, not `disabled`. */
  readonly enabled: boolean;
  /**
   * Whether its players press it from the keyboard (#457): it takes no pointer (`pointer-events:
   * none`) AND cannot be seen (no opacity, hidden, or not rendered, on it or an ancestor), as a
   * keyboard board laid invisibly over a canvas is. A control a sighted player can see is clicked,
   * even when it takes no pointer, so one a mouse cannot press fails the walk.
   */
  readonly keyboardOnly: boolean;
  /**
   * Whether it is a pick's candidate (`data-bs-candidate`), which may stand for whatever lies under
   * the pointer, so the walk aims before it clicks one (#468).
   */
  readonly candidate: boolean;
  /**
   * Whether it is on the game's board (`[data-testid="bs-board"]`), where the walk points at it
   * itself, as a player does, rather than waiting for it to stand still (#468).
   */
  readonly onBoard: boolean;
  /** Whether this look marked it as the control about to be pressed (`pageControls`'s `mark`). */
  readonly marked: boolean;
}

/** The attribute `pageControls` marks the control about to be pressed with, by a mark of its own. */
export const PRESS_MARK = 'data-bs-smoke-press';

/**
 * The controls among `elements` a player can reach, in order. One inside the game-over card is not
 * the game's (#462): the walk sees that card as the game ending, and its Close would hide the end.
 * One inside an `inert` subtree cannot be reached by anyone, so it is not a control either (#461).
 *
 * With `mark`, the same look also marks the control the walk is about to press, found by the key it
 * was found by before (at the same place when two share a key), with `data-bs-smoke-press`, so the
 * press reaches that element wherever the page moves it, and not whatever took its place.
 */
export function pageControls(elements: Element[], mark?: { key: string; index: number; mark: string }): PageControl[] {
  const found: Array<Omit<PageControl, 'marked'>> = [];
  elements.forEach((element, index) => {
    if (element.closest('.game-over-card, [inert]') !== null) return;
    const html = element as HTMLElement;
    const label = (html.getAttribute('aria-label') ?? html.getAttribute('title') ?? html.innerText).replace(/\s+/g, ' ').trim();
    const id = html.getAttribute('data-bs-el-id');
    const candidate = html.getAttribute('data-bs-candidate');
    const key = id !== null ? `element:${id}` : candidate !== null ? `candidate:${candidate}` : `label:${label}`;
    const enabled = html.getAttribute('aria-disabled') !== 'true' && !(html as HTMLButtonElement).disabled;
    const keyboardOnly =
      getComputedStyle(html).pointerEvents === 'none' && !html.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const onBoard = html.closest('[data-testid="bs-board"]') !== null;
    found.push({ index, label, key, enabled, keyboardOnly, candidate: candidate !== null, onBoard });
  });
  const pick = mark && (found.find((c) => c.key === mark.key && c.index === mark.index) ?? found.find((c) => c.key === mark.key));
  if (mark && pick) elements[pick.index].setAttribute('data-bs-smoke-press', mark.mark);
  return found.map((c) => ({ ...c, marked: c === pick }));
}

/** An open modal dialog, as one look at the page showed it. */
interface PageDialog {
  /** Its place among the elements the locator matched. */
  readonly index: number;
  /** Its accessible name: `aria-label`, else the text `aria-labelledby` names, else its first heading. */
  readonly name: string;
}

/** The open modal dialogs on a page: an `aria-modal="true"` dialog, or a `<dialog>` shown modally. */
export const MODAL_DIALOGS = '[aria-modal="true"], dialog:modal';

/**
 * The open modal dialogs among `elements` (matches of {@link MODAL_DIALOGS}), in order, so the last
 * is the one on top, each with its name. While one is open a player can reach only what is inside it
 * (#461). The game-over card is a modal too, but the walk sees it as the game ending (#462), so it
 * is not one of these.
 */
export function pageDialogs(elements: Element[]): PageDialog[] {
  const found: PageDialog[] = [];
  elements.forEach((element, index) => {
    if (element.closest('.game-over-card') !== null) return;
    const labelledBy = element.ownerDocument.getElementById(element.getAttribute('aria-labelledby') ?? '');
    const heading = element.querySelector('h1, h2, h3, h4, h5, h6');
    const name = element.getAttribute('aria-label') ?? (labelledBy ?? heading)?.textContent ?? '';
    found.push({ index, name: name.replace(/\s+/g, ' ').trim() });
  });
  return found;
}

/**
 * What a click the walk made with the mouse reached (`guardClicks`, `clickReached`): the control
 * itself, a toast, which goes by itself (#478), something else, or nothing in that page at all.
 */
export type Reached = 'it' | 'toast' | 'other' | 'nothing';

/** What `guardClicks` keeps on a page's window for `clickReached`. */
interface ClickGuard {
  hit: boolean;
  /** Whether the `click` event itself reached the element, not only the pointer pressing on it. */
  clicked: boolean;
  missed: Exclude<Reached, 'it' | 'nothing'> | undefined;
  remove: () => void;
}

/** The window of a page `guardClicks` has guarded. */
type GuardedWindow = Window & { __boardsmithSmokeGuard?: ClickGuard };

/**
 * Guards the next click in a page (#468): every pointer and mouse event that would reach anything
 * but `element` is stopped before the page sees it, as Playwright's own click does, so a click that
 * would land on something the page moved under the pointer does nothing and the walk can look again.
 * Which events reached the element, and whether the others reached a toast, is kept for
 * `clickReached` and `clickArrived`. With `element` null it guards the page it runs in, the page around the game's
 * frame (#478), where nothing is the control: every click there is stopped.
 */
export function guardClicks(element: Element | null): void {
  const view = (element?.ownerDocument.defaultView ?? window) as GuardedWindow;
  const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  const guard: ClickGuard = { hit: false, clicked: false, missed: undefined, remove: () => types.forEach((type) => view.removeEventListener(type, stop, true)) };
  function stop(event: Event): void {
    const target = event.target as Element | null;
    if (element !== null && target !== null && (target === element || element.contains(target))) {
      guard.hit = true;
      if (event.type === 'click') guard.clicked = true;
      return;
    }
    if (guard.missed !== 'toast') guard.missed = target?.closest?.('.toast') ? 'toast' : 'other';
    event.stopImmediatePropagation();
    event.preventDefault();
  }
  types.forEach((type) => view.addEventListener(type, stop, true));
  view.__boardsmithSmokeGuard = guard;
}

/**
 * Whether the `click` event itself reached the element `guardClicks` guards, read before
 * `clickReached` takes the guard off. A click that ran out of time waiting for a busy page to answer
 * landed only if its `click` arrived; a pointer that only pressed on the control did not press it.
 */
export function clickArrived(): boolean {
  return (window as GuardedWindow).__boardsmithSmokeGuard?.clicked === true;
}

/**
 * Takes the guard `guardClicks` set off this page and says what the click reached: the control, a
 * toast or something else (which the guard stopped), or nothing in this page, as when the page
 * around the game covers the control and took the click itself. A page with no guard is a new page:
 * the click replaced the one that was guarded.
 */
export function clickReached(): Reached {
  const view = window as GuardedWindow;
  const guard = view.__boardsmithSmokeGuard;
  if (guard === undefined) throw new Error("the game's page was replaced before the walk could read what the click reached");
  guard.remove();
  delete view.__boardsmithSmokeGuard;
  return guard.missed ?? (guard.hit ? 'it' : 'nothing');
}

/** What `tracePointerWork` keeps on a page's window for `watchThePointer` to set. */
interface PointerTrace {
  /** Whether work scheduled now is the pointer's: one of its events on the watched control is being dispatched. */
  pointing: () => boolean;
  /** Called as the pointer's work starts; what it returns is called once that work and the microtasks it queued have run. */
  starts: () => () => void;
}

/** The window of a page `tracePointerWork` runs in. */
type TracedWindow = Window & { __boardsmithSmokePointerTrace?: PointerTrace };

/**
 * Marks the work the pointer's events start as the pointer's, in a page the walk presses in (#1484),
 * run before the page's own scripts, so a hover handler's update put off to a later task is still
 * tied to the pointer. A callback given to `setTimeout` or `requestAnimationFrame`, a
 * `transitionend` or `animationend` listener (which a `<Transition>` leave may end on), or a
 * `MessageChannel` port's `onmessage` run by a `postMessage`, while the pointer's event is being
 * dispatched or while marked work runs, runs marked, as long as the watch it was marked under is
 * still on. A game's clock, started by an earlier press, stays unmarked (#1483).
 */
export function tracePointerWork(): void {
  const view = window as TracedWindow;
  const trace: PointerTrace = { pointing: () => false, starts: () => () => {} };
  view.__boardsmithSmokePointerTrace = trace;
  type Mark = PointerTrace['starts'];
  let running: Mark | undefined;
  const marking = () => running ?? (trace.pointing() ? trace.starts : undefined);
  const marked = <A extends unknown[], R>(callback: (...args: A) => R, by: Mark) =>
    function (this: unknown, ...args: A): R {
      // Work marked under a watch that is over is not the pointer's on the control watched now.
      if (by !== trace.starts) return callback.apply(this, args);
      const done = by();
      running = by;
      try {
        return callback.apply(this, args);
      } finally {
        // Queued last, so the updates the callback queued (a Vue render) run marked before it.
        queueMicrotask(() => {
          running = undefined;
          done();
        });
      }
    };
  const traced = <A extends unknown[], R>(callback: (...args: A) => R) => {
    const by = marking();
    return by ? marked(callback, by) : callback;
  };
  const timeout = view.setTimeout;
  view.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
    timeout(typeof handler === 'function' ? traced(handler as (...a: unknown[]) => unknown) : handler, ms, ...args)) as typeof setTimeout;
  const frame = view.requestAnimationFrame;
  view.requestAnimationFrame = (callback) => frame(traced(callback));
  const ends = new Set(['transitionend', 'animationend']);
  const wrappers = new WeakMap<object, EventListener>();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    const by = ends.has(type) && typeof listener === 'function' ? marking() : undefined;
    if (by && typeof listener === 'function') {
      const wrapper = marked(listener, by);
      wrappers.set(listener, wrapper);
      listener = wrapper;
    }
    add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type, listener, options) {
    remove.call(this, type, listener, options);
    const wrapper = listener && wrappers.get(listener);
    if (wrapper) remove.call(this, type, wrapper, options);
  };
  // A port's messages arrive in the order they were posted, so each port keeps, in order, which mark each was posted under.
  const posted = new WeakMap<MessagePort, Array<Mark | undefined>>();
  const partners = new WeakMap<MessagePort, MessagePort>();
  const marks = new WeakMap<Event, Mark>();
  const Channel = MessageChannel;
  globalThis.MessageChannel = class extends Channel {
    constructor() {
      super();
      for (const [port, partner] of [[this.port1, this.port2], [this.port2, this.port1]]) {
        posted.set(port, []);
        partners.set(port, partner);
        // Added first, so it runs before the page's own handler, for every message the port is handed.
        port.addEventListener('message', (event) => {
          const by = posted.get(port)?.shift();
          if (by) marks.set(event, by);
        });
      }
    }
  };
  const post = MessagePort.prototype.postMessage as (this: MessagePort, ...args: unknown[]) => void;
  MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
    const to = partners.get(this);
    if (to !== undefined) posted.get(to)?.push(marking());
    post.apply(this, args);
  } as typeof MessagePort.prototype.postMessage;
  const onmessage = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')!;
  Object.defineProperty(MessagePort.prototype, 'onmessage', {
    ...onmessage,
    set(this: MessagePort, handler: ((event: MessageEvent) => unknown) | null) {
      onmessage.set!.call(
        this,
        handler &&
          function (this: MessagePort, event: MessageEvent) {
            const by = marks.get(event);
            return (by ? marked(handler, by) : handler).call(this, event);
          },
      );
    },
  });
}

/** What `watchThePointer` keeps on a page's window for `pointerTookIt`. */
interface PointerWatch {
  element: Element;
  took: boolean;
  remove: () => void;
}

/** The window of a page `watchThePointer` watches. */
type WatchedWindow = TracedWindow & { __boardsmithSmokePointerWatch?: PointerWatch };

/**
 * Watches whether the pointer moving over `element` takes it away (#464, #1483, #1484): whether it is
 * hidden or taken off the page while one of the pointer's events is still being dispatched, by a
 * handler or the updates it starts, which run before the dispatch goes on, or by work the pointer's
 * events put off to a later task (`tracePointerWork`). A control a game's clock takes away after the
 * pointer arrived goes in work of the clock's own, and is not counted. Kept for `pointerTookIt`; what
 * an earlier watch saw is kept for a control found again.
 */
export function watchThePointer(element: Element): void {
  const view = element.ownerDocument.defaultView as WatchedWindow;
  const trace = view.__boardsmithSmokePointerTrace;
  if (trace === undefined) throw new Error("the walk cannot watch the pointer in this page: its pointer trace was not added before the page's scripts ran");
  const old = view.__boardsmithSmokePointerWatch;
  if (old?.element === element) return;
  old?.remove();
  const types = ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove'];
  let pointing: Event | undefined;
  let shown = false;
  const pointed = (event: Event) => {
    pointing = event;
    shown = element.checkVisibility();
  };
  const dispatching = () => pointing !== undefined && pointing.eventPhase !== Event.NONE;
  const observer = new MutationObserver(() => {
    if (dispatching() && shown && !element.checkVisibility()) watch.took = true;
  });
  const watch: PointerWatch = {
    element,
    took: old?.took === true,
    remove: () => {
      types.forEach((type) => view.removeEventListener(type, pointed, true));
      observer.disconnect();
      trace.pointing = () => false;
      trace.starts = () => () => {};
    },
  };
  trace.pointing = dispatching;
  trace.starts = () => {
    const before = element.checkVisibility();
    return () => {
      if (before && !element.checkVisibility()) watch.took = true;
    };
  };
  types.forEach((type) => view.addEventListener(type, pointed, true));
  observer.observe(element.ownerDocument, { subtree: true, childList: true, attributes: true });
  view.__boardsmithSmokePointerWatch = watch;
}

/** Takes `watchThePointer`'s watch off this page and says whether the pointer took its control away. */
export function pointerTookIt(): boolean {
  const view = window as WatchedWindow;
  const watch = view.__boardsmithSmokePointerWatch;
  watch?.remove();
  delete view.__boardsmithSmokePointerWatch;
  return watch?.took === true;
}

/**
 * The value the walk enters in an empty number field (#465): the field's own least value, else 1,
 * whole when the field takes whole numbers (`step="1"`), plus one for each of the `refused` values
 * the game's own rules turned down before (#466), and never past its most.
 */
export function numberToEnter(input: HTMLInputElement, refused: number): string {
  const least = input.min === '' ? 1 : Number(input.min);
  const most = input.max === '' ? Infinity : Number(input.max);
  return String(Math.min((input.step === '1' ? Math.ceil(least) : least) + refused, most));
}
