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
 *
 * ## Except the engine's own read doors, which run on the real element
 *
 * ShufflewickPub #409. Binding to the proxy costs the WHOLE method body: a
 * finder run with the projection as its receiver reaches these traps on every
 * step of its own walk, so `first(Room, "room-499")` over 500 roots pays a trap
 * per element visited rather than one for the element it answers with. Measured
 * at 16x the live tree, and a world's OFFER is a fan-out of finders -- every
 * action's condition, its greying rule and every selection's candidates, per
 * seat, for the whole audience of a change. At 500 seats that made an offer
 * fan-out 2277 ms, 4.55 ms a seat, against a view fan-out's 208 ms -- and 95%
 * of the difference was here rather than in anything an offer decides, since
 * the same fan-out with this projection stubbed out entirely costs 125 ms.
 *
 * So `ENGINE_READ_DOORS` names the engine's own reads, and one read off a
 * projection runs against the REAL object with only its answer projected.
 *
 * AN ALLOWLIST, WHICH IS THE SAFE SIDE OF THE LEDGER. This names what MAY
 * skip the traps, so a method nobody remembers to name is merely slow. A list
 * of what must NOT run would turn every method nobody named into a hole, which
 * is why the built-in objects below are held to an allowlist too (#1171).
 *
 * ## And a CLOAKED TARGET, for the values a proxy may not wrap (#247)
 *
 * A proxy is not free to answer a `get` with whatever it likes. Where the
 * target holds a property that can never be replaced -- a data property that is
 * neither writable nor configurable, which is exactly what `Object.freeze`
 * makes of every own property -- the language requires the `get` trap to hand
 * back THAT VALUE, by identity, and throws a TypeError if it does not. A
 * projection is by definition not that value, so a declaration that read one
 * property deeper into a frozen object died in the engine before it ran:
 *
 *     TypeError: 'get' on proxy: property 'holding' is a read-only and
 *     non-configurable data property on the proxy target but the proxy did not
 *     return its actual value
 *
 * Frozen values are ordinary game code, not a mistake: a bundle that caches a
 * detached snapshot freezes it so nothing downstream can edit the cache. So the
 * invariant is real and the read is legitimate, and the two cannot both be
 * served over the frozen object itself.
 *
 * HANDING THE RAW VALUE BACK IS NOT THE ANSWER. The slot is immutable, but what
 * it POINTS AT need not be: `Object.freeze({ holding: liveElement })` locks the
 * reference and locks nothing about the element. Answering with the real value
 * would hand a declaration the live tree one property along -- #219 exactly,
 * reached through a freeze -- and a walk deep enough to prove the whole graph
 * immutable is the O(resident) cost this module exists to avoid.
 *
 * So the proxy is built over a CLOAK: an empty object (or array, or function) of
 * the subject's own shape, which holds no property at all for the invariant to
 * be about. Every trap answers from the real subject, so the projection reads,
 * enumerates, calls and refuses writes exactly as it did -- the target is simply
 * no longer the thing being projected. `cloakFor` says why every subject is
 * cloaked rather than only the frozen ones.
 */
import { worldRefusal } from "./refusals.js";
import { ElementCollection, Game, GameElement, PersistentMap } from "../engine/index.js";

/**
 * Objects whose methods may run with the projection as their receiver.
 *
 * Ordinary objects, class instances and arrays -- which is everything the
 * element tree is built from, and everything a mutating method could write
 * through. A `Map`, a `Set`, a `Date`, a TypedArray or an iterator carries
 * internal slots that only its own instance has, so calling one through a
 * proxy throws "incompatible receiver" and the read a declaration was making
 * fails for no reason a bundle author could act on. Those are invoked against
 * the real object, and only for the reads named below.
 */
const RECEIVER_SAFE_TAGS = new Set(["[object Object]", "[object Array]", "[object Function]"]);

const ITERATOR_PROTOTYPE = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;

/**
 * THE READS A BUILT-IN OBJECT MAY ANSWER, AND NOTHING ELSE (#1171).
 *
 * These run against the real object, so a write among them would land on the
 * live world. Naming the writes instead missed TypedArray `fill` and `sort`,
 * and would have let every write method a later standard adds (`getOrInsert`)
 * straight through. Named here, a method nobody listed is refused.
 *
 * Taken off the prototypes by IDENTITY, as the engine's read doors are, so a
 * subclass that overrides `get` runs a different function and is refused too.
 * A getter is listed by its name, like a method.
 */
const BUILTIN_READ_NAMES: ReadonlyArray<readonly [object, ReadonlyArray<string | symbol>]> = [
  [Object.prototype, ["hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf"]],
  [Map.prototype, ["entries", "forEach", "get", "has", "keys", "size", "values"]],
  [Set.prototype, ["entries", "forEach", "has", "keys", "size", "values"]],
  [WeakMap.prototype, ["get", "has"]],
  [WeakSet.prototype, ["has"]],
  [PersistentMap.prototype, ["entries", "forEach", "get", "has", "keys", "size", "values", Symbol.iterator, Symbol.toStringTag]],
  [
    Object.getPrototypeOf(Uint8Array.prototype) as object,
    [
      "at", "byteLength", "byteOffset", "entries", "every", "filter", "find", "findIndex", "findLast",
      "findLastIndex", "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "length", "map",
      "reduce", "reduceRight", "slice", "some", "subarray", "toLocaleString", "toReversed", "toSorted",
      "toString", "values", "with", Symbol.toStringTag,
    ],
  ],
  [
    Date.prototype,
    [
      "getDate", "getDay", "getFullYear", "getHours", "getMilliseconds", "getMinutes", "getMonth", "getSeconds",
      "getTime", "getTimezoneOffset", "getUTCDate", "getUTCDay", "getUTCFullYear", "getUTCHours",
      "getUTCMilliseconds", "getUTCMinutes", "getUTCMonth", "getUTCSeconds", "toDateString", "toISOString",
      "toJSON", "toLocaleDateString", "toLocaleString", "toLocaleTimeString", "toString", "toTimeString",
      "toUTCString", "valueOf", Symbol.toPrimitive,
    ],
  ],
  [ITERATOR_PROTOTYPE, [Symbol.iterator]],
  [Object.getPrototypeOf(new Map().keys()) as object, ["next"]],
  [Object.getPrototypeOf(new Set().keys()) as object, ["next"]],
  [Object.getPrototypeOf([].keys()) as object, ["next"]],
];

/**
 * THE ARRAY METHODS THAT ANSWER A FRESH ARRAY OF THEIR OWN (#1327).
 *
 * Run with the projection as receiver, each reads every element through the
 * traps, so what it builds holds projections only. The array itself belongs to
 * the caller and reaches nothing in the world, so projecting it again would only
 * make a local value refuse `structuredClone` and writes a spread copy accepts.
 * Taken by identity, so an override that answers live state is projected as before;
 * ElementCollection's own filter and slice only narrow the type of Array's.
 */
const FRESH_ARRAY_BUILDERS = new WeakSet<object>([
  ...["concat", "filter", "flat", "flatMap", "map", "slice", "toReversed", "toSorted", "toSpliced", "with"].map(
    // Read by name, not typed: a game's tsconfig lib may predate toSorted and its kin.
    (name) => (Array.prototype as unknown as Record<string, object>)[name],
  ),
  ElementCollection.prototype.filter,
  ElementCollection.prototype.slice,
]);

const BUILTIN_READS = new WeakSet<object>();
for (const [prototype, names] of BUILTIN_READ_NAMES) {
  for (const name of names) {
    const held = Object.getOwnPropertyDescriptor(prototype, name);
    const read = held?.get ?? held?.value;
    if (typeof read === "function") BUILTIN_READS.add(read);
  }
}

/** One property, read through the projection; on a built-in object only a listed
 *  getter (`size`, `length`) runs, with the real object as its receiver, as a listed method does. */
function readProperty(subject: object, property: string | symbol, receiver: unknown, safeReceiver: boolean): unknown {
  if (safeReceiver) return Reflect.get(subject, property, receiver);
  for (let holder: object | null = subject; holder !== null; holder = Object.getPrototypeOf(holder)) {
    const held = Reflect.getOwnPropertyDescriptor(holder, property);
    if (held === undefined) continue;
    if (held.get === undefined) return Reflect.get(subject, property, receiver);
    if (!BUILTIN_READS.has(held.get)) refuseBuiltinCall(subject, property);
    return Reflect.apply(held.get, subject, []);
  }
  return undefined;
}

/** A built-in method or getter the read list does not name: it might be a write, so it is not run. */
function refuseBuiltinCall(subject: object, property: string | symbol): never {
  const kind = Object.prototype.toString.call(subject).slice("[object ".length, -1);
  throw worldRefusal(
    "declaration-write",
    `A read-only view of this world cannot call "${String(property)}" on a ${kind}: it is not one of the ` +
      "built-in reads a world callback may call, and anything else might change the object. Use a read " +
      "such as get, has, keys, values, entries, forEach or size, or, if the call changes state, move it " +
      "into the command's run() (or, from a migration's survey.root(), into its partition() hook).",
  );
}

/**
 * THE ENGINE'S OWN READS, BY NAME (ShufflewickPub #409).
 *
 * Each of these answers a question about the tree and writes nothing, so it may
 * run against the real element with only its answer projected. See the header
 * for why an allowlist and not a mutator list.
 *
 * Taken off the prototypes by IDENTITY and not by name, so a game class that
 * overrides `first` is a different function, is not in this set, and takes the
 * ordinary trapped road. `sortBy` and `shuffle` are deliberately absent: they
 * reorder the collection in place.
 */
const ENGINE_READ_DOOR_NAMES = [
  "all",
  "atBranch",
  "atId",
  "branch",
  "contains",
  "count",
  "findById",
  "first",
  "firstN",
  "getEffectiveOwner",
  "getEffectiveVisibility",
  "getElementById",
  "has",
  "hasId",
  "indexOfElement",
  "isEmpty",
  "isMine",
  "isVisible",
  "isVisibleTo",
  "last",
  "lastN",
  "max",
  "min",
  "sum",
  "toString",
  "unique",
];

const ENGINE_READ_DOORS = new WeakSet<object>();
for (const prototype of [GameElement.prototype, Game.prototype, ElementCollection.prototype]) {
  for (const name of ENGINE_READ_DOOR_NAMES) {
    const held = (prototype as unknown as Record<string, unknown>)[name];
    if (typeof held === "function") ENGINE_READ_DOORS.add(held);
  }
}

/** A base whose constructor answers the object it is handed, so a subclass's
 *  private field is stamped onto an object it did not build: the projection. */
class Stamped {
  constructor(held: object) {
    return held as Stamped;
  }
}

/**
 * THE SOURCE A PROJECTION WAS MINTED FOR, kept on the projection itself (#374, #1438).
 *
 * A projection handed back into a read door has to go in as the object it
 * wraps, and a projection projected again has to come back as itself. Keeping
 * that on the projection, rather than in a table of every projection ever
 * minted, is what lets a scope's table die with its call: module-wide weak
 * tables reached millions of entries and slowed every later call 5-20x.
 *
 * A PRIVATE FIELD, because reading it runs no trap and no getter. A property
 * key would be handed to any Proxy game code passes in, and that key would
 * then open every projection's live object.
 */
class Projected extends Stamped {
  readonly #source: object;

  private constructor(projection: object, source: object) {
    super(projection);
    this.#source = source;
  }

  static stamp(projection: object, source: object): void {
    new Projected(projection, source);
  }

  /** The object a projection was minted for, or undefined for anything else. */
  static sourceOf(value: object): object | undefined {
    return #source in value ? (value as Projected).#source : undefined;
  }
}

function refuseWrite(property: string | symbol): never {
  throw worldRefusal(
    "declaration-write",
    `A read-only view of this world tried to write "${String(property)}". A command's ` +
      "partitions() and a world's view() say WHICH partitions they are about; they run before " +
      "the platform has decided what this command may change, so nothing they write could be " +
      "checkpointed -- it would either ride a rollback the player was told discarded it, or be " +
      "reverted at the next hibernation with nobody told at all. Move the write into the " +
      "command's run(). A migration's survey.root() reads through the same projection, for the " +
      "same reason: it folds the world into a digest before any root is written and a host " +
      "re-runs it a page at a time, so its writes would be stored by nothing. Move that write " +
      "into the migration's partition() hook, which is handed the completed digest.",
  );
}

function takesProjectionAsReceiver(value: object): boolean {
  return RECEIVER_SAFE_TAGS.has(Object.prototype.toString.call(value));
}

/**
 * WHAT A READ DOOR IS HANDED, ON THE LIVE TREE'S OWN TERMS (#409).
 *
 * A door runs against the real element, so an argument that came out of a
 * projection has to go back in as the object it wraps -- `contains(token)`,
 * `indexOfElement(token)`, a finder keyed on a player -- or the door would
 * compare a wrapper against the element it wraps and answer no.
 *
 * A FINDER CALLBACK IS THE OTHER DIRECTION. `all(Room, (room) => ...)` is
 * bundle code, and it is handed elements off the live tree, so it is wrapped to
 * project what it receives: the offer path has no rollback and no checkpoint,
 * and a predicate that wrote would be exactly the #219 hole one argument along.
 *
 * A finder OBJECT (`{ player }`) is rebuilt with its values unwrapped for the
 * same reason its element form is. The caller's own object is never touched.
 */
function throughTheDoor(args: unknown[], table: Table): unknown[] {
  for (let index = 0; index < args.length; index++) {
    args[index] = liveArgument(args[index], table);
  }
  return args;
}

function liveArgument(argument: unknown, table: Table): unknown {
  if (argument === null || (typeof argument !== "object" && typeof argument !== "function")) {
    return argument;
  }
  const held = Projected.sourceOf(argument);
  if (held !== undefined) return held;
  if (typeof argument === "function") return projectingCallback(argument, table);
  if (Object.prototype.toString.call(argument) !== "[object Object]") return argument;
  return liveFinderObject(argument as Record<string, unknown>, table);
}

/**
 * A CLASS IS CODE, NOT WORLD STATE (#285), so it is never projected.
 *
 * `element.constructor`, or a class a bundle keeps as a value, has to answer as
 * that class: the same identity, name and static members it has in `execute`.
 * A finder recognises a class by its static `isGameElement`, so a wrapper made
 * `game.first(element.constructor)` a predicate call instead of a class search.
 *
 * Handing it over opens nothing. No partition holds a class and no checkpoint
 * records one, and its prototype -- the only road from a class to an element's
 * methods -- is already what `Object.getPrototypeOf` answers for a projection.
 *
 * The `prototype` check comes first because it is cheap and rules out every
 * method and arrow function, which are what this is asked about on the hot road.
 */
function isClass(value: object): boolean {
  return (
    Object.hasOwn(value, "prototype") &&
    /^class[\s{]/.test(Function.prototype.toString.call(value))
  );
}

/** A finder's own predicate, handed projected elements. */
function projectingCallback(argument: object, table: Table): unknown {
  // A CLASS IS A FINDER'S SUBJECT AND NOT ITS CALLBACK. Wrapping one would hand
  // the door an arrow function where it expects a constructor.
  if (isClass(argument)) return argument;
  const call = argument as (this: unknown, ...a: unknown[]) => unknown;
  // A function, not an arrow, so a caller's thisArg (as forEach takes) reaches the predicate, projected too.
  return function (this: unknown, ...inner: unknown[]) {
    return call.apply(project(this, table), inner.map((one) => project(one, table)));
  };
}

/** A finder written as `{ player }` or `{ name }`, with anything projected in
 *  it put back as the object it wraps. The caller's own object is never
 *  touched: it is answered unchanged when nothing in it was projected. */
function liveFinderObject(argument: Record<string, unknown>, table: Table): unknown {
  const unwrapped: Record<string, unknown> = {};
  let differs = false;
  for (const [key, value] of Object.entries(argument)) {
    const live = liveArgument(value, table);
    if (live !== value) differs = true;
    unwrapped[key] = live;
  }
  return differs ? unwrapped : argument;
}

/**
 * The same value, readable and not writable, all the way down.
 *
 * Primitives are returned as they are: a number read off an element is a copy
 * already, and nothing a declaration does to it can reach the world.
 */
/**
 * One property, read off a projection: the value made read-only, or the method
 * wrapped so that what it answers with is.
 */
function projectedProperty(
  target: object,
  property: string | symbol,
  receiver: unknown,
  projection: object,
  safeReceiver: boolean,
  table: Table,
  cached: (call: object, build: () => unknown) => unknown,
): unknown {
  const held = readProperty(target, property, receiver, safeReceiver);
  if (typeof held !== "function" || isClass(held)) return project(held, table);
  const call = held as (...a: unknown[]) => unknown;

  // THE ENGINE'S OWN READ, ON THE REAL OBJECT (#409). Only its answer is
  // projected, so the walk it makes to find that answer pays no traps at all --
  // which is the difference between an offer fan-out costing a multiple of the
  // live tree and costing the live tree.
  if (ENGINE_READ_DOORS.has(call)) {
    const open = () => (...args: unknown[]) =>
      project(Reflect.apply(call, target, throughTheDoor(args, table)), table);
    return receiver === projection ? cached(call, open) : open();
  }

  // ANYTHING BUT A KNOWN READ IS REFUSED BEFORE IT IS CACHED, so the refusal
  // names the property it was reached by rather than whichever name got there first.
  if (!safeReceiver && !BUILTIN_READS.has(call)) refuseBuiltinCall(target, property);

  // ONE WRAPPER PER FUNCTION, not one per read (#374). Only when the receiver is
  // this projection: reached along a prototype chain from some other object, the
  // receiver differs and the wrapper below would close over the wrong one.
  const build = safeReceiver
    ? // THE RECEIVER IS THE PROJECTION wherever it can be, so a mutating method
      // -- `putInto` splicing a children array, say -- reaches these same traps
      // on its own internals and is refused there. Blocking assignment alone
      // would leave every mutating method open.
      () =>
        FRESH_ARRAY_BUILDERS.has(call)
          ? (...args: unknown[]) => Reflect.apply(call, projection, args)
          : function (this: unknown, ...args: unknown[]) {
              return project(Reflect.apply(call, projection, args), table);
            }
    : // The real collection is keyed by real objects, and its forEach hands back live entries (#978).
      // shortcut: a plain function used as a key is wrapped as a callback and misses; name the key methods if a game needs one.
      () => (...args: unknown[]) => project(Reflect.apply(call, target, throughTheDoor(args, table)), table);
  return receiver === projection ? cached(call, build) : build();
}

/** The write traps, which are the same whatever the subject is. Shared rather
 *  than rebuilt per projection: nothing in them closes over one. */
const REFUSALS = {
  set(_target: object, property: string | symbol): never {
    refuseWrite(property);
  },
  defineProperty(_target: object, property: string | symbol): never {
    refuseWrite(property);
  },
  deleteProperty(_target: object, property: string | symbol): never {
    refuseWrite(property);
  },
  setPrototypeOf(): never {
    refuseWrite("the prototype");
  },
  // `Object.freeze` and `Object.seal` come through here, and both are writes:
  // they would settle over the cloak, leaving a projection whose own keys the
  // language then refuses to believe.
  preventExtensions(): never {
    refuseWrite("extensibility");
  },
} as const;

/**
 * An empty stand-in of the subject's own shape, which the projection is built
 * over instead of the subject itself.
 *
 * UNCONDITIONALLY, AND NOT ONLY FOR A FROZEN SUBJECT. A scan for a locked
 * property costs one descriptor lookup per own key, which on an
 * `ElementCollection` of 500 is 500 of them for every finder that answers with
 * one -- measured at 1.9x the live tree on an `all()` fan-out, against 1.06x
 * for cloaking everything. Deciding per subject would also be a cliff rather
 * than a rule: a value frozen AFTER it was first projected would still be
 * holding a projection built over itself, and would throw the same TypeError
 * again. Every trap reads the subject either way, so the cloak changes nothing
 * a declaration can see.
 *
 * THE SHAPE IS PART OF THE ANSWER. `Array.isArray` and `typeof` read the target
 * through no trap at all, so an array must be cloaked by an array and a function
 * by a function, or a projection would stop being the kind of thing it projects.
 *
 * A FUNCTION IS CLOAKED BY ITS OWN KIND for the same reason. A normal
 * function's `prototype` is non-configurable, and a target may not hold a
 * non-configurable property the `ownKeys` answer omits -- so an arrow subject,
 * which has no `prototype`, needs an arrow cloak, and a constructor needs a
 * constructible one or `new` through the projection would be refused by the
 * language before any trap ran.
 */
function cloakFor(subject: object): object {
  if (typeof subject === "function") {
    return Object.hasOwn(subject, "prototype") ? function cloaked() {} : () => undefined;
  }
  if (Array.isArray(subject)) return [];
  return {};
}

/**
 * The subject's descriptor, told in terms the cloak can carry.
 *
 * A proxy may not report a property as non-configurable unless its target holds
 * one that is, so the answer is reported configurable -- which is true of the
 * cloak and a small lie about the subject, and costs nothing a declaration can
 * use: every road that would act on it (`set`, `defineProperty`,
 * `deleteProperty`) is refused above.
 *
 * THE EXCEPTIONS ARE WHAT THE CLOAK ITSELF LOCKS -- an array's `length` and a
 * function's `prototype`. Those are answered with the subject's value in the
 * cloak's own terms, which is a compatible answer because the cloak holds both
 * of them writable.
 */
function cloakedDescriptor(
  subject: object,
  cloak: object,
  property: string | symbol,
  table: Table,
): PropertyDescriptor | undefined {
  const subjectHeld = Reflect.getOwnPropertyDescriptor(subject, property);
  if (subjectHeld === undefined) return undefined;
  // A descriptor's value is a way to the live object too, so it is projected like a read (#800).
  const held = "value" in subjectHeld ? { ...subjectHeld, value: project(subjectHeld.value, table) } : subjectHeld;
  const onCloak = Reflect.getOwnPropertyDescriptor(cloak, property);
  if (onCloak !== undefined && !onCloak.configurable) {
    return { ...held, writable: onCloak.writable, configurable: false };
  }
  return { ...held, configurable: true };
}

/**
 * ONE READ'S PROJECTIONS (#1438): the function a call projects through.
 *
 * Within a scope one object answers one projection, so a declaration can
 * compare two reads of the same element. The scope's table is dropped with the
 * scope and with any projection it minted, so a call's cost is its own work
 * and not the number of projections earlier calls in the process minted.
 */
export function readOnlyScope(): <T>(value: T) => T {
  const table: Table = new Map();
  return (value) => project(value, table);
}

/** Source to projection, for one scope. A strong map: it lives only as long as its scope. */
type Table = Map<object, object>;

function project<T>(value: T, table: Table): T {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  const subject = value as unknown as object;
  // ALREADY READ-ONLY, SO ALREADY DONE (#374), whichever scope minted it. This
  // is the branch that keeps a method's projected return value from being
  // projected a second time.
  if (Projected.sourceOf(subject) !== undefined) return value;
  const existing = table.get(subject);
  if (existing !== undefined) return existing as T;
  if (typeof subject === "function" && isClass(subject)) return value;

  // ONE WRAPPER PER FUNCTION, not one per read (#374), kept on this projection
  // so it dies with it.
  let wrappers: Map<object, unknown> | undefined;
  const cached = (call: object, build: () => unknown): unknown => {
    wrappers ??= new Map();
    let wrapper = wrappers.get(call);
    if (wrapper === undefined) {
      wrapper = build();
      wrappers.set(call, wrapper);
    }
    return wrapper;
  };

  const cloak = cloakFor(subject);
  const safeReceiver = takesProjectionAsReceiver(subject);
  // EVERY TRAP READS THE SUBJECT, not the cloak, so the only thing the cloak
  // changes is which object the language checks its invariants against. The
  // traps below are the ones whose default would have answered from the empty
  // stand-in instead.
  const projection: object = new Proxy(cloak, {
    ...REFUSALS,
    get(_target, property, receiver) {
      return projectedProperty(subject, property, receiver, projection, safeReceiver, table, cached);
    },
    has(_target, property) {
      return Reflect.has(subject, property);
    },
    ownKeys() {
      return Reflect.ownKeys(subject);
    },
    getOwnPropertyDescriptor(target, property) {
      return cloakedDescriptor(subject, target, property, table);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(subject);
    },
    apply(_target, thisArg, args) {
      return Reflect.apply(subject as (...a: unknown[]) => unknown, thisArg, args);
    },
    construct(_target, args) {
      // A CONSTRUCTOR BUILDS FROM THE SUBJECT, never from the cloak, which
      // would answer with an instance of nothing. What it builds is projected
      // for the same reason a method's answer is.
      return project(Reflect.construct(subject as new (...a: unknown[]) => object, args), table);
    },
  });

  Projected.stamp(projection, subject);
  table.set(subject, projection);
  return projection as T;
}

/**
 * A DETACHED PLAIN COPY OF DATA A CALLBACK READ (#1347).
 *
 * Serializing through a projection pays a trap per property and mints a proxy
 * per nested object, measured at 12-36x a plain `JSON.stringify`. This walks
 * the real data instead and answers a fresh copy, so nothing it hands back
 * reaches the world. Only plain data is copied: a class instance, a built-in
 * object, a function and an accessor are refused unrun, since running one
 * against the live object is the write this module exists to prevent.
 */
export function plainCopy<T>(value: T): T {
  return copyPlain(value, [], new Set()) as T;
}

function copyPlain(value: unknown, path: string[], within: Set<object>): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const subject = plainSubject(value, path, within);
  within.add(subject);
  const copy: Record<string, unknown> = Array.isArray(subject) ? (new Array(subject.length) as never) : {};
  for (const key of Object.keys(subject)) {
    path.push(key);
    const item = copyPlain(dataValue(subject, key, path), path, within);
    // An own "__proto__" key, as JSON.parse makes, would set the copy's prototype if assigned.
    if (key === "__proto__") Object.defineProperty(copy, key, { value: item, enumerable: true, writable: true, configurable: true });
    else copy[key] = item;
    path.pop();
  }
  within.delete(subject);
  return copy;
}

/** The real object behind a value, refused unless it is a plain object or array not already being copied. */
function plainSubject(value: object, path: string[], within: Set<object>): object {
  const subject = Projected.sourceOf(value) ?? value;
  if (typeof subject === "function") refuseCopy(path, "is a function");
  if (within.has(subject)) refuseCopy(path, "refers back to an object that contains it");
  const prototype = Object.getPrototypeOf(subject) as object | null;
  const plain = Array.isArray(subject) ? prototype === Array.prototype : prototype === Object.prototype || prototype === null;
  if (!plain) refuseCopy(path, `is a ${kindOf(prototype)}`);
  return subject;
}

/** An own property's value, refused unrun when it is a getter. */
function dataValue(subject: object, key: string, path: string[]): unknown {
  const held = Object.getOwnPropertyDescriptor(subject, key)!;
  if (!("value" in held)) refuseCopy(path, "is a getter");
  return held.value;
}

/** The refused object's class name, read from its prototype's own data property so no game code runs. */
function kindOf(prototype: object | null): string {
  const named = prototype === null ? undefined : Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return typeof named === "function" && named.name !== "" ? named.name : "class instance";
}

function refuseCopy(path: string[], what: string): never {
  const where = path.length === 0 ? "the value itself" : `the value at "${path.join(".")}"`;
  throw new TypeError(
    `plainCopy copies plain data only (plain objects, arrays and primitive values such as strings and numbers), but ${where} ${what}. ` +
      "Copy only the plain fields you need, or read the rest through the read-only view as it is.",
  );
}
