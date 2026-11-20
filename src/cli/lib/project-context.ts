import { styleText } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which kind of BoardSmith workspace a command is running in.
 *
 * - `standalone` — a game project created by `boardsmith init` (has `boardsmith.json`).
 * - `monorepo`  — the BoardSmith library repo itself (has `src/engine/` and no `boardsmith.json`).
 */
export type ProjectContext = 'monorepo' | 'standalone';

/**
 * Detect the workspace kind from the filesystem.
 *
 * Single source of truth: every command that behaves differently in the library
 * repo versus a game project asks this, so the two never drift apart.
 */
export function getProjectContext(cwd: string): ProjectContext {
  // boardsmith.json first: a game may keep its own rules under src/engine (#1732).
  if (existsSync(join(cwd, 'boardsmith.json'))) return 'standalone';
  if (existsSync(join(cwd, 'src', 'engine'))) return 'monorepo';

  // Neither: treat as standalone, which fails with a proper error.
  return 'standalone';
}

/**
 * True when `cwd` is a real BoardSmith workspace, rather than the fallback
 * `standalone` guess `getProjectContext` returns for an unrelated directory.
 */
function isBoardsmithWorkspace(cwd: string): boolean {
  return existsSync(join(cwd, 'src', 'engine')) || existsSync(join(cwd, 'boardsmith.json'));
}

/**
 * Stop the command with one actionable error when `cwd` is not a BoardSmith
 * workspace.
 *
 * The commands that work in BOTH contexts (`lint`, `audit`) share this so the
 * refusal reads the same wherever it comes from, instead of letting an
 * underlying tool fail with something cryptic.
 */
export function requireBoardsmithWorkspace(cwd: string): void {
  if (isBoardsmithWorkspace(cwd)) return;
  console.error(styleText('red', 'Error: not a BoardSmith workspace'));
  console.error(styleText('dim', 'Run this from a game project (has boardsmith.json) or the BoardSmith repo.'));
  process.exit(1);
}
