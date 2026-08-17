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
      noOs: "The 'os' module is not allowed in game rules: it reports host state (platform, cpus, hostname), which differs per machine and breaks deterministic replay.",
    },
    schema: [],
  },

  create(context) {
    // One entry per forbidden module, each naming its OWN hazard. Previously a
    // ternary chain fell through to 'noChildProcess' for anything that was not
    // fs or path, so `import os` told the author child-process execution was
    // banned — sending them hunting for a spawn() they never wrote. A map makes
    // adding a module without its own message impossible.
    const forbiddenModules: Record<string, 'noFs' | 'noPath' | 'noChildProcess' | 'noOs'> = {
      'fs': 'noFs',
      'fs/promises': 'noFs',
      'path': 'noPath',
      'child_process': 'noChildProcess',
      'os': 'noOs',
    };

    function checkModuleName(name: string, node: Rule.Node) {
      const cleanName = name.replace(/^node:/, '');
      const messageId = forbiddenModules[cleanName];
      if (messageId) {
        context.report({ node, messageId });
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
