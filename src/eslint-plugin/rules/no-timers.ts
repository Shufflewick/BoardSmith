import type { Rule } from 'eslint';
import { forEachGlobalReference } from './global-receiver.js';

/**
 * Disallows timer functions in game rules code
 * - setTimeout()
 * - setInterval()
 * - setImmediate()
 * - requestAnimationFrame()
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow timer functions in game rules',
      recommended: true,
    },
    messages: {
      noSetTimeout: 'setTimeout() is not allowed in game rules. Games must complete synchronously.',
      noSetInterval: 'setInterval() is not allowed in game rules. Games must complete synchronously.',
      noSetImmediate: 'setImmediate() is not allowed in game rules.',
      noRAF: 'requestAnimationFrame() is not allowed in game rules.',
    },
    schema: [],
  },

  create(context) {
    const forbiddenFunctions: Record<string, string> = {
      setTimeout: 'noSetTimeout',
      setInterval: 'noSetInterval',
      setImmediate: 'noSetImmediate',
      requestAnimationFrame: 'noRAF',
    };

    return {
      'Program:exit'() {
        forEachGlobalReference(context.sourceCode, new Set(Object.keys(forbiddenFunctions)), (name, node) => {
          context.report({ node, messageId: forbiddenFunctions[name] });
        });
      },
    };
  },
};

export default rule;
