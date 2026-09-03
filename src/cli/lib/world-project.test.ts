/**
 * #304: THE SENTENCE `boardsmith dev` PRINTED WAS THE DEFECT.
 *
 * For any project whose `boardsmith.json` declared a `world` block, the dev
 * command printed `Persistent world: running resident (worldMode)`. The single
 * thing that branch caused was `worldMode: true` on the game the dev host
 * constructs, which unlocks the engine's partition APIs and changes nothing
 * else about how ops run. The dev host went on serving the project's TABLE
 * game -- both example worlds ship one deliberately -- so an author read the
 * line, played the table game, and was told they had run their world.
 *
 * The world half of a game definition is called by the HOSTING PLATFORM's
 * world runner. This CLI does not contain one and does not start one. So the
 * notice has to say what the run really is and where a world really runs, and
 * these assertions are on that sentence because the sentence is what failed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WORLD_AUTHORING_DOC, resolveWorldMode, worldModeNotice } from './world-project.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('resolveWorldMode (#158: the manifest\'s `world` block is the only way to say "this is a world")', () => {
  it('is false for an ordinary game, which declares no world block', () => {
    expect(resolveWorldMode({})).toBe(false);
  });

  it('is true once the manifest declares a world block', () => {
    expect(resolveWorldMode({ world: { maxPlayers: 200 } })).toBe(true);
  });
});

describe('worldModeNotice (#304)', () => {
  it('says nothing about a project that declares no world', () => {
    expect(worldModeNotice({})).toEqual([]);
    expect(worldModeNotice({ world: undefined })).toEqual([]);
  });

  const notice = worldModeNotice({ world: { maxPlayers: 40 } }).join('\n');

  it('names the capacity the manifest declares, because that is the number an author checks', () => {
    expect(notice).toContain('40');
  });

  it('says the dev host runs the TABLE game', () => {
    expect(notice.toLowerCase()).toContain('table');
  });

  it('says the world half is run by the platform and not by this CLI', () => {
    expect(notice.toLowerCase()).toContain('platform');
  });

  /**
   * The claims the old line made. Each is matched against the whole notice; a
   * future editor gets told WHY the sentence they just wrote is false.
   */
  const FALSE_CLAIMS: Array<{ pattern: RegExp; why: string }> = [
    {
      pattern: /running resident/i,
      why: 'Nothing residing is what `boardsmith dev` starts. It constructs the table game with worldMode, which unlocks the partition APIs and nothing more.',
    },
    {
      pattern: /stands? (a|the|this|your) world up/i,
      why: 'No world is stood up locally. The world runner is the platform\'s and lives outside this repo.',
    },
    {
      pattern: /(runs|hosts|serves) (a|the|this|your) world\b/i,
      why: 'This CLI never dispatches a world command, runs a genesis, projects a world view, fires a scheduled event or reports presence.',
    },
  ];

  it.each(FALSE_CLAIMS)('does not claim $pattern', ({ pattern, why }) => {
    expect(pattern.test(notice), why).toBe(false);
  });

  it('points at the one doc that says where a world runs, and that doc exists', () => {
    expect(notice).toContain(WORLD_AUTHORING_DOC);
    expect(
      existsSync(join(REPO_ROOT, WORLD_AUTHORING_DOC)),
      `${WORLD_AUTHORING_DOC} is what the CLI sends a world author to read, and it is not there.`,
    ).toBe(true);
  });

  it('an undeclared capacity names the check that requires it, rather than printing "unset"', () => {
    const undeclared = worldModeNotice({ world: {} }).join('\n');
    expect(undeclared).toContain('boardsmith validate');
    expect(undeclared).not.toContain('unset');
  });
});

/**
 * The sentence is only worth asserting if it is the only one. This is the gate
 * that keeps a second, contradicting claim from being written somewhere else
 * in the CLI, which is exactly how the first one survived three architectures.
 */
describe('#304: no CLI surface claims a world runs locally', () => {
  // Tests are excluded: they are not a surface an author reads, and this one
  // has to quote the false sentence in order to forbid it.
  const files = readdirSync(join(REPO_ROOT, 'src', 'cli'), { recursive: true, encoding: 'utf-8' })
    .filter((path) => path.endsWith('.ts') || path.endsWith('.vue'))
    .filter((path) => !path.endsWith('.test.ts') && !path.includes('__fixtures__'))
    .map((path) => join('src', 'cli', path));

  const CLAIMS = [/running resident/i, /stands? (a|the|this|your) world up/i];

  it('reads the CLI tree it thinks it is reading', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s claims none of it', (relative) => {
    // The notice module is where the accurate sentence lives; it is allowed to
    // quote the false one only inside this test file, which is not shipped
    // behaviour.
    const source = readFileSync(join(REPO_ROOT, relative), 'utf-8');
    for (const claim of CLAIMS) {
      expect(
        claim.test(source),
        `${relative} tells an author that \`boardsmith dev\` runs their world. It does not: ` +
          `the world runner is the platform's. Say what the run is and point at ${WORLD_AUTHORING_DOC}.`,
      ).toBe(false);
    }
  });
});
