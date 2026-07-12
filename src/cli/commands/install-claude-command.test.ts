/**
 * Real install-to-temp-dir integration test for `installClaudeCommand()` (DIST-01, DIST-02).
 *
 * This is the phase's verification gate: it runs the REAL installer (file-copy layer only)
 * against a scratch temp directory with `skipLink: true`, then asserts the full installed
 * layout, that every SKILL.md entry-point relative reference resolves to a real file, that
 * no `.test.ts` leaks into the installed tree, that no design-game residue remains, and that
 * `bs-generate-ai` (not `generate-ai`) is present with its 5 AI hooks.
 *
 * `skipLink: true` is MANDATORY here — Plan 02 added it specifically so this test never runs
 * the `npm link --force` step and never leaves a global side-effect. The install only ever
 * targets `local: true` mode (`<tempDir>/.claude/skills`), never the real `~/.claude/skills`.
 *
 * Mirrors `src/cli/lib/project-scaffold.test.ts`'s temp-dir harness: `mkdtempSync` +
 * `try { ... } finally { rmSync(..., { recursive: true, force: true }) }`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { installClaudeCommand } from './install-claude-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Recursively enumerate every file under `dir` (relative to `dir`, POSIX-style). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full).map((p) => join(entry, p)));
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Game-project artifacts that a SKILL.md may cite by literal name (they live inside a
 * *designer's* project directory, not the installed skills tree, so they never resolve
 * relative to `skillsRoot`). Also excludes the literal "..." ellipsis pointer some prose
 * uses to mean "and so on" rather than naming a concrete file.
 */
const GAME_PROJECT_ARTIFACTS = [
  'rulebook/',
  'chunks/',
  'SKETCH.md',
  'CHUNK.md',
  'DESIGN.md',
  'ASSETS.md',
  'INDEX.md',
  'PROJECT.md',
  'STATE.md',
  'HISTORY.md',
];

/**
 * Deliberately-nonexistent references: the citing prose explicitly documents that the file
 * does NOT exist (e.g. build-chunk.md's Light Path section: "no `.../build/light.md` file
 * exists or is needed, because the light path is a routing decision over build.md/test.md/
 * playtest.md, not a fourth ceremony"). These are negative references, not dangling ones.
 */
const KNOWN_NONEXISTENT_REFS = ['bs-shared/build/light.md'];

function isGameProjectArtifact(stripped: string): boolean {
  if (stripped.endsWith('/...') || stripped === '...') return true;
  // Placeholder/glob-form pointers (e.g. `templates/<file>`, `build/*.md`) name a category,
  // not a concrete resolvable sibling file.
  if (stripped.includes('<') || stripped.includes('*')) return true;
  if (KNOWN_NONEXISTENT_REFS.includes(stripped)) return true;
  return GAME_PROJECT_ARTIFACTS.some((artifact) => stripped === artifact || stripped.startsWith(artifact));
}

/**
 * Extract every backtick-quoted markdown reference that is explicitly anchored to the
 * shared-tree root via `${CLAUDE_SKILL_DIR}/../` or a bare leading `../`, and strip the
 * anchor prefix so the remainder is relative to `skillsRoot`.
 *
 * Deliberately does NOT match bare citations like `state-machine.md` or
 * `templates/*.template.md` with no anchor prefix — see the scope note below.
 */
function extractAnchoredRefs(body: string): string[] {
  const refs: string[] = [];
  const re = /`(\$\{CLAUDE_SKILL_DIR\}\/\.\.\/|\.\.\/)([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    refs.push(m[2]);
  }
  return refs;
}

describe('installClaudeCommand — real install to temp dir (DIST-01, DIST-02)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  const SKILL_NAMES = [
    'bs-create-game',
    'bs-ingest-rules',
    'bs-build-chunk',
    'bs-check-status',
    'bs-insert-chunk',
    'bs-generate-ai',
  ];

  beforeAll(async () => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-'));
    process.chdir(tempDir);
    // MANDATORY: skipLink:true — never runs `npm link`, never touches anything outside tempDir.
    await installClaudeCommand({ local: true, force: true, skipLink: true });
    skillsRoot = join(tempDir, '.claude', 'skills');
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('DIST-01', () => {
    it('installs bs- skill family: all 6 bs-<name>/SKILL.md + shared reference tree under bs-shared/', () => {
      for (const name of SKILL_NAMES) {
        expect(existsSync(join(skillsRoot, name, 'SKILL.md'))).toBe(true);
      }
      // The shared reference tree is namespaced under a single bs-shared/ root (WR-01a), never
      // as generic flat siblings (build/, templates/, …) that a reinstall could collide with.
      expect(existsSync(join(skillsRoot, 'bs-shared', 'build'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'ingest'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'templates'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'aspects'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'state-machine.md'))).toBe(true);
      // The un-namespaced flat siblings must NOT exist — they were the collision hazard.
      expect(existsSync(join(skillsRoot, 'build'))).toBe(false);
      expect(existsSync(join(skillsRoot, 'templates'))).toBe(false);
      expect(existsSync(join(skillsRoot, 'state-machine.md'))).toBe(false);
    });

    it('no dangling references: every entry-point SKILL.md relative reference resolves', () => {
      // Scope note: this check covers the 5 SKILL.md ENTRY POINTS only, not the internal
      // cross-refs inside build/*.md or ingest/*.md. Those internal files contain bare
      // citations like `state-machine.md` or `templates/foo.md` that are one level too
      // shallow to resolve as literal paths from their own directory — they are prose
      // citations resolved by the orchestrating entry point's already-established
      // ${CLAUDE_SKILL_DIR} context (an agent reads them WITH the entry point's context),
      // not independently Read-resolved from the cited file's own location. This mirrors
      // the current source tree exactly and is unchanged by this phase, so scanning
      // build/*.md + ingest/*.md would produce false failures.
      let checkedAtLeastOne = false;
      for (const name of SKILL_NAMES) {
        const body = readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf-8');
        for (const ref of extractAnchoredRefs(body)) {
          // Markdown source line-wraps long inline code spans; a real path never contains
          // whitespace, so collapse any wrap-induced newline/space before resolving.
          const stripped = ref.replace(/\s+/g, '');
          if (!stripped || isGameProjectArtifact(stripped)) continue;
          checkedAtLeastOne = true;
          const resolved = join(skillsRoot, stripped);
          expect(
            existsSync(resolved),
            `${name}/SKILL.md references "${ref}" -> expected ${resolved} to exist`
          ).toBe(true);
        }
      }
      expect(checkedAtLeastOne).toBe(true);
    });

    it('aspects/index.md resolves via ingest/interview-fallback.md-style ../aspects/ reference within bs-shared/', () => {
      // Both ingest/ and aspects/ live under bs-shared/, so interview-fallback.md's
      // `../aspects/index.md` (from bs-shared/ingest/) still resolves to bs-shared/aspects/.
      expect(existsSync(join(skillsRoot, 'bs-shared', 'aspects', 'index.md'))).toBe(true);
      const ingestBody = readFileSync(
        join(skillsRoot, 'bs-shared', 'ingest', 'interview-fallback.md'),
        'utf-8'
      );
      expect(ingestBody).toContain('../aspects/index.md');
    });

    it('test files excluded: zero *.test.ts anywhere in the installed tree', () => {
      const files = walk(skillsRoot);
      const testFiles = files.filter((f) => f.endsWith('.test.ts'));
      expect(testFiles).toEqual([]);
    });

    it('no design-game residue: no design-game* file installed and installer source is clean', () => {
      const files = walk(skillsRoot);
      const designGameFiles = files.filter((f) => f.toLowerCase().includes('design-game'));
      expect(designGameFiles).toEqual([]);

      const installerSource = readFileSync(
        join(REPO_ROOT, 'src', 'cli', 'commands', 'install-claude-command.ts'),
        'utf-8'
      );
      expect(installerSource).not.toContain('design-game');
    });

    it('no npm link side-effect: install ran with skipLink:true, touching only the temp dir', () => {
      // The install above completed with skipLink:true (local:true). Confirm the installed
      // tree lives entirely inside tempDir, never the real global ~/.claude/skills location —
      // proving this test's real installer invocation only ever wrote under the temp dir.
      expect(skillsRoot.startsWith(tempDir)).toBe(true);
      const globalSkillsRoot = join(homedir(), '.claude', 'skills');
      expect(skillsRoot).not.toBe(globalSkillsRoot);
    });
  });

  describe('DIST-02', () => {
    it('bs-generate-ai renamed and repositioned: generate-ai/ absent, bs-generate-ai/SKILL.md present with all 5 hooks', () => {
      expect(existsSync(join(skillsRoot, 'generate-ai'))).toBe(false);
      const body = readFileSync(join(skillsRoot, 'bs-generate-ai', 'SKILL.md'), 'utf-8');
      for (const hook of [
        'objectives',
        'threatResponseMoves',
        'playoutPolicy',
        'moveOrdering',
        'uctConstant',
      ]) {
        expect(body).toContain(hook);
      }
      expect(body).toMatch(/late sketch chunk|terminal state|game-end/i);
    });
  });
});

/**
 * Skill-handoff contract: bs- skills must be invocable BOTH by a user typing the slash command
 * AND by the model (an agent handed a build brief must be able to run /bs-ingest-rules itself),
 * so no bs- skill may ship `disable-model-invocation: true` — that flag makes a Skill-tool call
 * fail with "cannot be used with Skill tool due to disable-model-invocation" and has regressed
 * agent-driven builds before. Separately, no bs- SKILL.md may tell the model to invoke another
 * bs- skill *via the Skill tool* — an alias like bs-create-game must hand off by READING the
 * sibling SKILL.md, not re-dispatching it, so kickoff stays a single implementation executing
 * in one context.
 */
describe('installClaudeCommand — bs- skill handoff contract (no Skill-tool self-dispatch)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  const SKILL_NAMES = [
    'bs-create-game',
    'bs-ingest-rules',
    'bs-build-chunk',
    'bs-check-status',
    'bs-insert-chunk',
    'bs-generate-ai',
  ];

  beforeAll(async () => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-handoff-'));
    process.chdir(tempDir);
    await installClaudeCommand({ local: true, force: true, skipLink: true });
    skillsRoot = join(tempDir, '.claude', 'skills');
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('no bs- skill carries disable-model-invocation (agents must be able to self-invoke)', () => {
    for (const name of SKILL_NAMES) {
      const body = readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf-8');
      expect(body, `${name}/SKILL.md must not set disable-model-invocation`).not.toMatch(
        /disable-model-invocation/
      );
    }
  });

  it('no bs- skill instructs a Skill-tool invocation of another bs- skill', () => {
    // Skill-to-skill re-dispatch forks kickoff into a second implementation/context. Guard
    // against the phrasing that invites it: "via the Skill tool" (the bs-create-game bug) or any
    // "invoke ... skill ... Skill tool" instruction naming a bs- skill.
    for (const name of SKILL_NAMES) {
      const body = readFileSync(join(skillsRoot, name, 'SKILL.md'), 'utf-8');
      const bsSkillViaSkillTool =
        /\bbs-[a-z-]+\b[^.\n]*\bSkill tool\b/i.test(body) ||
        /\bSkill tool\b[^.\n]*\bbs-[a-z-]+\b/i.test(body);
      expect(
        bsSkillViaSkillTool,
        `${name}/SKILL.md must not route to a bs- skill via the Skill tool ` +
          `(hand off by reading the sibling SKILL.md — one implementation, one context)`
      ).toBe(false);
    }
  });

  it('bs-create-game hands off by reading bs-ingest-rules SKILL.md', () => {
    const body = readFileSync(join(skillsRoot, 'bs-create-game', 'SKILL.md'), 'utf-8');
    expect(body).toContain('bs-ingest-rules/SKILL.md');
  });
});

/**
 * WR-01: a `--force` reinstall must produce a tree identical to a fresh install — orphaned
 * files left inside installer-owned dirs (from a prior install where an upstream file was
 * renamed/removed) must NOT survive. fs.cp merges, so the installer pre-cleans owned paths.
 */
describe('installClaudeCommand — clean reinstall removes orphans (WR-01)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  const SKILL_NAMES = [
    'bs-create-game',
    'bs-ingest-rules',
    'bs-build-chunk',
    'bs-check-status',
    'bs-insert-chunk',
    'bs-generate-ai',
  ];

  beforeAll(async () => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-orphan-'));
    process.chdir(tempDir);
    await installClaudeCommand({ local: true, force: true, skipLink: true });
    skillsRoot = join(tempDir, '.claude', 'skills');
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('a --force reinstall deletes orphaned files left in installer-owned dirs', async () => {
    // Seed orphans: one inside a shared dir the installer owns, one inside a skill dir.
    const orphanShared = join(skillsRoot, 'bs-shared', 'build', 'orphan-stale.md');
    const orphanSkillFile = join(skillsRoot, 'bs-ingest-rules', 'orphan-extra.md');
    writeFileSync(orphanShared, 'stale content that no longer exists upstream');
    writeFileSync(orphanSkillFile, 'stale content that no longer exists upstream');
    expect(existsSync(orphanShared)).toBe(true);
    expect(existsSync(orphanSkillFile)).toBe(true);

    // Reinstall with --force: the tree must come out identical to a fresh install.
    await installClaudeCommand({ local: true, force: true, skipLink: true });

    // Orphans are gone (pre-clean deleted the owned dirs before re-copying).
    expect(existsSync(orphanShared)).toBe(false);
    expect(existsSync(orphanSkillFile)).toBe(false);

    // The legitimate tree is still fully present.
    for (const name of SKILL_NAMES) {
      expect(existsSync(join(skillsRoot, name, 'SKILL.md'))).toBe(true);
    }
    for (const dir of ['build', 'ingest', 'templates', 'aspects']) {
      expect(existsSync(join(skillsRoot, 'bs-shared', dir))).toBe(true);
    }
    expect(existsSync(join(skillsRoot, 'bs-shared', 'state-machine.md'))).toBe(true);
  });
});

/**
 * WR-01a: the pre-copy clean must ONLY delete installer-owned `bs-`-prefixed roots (the 5 skill
 * dirs + the single bs-shared/ namespace). Before namespacing, the shared tree installed as flat
 * siblings (`build/`, `templates/`, …) and the WR-01 recursive pre-copy `fs.rm` would wipe a
 * user's UNRELATED skill that happened to be named exactly `templates`/`build`/etc. This locks in
 * the collision-safety property: such an unrelated dir SURVIVES a --force reinstall.
 */
describe('installClaudeCommand — reinstall never deletes an unrelated user skill (WR-01a)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  beforeAll(async () => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-collision-'));
    process.chdir(tempDir);
    await installClaudeCommand({ local: true, force: true, skipLink: true });
    skillsRoot = join(tempDir, '.claude', 'skills');
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('an unrelated ~/.claude/skills/templates/ dir is NOT deleted by a --force reinstall', async () => {
    // Seed an unrelated user skill whose name collides with a former flat shared-dir name.
    const unrelatedSkillDir = join(skillsRoot, 'templates');
    const unrelatedSkillFile = join(unrelatedSkillDir, 'SKILL.md');
    mkdirSync(unrelatedSkillDir, { recursive: true });
    writeFileSync(unrelatedSkillFile, 'a user skill that has nothing to do with BoardSmith');

    // Also seed unrelated dirs matching the other former flat names.
    for (const name of ['build', 'ingest', 'aspects']) {
      const dir = join(skillsRoot, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `unrelated ${name} skill`);
    }
    const unrelatedRootFile = join(skillsRoot, 'state-machine.md');
    writeFileSync(unrelatedRootFile, 'an unrelated top-level file');

    // Reinstall with --force: the pre-copy clean runs over every owned path.
    await installClaudeCommand({ local: true, force: true, skipLink: true });

    // The unrelated user content SURVIVES — the installer only owns bs-* roots.
    expect(existsSync(unrelatedSkillFile)).toBe(true);
    expect(readFileSync(unrelatedSkillFile, 'utf-8')).toContain('nothing to do with BoardSmith');
    for (const name of ['build', 'ingest', 'aspects']) {
      expect(existsSync(join(skillsRoot, name, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(unrelatedRootFile)).toBe(true);

    // And BoardSmith's own namespaced tree is still fully installed alongside it.
    expect(existsSync(join(skillsRoot, 'bs-shared', 'templates', 'SKETCH.template.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'bs-shared', 'state-machine.md'))).toBe(true);
  });
});

/**
 * WR-02: the global-link detection fallback must never probe the public registry. A bare
 * `npx boardsmith --version` would DOWNLOAD+run a registry package named "boardsmith" when
 * none is linked locally (supply-chain surface + CI hang). This asserts the installer source
 * uses the network-free `npm ls -g` form and contains no bare `npx boardsmith` invocation.
 */
describe('installClaudeCommand — link detection never fetches from registry (WR-02)', () => {
  it('uses a network-free global-presence probe, not a bare `npx boardsmith` that can fetch', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'cli', 'commands', 'install-claude-command.ts'),
      'utf-8'
    );
    // No `npx` may be EXECUTED: a bare `npx boardsmith` fetches from the registry when
    // nothing is linked locally. (Prose mentions of `npx boardsmith` in comments are fine;
    // this targets the execSync invocation form specifically.)
    expect(source).not.toMatch(/execSync\(\s*['"`]npx/);
    // The fallback probe must be the network-free `npm ls -g` form.
    expect(source).toContain('npm ls -g --depth=0 boardsmith');
  });
});

/**
 * WR-03: a partial/interrupted install (only the first sentinel SKILL.md written) must NOT be
 * misreported as "already installed" on a later non-force run. The completeness check keys on
 * the full expected set, so the run detects the tree is incomplete and finishes it.
 */
describe('installClaudeCommand — partial install is not misreported as complete (WR-03)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  const SKILL_NAMES = [
    'bs-create-game',
    'bs-ingest-rules',
    'bs-build-chunk',
    'bs-check-status',
    'bs-insert-chunk',
    'bs-generate-ai',
  ];

  beforeAll(() => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-partial-'));
    process.chdir(tempDir);
    skillsRoot = join(tempDir, '.claude', 'skills');
    // Simulate an interrupted install: only the first-sentinel SKILL.md exists, nothing else.
    mkdirSync(join(skillsRoot, 'bs-ingest-rules'), { recursive: true });
    writeFileSync(join(skillsRoot, 'bs-ingest-rules', 'SKILL.md'), 'partial interrupted install');
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('a non-force install over a partial tree completes it instead of short-circuiting', async () => {
    // With the old single-sentinel check this would return "already installed" and leave the
    // tree dangling. It must now detect the incomplete tree and finish the full install.
    await installClaudeCommand({ local: true, force: false, skipLink: true });

    for (const name of SKILL_NAMES) {
      expect(existsSync(join(skillsRoot, name, 'SKILL.md'))).toBe(true);
    }
    for (const dir of ['build', 'ingest', 'templates', 'aspects']) {
      expect(existsSync(join(skillsRoot, 'bs-shared', dir))).toBe(true);
    }
    expect(existsSync(join(skillsRoot, 'bs-shared', 'state-machine.md'))).toBe(true);
  });
});

/**
 * WR-03a: an install interrupted mid-shared-tree can leave an EMPTY shared dir (fs.cp creates
 * the destination dir before populating it). The completeness check must probe a known LEAF
 * file inside each shared dir, not bare dir existence — otherwise a later non-force run sees the
 * empty dir, reports "already installed", and leaves the partial tree in place. This seeds a
 * complete-looking-but-empty shared tree and asserts a non-force install finishes it.
 */
describe('installClaudeCommand — empty shared dir is detected as partial, not complete (WR-03a)', () => {
  let tempDir: string;
  let origCwd: string;
  let skillsRoot: string;

  const SKILL_NAMES = [
    'bs-create-game',
    'bs-ingest-rules',
    'bs-build-chunk',
    'bs-check-status',
    'bs-insert-chunk',
    'bs-generate-ai',
  ];

  beforeAll(() => {
    origCwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'bs-install-emptyshared-'));
    process.chdir(tempDir);
    skillsRoot = join(tempDir, '.claude', 'skills');
    // Simulate an interrupt AFTER all 5 SKILL.md were written and the shared dirs were CREATED
    // by fs.cp but BEFORE their leaf files were populated: every dir exists, all are empty.
    for (const name of SKILL_NAMES) {
      mkdirSync(join(skillsRoot, name), { recursive: true });
      writeFileSync(join(skillsRoot, name, 'SKILL.md'), 'placeholder from interrupted install');
    }
    for (const dir of ['build', 'ingest', 'templates', 'aspects']) {
      mkdirSync(join(skillsRoot, 'bs-shared', dir), { recursive: true });
    }
  });

  afterAll(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('a non-force install over empty shared dirs completes them instead of short-circuiting', async () => {
    // Bare dir existence would (wrongly) report "already installed". A leaf-file probe detects
    // the empty shared dirs as partial and finishes the install.
    await installClaudeCommand({ local: true, force: false, skipLink: true });

    expect(existsSync(join(skillsRoot, 'bs-shared', 'state-machine.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'bs-shared', 'templates', 'SKETCH.template.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'bs-shared', 'build', 'build.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'bs-shared', 'ingest', 'transcription.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'bs-shared', 'aspects', 'index.md'))).toBe(true);
  });
});
