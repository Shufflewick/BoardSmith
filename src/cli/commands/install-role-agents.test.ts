/**
 * `boardsmith claude` installs one Claude Code agent per role (#454): `bs-mechanical`, `bs-bounded`,
 * `bs-judgement`, `bs-review` and `bs-second-opinion`, so a designer with only BoardSmith can dispatch every role the
 * skills name.
 *
 * Every install here is real, and targets a temp tree: the global install runs with HOME set to a
 * temp home, so the real ~/.claude is never read or written.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES } from '../lib/agent-roles.js';
import { installClaudeCommand, uninstallClaudeCommand } from './install-claude-command.js';
import { globalInstallInTempHome, installedSkillsTree } from './installed-skills.test-helper.js';

const AGENTS_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'slash-command', 'agents');

/** The frontmatter fields of an agent file, as `key: value` pairs. */
function frontmatter(text: string): Record<string, string> {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!block) throw new Error('agent file has no frontmatter');
  return Object.fromEntries(
    block[1].split('\n').map((line) => {
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
  );
}

describe('the role agents a global install writes into the home directory', () => {
  const { home } = globalInstallInTempHome('bs-install-role-agents-home-');
  const agentsDir = () => join(home(), '.claude', 'agents');

  it('installs one agent per role, named bs-<role>, exactly as shipped', () => {
    for (const role of ROLES) {
      const installed = join(agentsDir(), `bs-${role}.md`);
      expect(existsSync(installed), `bs-${role}.md must be installed`).toBe(true);
      expect(readFileSync(installed, 'utf-8')).toBe(readFileSync(join(AGENTS_SOURCE, `bs-${role}.md`), 'utf-8'));
    }
  });

  it('gives each agent its default model and effort: an alias, never a pinned version, and effort only medium or high', () => {
    const defaults = Object.fromEntries(
      ROLES.map((role) => {
        const fields = frontmatter(readFileSync(join(agentsDir(), `bs-${role}.md`), 'utf-8'));
        expect(fields.name).toBe(`bs-${role}`);
        expect(['haiku', 'sonnet', 'opus'], `bs-${role} model must be an alias`).toContain(fields.model);
        if (fields.effort !== undefined) expect(['medium', 'high']).toContain(fields.effort);
        return [role, [fields.model, fields.effort]];
      }),
    );
    expect(defaults).toEqual({
      mechanical: ['haiku', undefined],
      bounded: ['sonnet', 'medium'],
      judgement: ['opus', 'medium'],
      review: ['opus', 'high'],
      'second-opinion': ['sonnet', 'high'],
    });
  });

  it('puts the second opinion on a different model family from the judgement it checks, so the two stay independent', () => {
    const model = (role: string) => frontmatter(readFileSync(join(agentsDir(), `bs-${role}.md`), 'utf-8')).model;
    expect(model('second-opinion')).not.toBe(model('judgement'));
  });

  it('tells every agent its prompt starts with the work package, and every agent that reviews to refuse a review prompt without the verify brief', () => {
    for (const role of ROLES) {
      expect(readFileSync(join(agentsDir(), `bs-${role}.md`), 'utf-8')).toContain('Your prompt starts with `Work package: <id>`');
    }
    // bs-judgement takes the red team, the fidelity lens and the cross-chunk lens, so it refuses the same way bs-review does.
    const refusal =
      'review nothing and reply only: `REVIEW REFUSED: no verify result in the prompt. Run npx boardsmith review-gate <slug> and put its brief in the review prompt.`';
    for (const role of ['review', 'judgement']) {
      const text = readFileSync(join(agentsDir(), `bs-${role}.md`), 'utf-8').split(/\s+/).join(' ');
      expect(text, `bs-${role}`).toContain('Mechanical checks: done.');
      expect(text, `bs-${role}`).toContain(refusal);
    }
  });

  it('uninstall removes the five role agents and leaves an agent of the user\'s own alone', async () => {
    writeFileSync(join(agentsDir(), 'senior.md'), '---\nname: senior\n---\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await uninstallClaudeCommand();
    } finally {
      log.mockRestore();
    }
    expect(readdirSync(agentsDir())).toEqual(['senior.md']);
  });
});

describe('the role agents a local install writes into the project', () => {
  const skills = installedSkillsTree('bs-install-role-agents-local-');
  const agentsDir = () => join(skills.project, '.claude', 'agents');

  it('installs them beside the project\'s skills', () => {
    expect(readdirSync(agentsDir()).sort()).toEqual(ROLES.map((role) => `bs-${role}.md`).sort());
  });

  it('a non-force install puts back a role agent an interrupted install left out', async () => {
    rmSync(join(agentsDir(), 'bs-review.md'));
    mkdirSync(agentsDir(), { recursive: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await installClaudeCommand({ local: true, skipLink: true });
    } finally {
      log.mockRestore();
    }
    expect(existsSync(join(agentsDir(), 'bs-review.md'))).toBe(true);
  });
});
