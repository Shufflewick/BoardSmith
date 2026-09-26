/**
 * A BOARD THAT RECORDS EVERYTHING IT COULD INJECT, for the parity tests that
 * hold `renderAsSeat` to the real shells (#406 for GameShell, #413 for
 * WorldShell).
 *
 * Mount `KeyProbe` inside a shell and again with `renderAsSeat`, each through
 * `keysProbedIn`, and compare with `expectSeatGetsWhatTheShellGives`: any key
 * the shell's board can inject that `renderAsSeat`'s cannot is a board that
 * works in the shell and breaks in a test.
 */
import { expect } from 'vitest';
import { defineComponent, getCurrentInstance, h } from 'vue';

let reached: Set<PropertyKey> | undefined;

export const KeyProbe = defineComponent({
  name: 'KeyProbe',
  setup() {
    const keys = new Set<PropertyKey>();
    // A component's `provides` inherits from its parent's by prototype, down to
    // the app's own record, so walking the chain is every key it can inject.
    let provides: object | null = (getCurrentInstance() as unknown as { provides: object }).provides;
    while (provides) {
      for (const key of Reflect.ownKeys(provides)) keys.add(key);
      provides = Object.getPrototypeOf(provides) as object | null;
    }
    reached = keys;
    return () => h('div', { class: 'probe' });
  },
});

/**
 * The keys `KeyProbe` could inject when `mountProbe` mounted it somewhere;
 * throws, naming `where`, if it never mounted.
 */
export async function keysProbedIn(where: string, mountProbe: () => Promise<unknown>): Promise<Set<PropertyKey>> {
  reached = undefined;
  await mountProbe();
  if (!reached) throw new Error(`${where} never mounted the probe board, so there is nothing to compare`);
  return reached;
}

/** A key as the parity assertions print it. */
function describeKey(key: PropertyKey): string {
  return typeof key === 'symbol' ? (key.description ?? key.toString()) : String(key);
}

/**
 * What a shell provides only for itself. The board-region pin is how a board
 * tells the shell's auto-zoom that it scrolls instead of scaling; `renderAsSeat`
 * has no zoom to tell, and a board with no shell above it registers into nothing
 * (see boardRegionPin.ts).
 */
const SHELL_ONLY = new Set(['boardsmith:board-region-pin']);

/**
 * Fail if the shell's board could inject a key the seat's board could not.
 * `shellProvides` names keys the shell must have provided, so the comparison is
 * against something rather than an empty set.
 */
export function expectSeatGetsWhatTheShellGives(
  shellKeys: Set<PropertyKey>,
  seatKeys: Set<PropertyKey>,
  shellProvides: readonly string[],
): void {
  const missing = [...shellKeys]
    .filter((key) => !seatKeys.has(key))
    .map(describeKey)
    .filter((name) => !SHELL_ONLY.has(name));
  expect(missing).toEqual([]);
  expect([...shellKeys].map(describeKey)).toEqual(expect.arrayContaining([...shellProvides]));
}
