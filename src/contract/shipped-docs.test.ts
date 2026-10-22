/**
 * EVERY DOC A SHIPPED SKILL, A SHIPPED DOC OR THE CLI SENDS A READER TO IS IN THE PACKAGE (#996, #1306).
 *
 * The /bs skills (build/investigate.md and the rest) send the agent to
 * `node_modules/boardsmith/docs/...`, and `boardsmith claim-quote-check` checks
 * citations into those files. An install from the official pack has only what
 * `npm pack` publishes, so a doc left out of `files` is a missing file in every game.
 * The same holds for a relative link in a shipped doc and for a `docs/...` path
 * the CLI's messages and generated code name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { packedFiles } from './npm-pack.test-helper.js';
import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

// Slow one-time setup lives here, where no test timeout applies.
const SHIPPED = new Set(packedFiles(REPO_ROOT));

const DOC_PATH = /\bdocs\/[\w/.-]+\.md\b/g;
const INSTALLED = 'node_modules/boardsmith/';

const SKILL_TEXT = Object.entries(
  import.meta.glob<string>('/src/cli/slash-command/**/*.md', { eager: true, import: 'default' }),
).map(([path, text]) => ({ file: path.slice('/src/cli/slash-command/'.length), text }));

/** The Markdown the pack holds outside `src/`: package.json `files`, and the README npm always packs. */
const PACKABLE_MARKDOWN = import.meta.glob<string>(['/README.md', '/docs/*.md', '/docs/api/*.md'], { eager: true, import: 'default' });
const NAMED_DOCS = new Set(SKILL_TEXT.flatMap(({ text }) => text.match(DOC_PATH) ?? []));

/** Every relative link target in a shipped Markdown file outside `src/`, resolved from the package root, with its anchor dropped. */
const DOC_LINKS = [...SHIPPED]
  .filter((path) => path.endsWith('.md') && !path.startsWith('src/'))
  .flatMap((doc) => {
    const text = PACKABLE_MARKDOWN[`/${doc}`];
    if (text === undefined) throw new Error(`${doc} is in the pack but not in PACKABLE_MARKDOWN; add its folder there.`);
    // A fenced block is code, so a `](` in it is not a link.
    const prose = text.replace(/^```[\s\S]*?^```/gm, '');
    return [...prose.matchAll(/\]\(([^)\s]+)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
      .map((target) => ({ doc, target, path: posix.normalize(posix.join(posix.dirname(doc), target.split('#')[0])) }));
  });

/** Every `docs/...md` path a shipped source file names: the CLI's messages, the code it generates, and comments. */
const SOURCE_DOCS = [...SHIPPED]
  .filter((path) => path.startsWith('src/') && /\.(ts|mts|mjs|js|vue)$/.test(path))
  .flatMap((file) => (readFileSync(join(REPO_ROOT, file), 'utf8').match(DOC_PATH) ?? []).map((doc) => ({ file, doc })));

describe('shipped docs (#996)', () => {
  it('the skills name the docs investigation reads', () => {
    expect([...NAMED_DOCS]).toEqual(
      expect.arrayContaining(['docs/core-concepts.md', 'docs/common-pitfalls.md', 'docs/actions-and-flow.md', 'docs/custom-ui-guide.md', 'docs/ui-components.md']),
    );
  });

  it('every doc a shipped skill names is in the pack', () => {
    expect([...NAMED_DOCS].filter((doc) => !SHIPPED.has(doc))).toEqual([]);
  });

  it('a skill names each doc where a game has it, under node_modules/boardsmith (#1306)', () => {
    const bare = SKILL_TEXT.flatMap(({ file, text }) =>
      [...text.matchAll(DOC_PATH)]
        .filter((match) => text.slice(match.index - INSTALLED.length, match.index) !== INSTALLED)
        .map((match) => `${file}: ${match[0]}`),
    );
    expect(bare, 'An agent in a game has no docs/ folder of its own; write each as node_modules/boardsmith/docs/<name>.md.').toEqual([]);
  });

  it('the API reference the docs link to is in the pack, and no docs test file is', () => {
    expect(SHIPPED.has('docs/api/index.md')).toBe(true);
    expect([...SHIPPED].filter((path) => path.startsWith('docs/') && !path.endsWith('.md'))).toEqual([]);
  });

  it('every relative link in a shipped doc leads to a shipped file (#1306)', () => {
    expect(DOC_LINKS.length).toBeGreaterThan(0);
    const broken = DOC_LINKS.filter(({ path }) => !SHIPPED.has(path) && ![...SHIPPED].some((file) => file.startsWith(`${path.replace(/\/$/, '')}/`)));
    expect(broken.map(({ doc, target }) => `${doc} links to ${target}`)).toEqual([]);
  });

  it('every docs/ path shipped source names is in the pack (#1306)', () => {
    expect(SOURCE_DOCS.length).toBeGreaterThan(0);
    expect(SOURCE_DOCS.filter(({ doc }) => !SHIPPED.has(doc)).map(({ file, doc }) => `${file} names ${doc}`)).toEqual([]);
  });
});
