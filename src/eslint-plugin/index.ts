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

// Flat-config (ESLint 9+) shape: `plugins` is an object, not a string array.
// Spread `boardsmith.configs.recommended` into an eslint.config.js array.
// `Object.assign` adds `configs` to the same object the config names under
// `plugins`, so the config refers to the plugin it belongs to.
const plugin = Object.assign(base, {
  configs: {
    recommended: {
      name: 'boardsmith/recommended',
      plugins: { boardsmith: base },
      rules: {
        'boardsmith/no-network': 'error',
        'boardsmith/no-filesystem': 'error',
        'boardsmith/no-timers': 'error',
        'boardsmith/no-nondeterministic': 'error',
        'boardsmith/no-eval': 'error',
        'boardsmith/no-element-identity-comparison': 'error',
        'boardsmith/no-element-array-state': 'error',
        'boardsmith/no-silent-dispatch-fallthrough': 'error',
        'boardsmith/no-engine-field-shadow': 'error',
      } satisfies Linter.RulesRecord,
    } satisfies Linter.Config,
  },
}) satisfies ESLint.Plugin;

export default plugin;

// Also export individual rules for flexibility
export const rules = plugin.rules;
export const configs = plugin.configs;
