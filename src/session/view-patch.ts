/**
 * What changed in a seat's view between two pushes (#1616).
 *
 * A host pushes a page the whole view once (on connect, reconnect, a change of
 * seat), then only a {@link ViewPatch} against the view it last pushed. Every
 * view a host hands out carries `rev`, a digest of its content
 * ({@link stampRev}), and a patch names the `rev` it was made against, so a page
 * that does not hold that view (it missed a push, or was served a newer view of
 * record) knows it, and asks the host for the whole view instead.
 *
 * Imports nothing, so it runs wherever `SnapshotSessionHost` does, and on the page.
 */

/** Where in a view: object keys and array indices, from the root. */
export type ViewPath = ReadonlyArray<string | number>;

/**
 * One change, applied in order: `set` the value at a path, `del` an object's
 * key, or `splice` the array at a path (`start`, `deleteCount`, the items to
 * insert), exactly as `Array.prototype.splice` would.
 */
export type ViewPatchOp =
  | readonly ['set', ViewPath, unknown]
  | readonly ['del', ViewPath]
  | readonly ['splice', ViewPath, number, number, unknown[]];

/** The changes that turn the view whose `rev` is `base` into the next one. */
export interface ViewPatch {
  base: string;
  ops: ViewPatchOp[];
}

type Holder = Record<string, unknown>;

function isHolder(value: unknown): value is Holder {
  return typeof value === 'object' && value !== null;
}

/**
 * cyrb128's four independently mixed 32-bit lanes over `text`.
 * Not cryptographic, which it need not be: no one chooses the views compared
 * here to collide, and with the text's length appended, two different views
 * of one seat sharing a digest by accident is vanishingly unlikely.
 * Synchronous and import-free, because it runs inside a Worker as well as in
 * Node and on the page.
 */
function lanes(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4];
}

/** A 128-bit digest of `text`, its length appended. */
export function digest(text: string): string {
  return lanes(text).map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('') + `:${text.length}`;
}

/**
 * Where a seat view carries its animation events. A host holds back a view
 * whose only change is a buffer another seat's action emptied (#487), so a
 * page may hold that view or the one before it: `rev` leaves the events out,
 * and every patch states them whole ({@link diffPushedView}).
 */
const EVENT_PATHS: readonly ViewPath[] = [
  ['state', 'animationEvents'],
  ['state', 'lastAnimationEventId'],
  ['state', 'view', 'animationEvents'],
];

/** The value at `path` in `view`, or `undefined`. */
function at(view: unknown, path: ViewPath): unknown {
  return path.reduce<unknown>((value, key) => (isHolder(value) ? value[key] : undefined), view);
}

/** `view` without its animation events, sharing everything else with it. */
function withoutEvents(view: unknown): unknown {
  return EVENT_PATHS.reduce((stripped, path) => (at(stripped, path) === undefined ? stripped : patchView(stripped, [['del', path]])), view);
}

/** `view` with `rev`, the digest of everything else in it but its animation events. A view that is not an object is returned as it is. */
export function stampRev<V>(view: V): V & { rev: string } {
  if (!isHolder(view) || Array.isArray(view)) return view as V & { rev: string };
  const { rev: _stale, ...content } = view as Holder;
  return { ...content, rev: digest(JSON.stringify(withoutEvents(content))) } as V & { rev: string };
}

/** The `rev` a view carries, if any. */
export function revOf(view: unknown): string | undefined {
  const rev = isHolder(view) ? view.rev : undefined;
  return typeof rev === 'string' ? rev : undefined;
}

/** An object's keys as JSON has them: a key holding `undefined` is not sent. */
function keysOf(holder: Holder): string[] {
  return Object.keys(holder).filter((key) => holder[key] !== undefined);
}

/** True when `a` and `b` are the same JSON value. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isHolder(a) || !isHolder(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown as unknown[];
    return a.length === other.length && a.every((item, i) => same(item, other[i]));
  }
  const keys = keysOf(a);
  return keys.length === keysOf(b).length && keys.every((key) => same(a[key], b[key]));
}

/** The ops that turn `from` into `to`, both JSON values. Empty when they are the same. */
export function diffView(from: unknown, to: unknown): ViewPatchOp[] {
  const ops: ViewPatchOp[] = [];
  diffInto(ops, [], from, to);
  return ops;
}

function diffInto(ops: ViewPatchOp[], path: Array<string | number>, from: unknown, to: unknown): void {
  if (from === to) return;
  if (!isHolder(from) || !isHolder(to) || Array.isArray(from) !== Array.isArray(to)) {
    if (!same(from, to)) ops.push(['set', [...path], to]);
    return;
  }
  if (Array.isArray(from)) diffArray(ops, path, from, to as unknown as unknown[]);
  else diffObject(ops, path, from, to);
}

function diffObject(ops: ViewPatchOp[], path: Array<string | number>, from: Holder, to: Holder): void {
  for (const key of keysOf(from)) {
    if (to[key] === undefined) ops.push(['del', [...path, key]]);
  }
  for (const key of keysOf(to)) {
    if (from[key] === undefined) ops.push(['set', [...path, key], to[key]]);
    else diffInto(ops, [...path, key], from[key], to[key]);
  }
}

/**
 * Arrays change at their ends (a log line, a card drawn) far more than in the
 * middle, so the items both ends share are kept, and lines pruned from the
 * front of a log are dropped rather than every later line resent. What is left
 * is changed in place when it kept its length, and replaced when it did not.
 */
function diffArray(ops: ViewPatchOp[], path: Array<string | number>, from: unknown[], to: unknown[]): void {
  const dropped = frontDropped(from, to);
  if (dropped > 0) ops.push(['splice', [...path], 0, dropped, []]);
  const held = from.length - dropped;
  const [head, tail] = sharedEnds(from.slice(dropped), to);
  const removed = held - head - tail;
  const added = to.length - head - tail;
  if (removed === added) {
    for (let i = head; i < head + added; i++) diffInto(ops, [...path, i], from[dropped + i], to[i]);
  } else {
    ops.push(['splice', [...path], head, removed, to.slice(head, head + added)]);
  }
}

/** How many items `a` and `b` share at their start, and then at their end. */
function sharedEnds(a: unknown[], b: unknown[]): [number, number] {
  let head = 0;
  while (head < a.length && head < b.length && same(a[head], b[head])) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && same(a[a.length - 1 - tail], b[b.length - 1 - tail])) tail++;
  return [head, tail];
}

/** How many items were dropped from the front of `from` to start `to`: `to` begins with all the rest. 0 when none were. */
function frontDropped(from: unknown[], to: unknown[]): number {
  if (from.length === 0 || to.length === 0 || same(from[0], to[0])) return 0;
  for (let k = 1; k < from.length; k++) {
    const rest = from.length - k;
    if (rest > to.length) continue;
    let i = 0;
    while (i < rest && same(from[k + i], to[i])) i++;
    if (i === rest) return k;
  }
  return 0;
}

/**
 * The ops that turn a seat view pushed `from` into `to`, which also turn any
 * view with `from`'s `rev` into `to`: its animation events are set whole,
 * since they are the part `rev` leaves out.
 */
export function diffPushedView(from: unknown, to: unknown): ViewPatchOp[] {
  const ops = diffView(withoutEvents(from), withoutEvents(to));
  for (const path of EVENT_PATHS) {
    const value = at(to, path);
    if (value !== undefined) ops.push(['set', path, value]);
    else if (isHolder(at(to, path.slice(0, -1)))) ops.push(['del', path]);
  }
  return ops;
}

/**
 * `held` with `ops` applied. Unchanged subtrees are the same objects as in
 * `held`, so a computed or a component that reads only them does not re-run;
 * `held` itself is never changed.
 */
export function patchView(held: unknown, ops: readonly ViewPatchOp[]): unknown {
  const root = { value: held };
  const fresh = new Set<object>([root]);
  for (const op of ops) {
    const [kind, path] = op;
    const steps: Array<string | number> = ['value', ...path];
    const key = steps.pop()!; // Never undefined: steps starts with 'value'.
    const parent = steps.reduce<Holder>((container, step) => writable(container, step, fresh), root);
    // Defined, not assigned: JSON.parse makes `__proto__` an own key, and assigning one would set the prototype.
    if (kind === 'set') Object.defineProperty(parent, key, { value: op[2], writable: true, enumerable: true, configurable: true });
    else if (kind === 'del') delete parent[key];
    else (writable(parent, key, fresh) as unknown as unknown[]).splice(op[2], op[3], ...op[4]);
  }
  return root.value;
}

/** `container[key]`, copied into `container` first unless this patch already copied it. */
function writable(container: Holder, key: string | number, fresh: Set<object>): Holder {
  const child = container[key];
  if (!isHolder(child)) {
    throw new Error(`A view patch reaches through "${String(key)}", which the view does not hold as an object or array.`);
  }
  if (fresh.has(child)) return child;
  const copy = Array.isArray(child) ? [...child] : { ...child };
  fresh.add(copy);
  container[key] = copy;
  return copy as Holder;
}

/**
 * The view `patch` turns `held` into, or `undefined` when `held` is not the
 * view the patch was made against: the page missed a push or holds another
 * view, and must ask the host for the whole view.
 */
export function applyViewPatch(held: unknown, patch: ViewPatch): unknown {
  if (revOf(held) !== patch.base) return undefined;
  return patchView(held, patch.ops);
}
