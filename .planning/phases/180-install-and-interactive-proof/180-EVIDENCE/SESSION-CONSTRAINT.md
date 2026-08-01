# SC-3 cannot be met in the session that fixed the install gap

**Recorded 2026-08-01, by the orchestrating session, before any attempt.**

## The constraint

`npx boardsmith claude --force` installed `bs-verify-game` successfully (see
`POST-INSTALL-STATE.txt`). Invoking it in this same session returns:

```
Unknown skill: bs-verify-game
```

A Claude Code session builds its skill registry at startup. This session started BEFORE the
install, so the newly-installed skill is unreachable from it. The installer's own output says so:
*"Restart Claude Code first if it was already running, so it picks up the newly installed skills."*

## What was deliberately NOT done

SC-3 requires `/bs-verify-game` to run as a REAL interactive orchestrator session — the skill
loaded and followed by a Claude Code session. Three shortcuts were available and all three were
rejected:

1. Dispatching a subagent with the skill file's text pasted into its prompt.
2. Driving the documented steps directly from the repo.
3. Proxying the dispatches via `claude -p`, as every prior milestone proof did.

**Each would produce an artifact that looks like an interactive proof and is not one.** That
substitution — running a path that bypasses the real one, then reporting the result as though the
real path were exercised — is the exact defect this phase exists to correct. Seven phases of this
milestone did it without noticing. Doing it knowingly, here, would be strictly worse than leaving
the criterion open.

**SC-3, SC-4, and SC-5 are therefore OPEN, not met, and not worked around.**

## What closing them requires

A fresh Claude Code session (restart, or a new session in this project), then:

1. `/bs-verify-game` against a `cp -R` staged copy of `~/BoardSmithGames/seven` — full-source path,
   through to Close. Confirm Step 7 (CHECK-04) and Step 8 (CHECK-06) dispatch the installed
   contracts, and that Step 9's Close writes `## Verified Against` into the touched chunks.
2. The same, on a copy with BOTH `rulebook/source/` and root `rules.pdf` removed — the source-free
   path (VERIFY-09). Expect entry into `source-free-mode.md`, exit 0, 5 named unchecked defect
   classes, and `Scope: code-conformance-only` / `Reason: source-missing` on disk.
3. Originals verified untouched by whole-tree `git status --short`, before and after.

**SC-5 is the one to read carefully.** Phase 170's foundational finding (`170-PROOF-RUN.md`) is
that the orchestrator does not execute prose skill text literally and skips steps it has just
read — that finding is why this milestone built deterministic CLI harnesses at all. Every
divergence between what the prose says and what the orchestrator actually does is a FINDING.
**A clean run is the surprising outcome, not the expected one.** If the run is clean, that is
itself worth recording as evidence the prose is executable; if it is not, the divergences are the
phase's real deliverable.
