import { ESLint, type Linter } from 'eslint';
import { tempTree } from '../testing/temp-tree.test-helper.js';

/**
 * The boardsmith rules a flat config leaves switched on for `file`, as ESLint resolves them:
 * every block that matches the file, overrides included. A first block names `.ts` and `.vue`
 * files as ones to lint, which ESLint otherwise skips, as a game's own config would.
 */
export async function enabledRules(config: Linter.Config[], file: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: tempTree('bs-eslint-config-'), overrideConfigFile: true, overrideConfig: [{ files: ['**/*.ts', '**/*.vue'] }, ...config] });
  const resolved = (await eslint.calculateConfigForFile(file)) as Linter.Config;
  return Object.entries(resolved.rules ?? {})
    .filter(([name, level]) => name.startsWith('boardsmith/') && ![0, 'off'].includes(Array.isArray(level) ? level[0] : level!))
    .map(([name]) => name)
    .sort();
}
