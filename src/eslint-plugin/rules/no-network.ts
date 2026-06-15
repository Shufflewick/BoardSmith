import type { Rule } from 'eslint';

/**
 * Disallows network access in game rules code
 * - fetch() / window.fetch() / globalThis.fetch()
 * - XMLHttpRequest
 * - WebSocket
 * - importing/require-ing networking modules (http, https, net, dgram, http2, tls, dns)
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
      noNetworkModule:
        "Importing the '{{module}}' module is not allowed in game rules. Games cannot perform network I/O.",
    },
    schema: [],
  },

  create(context) {
    const forbiddenModules = ['http', 'https', 'net', 'dgram', 'http2', 'tls', 'dns'];

    function checkModuleName(name: string, node: Rule.Node) {
      const cleanName = name.replace(/^node:/, '');
      if (forbiddenModules.includes(cleanName)) {
        context.report({
          node,
          messageId: 'noNetworkModule',
          data: { module: cleanName },
        });
      }
    }

    return {
      CallExpression(node) {
        // Check for fetch() calls
        if (node.callee.type === 'Identifier' && node.callee.name === 'fetch') {
          context.report({
            node,
            messageId: 'noFetch',
          });
        }

        // Check for window.fetch(), globalThis.fetch(), etc.
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'fetch'
        ) {
          context.report({
            node,
            messageId: 'noFetch',
          });
        }

        // Check require('http') and friends
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          checkModuleName(node.arguments[0].value, node);
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

      // Check import declarations: import https from 'node:https'
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') {
          checkModuleName(node.source.value, node);
        }
      },

      // Check dynamic import('node:net')
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          checkModuleName(node.source.value, node);
        }
      },
    };
  },
};

export default rule;
