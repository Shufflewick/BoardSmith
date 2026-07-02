import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { build, type Plugin as EsbuildPlugin } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';

import type { GameDefinition } from '../../session/index.js';

/**
 * Detect if we're running in the BoardSmith monorepo or a standalone game project.
 * - Monorepo: Has src/engine/ directory (collapsed structure)
 * - Standalone: Has boardsmith.json but no src/engine/
 */
export function getProjectContext(cwd: string): 'monorepo' | 'standalone' {
  const hasSrcEngine = existsSync(join(cwd, 'src', 'engine'));
  const hasBoardsmithJson = existsSync(join(cwd, 'boardsmith.json'));

  // If we're in the monorepo root, it has src/engine
  if (hasSrcEngine) return 'monorepo';

  // Standalone game project
  if (hasBoardsmithJson) return 'standalone';

  // Fallback - treat as standalone (will fail with proper error if neither)
  return 'standalone';
}

// Get the CLI's directory to find the monorepo root.
// HAZARD: this depends on this file's directory depth (and differs between
// tsx-src and built-dist layouts). This file MUST live in the same directory
// as dev.ts (src/cli/commands/) so the relative path math below stays correct.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// After monorepo collapse, CLI is at dist/cli/, monorepo root is 2 levels up
export const cliMonorepoRoot = resolve(__dirname, '..', '..');

/**
 * esbuild plugin to resolve boardsmith/* imports to the monorepo source.
 * Only used in monorepo context - standalone games resolve from node_modules.
 * Returns a no-op plugin for standalone context.
 */
export function boardsmithResolvePlugin(context: 'monorepo' | 'standalone'): EsbuildPlugin {
  if (context === 'standalone') {
    return {
      name: 'boardsmith-resolve-noop',
      setup() {
        // No-op: let normal resolution handle boardsmith imports
      },
    };
  }

  return {
    name: 'boardsmith-resolve',
    setup(esbuildBuild) {
      const packageDirs: Record<string, string> = {
        'boardsmith': 'engine',
        'boardsmith/ai': 'ai',
        'boardsmith/ai-trainer': 'ai-trainer',
        'boardsmith/client': 'client',
        'boardsmith/runtime': 'runtime',
        'boardsmith/session': 'session',
        'boardsmith/testing': 'testing',
        'boardsmith/ui': 'ui',
      };

      esbuildBuild.onResolve({ filter: /^boardsmith(\/.*)?$/ }, (args) => {
        const importPath = args.path;
        const dirName = packageDirs[importPath];
        if (dirName) {
          return { path: join(cliMonorepoRoot, 'src', dirName, 'index.ts') };
        }
        return undefined;
      });
    },
  };
}

/** Forward-slash an absolute path for use in a Vite module specifier / `/@fs/` URL. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Bundle and load ONLY the author's `gameDefinition` (Node side), via a
 * synthetic esbuild live-bundle entry that re-exports it from the project's
 * rules index. Unlike `dev.ts`'s `loadGameRuntime`, this does NOT re-export
 * `executeOp` — callers needing full action execution (the dev multiplayer
 * host) must use `loadGameRuntime` instead; `simulate` only needs the bare
 * `gameClass` to hand to `simulateRandomGames`/`createTestGame`, which run the
 * engine directly without the stateless-ops executor.
 *
 * SECURITY NOTE (T-125-03, accepted risk): like `dev`/`build`, this
 * dynamic-imports the project's OWN rules module — arbitrary code from the
 * project being simulated executes in this CLI process. This is the same
 * trust model as every other BoardSmith CLI command; there is no
 * untrusted-third-party input path (a developer only ever simulates their own
 * game).
 */
export async function loadGameDefinition(
  rulesPath: string,
  tempDir: string,
  context: 'monorepo' | 'standalone',
): Promise<{ gameDefinition: GameDefinition }> {
  const rulesIndexPath = join(rulesPath, 'index.ts');
  const entryPath = join(tempDir, 'simulate-entry.ts');
  writeFileSync(
    entryPath,
    [`export { gameDefinition } from ${JSON.stringify(toPosix(rulesIndexPath))};`].join('\n'),
  );
  const bundlePath = join(tempDir, 'simulate-bundle.mjs');

  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    logLevel: 'silent',
    plugins: [boardsmithResolvePlugin(context)],
  });

  const moduleUrl = pathToFileURL(bundlePath).href;
  const module = await import(`${moduleUrl}?t=${Date.now()}`);

  if (!module.gameDefinition) {
    throw new Error('Rules module must export a gameDefinition');
  }

  return { gameDefinition: module.gameDefinition as GameDefinition };
}
