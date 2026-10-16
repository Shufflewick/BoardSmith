import type { Rule } from 'eslint';
import { forEachGlobalReference, readsProperty } from './global-receiver.js';

/**
 * Disallows non-deterministic functions in game rules code
 * - Math.random() - use game.random instead
 * - Date.now() - timestamps break replay
 * - Date() and new Date() without a fixed value
 * - crypto.randomUUID()
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow non-deterministic functions in game rules',
      recommended: true,
    },
    messages: {
      noMathRandom: 'Math.random() is not allowed in game rules. Use game.random instead for deterministic gameplay.',
      noDateNow: 'Date.now() is not allowed in game rules. Timestamps break replay functionality.',
      noNewDate: 'Date() and new Date() without a fixed value read the clock, which is not allowed in game rules.',
      noCryptoRandom: 'crypto.randomUUID() is not allowed in game rules. Use game.random instead.',
      noPerformanceNow: 'performance.now() is not allowed in game rules.',
    },
    schema: [],
  },

  create(context) {
    // Each global and the properties of it that read the clock or an unseeded generator.
    const banned: Record<string, Record<string, string>> = {
      Math: { random: 'noMathRandom' },
      Date: { now: 'noDateNow' },
      crypto: { randomUUID: 'noCryptoRandom', getRandomValues: 'noCryptoRandom' },
      performance: { now: 'noPerformanceNow' },
    };

    return {
      'Program:exit'() {
        forEachGlobalReference(context.sourceCode, new Set(Object.keys(banned)), (name, node) => {
          for (const [property, messageId] of Object.entries(banned[name])) {
            if (readsProperty(node, property)) context.report({ node: node.parent, messageId });
          }
          if (name !== 'Date') return;
          const parent = node.parent;
          // Called without new, Date ignores its arguments and returns the current time.
          const readsClock =
            (parent.type === 'CallExpression' && parent.callee === node) ||
            (parent.type === 'NewExpression' && parent.callee === node && parent.arguments.length === 0);
          if (readsClock) context.report({ node: parent, messageId: 'noNewDate' });
        });
      },
    };
  },
};

export default rule;
