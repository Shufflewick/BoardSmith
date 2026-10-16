import type { Rule } from 'eslint';
import { moduleImportVisitors } from './module-imports.js';

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

    return moduleImportVisitors((name, node) => {
      const messageId = forbiddenModules[name];
      if (messageId) context.report({ node, messageId });
    });
  },
};

export default rule;
