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

  describe('reads an include or exclude value only when it is plain data, so no code in it can run', () => {
    const before = config(" exclude: ['a/**'] ");
    const vitestConfig = (exclude: string) =>
      `import { configDefaults, defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { exclude: ${exclude} } });\n`;

    it('accepts strings, plain template strings and the spread of vitest\'s own default list', () => {
      expect(onlyTestCollectionChanged(before, config(" exclude: ['a/**', `b/**`] "))).toBe(true);
      expect(onlyTestCollectionChanged(vitestConfig('[...configDefaults.exclude]'), vitestConfig("[...configDefaults.exclude, 'b']"))).toBe(true);
      expect(onlyTestCollectionChanged(vitestConfig("['a']"), vitestConfig("[...configDefaults.exclude, 'a']"))).toBe(true);
    });

    it.each([
      ['a comma expression that assigns', "(process.env.STUB = '1', ['a'])"],
      ['an awaited import', "(await import('./patch.js'), ['a'])"],
      ['a call', "['a'].concat(stub())"],
      ['a call inside the list', "['a', stub()]"],
      ['an assignment inside the list', "['a', (globalThis.STUB = 'b')]"],
      ['an immediately invoked function', "[(() => { process.env.STUB = '1'; return 'a'; })()]"],
      ['a template string with an expression', "[`${stub()}`]"],
      ['a tagged template string', "[String.raw`a`]"],
      ['a spread of a call', "[...stub()]"],
      ['a spread of a name, which may run an iterator or getter', "[...shared]"],
      ['a spread of an unknown property path', "[...settings.exclude]"],
      ['a name rather than a list', "shared"],
    ])('refuses %s, before or after the edit', (_what, value) => {
      expect(onlyTestCollectionChanged(before, config(` exclude: ${value} `))).toBe(false);
      expect(onlyTestCollectionChanged(config(` exclude: ${value} `), before)).toBe(false);
      expect(onlyTestCollectionChanged(config(` exclude: ${value} `), config(` exclude: ${value} `))).toBe(false);
    });

    it('refuses a spread of configDefaults that is not vitest\'s own', () => {
      const local = (exclude: string) =>
        `import { defineConfig } from 'vitest/config';\nconst configDefaults = { get exclude() { process.env.STUB = '1'; return []; } };\n` +
        `export default defineConfig({ test: { exclude: ${exclude} } });\n`;
      expect(onlyTestCollectionChanged(local("['a']"), local("['a', ...configDefaults.exclude]"))).toBe(false);
      const shadowed = (exclude: string) =>
        `import { configDefaults, defineConfig } from 'vitest/config';\n` +
        `export default defineConfig(() => { const configDefaults = stub(); return defineConfig({ test: { exclude: ${exclude} } }); });\n`;
      expect(onlyTestCollectionChanged(shadowed("['a']"), shadowed("['a', ...configDefaults.exclude]"))).toBe(false);
    });

    it('takes no include or exclude out of an object that is not the config, such as a define block', () => {
      // Vite replaces `test` in the game's own code with this object, so its contents are code.
      const define = (include: string) =>
        `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ define: { test: { include: ${include} } }, test: {} });\n`;
      expect(onlyTestCollectionChanged(define("['a']"), define("['a', 'b']"))).toBe(false);
      const local = (exclude: string) =>
        `const defineConfig = (c) => c;\nexport default defineConfig({ test: { exclude: ${exclude} } });\n`;
      expect(onlyTestCollectionChanged(local("['a']"), local("['a', 'b']"))).toBe(false);
    });

    it('accepts the config BoardSmith writes, merged over a base config', () => {
      const written = generateVitestConfig('vite.config.ts');
      expect(onlyTestCollectionChanged(written, written.replace('test: { exclude: [', 'test: { exclude: ["dist/**", '))).toBe(true);
    });

    it('refuses a config that does not parse', () => {
      expect(onlyTestCollectionChanged(before, `${config(" exclude: ['a/**', 'b'] ")}export const = ;\n`)).toBe(false);
    });

    it('does not mistake text inside a template string for a comment', () => {
      const withTemplate = (tail: string) => config(` exclude: ['a/**'], name: \`\${'x'}// ${tail}\` `);
      expect(onlyTestCollectionChanged(withTemplate('one'), withTemplate('two'))).toBe(false);
    });
  });
});
