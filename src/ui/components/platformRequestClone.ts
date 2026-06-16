import { isRef, unref, toRaw } from 'vue';

/**
 * Throws an actionable error if `payload` cannot survive postMessage's
 * structured clone (e.g. a live game-element object leaked into op args).
 */
export function assertCloneable(op: string, payload: unknown): void {
  try {
    structuredClone(payload);
  } catch {
    throw new Error(
      `platformRequest('${op}'): payload is not structured-cloneable — a game-element ` +
      `object likely leaked into the op args. Pass plain ids/values, not live elements.`
    );
  }
}

/**
 * Recursively strip Vue reactivity (refs + reactive/readonly proxies) from a value
 * so plain data survives `structuredClone`. A Vue reactive proxy is NOT
 * structured-cloneable, and passing `someRef.value` (e.g. a selected-card id array)
 * straight into action args is the natural thing a game author writes — so the easy
 * path must just work.
 *
 * Genuine non-plain objects (class instances such as live game elements) are left
 * intact, so `assertCloneable` still fails loud on a real element leak.
 */
function deepUnwrap(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (isRef(value)) value = unref(value);
  const raw = value && typeof value === 'object' ? toRaw(value as object) : value;
  if (raw === null || typeof raw !== 'object') return raw;
  if (seen.has(raw as object)) return seen.get(raw as object);

  if (Array.isArray(raw)) {
    const out: unknown[] = [];
    seen.set(raw as object, out);
    for (const item of raw) out.push(deepUnwrap(item, seen));
    return out;
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto === Object.prototype || proto === null) {
    const out: Record<string, unknown> = {};
    seen.set(raw as object, out);
    for (const key of Object.keys(raw as Record<string, unknown>)) {
      out[key] = deepUnwrap((raw as Record<string, unknown>)[key], seen);
    }
    return out;
  }

  // Non-plain object (class instance / live game element) — leave as-is so
  // assertCloneable rejects a genuine live-element leak with an actionable error.
  return raw;
}

/**
 * Normalize an op payload into a structured-cloneable, reactivity-free value, then
 * assert it really is cloneable. Use this at the platform boundary so reactive args
 * (the easy path) work while genuine non-cloneable leaks still fail loud.
 */
export function toCloneablePayload<T>(op: string, payload: T): T {
  const plain = deepUnwrap(payload, new WeakMap()) as T;
  assertCloneable(op, plain);
  return plain;
}
