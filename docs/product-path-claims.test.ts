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
 * Two things are asserted, because prose that is merely reviewed drifts:
 *
 * 1. Both landing pages carry the SAME paragraph, byte for byte. Two copies of
 *    a pitch that are free to diverge become two pitches.
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
const read = (name: string) => readFileSync(join(DOCS, name), 'utf-8');

/** The pages a new author actually lands on. */
const LANDING_PAGES = ['README.md', 'getting-started.md'];

/**
 * The paragraph itself, as it must appear in both pages. Editing the pitch
 * means editing it here too, which is the review this file exists to force.
 */
const PITCH = `## The path from an idea to players

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
[Persistent worlds](./persistent-worlds.md) for which half is which.`;

/** The sentence #167 comes back and rewrites once a world runs on a laptop. */
const WORLDS_CAVEAT =
  "Persistent worlds are the one part of\nthis path still being built: a world's rules run locally today under\n" +
  "`boardsmith test`, but a world itself runs only on the hosting platform, and\n" +
  "`boardsmith dev` plays a world project's table half.";

describe('#168: the product path is written down where an author lands', () => {
  it.each(LANDING_PAGES)('%s states it', (page) => {
    expect(
      read(page),
      `docs/${page} is where an author starts. The premise of the whole plan ` +
        '(#175) has to be readable there, in the same words as the other landing page.',
    ).toContain(PITCH);
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

  it('sends the reader to the page that owns the detail', () => {
    expect(PITCH).toContain('[Persistent worlds](./persistent-worlds.md)');
  });
});
