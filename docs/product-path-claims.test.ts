/**
 * #168: the product path is written down, in the two places a new author lands,
 * and it stays honest about persistent worlds.
 *
 * The premise every ticket in the worlds master plan (#175) rests on is that
 * BoardSmith is one install, one init, a whole game developed and played on a
 * laptop with no infrastructure, then one publish to ShufflewickPub which
 * supplies networking, hosting and the social platform. Before this test the
 * repo never said it: `getting-started.md` opened with "a TypeScript framework
 * for building turn-based board and card games", named ShufflewickPub nowhere,
 * and mentioned an account nowhere.
 *
 * The repo also had no root README.md at all, so a stranger arriving from GitHub
 * or npm was told nothing; it is a landing page here for that reason.
 *
 * Two things are asserted, because prose that is merely reviewed drifts:
 *
 * 1. Every landing page carries the SAME paragraph, byte for byte apart from
 *    the relative prefix each needs to reach `docs/`. Copies of a pitch that
 *    are free to diverge become several pitches.
 * 2. The worlds sentence is still the one that is true today. A world does not
 *    run on a laptop until #167 lands `boardsmith dev` for worlds, so the
 *    paragraph says so. When #167 ships, this test fails, and the failure names
 *    the sentence to rewrite. That is the point of it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DOCS, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf-8');

/**
 * Every page a new author lands on, with the relative prefix each one needs to
 * reach `docs/`. The root README is what a stranger sees on GitHub and on npm,
 * so it carries the pitch too; it just sits one directory further out, which is
 * the ONLY difference the paragraph is allowed to have between copies.
 */
const LANDING_PAGES: Array<{ path: string; docsPrefix: string }> = [
  { path: 'README.md', docsPrefix: './docs/' },
  { path: 'docs/README.md', docsPrefix: './' },
  { path: 'docs/getting-started.md', docsPrefix: './' },
];

/**
 * The paragraph itself, as it must appear in every landing page. Editing the
 * pitch means editing it here too, which is the review this file exists to
 * force.
 */
const pitch = (docsPrefix: string) => `## The path from an idea to players

BoardSmith is one install and one command away from a game you can play.
\`npx boardsmith init my-game\` scaffolds the project, \`npm install\` pulls in the
whole engine, \`boardsmith dev\` hosts real multiplayer on your own machine with
no server, database or service to provision, and \`boardsmith test\` drives the
same rules headlessly. When the game is ready, \`boardsmith publish\` sends the
bundle to ShufflewickPub, where a single account supplies the networking, the
hosting and the social platform around it. Persistent worlds are the one part of
this path still being built: a world's rules run locally today under
\`boardsmith test\`, but a world itself runs only on the hosting platform, and
\`boardsmith dev\` plays a world project's table half. See
[Persistent worlds](${docsPrefix}persistent-worlds.md) for which half is which.`;

/** The one copy the step and caveat assertions below are written against. */
const PITCH = pitch('./');

/** The sentence #167 comes back and rewrites once a world runs on a laptop. */
const WORLDS_CAVEAT =
  "Persistent worlds are the one part of\nthis path still being built: a world's rules run locally today under\n" +
  "`boardsmith test`, but a world itself runs only on the hosting platform, and\n" +
  "`boardsmith dev` plays a world project's table half.";

describe('#168: the product path is written down where an author lands', () => {
  it.each(LANDING_PAGES)('$path states it', ({ path, docsPrefix }) => {
    expect(
      read(path),
      `${path} is where an author starts. The premise of the whole plan (#175) ` +
        'has to be readable there, in the same words as every other landing page.',
    ).toContain(pitch(docsPrefix));
  });

  it('names every step of the path, so no step can quietly fall out', () => {
    for (const step of [
      'npx boardsmith init',
      'npm install',
      '`boardsmith dev`',
      '`boardsmith publish`',
      'ShufflewickPub',
      'a single account',
      'networking',
      'hosting',
      'social platform',
    ]) {
      expect(PITCH, `The pitch stopped saying "${step}".`).toContain(step);
    }
  });

  it('does not promise infrastructure the author has to stand up', () => {
    expect(PITCH).toContain('no server, database or service to provision');
  });
});

describe('#168: the worlds sentence is the one that is true today', () => {
  it('says a world runs on the hosting platform and not on the laptop', () => {
    expect(
      PITCH,
      'A world cannot be developed and played locally until #167 lands ' +
        '`boardsmith dev` for worlds. Until then the paragraph must say so.',
    ).toContain(WORLDS_CAVEAT);
  });

  it.each(LANDING_PAGES)('$path sends the reader to the page that owns the detail', ({ docsPrefix }) => {
    expect(pitch(docsPrefix)).toContain(`[Persistent worlds](${docsPrefix}persistent-worlds.md)`);
  });
});
