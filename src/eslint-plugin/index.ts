import noNetwork from './rules/no-network.js';
import noFilesystem from './rules/no-filesystem.js';
import noTimers from './rules/no-timers.js';
import noNondeterministic from './rules/no-nondeterministic.js';
import noEval from './rules/no-eval.js';

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
  },

  configs: {
    recommended: {
      plugins: ['boardsmith'],
      rules: {
        'boardsmith/no-network': 'error',
        'boardsmith/no-filesystem': 'error',
        'boardsmith/no-timers': 'error',
        'boardsmith/no-nondeterministic': 'error',
        'boardsmith/no-eval': 'error',
      },
    },
  },
};

export default plugin;

// Also export individual rules for flexibility
export const rules = plugin.rules;
export const configs = plugin.configs;
