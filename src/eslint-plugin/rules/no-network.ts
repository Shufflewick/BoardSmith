import type { Rule } from 'eslint';
import { forEachGlobalReference } from './global-receiver.js';

/**
 * Disallows network access in game rules code
 * - fetch() / window.fetch() / globalThis.fetch()
 * - XMLHttpRequest
 * - WebSocket
 * - importing/require-ing networking modules (http, https, net, dgram, http2, tls, dns)
 * - import() of a computed module name
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
      noDynamicImport:
        'import() with a computed module name is not allowed in game rules, because nothing can check what it loads. Import the module by a fixed name.',
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

    const forbiddenGlobals: Record<string, string> = {
      fetch: 'noFetch',
      XMLHttpRequest: 'noXHR',
      WebSocket: 'noWebSocket',
    };

    return {
      'Program:exit'() {
        forEachGlobalReference(context.sourceCode, new Set(Object.keys(forbiddenGlobals)), (name, node) => {
          context.report({ node, messageId: forbiddenGlobals[name] });
        });
      },

      // Check require('http') and friends
      CallExpression(node) {
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

      // Check import declarations: import https from 'node:https'
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') {
          checkModuleName(node.source.value, node);
        }
      },

      // Check dynamic import('node:net')
      ImportExpression(node) {
        const source = node.source;
        if (source.type === 'Literal' && typeof source.value === 'string') {
          checkModuleName(source.value, node);
        } else if (source.type === 'TemplateLiteral' && source.expressions.length === 0) {
          checkModuleName(source.quasis[0].value.cooked ?? '', node);
        } else {
          context.report({ node, messageId: 'noDynamicImport' });
        }
      },
    };
  },
};

export default rule;
