import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

/**
 * A content hash over the installer-owned `bs-` skills tree (171-CONTEXT.md decision 7).
 *
 * WHY THIS EXISTS ALONGSIDE THE VERSION
 *
 * Phase 170 ran almost entirely on `--local` working-tree installs where the boardsmith package
 * version never changed while the skill text changed on nearly every run — recording version
 * alone would have stamped fourteen materially different skill contracts as identical. The
 * version is the human-readable anchor; this hash is what actually distinguishes two installs.
 *
 * SCOPE: this hashes exactly what `installClaudeCommand` (`install-claude-command.ts`) owns — the
 * 5 `bs-<name>/` skill dirs plus the single `bs-shared/` namespace root, both under a resolved
 * skills root. That pairing (project-local `.claude/skills` first, then `~/.claude/skills`) MUST
 * mirror `installClaudeCommand`'s own `--local`-then-global targetDir choice — if the two ever
 * diverge, this hash silently starts describing the wrong install.
 */

/** Reported when no skills root — or no `bs-`-prefixed entry inside one — can be found. */
export const SKILLS_TREE_ABSENT = 'not installed';

/**
 * Returns `<projectDir>/.claude/skills` if it exists and contains at least one `bs-`-prefixed
 * entry, else `<home>/.claude/skills` under the same condition, else `null`. Mirrors
 * `installClaudeCommand`'s own `--local`-then-global `targetDir` choice
 * (`install-claude-command.ts`): a project-local install always wins over a global one.
 */
export async function resolveSkillsRoot(projectDir: string): Promise<string | null> {
  const candidates = [join(projectDir, '.claude', 'skills'), join(homedir(), '.claude', 'skills')];

  for (const candidate of candidates) {
    if (await hasBsPrefixedEntry(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function hasBsPrefixedEntry(root: string): Promise<boolean> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return false; // Root does not exist (or is not a directory) — not an install.
  }
  return entries.some((entry) => entry.isDirectory() && entry.name.startsWith('bs-'));
}

/**
 * Walks the resolved skills root and returns one SHA-256 hex digest over every file under
 * `bs-`-prefixed entries — the installer's own ownership boundary, so a user's unrelated skill
 * sitting alongside the installed tree never affects this hash.
 *
 * Both the relative path AND the file content are fed into the hash, deliberately: a file moved
 * between skill directories changes which skill reads it, and hashing content alone would call
 * that identical to the file never having moved. Entries are sorted by root-relative POSIX path
 * before hashing, so on-disk creation order never affects the result.
 *
 * Returns `SKILLS_TREE_ABSENT` when no skills root can be found — never a placeholder hash. A
 * hash that cannot distinguish "no install" from "an install" would silently certify a state that
 * was never verified.
 */
export async function hashSkillsTree(projectDir: string): Promise<string> {
  const root = await resolveSkillsRoot(projectDir);
  if (root === null) {
    return SKILLS_TREE_ABSENT;
  }

  const files = await collectBsPrefixedFiles(root);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const hash = createHash('sha256');
  for (const relPath of files) {
    const bytes = await fs.readFile(join(root, ...relPath.split('/')));
    hash.update(relPath);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Root-relative POSIX paths of every file under `bs-`-prefixed top-level entries of `root`. */
async function collectBsPrefixedFiles(root: string): Promise<string[]> {
  const topLevel = await fs.readdir(root, { withFileTypes: true });
  const owned = topLevel.filter((entry) => entry.isDirectory() && entry.name.startsWith('bs-'));

  const files: string[] = [];
  for (const entry of owned) {
    await walk(join(root, entry.name), root, files);
  }
  return files;
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, root, out);
    } else if (entry.isFile()) {
      out.push(relative(root, fullPath).split(sep).join('/'));
    }
  }
}
