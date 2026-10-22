/**
 * THE SKILL MARKDOWN, IMPORTED (#1370).
 *
 * A test that reads a skill file from disk is not linked to it, so `vitest run
 * --changed` (what `agent-policy verify` runs) skips that test when only the
 * skill changed. Imported here, every skill file is a dependency of the tests
 * that read it.
 */
import { posix } from 'node:path';

const SKILLS = import.meta.glob<string>('/src/cli/slash-command/**/*.md', { eager: true, import: 'default' });
const PREFIX = '/src/cli/slash-command/';

/** Every skill Markdown file, by its path from `src/cli/slash-command/` (`bs/build/build.md`). */
export const SKILL_FILES = Object.keys(SKILLS).map((key) => key.slice(PREFIX.length));

/** The text of the skill file at `path`, from `src/cli/slash-command/`. Throws when there is none. */
export function skillMarkdown(path: string): string {
  const text = SKILLS[posix.join(PREFIX, path)];
  if (text === undefined) throw new Error(`src/cli/slash-command/${path} is not a skill Markdown file.`);
  return text;
}
