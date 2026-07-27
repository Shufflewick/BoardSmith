# Phase 170 Plan 06 — Harness Baseline Run

**Status: FAIL (1 of 10 checks pass).** This is the plan's success condition: the harness
reproduces, in one agent-driven run with no human in the loop, the same failures the 2026-07-27
human gate found (`170-PROOF-RUN.md`). No INGEST requirement is closed by this run or by this
plan.

**Command invoked:**

```
node scripts/ingest-harness/run.mjs stage
node scripts/ingest-harness/run.mjs drive
node scripts/ingest-harness/run.mjs assert
```

(equivalently `npm run harness:ingest` end to end, since `stage`→`drive`→`assert` is the
no-subcommand default)

**Exit codes:** `stage` 0, `drive` 0 (session completed cleanly and printed
`HARNESS-STEP3-COMPLETE` after 330.5s), `assert` **1** (non-zero — required by this task's own
acceptance criteria: a zero-exit baseline against unchanged skill text would mean the harness
isn't measuring what the human gate measured).

**Produced project directory:** `/tmp/bs-ingest-harness/seven` (absolute path; the harness's own
throwaway tree, deleted after this document was written and verified non-empty).

**Skill text under test:** installed `--local --force` from this repo's current working tree
(commit `2dde272a`, Plan 06 Task 1's own commit — Plans 05/06 changed no file under
`src/cli/slash-command/`, so this is the identical skill text the 2026-07-27 human gate ran
against).

---

## Verbatim ten-row check table

| # | id | letter | PASS/FAIL | detail |
|---|----|--------|-----------|--------|
| 1 | archive-exists | a | FAIL | missing: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` does not exist as a regular file |
| 2 | archive-hash | b | FAIL | cannot compute hash: `/tmp/bs-ingest-harness/seven/rulebook/source/rules.pdf` missing |
| 3 | hash-recorded | c | FAIL | line absent: no "Source hash:" line with exactly 64 lowercase hex characters found |
| 4 | header-block | d | FAIL | "Source hash:" line missing or has an empty value; "Transcribed:" line missing or has an empty value; "Source:" value `` `/tmp/bs-ingest-harness/source-under-test/rules.pdf` (2 pages). `` does not begin with "rulebook/source/" (must be an in-project archived path, never an external absolute path) |
| 5 | gaps-heading | e1 | FAIL | expected "## Open Rules Gaps" but found instead: "## Open Rules Questions (surfaced, never fabricated)" |
| 6 | gaps-reconciliation | e2 | FAIL | section entries=0, slice Named-but-undefined markers=5 (markers greater than entries: the transport is dropping gaps) [no "## Open Rules Gaps" section found; treated as 0 entries] |
| 7 | tables-intact | f | FAIL | "## Slices" missing (found instead: "## Term → Slice Cross-Reference"); "## Term → Slice" missing (found instead: "## Term → Slice Cross-Reference") |
| 8 | visual-lines | h | FAIL | totals: Visual=0, Derived=28 \| per-file: 01-about.md: Visual=0, Derived=2; 01-components.md: Visual=0, Derived=4; 01-credits.md: Visual=0, Derived=2; 01-definitions.md: Visual=0, Derived=4; 01-game-end.md: Visual=0, Derived=3; 01-match-length.md: Visual=0, Derived=2; 01-round.md: Visual=0, Derived=3; 01-setup.md: Visual=0, Derived=2; 02-solo-variant.md: Visual=0, Derived=6 |
| 9 | derived-purity | i | FAIL | offending lines: 01-about.md:10 (matched "sans-serif"); 01-components.md:23 (matched "aspect ratio"); 01-definitions.md:16 (matched "illustration"); 02-solo-variant.md:32 (matched "full-bleed"); 02-solo-variant.md:34 (matched "wordmark") |
| 10 | reference-repo-unmodified | g | **PASS** | reference repo unchanged: clean, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` matches recorded `a03f38d4792af9dfc7c798be69686fc3230f54dd` |

**SUMMARY: 1/10 checks passing. OVERALL: FAIL.**

---

## Per-gate-letter comparison against `170-PROOF-RUN.md`

`170-PROOF-RUN.md`'s original header stated "7 of 9 checks" failed, but its own checklist table
lists 8 FAIL rows and 1 PASS row ((g)) out of the 9 listed items (a)-(i) — item (e) is one
combined checklist row covering both the heading string and the count reconciliation, which this
harness's checker correctly splits into two named checks (e1, e2). **Corrected count: the human
gate was 8 of 9 FAIL, not 7 of 9.** This baseline's comparison table uses the corrected count.

| Letter | Human gate (2026-07-27) | Harness (this run) | Agreement |
|---|---|---|---|
| (a) archive-exists | FAIL — directory never created | FAIL — directory never created | **Agree** |
| (b) archive-hash | FAIL — no archived copy to hash | FAIL — no archived copy to hash | **Agree** |
| (c) hash-recorded | FAIL — line absent entirely | FAIL — line absent entirely | **Agree** |
| (d) header-block | FAIL — 2 of 4 present; `Edition:` reads interview-path wording | FAIL — 2 of 4 present; `Source:` holds an external absolute path instead of an in-project archived path | **Agree (FAIL), different specific defect** — see discrepancy note below |
| (e1) gaps-heading | FAIL — heading is `## Open Questions (deferred at ingest by the designer)` | FAIL — heading is `## Open Rules Questions (surfaced, never fabricated)` | **Agree (FAIL), different improvised string** — see discrepancy note below |
| (e2) gaps-reconciliation | FAIL — section entries=3, slice markers=6 (5 excluding INDEX's own reference) | FAIL — section entries=0, slice markers=5 | **Agree (FAIL), different specific counts** |
| (f) tables-intact | FAIL — emitted as `## Slice Manifest` and `## Term Cross-Reference` | FAIL — emitted as `## Slice Manifest` and `## Term → Slice Cross-Reference` | **Agree (FAIL), same failure shape (renamed headings), near-identical improvised names** |
| (g) reference-repo-unmodified | PASS — `git status --porcelain` empty, HEAD `a03f38d4` unchanged | PASS — `git status --porcelain` empty, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd` unchanged | **Agree** |
| (h) visual-lines | FAIL — 24 `Derived (p.`, 0 `Visual (p.` | FAIL — 28 `Derived (p.`, 0 `Visual (p.` | **Agree (FAIL), same failure direction, different Derived total** |
| (i) derived-purity | FAIL — `02-solo-variant.md:21` (full-bleed purple panel, sans-serif column, rotated wordmark), `01-components-and-credits.md:30` (palette, aspect ratio, typography) | FAIL — `01-about.md:10` (sans-serif), `01-components.md:23` (aspect ratio), `01-definitions.md:16` (illustration), `02-solo-variant.md:32` (full-bleed), `02-solo-variant.md:34` (wordmark) | **Agree (FAIL), same failure shape (presentation description under `Derived (p.`), different offending files/lines** |

**No letter disagrees in pass/fail direction.** Every letter that failed the human gate fails
this harness run; the harness's own gate item (g) passes exactly as the human gate's (g) did. This
is the fidelity result this task exists to establish: **zero checker gaps, zero checker false
positives** — no letter where the harness is blind to a defect the human gate caught, and no
letter where the harness manufactures a failure the human gate didn't see. No amendment to
`check.mjs` or `check.test.mjs` was needed.

---

## The discrepancy worth calling out explicitly

Every disagreement above is in the *specific value*, never in the *pass/fail direction* — and
that pattern is itself the most informative finding in this document, because it directly informs
Plans 07/08's fix strategy.

**The improvised `## Open Rules Gaps` heading text differs between the two runs, and neither run
matches the spec or each other:**

- Human run (2026-07-27): `## Open Questions (deferred at ingest by the designer)`
- Harness run (this document): `## Open Rules Questions (surfaced, never fabricated)`
- Spec (`ingest-rules.md` Step 3 item 4): exactly `## Open Rules Gaps`, no parenthetical

The orchestrator is **composing a fresh plausible heading each time**, not misreading or
truncating one fixed string it read from the skill text. If the defect were "the model can't
read/retain the literal string," the two wrong headings would likely converge on the same wrong
string (e.g. both truncating to `## Open Questions`, or both dropping the same word). Instead they
diverge in wording, length, and even parenthetical style while agreeing only on topic ("this is
about open/unresolved questions"). That is the signature of prose *instruction* being
paraphrased into semantically-adjacent-but-textually-free output — exactly the `170-PROOF-RUN.md`
root-cause finding ("a contract that did not arrive" survives only where the consumer reads a
literal file or fills a literal template). **This strengthens Phase 170's template hypothesis**
(`170-07`/`170-08`): a template *shape* to fill should survive where a *string to reproduce from
prose* does not, because filling a template does not require the model to recall and reproduce an
exact heading string from memory of an instruction — it only requires locating the placeholder.

The same run-to-run variance, with the same fixed failure *direction*, appears in:

- **(f) tables-intact:** human run wrote `## Term Cross-Reference`; this run wrote
  `## Term → Slice Cross-Reference` — different renamings of the same required `## Term → Slice`
  heading, both wrong, both plausible.
- **(e2) gaps-reconciliation counts:** human run 3 section entries vs. 6 slice markers; this run 0
  section entries vs. 5 slice markers. The absolute numbers differ (different rulebook page
  content produces different real Named-but-undefined markers, and the section-entries side is
  driven by the same "not a Gaps section" heading confusion as (e1)), but the *direction* — markers
  greater than entries, i.e. the reconciliation never gets built from `openGaps[]` at all — is
  identical.
- **(h) visual-lines Derived totals:** 24 (human) vs. 28 (harness). The specific count is a
  function of how many `Derived (p.` lines transcription happened to emit this run; `Visual (p.`
  stayed at exactly 0 in both runs — the one number that is invariant across both runs is the one
  that matters (zero Visual lines, every run, no exception).

**Conclusion for the record:** the specific improvised strings and counts vary run to run because
this is a live LLM session, not a deterministic program — that variance is expected and is not
itself a defect. What does **not** vary, across a human-run session in July and this harness's
independent agent-run session, is the **failure mode**: prose-specified exact strings/headings are
never reproduced verbatim, and the Visual/Derived split never produces a single `Visual (p.` line
against a real, visually-dense two-page rulebook. That invariance under a changed session, changed
run, and changed specific agent output is exactly what makes this harness a faithful, reusable
proxy for the human gate rather than a one-off coincidence.

---

## Independently re-verified acceptance items

- `grep -c -- '--add-dir' scripts/ingest-harness/run.mjs` → `0`
- `/tmp/bs-ingest-harness/source-under-test/rules.pdf` exists, is a regular file (not a symlink),
  and `shasum -a 256` equals `5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880`
  — the value `stage` recorded and `--expect-hash`'s default
- The live `claude` process (verified via `ps aux` while `drive` was running) carried exactly
  `--print --dangerously-skip-permissions <prompt>` as its arguments — no additional-directory
  access grant, matching the run.mjs source
- `git -C ~/BoardSmithGames/seven status --porcelain` → empty
- `git -C ~/BoardSmithGames/seven rev-parse HEAD` → `a03f38d4792af9dfc7c798be69686fc3230f54dd`,
  matching the value `stage` recorded before `drive` ran
- `npm test` → 3236/3236 passing (unchanged from the Plan 05 baseline; the driver adds no tests)
- `node -e "require('./package.json').scripts.test"` → `vitest run` (no mention of `harness`)
- `/tmp/bs-ingest-harness` deleted only after this document was written and confirmed non-empty
