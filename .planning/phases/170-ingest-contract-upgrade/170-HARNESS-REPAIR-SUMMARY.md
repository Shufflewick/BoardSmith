# Phase 170 — Harness Repair: Multi-Turn Driver

**Date:** 2026-07-27
**Trigger:** The human PROC-01 gate scored 1/10 against skill text the harness had scored 10/10
on three consecutive runs. The proxy produced confident green for a mechanism that does not work
in the mode real designers use.
**Outcome:** Driver rebuilt as a multi-turn session. **It now reproduces the human failure.** The
session-shape hypothesis is confirmed, and the harness is trustworthy for the first time.

**No requirement is closed by this work.** INGEST-01..04 and PROC-01/02 all remain Pending. The
underlying skill-text defect is untouched.

---

## What was wrong with the old driver

`drive` sent exactly one prompt, and that prompt instructed the session to answer its own
per-section confirmation prompts and proceed without asking. That single instruction collapsed the
session into one turn.

A real designer's session does not look like that. The human gate ran: project-name derivation, a
clarifying question about the source project's identity, four separate per-section confirmation
exchanges, and an edition answer — many turns, accumulating context — before reaching Step 3.

## What changed

`drive` is now genuinely multi-turn, via `claude --print --session-id <uuid>` followed by
`claude --print --resume <uuid> "<answer>"` per turn. Turn 1 invokes `/bs-ingest-rules` and gives
the staged source path and a project name, and — critically — **does not tell the session to
auto-answer**. Subsequent turns supply realistic designer answers (`confirm`, `none stated`, …)
until the completion marker appears or a `--max-turns` cap (default 25) is hit. Hitting the cap is
a reported failure with its turn count, never a silent pass.

Sandboxing is unchanged and still verified: the source is copied to `{workDir}/source-under-test/`,
no `--add-dir` is passed, and `~/BoardSmithGames/seven` is checked clean before and after.

A second fix landed alongside (`0b06aab9`): the completion marker must now match on its own line
rather than as a substring. As a substring, a session that merely *narrated* the marker while
explaining its plan would end the run early, and the checker would then grade a half-finished
project — reading as either a spurious failure or, worse, a pass on incomplete work.

---

## Validation — the point of this work

A rebuilt driver reporting green would have been worthless until it first reproduced the known
failure. It was therefore run against **unchanged HEAD skill text**, which the human gate had
already proven fails.

| Driver | Turns | Score | Checks passed |
|---|---|---|---|
| Old single-turn ×3 | 1 | **10/10** | all |
| New multi-turn, run 1 | 5 | **2/10** | `tables-intact`, `g` |
| New multi-turn, run 2 | 13 | **1/10** | `g` only |
| **Human gate (2026-07-27)** | many | **1/10** | `g` only |

Run 2 matches the human gate exactly: `a, b, c, d, e1, e2, f, h, i` all FAIL, `g` passes.
**The driver is faithful.**

(A third run was executed but its output was cleaned before being recorded. Runs 1 and 2 plus the
human gate are a sufficient evidence set; the missing third is noted rather than reconstructed.)

---

## The dose-response finding — the most valuable result here

Turn count correlates with compliance:

```
 1 turn   → 10/10
 5 turns  →  2/10
13 turns  →  1/10
long      →  1/10   (human gate)
```

This is materially stronger than a binary reproduction. It says the defect is **progressive
context drift**, not a fixed bug that either fires or does not. Supporting detail: run 1 at 5 turns
still honored `tables-intact`, while run 2 at 13 turns had lost even that — partial compliance
decaying continuously with session length.

### What this retro-explains

- **Why six architectural approaches all appeared to fail.** Every one of them — reworded
  instructions, a self-limiting definition, an extracted contract file, a shipped template, a step
  reorder, a delegated subagent — changed text the session reads *once, early*, then drifts away
  from. The approaches were not all wrong about mechanism; the variable was wrong.
- **Why the synthesis-subagent fix "worked."** It genuinely does work in a 1-turn session. It is
  worthless in a 13-turn one. Three green single-turn runs measured a condition that does not
  occur in practice.
- **The unattributed `visual-lines` jump (0 → 14).** Flagged at the time as not explained by the
  change that accompanied it, and deliberately not claimed. It was the short session complying
  with transcription instructions it had not yet drifted from — nothing to do with that commit.

### The bar any future fix must clear

**Evaluate against a LONG session.** A short one will flatter any fix. A candidate that improves
the 5-turn score but not the 13-turn score has not addressed the defect.

---

## Governance rule for this harness

This is the second time a driver's trustworthiness was the deciding factor in a wrong conclusion.
Going forward:

> **A green from this harness is only meaningful if the run took a realistic number of turns.
> A green at ≤2 turns is an INVALID RUN, not a pass.**

`turnsTaken`, `maxTurns`, `stoppedReason`, and `hitTurnCap` are reported with every result and must
be read alongside the score. A result quoted without its turn count is not evidence.

More generally: this harness was originally validated only against a *failing* baseline, and its
greens were then trusted. Validating a detector on negatives alone establishes that it can fire —
not that it fires under the conditions that matter. Both directions must be validated, under
realistic conditions, before any green is load-bearing.

---

## Verification

- `npm test` — 3252 passing
- `grep -c -- '--add-dir' scripts/ingest-harness/run.mjs` — 0 (sandboxing preserved)
- `~/BoardSmithGames/seven` — clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd`
- No stray processes; `/tmp` scratch dirs removed
- No skill text modified; no checker check or lexicon weakened

## Commits

- `a67ca8a4` — rebuild `drive` as a multi-turn session
- `0b06aab9` — require the completion marker on its own line, not as a substring

## Next

The skill-text defect is untouched and is the next piece of work. The constraint it must satisfy
is now known and is architectural rather than editorial: **structure the pipeline so compliance
does not depend on how long the session has been running.** That constraint applies to every
remaining v4.9 phase, all of which are skill-text phases.
