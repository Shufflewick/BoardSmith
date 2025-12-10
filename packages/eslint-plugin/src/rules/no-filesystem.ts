import type { Rule } from 'eslint';

/**
 * Disallows filesystem access in game rules code
 * - require('fs')
 * - import('fs')
 * - import fs from 'fs'
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow filesystem access in game rules',
      recommended: true,
    },
    messages: {
      noFs: 'Filesystem access is not allowed in game rules. Games run in a sandboxed environment.',
      noPath: 'Path module is not allowed in game rules.',
      noChildProcess: 'Child process execution is not allowed in game rules.',
    },
    schema: [],
  },

  create(context) {
    const forbiddenModules = ['fs', 'fs/promises', 'path', 'child_process', 'os'];

    function checkModuleName(name: string, node: Rule.Node) {
      if (forbiddenModules.includes(name) || name.startsWith('node:')) {
        const cleanName = name.replace('node:', '');
        if (forbiddenModules.includes(cleanName)) {
          context.report({
            node,
            messageId: cleanName === 'fs' || cleanName === 'fs/promises' ? 'noFs' :
                       cleanName === 'path' ? 'noPath' : 'noChildProcess',
          });
        }
      }
    }

    return {
      // Check import declarations: import fs from 'fs'
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string') {
          checkModuleName(node.source.value, node);
        }
      },

      // Check require() calls
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

      // Check dynamic import()
      ImportExpression(node) {
        if (
          node.source.type === 'Literal' &&
          typeof node.source.value === 'string'
        ) {
          checkModuleName(node.source.value, node);
        }
      },
    };
  },
};

export default rule;
