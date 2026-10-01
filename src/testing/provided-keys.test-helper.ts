/**
 * A BOARD THAT RECORDS EVERYTHING IT COULD INJECT, for the parity tests that
 * hold the shell-context stubs (`renderAsSeat`, `tableShellContext`,
 * `worldShellContext`) to the real shells (#406 for GameShell, #413 for
 * WorldShell, #453 for both directions).
 *
 * Mount `KeyProbe` inside a shell and again under a stub, each through
 * `keysProbedIn`, and compare with `expectSameKeysAsTheShell`: a key the
 * shell's board can inject that the stub's cannot is a board that works in the
 * shell and breaks in a test, and a key the stub's board can inject that the
 * shell's cannot is a board that passes its test and breaks in the shell.
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

/** The keys in `from` that `other` lacks, by name, leaving out what a shell provides only for itself. */
function keysMissingFrom(from: Set<PropertyKey>, other: Set<PropertyKey>): string[] {
  return [...from]
    .filter((key) => !other.has(key))
    .map(describeKey)
    .filter((name) => !SHELL_ONLY.has(name))
    .sort();
}

/**
 * Fail unless the stub's board could inject exactly what the shell's board
 * could. `shellProvides` names keys the shell must have provided, so the
 * comparison is against something rather than an empty set.
 */
export function expectSameKeysAsTheShell(
  shellKeys: Set<PropertyKey>,
  stubKeys: Set<PropertyKey>,
  shellProvides: readonly string[],
): void {
  expect({
    onlyTheShellProvides: keysMissingFrom(shellKeys, stubKeys),
    onlyTheStubProvides: keysMissingFrom(stubKeys, shellKeys),
  }).toEqual({ onlyTheShellProvides: [], onlyTheStubProvides: [] });
  expect([...shellKeys].map(describeKey)).toEqual(expect.arrayContaining([...shellProvides]));
}

/** The shell keys in `keys`, by name, for comparing with a stub's declared list. */
export function namesOf(keys: Iterable<PropertyKey>): string[] {
  return [...keys]
    .map(describeKey)
    .filter((name) => !SHELL_ONLY.has(name))
    .sort();
}

/**
 * The message a stub refused with, or a sentence saying it did not refuse. A
 * stub that resolves holds a mounted tree, which a failed `rejects` assertion
 * would try to print whole.
 */
export async function refusal(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => 'it did not refuse',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}
