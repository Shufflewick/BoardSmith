import type { Rule } from 'eslint';

/**
 * Disallows code evaluation in game rules
 * - eval()
 * - Function() constructor
 * - new Function()
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow code evaluation in game rules',
      recommended: true,
    },
    messages: {
      noEval: 'eval() is not allowed in game rules. It poses a security risk.',
      noFunction: 'Function() constructor is not allowed in game rules. It poses a security risk.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check eval()
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'eval'
        ) {
          context.report({
            node,
            messageId: 'noEval',
          });
        }

        // Check Function() as a call
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Function'
        ) {
          context.report({
            node,
            messageId: 'noFunction',
          });
        }
      },

      // Check new Function()
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Function'
        ) {
          context.report({
            node,
            messageId: 'noFunction',
          });
        }
      },
    };
  },
};

export default rule;
