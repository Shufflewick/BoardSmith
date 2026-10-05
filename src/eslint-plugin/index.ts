import type { ESLint, Linter } from 'eslint';
import noNetwork from './rules/no-network.js';
import noFilesystem from './rules/no-filesystem.js';
import noTimers from './rules/no-timers.js';
import noNondeterministic from './rules/no-nondeterministic.js';
import noEval from './rules/no-eval.js';
import noElementIdentityComparison from './rules/no-element-identity-comparison.js';
import noElementArrayState from './rules/no-element-array-state.js';
import noSilentDispatchFallthrough from './rules/no-silent-dispatch-fallthrough.js';
import noEngineFieldShadow from './rules/no-engine-field-shadow.js';

const base = {
  meta: {
    name: 'eslint-plugin-boardsmith',
    version: '0.0.1',
  },

  rules: {
    'no-network': noNetwork,
    'no-filesystem': noFilesystem,
    'no-timers': noTimers,
    'no-nondeterministic': noNondeterministic,
    'no-eval': noEval,
    'no-element-identity-comparison': noElementIdentityComparison,
    'no-element-array-state': noElementArrayState,
    'no-silent-dispatch-fallthrough': noSilentDispatchFallthrough,
    'no-engine-field-shadow': noEngineFieldShadow,
  },
};

type RuleName = keyof typeof base.rules;

/**
 * THE ONE LIST OF WHICH RULE GUARDS WHAT (#534). `configs.recommended` is built from it, and
 * `boardsmith validate` and `boardsmith lint` run `configs.recommended` (`cli/lib/sandbox-scan.ts`),
 * so a rule added here is enforced everywhere at once. Every rule is in exactly one group.
 */
export const ruleGroups = {
  /**
   * Capabilities no game should have wherever its code runs, UI included: network access,
   * filesystem access and eval.
   */
  security: ['no-network', 'no-filesystem', 'no-eval'],
  /**
   * Enforced only for code that runs inside the executor sandbox: the rules bundle and any shared
   * modules it imports. The executor must be deterministic and synchronous so games can be
   * replayed for undo and explored by the MCTS bot, and Workers freeze the clock during sync
   * execution, so timers never fire there anyway. Not applied to `src/ui/**`: the UI runs in the
   * browser iframe, never in the executor, so timers and randomness there (a
   * `requestAnimationFrame` animation) are legitimate and cannot affect game state.
   */
  determinism: ['no-timers', 'no-nondeterministic'],
  /**
   * Two anti-patterns that corrupt undo/replay and MCTS exploration without tripping the rules
   * above: comparing `GameElement` instances by `===` (identity is not stable across
   * clone/replay) and persisting a raw element array as game state (a second copy of the element
   * tree that drifts from it).
   */
  identity: ['no-element-identity-comparison', 'no-element-array-state'],
  /**
   * A per-item dispatch written as a chain of `if (...) { ...; continue; }` with nothing after it
   * resolves an unmatched item to nothing: no outcome, no refusal, no record (#161).
   */
  silence: ['no-silent-dispatch-fallthrough'],
  /**
   * The names the engine owns on every Game (#346). A zone called `pile` works until the first
   * restore, then silently reads the engine's container instead.
   */
  ownership: ['no-engine-field-shadow'],
} as const satisfies Record<string, readonly RuleName[]>;

/** `names` as a flat-config rules record, each at `level`. */
function ruleLevels(names: readonly RuleName[], level: Linter.RuleSeverity): Linter.RulesRecord {
  return Object.fromEntries(names.map((name) => [`boardsmith/${name}`, level]));
}

// Flat-config (ESLint 9+) shape: `plugins` is an object, not a string array.
// `configs.recommended` is an array of config blocks: spread it into an
// eslint.config.js array. `Object.assign` adds `configs` to the same object the
// config names under `plugins`, so the config refers to the plugin it belongs to.
const plugin = Object.assign(base, {
  configs: {
    recommended: [
      {
        name: 'boardsmith/recommended',
        plugins: { boardsmith: base },
        rules: ruleLevels(Object.values(ruleGroups).flat(), 'error'),
      },
      {
        // UI runs in the browser, not the executor sandbox: the determinism
        // rules do not apply there; every other group stays in force.
        name: 'boardsmith/recommended-ui',
        files: ['src/ui/**'],
        rules: ruleLevels(ruleGroups.determinism, 'off'),
      },
    ] satisfies Linter.Config[],
  },
}) satisfies ESLint.Plugin;

export default plugin;

// Also export individual rules for flexibility
export const rules = plugin.rules;
export const configs = plugin.configs;
