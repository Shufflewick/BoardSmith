# Phase 170 — PROC-01 Proof Run Record

**Status: FAILED (8 of 9 checks).** Checkpoint not approved. Recorded per `170-03-PLAN.md`
Task 2/3.

**Date:** 2026-07-27
**Proof target:** `~/BoardSmithGames/seven/rules.pdf`
**Source SHA-256:** `5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880` (2,194,346 bytes)
**Throwaway project:** `/tmp/bs-170-ingest-proof/proof`
**Skills under test:** installed `--local` into `/tmp/bs-170-ingest-proof/.claude/skills`; global
`~/.claude/skills/` untouched throughout (verified: mtime 11:24, predating all session work).

Three real `/bs-ingest-rules` sessions were run against this target. Runs 1 and 2 stopped before
Step 3; run 3 completed Step 3 (Synthesis) and is the run recorded here.

---

## Checklist results

| Item | Check | Result |
|------|-------|--------|
| (a) | `rulebook/source/` contains `rules.pdf` | **FAIL** — directory never created |
| (b) | `shasum -a 256` of archived copy | **FAIL** — no archived copy to hash |
| (c) | `Source hash:` in `INDEX.md` equals (b) | **FAIL** — line absent entirely |
| (d) | Four header lines present, non-empty | **FAIL** — 2 of 4. `Source hash:` and `Transcribed:` absent. `Edition:` reads `unpublished — designer statement`, which is the **interview-path** wording emitted on the **rulebook** path |
| (e) | `## Open Rules Gaps` + count reconciliation | **FAIL** — heading is `## Open Questions (deferred at ingest by the designer)`. Section-side entries: 3. Slice-side `Named-but-undefined` markers: 6 (5 excluding INDEX's own reference). Unequal in the drop direction |
| (f) | `## Slices` and `## Term → Slice` intact | **FAIL** — emitted as `## Slice Manifest` and `## Term Cross-Reference` |
| (g) | `~/BoardSmithGames/seven` unmodified | **PASS** — `git status --porcelain` empty, HEAD `a03f38d4`, unchanged from Task 1 baseline |
| (h) | ≥1 `Derived (p.` and ≥1 `Visual (p.` in slices | **FAIL** — 24 `Derived (p.`, **0** `Visual (p.`. Third consecutive run at zero. No waiver taken: `seven` is graphically dense and the produced `00-visual-survey.md` itself records palette, typography, wordmark and card art |
| (i) | No `Derived (p.` line is pure presentation | **FAIL** — at minimum `02-solo-variant.md:21` (full-bleed purple panel, white sans-serif column, 45°-rotated wordmark) and `01-components-and-credits.md:30` (palette candidates, card aspect ratio, typography). Both are unambiguous presentation descriptions under the rule-bearing prefix |

**Requirement outcome:** INGEST-01 FAIL · INGEST-02 FAIL · INGEST-03 FAIL · INGEST-04 FAIL.
PROC-01 itself: **satisfied** — the gate did exactly its job.

Test state at time of run: `ingest.test.ts` 69/69 green, full repo 3211/3211 green.

---

## Root-cause finding

**The `bs-ingest-rules` orchestrator does not execute its skill text literally.** It produces
output that is semantically adjacent — well-organized, sensibly commented, substantively correct
about the game — but with its own headings, its own omissions, and its own wording in place of
the specified strings.

Three fixes were attempted against INGEST-02 during this phase, each verified present in the
installed skill tree, none with any observable effect on live behavior:

1. `93965ffb` — made the `DERIVED` bullet self-limiting (rule-bearing qualifier at its own site)
   and named `Visual (p.N):` at the `visualEvidence[]` weave site. No effect.
2. `724befd7` — extracted the whole subagent contract to `ingest/transcription-subagent.md` so
   the subagent reads it directly instead of receiving an orchestrator-composed paraphrase.
   No effect on the live run.

### The controlled comparison that identifies the mechanism

Two independent experiments, both reproducible:

**Experiment 1 — verbatim delivery works.** A subagent dispatched with the fenced contract block
delivered verbatim, against the same page that failed twice in situ (`seven` p.2):

| `seven` p.2 | `Visual (p.` in slice | `Derived (p.` in slice |
|---|---|---|
| In-situ run | 0 | 7 (4 pure visual) |
| Verbatim-block probe | **1** (layout/wordmark/typography) | **1** (match/game aggregation — genuinely rule-bearing) |

The instruction is correct and effective when it actually reaches the subagent.

**Experiment 2 — templated artifacts survive, prose-instructed ones do not.** From the *same*
run 3 session, same orchestrator:

| Artifact | Specification style | Conformance |
|---|---|---|
| `ASSETS.md` | `templates/ASSETS.template.md` | **Exact** — `# Assets`, `## Ledger`, 5-column header verbatim |
| `INDEX.md` | prose instructions in `ingest-rules.md` Step 3 | **Diverged on every specified string** |

`rulebook/INDEX.md` is the only artifact in this pipeline with no template. `SKETCH`, `CHUNK`,
`ASSETS`, `DECISIONS`, `DESIGN`, and `RULINGS` all have one, and the templated ones come out
conforming.

Corroborating detail: runs 1 and 2 both invented a `## Visual notes` heading — a string that
appears nowhere in any skill text — and wrote `Derived (p.N):` lines beneath it. The subagent
correctly identified the content as visual and had no prefix available for it, which is the
signature of a contract that did not arrive.

### Conclusion

The phase's working premise — *edit skill text, pin it with a contract test, done* — is unsound.
A contract test proves an instruction **exists**; it cannot prove an agent **receives or
follows** it. Every requirement in this phase passed its contract test and failed its real run.

The mechanism that demonstrably survives the orchestrator is **structural**: a file the consumer
reads directly (Experiment 1), or a template it fills (Experiment 2). Prose instruction does not
survive.

---

## Disposition

Checkpoint **not approved**. Per `170-03-PLAN.md` Task 2 step 5, the produced artifacts were not
hand-patched and no criterion was weakened.

Operator decisions taken at the gate:

1. **Replan Phase 170 around templates** — add `templates/INDEX.template.md` and rewrite Step 3
   to fill it, matching the mechanism Experiment 2 shows already works.
2. **Build a cheaper verification proxy first** — an automated harness that exercises the real
   skill text end-to-end and asserts on produced artifacts, so future iterations cost an agent
   rather than a human ingest session. Three sessions were spent reaching this finding.

## Evidence preserved

- `170-PROOF-INDEX.md` — the produced `rulebook/INDEX.md` verbatim
- `170-PROOF-SLICE.md` — the produced `rulebook/02-solo-variant.md`, carrying the misfiled
  `Derived (p.2):` presentation line cited in (i)
