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
