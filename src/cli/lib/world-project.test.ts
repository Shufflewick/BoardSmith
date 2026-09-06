/**
 * #304, ANSWERED BY #167 RATHER THAN RE-WORDED.
 *
 * The original defect: for any project whose `boardsmith.json` declared a
 * `world` block, `boardsmith dev` printed `Persistent world: running resident
 * (worldMode)` and then served the project's TABLE game. An author read the
 * line, played the table game, and was told they had run their world. #304's
 * answer was an accurate notice with its wording pinned here.
 *
 * #167 makes the original claim TRUE: `boardsmith dev` opens the project's
 * durable world store, runs genesis, dispatches commands, projects views, fires
 * scheduled events and reports presence. So the notice that denied it is gone,
 * and this file's job flips. What it now guards is the OPPOSITE staleness --
 * a CLI surface still telling an author that a world cannot run here, which is
 * the sentence that will rot next, in exactly the way #304's did.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WORLD_AUTHORING_DOC, resolveWorldMode } from './world-project.js';
import { worldDevBanner } from '../commands/dev-world.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('resolveWorldMode (#171: the declared `backend` is the only way to say "this is a world")', () => {
  it('is false for a table game', () => {
    expect(resolveWorldMode({ backend: 'table' })).toBe(false);
  });

  it('is true once the project declares the world backend', () => {
    expect(resolveWorldMode({ backend: 'world' })).toBe(true);
  });

  it('is false for a project that declares nothing, which `boardsmith validate` refuses by name', () => {
    // Not a default: `deriveManifest` and `checkMetadataIssues` both refuse a
    // manifest with no backend. This only says what the dev host does with one
    // that got that far -- it starts a table, and the table path then reports
    // the missing declaration.
    expect(resolveWorldMode({})).toBe(false);
  });
});

describe('the world authoring doc the CLI sends an author to', () => {
  it('exists', () => {
    expect(
      existsSync(join(REPO_ROOT, WORLD_AUTHORING_DOC)),
      `${WORLD_AUTHORING_DOC} is what the CLI sends a world author to read, and it is not there.`,
    ).toBe(true);
  });
});

describe('#167: what a world run says about itself', () => {
  const banner = worldDevBanner({
    worldName: 'Example MUD',
    seatCount: 40,
    launched: false,
    ownWorldUi: false,
    storePath: '/tmp/p/.boardsmith-dev-world/world.db',
  }).join('\n');

  it('names the world, its seats and where it durably lives', () => {
    expect(banner).toContain('Example MUD');
    expect(banner).toContain('40 seats');
    expect(banner).toContain('.boardsmith-dev-world/world.db');
  });

  it('says whether genesis is about to run or has already run', () => {
    expect(banner).toContain('never been played');
    expect(
      worldDevBanner({
        worldName: 'x',
        seatCount: 2,
        launched: true,
        ownWorldUi: true,
        storePath: '/tmp/w',
      }).join('\n'),
    ).toContain('Genesis has already run');
  });

  it('says which surface it is serving, because the two look different', () => {
    expect(banner).toContain('no world.html');
    expect(
      worldDevBanner({
        worldName: 'x',
        seatCount: 2,
        launched: true,
        ownWorldUi: true,
        storePath: '/tmp/w',
      }).join('\n'),
    ).toContain('Serving your world.html');
  });

  it('names the three controls an author cannot discover by looking at a board', () => {
    expect(banner).toContain('switches seats');
    expect(banner).toContain('fires due events');
    expect(banner).toContain('wakes the');
    expect(banner).toContain('--reset');
  });
});

/**
 * THE SWEEP, INVERTED BY #167.
 *
 * It used to forbid a CLI surface from claiming a world ran here. A world does
 * run here now, so what it forbids is the leftover denial -- and the pattern
 * list is the exact set of sentences this ticket had to delete, so a future
 * editor who half-remembers the old rule is told it changed rather than quietly
 * reinstating it.
 */
describe('#167: no CLI surface still tells an author a world cannot run locally', () => {
  // Tests are excluded: they are not a surface an author reads, and this one
  // has to quote the false sentences in order to forbid them.
  const files = readdirSync(join(REPO_ROOT, 'src', 'cli'), { recursive: true, encoding: 'utf-8' })
    .filter((path) => path.endsWith('.ts') || path.endsWith('.vue'))
    .filter((path) => !path.endsWith('.test.ts') && !path.includes('__fixtures__'))
    .map((path) => join('src', 'cli', path));

  const STALE: Array<{ pattern: RegExp; why: string }> = [
    {
      pattern: /`?boardsmith dev`? (plays|serves) (this |the )?project's TABLE game/i,
      why: "It does not, for a world project: #167 branches to `dev-world.ts`, which serves the world. A world project need not have a table half at all.",
    },
    {
      pattern: /nothing here dispatches a world command/i,
      why: '`cli/dev-host/world-host.ts` dispatches one, through `settleDeclaration` and `runner.apply`, exactly as the platform does.',
    },
    {
      pattern: /(running a world locally|a world) is (BoardSmith )?#167 and is not built/i,
      why: '#167 is built. This sentence is the refusal it deleted.',
    },
    {
      pattern: /the world (runner|half) is (the )?platform's/i,
      why: 'The runner is `boardsmith/world` in this repository (#165), and `boardsmith dev` drives it (#167). What is the platform\'s is its lifecycle policy -- sockets, hibernation, eviction timing, the park ladder.',
    },
  ];

  it('reads the CLI tree it thinks it is reading', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files)('%s says none of it', (relative) => {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf-8').replace(/\s+/g, ' ');
    for (const { pattern, why } of STALE) {
      expect(pattern.test(source), `${relative}: ${why}`).toBe(false);
    }
  });
});
