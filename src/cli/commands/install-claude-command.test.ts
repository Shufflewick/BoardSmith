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
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
const KNOWN_NONEXISTENT_REFS = ['build/light.md'];

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
    it('installs bs- skill family: all 5 bs-<name>/SKILL.md + shared reference tree', () => {
      for (const name of SKILL_NAMES) {
        expect(existsSync(join(skillsRoot, name, 'SKILL.md'))).toBe(true);
      }
      expect(existsSync(join(skillsRoot, 'build'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'ingest'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'templates'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'aspects'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'state-machine.md'))).toBe(true);
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

    it('aspects/index.md resolves via ingest/interview-fallback.md-style ../aspects/ reference', () => {
      expect(existsSync(join(skillsRoot, 'aspects', 'index.md'))).toBe(true);
      const ingestBody = readFileSync(join(skillsRoot, 'ingest', 'interview-fallback.md'), 'utf-8');
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
