import { describe, it, expect } from 'vitest';
import { onlyTestCollectionChanged } from './test-config-edit.js';
import { generateVitestConfig } from './test-run-scope.js';

/**
 * #479: chunk-merge vouches for a vitest config edit with the signed chunks' own tests only when the
 * edit changes which files are collected and nothing else.
 */
describe('onlyTestCollectionChanged', () => {
  const config = (test: string) => `import { defineConfig } from 'vitest/config';\nexport default defineConfig({\n  test: {${test}},\n});\n`;

  it('accepts an edit to test.exclude or test.include, comments and layout aside', () => {
    expect(onlyTestCollectionChanged(config(" exclude: ['a/**'] "), config("\n    // keep worktrees out\n    exclude: ['a/**', '.worktrees/**'],\n  "))).toBe(true);
    expect(onlyTestCollectionChanged(config(" globals: true "), config(" globals: true, include: ['tests/**/*.test.ts'] "))).toBe(true);
    expect(onlyTestCollectionChanged(config(" include: ['x'], globals: true "), config(" globals: true "))).toBe(true);
  });

  it('accepts the exclusion edit doctor makes to the config BoardSmith writes', () => {
    const written = generateVitestConfig(undefined);
    expect(onlyTestCollectionChanged(written, written.replace('test: { exclude: [', 'test: { exclude: ["dist/**", '))).toBe(true);
  });

  it('refuses any other edit: setup files, aliases, environment, or an include outside test', () => {
    const before = config(" exclude: ['a/**'] ");
    expect(onlyTestCollectionChanged(before, config(" exclude: ['a/**'], setupFiles: ['tests/setup.ts'] "))).toBe(false);
    expect(onlyTestCollectionChanged(before, config(" exclude: ['a/**'], environment: 'jsdom' "))).toBe(false);
    expect(onlyTestCollectionChanged(before, `${before}export const alias = { '../src/rules': './stub' };\n`)).toBe(false);
    expect(
      onlyTestCollectionChanged(
        "export default { test: {}, coverage: { include: ['src'] } };\n",
        "export default { test: {}, coverage: { include: ['src', 'lib'] } };\n",
      ),
    ).toBe(false);
    expect(
      onlyTestCollectionChanged(
        "export default { test: { deps: { inline: ['a'] } } };\n",
        "export default { test: { deps: { inline: ['b'] } } };\n",
      ),
    ).toBe(false);
  });
});
