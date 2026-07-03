---
phase: 135-cli-dev-experience
plan: 01
subsystem: process/verification
tags: [proc-01, verify-first, cli, dev-experience]
dependency-graph:
  requires: []
  provides:
    - "135-FINDINGS-VERIFICATION.md: LEGITIMATE verdicts for F9/F21/F22/F32/F33/F34 gating Plans 02-06"
  affects:
    - .planning/phases/135-cli-dev-experience/135-02..06-PLAN.md (all fix plans blocked until this artifact exists)
tech-stack:
  added: []
  patterns:
    - "PROC-01 verify-first gate: independent HEAD file:line re-trace of every audit finding before any fix task runs"
key-files:
  created:
    - .planning/phases/135-cli-dev-experience/135-FINDINGS-VERIFICATION.md
  modified: []
decisions:
  - "F21/CLIX-03: the CODE (200MB constant, validate.ts:226) is wrong, not the comment (50MB) — independently re-confirmed against ~/ShufflewickPubGames/src/upload.ts:4 (MAX_BUNDLE_SIZE = 50MB); fix changes the constant to 50MB"
  - "F32/CLIX-04: corrected a 135-RESEARCH.md misreading — CONTEXT.md's locked decision is default 127.0.0.1 (not '0.0.0.0 stays default' as RESEARCH's State-of-the-Art table stated); dev.ts:283 currently defaults to 0.0.0.0, so the fix is a real default-value change, not a docs-only correction"
  - "F9/CLIX-01: build.ts's { ...config } manifest spread (build.ts:108-116) is a second silent-forwarding site for playerCount not named in the original audit text — folded into the same Plan 02 derive-not-duplicate fix, not treated as a separate finding"
  - "F34/CLIX-06: the --ai validation fix requires relocating the check block from dev.ts:302 to after effectivePlayerCount is computed at dev.ts:393, not an in-place operand swap (effectivePlayerCount doesn't exist yet at line 302)"
metrics:
  duration: "~35 minutes"
  completed: 2026-07-03
---

# Phase 135 Plan 1: Findings Verification (PROC-01 Gate) Summary

Independently re-verified all six in-scope Phase 135 audit findings (F9, F21, F22, F32, F33, F34) against current HEAD source — not the audit's original line numbers — and recorded a LEGITIMATE/REJECTED verdict for each in `135-FINDINGS-VERIFICATION.md` before any fix work begins, closing the PROC-01 "prove before fix" gate for Plans 02-06.

## What Was Built

`.planning/phases/135-cli-dev-experience/135-FINDINGS-VERIFICATION.md` — a per-finding verdict document with six sections, each headed by finding ID + requirement ID, containing a literal `VERDICT:` token and current-HEAD `file:line` evidence:

- **F9/CLIX-01** — LEGITIMATE. Confirmed dual authorship of player count (`project-scaffold.ts:109` writes `boardsmith.json`'s `playerCount`; `project-scaffold.ts:244-245` separately hardcodes `minPlayers`/`maxPlayers` into the generated `gameDefinition`), and that `dev.ts:359-360`'s fallback chain makes `config.playerCount` provably unreachable dead code. Additionally surfaced (not in the original audit text) that `build.ts:108-116`'s `{ ...config }` manifest spread silently forwards any stale `playerCount` key straight into the published bundle — recorded as in-scope for the same fix task.
- **F21/CLIX-03** — LEGITIMATE. `validate.ts:222-226`: comment says 50MB, constant (`maxTotalBundle`) is 200MB. Independently re-ran `grep MAX_BUNDLE_SIZE ~/ShufflewickPubGames/src/upload.ts` this session and confirmed the authoritative external gate is `50 * 1024 * 1024`. Recorded explicitly: the code is wrong, fix the constant to 50MB, do not touch the comment.
- **F22/CLIX-02** — LEGITIMATE. `validateMetadata` (`validate.ts:86-143`) only checks presence of four required fields; no code path anywhere in the file compares actual config keys against an allowed set, so misspelled `gameOptions`/`playerOptions`/`colorPalette` silently vanish. Dead `$schema` URL (`project-scaffold.ts:105`) compounds the gap.
- **F32/CLIX-04** — LEGITIMATE, with a correction recorded against `135-RESEARCH.md`. `dev.ts:283` confirmed defaults to `0.0.0.0`. Re-read `135-CONTEXT.md` directly and confirmed its locked decision is default **127.0.0.1** — RESEARCH.md's State-of-the-Art table incorrectly claims CONTEXT keeps `0.0.0.0`-by-default. The verification document records CONTEXT.md as authoritative and flags that the Plan 02-06 fix must implement a real default-value change, not a help-text-only fix.
- **F33/CLIX-05** — LEGITIMATE. Full-file read of `init.ts` (317 lines) confirms zero read sites for `options.template` anywhere in `initCommand` or its helpers — a provable silent no-op. Verdict: remove the flag outright.
- **F34/CLIX-06** — LEGITIMATE. Confirmed unguarded `parseInt` at `dev.ts:280-281` with no NaN/range guard, and that the `--ai` bounds check at `dev.ts:302` runs against raw pre-clamp `playerCount` — before `effectivePlayerCount` is computed at `dev.ts:393`. Recorded the required fix as a relocation of the check block (not an in-place operand swap, which would fail to compile since `effectivePlayerCount` isn't in scope at line 302).

No fix code was written — this plan is verdicts only, per its scope.

## Deviations from Plan

None - plan executed exactly as written. Both tasks completed as separate atomic commits matching the plan's two-task structure (F9/F21/F22 in commit 1, F32/F33/F34 in commit 2).

## Self-Check

- `.planning/phases/135-cli-dev-experience/135-FINDINGS-VERIFICATION.md` exists: FOUND
- `grep -v '^#' 135-FINDINGS-VERIFICATION.md | grep -c "VERDICT:"` returns 6: confirmed
- Commit `d6608d83` (Task 1, F9/F21/F22): FOUND
- Commit `c6caf3ed` (Task 2, F32/F33/F34): FOUND

## Self-Check: PASSED
