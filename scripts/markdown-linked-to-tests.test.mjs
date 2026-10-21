/**
 * Every tracked Markdown file is imported by a test, or `untested` in `.agent-policy.json` names it,
 * never both (#1370).
 *
 * `agent-policy verify` runs the tests `vitest run --changed` picks, and vitest picks a test by
 * the files it imports. A test that reads Markdown with `readFileSync` imports none of it, so a
 * change to only that Markdown ran no test and could not pass verify. A test imports the Markdown
 * it reads instead (`vitest.config.ts` loads a `.md` file as its text), and Markdown no test reads
 * is listed as `untested`, so a change to it alone runs no tests. Markdown a test imports must not
 * be `untested`, or a change to it alone would skip that test.
 *
 * Scans that read every file of several kinds, code and Markdown alike (`check-no-control-bytes.test.mjs`,
 * `src/ui/theme.token-kinds.test.ts`), are linked to none of them and run in the merge's slices of the full suite.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../.agent-policy.json';

// Links this guard to the Markdown and the tests it checks, so `--changed` runs it when one changes; nothing loads.
import.meta.glob(['/**/*.md', '/.planning/**/*.md', '/src/**/*.test.ts', '/docs/**/*.test.ts', '/scripts/**/*.test.mjs']);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { untested = [] } = policy;
// agent-policy matches a pattern with no `/` against the file's name in any folder.
const untestedPathspecs = untested.map((pattern) => `:(glob)${pattern.includes('/') ? '' : '**/'}${pattern}`);
const gitFiles = (...pathspecs) =>
  execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], { cwd: ROOT, encoding: 'utf-8' }).split('\0').filter(Boolean);

const markdown = gitFiles('*.md');
const untestedMarkdown = new Set(untestedPathspecs.length ? gitFiles(...untestedPathspecs).filter((file) => file.endsWith('.md')) : []);

// Walks every test's imports the way `--changed` does, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false, related: markdown.map((file) => join(ROOT, file)) }, { root: ROOT });
await vitest.getRelevantTestSpecifications();
const { moduleGraph } = vitest.projects[0].vite;
const GUARD = fileURLToPath(import.meta.url);
const importedByATest = (file) =>
  [...(moduleGraph.getModulesByFile(join(ROOT, file)) ?? [])].some((mod) => [...mod.importers].some((importer) => importer.file !== GUARD));
const imported = new Set(markdown.filter(importedByATest));
await vitest.close();

describe('Markdown and the tests that read it (#1370)', () => {
  it('has every tracked Markdown file imported by a test, or named by "untested"', () => {
    expect(
      markdown.filter((file) => !imported.has(file) && !untestedMarkdown.has(file)),
      'A test that reads one of these must import it (`import text from "./x.md"`, or `import.meta.glob` ' +
        'for a folder) rather than read it from disk, so a change to it runs that test. Markdown no test ' +
        'reads goes in "untested" in .agent-policy.json.',
    ).toEqual([]);
  });

  it('names no Markdown a test imports as "untested"', () => {
    expect(
      [...untestedMarkdown].filter((file) => imported.has(file)),
      'A test imports these, so a change to one must run it. Narrow "untested" in .agent-policy.json to leave them out.',
    ).toEqual([]);
  });
});
