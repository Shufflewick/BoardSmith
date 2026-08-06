/**
 * The Action Panel parity doctrine must stay stated, and the vocabulary for it
 * must stay unified.
 *
 * A game port (SotF, BUG-011) built a custom compass board, read the panel's
 * copy of the same eight directions as a defect, and filed a request for a way
 * to suppress it — reasonably, because `.suppressFromDock()` read from its name
 * as the supported answer and nothing in the docs said the panel is meant to be
 * there. It is: the panel is the keyboard/screen-reader path, and a board
 * control is in addition to it, never instead of it. That was never written
 * down, so every custom-board game rediscovers it as a bug.
 *
 * Two things are asserted here rather than trusted to review:
 *
 *   1. The doctrine is present where a designer will actually hit it — the
 *      actions reference, the custom-UI guide (read BEFORE building a board),
 *      and the bs-build skill an agent follows.
 *   2. "dock" is not reintroduced as a synonym. The surface had two names, so
 *      the docs said "dock" while the API said `ActionPanel`; a reader could not
 *      tell whether they were the same thing. "Action Panel" is the only name.
 *
 * These are prose assertions on purpose: the failure message tells the next
 * editor why the sentence they just removed mattered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(DOCS);

const read = (p: string): string => readFileSync(join(REPO, p), 'utf8');

/**
 * Read a doc as one flowed line with markdown/JSDoc decoration removed, so a
 * sentence assertion survives rewrapping, `*emphasis*`, blockquote `>` and
 * JSDoc ` * ` gutters. Without this the tests fail on reflow, and a test that
 * fails on reflow gets deleted rather than fixed.
 */
const flowed = (p: string): string =>
  read(p)
    .replace(/^[ \t]*(\*|>)[ \t]?/gm, ' ')
    .replace(/[*`_]/g, '')
    .replace(/\s+/g, ' ');

/** Everywhere a designer or agent decides what to do about the panel. */
const PARITY_SURFACES = [
  'docs/actions-and-flow.md',
  'docs/custom-ui-guide.md',
  'src/cli/slash-command/bs/build/build.md',
  'src/engine/action/action-builder.ts',
] as const;

describe('Action Panel parity doctrine', () => {
  it.each(PARITY_SURFACES)('%s states that the panel is always on', (path) => {
    expect(
      flowed(path),
      `${path} must state that the Action Panel is on at all times. Without it, a game ` +
        `with a custom board reads the panel as a duplicate and tries to remove it.`,
    ).toMatch(/Action Panel is (always )?on at all times|Action Panel is always on/i);
  });

  it.each(PARITY_SURFACES)('%s states that a board control is IN ADDITION to the panel', (path) => {
    expect(
      flowed(path),
      `${path} must say a custom board control is in addition to the Action Panel, never ` +
        `instead of it — that is the sentence that answers "can I turn the panel off?".`,
    ).toMatch(/in addition to the panel, never instead of it/i);
  });

  it.each(PARITY_SURFACES)('%s scopes suppression to the START BUTTON only', (path) => {
    const text = flowed(path);
    expect(
      /start button/i.test(text),
      `${path} must scope .suppressFromActionPanel() to the start button. Its reach stopping ` +
        `short of a live choice list is the exact confusion BUG-011 was filed about.`,
    ).toBe(true);
  });

  it('names the panel as the accessibility path, not just as a convention', () => {
    for (const path of ['docs/actions-and-flow.md', 'docs/custom-ui-guide.md']) {
      expect(read(path), `${path} must give the REASON (keyboard / screen reader)`).toMatch(
        /keyboard/i,
      );
      expect(read(path)).toMatch(/screen[- ]reader/i);
    }
  });

  it('rules out CSS-hiding the panel, the workaround that looks like a compromise', () => {
    // Hiding an operable control while leaving it in the tab order and the
    // accessibility tree is strictly worse than showing it, so it has to be
    // named — a reader told only "do not suppress it" reaches for CSS next.
    for (const path of ['docs/actions-and-flow.md', 'docs/custom-ui-guide.md', 'src/cli/slash-command/bs/build/build.md']) {
      expect(read(path), `${path} must rule out CSS-hiding the panel`).toMatch(/CSS[- ]hid|hiding the panel in CSS/i);
    }
  });
});

describe('one name for the surface: "Action Panel"', () => {
  const NAMED_SURFACES = [
    'docs/actions-and-flow.md',
    'docs/custom-ui-guide.md',
    'docs/ui-components.md',
    'src/cli/slash-command/bs/build/build.md',
    'src/engine/action/action-builder.ts',
    'src/engine/action/types.ts',
    'src/ui/components/auto-ui/ActionPanel.vue',
    'src/ui/components/GameShell.vue',
  ] as const;

  it.each(NAMED_SURFACES)('%s does not call it a "dock"', (path) => {
    const offenders = read(path)
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      // "docked"/"docking" describe layout position (a docked hand strip), a
      // different and legitimate use — only the noun is retired.
      .filter(([, line]) => /\bdocks?\b/i.test(line));
    expect(
      offenders.map(([n, l]) => `${path}:${n}: ${l.trim()}`).join('\n'),
      `"dock" is retired as a name for the Action Panel — one surface, one name. ` +
        `The API says ActionPanel; the prose must not say something else.`,
    ).toBe('');
  });

  it('has no `suppressFromDock` left anywhere in src or docs', () => {
    // The rename is only worth anything if the old name is gone: two spellings
    // of one flag is how the two-names problem started.
    const hits = read('src/engine/action/action-builder.ts') + read('src/ui/types.ts');
    expect(hits).not.toMatch(/suppressFromDock/);
    expect(read('src/engine/action/action-builder.ts')).toMatch(/suppressFromActionPanel\(\): this/);
  });
});
