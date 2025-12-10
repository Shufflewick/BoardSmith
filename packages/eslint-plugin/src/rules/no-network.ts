import type { Rule } from 'eslint';

/**
 * Disallows network access in game rules code
 * - fetch()
 * - XMLHttpRequest
 * - WebSocket
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow network access in game rules',
      recommended: true,
    },
    messages: {
      noFetch: 'Network access via fetch() is not allowed in game rules. Games must be deterministic.',
      noXHR: 'Network access via XMLHttpRequest is not allowed in game rules.',
      noWebSocket: 'Network access via WebSocket is not allowed in game rules.',
    },
    schema: [],
  },

  create(context) {
    return {
      // Check for fetch() calls
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'fetch'
        ) {
          context.report({
            node,
            messageId: 'noFetch',
          });
        }
      },

      // Check for new XMLHttpRequest() or new WebSocket()
      NewExpression(node) {
        if (node.callee.type === 'Identifier') {
          if (node.callee.name === 'XMLHttpRequest') {
            context.report({
              node,
              messageId: 'noXHR',
            });
          }
          if (node.callee.name === 'WebSocket') {
            context.report({
              node,
              messageId: 'noWebSocket',
            });
          }
        }
      },
    };
  },
};

export default rule;
