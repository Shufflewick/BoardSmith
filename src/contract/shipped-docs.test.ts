/**
 * EVERY DOC A SHIPPED SKILL TELLS THE AGENT TO READ IS IN THE PACKAGE (#996).
 *
 * The /bs skills (build/investigate.md and the rest) send the agent to
 * `node_modules/boardsmith/docs/...`, and `boardsmith claim-quote-check` checks
 * citations into those files. An install from the official pack has only what
 * `npm pack` publishes, so a doc left out of `files` is a missing file in every game.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

// Slow one-time setup lives here, where no test timeout applies.
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: REPO_ROOT, encoding: 'utf8' });
if (pack.status !== 0) throw new Error(`npm pack --dry-run failed, so the shipped file list is unknown:\n${pack.stderr}`);
const SHIPPED = new Set((JSON.parse(pack.stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path));

const SKILLS = join(REPO_ROOT, 'src/cli/slash-command');
const NAMED_DOCS = new Set(
  readdirSync(SKILLS, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.md'))
    .flatMap((file) => readFileSync(join(SKILLS, file), 'utf8').match(/\bdocs\/[\w/.-]+\.md\b/g) ?? []),
);

describe('shipped docs (#996)', () => {
  it('the skills name the docs investigation reads', () => {
    expect([...NAMED_DOCS]).toEqual(
      expect.arrayContaining(['docs/core-concepts.md', 'docs/common-pitfalls.md', 'docs/actions-and-flow.md', 'docs/custom-ui-guide.md', 'docs/ui-components.md']),
    );
  });

  it('every doc a shipped skill names is in the pack', () => {
    expect([...NAMED_DOCS].filter((doc) => !SHIPPED.has(doc))).toEqual([]);
  });

  it('the API reference the docs link to is in the pack, and no docs test file is', () => {
    expect(SHIPPED.has('docs/api/index.md')).toBe(true);
    expect([...SHIPPED].filter((path) => path.startsWith('docs/') && !path.endsWith('.md'))).toEqual([]);
  });
});
