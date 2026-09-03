/**
 * #304 regression guard: the docs must not tell a world author that this
 * toolchain runs their world.
 *
 * `core-concepts.md` said "`boardsmith dev` stands a world up resident when the
 * project's boardsmith.json declares a `world` block", and the CLI printed the
 * same claim. What the block really causes is `worldMode: true` on the game the
 * dev host constructs -- the engine's residency model for the project's TABLE
 * game -- and nothing else. Commands, genesis, the per-seat view, scheduled
 * events and presence are called by the hosting platform's world runner, which
 * is not in this repo.
 *
 * That is drift a reader cannot detect, which is why it is asserted here rather
 * than trusted to review: the failure message tells the next editor why the
 * sentence they just wrote is false, and where the true one lives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(DOCS, name), 'utf-8');

/** The pointer page every other doc sends a world author to. */
const POINTER = 'persistent-worlds.md';

/**
 * Claims that say this toolchain runs a world. Matched case-insensitively
 * against every prose doc, because the sentence is free to move.
 */
const FALSE_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /stands? (a|the|this|your) world up/i,
    why: 'Nothing here stands a world up. `boardsmith dev` constructs the project\'s table game with worldMode, which unlocks the partition APIs and changes nothing about how ops run.',
  },
  {
    pattern: /(running|runs) resident/i,
    why: 'Residency here means the engine\'s partition model, not a running world. Say which one you mean.',
  },
  {
    pattern: /`?boardsmith dev`? (runs|hosts|serves) (a|the|this|your) world\b/i,
    why: 'The CLI dispatches no world command, runs no genesis, projects no world view, fires no scheduled event and reports no presence. See ' + POINTER + '.',
  },
];

const proseDocs = readdirSync(DOCS)
  .filter((name) => name.endsWith('.md'))
  .sort();

describe('#304: no BoardSmith doc claims this toolchain runs a world', () => {
  it('reads the docs directory it thinks it is reading', () => {
    expect(proseDocs.length).toBeGreaterThan(10);
    expect(proseDocs).toContain('core-concepts.md');
  });

  it.each(proseDocs)('%s makes none of the claims', (doc) => {
    const text = read(doc);
    for (const { pattern, why } of FALSE_CLAIMS) {
      expect(pattern.test(text), `docs/${doc}: ${why}`).toBe(false);
    }
  });
});

describe(`#304: docs/${POINTER} is the pointer, and points somewhere real`, () => {
  it('exists', () => {
    expect(
      existsSync(join(DOCS, POINTER)),
      'A world author is sent here by the dev notice, by `boardsmith validate` and by core-concepts.md.',
    ).toBe(true);
  });

  const pointer = existsSync(join(DOCS, POINTER)) ? read(POINTER) : '';

  it('names the engine\'s own share of a world, and links where it is documented', () => {
    expect(pointer).toContain('worldMode');
    expect(pointer).toContain('core-concepts.md');
  });

  it('says who owns the world block, and names that authority\'s document', () => {
    expect(
      pointer,
      'The block\'s members are the hosting platform\'s to call. A reader has to be told whose contract to read.',
    ).toContain('docs/PERSISTENT-WORLDS.md');
  });

  it('names a way to actually run a world, because that is what the reader came for', () => {
    expect(
      pointer,
      'The example worlds run their whole world contract under plain vitest (`tests/world.test.ts` in each project). ' +
        'A pointer page that lists no runnable procedure repeats the defect it replaces.',
    ).toContain('tests/world.test.ts');
  });

  it('does not restate the deleted round architecture', () => {
    for (const gone of ['resolveAction', 'enrolAction', '--kind resolution']) {
      expect(
        pointer.includes(gone),
        `${gone} belongs to the round architecture, which was deleted.`,
      ).toBe(false);
    }
  });
});

describe('#304: the pages an author is actually sent to carry the pointer', () => {
  it('getting-started.md points a world author at it', () => {
    expect(
      read('getting-started.md'),
      'getting-started.md is where an author starts and it never said the word "world". ' +
        `The pointer to docs/${POINTER} has to start here.`,
    ).toContain(POINTER);
  });

  it('core-concepts.md sends the world-mode section on to it', () => {
    expect(read('core-concepts.md')).toContain(POINTER);
  });

  it('`boardsmith validate` ends a world project\'s run with it', () => {
    const validate = readFileSync(join(DOCS, '..', 'src', 'cli', 'commands', 'validate.ts'), 'utf-8');
    expect(
      validate,
      'validate\'s success guidance is the other place an author is sent from, so a world project ' +
        `has to leave that run knowing where docs/${POINTER} is.`,
    ).toContain('WORLD_AUTHORING_DOC');
  });
});
