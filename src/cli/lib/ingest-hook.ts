import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * The `pre-commit` hook `boardsmith init` installs into every scaffolded game project.
 *
 * WHY A HOOK
 *
 * Thirteen mechanisms were tried to get an ingest session to run the synthesis step that fills
 * `rulebook/INDEX.md`'s gaps section and moves presentation notes off the `Derived (p.N):`
 * prefix. Prose, a template, a pointer, a handshake token, a delegated subagent, re-read gates,
 * a CLI command, that command as an item in a sequence whose other items always run, and finally
 * that command reduced to a single invocation — every one of them was skipped on live runs, often
 * from a file the session had just read.
 *
 * Exactly one thing has ever worked: `boardsmith init` refusing to run without an explicit
 * `--rulebook` / `--without-rulebook` decision. A command that FAILS gets acted on; everything
 * else gets skipped.
 *
 * There is no forced command after transcription to attach the synthesis to — so it attaches to
 * something the session does not choose at all. The bs- build protocol commits at every step, so
 * a `pre-commit` hook runs the synthesis automatically on the first commit after slices exist.
 * The harness runs it, not the model.
 *
 * WHAT THIS HOOK DOES NOT COVER (found by the 2026-07-28 human gate, 170-PROOF-RUN-2.md)
 *
 * "The build protocol commits at every step" is true of `/bs-build-chunk` and false of
 * `/bs-ingest-rules`, which has no commit in it at all. A real ingest run therefore ENDS with
 * this hook never having fired: gaps unswept, nothing relabelled. `/bs-build-chunk` then reads
 * `rulebook/INDEX.md` during investigate, before its own first commit, so the first chunk is
 * planned against the unsynthesized index.
 *
 * Two things close that window, and neither replaces this hook:
 *   - `## Open Rules Gaps` is fenced as machine-owned, so an orchestrator cannot fill it by hand
 *     (which is what happened — 2 entries written against 5 slice markers). Worst case is now a
 *     visibly-empty `_None._`, not a plausible-looking wrong answer.
 *   - `boardsmith ingest-check` repairs and then exits non-zero, and `/bs-build-chunk` Step 0
 *     runs it. The non-zero exit is the point: it forces a re-read of the repaired index.
 *
 * This hook stays as the backstop for every commit after that.
 *
 * DESIGN NOTES
 *
 * - It FIXES and STAGES rather than failing the commit. A hook that blocks commits would fight
 *   the build protocol; one that quietly makes the artifacts correct just removes the failure.
 * - It is a no-op before slices exist (the scaffold commit, any pre-transcription commit) and
 *   idempotent afterwards, so it is safe on every commit rather than only the right one.
 * - Every failure path is non-fatal. A game project must never become uncommittable because a
 *   convenience hook could not resolve the CLI.
 */
export const INGEST_PRE_COMMIT_HOOK = `#!/bin/sh
# BoardSmith ingest synthesis — installed by \`boardsmith init\`.
#
# Fills rulebook/INDEX.md's "## Open Rules Gaps" section from the slice files and relabels
# Derived (p.N): lines that are pure presentation description as Visual (p.N):.
#
# This runs here, rather than as a step in the bs- ingest skill, because thirteen attempts to
# have the ingest session invoke it were all skipped on live runs. A hook is not chosen by the
# model. See src/cli/lib/ingest-hook.ts for the full history.
#
# Safe on every commit: a no-op until rulebook slices exist, idempotent afterwards, and never
# fatal — a project must not become uncommittable because this could not run.

set -u

# Nothing to synthesize until transcription has produced slices and the index scaffold exists.
[ -f rulebook/INDEX.md ] || exit 0
if ! ls rulebook/*.md >/dev/null 2>&1; then exit 0
fi
SLICES=$(ls rulebook/*.md 2>/dev/null | grep -v 'INDEX.md$' | grep -v '00-visual-survey.md$' | head -1)
[ -n "$SLICES" ] || exit 0

if ! npx --no-install boardsmith ingest-gaps >/dev/null 2>&1; then
  echo "boardsmith: ingest synthesis skipped (could not run 'boardsmith ingest-gaps')." >&2
  echo "boardsmith: run it manually before relying on rulebook/INDEX.md." >&2
  exit 0
fi

# Include the corrections in THIS commit rather than leaving them dirty afterwards.
git add rulebook/INDEX.md >/dev/null 2>&1 || true
git add rulebook/*.md >/dev/null 2>&1 || true

exit 0
`;

/**
 * Install the pre-commit hook into a scaffolded project.
 *
 * Never throws: an unwritable hooks directory, a missing `.git`, or a pre-existing hook must not
 * fail `init`. Returns what happened so the caller can report it honestly.
 */
export async function installIngestHook(
  projectPath: string,
): Promise<'installed' | 'skipped-existing' | 'skipped-no-git'> {
  const hooksDir = join(projectPath, '.git', 'hooks');
  const hookPath = join(hooksDir, 'pre-commit');

  try {
    await fs.access(join(projectPath, '.git'));
  } catch {
    return 'skipped-no-git';
  }

  try {
    const existing = await fs.readFile(hookPath, 'utf-8');
    // Never clobber a hook we did not write — a designer's own hook wins.
    if (!existing.includes('BoardSmith ingest synthesis')) return 'skipped-existing';
  } catch {
    // No hook yet — the normal path.
  }

  try {
    await fs.mkdir(hooksDir, { recursive: true });
    await fs.writeFile(hookPath, INGEST_PRE_COMMIT_HOOK, { mode: 0o755 });
    // writeFile's mode is ignored when the file already exists, so set it explicitly.
    await fs.chmod(hookPath, 0o755);
    return 'installed';
  } catch {
    return 'skipped-no-git';
  }
}
