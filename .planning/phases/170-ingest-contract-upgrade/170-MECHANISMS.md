# Phase 170 — What Actually Worked, and the Fourteen Attempts

**READ THIS FIRST if you are picking up Phase 170 or any later v4.9 phase.**

Status as of 2026-07-27: the harness reports **10/10 PASS** on live multi-turn runs. No requirement
is marked Complete — the `170-10` human gate is the formal closure and has not been re-run since
the fix. See "Where to pick up" at the bottom.

Superseded documents you will find in this directory, listed so you do not act on them:

| Document | Status |
|---|---|
| `170-03-PLAN.md` | Gate plan for the FIRST human gate. Its `(a)-(i)` checklist is still the right acceptance bar, but its staging instructions predate the CLI commands. |
| `170-04-PLAN.md` | Superseded (golden-fixture premise invalid). Never executed. |
| `170-07-PLAN.md`, `170-08-PLAN.md` | Executed, but their mechanisms were all later refuted. Do not restore anything from them. |
| `170-PROOF-RUN.md` | The first failed gate. Still accurate about WHAT failed; its root-cause section is superseded by this file. |
| `170-HARNESS-REPAIR-SUMMARY.md` | Accurate and important. Read it for the harness's governance rule. |
| `templates/INDEX.template.md` | Still ships, for the interview path. The rulebook path is served by `boardsmith ingest-archive`; a test pins the two to agree. |

---

## The finding

**In the `bs-` pipeline, skill text reliably conveys judgment work and reliably fails to convey
mechanical work.**

Across ~20 live runs the transcription quality was consistently excellent: accurate slices, refusal
to fabricate scoring rules the source never defined, correct identification of a real contradiction
between the Run definition's caption ("example: 5, 6, 7") and its own illustration (red 1, blue 2,
red 3), and correct routing of whole-page visual identity to `00-visual-survey.md`.

What never survived was mechanics: "copy this file to this path", "use this exact heading", "run
this command". Not once, in any form, at any point in the flow.

**Two mechanisms worked. Both share one property: the model gets no choice.**

1. **`boardsmith init` refuses to run** without an explicit `--rulebook <path>` or
   `--without-rulebook`. A command that FAILS gets acted on — the traces show sessions iterating
   on `tsc` errors until clean, every run. This is what finally made the archive happen.
2. **A `pre-commit` hook that `init` installs.** The bs- build protocol commits at every step, so
   `boardsmith ingest-gaps` runs whether or not anyone remembers it. Not model-chosen at all.

## The twelve that failed

Every one was verified present in the installed skill tree. Every one was skipped on live runs,
several from files the session had just read.

| # | Mechanism | Commit |
|---|---|---|
| 1 | Reworded `DERIVED` definition + named `Visual` at the weave site | `93965ffb` |
| 2 | Extracted the whole contract to `ingest/transcription-subagent.md` for the subagent to read | `724befd7` |
| 3 | Shipped `templates/INDEX.template.md` to copy and fill | `4875f23f` |
| 4 | Strengthened Step 2.5/Step 3 imperatives | `cb2578e7` |
| 5 | Folded the archive into Step 3, removing the cross-step dependency | `328b235b` |
| 6 | Delegated archive + INDEX to a dedicated `synthesis-subagent.md` | `a9b541cf` |
| 7 | `STOP. Re-read this step` gate at the top of Step 3 | `c0b5f80e` |
| 8 | Carried the re-read instruction in subagent returns (`nextStep`) | `1163ac3b` |
| 9 | `BS-DISPATCH-V2` handshake token the subagent validates | `ec4ff66a` |
| 10 | Explicit contract-bound inline transcription path for short rulebooks | `b32b3483` |
| 11 | `boardsmith ingest-archive` as a command Step 3 invokes | `c8b2127d` |
| 12 | `--rulebook` as item 4 of Step 1's verification sequence | `6db99d5c` |

### The three observations that cracked it

All from `--output-format stream-json` tool-call capture, not inference:

1. **The orchestrator composes subagent prompts from memory.** A dispatch prompt opened
   *"Slice text is made of two visually distinct kinds of line"* — wording that has not existed in
   any file since `724befd7`, and which omits `Visual (p.N):` entirely. The contract file was never
   what reached the subagent, so editing it could not help.
2. **The orchestrator bypasses the fan-out design.** It dispatched a subagent nominally, then read
   the PDF itself (twice) and wrote every slice in the main stream. Every rulebook in this
   ecosystem is 2 pages — `seven`, `one-two-punch`, `doom-machine` — so this was every real run.
3. **A newly added step is skipped even early, even from a just-read file.** Attempt 12 made the
   archive item 4 of Step 1's verification sequence, whose items 1-3 (`init`, `tsc --noEmit`,
   serve-check + kill) execute correctly in every run. The session performed items 1-3 and skipped
   item 4. Its prior that "the scaffold sequence is three steps" beat the file that said four. Then
   attempt 12b put `--rulebook` on the `init` command line itself, and the session ran the bare
   `npx boardsmith init seven`.

So the failure is not late-session drift alone. The model reproduces `bs-` skill mechanics from its
prior at every granularity — whole steps, subagent prompts, and flags on a command line it reads.

## What this means for phases 171-179

All nine are skill-text phases, planned on the assumption that you write an instruction and pin it
with a contract test. Both halves of that are now disproven:

- A contract test proves an instruction **exists**, not that an agent receives or follows it. Every
  requirement in this phase passed its contract test and failed its real run.
- An instruction in skill text will not be followed if it is mechanical, regardless of form.

**Before planning any of them, sort each requirement into mechanical vs. judgment.** Mechanical
requirements need code (a command, a flag that errors, a hook). Judgment requirements can stay in
skill text and will likely work. Do not spend another phase rewording instructions.

## The harness

`npm run harness:ingest` — stages a throwaway project, drives a real headless multi-turn session,
commits the produced slices (which fires the hook), and reports 10 checks.

**Governance rule, learned the hard way:** a green is only meaningful if the run took a realistic
number of turns. **A green at ≤2 turns is an INVALID RUN, not a pass.** The original driver was
single-turn, scored the then-current skill text 10/10 three times, and a human then scored the same
text 1/10. Read `turnsTaken` alongside any score. Full story in
`170-HARNESS-REPAIR-SUMMARY.md`.

Two checker reshapes, both deliberate and both verified against the negative fixtures:

- **`e2`** counted numbered-list items only — an artifact of the failed run's formatting, which
  made the reconciliation apples-to-oranges. Now counts `Named-but-undefined` on both sides.
- **`h`** required ≥1 inline `Visual (p.` line. That passed only when a line had been MISFILED for
  the hook to relabel, and failed a run that classified correctly and routed presentation to the
  survey — rewarding sloppy transcription. Now asserts separability: ≥1 `Derived` line exists AND
  presentation is recorded somewhere (inline or a populated survey).

## Where to pick up

1. **Re-run the `170-10` human gate.** It has not been run since the fix. `170-10-PLAN.md`'s
   staging section is stale (it references `Step 2.5`); the `(a)-(i)` checklist in `170-03-PLAN.md`
   is still the right bar, and `scripts/ingest-harness/check.mjs` mechanizes all of it except `(g)`.
   To stage: `npx boardsmith claude --local --force` in a throwaway dir, then
   `/bs-ingest-rules <absolute-path-to-rules.pdf>`.
2. **Then close requirements.** INGEST-01/02/03/04 and PROC-01/02 all pass the harness but are
   deliberately still `Pending` in `REQUIREMENTS.md`. Two requirements were marked Complete
   prematurely during this phase and had to be reverted; do not repeat that.
3. **Re-scope 171-179** against the mechanical-vs-judgment split above.

**Never mutate `~/BoardSmithGames/seven`.** It is the proof target and stayed clean at
`a03f38d4792af9dfc7c798be69686fc3230f54dd` across every run. The harness asserts this before and
after, and the driver passes no `--add-dir`, so the driven session cannot reach it at all.
