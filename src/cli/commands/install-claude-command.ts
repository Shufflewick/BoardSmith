/**
 * Install BoardSmith Agent Skills for Claude Code
 *
 * This installs the bs- skill family (bs-create-game, bs-ingest-rules, bs-build-game,
 * bs-build-chunk, bs-check-status, bs-insert-chunk, bs-build-bot, bs-verify-game) globally so
 * users can design and build BoardSmith games directly within Claude Code conversations.
 *
 * It also installs one Claude Code agent per role the skills dispatch work to (#454):
 * bs-mechanical, bs-bounded, bs-judgement, bs-review and bs-second-opinion, into the `agents/` directory beside
 * `skills/`. Their default model and effort live in each agent file's frontmatter
 * (`src/cli/slash-command/agents/`); a project maps a role to another agent in boardsmith.json.
 */

import { promises as fs, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { styleText } from 'node:util';
import { ROLES, defaultAgentType } from '../lib/agent-roles.js';
import { boardsmithPackageRoot } from '../lib/boardsmith-version.js';
import { filesContentHash } from '../lib/hash.js';

interface InstallOptions {
  force?: boolean;
  local?: boolean; // Install to ./.claude/skills instead of global
  /**
   * Skip the global `npm link` step — used by tests to avoid a global side-effect.
   * Default unset/false, so real installs still link.
   */
  skipLink?: boolean;
}

/** The bs- skill entry points, mapped from their source file to their installed skill name. */
const SKILL_ENTRY_POINTS: Array<{ source: string; skillName: string }> = [
  { source: join('bs', 'create-game.md'), skillName: 'bs-create-game' },
  { source: join('bs', 'ingest-rules.md'), skillName: 'bs-ingest-rules' },
  { source: join('bs', 'build-game.md'), skillName: 'bs-build-game' },
  { source: join('bs', 'build-chunk.md'), skillName: 'bs-build-chunk' },
  { source: join('bs', 'check-status.md'), skillName: 'bs-check-status' },
  { source: join('bs', 'insert-chunk.md'), skillName: 'bs-insert-chunk' },
  { source: join('bs', 'build-bot.md'), skillName: 'bs-build-bot' },
  { source: join('bs', 'verify-game.md'), skillName: 'bs-verify-game' },
];

/**
 * Skill directories this installer USED to own and no longer ships. They are deleted on every
 * install and uninstall, exactly like an owned path.
 *
 * Without this, a machine that installed an earlier version keeps the retired directory forever:
 * `fs.cp` only merges, and the pre-copy clean only removes paths in `SKILL_ENTRY_POINTS`. The
 * designer would then see BOTH `/bs-generate-bot` and `/bs-build-bot` offered — one of them a stale
 * copy whose prose predates the rename — and picking the wrong one is the easy path, not the hard
 * one. Every entry here must be `bs-`-prefixed, for the same collision-safety reason `ownedPaths`
 * is (never a generic top-level name a user's unrelated skill could share).
 */
const RETIRED_SKILL_NAMES = ['bs-generate-bot'];

/**
 * The single source of truth for "what skills does this installer ship" — derived from
 * `SKILL_ENTRY_POINTS`, never hand-duplicated. Exported so `install-claude-command.test.ts`
 * has exactly one place to import the installed skill-name set from; a self-reading meta-test
 * in that file guards against any future hardcoded literal drifting from this list.
 */
export const SKILL_NAMES: string[] = SKILL_ENTRY_POINTS.map(({ skillName }) => skillName);

/**
 * Single namespaced root the installer owns for the shared reference tree. Everything the
 * skills read in common (build/, ingest/, orchestrate/, templates/, aspects/, state-machine.md,
 * reporting.md) lives UNDER this one `bs-`-prefixed dir —
 * `~/.claude/skills/bs-shared/{build,ingest,orchestrate,templates,aspects,state-machine.md,
 * reporting.md}` — so the installer never owns a generic top-level name.
 * This makes the pre-copy clean and the uninstaller collision-proof: a user's unrelated skill
 * named exactly `templates`/`build`/`ingest`/`aspects` at the skills root is never touched.
 */
const SHARED_ROOT = 'bs-shared';

/** Shared reference directories copied under the `bs-shared/` namespace root. */
const SHARED_DIRS = ['build', 'ingest', 'orchestrate', 'templates', 'aspects', 'verify'];

/**
 * Shared single files copied to the ROOT of the `bs-shared/` namespace (not inside any
 * SHARED_DIRS subdirectory). These are the cross-skill authorities every entry point cites:
 * `state-machine.md` (what the pipeline does), `reporting.md` (how it talks to the designer) and
 * `routing.md` (which role each piece of work is dispatched to, and when review may start).
 */
const SHARED_FILES = ['state-machine.md', 'reporting.md', 'routing.md'];

/**
 * The content hash of the skill sources this install was copied from, written last so a partial
 * copy carries none. Not the package version: a checkout keeps one version across every pull.
 */
const SOURCE_STAMP = join(SHARED_ROOT, 'SOURCE-HASH');

/**
 * A known leaf file inside each shared dir (relative to `targetDir`). A COMPLETE install
 * contains every one of these; probing them — rather than bare-directory existence — is what
 * distinguishes a finished install from an interrupted mid-copy that left an empty/partial
 * shared dir behind (`fs.cp` creates the destination dir before populating it).
 */
const SHARED_LEAF_PROBES = [
  ...SHARED_FILES.map((file) => join(SHARED_ROOT, file)),
  join(SHARED_ROOT, 'build', 'spec.md'),
  join(SHARED_ROOT, 'build', 'build.md'),
  join(SHARED_ROOT, 'ingest', 'transcription.md'),
  join(SHARED_ROOT, 'templates', 'SKETCH.template.md'),
  join(SHARED_ROOT, 'templates', 'RUN.template.md'),
  join(SHARED_ROOT, 'templates', 'QUESTIONS.template.md'),
  join(SHARED_ROOT, 'templates', 'FILINGS.template.md'),
  join(SHARED_ROOT, 'orchestrate', 'chunk-dispatch.md'),
  join(SHARED_ROOT, 'orchestrate', 'run-state.md'),
  join(SHARED_ROOT, 'orchestrate', 'questions.md'),
  join(SHARED_ROOT, 'orchestrate', 'filings.md'),
  join(SHARED_ROOT, 'aspects', 'index.md'),
  join(SHARED_ROOT, 'verify', 'source-resolution.md'),
  join(SHARED_ROOT, 'verify', 'source-free-mode.md'),
  join(SHARED_ROOT, 'verify', 'classification-subagent.md'),
  join(SHARED_ROOT, 'verify', 'adjudication-gate.md'),
  join(SHARED_ROOT, 'verify', 'ruling-recheck.md'),
  join(SHARED_ROOT, 'verify', 'repair-dispatch.md'),
  join(SHARED_ROOT, 'verify', 'enumerate-facts.md'),
  join(SHARED_ROOT, 'verify', 'reconcile-facts.md'),
  join(SHARED_ROOT, 'verify', 'extract-example.md'),
  join(SHARED_ROOT, 'verify', 'translate-example.md'),
];

/**
 * The role agents, one per role, each installed as `<claude dir>/agents/<name>.md` from
 * `src/cli/slash-command/agents/<name>.md`. Every name is `bs-`-prefixed, so installing and
 * uninstalling them can never touch an agent of the user's own.
 */
const AGENT_FILES = ROLES.map((role) => `${defaultAgentType(role)}.md`);

/** The `agents/` directory beside a `skills/` directory: both live in the same `.claude/`. */
function agentsDirFor(skillsDir: string): string {
  return join(dirname(skillsDir), 'agents');
}

/** Filter applied to every recursive tree copy: never ship test files. */
function excludeTestFiles(src: string): boolean {
  return !src.endsWith('.test.ts');
}

/**
 * Every filesystem path this installer owns under `targetDir`: the `SKILL_ENTRY_POINTS.length`
 * `bs-<name>/` skill dirs plus the single `bs-shared/` namespace root. Every entry is
 * `bs-`-prefixed, so the pre-copy clean and the uninstaller can never recursively delete an
 * unrelated user skill.
 */
function ownedPaths(targetDir: string): string[] {
  return [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => join(targetDir, skillName)),
    ...RETIRED_SKILL_NAMES.map((skillName) => join(targetDir, skillName)),
    join(targetDir, SHARED_ROOT),
    ...AGENT_FILES.map((file) => join(agentsDirFor(targetDir), file)),
  ];
}

/**
 * The full set of paths a complete install must contain. Used to distinguish a complete
 * install (short-circuit as "already installed") from a partial/interrupted one (proceed).
 * The shared tree is probed by known LEAF files, not bare dir existence, so a half-copied
 * shared dir is correctly detected as partial.
 */
function expectedInstallPaths(targetDir: string): string[] {
  return [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => join(targetDir, skillName, 'SKILL.md')),
    ...SHARED_LEAF_PROBES.map((leaf) => join(targetDir, leaf)),
    ...AGENT_FILES.map((file) => join(agentsDirFor(targetDir), file)),
  ];
}

/**
 * True only when EVERY expected install path is present, the stamp matches `sourceHash`, AND no retired skill directory survives (a complete, current, non-partial install). A tree that still carries a retired directory is
 * NOT complete: it must fall through to the pre-copy clean that removes it, or a designer who
 * installed an earlier version would keep the stale skill until they thought to pass `--force`.
 */
async function isFullyInstalled(targetDir: string, sourceHash: string): Promise<boolean> {
  for (const path of expectedInstallPaths(targetDir)) {
    try {
      await fs.access(path);
    } catch {
      return false; // Missing piece → partial/absent install
    }
  }
  try {
    const stamped = await fs.readFile(join(targetDir, SOURCE_STAMP), 'utf-8');
    if (stamped.trim() !== sourceHash) return false; // Copied from other skill sources
  } catch {
    return false; // No stamp → an unstamped or partial install
  }
  for (const skillName of RETIRED_SKILL_NAMES) {
    try {
      await fs.access(join(targetDir, skillName));
      return false; // A retired skill is still on disk → not a current install
    } catch {
      // Absent, as it should be.
    }
  }
  return true;
}

/** Where shared dir `dirName` is copied from: `aspects/` sits beside `bs/`, the rest inside it. */
function sharedDirSource(slashCommandDir: string, dirName: string): string {
  return dirName === 'aspects' ? join(slashCommandDir, 'aspects') : join(slashCommandDir, 'bs', dirName);
}

/** Every file and directory under `slashCommandDir` the copy reads. */
function skillSources(slashCommandDir: string): string[] {
  const bsDir = join(slashCommandDir, 'bs');
  return [
    ...SKILL_ENTRY_POINTS.map(({ source }) => join(slashCommandDir, source)),
    ...SHARED_DIRS.map((dirName) => sharedDirSource(slashCommandDir, dirName)),
    ...SHARED_FILES.map((file) => join(bsDir, file)),
    ...AGENT_FILES.map((file) => join(slashCommandDir, 'agents', file)),
  ];
}

/** Every file the copy reads, relative to `slashCommandDir`. */
function skillSourceFiles(slashCommandDir: string): string[] {
  return skillSources(slashCommandDir).flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path, { recursive: true, encoding: 'utf-8' })
          .map((entry) => join(path, entry))
          .filter((file) => statSync(file).isFile() && excludeTestFiles(file))
      : [path],
  ).map((file) => relative(slashCommandDir, file));
}

/** Throws, naming the first missing one, unless every skill source exists. */
async function assertSkillSourcesExist(slashCommandDir: string): Promise<void> {
  for (const path of skillSources(slashCommandDir)) {
    try {
      await fs.access(path);
    } catch {
      throw new Error(
        `The BoardSmith package is missing its skill sources (${path} not found), so nothing was installed or removed. ` +
          'Reinstall boardsmith, then run this command again.'
      );
    }
  }
}

/**
 * Copy the Agent Skills tree (`SKILL_ENTRY_POINTS.length` SKILL.md entry points + shared
 * reference tree) into targetDir.
 *
 * Returns true if anything was installed, false if it already existed and force was not set.
 */
async function copySkillTree(
  boardsmithRoot: string,
  targetDir: string,
  force: boolean
): Promise<boolean> {
  const slashCommandDir = join(boardsmithRoot, 'src', 'cli', 'slash-command');
  const bsDir = join(slashCommandDir, 'bs');

  // "Already installed" must mean the FULL expected set is present, not a single sentinel.
  // A partial/interrupted install (e.g. first SKILL.md written but shared tree never copied)
  // must NOT short-circuit as complete — it falls through to a clean re-copy that finishes it.
  // The pre-clean below deletes the current install, so first prove there is something to replace it with.
  await assertSkillSourcesExist(slashCommandDir);
  const sourceHash = filesContentHash(slashCommandDir, skillSourceFiles(slashCommandDir));
  if (!force && (await isFullyInstalled(targetDir, sourceHash))) {
    return false; // Fully installed, not overwriting
  }

  // Pre-clean every installer-owned path before copying so the result is authoritative:
  // fs.cp merges into an existing tree and never deletes orphans (renamed/removed upstream
  // files), so a --force reinstall (or completing a partial install) must delete first to
  // produce a tree identical to a fresh install. Only paths this installer owns are removed —
  // never the user's wider ~/.claude/skills tree. fs.rm with force:true is a no-op if absent.
  for (const path of ownedPaths(targetDir)) {
    await fs.rm(path, { recursive: true, force: true });
  }

  // Entry points: read each source .md verbatim, write to <targetDir>/<skillName>/SKILL.md
  for (const { source, skillName } of SKILL_ENTRY_POINTS) {
    const sourcePath = join(slashCommandDir, source);
    const skillDir = join(targetDir, skillName);
    await fs.mkdir(skillDir, { recursive: true });
    const content = await fs.readFile(sourcePath, 'utf-8');
    await fs.writeFile(join(skillDir, 'SKILL.md'), content);
  }

  // Shared reference dirs: copy recursively, excluding *.test.ts, UNDER the bs-shared/ root.
  for (const dirName of SHARED_DIRS) {
    const destDir = join(targetDir, SHARED_ROOT, dirName);
    await fs.cp(sharedDirSource(slashCommandDir, dirName), destDir, { recursive: true, filter: excludeTestFiles });
  }

  // Shared root-level authorities: single file copies into bs-shared/.
  await fs.mkdir(join(targetDir, SHARED_ROOT), { recursive: true });
  for (const file of SHARED_FILES) {
    await fs.copyFile(join(bsDir, file), join(targetDir, SHARED_ROOT, file));
  }

  // Role agents: one file each, into the agents/ directory beside skills/.
  const agentsDir = agentsDirFor(targetDir);
  await fs.mkdir(agentsDir, { recursive: true });
  for (const file of AGENT_FILES) {
    await fs.copyFile(join(slashCommandDir, 'agents', file), join(agentsDir, file));
  }

  await fs.writeFile(join(targetDir, SOURCE_STAMP), `${sourceHash}\n`);
  return true;
}

export async function installClaudeCommand(options: InstallOptions = {}): Promise<void> {
  const boardsmithRoot = boardsmithPackageRoot();

  // Determine target directory
  const targetDir = options.local
    ? join(process.cwd(), '.claude', 'skills')
    : join(homedir(), '.claude', 'skills');

  // Create skills directory if it doesn't exist
  await fs.mkdir(targetDir, { recursive: true });

  const force = options.force ?? false;

  const installed = await copySkillTree(boardsmithRoot, targetDir, force);

  if (!installed) {
    console.log(styleText('yellow', 'BoardSmith skills already installed at:'));
    console.log(styleText('gray', `  ${targetDir}`));
    console.log('');
    console.log('Use --force to overwrite.');
    return;
  }

  // Link BoardSmith globally so `npx boardsmith` works anywhere
  if (!options.skipLink) {
    console.log(styleText('gray', 'Linking BoardSmith globally...'));
    try {
      execSync('npm link --force', { cwd: boardsmithRoot, stdio: 'pipe' });
      console.log(styleText('green', '✓ BoardSmith linked globally'));
    } catch (err) {
      // Check if it's ALREADY linked globally without touching the network. A bare
      // `npx boardsmith --version` would DOWNLOAD and execute a registry package named
      // "boardsmith" when none is linked locally — an unrequested network side-effect,
      // a supply-chain surface if a squatter owns that name, and a hang/prompt in CI.
      // `npm ls -g` only inspects already-installed global packages and never fetches.
      try {
        execSync('npm ls -g --depth=0 boardsmith', { stdio: 'pipe' });
        console.log(styleText('green', '✓ BoardSmith already linked globally'));
      } catch {
        // `npm ls -g` also exits non-zero for UNRELATED global-tree problems (extraneous or
        // invalid deps elsewhere), so a failure here does not prove boardsmith is unlinked —
        // it only means we could not confirm the link. Soften the wording accordingly.
        console.error(styleText('yellow', 'Warning: Could not confirm BoardSmith is linked globally.'));
        console.error(styleText('gray', 'If `npx boardsmith` is not found, run with sudo or fix npm permissions.'));
        console.error(styleText('gray', `Manual fix: cd ${boardsmithRoot} && npm link`));
      }
    }
  }

  console.log(styleText('green', '✓ Installed BoardSmith skills for Claude Code'));
  console.log('');
  console.log(styleText('gray', `  Location: ${targetDir}`));
  console.log(styleText('gray', `  BoardSmith: ${boardsmithRoot}`));
  console.log('');
  console.log('Skills:');
  console.log(styleText('cyan', '  bs-create-game') + styleText('gray', '   - Start a new game — from an idea or a rulebook (start here)'));
  console.log(styleText('cyan', '  bs-ingest-rules') + styleText('gray', '  - Ingest a rulebook and produce the initial sketch/chunk plan'));
  console.log(styleText('cyan', '  bs-build-game') + styleText('gray', '    - Build the whole game: chunk by chunk (independent ones side by side), resumable, questions filed'));
  console.log(styleText('cyan', '  bs-build-chunk') + styleText('gray', '   - Build, test, audit, and playtest one chunk at a time'));
  console.log(styleText('cyan', '  bs-check-status') + styleText('gray', '  - Report sketch/chunk progress and next steps'));
  console.log(styleText('cyan', '  bs-insert-chunk') + styleText('gray', '  - Insert a new chunk into an existing sketch'));
  console.log(styleText('cyan', '  bs-build-bot') + styleText('gray', '      - Generate a computer opponent for the finished game'));
  console.log(styleText('cyan', '  bs-verify-game') + styleText('gray', '   - Re-verify an existing game against its archived rulebook source'));
  console.log('');
  console.log(styleText('gray', 'Each skill reads from a shared reference tree (build/, ingest/,'));
  console.log(
    styleText('gray',
      'orchestrate/, templates/, aspects/, state-machine.md, reporting.md, routing.md) installed under bs-shared/.'
    )
  );
  console.log('');
  console.log('Role agents (the skills dispatch work by role, never by model):');
  console.log(styleText('cyan', '  bs-mechanical') + styleText('gray', '    - Bulk edits, searches and summaries'));
  console.log(styleText('cyan', '  bs-bounded') + styleText('gray', '       - Implementation where failing tests say what done is'));
  console.log(styleText('cyan', '  bs-judgement') + styleText('gray', '     - Spec, investigate, red team, fidelity, anything touching a ruling'));
  console.log(styleText('cyan', '  bs-review') + styleText('gray', '        - Review, once `boardsmith verify` has passed'));
  console.log(styleText('cyan', '  bs-second-opinion') + styleText('gray', ' - An independent second reading, on a different model from bs-judgement'));
  console.log(styleText('gray', `  Location: ${agentsDirFor(targetDir)}`));
  console.log(styleText('gray', '  To use other agents, map roles in boardsmith.json, e.g. "agents": { "judgement": "senior" }.'));
  console.log(styleText('gray', 'Projects built with an older BoardSmith skill are auto-detected'));
  console.log(styleText('gray', 'and offered a one-time conversion by bs-ingest-rules.'));
  console.log('');
  console.log(styleText('bold', 'Next step: ') + 'open Claude Code and type ' + styleText(['bold', 'cyan'], '/bs-create-game'));
  console.log(styleText('gray', 'to start designing your first game. (Restart Claude Code first if it'));
  console.log(styleText('gray', "was already running, so it picks up the newly installed skills.)"));
  console.log('');

  if (options.local) {
    console.log(styleText('yellow', 'Note: Installed locally to this project.'));
    console.log('Run without --local to install globally.');
  }
}

export async function uninstallClaudeCommand(options: { local?: boolean } = {}): Promise<void> {
  const targetDir = options.local
    ? join(process.cwd(), '.claude', 'skills')
    : join(homedir(), '.claude', 'skills');

  let removedAny = false;

  // Only ever remove installer-owned `bs-`-prefixed paths (`ownedPaths`: the skill dirs, the single
  // bs-shared/ namespace and the role agents). Never a generic top-level name like
  // `templates`/`build`, so uninstall cannot wipe an unrelated user skill or agent that shares it.
  for (const itemPath of ownedPaths(targetDir)) {
    try {
      await fs.access(itemPath);
    } catch {
      continue; // Doesn't exist, skip
    }
    await fs.rm(itemPath, { recursive: true, force: true });
    console.log(styleText('gray', `  Removed: ${itemPath}`));
    removedAny = true;
  }

  if (removedAny) {
    console.log(styleText('green', '✓ Uninstalled BoardSmith skills'));
  } else {
    console.log(styleText('yellow', 'No BoardSmith skills found.'));
  }
}
