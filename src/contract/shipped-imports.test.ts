/**
 * EVERY PACKAGE A SHIPPED FILE IMPORTS IS ONE AN INSTALL OF BOARDSMITH PROVIDES (#380).
 *
 * Inside this checkout every devDependency is installed, so a shipped file can
 * import one and nothing here notices. An install of `boardsmith` into a game
 * gets only `dependencies` (and whatever `peerDependencies` the game supplies),
 * so the same import is a module-not-found error at the first command. That is
 * how the CLI came to import `typescript` while declaring it only as a
 * devDependency.
 *
 * What counts as shipped is what `npm pack` would publish, asked of npm itself,
 * so `files` in package.json and any negation in it are read the way npm reads
 * them. `dist/` is the one exception: it is build output that may be missing or
 * stale in a checkout, so instead of reading whatever sits there, the CLI bundle
 * is built fresh in memory with the options `boardsmith pack` uses and its
 * external imports are checked.
 *
 * Type-only imports count. This package ships TypeScript source and a game's own
 * `vue-tsc` compiles it, so a type import of an undeclared package is an error
 * in every game.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { parse as parseSfc } from 'vue/compiler-sfc';

import { cliBuildOptions, CLI_OUTFILE } from '../cli/lib/build-cli.js';
import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

interface PackageJson {
  readonly name: string;
  readonly dependencies: Record<string, string>;
  readonly peerDependencies: Record<string, string>;
}

/** One shipped file importing one package an install does not provide. */
interface UndeclaredImport {
  readonly file: string;
  readonly specifier: string;
}

/**
 * Imports that ARE undeclared, and why no install ever reaches them.
 *
 * Each entry must still match a real import (a test below says so), so one
 * cannot outlive the code it excuses.
 */
const REACHED_ONLY_IN_THIS_CHECKOUT: readonly (UndeclaredImport & { readonly why: string })[] = [
  {
    file: 'bin/boardsmith.js',
    specifier: 'tsx',
    why: 'Loaded only when ../.git exists, to run the CLI from source in this repository. An install runs dist/cli.js instead.',
  },
];

const PACKAGE_JSON = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;
const DECLARED = new Set([
  PACKAGE_JSON.name,
  ...Object.keys(PACKAGE_JSON.dependencies),
  ...Object.keys(PACKAGE_JSON.peerDependencies),
]);

/** The package a bare specifier names, or null for anything that is not a package. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  // `node:fs`, and Vite's `virtual:` modules, which the CLI's own dev-host plugin serves.
  if (/^[a-z]+:/.test(specifier)) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return builtinModules.includes(name) ? null : name;
}

/** Every module specifier a source file names: static, dynamic, `require`, and type references. */
function specifiersOf(file: string): string[] {
  let source = readFileSync(join(REPO_ROOT, file), 'utf8');
  if (file.endsWith('.vue')) {
    const { descriptor } = parseSfc(source, { filename: file });
    source = [descriptor.script?.content ?? '', descriptor.scriptSetup?.content ?? ''].join('\n');
  }
  const info = ts.preProcessFile(source, true, true);
  return [...info.importedFiles, ...info.typeReferenceDirectives].map((ref) => ref.fileName);
}

function undeclared(file: string, specifiers: readonly string[]): UndeclaredImport[] {
  return specifiers
    .filter((specifier) => {
      const name = packageOf(specifier);
      return name !== null && !DECLARED.has(name);
    })
    .map((specifier) => ({ file, specifier }));
}

function isExcused(found: UndeclaredImport): boolean {
  return REACHED_ONLY_IN_THIS_CHECKOUT.some(
    (entry) => entry.file === found.file && packageOf(entry.specifier) === packageOf(found.specifier),
  );
}

function describeAll(found: readonly UndeclaredImport[]): string {
  return found.map(({ file, specifier }) => `  ${file} imports '${specifier}'`).join('\n');
}

// Slow one-time setup lives here, where no test timeout applies.
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
if (pack.status !== 0) {
  throw new Error(`npm pack --dry-run failed, so the shipped file list is unknown:\n${pack.stderr}`);
}
const SHIPPED = (JSON.parse(pack.stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path);
const SHIPPED_SOURCE = SHIPPED.filter(
  (path) => !path.startsWith('dist/') && /\.(ts|mts|js|mjs|cjs|vue)$/.test(path),
);
const SOURCE_FINDINGS = SHIPPED_SOURCE.flatMap((file) => undeclared(file, specifiersOf(file)));

const bundle = await build({ ...cliBuildOptions(REPO_ROOT), write: false, metafile: true });
const BUNDLE_EXTERNALS = Object.values(bundle.metafile.outputs).flatMap((output) =>
  output.imports.filter((imported) => imported.external).map((imported) => imported.path),
);

describe('packageOf', () => {
  it('names the package of a bare specifier, scoped or not, with or without a subpath', () => {
    expect(packageOf('typescript')).toBe('typescript');
    expect(packageOf('vue/compiler-sfc')).toBe('vue');
    expect(packageOf('@vue/test-utils')).toBe('@vue/test-utils');
    expect(packageOf('@typescript-eslint/parser/dist/index.js')).toBe('@typescript-eslint/parser');
  });

  it('ignores relative paths, Node built-ins and URL-scheme modules', () => {
    expect(packageOf('./a.js')).toBeNull();
    expect(packageOf('../b.ts')).toBeNull();
    expect(packageOf('node:fs')).toBeNull();
    expect(packageOf('fs')).toBeNull();
    expect(packageOf('child_process')).toBeNull();
    expect(packageOf('virtual:boardsmith-dev-config')).toBeNull();
  });
});

describe('the published package imports only what an install provides (#380)', () => {
  it('reads the real published file list, CLI and entry points included', () => {
    expect(SHIPPED_SOURCE).toContain('bin/boardsmith.js');
    expect(SHIPPED_SOURCE).toContain('src/cli/cli.ts');
    expect(SHIPPED_SOURCE).toContain('src/engine/index.ts');
    expect(SHIPPED_SOURCE.length).toBeGreaterThan(300);
  });

  it('ships no test file, since none is ever loaded by a consumer', () => {
    const tests = SHIPPED.filter((path) => /\.test\.|\.test-helper\.|\/__fixtures__\//.test(path));
    expect(tests, `package.json "files" publishes test files:\n${tests.join('\n')}`).toEqual([]);
  });

  it('declares, in dependencies or peerDependencies, every package a shipped source file imports', () => {
    const findings = SOURCE_FINDINGS.filter((found) => !isExcused(found));
    expect(
      findings,
      `These shipped files import packages an install of boardsmith does not provide. ` +
        `Add the package to "dependencies" (or "peerDependencies" if the game supplies it), ` +
        `or stop shipping the file:\n${describeAll(findings)}`,
    ).toEqual([]);
  });

  it('declares every package the CLI bundle (dist/cli.js) leaves external', () => {
    const findings = undeclared(CLI_OUTFILE, BUNDLE_EXTERNALS);
    expect(BUNDLE_EXTERNALS).toContain('commander');
    expect(
      findings,
      `The CLI bundle imports packages an install of boardsmith does not provide. ` +
        `Add each to "dependencies":\n${describeAll(findings)}`,
    ).toEqual([]);
  });

  it('excuses only imports that still exist', () => {
    const stale = REACHED_ONLY_IN_THIS_CHECKOUT.filter(
      (entry) => !SOURCE_FINDINGS.some((found) => found.file === entry.file && found.specifier === entry.specifier),
    );
    expect(stale, 'Remove these entries from REACHED_ONLY_IN_THIS_CHECKOUT; the import is gone.').toEqual([]);
  });
});
