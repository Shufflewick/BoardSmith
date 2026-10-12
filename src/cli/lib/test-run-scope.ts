import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * WHAT A GAME PROJECT'S TEST RUN COVERS: the main checkout's tests, nothing under `.boardsmith/` or
 * `.worktrees/`, and not the in-browser smoke test under `tests/browser/`, which only Playwright runs.
 *
 * Chunks built side by side live in git worktrees at `.boardsmith/worktrees/<slug>`, inside the
 * project (#294), and vitest's discovery walks into dot-directories. Left alone, a plain
 * `npx vitest run` in the main checkout also runs every unfinished chunk's tests, so a designer or
 * the orchestrator sees failures, or passes, from code that is not on main (#298).
 *
 * The exclusions ship in the package: a game's `vite.config.ts` builds its config with
 * `defineGameViteConfig` from `boardsmith/vite-config` (#528), so a change to them reaches every game
 * with BoardSmith. `boardsmith init` writes that config (`GAME_VITE_CONFIG`), `boardsmith doctor
 * --fix` rewrites a project made before it existed, and every command that runs a project's tests
 * (`boardsmith test`, `constraint-check`, `chunk-merge`, `verify`) runs vitest against it and refuses
 * to start without it (`testRunScopeProblem`). No command passes its own copy on the command line.
 */

/** The file a game's config lives in. */
export const GAME_VITE_CONFIG_FILE = 'vite.config.ts';

/** A game's whole vite and vitest config, as `boardsmith init` and `boardsmith doctor --fix` write it. */
export const GAME_VITE_CONFIG = `import { defineGameViteConfig } from 'boardsmith/vite-config';

export default defineGameViteConfig();
`;

const GAME_CONFIG_MODULE = 'boardsmith/vite-config';
const GAME_CONFIG_HELPER = 'defineGameViteConfig';

const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

/** Vitest's own config lookup order: any `vitest.config.*` wins over any `vite.config.*`. */
export const VITEST_CONFIG_NAMES = ['vitest.config', 'vite.config'].flatMap((base) =>
  CONFIG_EXTENSIONS.map((ext) => `${base}.${ext}`),
);

/** Every vite or vitest config file in this project, by name, in vitest's lookup order. */
export async function existingConfigs(projectDir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of VITEST_CONFIG_NAMES) {
    if (await fs.stat(join(projectDir, name)).then(() => true, () => false)) found.push(name);
  }
  return found;
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('config.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Whether the config default-exports a call of `defineGameViteConfig` imported from `boardsmith/vite-config`. */
export function buildsWithGameConfig(text: string): boolean {
  const source = parse(text);
  const helper = new Set(
    source.statements.flatMap((s) => {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== GAME_CONFIG_MODULE) return [];
      const bindings = s.importClause?.isTypeOnly ? undefined : s.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return [];
      return bindings.elements
        .filter((e) => !e.isTypeOnly && (e.propertyName ?? e.name).text === GAME_CONFIG_HELPER)
        .map((e) => e.name.text);
    }),
  );
  return source.statements.some(
    (s) =>
      ts.isExportAssignment(s) &&
      !s.isExportEquals &&
      ts.isCallExpression(s.expression) &&
      ts.isIdentifier(s.expression.expression) &&
      helper.has(s.expression.expression.text),
  );
}

/**
 * Why this project's test run would collect `.boardsmith/`, `.worktrees/` or the browser smoke test,
 * as a sentence that says how to fix it, or undefined when the config vitest loads is built with
 * `defineGameViteConfig`. The config is parsed, not evaluated, so an import in a comment does not count.
 */
export async function testRunScopeProblem(projectDir: string): Promise<string | undefined> {
  const [config] = await existingConfigs(projectDir);
  if (config !== undefined && buildsWithGameConfig(await fs.readFile(join(projectDir, config), 'utf-8'))) return undefined;
  const what = config === undefined
    ? `This project has no ${GAME_VITE_CONFIG_FILE}`
    : `${config} does not build its config with ${GAME_CONFIG_HELPER} from '${GAME_CONFIG_MODULE}'`;
  return (
    `${what}, so its test runs would also collect the unfinished chunks under .boardsmith/worktrees/, the agent ` +
    `threads under .worktrees/ and the in-browser smoke test under tests/browser/. A game's ${GAME_VITE_CONFIG_FILE} is ` +
    `this, with any settings of its own passed in, and there is no vitest.config.*:\n${GAME_VITE_CONFIG}` +
    'Run `boardsmith doctor --fix` to rewrite it, then run this again.'
  );
}

/** The excludes `defineGameViteConfig` adds to vitest's defaults. */
const SHIPPED_EXCLUDES = new Set(['.boardsmith/**', '.worktrees/**', '**/tests/browser/**']);

/** What a config BoardSmith wrote imports: vite, vitest, the Vue plugin, and the project's own vite config. */
const SHIPPED_IMPORT = /^(vite|vitest\/config|@vitejs\/plugin-vue|\.\/vite\.config(\.[cm]?[jt]s)?)$/;

/** Whether `statement` is an import of names from one of the modules a config BoardSmith wrote imports. */
const shippedImport = (statement: ts.Statement) =>
  ts.isImportDeclaration(statement) &&
  statement.importClause !== undefined &&
  ts.isStringLiteral(statement.moduleSpecifier) &&
  SHIPPED_IMPORT.test(statement.moduleSpecifier.text);

const sameText = (node: ts.Node, expected: string) => node.getText().replace(/"/g, "'").replace(/\s/g, '') === expected;

/** Whether the property at `path` holds only what `defineGameViteConfig()` sets there. */
function shipped(path: string, value: ts.Expression): boolean {
  switch (path) {
    case 'plugins':
      return sameText(value, '[vue()]');
    case 'resolve':
    case 'test':
      return ts.isObjectLiteralExpression(value);
    case 'resolve.dedupe':
      return sameText(value, "['vue']");
    case 'test.exclude':
      return (
        ts.isArrayLiteralExpression(value) &&
        value.elements.every((e) =>
          ts.isSpreadElement(e) ? sameText(e.expression, 'configDefaults.exclude') : ts.isStringLiteral(e) && SHIPPED_EXCLUDES.has(e.text),
        )
      );
    default:
      return false;
  }
}

/**
 * The first thing a project's vite or vitest config does that `defineGameViteConfig()` does not, or
 * undefined when it does nothing more, so `boardsmith doctor --fix` can replace it with
 * `GAME_VITE_CONFIG` and lose nothing. Read from the syntax: a file may hold imports from vite, vitest,
 * the Vue plugin and its own vite config, and its default export, and its config objects only the Vue
 * plugin, the vue dedupe and the shipped excludes. Any other import (settings from a file of the
 * game's own, a side-effect import) is named, since replacing the file would drop what it brings in.
 */
export function settingNotShipped(text: string): string | undefined {
  const source = parse(text);
  const statement = source.statements.find((s) => !shippedImport(s) && !ts.isExportAssignment(s));
  if (statement) return statement.getText().split('\n')[0];
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isObjectLiteralElementLike(node)) {
      if (!ts.isPropertyAssignment(node)) {
        found = node.getText();
        return;
      }
      const path: string[] = [];
      for (let at: ts.Node = node; at !== source; at = at.parent) {
        if (ts.isPropertyAssignment(at)) path.unshift(at.name.getText().replace(/['"]/g, ''));
      }
      if (!shipped(path.join('.'), node.initializer)) {
        found = path.join('.');
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
