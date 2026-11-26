// @vitest-environment jsdom
/**
 * THE ANIMATION QUEUE'S CONTRACT, CHECKED BY A SEEDED RANDOM WALK (#1820, #1821).
 *
 * Each walk drives every input a board can reach (a frame landing, an undo or
 * a change of seat, a board mounting and unmounting, a claim, Skip, a handler
 * settling, the wait timer, the shell's unmount), and from every call-out (a
 * handler, an abort listener, a watcher of the queue's snapshot) it may call
 * back in. Boards and claims are real components: children of the shell, which
 * mount and unmount in the shell's next update, or Vue apps of their own, which
 * mount and unmount at once. It asserts what docs/ui-components.md
 * § "The playback contract" says the walk asserts, at every call, at every
 * snapshot the queue publishes, in every abort listener, after every input
 * (where pendingCount must count exactly the events still queued), and, at the
 * end, that every event was handed to a handler or ended for a reason the
 * contract gives. Explicit releases, registrations in an effect scope, calls
 * from a scope's teardown and `handlerWaitTimeout: 0` are left to the cases below it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, effectScope, h, nextTick, onBeforeUnmount, onMounted, onScopeDispose, provide, shallowRef, Suspense, watch, type App, type Component, type VNodeChild } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { ANIMATION_EVENTS_KEY, createAnimationEvents, useAnimationEvents, type AnimationFrame, type UseAnimationEventsReturn } from './useAnimationEvents.js';
import { createSeededRandom } from '../../utils/random.js';
import AwaitingBoard from './__fixtures__/AwaitingBoard.vue';

const TYPES = ['a', 'b', 'c'] as const;
const WAIT = 1000;

type Frame = AnimationFrame & { seq: number };

/** A board or a claim: a child of the shell or a Vue app of its own, with the mount lifetime its own hooks report. */
interface Part {
  name: string;
  app?: App;
  /** Handled types; empty for a claim. */
  types: Map<string, 'run' | 'drop'>;
  claim: boolean;
  life: 'pending' | 'mounted' | 'unmounted';
  /** The order it mounted in, which is the order the queue takes parts in. */
  mountSeq?: number;
  /** The queue has surely taken its handlers or claim in: set in a tick after the queue's own. It may take them sooner. */
  taken: boolean;
  component?: Component;
}

interface Call {
  board: Part;
  key: string;
  kind: 'play' | 'skipped';
  signal: AbortSignal;
  released: boolean;
  release: () => void;
}

/** What became of one event the walk landed. */
interface Fate {
  key: string;
  type: string;
  offered?: Call['kind'];
  /** Ended by Skip, a change of timeline or the shell's unmount before it was offered. */
  stopped: boolean;
  /** Stopped from a watcher of the step that may be handing it out, so it may still play first. */
  mayStillPlay?: boolean;
  /** When stopped, the board whose skip: 'run' handler the queue held for it then, until that board unmounts. */
  runOn?: Part;
  warned: boolean;
  /** While it waited, a mounted claim may have counted, so the queue may have skipped it unseen. */
  claimed: boolean;
  /** A watcher of the snapshot unmounted the board holding its type, so it may have been handed out and dropped unseen. */
  boardLost: boolean;
}

class Walk {
  readonly log: string[] = [];
  readonly violations: string[] = [];
  readonly frame = shallowRef<Frame>({ seq: 0, animationEvents: [], gameInstanceId: 'g', restoreEpoch: 0, viewerSeat: 1 });
  readonly children = shallowRef<Part[]>([]);
  readonly calls: Call[] = [];
  readonly parts: Part[] = [];
  readonly fates = new Map<string, Fate>();
  /** For each type, the last board surely taken in, until it unmounts. */
  readonly held = new Map<string, Part>();
  /** Types whose holder is unsure since a board unmounted before it was surely taken, with that board's mount order. */
  readonly lost = new Map<string, number>();
  mounts = 0;
  /** Stopped events with a skip: 'run' handler owed, in the order the queue runs them. */
  owed: Fate[] = [];
  /** The last id handed to any handler in each timeline. */
  readonly lastOffered = new Map<string, number>();
  readonly nextId = new Map<string, number>();
  readonly mustAbort = new Set<Call>();
  queue!: UseAnimationEventsReturn;
  shellAlive = true;
  reentries = 0;
  /** True while a frame with events lands and nothing re-entrant may end them: no snapshot may then say the queue is idle. */
  mustStayBusy = false;
  /** The call-out the walk is calling back in from, if any. */
  from?: string;
  private readonly wrapper;

  constructor(readonly random: () => number) {
    const walk = this;
    const Shell = defineComponent({
      setup() {
        walk.queue = createAnimationEvents({ frame: () => walk.frame.value, handlerWaitTimeout: WAIT });
        provide(ANIMATION_EVENTS_KEY, walk.queue);
        watch([walk.queue.isAnimating, walk.queue.pendingCount], () => walk.checkSnapshot(), { flush: 'sync' });
        watch([walk.queue.isAnimating, walk.queue.pendingCount], () => walk.callOut('watcher'), { flush: 'sync' });
        return () => h('div', { id: 'drawn', 'data-seq': String(walk.frame.value.seq) }, walk.children.value.map((part) => h(part.component!, { key: part.name })));
      },
    });
    this.wrapper = mount(Shell, { attachTo: document.body });
    vi.mocked(console.warn).mockImplementation((message: unknown) => this.warned(String(message)));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  timeline(frame: Frame = this.frame.value): string {
    return `${frame.restoreEpoch}:${frame.viewerSeat}`;
  }

  running(): Call[] {
    return this.calls.filter((c) => c.kind === 'play' && !c.released && !c.signal.aborted);
  }

  waiting(): Fate[] {
    return [...this.fates.values()].filter((f) => !f.offered && !f.stopped && !f.warned);
  }

  /** The board the queue's map holds for `type`, or 'unsure' while a board for it is mounted but not surely taken, or after one was lost so. */
  holder(type: string): Part | undefined | 'unsure' {
    if (this.lost.has(type) || this.parts.some((p) => p.life === 'mounted' && !p.taken && p.types.has(type))) return 'unsure';
    return this.held.get(type);
  }

  /** The queue may skip unseen what waits now: a claim is mounted and no board surely holds a handler. */
  claimsNone(): boolean {
    return this.parts.some((p) => p.claim && p.life === 'mounted') && !TYPES.some((type) => typeof this.holder(type) === 'object');
  }

  markClaimed(): void {
    if (this.claimsNone()) for (const fate of this.waiting()) fate.claimed = true;
  }

  violate(message: string): void {
    this.violations.push(message);
  }

  /** The component a part mounts as, recording its true mount lifetime from its own hooks. */
  component(part: Part) {
    const walk = this;
    return defineComponent({
      name: part.name,
      setup() {
        // Runs before Vue stops the component's scope, so the walk knows the part is leaving before the queue releases it.
        onBeforeUnmount(() => walk.unmounting(part));
        const queue = useAnimationEvents()!;
        if (part.claim) queue.claimNoEvents();
        for (const [type, skip] of part.types) {
          queue.registerHandler(type, (event, { signal }) => walk.handle(part, skip, event, signal), { skip });
        }
        // After the queue's own mounted hook, so this tick runs after the queue has taken the part in.
        onMounted(() => {
          part.life = 'mounted';
          part.mountSeq = walk.mounts++;
          walk.markClaimed();
          void nextTick(() => walk.taken(part));
        });
        return () => h('i');
      },
    });
  }

  taken(part: Part): void {
    if (part.life !== 'mounted') return;
    part.taken = true;
    for (const type of part.types.keys()) {
      if ((this.held.get(type)?.mountSeq ?? -1) < part.mountSeq!) this.held.set(type, part);
      if ((this.lost.get(type) ?? Infinity) < part.mountSeq!) this.lost.delete(type);
    }
  }

  unmounting(part: Part): void {
    part.life = 'unmounted';
    for (const call of this.running()) if (call.board === part) this.mustAbort.add(call);
    for (const type of part.types.keys()) this.unhold(part, type);
    // A watcher sees the snapshot of the step that hands an event out, before the handler is called.
    if (this.from === 'watcher') for (const fate of this.waiting()) if (part.types.has(fate.type)) fate.boardLost = true;
    // Its handler is gone before the turn of any stopped event it was owed for.
    for (const fate of this.owed) if (fate.runOn === part) fate.runOn = undefined;
    this.markClaimed();
  }

  unhold(part: Part, type: string): void {
    if (this.held.get(type) === part) this.held.delete(type);
    // The queue may have taken it in, replacing the holder, and now drops it.
    if (!part.taken) this.lost.set(type, Math.max(this.lost.get(type) ?? -1, part.mountSeq!));
  }

  // --- Inputs ---------------------------------------------------------------

  /** The next frame: in the same timeline mostly, else after an undo or a change of seat, with up to two new events. */
  nextFrame(): Frame {
    const roll = this.random();
    const prev = this.frame.value;
    const next: Frame = { ...prev, seq: prev.seq + 1 };
    if (roll < 0.1) next.restoreEpoch = prev.restoreEpoch! + 1;
    else if (roll < 0.2) next.viewerSeat = prev.viewerSeat === 1 ? 2 : 1;
    const tl = this.timeline(next);
    next.animationEvents = Array.from({ length: Math.floor(this.random() * 3) }, () => {
      const id = (this.nextId.get(tl) ?? 0) + 1;
      this.nextId.set(tl, id);
      return { id, type: this.pick(TYPES), data: { tl, seq: next.seq } };
    });
    return next;
  }

  land(reentrant: boolean): void {
    const next = this.nextFrame();
    if (this.timeline(next) !== this.timeline()) this.stopped(true);
    const events = next.animationEvents!;
    this.log.push(`land seq ${next.seq} tl ${this.timeline(next)} [${events.map((e) => `${e.type}${e.id}`).join(' ')}]${reentrant ? ' (re-entrant)' : ''}`);
    this.recordFates(next);
    const before = this.reentries;
    const watched = !reentrant && events.length > 0 && this.shellAlive;
    this.mustStayBusy = watched;
    this.frame.value = next;
    this.mustStayBusy = false;
    // A Skip or an unmount sent from a watcher as the frame lands may rightly end its events at once.
    if (watched && this.reentries === before && !this.queue.isAnimating.value) {
      this.violate(`isAnimating was false right after seq ${next.seq} landed with events`);
    }
  }

  recordFates(frame: Frame): void {
    const claimed = this.claimsNone();
    for (const e of frame.animationEvents!) {
      const key = `${e.type}${e.id}@${this.timeline(frame)}`;
      this.fates.set(key, { key, type: e.type, stopped: false, warned: false, claimed, boardLost: false });
    }
  }

  /** A part that mounts as a child of the shell in its next update, or as a Vue app of its own at once. */
  addPart(part: Part): void {
    this.parts.push(part);
    part.component = this.component(part);
    if (this.random() < 0.5) {
      this.log.push(`mount ${part.name} as a child`);
      this.children.value = [...this.children.value, part];
      return;
    }
    this.log.push(`mount ${part.name} as an app`);
    part.app = createApp(part.component);
    part.app.provide(ANIMATION_EVENTS_KEY, this.queue);
    part.app.mount(document.createElement('div'));
  }

  mountBoard(): void {
    const types = new Map<string, 'run' | 'drop'>();
    for (const type of TYPES) if (this.random() < 0.5) types.set(type, this.random() < 0.5 ? 'run' : 'drop');
    this.addPart({ name: `board${this.parts.length}[${[...types].map(([t, s]) => `${t}:${s}`).join(' ')}]`, types, claim: false, life: 'pending', taken: false });
  }

  claim(): void {
    this.addPart({ name: `claim${this.parts.length}`, types: new Map(), claim: true, life: 'pending', taken: false });
  }

  removePart(part: Part): void {
    if (part.life === 'unmounted') return;
    this.log.push(`unmount ${part.name}`);
    if (part.app) return part.app.unmount();
    // A child that never rendered leaves without mounting.
    if (part.life === 'pending') part.life = 'unmounted';
    this.children.value = this.children.value.filter((p) => p !== part);
  }

  unmountBoard(): void {
    const live = this.parts.filter((p) => !p.claim && p.life !== 'unmounted');
    if (live.length > 0) this.removePart(this.pick(live));
  }

  releaseClaim(): void {
    const claim = this.parts.find((p) => p.claim && p.life !== 'unmounted');
    if (claim) this.removePart(claim);
  }

  /** Mark every event not yet offered as stopped, noting the skip: 'run' handler the queue holds for each. */
  stopped(runsSkipped: boolean): void {
    for (const call of this.running()) this.mustAbort.add(call);
    const waiting = this.waiting();
    // A watcher sees the snapshot of a step that may hand the first event out; a stop sent from it comes after.
    if (this.from === 'watcher' && waiting.length > 0) waiting[0].mayStillPlay = true;
    for (const fate of waiting) {
      fate.stopped = true;
      if (runsSkipped) this.owed.push(fate);
      if (runsSkipped) fate.runOn = this.owedRun(fate);
    }
  }

  /** The board whose skip: 'run' handler the queue surely holds for a stopped event. */
  owedRun(fate: Fate): Part | undefined {
    // An event a claim or a lost board may have ended already has no skip: 'run' call owed.
    if (fate.claimed || fate.boardLost) return undefined;
    const board = this.holder(fate.type);
    return typeof board === 'object' && board.types.get(fate.type) === 'run' ? board : undefined;
  }

  skip(): void {
    this.log.push('skip');
    this.stopped(true);
    this.queue.skipAll();
  }

  settle(): void {
    const open = this.calls.filter((c) => !c.released);
    if (open.length === 0) return;
    const call = this.pick(open);
    this.log.push(`settle ${call.key}`);
    call.release();
  }

  unmountShell(): void {
    this.log.push('unmount shell');
    this.stopped(false);
    this.shellAlive = false;
    this.wrapper.unmount();
    for (const part of this.parts) if (part.app) part.app.unmount();
  }

  warned(message: string): void {
    const match = /"(\w+)" \(id: (\d+)\)/.exec(message);
    const fate = match && this.fates.get(`${match[1]}${match[2]}@${this.timeline()}`);
    if (!fate) return this.violate(`unexpected warning: ${message}`);
    this.log.push(`  warned ${fate.key}`);
    fate.warned = true;
    const board = this.holder(fate.type);
    if (typeof board === 'object') this.violate(`${fate.key} timed out while ${board.name} handled it`);
  }

  /** A board, listener or watcher calling back in, as the contract allows. */
  callOut(from: string): void {
    if (!this.shellAlive || this.reentries >= 3 || this.random() >= 0.3) return;
    this.reentries++;
    this.log.push(`  from ${from}:`);
    const input = this.pick<[string, () => void]>([
      ['land', () => this.land(true)],
      ['skip', () => this.skip()],
      ['mount', () => this.mountBoard()],
      ['unmount', () => this.unmountBoard()],
      ['claim', () => this.claim()],
      ['release claim', () => this.releaseClaim()],
      ['settle', () => this.settle()],
    ]);
    // A re-entrant Skip or change of timeline may rightly end the events landing.
    if (input[0] === 'skip' || input[0] === 'land') this.mustStayBusy = false;
    const outer = this.from;
    this.from = from;
    input[1]();
    this.from = outer;
  }

  /** What every call must hold, whether it plays the event or runs it skipped. */
  checkCall(board: Part, skip: 'run' | 'drop', key: string, kind: Call['kind'], tl: string, id: number): void {
    if (board.life !== 'mounted') this.violate(`${key} was handed to ${board.name} while it was ${board.life}`);
    if (!this.shellAlive) this.violate(`${key} was handed out after the shell unmounted`);
    this.checkOrder(key, tl, id);
    const fate = this.fates.get(key)!;
    if (kind === 'skipped') this.checkSkipRun(board, skip, fate);
    if (fate.offered) this.violate(`${key} was offered twice`);
    if (kind === 'play' && fate.stopped && !fate.mayStillPlay) this.violate(`${key} played after it was stopped`);
    fate.offered = kind;
  }

  checkOrder(key: string, tl: string, id: number): void {
    if ((this.lastOffered.get(tl) ?? 0) >= id) this.violate(`${key} was offered after id ${this.lastOffered.get(tl)} of its timeline`);
    this.lastOffered.set(tl, id);
  }

  /** What a call that plays its event must hold: its frame is drawn and nothing else plays. */
  checkPlay(key: string, seq: number): void {
    const drawn = Number(document.getElementById('drawn')?.dataset.seq);
    if (drawn < seq) this.violate(`${key} played before its frame ${seq} was drawn (drawn: ${drawn})`);
    const other = this.running();
    if (other.length > 0) this.violate(`${key} played while ${other.map((c) => c.key).join(', ')} still played`);
    if (!this.queue.isAnimating.value) this.violate(`${key} played while isAnimating was false`);
  }

  handle(board: Part, skip: 'run' | 'drop', event: { id: number; type: string; data: Record<string, unknown> }, signal: AbortSignal): Promise<void> {
    const tl = String(event.data.tl);
    const key = `${event.type}${event.id}@${tl}`;
    const kind = signal.aborted ? 'skipped' : 'play';
    this.log.push(`  ${kind === 'play' ? 'play' : 'skip-run'} ${key} on ${board.name}`);
    this.checkCall(board, skip, key, kind, tl, event.id);
    if (kind === 'play') this.checkPlay(key, Number(event.data.seq));
    let release = () => {};
    const done = new Promise<void>((resolve) => { release = resolve; });
    const call: Call = { board, key, kind, signal, released: false, release: () => { call.released = true; release(); } };
    this.calls.push(call);
    signal.addEventListener('abort', () => {
      this.checkMovedOn(key);
      this.callOut(`abort of ${key}`);
    });
    this.callOut(`handler of ${key}`);
    if (this.random() < 0.3) call.release();
    return done;
  }

  // --- Invariants -----------------------------------------------------------

  /** A skipped event runs on the skip: 'run' handler the queue holds for its type now, after every owed run before it. */
  checkSkipRun(board: Part, skip: 'run' | 'drop', fate: Fate): void {
    if (skip === 'drop') this.violate(`skip: 'drop' handler was called for skipped ${fate.key}`);
    const holder = this.holder(fate.type);
    if (holder !== 'unsure' && holder !== board) this.violate(`skipped ${fate.key} ran on ${board.name}, which the queue did not hold for ${fate.type}`);
    const turn = this.owed.indexOf(fate);
    for (const before of this.owed.slice(0, turn)) {
      if (before.runOn && !before.offered) this.violate(`${before.key} was skipped without calling ${before.runOn.name}'s skip: 'run' handler`);
    }
    this.owed = this.owed.slice(turn + 1);
  }

  /** The events the queue still holds, playing or waiting or queued, as far as the walk can tell: `sure` it must hold, `most` it may. */
  stillHeld(): { sure: number; most: number } {
    const open = [...this.fates.values()].filter((f) => !f.offered && !f.stopped && !f.warned);
    return { sure: open.filter((f) => !f.claimed && !f.boardLost).length, most: open.length };
  }

  /** Every snapshot the queue publishes, the moment it publishes it. */
  checkSnapshot(): void {
    const { isAnimating, pendingCount } = this.queue;
    if (!isAnimating.value && pendingCount.value !== 0) this.violate(`a snapshot said pendingCount ${pendingCount.value} while isAnimating was false`);
    if (this.mustStayBusy && !isAnimating.value) this.violate('a snapshot said isAnimating false while a frame with events landed');
  }

  /** In an abort listener the queue has moved on: nothing plays or waits, so it is busy exactly when events are queued. */
  checkMovedOn(key: string): void {
    const { isAnimating, pendingCount } = this.queue;
    if (isAnimating.value !== pendingCount.value > 0) {
      this.violate(`${key}'s abort listener saw isAnimating ${isAnimating.value} with pendingCount ${pendingCount.value}`);
    }
  }

  /** After an input, pendingCount counts every event the queue holds but the one waiting, and isAnimating is true while it holds any. */
  checkCount(): void {
    const { isAnimating, pendingCount } = this.queue;
    const { sure, most } = this.stillHeld();
    const pending = pendingCount.value;
    // The queue's only timer is the wait's, and a playing event is offered, so every other event held is queued.
    const waiting = vi.getTimerCount();
    if (pending < sure - waiting || pending > most - waiting) {
      this.violate(`pendingCount was ${pending} with ${sure} to ${most} events still held, ${waiting} of them waiting`);
    }
    if (!isAnimating.value && sure > 0) this.violate(`isAnimating was false with ${sure} events still held`);
  }

  /** After every input. */
  check(): void {
    for (const call of this.mustAbort) if (!call.signal.aborted) this.violate(`${call.key}'s signal did not abort`);
    this.mustAbort.clear();
    const { isAnimating } = this.queue;
    if (!isAnimating.value && this.running().length > 0) this.violate(`isAnimating was false while ${this.running()[0].key} played`);
    if (!this.shellAlive && isAnimating.value) this.violate('isAnimating stayed true after the shell unmounted');
    this.checkCount();
    this.checkSkipRuns();
  }

  /** Every stopped event the queue held a skip: 'run' handler for, which it held still at the event's turn, was run skipped. */
  checkSkipRuns(): void {
    for (const { runOn, offered, key } of this.owed) {
      if (runOn && !offered) this.violate(`${key} was skipped without calling ${runOn.name}'s skip: 'run' handler`);
    }
    this.owed = [];
  }

  /** Once the queue has run dry: every event was handed to a handler or ended for a reason the contract gives. */
  checkComplete(): void {
    for (const fate of this.fates.values()) {
      if (!fate.offered && !fate.stopped && !fate.warned && !fate.claimed && !fate.boardLost) {
        this.violate(`${fate.key} was never offered, stopped, warned about or claimed`);
      }
    }
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function runWalk(seed: string): Promise<Walk> {
  const walk = new Walk(createSeededRandom(seed));
  const steps: Array<[number, () => unknown]> = [
    [5, () => walk.land(false)],
    [5, () => flush()],
    [2, () => walk.mountBoard()],
    [1, () => walk.unmountBoard()],
    [1, () => walk.claim()],
    [1, () => walk.releaseClaim()],
    [1, () => walk.skip()],
    [3, () => walk.settle()],
    [1, () => vi.advanceTimersByTimeAsync(WAIT)],
  ];
  const total = steps.reduce((sum, [weight]) => sum + weight, 0);
  const fail = () => `seed ${seed}:\n${walk.violations.join('\n')}\n\n${walk.log.join('\n')}`;
  for (let i = 0; i < 60; i++) {
    walk.reentries = 0;
    let roll = walk.random() * total;
    const [, action] = steps.find(([weight]) => (roll -= weight) < 0)!;
    await action();
    walk.check();
    if (walk.violations.length > 0) throw new Error(fail());
  }

  // Every board unmounts without settling its handlers: the queue must still run dry.
  walk.reentries = 3;
  for (const part of walk.parts) walk.removePart(part);
  await flush();
  for (let i = 0; i < 20 && walk.queue.isAnimating.value; i++) await vi.advanceTimersByTimeAsync(WAIT);
  walk.check();
  if (walk.queue.isAnimating.value) walk.violate('the queue never ran dry once every board unmounted');
  walk.checkComplete();

  walk.unmountShell();
  walk.check();
  await flush();
  if (walk.violations.length > 0) throw new Error(fail());
  if (vi.mocked(console.error).mock.calls.length > 0) throw new Error(`seed ${seed}: console.error ${String(vi.mocked(console.error).mock.calls[0])}\n\n${walk.log.join('\n')}`);
  return walk;
}

const walked: string[] = [];

describe('the animation queue contract, on a seeded random walk (#1820, #1821)', () => {
  it.each(Array.from({ length: 150 }, (_, i) => `walk-${i}`))('holds on %s', async (seed) => {
    walked.push((await runWalk(seed)).log.join('\n'));
  });

  it('reached every kind of call-out and input on those walks', () => {
    const logs = walked.join('\n');
    for (const seen of ['from watcher', 'from abort of', 'from handler of', 'skip-run', '(re-entrant)', 'as a child', 'as an app', 'unmount board', 'warned']) {
      expect(logs).toContain(seen);
    }
  });
});

describe('the seven sequences council found breaking the contract (#1821)', () => {
  const event = (id: number, type: string) => ({ id, type, data: {} });
  const frameOf = (events: Array<{ id: number; type: string; data: Record<string, unknown> }>, restoreEpoch = 0): AnimationFrame => ({
    animationEvents: events, gameInstanceId: 'g', restoreEpoch, viewerSeat: 1,
  });

  /** A mounted shell over `frame` that provides its queue to whatever `board` renders. */
  function shell(frame: { value: AnimationFrame }, board: () => VNodeChild = () => null, inShell: (queue: UseAnimationEventsReturn) => void = () => {}) {
    let queue!: UseAnimationEventsReturn;
    const Shell = defineComponent({
      setup() {
        queue = createAnimationEvents({ frame: () => frame.value, handlerWaitTimeout: 60_000 });
        provide(ANIMATION_EVENTS_KEY, queue);
        inShell(queue);
        return () => h('div', [board()]);
      },
    });
    const wrapper = mount(Shell);
    return { queue, wrapper };
  }

  /** A component whose setup registers `type`, recording each call and whether its mounted hook had run. */
  function player(type: string, calls: string[], skip: 'run' | 'drop' = 'drop') {
    return defineComponent({
      setup() {
        let mounted = false;
        onMounted(() => (mounted = true));
        useAnimationEvents()!.registerHandler(type, (e, { signal }) => {
          calls.push(`${type}${e.id}${signal.aborted ? ' skipped' : ''}${mounted ? '' : ' before mount'}`);
          return new Promise<void>(() => {});
        }, { skip });
        return () => h('i');
      },
    });
  }

  it('1: keeps isAnimating true through a change of timeline that brings a new event, as the old handler aborts', async () => {
    const frame = shallowRef(frameOf([event(1, 'hit')]));
    const seen: boolean[] = [];
    const heardOnAbort: boolean[] = [];
    let queue!: UseAnimationEventsReturn;
    const Board = defineComponent({
      setup() {
        useAnimationEvents()!.registerHandler('hit', (_e, { signal }) => {
          signal.addEventListener('abort', () => heardOnAbort.push(queue.isAnimating.value));
          return new Promise<void>(() => {});
        }, { skip: 'drop' });
        return () => h('i');
      },
    });
    ({ queue } = shell(frame, () => h(Board), (q) => watch(q.isAnimating, (v) => seen.push(v), { flush: 'sync' })));
    await flushPromises();
    seen.length = 0;

    frame.value = frameOf([event(1, 'hit')], 1);
    await flushPromises();
    expect(seen).toEqual([]);
    expect(heardOnAbort).toEqual([true]);
  });

  it('2: holds an event for a child under Suspense until that child mounts', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    let resolveSetup!: () => void;
    const AsyncChild = defineComponent({
      async setup() {
        let mounted = false;
        onMounted(() => (mounted = true));
        useAnimationEvents()!.registerHandler('hit', async (e) => void calls.push(`hit${e.id}${mounted ? '' : ' before mount'}`), { skip: 'drop' });
        await new Promise<void>((resolve) => { resolveSetup = resolve; });
        return () => h('i');
      },
    });
    shell(frame, () => h(Suspense, null, { default: () => h(AsyncChild), fallback: () => h('p', 'loading') }));
    await flushPromises();

    frame.value = frameOf([event(1, 'hit')]);
    await flushPromises();
    expect(calls).toEqual([]);

    resolveSetup();
    await flushPromises();
    expect(calls).toEqual(['hit1']);
  });

  it('3: never calls the handler of a board app that a watcher of pendingCount unmounts as its event starts', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    const { queue } = shell(frame);
    const board = createApp(defineComponent({
      setup() {
        queue.registerHandler('hit', async (e) => void calls.push(`hit${e.id}`), { skip: 'drop' });
        return () => h('i');
      },
    }));
    board.mount(document.createElement('div'));
    watch(queue.pendingCount, (now, before) => { if (before === 1 && now === 0) board.unmount(); }, { flush: 'sync' });
    await flushPromises();

    frame.value = frameOf([event(1, 'hit')]);
    await flushPromises();
    expect(calls).toEqual([]);
    expect(queue.isAnimating.value).toBe(false);
  });

  it('4: hands a waiting event to a child that mounts in the same update as a sibling claiming none', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    const show = shallowRef(false);
    const ClaimsNone = defineComponent({
      setup() {
        useAnimationEvents()!.claimNoEvents();
        return () => h('i');
      },
    });
    const Dealer = player('deal', calls);
    shell(frame, () => (show.value ? [h(ClaimsNone), h(Dealer)] : null));
    await flushPromises();
    frame.value = frameOf([event(1, 'deal')]);
    await flushPromises();

    show.value = true;
    await flushPromises();
    expect(calls).toEqual(['deal1']);
  });

  it('5: takes a claim and a registration a watcher sends in the order it sends them', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    const { queue } = shell(frame, () => null, (q) => {
      watch(q.pendingCount, (now, before) => {
        if (before !== 2 || now !== 1) return;
        effectScope(true).run(() => {
          q.claimNoEvents();
          q.registerHandler('x', async (e) => void calls.push(`x${e.id}`), { skip: 'drop' });
        });
      }, { flush: 'sync' });
    });
    await flushPromises();

    frame.value = frameOf([event(1, 'x'), event(2, 'x')]);
    await flushPromises();
    expect(calls).toEqual(['x2']);
    expect(queue.isAnimating.value).toBe(false);
  });

  it('6: runs skipped events in order when a skip: run handler lands an event and calls Skip again', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: number[] = [];
    let queue!: UseAnimationEventsReturn;
    const Board = defineComponent({
      setup() {
        useAnimationEvents()!.registerHandler('x', async (e, { signal }) => {
          calls.push(e.id);
          if (signal.aborted && e.id === 1) {
            frame.value = frameOf([event(4, 'x')]);
            queue.skipAll();
          }
        }, { skip: 'run' });
        return () => h('i');
      },
    });
    ({ queue } = shell(frame, () => h(Board)));
    await flushPromises();

    frame.value = frameOf([event(1, 'x'), event(2, 'x'), event(3, 'x')]);
    queue.skipAll();
    await flushPromises();
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  it('7: takes in a frame of 150,000 events', async () => {
    const frame = shallowRef(frameOf([]));
    const { queue } = shell(frame);
    await flushPromises();

    frame.value = frameOf(Array.from({ length: 150_000 }, (_, i) => event(i + 1, 'x')));
    expect(queue.pendingCount.value).toBe(150_000);
  });

  it('plays no event before the shell draws its frame when a board app mounts as the frame lands', async () => {
    const frame = shallowRef(frameOf([]));
    const drawnAtCall: string[] = [];
    let queue!: UseAnimationEventsReturn;
    const Board = defineComponent({
      setup() {
        useAnimationEvents()!.registerHandler('hit', async (e) => void drawnAtCall.push(`hit${e.id} over ${document.getElementById('drawn')!.dataset.events}`), { skip: 'drop' });
        return () => h('i');
      },
    });
    const Shell = defineComponent({
      setup() {
        queue = createAnimationEvents({ frame: () => frame.value, handlerWaitTimeout: 60_000 });
        provide(ANIMATION_EVENTS_KEY, queue);
        return () => h('div', { id: 'drawn', 'data-events': String(frame.value.animationEvents!.length) }, [h(Board)]);
      },
    });
    mount(Shell, { attachTo: document.body });
    await flushPromises();
    // As event 1 ends, a watcher lands event 2's frame and then mounts an app, which flushes Vue's
    // pending post-flush callbacks at once, before the shell's update draws that frame.
    watch(queue.isAnimating, (busy) => {
      if (!busy && frame.value.animationEvents!.length === 1) frame.value = frameOf([event(1, 'hit'), event(2, 'hit')]);
      else if (busy && frame.value.animationEvents!.length === 2) createApp(defineComponent({ render: () => null })).mount(document.createElement('div'));
    }, { flush: 'sync' });

    frame.value = frameOf([event(1, 'hit')]);
    await flushPromises();
    expect(drawnAtCall).toEqual(['hit1 over 1', 'hit2 over 2']);
  });

  it('hands an event to a child that mounts with its frame while a claim of none is already in (#1821 review F1)', async () => {
    const frame = shallowRef<AnimationFrame & { dealer?: boolean }>(frameOf([]));
    const calls: string[] = [];
    const ClaimsNone = defineComponent({
      setup() {
        useAnimationEvents()!.claimNoEvents();
        return () => h('i');
      },
    });
    const Dealer = player('deal', calls);
    shell(frame, () => [h(ClaimsNone), frame.value.dealer ? h(Dealer) : null]);
    await flushPromises();

    frame.value = { ...frameOf([event(1, 'deal')]), dealer: true };
    await flushPromises();
    expect(calls).toEqual(['deal1']);
  });

  it('hands a waiting event to a child that replaces the only other handler in one update while a claim of none is in', async () => {
    const frame = shallowRef<AnimationFrame & { dealer?: boolean }>(frameOf([]));
    const calls: string[] = [];
    const ClaimsNone = defineComponent({
      setup() {
        useAnimationEvents()!.claimNoEvents();
        return () => h('i');
      },
    });
    const Other = player('other', calls);
    const Dealer = player('deal', calls);
    shell(frame, () => [h(ClaimsNone), frame.value.dealer ? h(Dealer) : h(Other)]);
    await flushPromises();
    frame.value = frameOf([event(1, 'deal')]);
    await flushPromises();

    frame.value = { ...frame.value, dealer: true };
    await flushPromises();
    expect(calls).toEqual(['deal1']);
  });
});

describe('the sequences council found breaking the contract after #1821 (#1822, #1824)', () => {
  const event = (id: number, type: string) => ({ id, type, data: {} });
  const frameOf = (events: Array<{ id: number; type: string; data: Record<string, unknown> }>): AnimationFrame => ({
    animationEvents: events, gameInstanceId: 'g', restoreEpoch: 0, viewerSeat: 1,
  });

  function shell(frame: { value: AnimationFrame }, board: () => VNodeChild = () => null, inShell: (queue: UseAnimationEventsReturn) => void = () => {}) {
    let queue!: UseAnimationEventsReturn;
    const Shell = defineComponent({
      setup() {
        queue = createAnimationEvents({ frame: () => frame.value, handlerWaitTimeout: 60_000 });
        provide(ANIMATION_EVENTS_KEY, queue);
        inShell(queue);
        return () => h('div', [board()]);
      },
    });
    mount(Shell);
    return queue;
  }

  it('applies a claim released by a watcher after the claim and registration sent before it', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    const queue = shell(frame, () => null, (q) => {
      watch(q.pendingCount, (now, before) => {
        if (before !== 2 || now !== 1) return;
        effectScope(true).run(() => {
          const release = q.claimNoEvents();
          q.registerHandler('x', async (e) => void calls.push(`x${e.id}`), { skip: 'drop' });
          release();
        });
      }, { flush: 'sync' });
    });
    await flushPromises();

    frame.value = frameOf([event(1, 'x'), event(2, 'x')]);
    await flushPromises();
    expect(calls).toEqual(['x2']);
    expect(queue.isAnimating.value).toBe(false);
  });

  it('hands the selected event to a handler that a watcher releases as it starts, then aborts it', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    let release!: () => void;
    const Board = defineComponent({
      setup() {
        release = useAnimationEvents()!.registerHandler('x', (e, { signal }) => {
          calls.push(`x${e.id}`);
          signal.addEventListener('abort', () => calls.push(`x${e.id} aborted`));
          return new Promise<void>(() => {});
        }, { skip: 'drop' });
        return () => h('i');
      },
    });
    const queue = shell(frame, () => h(Board), (q) => {
      watch(q.pendingCount, (now, before) => { if (before === 1 && now === 0) release(); }, { flush: 'sync' });
    });
    await flushPromises();

    frame.value = frameOf([event(1, 'x')]);
    await flushPromises();
    expect(calls).toEqual(['x1', 'x1 aborted']);
    expect(queue.isAnimating.value).toBe(false);
  });

  it('runs each skipped event on the skip: run handler registered at its turn, not at the Skip', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    let queue!: UseAnimationEventsReturn;
    const Board = defineComponent({
      setup() {
        useAnimationEvents()!.registerHandler('y', (_e, { signal }) => {
          // Sent during Skip's own step, so it counts after x2's turn and before x3's.
          signal.addEventListener('abort', () => effectScope(true).run(() => {
            queue.registerHandler('x', async (e, { signal: s }) => void calls.push(`x${e.id}${s.aborted ? ' skipped' : ''}`), { skip: 'run' });
          }));
          return new Promise<void>(() => {});
        }, { skip: 'drop' });
        return () => h('i');
      },
    });
    queue = shell(frame, () => h(Board));
    await flushPromises();
    frame.value = frameOf([event(1, 'y'), event(2, 'x'), event(3, 'x')]);
    await flushPromises();

    queue.skipAll();
    await flushPromises();
    expect(calls).toEqual(['x3 skipped']);
  });

  it('applies a release before a claim and a registration a watcher sends after it (#1822 review F2)', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    let release!: () => void;
    const Board = defineComponent({
      setup() {
        release = useAnimationEvents()!.registerHandler('h', async () => {}, { skip: 'drop' });
        return () => h('i');
      },
    });
    shell(frame, () => h(Board), (q) => {
      watch(q.pendingCount, (now, before) => {
        if (before !== 1 || now !== 0) return;
        release();
        effectScope(true).run(() => {
          q.claimNoEvents();
          q.registerHandler('w', async (e) => void calls.push(`w${e.id}`), { skip: 'drop' });
        });
      }, { flush: 'sync' });
    });
    await flushPromises();

    frame.value = frameOf([event(1, 'w')]);
    await flushPromises();
    expect(calls).toEqual([]);
  });

  it('never runs a skip: run handler for a Skip sent from its own scope teardown', async () => {
    const frame = shallowRef(frameOf([]));
    const calls: string[] = [];
    const show = shallowRef(true);
    const Board = defineComponent({
      setup() {
        const q = useAnimationEvents()!;
        // Registered first, so it runs while the queue still holds this board's handlers.
        onScopeDispose(() => q.skipAll());
        q.registerHandler('y', () => new Promise<void>(() => {}), { skip: 'drop' });
        q.registerHandler('x', async (e, { signal }) => void calls.push(`x${e.id}${signal.aborted ? ' skipped' : ''}`), { skip: 'run' });
        return () => h('i');
      },
    });
    const queue = shell(frame, () => (show.value ? h(Board) : null));
    await flushPromises();
    frame.value = frameOf([event(1, 'y'), event(2, 'x')]);
    await flushPromises();

    show.value = false;
    await flushPromises();
    expect(calls).toEqual([]);
    expect(queue.isAnimating.value).toBe(false);
  });

  it('refuses a registration and a claim made after an await in setup resumes in a component that already unmounted', async () => {
    const frame = shallowRef(frameOf([]));
    const show = shallowRef(true);
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => { resume = resolve; });
    let report!: (errors: string[]) => void;
    const reported = new Promise<string[]>((resolve) => { report = resolve; });
    shell(frame, () => (show.value ? h(Suspense, null, { default: () => h(AwaitingBoard, { resumed, report }) }) : null));
    await flushPromises();
    show.value = false;
    await flushPromises();

    resume();
    const errors = await reported;
    expect(errors).toEqual([
      expect.stringContaining('registerHandler() was called in an effect scope that has already stopped'),
      expect.stringContaining('claimNoEvents() was called in an effect scope that has already stopped'),
    ]);
  });
});
