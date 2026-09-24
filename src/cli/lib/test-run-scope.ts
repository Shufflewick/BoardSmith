import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * WHAT A GAME PROJECT'S TEST RUN COVERS: the main checkout's tests, and nothing under `.boardsmith/`.
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
// .boardsmith/worktrees/, and vitest would otherwise collect their unfinished tests too.
// BoardSmith's commands that run tests refuse to start without this exclusion.
export default defineConfig(async (env) =>
  mergeConfig(typeof base === 'function' ? await base(env) : base, {
    test: { exclude: [...configDefaults.exclude, ${JSON.stringify(OUTSIDE_THE_CHECKOUT)}] },
  }),
);
`;
}

const CARRIES_EXCLUSION = /['"`]\.boardsmith\/\*\*['"`]/;

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
  if (CARRIES_EXCLUSION.test(text)) return undefined;
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
