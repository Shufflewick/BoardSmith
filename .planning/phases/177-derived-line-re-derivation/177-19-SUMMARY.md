---
phase: 177-derived-line-re-derivation
plan: 19
subsystem: cli-verify (rulebook provenance)
tags: [check04-replacement, provenance, quote-verified, multi-source, defect-found, defect-fixed]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (177-EXPERIMENTS/README.md, CORRECTION section)
    provides: The reasoning for why QuoteVerifiedProvenance exists and must fail closed.
  - plan: 177-18
    provides: The doom-machine measurement that found QuoteVerifiedProvenance's per-project scope
      silently vouched for CARDS.md's cards.pdf-sourced findings, even though only rules.pdf was
      archived — the confirmed gap this plan closes.
provides:
  - QuoteVerifiedProvenance.covers(slicePath) — a per-slice, fail-closed, explicitly-heuristic
    coverage check (verify-enumerate.ts), consulted by classifyDerivedLines alongside the existing
    null-gate for every suspect (uncorroborated/contradicted) and absence finding.
  - Multi-source representation in ingest-archive.ts's INDEX.md ("## Additional Sources"), so a
    second `boardsmith ingest-archive <different-file>` call augments a project's provenance
    instead of silently overwriting the primary Source:/Source hash: header.
  - An additive `additionalSources` field on chunk-provenance.ts's VerificationScope, each entry
    independently hash-verified.
  - Real doom-machine repo commit archiving cards.pdf as an additional source, closing the actual
    measured gap end-to-end (not just in test fixtures).
affects: [the-orchestrator-disposition-of-CHECK-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-closed per-slice attribution via filename-stem substring matching, explicitly labeled
      a heuristic in code comments (never claimed structural): a single unarchived source
      candidate excludes name-matching slices from coverage; two or more unarchived candidates, or
      a match too short to trust (below MIN_STEM_MATCH_LENGTH), refuse to vouch for ANY slice
      rather than guess. Distinguished throughout from the STRUCTURAL null-gate (private
      constructor, unforgeable) that was already in place."
    - "Additive-only schema evolution for a hand-maintained provenance file: a NEW, separately
      fenced '## Additional Sources' section rather than reusing or extending the existing
      Source:/Source hash: labels computeVerificationScope's regexes are pinned to (first-match
      semantics preserved byte-for-byte). Verified empirically that single-source INDEX.md output
      stays byte-identical (existing ingest-archive test suite, 50 tests, unmodified and green)."
    - "Empirically proved every new negative pin twice: reverted the covers() gate in
      classifyDerivedLines, confirmed the exact predicted tests fail; separately reverted
      ingest-archive's branching logic, confirmed 6/7 multi-source tests fail; separately reverted
      the additionalSources consultation in QuoteVerifiedProvenance.obtain(), confirmed the one
      relevant loop-closing test fails. Restored each fix and confirmed `git diff --stat` clean
      before re-committing, per honesty discipline."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-19-SUMMARY.md
  modified:
    - src/cli/commands/verify-enumerate.ts (QuoteVerifiedProvenance.covers(), detectRootSourceCandidates,
      classifyDerivedLines gating)
    - src/cli/commands/verify-enumerate.test.ts (+8 tests: covers() cases, classifyDerivedLines
      per-slice gating, the loop-closing integration test)
    - src/cli/commands/ingest-archive.ts (ADDITIONAL_SOURCES_* constants, parseAdditionalSources,
      addAdditionalSource, readCanonicalPrimarySource, ingestArchiveCommand branching)
    - src/cli/commands/ingest-archive.test.ts (+8 tests: multi-source archiving, idempotence,
      byte-identical single-source, JSON result field)
    - src/cli/commands/chunk-provenance.ts (VerificationScope.additionalSources, verifyAdditionalSources)
  # Game-repo change, not this repo:
  # ~/BoardSmithGames/doom-machine/rulebook/INDEX.md (+16), rulebook/source/cards.pdf (new) — commit aa8ef98

decisions:
  - "Fail closed at the PROJECT level whenever coverage cannot be established with confidence: two
    or more unarchived source candidates refuses to vouch for ANY slice (not just the ambiguous
    ones), because the filename-substring heuristic was built from exactly one measured case
    (CARDS.md/cards.pdf) and has no evidence it discriminates correctly between two or more
    unknowns at once."
  - "Chose filename-stem substring matching over a project-wide all-or-nothing fail-closed design
    (which would have also downgraded doom-machine's 9 genuinely-covered non-CARDS.md
    corroborations) because the task brief explicitly asked which slices the archive covers, and a
    labeled heuristic that fails closed on ambiguity is more honest than either silently vouching
    for everything or silently discarding real, correct corroborations that have nothing to do
    with the gap."
  - "Priority 2 (multi-source ingest-archive) attempted and landed, closing the loop with Priority
    1: once a project's second source is genuinely archived-and-hash-verified via
    `boardsmith ingest-archive`, QuoteVerifiedProvenance.covers() resolves true for every slice
    unconditionally — no heuristic needed. Verified this really works with the real BoardSmith CLI
    (not just imported TS functions) against the real doom-machine repo, then committed the result
    there (aa8ef98)."
  - "Did NOT extend computeVerificationScope's existing return shape beyond an additive field, and
    did NOT touch its primary Source:/Source hash: parsing contract at all — every existing
    consumer (verify-classify.ts, chunk-provenance.ts's own chunk-check/status commands) is
    unaffected, confirmed by their full test suites passing unmodified."

# Metrics
metrics:
  duration: "~2 hours"
  completed: 2026-07-31
---

# Phase 177 Plan 19: Close the Per-Project Quote-Provenance Gap (CHECK-04) Summary

Closed a measured, real gap in CHECK-04's quote-provenance safety guard: `QuoteVerifiedProvenance`
was per-PROJECT while quotes come from per-SOURCE documents, so archiving one of a project's two
source PDFs marked every slice quote-verified — including slices whose real source was never
archived. Both priorities landed: the guard is now per-slice and fails closed (Priority 1), and
`ingest-archive` can represent more than one source so a project can close its own gap for real
(Priority 2). Verified against real doom-machine, seven, and one-two-punch data.

## Priority 1 — the guard is now per-slice, fail-closed

`QuoteVerifiedProvenance` gained `covers(slicePath): boolean`, consulted by `classifyDerivedLines`
alongside the existing structural null-gate for every suspect (`uncorroborated`/`contradicted`)
and `'absence'` finding. Three cases, explicitly ordered and labeled by reliability:

1. **Zero unarchived source candidates** (the ordinary, single-source case — `seven` and
   `one-two-punch` both resolve here) — every slice covered unconditionally, identical to prior
   behavior.
2. **Two or more unarchived candidates** — refuses to vouch for ANY slice. The filename heuristic
   below was built from exactly one measured case and has no evidence it discriminates correctly
   between multiple unknowns, so ambiguity above one candidate fails closed entirely rather than
   guessing further.
3. **Exactly one unarchived candidate** (the doom-machine shape: `rules.pdf` archived,
   `cards.pdf` not) — a HEURISTIC, labeled as one at its own definition: a slice's filename stem is
   compared, case-insensitive substring in either direction, against the candidate's stem
   (`"CARDS.md"` vs `"cards.pdf"` → both stem to `"cards"` → excluded). Stems shorter than
   `MIN_STEM_MATCH_LENGTH` (4) are refused as unreliable anchors and fail closed too.

`detectRootSourceCandidates` scans the PROJECT ROOT (never `rulebook/`, which holds `.md` slices)
for files matching the same extensions `ingest-archive` documents accepting (`.pdf`, `.png`,
`.jpg`, `.jpeg`, `.txt`) — mechanical, not content-based, and honestly incomplete (a source kept
outside the root, or under an unlisted extension, is invisible to it; named explicitly in the
function's own comment).

The private-constructor unforgeability property is untouched — `QuoteVerifiedProvenance` still has
no public constructor, only `obtain()`.

## Priority 2 — multi-source archiving, landed

Attempted per the brief's "attempt only after Priority 1 is committed and green" instruction, and
it landed cleanly. `ingest-archive.ts` gained a new, additive `## Additional Sources` section in
`INDEX.md` (fenced and machine-owned, mirroring `## Open Rules Gaps`'s established pattern).
`ingestArchiveCommand` now detects when the file being archived differs from the already-canonical
primary source (`readCanonicalPrimarySource` — deliberately conservative: only fires when the
existing header is ALREADY fully canonical, so every existing wrap-safe/insert-if-absent repair
path in `repairExistingIndex` is completely untouched) and records it as an additional source
instead of overwriting the primary.

**Every hard-won invariant named in the task brief was respected and is now pinned by tests:**
`Source:`/`Source hash:` are never touched by a second, different-source call; `computeVerificationScope`
still reads the FIRST `^Source:` match unchanged; single-source projects' `INDEX.md` output is
byte-identical (the full existing 50-test `ingest-archive.test.ts` suite passes unmodified).
`chunk-provenance.ts`'s `VerificationScope` gained an additive `additionalSources` field — each
entry independently hash-verified the same way the primary source is, silently dropped (never
reported with a caller-ignorable flag) if its archived file is missing or its hash no longer
matches.

**The loop closes with Priority 1**: `QuoteVerifiedProvenance.obtain()` now excludes a root-level
file from `unarchivedSources` when it matches either the primary source or a verified additional
source. Once a project's second source is genuinely archived via `ingest-archive`, `covers()`
resolves `true` for every slice unconditionally — no filename heuristic needed at that point,
proven by a dedicated integration test that runs the real `ingestArchiveCommand` and then re-checks
`covers()`.

**Verified this works with the real CLI, not just test fixtures**: ran `boardsmith ingest-archive
cards.pdf --json` against the real `~/BoardSmithGames/doom-machine` project (symlinked to this
repo's live source, no rebuild needed). It archived `cards.pdf`, recorded its hash in a new
`## Additional Sources` section, left the `rules.pdf` primary header byte-for-byte untouched
(`git diff` on the game repo confirms), and committed the result (`aa8ef98`) — the actual doom-machine
provenance gap this whole plan exists to close is now closed for real, not just representable in
code.

## Honesty on what is heuristic vs. structural

Documented explicitly, at three levels (module-level doc comment, `covers()`'s own doc comment, and
the `quoteUnverifiedReason` reason text a caller actually sees): the null-gate (`provenance ===
null`) is STRUCTURAL — a private constructor means no caller can forge a `QuoteVerifiedProvenance`
value. `covers()`'s filename-substring attribution is NOT structural — it is a heuristic, built
from one measured case, that can be wrong in either direction on a project that does not follow the
doom-machine naming convention, and the code comments say so in the same breath as they explain why
the wrong-direction risk (a false positive treating something as covered that isn't) is bounded to
never happen — every ambiguous or unattributable case reports `false`, never `true`.

## Task 3 — verified on real data

Re-ran real doom-machine, `seven`, and `one-two-punch` reconciler proposals (177-15/177-18's actual
archived `claude -p` dispatch output — `enum`/`reconcile` JSON, not invented) through the fixed
`validateGrounding` → `classifyDerivedLines` pipeline with fresh `QuoteVerifiedProvenance.obtain()`
results against each real project directory.

**Before archiving `cards.pdf`** (the state this plan's fix targets):

| Project | Result |
|---|---|
| doom-machine (11 slices, run1) | 12 `corroborated`, 5 `uncorroborated`, **2 `quote-unverified`** (CARDS.md L30, L140 — exactly the two lines 177-18 flagged as a silent, untrustworthy leak) |
| doom-machine CARDS.md specifically | L19/L70/L270 `corroborated` (unaffected — `corroborated` proposals were never gated by provenance), **L30/L140 `quote-unverified`** (the fix: previously silently vouched for) |
| seven (run1) | 3 `uncorroborated` (21, 36, 38), **0 `quote-unverified`, 0 `contradicted`** — matches 177-16 exactly, NOT regressed |
| one-two-punch (run1) | 8 `corroborated`, 3 `uncorroborated` (117, 128, 132), **0 `quote-unverified`, 0 `contradicted`** — matches 177-16 exactly, NOT regressed |

**After archiving `cards.pdf` for real** (Priority 2's end state, now committed to the doom-machine
repo): doom-machine's `QuoteVerifiedProvenance.unarchivedSources` is `[]`; CARDS.md L30/L140
resolve from `quote-unverified` to a genuine, honest `uncorroborated` (the reconciler's real
grounded-fact list has no support for either line — a real gap report now that both sources are
quote-verified, not a mechanical withholding). Full doom-machine picture: 12 `corroborated`, 7
`uncorroborated`, 0 `quote-unverified`, 0 `contradicted`.

**Answering the two required checks:** CARDS.md's suspect lines correctly stopped being falsely
vouched for (the fix), and `seven`/`one-two-punch` were not regressed into `quote-unverified` (the
precision check) — confirmed against real archived dispatch data, not synthetic fixtures.

## Deviations from Plan

None beyond what is documented above as decisions. Both priorities were attempted and both landed;
the brief's "if Priority 2 proves too risky, stop and report open" contingency did not trigger.

## Known Stubs

None — all new code paths are exercised by tests and by the real doom-machine repo run.

## Threat Flags

None. This plan modifies provenance-recording and provenance-checking logic for an existing,
already-reviewed CLI command (`boardsmith ingest-archive`) and an existing verification module
(`verify-enumerate.ts`). No new network endpoint, auth path, or externally-reachable file-access
pattern — `detectRootSourceCandidates` reads the project's own directory listing, the same
trust boundary every other function in this module already operates within.

## Self-Check: PASSED

- FOUND commit: `4ddee529` "fix(177-19): make QuoteVerifiedProvenance per-slice, not per-project"
- FOUND commit: `b5be6f65` "feat(177-19): teach ingest-archive to represent multiple sources, additively"
- FOUND commit (doom-machine repo): `aa8ef98` "docs(rulebook): record cards.pdf as an additional archived source"
- CONFIRMED: `~/BoardSmithGames/doom-machine/rulebook/source/cards.pdf` exists, hash
  `052e36058a80e537127926cb24a22dbd3464d16545d62af8e20a18f94a4ef7ed` matches `## Additional
  Sources` table in `rulebook/INDEX.md`.
- CONFIRMED: `~/BoardSmithGames/doom-machine/rulebook/INDEX.md`'s primary `Source:`/`Source hash:`
  lines are byte-identical to before this plan (`git diff` on the game repo shows only additions,
  no changes to existing lines).
- CONFIRMED (empirically, not asserted): reverted each of the three new gates independently,
  confirmed the exact predicted tests fail (3/3 in `classifyDerivedLines`'s covers()-gate revert,
  6/7 in `ingest-archive`'s branching-logic revert, 1/1 in `QuoteVerifiedProvenance.obtain()`'s
  additionalSources-consultation revert), restored, confirmed `git diff --stat` clean before
  re-committing.

## Full test run

`npm test`: **4127/4127 passed**, full suite, run from `/Users/jtsmith/BoardSmith`. Baseline was
4111 (per the task brief); +8 in `verify-enumerate.test.ts` (63→71), +8 in `ingest-archive.test.ts`
(50→58) — all new tests, zero pre-existing tests modified or removed.
