/**
 * A TABLE PROJECT STARTS FROM TYPED GAME CODE (#620).
 *
 * `boardsmith init` writes an author's first rules, and they copy its patterns. It wrote
 * `Action.create('play')` and `args.card as Card`, the untyped form #511 took out of the docs: a
 * cast compiles whatever the builder really hands over, so it teaches the one habit that hides a
 * wrong type. The rules are written in the typed form, and compiled and run here under the
 * tsconfig `init` writes, against this checkout's library.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { spawnCli } from '../spawn-cli.test-helper.js';
import { smokeProject } from './smoke-project.test-helper.js';

vi.setConfig({ testTimeout: 180_000 });

const dir = await smokeProject(false);
const written = (path: string): string => readFileSync(join(dir, path), 'utf8');
const CODE = ['src/rules/game.ts', 'src/rules/actions.ts', 'src/rules/flow.ts', 'tests/game.test.ts'];

describe('boardsmith init — the table scaffold is typed game code (#620)', () => {
  it('types each action by the game, so no rule casts what the builder hands it', () => {
    expect(written('src/rules/actions.ts').match(/Action\.create(<\w+>)?\(/g)).toEqual([
      'Action.create<DevGameGame>(',
      'Action.create<DevGameGame>(',
    ]);
    for (const path of CODE) {
      // Comments left out, so prose is not read as code. `as const` narrows a literal; every other
      // `as` overrides the type the code was given.
      expect(written(path).replace(/\/\/.*$/gm, ''), path).not.toMatch(/\bas (?!const\b)/);
    }
  });

  it('type-checks clean and passes its own test', async () => {
    const typecheck = await spawnCli(['typecheck'], dir);
    expect(typecheck.stdout + typecheck.stderr).not.toMatch(/error TS/);
    expect(typecheck.code).toBe(0);

    const test = await spawnCli(['test', 'tests/game.test.ts'], dir);
    expect(test.stdout + test.stderr).not.toMatch(/×|FAIL/);
    expect(test.stdout).toMatch(/Tests\s+2 passed \(2\)/);
    expect(test.code).toBe(0);
  });
});
