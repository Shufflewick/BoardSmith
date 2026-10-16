import type { Rule } from 'eslint';
import { forEachGlobalReference } from './global-receiver.js';

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
      'Program:exit'() {
        forEachGlobalReference(context.sourceCode, new Set(['eval', 'Function']), (name, node) => {
          if (name === 'eval') {
            context.report({ node, messageId: 'noEval' });
            return;
          }
          // `x instanceof Function` is a type check; only calling Function builds code from text.
          const parent = node.parent;
          if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee === node) {
            context.report({ node: parent, messageId: 'noFunction' });
          }
        });
      },
    };
  },
};

export default rule;
