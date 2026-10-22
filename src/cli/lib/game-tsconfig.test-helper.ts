/**
 * THE TSCONFIG `boardsmith init` WRITES, AS THE TESTS THAT COMPILE A GAME USE IT (#1424).
 *
 * Every test that type-checks game code takes its compiler settings from
 * `generateTsConfig()` through here, so a change to the scaffold's tsconfig
 * reaches all of them, and none keeps a hand-copied setting that drifts.
 */
import { join } from 'node:path';
import ts from 'typescript';
import { generateTsConfig } from './project-scaffold.js';

/** The game's tsconfig as `boardsmith init` writes it, set to type-check only, compiling the files `include` names. */
export function gameTsConfig(include: readonly string[]): string {
  const scaffolded = JSON.parse(generateTsConfig()) as { compilerOptions: Record<string, unknown> };
  return JSON.stringify(
    {
      ...scaffolded,
      compilerOptions: {
        ...scaffolded.compilerOptions,
        noEmit: true,
        // Resolve from where the file SITS, not from where it really lives (see consumerInstall).
        preserveSymlinks: true,
      },
      include,
    },
    null,
    2,
  );
}

/**
 * `gameTsConfig(include)` read the way tsc reads `dir/tsconfig.json`: its
 * relative `paths` and its `types` resolve from `dir`, so `dir/node_modules`
 * must hold what the game installs, and `fileNames` lists what `include`
 * matches there. Config errors are in `errors`, for the caller's test to report.
 */
export function gameProject(dir: string, include: readonly string[]): ts.ParsedCommandLine {
  return ts.parseJsonConfigFileContent(
    JSON.parse(gameTsConfig(include)),
    ts.sys,
    dir,
    undefined,
    join(dir, 'tsconfig.json'),
  );
}
