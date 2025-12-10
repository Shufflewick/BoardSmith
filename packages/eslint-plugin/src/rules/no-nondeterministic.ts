import type { Rule } from 'eslint';

/**
 * Disallows non-deterministic functions in game rules code
 * - Math.random() - use game.random instead
 * - Date.now() - timestamps break replay
 * - new Date() without fixed value
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
      noNewDate: 'new Date() without a fixed value is not allowed in game rules.',
      noCryptoRandom: 'crypto.randomUUID() is not allowed in game rules. Use game.random instead.',
      noPerformanceNow: 'performance.now() is not allowed in game rules.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check Math.random()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Math' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'random'
        ) {
          context.report({
            node,
            messageId: 'noMathRandom',
          });
        }

        // Check Date.now()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Date' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'now'
        ) {
          context.report({
            node,
            messageId: 'noDateNow',
          });
        }

        // Check crypto.randomUUID() and crypto.getRandomValues()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'crypto' &&
          node.callee.property.type === 'Identifier' &&
          (node.callee.property.name === 'randomUUID' ||
           node.callee.property.name === 'getRandomValues')
        ) {
          context.report({
            node,
            messageId: 'noCryptoRandom',
          });
        }

        // Check performance.now()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'performance' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'now'
        ) {
          context.report({
            node,
            messageId: 'noPerformanceNow',
          });
        }
      },

      // Check new Date() without arguments
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0
        ) {
          context.report({
            node,
            messageId: 'noNewDate',
          });
        }
      },
    };
  },
};

export default rule;
