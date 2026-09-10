import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { assertBareName, assertGameName } from './user-name.js';

describe('assertGameName', () => {
  it('accepts the kebab-case names the catalogue actually uses', () => {
    // Every game in ~/BoardSmithGames satisfies this; the rule was read off
    // them and off boardsmith.json's own schema, not invented.
    for (const name of ['hex', 'go-fish', 'doom-machine', 'one-two-punch', 'lacuna-expanse', 'seven']) {
      expect(() => assertGameName(name)).not.toThrow();
    }
    expect(() => assertGameName('catan-1995')).not.toThrow();
  });

  it('refuses a path-shaped name, which is the whole of #240', () => {
    // `init` joined this onto the invocation directory and then wrote it into
    // package.json as the package name.
    expect(() => assertGameName('/private/tmp/scratch/mygame')).toThrow(/path, not a name/);
    expect(() => assertGameName('nested/mygame')).toThrow(/path, not a name/);
    expect(() => assertGameName('../mygame')).toThrow(/path, not a name/);
    expect(() => assertGameName('..')).toThrow(/path, not a name/);
    expect(() => assertGameName('.')).toThrow(/path, not a name/);
    expect(() => assertGameName('~/mygame')).toThrow(/path, not a name/);
    expect(() => assertGameName('c:\\games\\mygame')).toThrow(/path, not a name/);
  });

  it('tells a path-shaped name to cd first rather than silently relocating', () => {
    // The refusal has to be actionable: the user wanted a project somewhere
    // else, and `init` only ever creates one in the invocation directory.
    expect(() => assertGameName('/tmp/scratch/mygame')).toThrow(/cd <the-parent-directory>/);
    expect(() => assertGameName('/tmp/scratch/mygame')).toThrow(/boardsmith init my-game/);
  });

  it('refuses a scoped name and says why a game name has no scope', () => {
    expect(() => assertGameName('@me/game')).toThrow(/not npm-scoped/);
    expect(() => assertGameName('@me/game')).toThrow(/Try: boardsmith init game/);
  });

  it('refuses a name whose PascalCase form would not be a TypeScript identifier', () => {
    // These are the ones npm itself would accept. `toPascalCase` splits on
    // `-`/`_` only, so a space or a dot survives into `export class My GameGame`
    // and a leading digit into `class 7WondersGame` -- sources that do not parse.
    expect(() => assertGameName('My Game')).toThrow(/kebab-case/);
    expect(() => assertGameName('my.game')).toThrow(/kebab-case/);
    expect(() => assertGameName('7-wonders')).toThrow(/kebab-case/);
  });

  it('refuses uppercase, underscores and stray hyphens', () => {
    for (const name of ['MyGame', 'my_game', '-mygame', 'mygame-', 'my--game']) {
      expect(() => assertGameName(name)).toThrow(/kebab-case/);
    }
  });

  it('offers the kebab-case form of what was typed, without ever substituting it', () => {
    expect(() => assertGameName('My Game')).toThrow(/Try: boardsmith init my-game/);
    expect(() => assertGameName('MyGame')).toThrow(/Try: boardsmith init my-game/);
    expect(() => assertGameName('my_game')).toThrow(/Try: boardsmith init my-game/);
  });

  it('omits the suggestion rather than proposing a different name than was typed', () => {
    // `7-wonders` has no honest kebab-case form: dropping the digit suggests
    // `wonders`, which is somebody else's game.
    for (const name of ['123', '7-wonders', '2048']) {
      expect(() => assertGameName(name)).toThrow(/kebab-case/);
      expect(() => assertGameName(name)).not.toThrow(/Try:/);
    }
  });

  it('refuses an empty name rather than creating a directory named nothing', () => {
    expect(() => assertGameName('')).toThrow(/empty/i);
    expect(() => assertGameName('   ')).toThrow(/empty/i);
  });

  it('refuses a name npm could not accept as a package name', () => {
    expect(() => assertGameName('a'.repeat(215))).toThrow(/at most 214/);
  });

  it('never quotes a filesystem path of its own in a refusal', () => {
    // CLAUDE.md: never leak implementation details. A refusal names what the
    // user typed and nothing about where the CLI is installed.
    for (const name of ['/tmp/x/y', 'My Game', '@me/game', '..']) {
      let message = '';
      try {
        assertGameName(name);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toContain(process.cwd());
      expect(message).not.toMatch(/\.ts:\d+/);
    }
  });
});

describe('assertBareName', () => {
  const REMEDY = 'Pass the slug of a chunk in this project.';

  it('refuses a location where an identity is expected, naming the argument', () => {
    expect(() =>
      assertBareName('<slug>', '../other-project/design/chunks/thing', REMEDY),
    ).toThrow(/<slug> "\.\.\/other-project\/design\/chunks\/thing" is a path, not a name/);
    expect(() => assertBareName('<slug>', '', REMEDY)).toThrow(/<slug> is empty/);
  });

  it("carries the calling command's own remedy, because only it knows where the thing goes", () => {
    expect(() => assertBareName('<slug>', '../thing', REMEDY)).toThrow(new RegExp(REMEDY));
    expect(() => assertBareName('<slug>', '', REMEDY)).toThrow(new RegExp(REMEDY));
  });

  it('accepts a slug that is only an identity', () => {
    // Looser than `assertGameName` on purpose: `chunk-check` ADDRESSES a chunk
    // directory that already exists on disk, whatever it is called, where
    // `init` MINTS a name that has to be legal in four places at once.
    expect(() => assertBareName('<slug>', 'board-and-pawn-move', REMEDY)).not.toThrow();
    expect(() => assertBareName('<slug>', 'icon_gear', REMEDY)).not.toThrow();
  });
});

/**
 * The gate. #239's two `join(cwd, outDir)` defects were written independently
 * because the line reads as correct, and #240 is the same mistake in the other
 * direction: a positional argument that is an identity, used as a location
 * without anybody deciding what a valid identity is.
 *
 * So the gate is over the command TABLE rather than over the implementations:
 * a new positional argument is declared in exactly one place, and declaring one
 * fails this test until its command validates it.
 */
describe('every positional CLI argument is decided to be a name or a path', () => {
  const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cliText = readFileSync(join(cliDir, 'cli.ts'), 'utf-8');

  /**
   * Positional arguments that are LOCATIONS, and so are `resolveUserPath`'s
   * business (#239) rather than this module's.
   */
  const PATH_ARGUMENTS = ['ingest-archive <rulebook>'];

  /**
   * Positional arguments that are IDENTITIES, and the module that must refuse
   * a path-shaped one before using it to build a path.
   */
  const NAME_ARGUMENTS: Record<string, string> = {
    'init <name>': 'commands/init.ts',
    'chunk-check <slug>': 'commands/chunk-provenance.ts',
  };

  const declared = [...cliText.matchAll(/\.command\('([a-z-]+ <[a-z.]+>)'\)/g)].map((m) => m[1]);

  it('finds the command table it thinks it is reading', () => {
    expect(declared).toContain('init <name>');
  });

  it('has classified every one of them', () => {
    const unclassified = declared.filter(
      (arg) => !PATH_ARGUMENTS.includes(arg) && NAME_ARGUMENTS[arg] === undefined,
    );
    // A new `.command('foo <bar>')` lands here. Decide which kind of argument
    // it is, then add it to the list above -- and if it is a name, validate it.
    expect(unclassified).toEqual([]);
  });

  it('validates every identity argument in the command that receives it', () => {
    const unvalidated = Object.entries(NAME_ARGUMENTS)
      .filter(([, module]) => !readFileSync(join(cliDir, module), 'utf-8').includes('user-name.js'))
      .map(([arg]) => arg);
    expect(unvalidated).toEqual([]);
  });
});
