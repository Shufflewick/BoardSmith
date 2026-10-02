/**
 * A WORLD PROJECT'S OWN SUITE PASSES THE DAY IT IS SCAFFOLDED (#456).
 *
 * `boardsmith init --world` writes `tests/world.test.ts`, which drives the world through
 * `boardsmith/world` exactly as a host does. That makes it the first thing to break when the world
 * API changes shape, and it did: on main it failed four tests and did not type-check, so every new
 * world started red and `boardsmith validate` refused it. The string checks in `init.test.ts` read
 * the file; only running it, against this checkout's library, proves it still drives that library.
 */
import { describe, expect, it, vi } from 'vitest';

import { spawnCli } from '../spawn-cli.test-helper.js';
import { smokeProject } from './smoke-project.test-helper.js';

vi.setConfig({ testTimeout: 180_000 });

describe('boardsmith init --world — the scaffolded suite (#456)', () => {
  it('type-checks clean and passes its own world test', async () => {
    const dir = await smokeProject(true);

    const typecheck = await spawnCli(['typecheck'], dir);
    expect(typecheck.stdout + typecheck.stderr).not.toMatch(/error TS/);
    expect(typecheck.code).toBe(0);

    const test = await spawnCli(['test', 'tests/world.test.ts'], dir);
    expect(test.stdout + test.stderr).not.toMatch(/×|FAIL/);
    // It ran the scaffold's tests rather than finding none to run.
    expect(test.stdout).toMatch(/Tests\s+6 passed \(6\)/);
    expect(test.code).toBe(0);
  });
});
