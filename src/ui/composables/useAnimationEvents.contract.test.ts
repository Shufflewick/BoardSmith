// @vitest-environment jsdom
/**
 * THE ANIMATION QUEUE'S CONTRACT, CHECKED BY A SEEDED RANDOM WALK (#1820).
 *
 * Each walk drives every input a board can reach (a frame landing, an undo or
 * a change of seat, a board mounting and unmounting, a claim, Skip, a handler
 * settling, the wait timer, the shell's unmount), and from every call-out (a
 * handler, an abort listener, a watcher of isAnimating) it may call back in.
 * After every input it checks the invariants docs/ui-components.md
 * § "The playback contract" promises a game author.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, effectScope, h, nextTick, provide, shallowRef, watch, type EffectScope } from 'vue';
import { mount } from '@vue/test-utils';
import { ANIMATION_EVENTS_KEY, createAnimationEvents, type AnimationFrame, type UseAnimationEventsReturn } from './useAnimationEvents.js';
import { createSeededRandom } from '../../utils/random.js';

const TYPES = ['a', 'b', 'c'] as const;
const WAIT = 1000;

type Frame = AnimationFrame & { seq: number };

interface Board { scope: EffectScope; alive: boolean; types: Map<string, 'run' | 'drop'> }

interface Call {
  board: Board;
  key: string;
  kind: 'play' | 'skipped';
  signal: AbortSignal;
  released: boolean;
  release: () => void;
}

class Walk {
  readonly log: string[] = [];
  readonly violations: string[] = [];
  readonly frame = shallowRef<Frame>({ seq: 0, animationEvents: [], gameInstanceId: 'g', restoreEpoch: 0, viewerSeat: 1 });
  readonly calls: Call[] = [];
  readonly boards: Board[] = [];
  readonly claims: EffectScope[] = [];
  /** Which board's handler the queue holds for each type, as the queue's own map would. */
  readonly registered = new Map<string, Board>();
  /** The last id handed to any handler in each timeline. */
  readonly lastOffered = new Map<string, number>();
  readonly nextId = new Map<string, number>();
  readonly mustAbort = new Set<Call>();
  queue!: UseAnimationEventsReturn;
  shellAlive = true;
  reentries = 0;
  private readonly wrapper;

  constructor(readonly random: () => number) {
    const walk = this;
    const Shell = defineComponent({
      setup() {
        walk.queue = createAnimationEvents({ frame: () => walk.frame.value, handlerWaitTimeout: WAIT });
        provide(ANIMATION_EVENTS_KEY, walk.queue);
        watch(walk.queue.isAnimating, () => walk.callOut('watcher'), { flush: 'sync' });
        return () => h('div', { id: 'drawn', 'data-seq': String(walk.frame.value.seq) });
      },
    });
    this.wrapper = mount(Shell, { attachTo: document.body });
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

  violate(message: string): void {
    this.violations.push(message);
  }

  /** The state a frame landing must gate the panel from: some board can take events. */
  claimedNone(): boolean {
    return this.claims.length > 0 && this.registered.size === 0;
  }

  // --- Inputs ---------------------------------------------------------------

  land(reentrant: boolean): void {
    const roll = this.random();
    const prev = this.frame.value;
    const next: Frame = { ...prev, seq: prev.seq + 1 };
    if (roll < 0.1) next.restoreEpoch = prev.restoreEpoch! + 1;
    else if (roll < 0.2) next.viewerSeat = prev.viewerSeat === 1 ? 2 : 1;
    const changed = this.timeline(next) !== this.timeline(prev);
    if (changed) for (const call of this.running()) this.mustAbort.add(call);
    const tl = this.timeline(next);
    const count = Math.floor(this.random() * 3);
    const events = [];
    for (let i = 0; i < count; i++) {
      const id = (this.nextId.get(tl) ?? 0) + 1;
      this.nextId.set(tl, id);
      events.push({ id, type: this.pick(TYPES), data: { tl, seq: next.seq } });
    }
    next.animationEvents = events;
    this.log.push(`land seq ${next.seq} tl ${tl} [${events.map((e) => `${e.type}${e.id}`).join(' ')}]${reentrant ? ' (re-entrant)' : ''}`);
    const before = this.reentries;
    this.frame.value = next;
    // A Skip or an unmount sent from a watcher as the frame lands may rightly end its events at once.
    if (!reentrant && this.reentries === before && events.length > 0 && !this.claimedNone() && this.shellAlive && !this.queue.isAnimating.value) {
      this.violate(`isAnimating was false right after seq ${next.seq} landed with events`);
    }
  }

  mountBoard(): void {
    const board: Board = { scope: effectScope(true), alive: true, types: new Map() };
    for (const type of TYPES) if (this.random() < 0.5) board.types.set(type, this.random() < 0.5 ? 'run' : 'drop');
    this.log.push(`mount board ${this.boards.length} [${[...board.types].map(([t, s]) => `${t}:${s}`).join(' ')}]`);
    this.boards.push(board);
    board.scope.run(() => {
      for (const [type, skip] of board.types) {
        this.registered.set(type, board);
        this.queue.registerHandler(type, (event, { signal }) => this.handle(board, skip, event, signal), { skip });
      }
    });
  }

  unmountBoard(board = this.pick(this.boards.filter((b) => b.alive))): void {
    if (!board?.alive) return;
    this.log.push(`unmount board ${this.boards.indexOf(board)}`);
    board.alive = false;
    for (const [type, owner] of this.registered) if (owner === board) this.registered.delete(type);
    for (const call of this.running()) if (call.board === board) this.mustAbort.add(call);
    board.scope.stop();
  }

  claim(): void {
    this.log.push('claim none');
    const scope = effectScope(true);
    this.claims.push(scope);
    scope.run(() => this.queue.claimNoEvents());
  }

  releaseClaim(): void {
    const scope = this.claims.shift();
    if (!scope) return;
    this.log.push('release claim');
    scope.stop();
  }

  skip(): void {
    this.log.push('skip');
    for (const call of this.running()) this.mustAbort.add(call);
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
    for (const call of this.running()) this.mustAbort.add(call);
    this.shellAlive = false;
    this.wrapper.unmount();
  }

  /** A board, listener or watcher calling back in, as the contract allows. */
  callOut(from: string): void {
    if (!this.shellAlive || this.reentries >= 3 || this.random() >= 0.3) return;
    this.reentries++;
    this.log.push(`  from ${from}:`);
    this.pick([
      () => this.land(true),
      () => this.skip(),
      () => this.mountBoard(),
      () => this.unmountBoard(),
      () => this.claim(),
      () => this.releaseClaim(),
      () => this.settle(),
    ])();
  }

  handle(board: Board, skip: 'run' | 'drop', event: { id: number; type: string; data: Record<string, unknown> }, signal: AbortSignal): Promise<void> {
    const tl = String(event.data.tl);
    const key = `${event.type}${event.id}@${tl}`;
    const kind = signal.aborted ? 'skipped' : 'play';
    this.log.push(`  ${kind === 'play' ? 'play' : 'skip-run'} ${key} on board ${this.boards.indexOf(board)}`);
    if (!board.alive) this.violate(`${key} was handed to an unmounted board`);
    if (!this.shellAlive) this.violate(`${key} was handed out after the shell unmounted`);
    if (kind === 'skipped' && skip === 'drop') this.violate(`skip: 'drop' handler was called for skipped ${key}`);
    if ((this.lastOffered.get(tl) ?? 0) >= event.id) this.violate(`${key} was offered after id ${this.lastOffered.get(tl)} of its timeline`);
    this.lastOffered.set(tl, event.id);
    if (kind === 'play') {
      const drawn = Number(document.getElementById('drawn')?.dataset.seq);
      if (drawn < Number(event.data.seq)) this.violate(`${key} played before its frame ${String(event.data.seq)} was drawn (drawn: ${drawn})`);
      const other = this.running();
      if (other.length > 0) this.violate(`${key} played while ${other.map((c) => c.key).join(', ')} still played`);
    }
    let release = () => {};
    const done = new Promise<void>((resolve) => { release = resolve; });
    const call: Call = { board, key, kind, signal, released: false, release: () => { call.released = true; release(); } };
    this.calls.push(call);
    signal.addEventListener('abort', () => this.callOut(`abort of ${key}`));
    this.callOut(`handler of ${key}`);
    if (this.random() < 0.3) call.release();
    return done;
  }

  // --- Invariants -----------------------------------------------------------

  check(): void {
    for (const call of this.mustAbort) if (!call.signal.aborted) this.violate(`${call.key}'s signal did not abort`);
    this.mustAbort.clear();
    const { isAnimating, pendingCount } = this.queue;
    if (!isAnimating.value && pendingCount.value !== 0) this.violate(`pendingCount was ${pendingCount.value} while isAnimating was false`);
    if (!isAnimating.value && this.running().length > 0) this.violate(`isAnimating was false while ${this.running()[0].key} played`);
    if (!this.shellAlive && isAnimating.value) this.violate('isAnimating stayed true after the shell unmounted');
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
  for (const board of walk.boards) walk.unmountBoard(board);
  for (let i = 0; i < 20 && walk.queue.isAnimating.value; i++) await vi.advanceTimersByTimeAsync(WAIT);
  walk.check();
  if (walk.queue.isAnimating.value) walk.violate('the queue never ran dry once every board unmounted');

  walk.unmountShell();
  walk.check();
  await flush();
  if (walk.violations.length > 0) throw new Error(fail());
  if (vi.mocked(console.error).mock.calls.length > 0) throw new Error(`seed ${seed}: console.error ${String(vi.mocked(console.error).mock.calls[0])}\n\n${walk.log.join('\n')}`);
  return walk;
}

const walked: string[] = [];

describe('the animation queue contract, on a seeded random walk (#1820)', () => {
  it.each(Array.from({ length: 150 }, (_, i) => `walk-${i}`))('holds on %s', async (seed) => {
    walked.push((await runWalk(seed)).log.join('\n'));
  });

  it('reached every kind of call-out on those walks', () => {
    const logs = walked.join('\n');
    for (const from of ['from watcher', 'from abort of', 'from handler of', 'skip-run', '(re-entrant)', 'unmount board']) {
      expect(logs).toContain(from);
    }
  });
});
