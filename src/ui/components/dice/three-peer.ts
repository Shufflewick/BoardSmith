/**
 * THE ONE SENTENCE A GAME AUTHOR NEEDS WHEN three.js IS NOT INSTALLED (#276).
 *
 * `three` and `@types/three` are OPTIONAL PEER DEPENDENCIES of BoardSmith. The
 * alternative was making them real dependencies, and the numbers decide it: the
 * pair unpacks to 41 MB -- more than `vite` and `esbuild` together -- and one
 * game in fourteen rolls dice. `boardsmith/ui/dice` is already the opt-in
 * surface for exactly that cost (its own `exports` entry, off the `boardsmith/ui`
 * barrel, behind a lazy chunk), and a game already declares its own `vue` and
 * `vite`, so "the game declares what the game uses" is the contract this repo
 * already has. Optional peers put `three` on the same footing.
 *
 * The price of that choice is the failure mode, and this module is what pays
 * it. Both things a consumer can hit -- the compiler's `TS2307` inside our own
 * source, and the loader's rejection at runtime -- name a file under
 * `node_modules/boardsmith` and read as a bug in BoardSmith. Neither says the
 * one thing that fixes it, so both are routed through the text below:
 * `dice/index.ts` throws it, `boardsmith validate` prints it, and
 * `src/contract/dice-typecheck.test.ts` proves a real compiler's real words
 * still reach it.
 */

/** What to do about it, in the words a game author can act on. */
export const THREE_PEER_INSTRUCTION =
  `boardsmith/ui/dice draws dice with three.js, which BoardSmith declares as an optional peer ` +
  `dependency: it is 41 MB that only this one surface needs, so games without 3D dice never install it.\n\n` +
  `Install it in your game:\n\n` +
  `  npm install three @types/three\n`;

/**
 * `three` could not be resolved, in the module specifier's own spelling.
 *
 * `three/examples/...` counts: a subpath failing means the package is missing,
 * not that the subpath is wrong.
 */
const UNRESOLVED_THREE = /error TS(?:2307|7016):.*'three(?:\/[^']*)?'/;

/**
 * The instruction, when `diagnostics` show `three` is what could not be found;
 * `null` when they show anything else, so a real type error in our source is
 * never mislabelled as a missing install.
 *
 * `diagnostics` are `vue-tsc` output lines, one per error.
 */
export function missingThreePeerHint(diagnostics: readonly string[]): string | null {
  return diagnostics.some((line) => UNRESOLVED_THREE.test(line)) ? THREE_PEER_INSTRUCTION : null;
}

/**
 * The error `boardsmith/ui/dice` throws when three.js is not installed, with
 * the resolver's own failure kept as `cause` so the real path is still there.
 */
export function missingThreePeerError(cause: unknown): Error {
  return new Error(THREE_PEER_INSTRUCTION, { cause });
}
