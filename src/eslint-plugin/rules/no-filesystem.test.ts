import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';
import rule from './no-filesystem.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-filesystem', rule, {
  valid: [
    // Game state lives in the element tree, not on disk.
    { code: `const saved = game.toJSON();` },
    // Non-filesystem node builtins are this rule's business only if listed.
    { code: `import { Buffer } from 'node:buffer';` },
    // A local named after a forbidden module is not an import of it.
    { code: `const path = board.route(from, to);` },
    // A string mentioning a module name is not an import.
    { code: `const label = 'fs';` },
  ],
  invalid: [
    { code: `import fs from 'fs';`, errors: [{ messageId: 'noFs' }] },
    { code: `import fs from 'node:fs';`, errors: [{ messageId: 'noFs' }] },
    { code: `import fs from 'fs/promises';`, errors: [{ messageId: 'noFs' }] },
    { code: `import path from 'path';`, errors: [{ messageId: 'noPath' }] },
    { code: `import path from 'node:path';`, errors: [{ messageId: 'noPath' }] },
    {
      code: `import { execSync } from 'child_process';`,
      errors: [{ messageId: 'noChildProcess' }],
    },
    { code: `const fs = require('fs');`, errors: [{ messageId: 'noFs' }] },
    { code: `const mod = await import('node:fs');`, errors: [{ messageId: 'noFs' }] },

    // `os` is on the forbidden list, and the reason it is forbidden is that it
    // is nondeterministic host state — NOT that it executes child processes.
    // A message naming the wrong hazard sends the author looking for a
    // spawn() they never wrote.
    { code: `import os from 'os';`, errors: [{ messageId: 'noOs' }] },
    { code: `import os from 'node:os';`, errors: [{ messageId: 'noOs' }] },

    {
      code: `
        import fs from 'node:fs';
        import path from 'node:path';
      `,
      errors: [{ messageId: 'noFs' }, { messageId: 'noPath' }],
    },
  ],
});
