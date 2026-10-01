import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * WHAT A GAME PROJECT'S TEST RUN COVERS: the main checkout's tests, nothing under `.boardsmith/`,
 * and not the in-browser smoke test under `tests/browser/`, which only Playwright runs (#453).
 *
 * Chunks built side by side live in git worktrees at `.boardsmith/worktrees/<slug>`, inside the
 * project (#294), and vitest's discovery walks into dot-directories. Left alone, a plain
 * `npx vitest run` in the main checkout also runs every unfinished chunk's tests, so a designer or
 * the orchestrator sees failures, or passes, from code that is not on main (#298).
 *
 * The exclusion lives in ONE place: the project's own vitest config. `boardsmith init` writes it
 * (`generateVitestConfig`), `boardsmith doctor --fix` gives it to a project made before it existed,
 * and every command that runs a project's tests (`boardsmith test`, `constraint-check`,
 * `chunk-merge`) runs vitest against that config and refuses to start without it
 * (`testRunScopeProblem`). No command passes its own copy on the command line.
 */

/** The glob, relative to the project root, that no test run collects from. */
const OUTSIDE_THE_CHECKOUT = '.boardsmith/**';

/**
 * The browser tests, which run under Playwright against `boardsmith dev` (`boardsmith verify`'s
 * smoke check), never under vitest: vitest's default pattern matches `smoke.spec.ts`, and loading
 * it there fails. The glob matches them at any depth, so the copy in a git worktree kept inside the
 * project (`.worktrees/<name>/tests/browser/`) is left out too.
 */
const BROWSER_TESTS_DIR = join('tests', 'browser');
const BROWSER_TESTS = '**/tests/browser/**';

/** The glob BoardSmith wrote before #453's rollout, which leaves out only the top-level directory. */
const TOP_LEVEL_BROWSER_TESTS = 'tests/browser/**';

/** The vitest config `boardsmith init` and `boardsmith doctor --fix` write. */
export const VITEST_CONFIG_FILE = 'vitest.config.ts';

const CONFIG_EXTENSIONS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

/** Vitest's own config lookup order: any `vitest.config.*` wins over any `vite.config.*`. */
export const VITEST_CONFIG_NAMES = ['vitest.config', 'vite.config'].flatMap((base) =>
  CONFIG_EXTENSIONS.map((ext) => `${base}.${ext}`),
);

/** Every `vite.config.*` name, for the vitest config that builds on one. */
const VITE_CONFIG_NAMES = CONFIG_EXTENSIONS.map((ext) => `vite.config.${ext}`);

async function firstExisting(projectDir: string, names: readonly string[]): Promise<string | undefined> {
  for (const name of names) {
    try {
      await fs.stat(join(projectDir, name));
      return name;
    } catch {
      // Not this one.
    }
  }
  return undefined;
}

/** The config file vitest reads in this project, by name, or undefined when there is none. */
export function findVitestConfig(projectDir: string): Promise<string | undefined> {
  return firstExisting(projectDir, VITEST_CONFIG_NAMES);
}

/** The project's `vite.config.*`, by name, or undefined when there is none. */
export function findViteConfig(projectDir: string): Promise<string | undefined> {
  return firstExisting(projectDir, VITE_CONFIG_NAMES);
}

/**
 * The project's vitest config: the vite config it names (the Vue plugin and the single-Vue dedupe
 * apply to tests too), plus the one exclusion. `configDefaults.exclude` is spread in because
 * setting `exclude` at all replaces vitest's defaults (node_modules, dist, ...).
 */
export function generateVitestConfig(viteConfig: string | undefined): string {
  const base = viteConfig
    ? `import base from './${viteConfig}';`
    : 'const base = {};';
  return `import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
${base}

// A test run covers this checkout's tests only. Chunks built side by side are git worktrees under
// .boardsmith/worktrees/, and vitest would otherwise collect their unfinished tests too. The
// in-browser smoke test under tests/browser/ (at any depth, so a worktree's copy too) runs under
// Playwright (boardsmith verify), not here.
// BoardSmith's commands that run tests refuse to start without these exclusions.
export default defineConfig(async (env) =>
  mergeConfig(typeof base === 'function' ? await base(env) : base, {
    test: { exclude: [...configDefaults.exclude, ${JSON.stringify(OUTSIDE_THE_CHECKOUT)}, ${JSON.stringify(BROWSER_TESTS)}] },
  }),
);
`;
}

const CARRIES_EXCLUSION = /['"`]\.boardsmith\/\*\*['"`]/;
const CARRIES_BROWSER_EXCLUSION = /['"`]\*\*\/tests\/browser\/\*\*['"`]/;
const CARRIES_TOP_LEVEL_BROWSER_EXCLUSION = /['"`]tests\/browser\/\*\*['"`]/;

/**
 * Why this project's test run would collect `.boardsmith/`, as a sentence that says how to fix it,
 * or undefined when its vitest config leaves that directory out.
 *
 * The check reads the config vitest would load and looks for the exclusion glob in it. It does not
 * evaluate the config, so it cannot tell a glob in a comment from a real one; the configs BoardSmith
 * writes, and the edit this message asks for, both put it in `test.exclude`.
 */
export async function testRunScopeProblem(projectDir: string): Promise<string | undefined> {
  const config = await findVitestConfig(projectDir);
  if (config === undefined) {
    return (
      `This project has no vitest config, so its test runs would also collect the unfinished chunks ` +
      `under .boardsmith/worktrees/. Run \`boardsmith doctor --fix\` to write ${VITEST_CONFIG_FILE}, then run this again.`
    );
  }
  const text = await fs.readFile(join(projectDir, config), 'utf-8');
  if (CARRIES_EXCLUSION.test(text)) return browserTestsProblem(projectDir, config, text);
  if (config.startsWith('vite.config.')) {
    return (
      `${config} does not leave .boardsmith/ out of test runs, so they would also collect the unfinished ` +
      `chunks under .boardsmith/worktrees/. Run \`boardsmith doctor --fix\` to write ${VITEST_CONFIG_FILE}, then run this again.`
    );
  }
  return (
    `${config} does not leave .boardsmith/ out of test runs, so they would also collect the unfinished ` +
    `chunks under .boardsmith/worktrees/. Add this to its \`test\` block, then run this again:\n` +
    `  exclude: [...configDefaults.exclude, '${OUTSIDE_THE_CHECKOUT}'],\n` +
    `(import configDefaults from 'vitest/config').`
  );
}

/**
 * Why `config` would collect the project's browser tests, or undefined when it has none or leaves
 * them out. Only a project with `tests/browser/` is asked, so a config written before the smoke
 * test existed keeps working until the project gains one.
 */
async function browserTestsProblem(projectDir: string, config: string, text: string): Promise<string | undefined> {
  if (CARRIES_BROWSER_EXCLUSION.test(text)) return undefined;
  const hasBrowserTests = await fs.stat(join(projectDir, BROWSER_TESTS_DIR)).then(
    (stat) => stat.isDirectory(),
    () => false,
  );
  if (!hasBrowserTests) return undefined;
  if (CARRIES_TOP_LEVEL_BROWSER_EXCLUSION.test(text)) {
    return (
      `${config} leaves out only the project's own tests/browser/, so vitest still collects the smoke test in a git ` +
      `worktree kept inside the project (.worktrees/<name>/tests/browser/). In its \`test.exclude\`, replace ` +
      `'${TOP_LEVEL_BROWSER_TESTS}' with '${BROWSER_TESTS}', then run this again.`
    );
  }
  return (
    `${config} does not leave tests/browser/ out of test runs, so vitest would collect the in-browser smoke test, ` +
    `which runs only under Playwright (\`boardsmith verify\`, \`boardsmith smoke\`). Add '${BROWSER_TESTS}' to its ` +
    `\`test.exclude\`, beside '${OUTSIDE_THE_CHECKOUT}', then run this again.`
  );
}
