import noNetwork from './rules/no-network.js';
import noFilesystem from './rules/no-filesystem.js';
import noTimers from './rules/no-timers.js';
import noNondeterministic from './rules/no-nondeterministic.js';
import noEval from './rules/no-eval.js';
import noElementIdentityComparison from './rules/no-element-identity-comparison.js';
import noElementArrayState from './rules/no-element-array-state.js';

const plugin = {
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
  },

  // Populated below so the config can reference `plugin` itself.
  configs: {} as Record<string, unknown>,
};

// Flat-config (ESLint 9+) shape: `plugins` is an object, not a string array.
// Spread `boardsmith.configs.recommended` into an eslint.config.js array.
plugin.configs.recommended = {
  name: 'boardsmith/recommended',
  plugins: { boardsmith: plugin },
  rules: {
    'boardsmith/no-network': 'error',
    'boardsmith/no-filesystem': 'error',
    'boardsmith/no-timers': 'error',
    'boardsmith/no-nondeterministic': 'error',
    'boardsmith/no-eval': 'error',
    'boardsmith/no-element-identity-comparison': 'error',
    'boardsmith/no-element-array-state': 'error',
  },
};

export default plugin;

// Also export individual rules for flexibility
export const rules = plugin.rules;
export const configs = plugin.configs;
