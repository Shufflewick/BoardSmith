---
phase: 173-verify-pipeline-core
plan: 05
subsystem: cli-installer
tags: [skill-installer, agent-skills, structural-guard, drift-elimination]

requires:
  - phase: 173-verify-pipeline-core (plan 04)
    provides: "src/cli/slash-command/bs/verify-game.md and bs/verify/{source-resolution,staging-dispatch}.md — the skill text this plan registers with the installer"
provides:
  - "bs-verify-game registered as a seventh installable skill: SKILL_ENTRY_POINTS, SHARED_DIRS ('verify'), a SHARED_LEAF_PROBES entry so a partial verify/ install is never misreported as complete, and a post-install summary line"
  - "A single exported source of truth (SKILL_NAMES, derived from SKILL_ENTRY_POINTS) for the installed skill-name set, ending the five-site SKILL_NAMES duplication in install-claude-command.test.ts"
  - "A self-reading meta-test that scans install-claude-command.test.ts's own source for any reintroduced hardcoded SKILL_NAMES literal and fails naming the offending describe block"
  - "Real-install proof of bs-verify-game and bs-shared/verify/ (both install and uninstall paths), independent of the vitest harness"
affects: [173-06, 173-07]

tech-stack:
  added: []
  patterns:
    - "Installer-owned arrays get a single exported source of truth (SKILL_NAMES) rather than each consumer hand-copying the list; a self-reading meta-test with an unbounded regex (not a hardcoded site count) guards against any future re-duplication, catching a newly added Nth hardcoded site automatically"

key-files:
  created: []
  modified:
    - src/cli/commands/install-claude-command.ts
    - src/cli/commands/install-claude-command.test.ts

key-decisions:
  - "Chose the 'preferred' option from the plan's task 3: replaced all five hardcoded SKILL_NAMES literals with an import of the newly exported SKILL_NAMES constant, rather than leaving five literals behind a meta-test. This closes the hazard structurally — there is no longer a second copy to drift — and the meta-test becomes a regression guard against a literal being reintroduced, not the primary defense."
  - "The meta-test's extraction regex requires bracket contents to be ONLY quoted strings/commas/whitespace (`/const SKILL_NAMES\\s*=\\s*\\[\\s*((?:'[^']+'\\s*,?\\s*)+)\\]\\s*;/g`), not a bare `[\\s\\S]*?` capture — the first version false-matched the meta-test's own doc-comment prose and its own regex-literal source line (both contain the substring \"const SKILL_NAMES = [ ... ]\"), which is a real, worth-recording gotcha for any future self-reading guard."
  - "SHARED_LEAF_PROBES uses source-resolution.md (not staging-dispatch.md) as the verify/ leaf probe, per the plan's fallback instruction — 173-04-SUMMARY.md did not override this."

requirements-completed: []  # VERIFY-01 is NOT marked complete — it needs plan 173-06's live install-and-run proof against a real game project. This plan only closes the mechanical registration half. Per this phase's stated discipline (two prior premature-completion marks already reverted this phase), the building block is not the requirement.

duration: ~45min
completed: 2026-07-28
---

# Phase 173 Plan 05: Installer registration + the five-site SKILL_NAMES fix Summary

**Registered `bs-verify-game` and its `bs/verify/` shared dir at all four installer points, proved the real install/uninstall paths outside the test harness, and closed the five-site `SKILL_NAMES` duplication at the root by exporting a single source of truth and replacing every hardcoded copy with an import of it.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3/3 completed
- **Files modified:** 2 (`install-claude-command.ts`, `install-claude-command.test.ts`)

## Accomplishments

- **Task 1 — four-point installer registration.** `SKILL_ENTRY_POINTS` gained `{ source: join('bs', 'verify-game.md'), skillName: 'bs-verify-game' }`; `SHARED_DIRS` gained `'verify'` (this is what actually makes `bs/verify/*.md` land under the installed shared tree — neither array is directory-scanned); `SHARED_LEAF_PROBES` gained `join(SHARED_ROOT, 'verify', 'source-resolution.md')` so `isFullyInstalled()` can distinguish a complete `verify/` copy from an empty dir `fs.cp` creates before populating it; the post-install summary and the top-of-file doc comment both now name all seven skills. `ownedPaths()` and the uninstaller derive from `SKILL_ENTRY_POINTS` automatically, so `bs-verify-game`'s pre-clean and uninstall paths required no separate edit.
- **Task 2 — all five `SKILL_NAMES` test sites updated, plus new verify-specific assertions.** Re-grepped rather than trusting the plan's line numbers; confirmed exactly five sites (100, 242, 306, 444, 495) before touching any. Added: a DIST-01 assertion that the installed `bs-shared/verify/` tree contains every `.md` file present in `src/cli/slash-command/bs/verify/` (compared by listing, not hardcoded filenames); a `verify`-only WR-03a case (empties only the `verify/` shared dir from an otherwise-complete tree, confirms a non-force install repairs just that dir); and a new uninstall test proving `bs-verify-game/` and `bs-shared/verify/` are both removed with zero `bs-*` orphans left under the skills root. The handoff-contract block's existing `disable-model-invocation` / no-Skill-tool-self-dispatch assertions extended to `bs-verify-game` automatically because they iterate `SKILL_NAMES`, which now includes it.
- **Task 3 — five-site drift closed structurally, not just guarded.** Exported `SKILL_NAMES` from `install-claude-command.ts` (`SKILL_ENTRY_POINTS.map(e => e.skillName)`) and replaced all five hardcoded test-file literals with an import of it — chosen over "keep five literals behind a guard" because it eliminates the second copy entirely rather than policing it. Added one meta-test that reads its own source file, extracts any `const SKILL_NAMES = [ ... ]` literal that might be reintroduced (regex is unbounded, so a future sixth hardcoded site is picked up automatically, not silently exempt), and asserts each one, sorted, matches the exported list, sorted — with a failure message naming the offending `describe` block and file offset.

## Sanity-Check Evidence (meta-test actually bites)

Per the phase's stated discipline (the wave-3 no-fork-guard precedent), the meta-test was verified to actually catch drift, not just pass because it's broken:

1. Planted a probe: reintroduced a hardcoded `const SKILL_NAMES = [...]` literal in the WR-01 (`clean reinstall removes orphans`) `describe` block, deliberately missing `'bs-verify-game'`.
2. Ran `npx vitest run src/cli/commands/install-claude-command.test.ts -t "SKILL_NAMES has one source of truth"`. It failed with:
   > `A hardcoded "const SKILL_NAMES = [...]" literal has reappeared in describe block "installClaudeCommand — clean reinstall removes orphans (WR-01)" (file offset 14076) and has drifted from install-claude-command.ts's exported SKILL_NAMES. Expected: [...bs-verify-game]. Found: [...without bs-verify-game]. Fix: delete the local literal and use the imported SKILL_NAMES instead...`
3. Removed the probe and confirmed the file was byte-identical to its pre-probe state (`diff` against a backup copy in the scratchpad, zero output).
4. Re-ran the full test file: 19/19 green again.

This also surfaced a real gotcha in the meta-test's own first draft: an unbounded `[\s\S]*?` extraction regex false-matched the meta-test's own doc-comment prose and its own regex-literal source line (both legitimately contain the substring `const SKILL_NAMES = [ ... ]` as text, not as a real declaration). Fixed by narrowing the regex to require bracket contents be exclusively quoted strings/commas/whitespace — confirmed via the 19/19 pass after the fix.

## Real Install/Uninstall Proof (outside the vitest harness)

Beyond the test suite, ran a standalone `tsx` script (not vitest) that imports `installClaudeCommand`/`uninstallClaudeCommand` directly and exercises a real install into a scratch temp dir with `skipLink: true`:

```
bs-verify-game/SKILL.md exists: true
bs-shared/verify/ contents: [ 'source-resolution.md', 'staging-dispatch.md' ]
bs-shared/verify/source-resolution.md exists: true
bs-shared/verify/staging-dispatch.md exists: true
...
after uninstall, bs-verify-game exists: false
after uninstall, bs-shared exists: false
```

The temp dir was removed afterward; nothing under `~/BoardSmithGames/` or the real `~/.claude/skills` was touched (read-only invariant honored).

## Exact install command for plan 173-06's live proof

Plan 173-06 needs the **CLI-level** install (this plan's proof used the function directly, not the built CLI binary), against a real project copy:

```bash
# From the BoardSmith repo root, with the CLI built/linked as usual:
npx boardsmith claude --local
# or, from inside a designer's project directory, to install into that project only:
cd <project-dir> && npx boardsmith claude --local
```

Global install (`npx boardsmith claude`, no `--local`) targets `~/.claude/skills` — 173-06 should prefer `--local` into a disposable copy per the read-only invariant already established this phase, mirroring how this plan's `--local` proof worked. After install, `/bs-verify-game` should be invocable from a Claude Code conversation rooted in that project. `npx boardsmith claude uninstall --local` reverses it cleanly (verified by this plan's Task 2 test and the standalone real-install proof above).

## Deviations from Plan

### Auto-fixed Issues

None beyond what the plan's own tasks specified.

### Structural deviations (documented, not silently absorbed)

**1. Chose the "preferred" Task 3 option (import over five-literal-plus-guard).**
- **Reason:** the plan offered two paths — keep five literals behind a meta-test, or replace them with imports of the exported constant and keep the meta-test as a regression guard — explicitly preferring the second "if it does not balloon the diff." It did not; the diff was a net simplification (five 8-line blocks removed, one import added, one new describe block added). Chose it because it satisfies Pit of Success more directly: there is no longer a second array a future site COULD hand-copy incorrectly, only one it can accidentally reintroduce, which the guard catches.
- **Files:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`

No other deviations. Every interface point named in the plan's `<interfaces>` block (exact `SKILL_ENTRY_POINTS`/`SHARED_DIRS`/`SHARED_LEAF_PROBES`/summary-block edit sites) was used exactly as specified; no directory scanning was introduced in place of the explicit lists, per the plan's explicit instruction not to.

## Verification

- `npx vitest run src/cli/commands/install-claude-command.test.ts` — 19/19 green (15 baseline for this file + 4 new: verify file-parity, verify-only WR-03a repair, uninstall-no-orphan, and the structural meta-test).
- `npm test` — 3596/3596 green (baseline 3592 + 4 new, zero regressions).
- `npx eslint src/cli/` — zero errors.
- Real (non-vitest) install/uninstall proof via standalone `tsx` script — see above.
- Manual `diff` confirmed the meta-test sanity-check probe left the file byte-identical after removal.

## Known Stubs

None. Every artifact this plan touches is either registration wiring or test assertions against real installed output — no runtime code paths were stubbed.

## Threat Flags

None beyond what the plan's own `<threat_model>` already registered (T-173-41 through T-173-43, all `mitigate`, all closed: the explicit-array discipline is preserved with no new scanning surface, the `SHARED_LEAF_PROBES` entry closes the silent-partial-install repudiation risk for `verify/` specifically, and the five-site tampering risk is closed structurally via the single exported source of truth plus the self-reading meta-test). No new network endpoints, auth paths, or schema changes were introduced.

## Self-Check: PASSED

- `[ -f src/cli/commands/install-claude-command.ts ]` — FOUND
- `[ -f src/cli/commands/install-claude-command.test.ts ]` — FOUND
- Commit `b18a933b` (Task 1) — FOUND in `git log`.
- Commit `287e0977` (Task 2) — FOUND in `git log`.
- Commit `bb41fdba` (Task 3) — FOUND in `git log`.
- Re-ran plan-level verification: `npx vitest run src/cli/commands/install-claude-command.test.ts` (19/19), `npm test` (3596/3596), `npx eslint src/cli/` (0 errors) — all green.

---
*Phase: 173-verify-pipeline-core*
*Plan: 05*
*Completed: 2026-07-28*
