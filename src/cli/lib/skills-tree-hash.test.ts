import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashSkillsTree, resolveSkillsRoot, SKILLS_TREE_ABSENT } from './skills-tree-hash.js';

/**
 * `hashSkillsTree()` exists because Phase 170 ran almost entirely on `--local` working-tree
 * installs where the boardsmith package version never moved while the skill text changed on
 * nearly every run — recording version alone would have stamped fourteen materially different
 * skill contracts as identical (171-CONTEXT.md decision 7). This hash is what actually
 * distinguishes two installs.
 *
 * Fixture trees are built by hand rather than via `installClaudeCommand`, which has a global
 * `npm link` side effect this unit test must not couple to.
 *
 * The real dev machine running this suite has a real `~/.claude/skills` with real bs- skills
 * installed (this repo's own dogfood install). Any test asserting "no skills root found" must
 * override `$HOME` to an empty temp dir for the duration of the test, or it will silently pass
 * by falling through to the real global install instead of proving the absence path.
 */

let dir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-'));
  originalHome = process.env.HOME;
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await fs.rm(dir, { recursive: true, force: true });
});

/** Writes a minimal installed skills tree under `<root>/.claude/skills`. */
async function writeSkillsTree(
  root: string,
  files: Record<string, string>
): Promise<string> {
  const skillsRoot = join(root, '.claude', 'skills');
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(skillsRoot, relPath);
    await fs.mkdir(join(fullPath, '..'), { recursive: true });
    await fs.writeFile(fullPath, content);
  }
  return skillsRoot;
}

const BASE_TREE = {
  'bs-build-chunk/SKILL.md': '# Build Chunk\nStep 1.\n',
  'bs-shared/state-machine.md': '## States\nIdle -> Running\n',
};

describe('resolveSkillsRoot', () => {
  it('returns the project-local skills root when it exists and has a bs- entry', async () => {
    await writeSkillsTree(dir, BASE_TREE);
    const root = await resolveSkillsRoot(dir);
    expect(root).toBe(join(dir, '.claude', 'skills'));
  });

  it('returns null when neither the project-local nor home skills root has a bs- entry', async () => {
    const emptyHome = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-emptyhome-'));
    process.env.HOME = emptyHome;
    try {
      const emptyProject = join(dir, 'empty-project');
      await fs.mkdir(emptyProject, { recursive: true });
      const root = await resolveSkillsRoot(emptyProject);
      expect(root).toBeNull();
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('falls back to the home skills root when the project has none', async () => {
    const fakeHome = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-home-'));
    process.env.HOME = fakeHome;
    try {
      await writeSkillsTree(fakeHome, BASE_TREE);
      const emptyProject = join(dir, 'empty-project');
      await fs.mkdir(emptyProject, { recursive: true });
      const root = await resolveSkillsRoot(emptyProject);
      expect(root).toBe(join(fakeHome, '.claude', 'skills'));
    } finally {
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });
});

describe('hashSkillsTree', () => {
  it('returns a 64-char lowercase hex string for a populated fixture', async () => {
    await writeSkillsTree(dir, BASE_TREE);
    const hash = await hashSkillsTree(dir);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one byte inside a covered file changes', async () => {
    await writeSkillsTree(dir, BASE_TREE);
    const hashBefore = await hashSkillsTree(dir);

    await writeSkillsTree(dir, {
      ...BASE_TREE,
      'bs-build-chunk/SKILL.md': '# Build Chunk\nStep 2.\n',
    });
    const hashAfter = await hashSkillsTree(dir);

    expect(hashAfter).not.toBe(hashBefore);
  });

  it('changes when a file is renamed without changing its content (path is hashed too)', async () => {
    const dirA = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-b-'));
    try {
      await writeSkillsTree(dirA, {
        'bs-build-chunk/SKILL.md': 'identical content\n',
      });
      await writeSkillsTree(dirB, {
        'bs-build-chunk/RENAMED.md': 'identical content\n',
      });

      const hashA = await hashSkillsTree(dirA);
      const hashB = await hashSkillsTree(dirB);

      expect(hashA).not.toBe(hashB);
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });

  it('does NOT change when a non-bs- sibling directory is added to the skills root', async () => {
    await writeSkillsTree(dir, BASE_TREE);
    const hashBefore = await hashSkillsTree(dir);

    const skillsRoot = join(dir, '.claude', 'skills');
    await fs.mkdir(join(skillsRoot, 'unrelated-user-skill'), { recursive: true });
    await fs.writeFile(join(skillsRoot, 'unrelated-user-skill', 'SKILL.md'), 'not ours\n');

    const hashAfter = await hashSkillsTree(dir);
    expect(hashAfter).toBe(hashBefore);
  });

  it('produces the same hash for identical content written in a different order', async () => {
    const dirA = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-order-a-'));
    const dirB = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-order-b-'));
    try {
      // Write in one order
      await writeSkillsTree(dirA, {
        'bs-build-chunk/SKILL.md': 'alpha\n',
        'bs-shared/state-machine.md': 'beta\n',
      });
      // Write in the reverse order
      await writeSkillsTree(dirB, {
        'bs-shared/state-machine.md': 'beta\n',
        'bs-build-chunk/SKILL.md': 'alpha\n',
      });

      const hashA = await hashSkillsTree(dirA);
      const hashB = await hashSkillsTree(dirB);
      expect(hashA).toBe(hashB);
    } finally {
      await fs.rm(dirA, { recursive: true, force: true });
      await fs.rm(dirB, { recursive: true, force: true });
    }
  });

  it('returns SKILLS_TREE_ABSENT when no skills root can be found', async () => {
    const emptyHome = await fs.mkdtemp(join(tmpdir(), 'bs-skills-hash-emptyhome2-'));
    process.env.HOME = emptyHome;
    try {
      const emptyProject = join(dir, 'no-skills-here');
      await fs.mkdir(emptyProject, { recursive: true });
      const hash = await hashSkillsTree(emptyProject);
      expect(hash).toBe(SKILLS_TREE_ABSENT);
      expect(hash).toBe('not installed');
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });
});
