/**
 * WHICH COMMAND EACH SUBCOMMAND BELONGS TO (#348).
 *
 * `claude uninstall` was once attached to `harness-ingest`, because a
 * registration was inserted between `const claudeCmd =` and the command it was
 * meant to name. Commander accepted `boardsmith claude uninstall` as `claude`
 * with a stray argument, so asking to remove the skills installed them.
 *
 * So the whole tree is read in-process through `createProgram()` and every
 * subcommand's full path is pinned here. Attaching one to the wrong parent, or
 * adding one without saying where it belongs, fails this file.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { createProgram } from './cli.js';
import { SKILL_NAMES } from './commands/install-claude-command.js';
import { globalInstallInTempHome, installedSkillsTree } from './commands/installed-skills.test-helper.js';

/** Every command below the top level, as the words a user types to reach it. */
function subcommandPaths(command: Command, parents: string[] = []): string[] {
  return command.commands.flatMap((sub) => {
    const path = [...parents, sub.name()];
    return [...(path.length > 1 ? [path.join(' ')] : []), ...subcommandPaths(sub, path)];
  });
}

describe('the command tree (#348)', () => {
  it('attaches every subcommand to the command it belongs to', () => {
    expect(subcommandPaths(createProgram())).toEqual(['claude uninstall']);
  });
});

describe('commands that are steps of another command (#534)', () => {
  it('has no ingest-relabel: ingest-gaps relabels first, so a separate command is one to forget', () => {
    expect(createProgram().commands.map((c) => c.name())).not.toContain('ingest-relabel');
  });
});

describe('boardsmith claude uninstall --local (#348)', () => {
  const skills = installedSkillsTree('bs-cli-claude-uninstall-');

  // `claude` has a `--local` of its own. Unless its options stop at the
  // subcommand, it takes `uninstall --local` for itself and the uninstall runs
  // globally, so HOME is a temp tree holding its own install: that mistake
  // shows up as a failure here instead of emptying the real ~/.claude.
  const tempHome = globalInstallInTempHome('bs-cli-claude-uninstall-home-');

  it('removes the project\'s bs- skills and leaves the global ones alone', async () => {
    const globalRoot = join(tempHome.home(), '.claude', 'skills');
    for (const root of [skills.root, globalRoot]) {
      for (const name of SKILL_NAMES) expect(existsSync(join(root, name))).toBe(true);
    }

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await createProgram().parseAsync(['claude', 'uninstall', '--local'], { from: 'user' });
    } finally {
      log.mockRestore();
    }

    for (const name of SKILL_NAMES) {
      expect(existsSync(join(skills.root, name)), `${name} was left in the project`).toBe(false);
      expect(existsSync(join(globalRoot, name)), `${name} was removed globally`).toBe(true);
    }
  });
});
