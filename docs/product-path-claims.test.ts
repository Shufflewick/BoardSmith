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
 * 2. The worlds sentence is still the one that is true today. It was a CAVEAT
 *    until #167 -- "a world itself runs only on the hosting platform, and
 *    `boardsmith dev` plays a world project's table half" -- and that test
 *    existed so that the ticket which made it false could not land without
 *    rewriting it. #167 landed, so the sentence is now the claim that a world
 *    runs on a laptop, pinned in the same way and for the same reason: the next
 *    thing that makes it false must fail here first.
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
hosting and the social platform around it. A persistent world takes the same
path: \`boardsmith init --world\` scaffolds one, and \`boardsmith dev\` runs it on
your laptop with no network at all -- genesis, commands, per-seat views,
scheduled events and presence, over a durable local store. See
[Persistent worlds](${docsPrefix}persistent-worlds.md) for what a world is and how one is
written.`;

/** The one copy the step and caveat assertions below are written against. */
const PITCH = pitch('./');

/**
 * The worlds sentence, as #167 rewrote it.
 *
 * It replaces `WORLDS_CAVEAT`, which said the opposite and was pinned here so
 * that the ticket making it false could not land without editing this file.
 * That worked, and this is the same pin pointing the other way: a world runs on
 * a laptop now, and the next change that makes THAT false has to come here
 * first.
 */
const WORLDS_CLAIM =
  'A persistent world takes the same\npath: `boardsmith init --world` scaffolds one, and `boardsmith dev` runs it on\n' +
  'your laptop with no network at all -- genesis, commands, per-seat views,\n' +
  'scheduled events and presence, over a durable local store.';

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

describe('#167: the worlds sentence is the one that is true today', () => {
  it('says `boardsmith dev` runs a world on the laptop, with no network', () => {
    expect(
      PITCH,
      '`boardsmith dev` runs a world project\'s world as of #167: genesis into a durable ' +
        'local store, command dispatch, per-seat views, scheduled events and presence. The ' +
        'landing pages are where an author learns that, so they have to say it.',
    ).toContain(WORLDS_CLAIM);
  });

  it('does not still carry the caveat #167 deleted', () => {
    expect(
      /runs only on the hosting platform|plays a world project's table half/.test(PITCH),
      'That was true until #167 and is not any more. `boardsmith dev` does not play a world ' +
        "project's table half; it runs the world, and a world project need not have a table " +
        'half at all.',
    ).toBe(false);
  });

  it.each(LANDING_PAGES)('$path sends the reader to the page that owns the detail', ({ docsPrefix }) => {
    expect(pitch(docsPrefix)).toContain(`[Persistent worlds](${docsPrefix}persistent-worlds.md)`);
  });
});
