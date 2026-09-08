/**
 * Issue #219: WHAT A DECLARATION HOLDS IS A READ, AND THE OBJECT SAYS SO.
 *
 * A command's `partitions(args, seat, world)` and a bundle's
 * `view(seat, world)` are answered against resident state (#122), and the
 * accessor they read through handed over the LIVE element. The read-only
 * invariant was enforced by a comment, so
 * `world.partition("room:1").at.count = 5` compiled, ran, and landed outside
 * both protections the handler surface has:
 *
 *   ON THE DISPATCH PATH the declaration runs BEFORE the rollback snapshot is
 *     taken, so a declare-time write is captured INTO the snapshot: a later
 *     refusal "rolls back" to the mutated state and the write survives a
 *     command the player was told was refused.
 *   ON THE VIEW PATH there is no snapshot at all, and the next command's
 *     dispatch clears the touched record before anything serializes it. Every
 *     watcher sees the change, no checkpoint ever writes it, and hibernation
 *     silently reverts it.
 *
 * That is the #152 failure class -- the wrong way exactly as easy as the right
 * way, and silently reverted -- reintroduced on the declaration surface after
 * being closed on the handler surface. So the wrong way is off the surface:
 * what a declaration receives cannot be written through at all.
 *
 * ## Why a proxy, and not a freeze or a fingerprint
 *
 * `Object.freeze` is permanent and the engine holds the same objects: freezing
 * a partition root to answer one declaration would break every command after
 * it.
 *
 * FINGERPRINTING AFTERWARDS -- serialize every resident partition before and
 * after the declaration and refuse on a difference -- detects the write but
 * costs O(resident) serialization per declaration round, in the one mode whose
 * whole argument is that a command costs O(room). A correctness fix that
 * deletes the cost model is not a fix.
 *
 * ## Why the methods are bound to the PROXY
 *
 * Blocking assignment alone would be a half-measure: `putInto` mutates through
 * its own `this`, so a declaration could still move an element. Every function
 * read off a projection is therefore invoked with the PROXY as its receiver,
 * so the writes a mutating method performs on its own internals -- splicing a
 * children array, assigning a parent -- reach these same traps and are refused
 * there. Reads need nothing but reads, so they are unaffected.
 */
import { worldRefusal } from "./refusals.js";

/**
 * Objects whose methods may run with the projection as their receiver.
 *
 * Ordinary objects, class instances and arrays -- which is everything the
 * element tree is built from, and everything a mutating method could write
 * through. A `Map`, a `Set`, a `Date`, a `Promise` or an array ITERATOR carries
 * internal slots that only its own instance has, so calling one through a
 * proxy throws "incompatible receiver" and the read a declaration was making
 * fails for no reason a bundle author could act on. Those are invoked against
 * the real object, and the mutators they DO have are named below.
 */
const RECEIVER_SAFE_TAGS = new Set(["[object Object]", "[object Array]", "[object Function]"]);

/**
 * Built-in mutators, for the objects that cannot take the projection as their
 * receiver.
 *
 * A CLOSED list over a fixed standard API rather than a guess about an
 * evolving one, which is what makes naming them acceptable here and not on
 * `GameElement`. Nothing in the element tree is one of these; they appear only
 * as engine bookkeeping a declaration can reach by reading far enough.
 */
const BUILTIN_MUTATORS = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "setTime",
  "setDate",
  "setFullYear",
  "setHours",
  "setMilliseconds",
  "setMinutes",
  "setMonth",
  "setSeconds",
  "setUTCDate",
  "setUTCFullYear",
  "setUTCHours",
  "setUTCMilliseconds",
  "setUTCMinutes",
  "setUTCMonth",
  "setUTCSeconds",
]);

/** One projection per object, so repeated reads of the same element answer the
 *  same wrapper and a declaration can compare two of them. */
const projections = new WeakMap<object, object>();

/**
 * EVERY PROJECTION THIS MODULE HAS MINTED (#374).
 *
 * `projections` answers "what is the wrapper for this object"; it cannot answer
 * "is this object already a wrapper", because a proxy is not a key anybody put
 * in it. Without that second question `readOnlyProjection` wrapped its own
 * output: a method runs with the projection as its receiver (see the header),
 * so what it RETURNS came back through these traps already projected, and the
 * `get` trap projected it again.
 *
 * That cost twice. It broke the identity guarantee one paragraph up -- the same
 * element read directly and read through a finder compared unequal, so a
 * declaration asking "is this the token in that room" got false from two reads
 * of one token. And it charged a trap hop per layer on every subsequent read,
 * which is how a finder over 500 roots came to cost seconds rather than
 * milliseconds.
 *
 * A projection is already read-only. Wrapping it again buys no enforcement.
 */
const minted = new WeakSet<object>();

/**
 * The wrapper for one function, per object it was read off (#374).
 *
 * Every read of a function property used to build a fresh closure, so a tree
 * walk allocated one per method per element VISITED -- garbage proportional to
 * the tree rather than to the question. Keyed by the underlying function and
 * not by the property name, so an object that swaps a method out is answered
 * with a new wrapper rather than a stale one.
 */
const methodWrappers = new WeakMap<object, WeakMap<object, unknown>>();

function cachedWrapper(target: object, call: object, build: () => unknown): unknown {
  let forTarget = methodWrappers.get(target);
  if (forTarget === undefined) {
    forTarget = new WeakMap<object, unknown>();
    methodWrappers.set(target, forTarget);
  }
  const existing = forTarget.get(call);
  if (existing !== undefined) return existing;
  const built = build();
  forTarget.set(call, built);
  return built;
}

function refuseWrite(property: string | symbol): never {
  throw worldRefusal(
    "declaration-write",
    `A declaration tried to write "${String(property)}". A command's partitions() and a ` +
      "world's view() say WHICH partitions they are about; they run before the platform has " +
      "decided what this command may change, so nothing they write could be checkpointed -- it " +
      "would either ride a rollback the player was told discarded it, or be reverted at the " +
      "next hibernation with nobody told at all. Move the write into the command's run().",
  );
}

function takesProjectionAsReceiver(value: object): boolean {
  return RECEIVER_SAFE_TAGS.has(Object.prototype.toString.call(value));
}

/**
 * The same value, readable and not writable, all the way down.
 *
 * Primitives are returned as they are: a number read off an element is a copy
 * already, and nothing a declaration does to it can reach the world.
 */
export function readOnlyProjection<T>(value: T): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const subject = value as unknown as object;
  // ALREADY READ-ONLY, SO ALREADY DONE (#374). This is the branch that keeps a
  // method's projected return value from being projected a second time.
  if (minted.has(subject)) return value;
  const existing = projections.get(subject);
  if (existing !== undefined) return existing as T;

  const projection = new Proxy(subject, {
    get(target, property, receiver) {
      const held = Reflect.get(target, property, receiver);
      if (typeof held !== "function") return readOnlyProjection(held);
      const call = held as (...a: unknown[]) => unknown;
      // A MUTATOR IS REFUSED BEFORE IT IS CACHED, so the refusal names the
      // property it was reached by rather than whichever name got there first.
      const safeReceiver = takesProjectionAsReceiver(target);
      if (!safeReceiver && BUILTIN_MUTATORS.has(property as string)) refuseWrite(property);
      // ONE WRAPPER PER FUNCTION, not one per read (#374). Only when the
      // receiver is this projection: reached along a prototype chain from some
      // other object, the receiver differs and the wrapper below would close
      // over the wrong one.
      const build = safeReceiver
        ? // THE RECEIVER IS THE PROJECTION wherever it can be, so a mutating
          // method -- `putInto` splicing a children array, say -- reaches these
          // same traps on its own internals and is refused there. Blocking
          // assignment alone would leave every mutating method open.
          () =>
            function (this: unknown, ...args: unknown[]) {
              return readOnlyProjection(Reflect.apply(call, projection, args));
            }
        : () => (...args: unknown[]) => readOnlyProjection(Reflect.apply(call, target, args));
      if (receiver !== projection) return build();
      return cachedWrapper(target, call, build);
    },
    set(_target, property) {
      refuseWrite(property);
    },
    defineProperty(_target, property) {
      refuseWrite(property);
    },
    deleteProperty(_target, property) {
      refuseWrite(property);
    },
    setPrototypeOf() {
      refuseWrite("the prototype");
    },
  });

  projections.set(subject, projection);
  minted.add(projection);
  return projection as T;
}
