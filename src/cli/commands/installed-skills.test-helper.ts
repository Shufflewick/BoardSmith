/**
 * A temp project with the bs- skills really installed into it (#238).
 *
 * Eleven suites across `install-claude-command.test.ts` and
 * `slash-command/bs/verify.test.ts` each hand-wrote the same six lines: record
 * the cwd, make a temp tree, chdir into it, run a real `installClaudeCommand`,
 * derive `<tree>/.claude/skills`, and chdir back afterwards. Nine of them were
 * identical and two differed only in leaving the install out. That is a missing
 * helper rather than eleven coincidences, and it is the shape this repo has
 * already answered three times (`action-panel-controller.test-helper.ts`,
 * `action-panel-editor.test-helper.ts`, `browser-harness.mjs`).
 *
 * The install is real -- no mocks, no fixture tree standing in for one -- which
 * is the whole point of these suites: they read what the installer actually
 * wrote. `skipLink: true` is not optional and is not a knob here, because
 * `npm link` would reach outside the temp tree and touch the machine.
 *
 * The temp tree itself belongs to `tempTree` (#236), so nothing here removes
 * it; the only teardown is the chdir, which is process state rather than disk.
 */
import { afterAll, beforeAll, vi } from 'vitest';
import { join } from 'node:path';
import { installClaudeCommand } from './install-claude-command.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/** The temp project a suite runs inside, and where the installer writes in it. */
class SkillsTree {
  /** The temp project. Empty until the suite's `beforeAll` has run. */
  project = '';

  /** `<project>/.claude/skills` -- derived, so it cannot drift from `project`. */
  get root(): string {
    return join(this.project, '.claude', 'skills');
  }
}

function chdirIntoTempTree(prefix: string): SkillsTree {
  const tree = new SkillsTree();
  let origCwd = '';

  beforeAll(() => {
    origCwd = process.cwd();
    tree.project = tempTree(prefix);
    process.chdir(tree.project);
  });

  afterAll(() => {
    process.chdir(origCwd);
  });

  return tree;
}

/**
 * A temp project this suite runs inside, with the bs- skills installed into it.
 *
 * `prefix` names the tree in the temp root, so it should say which suite owns
 * it -- that is what a leak would be identified by.
 */
export function installedSkillsTree(prefix: string): SkillsTree {
  const tree = chdirIntoTempTree(prefix);
  beforeAll(async () => {
    await installClaudeCommand({ local: true, force: true, skipLink: true });
  });
  return tree;
}

/**
 * A temp project this suite runs inside with NOTHING installed in it.
 *
 * For the suites that hand-build an interrupted install and then prove a
 * non-force run finishes it: what they are testing is the installer's reading
 * of a partial tree, so the tree has to be theirs to write.
 */
export function uninstalledSkillsTree(prefix: string): SkillsTree {
  return chdirIntoTempTree(prefix);
}

/**
 * A global install (`boardsmith claude`, no `--local`) with HOME pointed at a temp home for the
 * suite, so what a global install writes can be read without touching the real ~/.claude.
 * `prefix` names the temp home. Returns the home, empty until the suite's `beforeAll` has run.
 */
export function globalInstallInTempHome(prefix: string): { home: () => string } {
  let home = '';
  let realHome: string | undefined;
  beforeAll(async () => {
    realHome = process.env.HOME;
    home = tempTree(prefix);
    process.env.HOME = home;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installClaudeCommand({ force: true, skipLink: true });
    } finally {
      log.mockRestore();
    }
  });
  afterAll(() => {
    process.env.HOME = realHome;
  });
  return { home: () => home };
}
