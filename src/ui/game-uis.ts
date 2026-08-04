/**
 * The game UI registry — the single source of truth for which UIs a game has
 * and which one it ships.
 *
 * A game declares every board it owns in ONE file (`src/ui/uis.ts`):
 *
 * ```ts
 * import { defineGameUIs, defaultUI, devUI } from 'boardsmith/ui';
 *
 * export default defineGameUIs({
 *   Heirloom: defaultUI(() => import('./heirloom/HeirloomTable.vue')),
 *   Auto:     devUI(() => import('boardsmith/ui/auto-ui')),
 *   Classic:  devUI(() => import('./components/CribbageBoard.vue')),
 * });
 * ```
 *
 * Two guarantees follow from this shape, and both are the reason it looks the
 * way it does:
 *
 * 1. EXACTLY ONE DEFAULT, PROVEN BY THE COMPILER. `defaultUI()` returns a
 *    branded type and `defineGameUIs` rejects a registry with zero or two of
 *    them at compile time (see `ExactlyOneDefault`). There is no `default:
 *    'Name'` field to fall out of sync with the entries, because the entry
 *    itself carries the fact.
 *
 * 2. DEV-ONLY UIs COST NOTHING IN PRODUCTION. `devUI()` puts its `import()`
 *    inside a branch on `import.meta.env.DEV`, which every Vite production
 *    build constant-folds to `false`. Rollup then drops the dead branch, the
 *    dynamic import goes with it, and the component's module — its JS, its
 *    compiled `<style>` CSS, and any assets it references — never enters the
 *    graph at all. This is ELIMINATION BY ABSENCE, not by inference.
 *
 *    The disposition MUST be the branch itself. A data-driven flag (say, a
 *    `ships: [...]` list read at runtime) cannot do this: Rollup can't evaluate
 *    it, so it must assume every `import()` is reachable and emits a chunk for
 *    each. Measured on cribbage: marker form ships 983,068 bytes, list form
 *    ships 1,023,013 — the whole alternate UI, as a chunk no player ever loads.
 *    If you are tempted to make this more declarative, that is the cost.
 *
 * Naming is deliberate too: `devUI` is the short, reflexive word, so the path
 * of least resistance is the one that keeps the bundle small. Shipping an extra
 * UI should be the thing you have to spell out.
 */
import { defineAsyncComponent, type Component } from 'vue';

/**
 * Brand carried only by `defaultUI()` results. Type-only — it never exists at
 * runtime, so it cannot be forged by hand-writing an object literal.
 */
declare const DEFAULT_UI_BRAND: unique symbol;

/** A UI a game can render. `component` is null when the UI was eliminated from this build. */
export interface GameUIEntry {
  readonly component: Component | null;
  /** True when this UI exists only under `boardsmith dev` and never ships. */
  readonly devOnly: boolean;
}

/** The one UI a production build renders. Structurally distinct so the compiler can count them. */
export interface DefaultGameUIEntry extends GameUIEntry {
  readonly devOnly: false;
  readonly [DEFAULT_UI_BRAND]: true;
}

type GameUILoader = () => Promise<{ default: Component }>;

/** Keys of `T` whose entry is the default. A union — 0, 1, or many members. */
type DefaultKeys<T> = { [K in keyof T]: T[K] extends DefaultGameUIEntry ? K : never }[keyof T];

/** True when `T` is a union of two or more members. */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * Resolves to `T` when exactly one entry is a `defaultUI()`, and to an error
 * string otherwise. Intersecting the parameter with this makes a bad registry
 * unassignable, and TypeScript prints the error text as part of the message.
 */
type ExactlyOneDefault<T> =
  [DefaultKeys<T>] extends [never]
    ? 'ERROR: exactly one UI must be defaultUI() — none of these are'
    : IsUnion<DefaultKeys<T>> extends true
      ? 'ERROR: only one UI may be defaultUI() — mark the others devUI()'
      : T;

/** A resolved registry: every declared UI, plus which one is the default. */
export interface GameUIRegistry {
  /** Declared order is preserved — it drives the dev UI-switcher's ordering. */
  readonly names: readonly string[];
  readonly defaultName: string;
  readonly entries: Readonly<Record<string, GameUIEntry>>;
}

/**
 * The UI a production build renders. Always shipped.
 *
 * Exactly one entry per game must use this; `defineGameUIs` will not compile
 * otherwise.
 *
 * Takes the component itself, NOT a loader — so import it statically:
 *
 * ```ts
 * import HeirloomTable from './heirloom/HeirloomTable.vue';
 * export default defineGameUIs({ HeirloomTable: defaultUI(HeirloomTable), ... });
 * ```
 *
 * This is deliberate and it is the one asymmetry in this API. A lazily-loaded
 * default board can fail to arrive on its own — a dropped chunk request leaves
 * a player staring at a shell with no game in it, a failure mode that does not
 * exist when the board is part of the bundle that is already running. Splitting
 * the board buys nothing in package size (identical bytes, different files);
 * it only reorders paint. That is not worth a way for the game to half-load.
 *
 * A board with a genuinely heavy dependency should split THAT, inside itself —
 * `const scene = await import('./three/scene.js')` behind a loading state the
 * component owns. Then the board is always there to render the loading state,
 * which is the layering you want.
 *
 * `devUI()` is lazy because it must be: the dynamic import inside a folded
 * branch is what makes elimination possible, and a dev-only chunk failing is a
 * problem the author sees instantly.
 */
export function defaultUI(component: Component): DefaultGameUIEntry {
  return { component, devOnly: false } as DefaultGameUIEntry;
}

/**
 * A UI available only in `boardsmith dev` — an old board kept for comparison,
 * the auto-UI, a debug view. Eliminated wholesale from production builds.
 *
 * The ternary below is load-bearing and must stay inline: `import.meta.env.DEV`
 * is a literal Vite substitution, so the production branch folds away and takes
 * the caller's `import()` with it. Do not hoist it, do not make it a variable,
 * and do not replace it with a runtime flag.
 */
export function devUI(loader: GameUILoader): GameUIEntry {
  return import.meta.env.DEV
    ? { component: defineAsyncComponent(loader), devOnly: true }
    : { component: null, devOnly: true };
}

/**
 * Build a game's UI registry. Pass an object whose keys are the display names
 * shown in the `boardsmith dev` UI switcher.
 *
 * The `& ExactlyOneDefault<T>` on the parameter is what enforces the
 * one-default rule at compile time.
 */
export function defineGameUIs<T extends Record<string, GameUIEntry>>(
  uis: T & ExactlyOneDefault<T>,
): GameUIRegistry {
  const entries = uis as unknown as Record<string, GameUIEntry>;
  const names = Object.keys(entries);
  const defaultNames = names.filter((name) => !entries[name].devOnly);

  // The compiler already rejects zero-or-many defaults, but a game can reach
  // here from untyped JS or a stale build. Fail loudly in dev, where the author
  // can act on it — NEVER throw in production, where the person who sees it is
  // a player who cannot fix it. `boardsmith validate` catches it before publish.
  if (import.meta.env.DEV && defaultNames.length !== 1) {
    const found = defaultNames.length === 0 ? 'none' : defaultNames.join(', ');
    throw new Error(
      `src/ui/uis.ts must mark exactly one UI with defaultUI() — found ${found}. `
      + `Declared UIs: ${names.join(', ') || '(none)'}. `
      + `Wrap the board you want production to render in defaultUI(), and every other one in devUI().`,
    );
  }

  return {
    names,
    // In the degraded non-dev case above, fall back to the first declared UI so
    // a player still sees a board rather than an empty stage.
    defaultName: defaultNames[0] ?? names[0] ?? '',
    entries,
  };
}
