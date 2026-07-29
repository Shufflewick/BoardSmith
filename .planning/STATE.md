---
gsd_state_version: 1.0
milestone: v4.9
milestone_name: BS Skills Re-Verification
status: executing
stopped_at: Completed 173-08-PLAN.md — closed CR-01 crash-safety + Finding 1 resume determinism, re-proved SC-4, VERIFY-08 re-confirmed
last_updated: "2026-07-29T23:45:46.411Z"
last_activity: 2026-07-28
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 37
  completed_plans: 30
  percent: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-02)

**Core value:** Make board game development fast and correct -- the framework handles multiplayer, AI, and UI so designers focus on game rules.
**Current focus:** Phase 174 — verify-classifier

## Current Position

Phase: 174 (verify-classifier) — IN PROGRESS (2/7 plans)
Next: Phase 174 plan 03 (VERIFY-03 mechanical CLI extension — page-span-overlap slice pairing)

`174-02-PLAN.md` widened `verify-run.ts`'s ledger surface: exported the seven module-private
atomic-write/parse helpers (`atomicWriteFile`, `appendLedgerLine`, `locateFences`,
`parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow`) plus the
`ParsedLine` union unchanged in behavior, so `verify-classify.ts` (plans 174-03/174-04) can
genuinely reuse the one hardened atomic ledger write path (173-08/CR-01) instead of a second copy.
Taught `parseLedgerBody`/`resolveLedgerState` a fourth record kind, `classification`, with a
PLURAL schema (`units[]`/`liveSlices[]`/`stagedSlices[]`) matching `SlicePair.stagedUnits[]`
field-for-field per CONTEXT.md decision 6 (amended) — no collapsing step, so no recorded unit of
an m:n pair group is discarded. Kind isolation (a classification line never contaminates
`recorded[]`; `range-reset` stays unit-scoped) falls out of the existing filter logic. 43/43
ledger tests pass, `npm test` 3624/3624 green, typecheck clean. See
`.planning/phases/174-verify-classifier/174-02-SUMMARY.md`.

`174-01-PLAN.md` closed the phase's Wave-1 gate: neither reference game had any real
pass-1-vs-pass-2 material on disk (`174-RESEARCH.md`'s biggest finding), so this plan produced it
for real, reusing Phase 173's adoption + re-transcription pipeline unchanged against fresh `cp -R`
copies of both `seven` and `one-two-punch`. Real skill install, real `ingest-archive` adoption
(Case 2, no `--edition`), real `verify-run-init`/`-record`/`-status`, and a real `claude -p`
subprocess dispatch of the transcription-subagent contract (no internal Task tool exposed to this
executor — same documented constraint and resolution as `173-PROOF.md` §3). `seven` produced 6
staged files vs. 3 live rule slices (reproducing 173's own 6-vs-3 measurement of this exact game
exactly); `one-two-punch` produced 6 staged vs. 2 live (a 3x fan-out). Every live slice confirmed
byte-identical before/after pass 2; zero slice-body-shaped lines in either subagent's raw return.
Archived both games' real live+staged material into `174-FIXTURES/` with a 23-row sha256 manifest
(independently re-verified 23/23 match) so it survives scratch cleanup. Measured the real
presentation-marker inventory — `one-two-punch` live: 5 `— diagram description` + 1 `— art` of 12
total `Derived` lines, 0 `Visual (p.` lines; `seven` live: 0/10, 0 `Visual (p.` — matching
`174-RESEARCH.md`'s prior measurement of the untouched originals exactly, no contradiction. A
sweep for a third legacy presentation qualifier found none (only `art` and `diagram description`
exist), closing the open measurement question behind CONTEXT.md decision 12b's enumerated
exclusion constant. Both `~/BoardSmithGames` originals confirmed byte-identical (whole-tree
sha256 diff empty) before and after. `VERIFY-03` intentionally left OPEN in `REQUIREMENTS.md` —
this plan produced fixtures only; no classifier code exists yet (plans 174-02 onward). See
`.planning/phases/174-verify-classifier/174-01-SUMMARY.md`.

Phase 173 (verify-pipeline-core) is COMPLETE (8/8 plans).

`173-08-PLAN.md` was a follow-up closing two defects the phase's own evidence chain surfaced AFTER
173-07 marked the phase complete: CR-01 (Critical — the ledger write was a full truncate+rewrite,
not crash-safe as the module's own doc comment claimed) and `173-PROOF.md` §4 Finding 1
(range-level resume re-dispatch was not idempotent — 9 recorded units vs. 4 for a clean run). Both
fixed before Phase 174 builds on the guarantee: atomic temp-file+`fsync`+`rename()` ledger writes,
and a persisted page-range dispatch-plan manifest + range-complete/range-reset markers making
resume deterministic. Re-proven live against a real `cp -R` copy of `one-two-punch` with real
process kills — the killed-then-resumed run's final recorded-unit set now matches a clean run's
exactly. Also closed WR-01 and the three Info items from `173-REVIEW.md`. VERIFY-08 re-confirmed
complete against the corrected guarantee (`173-PROOF.md` §5). `npm test`: 3611/3611. See
`.planning/phases/173-verify-pipeline-core/173-08-SUMMARY.md`.

`173-07-PLAN.md` closed the phase: a REAL kill-and-resume proof for SC-4/VERIFY-08 against a fresh
`cp -R` copy of `one-two-punch`, split into two single-page dispatches so a kill could land between
independent subagent calls. Two genuine interruption mechanisms — a harness-timeout SIGTERM landing
mid-record-loop, and a deliberate `kill -9` on a confirmed live PID — both left the core no-data-loss
guarantee intact (byte-identical mtime+sha256 on already-recorded staged files, single ledger lines,
zero waste on the range killed before any dispatch). Two real findings reported rather than smoothed
over: range-level resume re-dispatch is NOT idempotent (an already-partially-recorded page range gets
re-covered in full rather than sub-divided — 9 recorded units vs. 4 for a clean uninterrupted run of
the same book), and a torn ledger line that ALSO destroys its trailing fence throws a hard error
instead of gracefully demoting the affected unit (the narrower torn-line-only case behaves exactly as
designed). Also deliberately exercised the torn-ledger-line crash-safety case with both sub-cases.
Closed the phase's evidence trail: `173-PROOF.md` now carries all four live proofs plus a final
phase-wide "What is still unproven" (9 items) and a "How to re-run every proof" block;
`173-VALIDATION.md` fully signed off (`nyquist_compliant: true`); `REQUIREMENTS.md` — VERIFY-02 and
VERIFY-08 marked complete with citations, VERIFY-01 and VERIFY-07 DELIBERATELY LEFT OPEN (their
"per-chunk verdict"/"classification in subagents" halves depend on Phase 174's not-yet-built
classifier — marking them now would have been a third premature completion mark this phase caught).
`npm test`: 3597/3597 (unchanged, docs-only plan). See
`.planning/phases/173-verify-pipeline-core/173-07-SUMMARY.md`.

`173-01-PLAN.md` closed the phase's wave-1 hard gate: `ingestArchiveCommand`'s existing-INDEX
branch was reporting false success on already-ingested projects while silently failing to write
`Source hash:`/`Transcribed:`, orphaning a wrapped `Source:` paragraph, and clobbering a real
`Edition:` value. Repaired all four root causes (insert-if-absent headers, wrap-safe `Source:`
handling, `Edition:` preservation, and deciding the existence branch OUTSIDE any write-performing
try/catch so a mid-repair error can never fall through to a scaffold overwrite). Proved the fix
against `cp -R` copies of BOTH reference games — `seven` (wrapped-prose `Source:`) and
`one-two-punch` (no `Source:` line at all) — with `computeVerificationScope()` flipping
`pre-provenance-project` → `full` for both, `Edition:` preserved byte-identical, and both originals
confirmed byte-identical before/after. Documented (in `173-PROOF.md`) a refuted plan hedge:
`chunk-provenance-status`'s project-level `pre-provenance` state does not flip from this fix alone
— that field tracks whether any chunk has ever had `chunk-check` run on it, unrelated to
`INDEX.md`'s header; `computeVerificationScope()` is the actual authoritative payoff check. Full
suite 3525/3525, lint zero errors in `src/cli/`. See
`.planning/phases/173-verify-pipeline-core/173-01-SUMMARY.md`.

Phase 172 (source-free-conformance-checks) is complete — 5/5 plans, ready for verification.

`172-04-PLAN.md` registered both CHECK-03/CHECK-05 commands on the CLI surface next to
`chunk-provenance-status`: `boardsmith trace-check [--project <dir>] [--json]` and
`boardsmith drift-check [--project <dir>] [--json]`, no mode/repair flag, matching the existing
registration shape exactly. Pinned 172-CONTEXT.md decision 6 — findings exit 0, tool failure exits
non-zero — with `src/cli/cli-conformance-commands.test.ts`, the first test in this repo to spawn
`node bin/boardsmith.js` as a REAL child process rather than call a command function in-process
(the only way to exercise `cli.ts`'s `parseAsync()`/top-level-catch exit-code path for real). 4
spawns: `trace-check` against a fixture with an untested claim (exit 0, JSON, `claim-untested`
finding present), `trace-check` against a non-bs-project (exit 1, single clean line naming the dir
and `--project`, no stack frame/`.ts:` ref/repo `src/` path), `drift-check` against a real
two-commit git fixture with a changed manifest file (exit 0, JSON, `chunk-code-drifted` finding
present), `drift-check` against a non-git directory (exit 1, same message discipline). All fixture
projects confirmed byte-identical before/after. Zero changes needed to 172-02's/172-03's
already-implemented command logic — this plan was pure CLI wiring + proof. `npm test`: 3503/3503.
The CLI surface plan 172-05's real-game proof harness invokes now exists and works. See
`.planning/phases/172-source-free-conformance-checks/172-04-SUMMARY.md`.

`171-07-PLAN.md` is the phase's PROC-01 record: `chunk-check` and `chunk-provenance-status` proven
end-to-end against COPIES of both real reference games (`~/BoardSmithGames/seven`, read-only,
confirmed clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd` before AND after; `one-two-punch`,
confirmed byte-identical before/after despite pre-existing unrelated dirty state). All 29
pre-existing chunks (12 + 17) classified `unknown` before any run, `full: 0`/`codeConformanceOnly: 0`
both games, and every single one flagged `verifiedWithoutProvenance` — the phase's stated
ready-made proof target, demonstrated exactly as predicted. Every `chunk-check` run on every real
chunk in both games landed on `Scope: code-conformance-only` / `Reason: pre-provenance-project` —
the `source-missing` STOP condition never fired, confirming the precedence order is correct on
live data. 11/12 one-two-punch and 15/17 seven chunks resolved at least one real cited slice on
real prose; one recorded hash independently cross-checked with `shasum -a 256` and matched
exactly. Both games' re-runs were idempotent (exit 0, `changed: false`, byte-identical files).
Post-run status showed `unknown: 0`, `verifiedWithoutProvenance: []`, `projectProvenanceState:
"complete"` for both. F-1 edition normalisation confirmed on live data: one-two-punch's and
seven's different raw `Edition:` free text both collapsed into the single
`"not stated in the rulebook"` byEdition bucket. **Recorded honestly, not glossed over:** the
plan anticipated seven's live prose would exercise the genuinely-ambiguous bare `rulebook/01`
shorthand (seven has two `01-`-prefixed slices) — it does not; every citation in seven's real
chunks uses full filenames, and the shorthand only appears live in one-two-punch, where it is
unambiguous (only one `01-` slice there). The resolver's ambiguity-handling logic remains proven
by its Wave-0 unit fixture, not by this run. `npm test` — 3407/3407, matching the phase baseline
exactly (no source touched; this is a proof-only plan). Filed F-3 (`boardsmith.json`'s stub
`description`/`playtime` ownership after `init`) as a todo. See
`.planning/phases/171-provenance-recording/171-PROOF.md` and
`.planning/phases/171-provenance-recording/171-07-SUMMARY.md`.

`171-06-PLAN.md` wired the two commands from plans 04/05 into the actual pipeline: CHUNK.template.md
now scaffolds the machine-owned `## Verified Against` fence (byte-identical to the writer's
exported constants) into every new chunk; `close.md`'s Bookkeeping Sequence gained item 3, "Record
what this chunk was verified against," which runs `boardsmith chunk-check <slug>` right after the
verified-commit-hash item, renumbering the sequence to six items — `playtest.md`'s light path still
cites the sequence BY NAME rather than duplicating the chunk-check text, so the two close paths
cannot drift apart. Fixed the plan-check blocker along the way: inserting the new item shifted
ledger-reconciliation from item 4 to item 5, and `state-machine.md`'s two ordinal citations were
updated to match (its unrelated "consistency-check item 4" citation, a different sequence entirely,
was left untouched — verified by content match, not line number, since this task's own edits shift
lines above it). Added a derived-numbering drift guard to `build-chunk.test.ts` that parses
close.md's real Bookkeeping Sequence at test time and validates every "item N" citation against it,
so a future renumber fails the suite automatically. RED-first observation caught a real design bug
in the guard's own overlap heuristic TWICE before it worked (a fixed-width text window was sweeping
in vocabulary from neighboring duties in the same enumerating sentence, producing false passes on
genuinely stale citations) — both fixes documented inline. `/bs-check-status` gained item 8,
"Verification provenance and drift," formatting `boardsmith chunk-provenance-status --json` and
explicitly consuming its `projectProvenanceState` field rather than re-deriving severity, so a
pre-provenance project (both reference games, 100% of chunks flagged) reports as informational, not
an alarm. Every test added proves the instruction EXISTS, never that a live session follows it — the
load-bearing guarantees remain the machine-owned fence and plan 05's `verifiedWithoutProvenance`
flag, exactly as `171-VALIDATION.md`'s tiering states. Found and logged (not fixed, out of scope) 6
pre-existing `chunk-provenance.test.ts` `chunk-check` failures bisected to `171-04`, unrelated to
this plan's file scope. Full suite: 3400/3406 passed (6 known pre-existing failures net of this
plan's own 12 new passing tests). See `.planning/phases/171-provenance-recording/171-06-SUMMARY.md`.

`171-05-PLAN.md` landed PROV-03's deliverable: `boardsmith chunk-provenance-status --json`, a
read-only aggregation over every chunk's `## Verified Against` block. THE THREE STATES, NEVER TWO:
`full`, `code-conformance-only`, and `unknown` — a chunk verified before this phase existed carries
no block at all, and reporting that as `code-conformance-only` would assert a scope determination
that was never made. `parseVerifiedAgainst()` distinguishes "never run" (no heading,
`blockMalformed: false`) from "structurally damaged" (heading present, a fence or required label
missing, `blockMalformed: true`) — both are `state: unknown`, but a partial parse is never returned
as valid (T-171-17). `verifiedWithoutProvenance` — the load-bearing enforcement half from CONTEXT.md
decision 6 — flags any chunk whose `Status:` starts with `verified` (covering both `verified` and
`verified (user-waived)`) but whose state is `unknown`; `built` chunks are correctly excluded since
they never claimed verification. Composition documented explicitly: `unknown` and
`verifiedWithoutProvenance` are NOT mutually exclusive by design — a pre-existing project's verified
chunks are correctly BOTH `unknown` AND flagged, which is exactly plan 07's stated proof target (all
29 chunks across both reference games), not a false alarm. Grouping (`byEdition`/`bySkillsTreeHash`/
`byBoardsmithVersion`) re-applies `normalizeEdition()` at READ time so pre-F-1/hand-edited free text
still collapses to one bucket even though `chunk-check` already normalizes on write (RESEARCH.md
Pitfall 3). Read-only, pinned by a before/after whole-project byte-hash test — no `writeFile` call is
reachable from `chunkProvenanceStatusCommand`. RED-first: 14 new tests failed identically with
`chunkProvenanceStatusCommand is not a function` before Task 2. Full suite: 3390 passed (was 3376).
`~/BoardSmithGames/seven` confirmed unmodified. See
`.planning/phases/171-provenance-recording/171-05-SUMMARY.md`.

`171-04-PLAN.md` landed PROV-01's deliverable: `boardsmith chunk-check <slug>` writes/repairs a
fenced, machine-owned `## Verified Against` block into `chunks/<slug>/CHUNK.md` — scope, edition,
rulebook source hash (the edition anchor), BoardSmith version, skills-tree hash, a cited-slice
SHA-256 table, and any unresolved citations recorded verbatim. `ingestCheckCommand` was the
precedent copied line-for-line: writes strictly between `VERIFIED_AGAINST_BEGIN`/`END` (a DISTINCT
fence pair from `GAPS_BEGIN`/`END` per CONTEXT.md decision 3), throws an actionable error naming
both markers when a fence is missing (never silently re-fences), and sets `process.exitCode = 1`
(never throws) on the repair-then-fail terminal path so an immediate re-run passes. RED-first: 11
new tests failed with `chunkCheckCommand is not a function` before Task 2. GREEN found a real bug
(Rule 1): citation scanning must skip any existing Verified Against section, or the block's own
explanatory prose about the rulebook index gets treated as a self-referential unresolved citation
and a second unchanged run never settles to `process.exitCode === undefined`. Verifying Task 3's own
"no stack trace" acceptance criterion surfaced a second, repo-wide bug (Rule 1/2): `program.parse()`
doesn't await async action handlers, so ANY thrown Error in ANY command (verified this pre-existed
for `ingest-archive` too) surfaced a raw unhandled-rejection stack trace with internal paths — fixed
once, at the root, via `program.parseAsync()` wrapped in a top-level `try`/`catch` in `cli.ts`. Full
suite: 3376 passed (was 3365). `~/BoardSmithGames/seven` confirmed unmodified (demo used a
scratchpad temp fixture, deleted after). See
`.planning/phases/171-provenance-recording/171-04-SUMMARY.md`.

`171-03-PLAN.md` built the two pure functions at the heart of PROV-02 and PROV-01, no CLI wiring
yet: `computeVerificationScope(projectDir)` is a single-parameter, disk-only computation with a
top-to-bottom early-return precedence over five enumerated reason codes (`no-rulebook-project` →
`index-missing` → `pre-provenance-project` → `source-missing` → `source-hash-mismatch` → `full`).
`full` requires BOTH the archived file's existence AND its SHA-256 matching `INDEX.md`'s
`Source hash:` — pinned by two dedicated invariant tests (deleted file, rewritten hash) — and no
caller-supplied override exists anywhere (CONTEXT.md decision 1; the API-shape test greps the
source for `assumeFull`/`forceScope`/a scope parameter and asserts arity 1).
`resolveCitedSlices(chunkText, sliceFilenames)` recovers a chunk's cited rulebook slices from its
existing prose, resolving both full-filename and `rulebook/02 p.4` shorthand citations against the
`rulebook/` DIRECTORY LISTING (not `INDEX.md`'s `## Slices` table — one-two-punch's real INDEX.md
has no such heading). Every fixture citation string is copied verbatim from real one-two-punch
`CHUNK.md` prose; the ambiguous-shorthand fixture reproduces `seven`'s genuine two-`01-`-slice
collision (`01-definitions-and-components.md` / `01-overview-setup-and-play.md`) and pins that it
resolves to NOTHING, recorded verbatim, never guessed — the PROV-01 analogue of Phase 170's
gap-dropping defect. Full suite: 3365 passed (was 3344). Both reference games' real `rulebook/`
state (no `Source:`/`Source hash:` lines at all) computes `pre-provenance-project`, matching this
plan's own prediction. See `.planning/phases/171-provenance-recording/171-03-SUMMARY.md`.

`171-02-PLAN.md` built the two remaining provenance INPUTS PROV-01 needs beyond citation/scope:
`readBoardsmithVersion()` fixes `boardsmith --version`'s hardcoded `.version('0.0.1')` lie
(`src/cli/cli.ts:27`) by walking up to the repo's own `package.json` and returning its real
`version` field (throws, never falls back, when none is found). `hashSkillsTree()` adds the
content hash CONTEXT.md decision 7 requires alongside it: Phase 170 ran fourteen `--local` installs
that shared one unmoving package version while the skill text changed almost every run, so version
alone would have stamped them all identical. `hashSkillsTree()` reduces the installer-owned `bs-`
skills tree (5 `bs-<name>/` dirs + `bs-shared/`) to one SHA-256 digest over path+content, sorted by
path, and returns the honest `SKILLS_TREE_ABSENT` (`'not installed'`) sentinel rather than a
placeholder hash when no tree is found. `package.json`'s version field itself was read but never
bumped (decision 9 — versioning policy stays out of scope). Full suite: 3344 passed (was 3332).
PROV-01 is STILL NOT complete — this plan closed the version+hash inputs only; the `## Verified
Against` block itself (plans 03-06) is still pending. See
`.planning/phases/171-provenance-recording/171-02-SUMMARY.md`.

`171-01-PLAN.md` fixed F-1 (`--edition` free text displacing the `EDITION_UNKNOWN` sentinel):
`normalizeEdition()` + `EDITION_EMPTY_LEXICON` now collapse recognisably-empty edition strings to
the sentinel at both `INDEX.md` write sites, preserving the designer's original wording on a
separate un-parsed `Edition note:` line (`HEADER_LABELS` untouched — byte-identical). Both
reference games' live `Edition:` strings verified to normalise correctly as named test fixtures.
`~/BoardSmithGames/seven` confirmed unmodified (read-only inspection only) before and after. Full
suite: 3332 passed (was 3323). See `.planning/phases/171-provenance-recording/171-01-SUMMARY.md`.

Phase: 170 (Ingest Contract Upgrade) — **COMPLETE**.

The `170-10` PROC-01 human gate ran twice on 2026-07-28. Run 1 FAILED (e/h/i); Run 2, against the
repaired contract, PASSED all of (a)-(i) **on the as-left tree with no repair applied**. Record:
`.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN-2.md`; disposition in `170-10-SUMMARY.md`.
Read `170-MECHANISMS.md` for the phase's fourteen-attempt history and which artifacts are superseded.

PROC-01/02 and INGEST-01..04 are now **Complete** in REQUIREMENTS.md.

**The Run 1 root cause, which matters for 171-179:** `boardsmith init` installs a pre-commit hook
that runs ingest synthesis, and the bs- build protocol commits at every chunk step -- but
`/bs-ingest-rules` has no commit in it at all. So the hook had never fired at the end of a real
ingest. The orchestrator hand-wrote `## Open Rules Gaps` instead: 2 entries against 5 slice markers,
undetectable by reading. Fixes (`92f88bb9`, `c32bc184`): the section is now fenced machine-owned, and
`boardsmith ingest-check` repairs-then-exits-non-zero from `/bs-build-chunk` Step 0.

**Standing finding, unchanged and now twice-confirmed:** skill text conveys JUDGMENT reliably and
MECHANICS not at all. Sort every remaining requirement into those two buckets before planning;
mechanical ones need code (a command, a flag that errors, a hook, a fence), not better wording.
Run 2's fence worked precisely because it removed the choice -- the session had a real motive to
tidy the gaps section and declined *because it was marked machine-owned*.

**The harness must no longer gate a manual pass.** It certified a broken contract twice (three
single-turn 10/10s before a 1/10 human run; 11/11 immediately before Run 1's three failures), and
its `assert` step was manufacturing the commit that made one of those greens possible. It may
inform. If it corroborates the next manual gate that is the first time ever; if it disagrees again,
retire it rather than patch it a third time. Governance rule still stands: **a green at <=2 turns is
an INVALID RUN.**

New surface: `boardsmith init --rulebook/--without-rulebook/--edition`, `boardsmith ingest-archive`,
`boardsmith ingest-gaps`, `boardsmith ingest-relabel`, `boardsmith ingest-check`,
`src/cli/lib/ingest-hook.ts`, `scripts/ingest-harness/`. Also implemented: the optional
`/bs-ingest-rules <path>` argument (`.planning/todos/pending/bs-ingest-rules-optional-path-arg.md`
-- can be closed).

**Three findings carried into 171+:** F-1 `--edition` lets a free-text paraphrase displace the
machine-checkable `EDITION_UNKNOWN` sentinel, and PROV reads that field (fix in 171). F-2 the relabel
lexicon misses *negative* visual claims (defer to Phase 177 / CHECK-04). F-3 two runs made opposite
scope calls on `boardsmith.json`'s stub description/playtime -- ownership after `init` is unstated.

Last activity: 2026-07-28

## Milestones

**Completed:**

- v0.1 Large File Refactoring (Phases 1-4) -- shipped 2026-01-08
- v0.2 Concerns Cleanup (Phases 5-8) -- shipped 2026-01-09
- v0.3 Flow Engine Docs (Phase 9) -- shipped 2026-01-09
- v0.4 Public API Docs (Phase 10) -- shipped 2026-01-09
- v0.5 ESLint No-Shadow (Phase 11) -- shipped 2026-01-09
- v0.6 Players in Element Tree (Phases 12-13) -- shipped 2026-01-09
- v0.7 Condition Tracing Refactor (Phases 14-16) -- shipped 2026-01-10
- v0.8 HMR Reliability (Phases 17-19) -- shipped 2026-01-11
- v0.9 Parallel AI Training (Phases 20-23) -- shipped 2026-01-13
- v1.0 AI System Overhaul (Phases 24-28.1) -- shipped 2026-01-15
- v1.1 MCTS Strategy Improvements (Phases 29-36) -- shipped 2026-01-16
- v1.2 Local Tarballs (Phases 37-38) -- shipped 2026-01-18
- v2.0 Collapse the Monorepo (Phases 39-46) -- shipped 2026-01-19
- v2.1 Design-Game Skill Redesign (Phases 47-50) -- shipped 2026-01-19
- v2.2 Game Design Aspects (Phases 51-53) -- shipped 2026-01-21
- v2.3 Nomenclature Standardization (Phases 54-58) -- shipped 2026-01-22
- v2.4 Animation Event System (Phases 59-63) -- shipped 2026-01-22
- v2.5 Player Colors Refactor (Phases 64-68) -- shipped 2026-01-25
- v2.6 Code Consolidation (post-mortem driven) -- shipped 2026-01-29
- v2.7 Dead Code & Code Smell Cleanup (Phases 69-74) -- shipped 2026-02-02
- v2.8 Disabled Selections (Phases 75-79) -- shipped 2026-02-06
- v2.9 Theatre View (Phases 80-84) -- shipped 2026-02-07
- v3.0 Animation Timeline (Phases 85-90) -- shipped 2026-02-08
- v3.1 Dynamic Auto-UI (Phases 91-96) -- shipped 2026-06-22
- v4.0 UI Redesign (Slate) (Phases 97-103) -- shipped 2026-06-23
- v4.1 Tutorial Primitives (Checkers) (Phases 104-111) -- shipped 2026-06-30
- v4.2 Tutorial Primitives — Go Fish & Docs (Phases 112-115) -- shipped 2026-06-30
- v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools (Phases 116-122) -- shipped 2026-07-01
- v4.4 Agent-Ergonomics Gaps (Audit Fixes) (Phases 123-130) -- shipped 2026-07-02
- v4.5 Pit of Success Hardening (Audit #3 Fixes) (Phases 131-139) -- shipped 2026-07-03

**Completed:**

- v4.6 BS Skills (Rulebook-Driven Game Building) (Phases 140-151) -- shipped 2026-07-05 (playtest follow-up re-closed same day, `v4.6.1`)
- v4.7 Playtest Follow-Up Fixes (Phases 152-154) -- shipped 2026-07-06
- v4.8 Battery Post-Mortem Fixes (Phases 155-169) -- shipped 2026-07-22 (14/15 phases; Phase 165/D32 deferred-to-platform). Closed the 5-game build-battery post-mortem (D1–D31 + skills defects + autonomy rewrite + seed-to-state spike + cross-repo de-workaround sweep). Library 3141 green; all 5 game repos green. Tech-debt pass resolved hidden-zone D24 game migration + v4.8-WR01 + v4.8-MCTS-UNDO.

## Deferred Items

Items acknowledged and deferred at **v4.8** milestone close on 2026-07-22:

| Category | Item | Status | Note |
|----------|------|--------|------|
| phase | Phase 165 / PLATLOG-01 (D32) | deferred-to-platform | `[DRAWDROP]` logging proven absent from this library repo AND all 5 game repos (grep=0); lives only in the deployed platform (web front-end + Convex `pieces:*`). "Filed, not patched" per the lab finding. Re-scope to the platform repo. |
| review-warning | v4.8-SIM-LASTACTOR-UNDO | deferred | Last-actor of a simultaneous step loses its per-seat undo window one tick early; bleeds into the whole-step-undo semantics the user explicitly DECLINED. UX edge, no data loss. Revisit only if playtest surfaces it. |
| game-rewrite | doom-machine D9 native-multiSelect | deferred | The single-select-enumeration workaround works; rewriting to native panel multiSelect is a risky game-logic change. Deferred by design (conservative sweep). |
| game-wip | lanternfall AI (untracked) | not-owned | `src/rules/ai.ts` + `ai-smoke.test.ts` are uncommitted pre-existing WIP on lanternfall master; type-checks + smoke passes, but committing/finishing them is not this run's to own. |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing carry-forward (non-blocking) |
| todo | dev-host-debug-toggle-panel-not-opening | open | Pre-existing carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing carry-forward (non-blocking) |
| todo | v4-slate-token-and-a11y-polish | open | Pre-existing carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Resolved this session's post-audit tech-debt pass (NOT deferred): game-side hidden-zone D24/SPACE-03 migration (doom 405/405, BoardSmithGames2/seven 374/374), seven BSR-7 stale test (205/205), library v4.8-WR01 + v4.8-MCTS-UNDO (suite 3141). All 6 repos fully green.

---

Items acknowledged and deferred at v4.1 milestone close on 2026-06-30:

| Category | Item | Status | Note |
|----------|------|--------|------|
| verification | 108-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): action help demonstrated live + user-approved |
| verification | 109-VERIFICATION.md | human_needed | Closed by DEMO-01 (Phase 110): checkers tutorial demonstrated live + user-approved |
| uat | 108-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| uat | 109-HUMAN-UAT.md | partial | Superseded by DEMO-01 live walkthrough |
| todo | dev-host-ai-open-seat-not-auto-playing | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | dev-standalone-shell-height-gap | open | Pre-existing v4.0 carry-forward (non-blocking) |
| todo | (third pending todo) | open | Pre-existing v4.0 carry-forward (non-blocking) |
| debug | knowledge-base | reference | Debug knowledge-base file, not an active session |

Backlog for a future cribbage (v2 CRIB) milestone: R-05 (suppress Undo during guided tutorial steps), R-12 (strategy tutorial track), pit-of-success lint/dev-warning when a custom board omits `anchorAttrs`. Repo-wide: 2 pre-existing eslint no-shadow errors (useFlyingElements.ts) + tsc test-file looseness — future cleanup pass.

Carried forward from v4.0 (still deferred, separate repo): ShufflewickPub host skin (HOST-01..04).

**Still deferred at v4.7 close (2026-07-06):** the same pre-existing open artifacts remain non-blocking backlog — `knowledge-base` (stale debug/reference file), and todos `dev-host-ai-open-seat-not-auto-playing`, `dev-host-debug-toggle-panel-not-opening`, `dev-standalone-shell-height-gap`, `v4-slate-token-and-a11y-polish`. None were in v4.7 scope (the milestone deferred the AI insta-acknowledge race and broader dev-host work by design). Note: the dev-host-ai-open-seat and standalone-shell-height todos are the same v4.0 carry-forwards listed above.

**New backlog opened during v4.8 (2026-07-20):**

- **v4.8-WR01 (Phase 159 code-review Warning) — RESOLVED 2026-07-22:** Root cause was NOT missing metadata plumbing — it was a dead-data bug. `PickHandler.getPickChoices()` (the per-step "advance to next pick" endpoint) already resolves a function-valued `multiSelect` against the REAL accumulated `currentArgs` and returns it; `useActionController.fetchChoicesForPick()` already fetches it on every selection-step advance and stores it in `pickSnapshot.multiSelect`. But the three client-side "what's the effective multiSelect bound" computeds (`useActionController`'s internal `resolveMultiSelectConfig` used by `fill()`/`toggleMultiSelect()`, `ActionPanel.vue`'s `currentMultiSelect`, and `useBoardActionBridge.ts`'s `currentMultiSelect`) never read that snapshot — each independently fell through to the STATIC `selection.multiSelect` field baked once at `buildActionMetadata()` time with `knownArgs: {}`. No panel dynamic-refresh rework was needed: the correct value was already being fetched and stored, just never consulted. Fix: extracted one shared `resolveMultiSelectConfig(selection, currentArgs, pickSnapshot)` helper (`src/ui/composables/actionControllerHelpers.ts`) that prefers `pickSnapshot.multiSelect` (server-resolved, real args) over the static field, and pointed all three call sites at it — single source of truth, matching the engine-side `resolveMultiSelect` (AI-01/D9) guarantee. `multiSelectByDependentValue` (the explicitly-declared dependent case, already correct) is unaffected — it's still resolved first, client-side. RED-first regression test in `src/ui/composables/useActionController.picks.test.ts` ("function-valued multiSelect reading a prior sibling selection (v4.8-WR01)") reproduces the bug (pre-fix: the stale bound `max:1` even auto-confirmed the multiSelect draft after a single toggle, discarding the other two) and passes post-fix. Suite: 3141/3141 green (was 3140 baseline + 1 new test).
- **v4.8-MCTS-UNDO (surfaced by Phase 159-03, out of scope there) — RESOLVED 2026-07-22:** Root cause (proven via two RED-first unit tests in `src/ai/mcts-undo-bookkeeping.test.ts`): `undoCommands` only reverts commands recorded in `game.commandHistory`; it never restores the flow engine's own private `awaitingPlayers[].completed` bookkeeping (mutated in place by `resumeSimultaneousAction`, never a `GameCommand`) or the plain-property mutations `game.finish()`/`continueFlow`'s terminal path make (`phase`, `settings.winners`). So after a simulated branch that finishes a game or completes a simultaneous decider, that bookkeeping stuck and the next EXPAND of a root sibling was wrongly rejected as a no-op (decider "already completed" / game "already finished"). Fix: each `MCTSNode` now also captures `phase`/`winners` at creation (`src/ai/types.ts`); `backpropagateWithUndo` (`src/ai/mcts-bot.ts`) resyncs `searchGame`'s flow engine + phase/winners to the ROOT node's captured state once per backpropagation via the existing `restoreFlowState` machinery (new `restoreNodeBookkeeping` helper) — cheaper than a full per-node snapshot restore since SELECT always re-derives intermediate states by replaying real moves from a correctly-restored root. Investigation also found (and left as a separate, pre-existing, out-of-scope limitation, already documented in `mcts-restore.test.ts`) that ordinary element mutations (`Piece.putInto`, `.create()`) are never recorded in `commandHistory` at all — `undoCommands`'s element-tree revert is effectively unreachable for typical games; only the plain-property/flow-bookkeeping leak in THIS ticket's scope was fixed. 159's `HiddenInfoGame`/`objectives` fixture comment updated (not removed — it also serves the unrelated hidden-info exploitability test); the 159-07 simultaneous-leak fixture comment updated to note the undo-bug it used to also dodge is now fixed. Suite: 3140/3140 green (was 3138 baseline + 2 new tests).
- **v4.8-SIM-LASTACTOR-UNDO (Phase 160 code-review Warning, deferred):** the seat whose action COMPLETES a simultaneous step loses its per-seat undo window one tick sooner than earlier co-deciders — on `allDone` the engine clears `awaitingPlayers` to `[]`, so `computeUndoEligibility` immediately falls back to the sequential branch for that last actor. This is entangled with the whole-step-undo semantics the user explicitly DECLINED (per-seat was chosen); "undo after the step already completed" bleeds into that declined territory. Asymmetric UX edge, not a correctness bug; no data loss. Revisit only if playtest surfaces it.

## Accumulated Context

### Roadmap Evolution

- v4.9 roadmap defined (2026-07-27): 10 phases (170-179), 25 requirements (PROC, INGEST, PROV, VERIFY, CHECK, TEST) derived from direct inspection of the two bs-built reference games (`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`). Continues phase numbering from v4.8 (ended at 169).
  - Phase 170 (Ingest Contract Upgrade) bundles PROC-01/PROC-02 with INGEST-01..04 — the milestone's verify-first process discipline is established alongside the archived-source/Visual-Derived-split/Open-Rules-Gaps prerequisites everything downstream reads, rather than given its own phase (PROC items are a recurring discipline, not standalone deliverable).
  - Phase 172 (CHECK-03 traceability sweep + CHECK-05 code drift) is deliberately sequenced right after Provenance (171) and before the verify pipeline itself — both checks need neither the ingest changes nor re-transcription, so they land early and are proven immediately against seven/one-two-punch, de-risking the rest of the milestone per the roadmapper's phasing guidance.
  - Phase 174 (VERIFY-03, the 4-way cosmetic/sharper/contradictory/source-changed classifier) is its own single-requirement phase — the highest-risk item in the milestone (two good-faith transcriptions of the same page differ in wording almost everywhere; an over-flagging classifier makes the skill unusable on its second run) gets room to be tuned and validated against real pass-1-vs-pass-2 output rather than being buried inside a larger phase.
  - Phase 177 (CHECK-04 derived-line re-derivation) is split out from the Phase 172 source-free-checks phase because it depends on Phase 170's Derived/Visual split (needs separable rule-bearing lines), unlike CHECK-03/CHECK-05 which depend on neither ingest nor re-transcription.
  - Phase 178 groups CHECK-06 (worked-example replay in verify) with TEST-01 (build/test.md worked-example test generation) since both derive executable tests from the same worked-example source and should share derivation logic rather than duplicate it.
  - Phase 179 (VERIFY-09 source-free mode) is the capstone, depending on Phase 172's checks, Phase 177's check, and Phase 171's PROV-02 scope-recording — it wires the source-free checks together with honest scope reporting.
  - Coverage: 25/25 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.8 roadmap defined (2026-07-20): 15 phases (155–169), 40 requirements (PROC, UNDO, AUTOEXEC, ENDGAME, ZOOM, AI, SIM, DEVHOST, TOOL, SPACE, LIBX, PLATLOG, SKILLDEF, SKILLAUTO, FEAT, SWEEP) derived from the 5-game build-battery post-mortem (`~/BoardSmithLab/findings/BATTERY-POST-MORTEM.md`). Continues phase numbering from v4.7 (ended at 154). Covers all 32 deduped library/platform defects (Part A, D1–D32), both filed skills defects + the autonomy rewrite (Part B), the three platform features (C.1→168, C.2→159, C.3→164+166), and the post-fix game de-workaround sweep (Part E #6→169). Part G (lab methodology) deliberately excluded — belongs to the lab, not this repo.
  - Phases ordered by the Part A priority ranking: multi-game defects first (155 D1/D2, 156 D7, 157 D10/D11, 158 D12), then AI-blocking (159 D9/D8), then simultaneous-step + single-game/minor (160–165), then skills (166–167), feature spike (168), and the de-workaround sweep last (169, spans the game repos not the library). D1+D2 co-located in Phase 155 because the post-mortem notes one fix largely closes both (shared root cause). C.2 folded into Phase 159 (it overlaps D9's panel/enumeration work); C.3 split library-half (164 LIBX-01) + skills-half (166 SKILLDEF-03).
  - Every fix phase bakes in PROC-01 (fix → write tests → adversarially verify → close); PROC-02 preserves Part D disciplines through the autonomy rewrite. Coverage: 40/40 requirements mapped, D1–D32 all covered, no orphans (see REQUIREMENTS.md Traceability).

- v4.7 roadmap defined (2026-07-06): 3 phases (152-154), 5 requirements (ASSET, DEVHOST, VENDOR) derived directly from v4.6's human-playtest follow-ups (DEF-A asset gap, DEF-C dev-host reconnect desync, DEF-B propagation to MERC). Continues phase numbering from v4.6 (ended at Phase 151).
- Phase 152 (ASSET-01/02) and Phase 153 (DEVHOST-01/02) are independent of each other — both fix distinct gaps surfaced by the same playtest — but are numbered in the milestone's suggested order.
- Phase 154 (VENDOR-01) depends on both 152 and 153 so the MERC re-vendor carries every v4.7 fix, not just the already-landed DEF-B fix.
- Coverage: 5/5 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.6 roadmap defined (2026-07-04): 10 phases (140-149), 34 requirements (LIB, TMPL, INGEST, BUILD, UIQ, STAT, DIST, VAL) derived from `.planning/bs-skills-plan.md`. Continues phase numbering from v4.5 (ended at 139).
- Phase 140 (LIB: `useAnnouncer()`) and Phase 141 (TMPL: the six file templates) are both independent prerequisites — everything downstream consumes one or both, but they don't depend on each other, so they're sequenced first per the plan's own "Build Order" section.
- Phase 142 (`/bs-ingest-rules`) is the largest new-thinking surface (chunking, INDEX, visual survey, sketch heuristic, interview fallback, scaffold) and must exist before any chunk work can start.
- `/bs-build-chunk` (BUILD-01..13) is split across four phases (143-146) along the plan's own mandated session-handoff seams — {investigate+redteam+ask}, {build+test}, {audit+repair}, {playtest+revise+close} — rather than treated as one monolithic phase, keeping each phase independently reviewable at fine granularity. UI/a11y requirements (UIQ-01..05) are folded into the build-chunk phase whose step they gate (ask→UIQ-01, build/test→UIQ-02/03, audit→UIQ-04, final-acceptance→UIQ-05) rather than given a separate UI phase, since they're enforcement mechanisms bolted onto build-chunk's own steps, not standalone deliverables.
- Phase 147 (STAT: `/bs-check-status`, `/bs-insert-chunk`) depends on both ingest (142) and the full build-chunk engine (146) since it reads/edits the same sketch/chunk state those write.
- Phase 148 (DIST: installer + `/bs-generate-ai` rename) comes after all five skills exist, since the installer bundles all of them.
- Phase 149 (VAL: end-to-end dry-run) is last, proving the whole pipeline against a reference game (Hex or Go Fish) before the skills are pointed at a real designer.
- Coverage: 34/34 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

- v4.5 roadmap defined (2026-07-02): 9 phases (131-139), 42 requirements (PROC, SEC, ENG, RST, SESS, UIX, CLIX, SDK, TST, DOCX, GAMES) derived from 38 confirmed audit findings (`boardsmith-audit-report-3.html`, F1-F38). Continues phase numbering from v4.4 (ended at 130).
- Phase 131 (SEC+RST serialization/restore fidelity) is sequenced first: SEC-01/F1/F7 (the critical finding — zone visibility lost on every snapshot restore) and its cluster (SEC-02..04, RST-01/02) all share one root cause — constructor-applied config (`_zoneVisibility`, event handlers, `teachingDisabled`) that `loadSerializedState`/`GameSession.restore` silently discard. Fixed together at the serialization layer, not spot-patched. PROC-01/PROC-02 (verify-first discipline + regression-test-per-fix) are tracked here for traceability but apply fractally to every phase.
- Phase 132 (ENG element/builder safety) and Phase 133 (ENG flow/action validation) split the 8 ENG findings by subsystem — element-tree/builder mutation (putInto, resolveArgs, forEach, build()) vs. flow control/validation (eachPlayer, simultaneousActionStep, multiSelect, switchOn). Findings are mutually independent per audit guidance; split keeps each phase reviewable.
- Phase 134 (UI & Session Interaction Guardrails) groups SESS-01 with all 5 UIX findings — both are "silent wrong-path-that-looks-right" footguns in developer-facing composables/session accessors, distinct from the CLI/SDK footguns in Phases 135/136.
- Phase 135 (CLIX) and Phase 136 (SDK) are separate phases despite both being "config/protocol correctness" work — CLI-surface findings (dev.ts/validate.ts/init.ts) vs. client-SDK findings (game-connection.ts/client.ts/types.ts) touch disjoint subsystems with no shared root cause.
- Phase 137 (TST) is a small, self-contained phase — TestGame.doAction/seed defaults, matching the library's existing determinism doctrine established in v4.4 Phase 123.
- Phase 138 (GAMES cross-repo migration) is sequenced after all API-changing phases (131-137) are stable, mirroring v4.3 Phase 121 and v4.4 Phase 129.
- Phase 139 (DOCX audit) is last: fixes the 3 pure-docs findings (F11/F14/F20) and grep-verifies every doc touched by phases 131-138 (DOCX-04), mirroring v4.4 Phase 130's doc-verifier pass.
- Coverage: 42/42 requirements mapped, no orphans, no duplicates (see REQUIREMENTS.md Traceability table).

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting current work:

- [v4.5 roadmap]: SEC+RST cluster fixed together at the serialization layer (Phase 131) rather than spot-patched per finding — shared root cause (constructor-applied config discarded by loadSerializedState/restore).
- [v4.5 roadmap]: ENG findings split across two phases by subsystem (element/builder vs. flow/action) rather than one large engine phase — keeps fine-granularity phases independently reviewable.
- [v4.5 roadmap]: GAMES migration sequenced after ALL API-changing phases (131-137), not just some — every prior phase can introduce breaking changes per the No Backward Compatibility rule.
- [Phase 131]: PROC-01 verification gate: all 7 findings (F1,F2,F7,F8,F10,F15,F16) confirmed LEGITIMATE — Independent file:line re-trace before any fix; stateless-ops.ts explicitly confirmed to need no fix for F15
- [Phase 131-02]: Zone-visibility restore tests must use a plain Space (not Deck/Hand): those classes reapply their own constructor default on restore, masking the F1/F7 bug for the common case
- [Phase 131]: debugEnabled is GameSession-consumer-only (not persisted/CLI-wired, Pitfall 2); added GameSession.displayName/teachingDisabled getters (Rule 2) to make the RST-02 persistence fix observable/testable — Session-scoped host-policy fields mirror the aiConfig round-trip pattern; debug gating opt-in stays scoped to trusted GameSession consumers, matching 131-RESEARCH.md Pitfall 2
- [Phase 131-04]: visibleAttributes filtering lives inside filterElement's existing fallthrough (single chokepoint, no parallel filter); state.players derived from truthView via findElementJSONById instead of raw player.toJSON()
- [Phase 131]: Event handler identity key = class name + branch() (tree index path); stable because fromJSON rebuilds children in the same order they were serialized.
- [Phase 132-01]: PROC-01 gate: all four findings (F3/ENG-01, F12/ENG-05, F13/ENG-06, F28/ENG-08) independently re-verified LEGITIMATE against current source before any fix
- [Phase 132-02]: Self-move error message includes the word 'descendant' (trivially its own descendant) so self and true-descendant cases share one actionable-error shape and one test regex
- [Phase 132-02]: ENG-01 containment guard kept fully separate from WR-03 (not merged) -- preserves WR-03's distinct dev-only detached-destination diagnostic purpose
- [Phase 132-03]: resolveArgs second pass narrowed to isSerializedElement only, no bare-number coercion outside declared selections; first pass untouched
- [Phase 132-03]: collect fixtures updated to resolve followUp ids explicitly via game.getElementById, matching the newly documented followUp-arg resolution pattern
- [Phase 132-04]: GameElement forEach snapshot items tagged with { elementId } wrapper (not bare number) to avoid the ENG-05/resolveArgs ambiguity between element ids and JSON-primitive numbers in the same collection
- [Phase 132]: handlerless flag set true in Action constructor, cleared inside .execute(fn); registerAction() throw kept separate from startFlow validators (new registration-time gate per Pitfall 4)
- [Phase 133-01]: PROC-01 gate satisfied — all four findings (F4/ENG-02, F5/ENG-03, F6/ENG-04, F27/ENG-07) independently re-verified LEGITIMATE against current post-Phase-132 source with current file:line evidence before any fix; verification document delivered across two atomic commits matching the plan's two-task structure
- [Phase 133-02]: Wrap is unconditional, no wrap:false opt-out — truncation was never a sane board-game semantic
- [Phase 133-02]: No startIndex === 0 special case added; slice(0)+slice(0,0) degenerates naturally to the full list
- [Phase ?]: Phase 133-04: choice-branch multiSelect enforcement ported from elements branch with deliberate non-array-rejection divergence per locked ENG-04 decision
- [Phase 133-03]: resumeSimultaneousAction's allDone-gated awaitingInput/awaitingPlayers clearing kept fully separate from the actionError set/clear mirror -- structurally different completion semantics from resume()'s single-player completion
- [Phase 133-05]: Used generalized switchOn error message baseline (no name prefix required) with optional config.name prefix, matching the loop maxIterations precedent without requiring callers to set name
- [Phase ?]: [Phase 134-01]: PROC-01 gate satisfied -- all six findings (F17/UIX-01, F18/UIX-02, F19/UIX-03, F29/SESS-01, F30/UIX-04, F31/UIX-05) independently re-verified LEGITIMATE against current post-Phase-133 source with fresh file:line evidence; F19's structural-CSS-fix alternative independently re-confirmed REJECTED; F29's #runner assignment sites re-confirmed at 5 (341, 379, 484, 1462, 1482)
- [Phase 134-02]: start() success path returns bare {success:true} with JSDoc explicitly noting it reflects only synchronous pre-checks, not the eventual server result (RESEARCH.md Pitfall 1)
- [Phase 134-02]: fill()'s UIX-02 multiSelect guard placed after choice-object unwrap and before repeat/onSelect routing, reusing resolveMultiSelectConfig verbatim (no re-derivation)
- [Phase 134-02]: beforeAutoExecuteHooks uses a plain array + identity-based unregister closure (Ref<Hook[]>), matching 134-PATTERNS.md Pattern 2 rather than a new registry abstraction
- [Phase 134-03]: GameShell lastError watch keeps a defensive UIX-01 fallback branch even though useActionController already coalesces lastError to a non-empty string on every failure; unreachable in practice but documents the contract and is test-covered
- [Phase 134-03]: drag()'s combined helper calls a new internal dragPropsInner() directly rather than the now when-gated public dragProps(), avoiding a DragResult.props type break
- [Phase 134-04]: buildRunnerFacade delegates via closures over the captured runner parameter (not this.#runner) at each of the 5 rebuild sites, keeping the facade referentially in sync with the freshly assigned runner
- [Phase 134-04]: ts-expect-error test line assigns session.runner.performAction to a local (does not invoke it) since an actual call throws at runtime, already proven by the adjacent runtime-undefined assertion
- [Phase 134-05]: Browser verification for 134-05's checkpoint performed headlessly via Playwright against go-fish dev host, confirming the Plan 03 ActionPanel-to-GameShell toast chokepoint produces exactly one toast live (no duplicate)
- [Phase 135]: F21/CLIX-03: the CODE (200MB constant) is wrong, not the comment (50MB) - independently re-confirmed against ~/ShufflewickPubGames/src/upload.ts:4
- [Phase 135]: F32/CLIX-04: corrected a 135-RESEARCH.md misreading - CONTEXT.md's locked decision is default 127.0.0.1, not 0.0.0.0-stays-default; fix is a real default-value change, not docs-only
- [Phase 135]: F9/CLIX-01: build.ts's manifest spread is a second silent-forwarding site for playerCount, folded into the same Plan 02 derive-not-duplicate fix
- [Phase 135]: F34/CLIX-06: --ai validation fix requires relocating the check block to after effectivePlayerCount is computed (dev.ts:393), not an in-place operand swap at dev.ts:302
- [Phase 135]: InitOptions interface removed entirely rather than emptied -- template was its only field
- [Phase 135]: dev --host help text corrected to describe the Plan 06 target of a 127.0.0.1 default even though dev.ts runtime binding is unchanged until Plan 06 lands
- [Phase 135]: [Phase 135-03]: Removed the dead $schema line from docs/getting-started.md's boardsmith.json example in addition to playerCount, keeping the doc in sync with generateBoardsmithJson's actual output
- [Phase ?]: deriveManifest sets playerCount AFTER the ...config spread so gameDefinition always wins over stale config (T-135-07)
- [Phase ?]: protocolVersion typed number (matching BUNDLE_PROTOCOL_VERSION), not string as sketched in the plan interface note
- [Phase 135-05]: Allowed-key set enumerated from ALL real read sites (validate.ts+build.ts+dev.ts+publish.ts), not just validate.ts/build.ts as read_first suggested -- gameOptions/playerOptions/colorPalette/paths/gameId/version are legitimately consumed by dev.ts/publish.ts and would false-positive as unknown once Plan 06 wires the same schema into dev.ts
- [Phase 135-05]: minPlayers/maxPlayers excluded from the allowed-key set (not just playerCount) -- CLIX-01 makes gameDefinition the sole source of truth for player count, and Plan 06 collapses dev.ts's fallback chain to a single gameDefinition read
- [Phase 135]: [Phase 135-06]: Combined RED+GREEN commits for Tasks 1-3 (interleaved single-function edits, not independently compilable per-task)
- [Phase 135]: [Phase 135-06]: resolveEffectivePlayerCount keeps the effectivePlayerCount name even though it now errors instead of clamping -- preserves existing devConfig/mpHost call sites
- [Phase 136]: [Phase 136-01]: All six findings (F23,F24,F25,F26,F35,F38) independently re-verified LEGITIMATE against current post-Phase-135 HEAD; zero REJECTED
- [Phase 136]: [Phase 136-01]: F25 errorCode scope boundary locked - client error type carries errorCode as optional; lobby-manager.ts changes out of phase scope (zero errorCode fields today)
- [Phase 136]: [Phase 136-01]: F26 scope boundary locked - barrel re-export chain (client/index.ts re-exports from client/types.ts) requires matching re-export lines on deletion; outgoing WS union narrows to exactly action|ping|getState
- [Phase ?]: [Phase 136-02]: protocol.ts gained 7 new HTTP-shape interfaces (LobbyResponse, SetReadyRequest, AddSlotRequest, RemoveSlotRequest, SetSlotAIRequest, UpdateGameOptionsRequest, UpdatePlayerOptionsRequest) since client/types.ts owned these shapes with no protocol.ts twin
- [Phase ?]: [Phase 136-02]: WebSocketIncomingMessage discriminated union kept client-local (not re-exported from protocol.ts) since protocol.ts's WebSocketMessage union is scoped to client-to-server traffic only
- [Phase ?]: [Phase 136-02]: Rule 3 auto-fix threaded real defaults (config.playerId ?? generatePlayerId(), connectImmediately ?? true, connectionTimeout ?? 10000) into client.ts/game-connection.ts Required<> literals to keep tsc green; simultaneously closed F38/SDK-06 and corrected Node 16+ to Node 19+ error text
- [Phase 136-03]: action()'s not-connected/timeout/open-failure paths all reject; only a genuine server-reported action failure resolves {success:false}
- [Phase 136-03]: connectImmediately gates connect() unconditionally on every call, per the plan's locked acceptance criteria
- [Phase 136-03]: reconnect() simplified to delegate to connect() since connect() now clears #userDisconnected itself (Pitfall 1)
- [Phase 136]: [Phase 136-04]: MeepleClientError extends Error with optional errorCode?: ErrorCode, exported from client barrel; parseResponse<T>() is the single throw-vs-return chokepoint for all 21 non-health HTTP methods
- [Phase 136]: [Phase 136-04]: Rule 1 fix - wsImplementation was silently dropped by connect(), now threaded alongside connectImmediately/connectionTimeout
- [Phase 136-05]: isSettingUp cleared via connection.opened.then()/.catch() internal to setupConnection() (no UseGameReturn API change); connectImmediately:autoConnect threaded into client.connect(), open-then-disconnect fallback deleted
- [Phase 136-05]: GameShell.vue joinGame() auto-join fallback UX (show lobby anyway on join failure) preserved via a nested try/catch around client.joinLobby() rather than letting it bubble to the outer catch
- [Phase 137]: PROC-01 gate: F36/F37 both independently re-verified LEGITIMATE against post-Phase-136 source with zero drift; all six doAction call sites confirmed at original line numbers, locking the classification table for Plans 02-03
- [Phase 137-02]: doAction now throws ActionExecutionError by default; tryAction is the never-throw escape hatch used by the four category-(b) harness call sites
- [Phase 137-03]: Fixed literal 'test-seed' default (matching playUntilComplete-default house style); seed threaded via TestGame's private constructor and surfaced in doAction/assertActionAvailable/GameStuckError failure messages
- [Phase 138]: no-hidden-info-leak.test.ts playSeveralAsks reclassified to loop-control (tryAction), overriding plan's literal Task 2(a) instruction to match driveAFewTurns's identical break-on-failure loop shape
- [Phase 138]: MERC pre-existing dirty tree committed as-is in a standalone WIP commit before re-vendor, per locked CONTEXT decision
- [Phase 138]: True MERC baseline (738 passed/7 skipped/28 files) established fresh via live suite run, not trusted blind from CONTEXT
- [Phase 138]: Zero BoardSmith src fixes required for MERC re-vendor; ENG-05 dual-shape followUp resolvers empirically confirmed already-tolerant
- [Phase ?]: [Phase 138-02]: go-fish/cribbage Playwright smokes intentionally left failing (non-zero exit) rather than faked -- they caught a real CLI dev-host seat-identity bug in the solo-human+AI-seat path, documented as a blocker rather than papered over
- [Phase ?]: [Phase 139-01]: visibleAttributes documented as real (Phase 131 SEC-02 shipped enforcement after the audit finding was written) -- corrected the plan's stale 'dead field' premise rather than following it literally
- [Phase ?]: [Phase 139-01]: Fixed all phantom action()/.do()/.chooseOnBoard() JSDoc occurrences found by full-file grep in game.ts/player.ts, not just the plan's four named line refs
- [Phase 139-02]: Fixed phantom action()/defineActions() text baked into src/engine/flow/engine.ts's own runtime warning (not just docs) and the matching stale engine.test.ts F20 assertion that encoded the phantom text as "the real API"
- [Phase 139-02]: Fixed pervasive 0-indexed player/seat examples in docs/api/session.md and docs/api/runtime.md -- seats are 1-indexed throughout the engine/session (getPlayer, performAction, getState, createPlayerView)
- [Phase 139-02]: Treated the Task 2 playerCount grep-gate false positives (real GameOptions.playerCount usages) as a blunt-instrument limitation rather than deleting legitimate API docs -- verified directly that zero boardsmith.json JSON examples reference playerCount/$schema, satisfying the actual DOCX-04 requirement
- [Phase 140]: useAnnouncer/provideAnnouncer/createAnnouncer mirrors the createAnimationEvents/useAnimationEvents provide-inject shape — Writes through GameShell's existing politeMessage/assertiveMessage refs and postMessage relay with no new DOM nodes; useAnnouncer() never returns undefined (no-op + devWarn once outside a GameShell tree)
- [Phase 141]: state-machine.md is standalone full content (not a thin pointer) per CONTEXT.md's locked decision -- every bs- skill cites it rather than duplicating rules
- [Phase 141]: templates.test.ts describe blocks named by requirement ID (TMPL-03, TMPL-02) so -t selectors work; no markdown parser added, plain string assertions suffice
- [Phase 141-02]: CHUNK.template.md restates the ui: tag (redundant-but-safe) so a CHUNK-only session knows whether the a11y floor applies without re-reading SKETCH.md
- [Phase 141-02]: SKETCH.template.md records the UI Strategy decision (custom-from-chunk-1 vs autoui-with-cutover) at ingest time, since DESIGN.md doesn't exist until the first UI chunk's ask
- [Phase 141-02]: Drift test asserts CHUNK.template.md and state-machine.md contain the byte-identical step-name string; both new templates carry a literal state-machine.md pointer
- [Phase 141-03]: templates.test.ts describe blocks named by requirement ID (TMPL-01, TMPL-02) extended for RULINGS/DECISIONS/DESIGN/ASSETS; ledgers use numbered append-only sections (Ruling N / Decision N) rather than flat tables, matching CHUNK.template.md's Revision Rounds pattern
- [Phase ?]: [Phase 142-01]: read() calls moved inside individual it() bodies (not describe-level) in ingest.test.ts -- required since ingest-rules.md and bs/ingest/*.md files are authored progressively across Plans 01/02/03
- [Phase ?]: [Phase 142-01]: ingest-rules.md kept to 131 lines by delegating every step's heavyweight prose to not-yet-authored ingest/*.md reference files, matching state-machine.md's citation-not-restatement convention
- [Phase 142-02]: transcription.md and interview-fallback.md produce identical rulebook/ + INDEX.md output shape; interview citation format is 'designer statement, ingest session, Q{n}' — INGEST-03 requires the interview fallback to produce the same rulebook/ files as the transcription path, not PROJECT.md prose
- [Phase 142]: 142-03: scaffold.md corrects init-creates-new-subdir framing (no in-place mode); sketch-derivation.md uses the byte-identical sketch-level tail marker + hard 2-3-chunk detail cap, greening the cross-file consistency gate
- [Phase 143]: 143-01: Return-shape field names fixed for build-chunk skill — INVESTIGATE_RETURN_FIELDS=[claimsList,visibilityDeclaration,newlyDiscoveredCitations]; REDTEAM_REFUTER_FIELDS=[claimNumber,verdict,objection]; REDTEAM_COVERAGE_FIELDS=[missingInteractions,ruleDescription,citation]
- [Phase ?]: Light path is routing over build.md/test.md/playtest.md, not a fourth ceremony (no build/light.md file)
- [Phase ?]: Session lock's three outcomes (same-chunk resume, different-live-lock warn, stale-confirm-clear) implemented as three literal branches
- [Phase 143]: [Phase 143-03]: Re-investigate round behavior resolved as append-with-supersession — a refuted-once round appends a new claim noting supersession rather than editing/renumbering the original claim
- [Phase 143-04]: Prohibit confidence adjectives in redteam dispatch prompts to prevent investigator framing from correlating the 3 independent agents; refuters default to REFUTED on uncertainty
- [Phase 143-05]: ask.md uses lowercase 'what you will NOT see yet' to byte-match the BUILD-04 drift test; forbidden vocabulary scoped to action/flow/state/element per 143-RESEARCH.md Pitfall 2
- [Phase ?]: 144-01: followed 144-PATTERNS.md verbatim for drift-pin scaffold constant edits
- [Phase 144]: axe-core and @vue/test-utils added ONLY inside generatePackageJson()'s returned template-string literal — never installed into BoardSmith's own repo
- [Phase 144-03]: fresh-context read exception documented explicitly in build.md as the one build-chunk step allowed to read raw rulebook slices directly
- [Phase 144-03]: test.md frames boardsmith lint's seven AST-based sandbox rules as the sole hard gate, distinct from the same command's regex-heuristic warnings
- [Phase 144-04]: design-ask.md cites build/ask.md's and DESIGN.template.md's prose by name rather than restating it (citation-not-restatement convention)
- [Phase 144-04]: build-chunk.md dispatch-table rewritten so build/build.md and build/test.md are live while audit/repair/playtest/revise/close remain forward references; zero 'authored in Phase 144' occurrences remain
- [Phase 145]: audit.md's own no-framing rule forbids reading CHUNK.md's ## Interpretation, stronger than redteam's rule — even the settled conclusion (not just upstream rationale) must stay out of the dispatch prompt
- [Phase 145]: repair.md's fix-or-refute-with-citation branch modeled on build/build.md's Extends Never Restructures shape — no exact prior analog existed for a refute-in-place-of-fix path
- [Phase 145-02]: design-review.md registered only in build-chunk.md's Reference Files list (dispatched by audit, not a top-level dispatch-table step)
- [Phase 146]: 146-01: assertCitedNearby scans all occurrences of a section-name anchor + both directions for the cite phrase, avoiding false negatives on already-correct citations
- [Phase ?]: playtest.md forward-cites close.md's Bookkeeping Sequence for light-path duty ahead of close.md's own authoring in Plan 03
- [Phase ?]: Build-stamp freshness taught as a hard-reload instruction since DevHost.vue has no on-screen version/commit indicator
- [Phase ?]: close.md's own bookkeeping duty starts AFTER the Status write since playtest.md already writes Status: verified/verified (user-waived) before close begins
- [Phase ?]: final-acceptance.md splits the 7-point design-QA pass: checks 2/3/5/6/7 go to a single fresh-context agent dispatch reusing design-review.md's serve-capture-kill lifecycle; checks 1 (SR/VoiceOver) and 4 (colorblind) stay human-narrated
- [Phase 146-04]: Step Groups 2-3 dispatch prose lives in build/build.md, test.md, audit.md, repair.md themselves; only Group 4 needed a live dispatch section authored in build-chunk.md — Groups 2-3 never had inline dispatch prose to retire (already citation-only, unlike Group 1)
- [Phase ?]: [Phase 147-01]: check-status.md reuses build-chunk.md's Step 2 current-chunk/current-step derivation rule verbatim in spirit rather than re-deriving it
- [Phase ?]: [Phase 147-01]: Waived-chunk batch-playtest proposal gated at 2+ waived chunks (0-1 just reports the count)
- [Phase ?]: [Phase 147-02]: op (b)'s citation-overlap diff performed inline by insert-chunk.md, no subagent dispatch -- flags only, never triggers a revise round itself
- [Phase ?]: [Phase 147-02]: Mandated-Chunks invariant guard folded into op (a) rather than a standalone fifth check
- [Phase ?]: [Phase 147-02]: build-chunk.md line 76's parenthetical check-status pointer left unchanged -- correct live pointer, not one of the two Step-1 stopgap bullets targeted for retirement
- [Phase 148]: 148-01: kept the pinned cite-state-machine.md citation phrase bare (unanchored) in build-chunk.md/check-status.md/insert-chunk.md since anchoring it broke BUILD-13 assertCitedNearby's 250-char window
- [Phase 148]: 148-02: Scoped design-game residual grep to installer source (install-claude-command.ts) + cli.ts, matching Plan 01's identical scoping decision for legitimate migration-prose files in bs/ingest-rules.md and bs/ingest/*.md
- [Phase 148]: 148-02: Added InstallOptions.skipLink to gate the npm-link global side-effect; verified via a temporary smoke test that install-to-temp-dir performs zero execSync calls when skipLink is true
- [Phase 148-03]: Used beforeAll/afterAll temp-dir install (single real installClaudeCommand call) rather than per-test try/finally; skip-list extended for line-wrapped refs, glob placeholders, and build/light.md's documented-nonexistent reference
- [Phase 149-01]: Applied a scratch-project-local tsconfig.json workaround (vite/client types) to unblock the ingest dry-run after discovering a real scaffold-template defect (fresh npx boardsmith init fails tsc --noEmit) — logged for Plan 03, not fixed in BoardSmith source
- [Phase 149]: 149-02: chose pond-empty as chunk-1's depth-cut isFinished() terminal condition (book-forming out of scope makes all-hands-empty unreachable) — Found via simulateRandomGames timedOut on every game; fixed and re-verified 0 crashed/stuck/timedOut/exceededMaxActions
- [Phase 149]: D1/D2 pipeline defects fixed at source in CLI scaffold/init code (not skill markdown); F2/F3 documented as headless-dry-run friction, not defects
- [Phase 150]: boardsmith.json displayName corrected to designer's original 'Go Fish' rather than the lossy kebab-case round-trip, per scaffold.md's Display Name correction rule
- [Phase 150]: Chunk-1 CHUNK.md pre-documents the pond-empty terminal-condition depth-cut (claim 6) ahead of Plan 02's build leg, mirroring the fix the 149 dry-run had to make reactively
- [Phase 150]: 150-01 task commits landed inside go-fish-dryrun's own git repo (created by boardsmith init), not the BoardSmith repo, since sub_repos is unconfigured and the plan's deliverables live entirely outside BoardSmith
- [Phase 150-02]: Redteam Round 1 coverage adversary flagged empty-pond-during-a-miss gap; re-investigate appended claim 7 (append-only), mirroring the exact interaction the 149 dry-run's coverage-adversary pass caught
- [Phase 150-02]: Books defined-but-unwired in chunk-1; isFinished()=pond-empty depth-cut, getWinners() always []; turn-loop does NOT gate on isFinished() (only outer game-loop does) so an earned extra turn is never denied mid-chain
- [Phase 150-02]: Custom UI built directly per SKETCH.md's custom-from-chunk-1 strategy, wired to the real actionController/useBoardInteraction instances GameShell provides (never a mock)
- [Phase 150-03]: F2 fix: GameTable.vue compares the target pick's wire-flattened choice value directly (c.value === seat), not a nested (choice.value as any)?.value -- pick-handler.ts flattens playerChoices()-sourced {value,display} raw choices rather than re-wrapping them; the nested comparison made the ask action's opponent-hand selection completely non-functional in production, found via a real headless-session keyboard-completion a11y test
- [Phase 150-03]: F1 fix: DESIGN.md authored retroactively (Direction: Adopt) after discovering Plan 02's ask step skipped the design-ask visual-identity sub-gate despite this chunk being tagged ui: major
- [Phase ?]: Phase 150: Task 1/3 verification-only, no commits produced; only Task 2's UAT doc edit required a commit
- [Phase ?]: AssetImage.vue single kind-discriminant component, fallback always rendered underneath
- [Phase 152-02]: PieceRenderer's two unguarded image branches (overlay presentationEntry.image override and engine pieceVisual image) merged into one effectivePieceImage computed + one load-guard rather than duplicating the guard twice
- [Phase 152-02]: PieceRenderer fallback label/color derived defensively so a sane token-style fallback exists even when pieceVisual isn't literally token kind
- [Phase ?]: 152-03: Fixtures authored as real on-disk files under __fixtures__/asset-scan/ per plan's files_modified naming them as deliverables
- [Phase ?]: 152-03: AssetImage.vue exclusion matches by basename only (not directory path), per plan's explicit NOTE
- [Phase 152]: Asset-reachability gate failure routes to build (not repair per plan text) — matches test.md's pre-existing Failures-Loop-Back-to-build convention
- [Phase 153]: 153-01: Fix scoped exactly to dev.ts's WS close handler (socket-identity guard) — no changes to MultiplayerHost/SnapshotSessionHost/handleServerRequest, per RESEARCH.md's proven root cause and explicit anti-patterns
- [Phase 155-01]: Shared `assertUndoAllowed`/`UndoRefusedError` guard in `session/utils.ts`, wired into all four undo/rewind entry points (`handleUndo`, `handleDebugRewind`, `undoToTurnStart`, `rewindToAction`) — single source of truth for the `.notUndoable()` fence and the `finished`-phase fence
- [Phase 155-04]: `animationSeqFloor` option on `Game.loadSerializedState`, supplied only by `GameRunner.fromCheckpoint` (derived from the ENCLOSING live snapshot, not the historical checkpoint) — keeps undo/rewind checkpoint restore monotonic without any of the four undo/rewind call sites needing to change; restored buffered events re-stamped above the floor. Adversarial testing surfaced and fixed a related latent bug: `Game.toJSON()` only serialized `animationEventSeq` when the current buffer was non-empty, so the seq silently reset to 0 on any snapshot round-trip through an empty-buffer op (not just undo) — now serialized whenever nonzero, independent of buffer state.
- [Phase 164-01]: unbounded: true opt-in threaded on LoopConfig; global whole-flow tripwire retained unchanged — Lets a genuinely unbounded game express its loop without lying via an arbitrary maxIterations cap, while the engine's DEFAULT_MAX_ITERATIONS run() tripwire (independent of any single loop's counter) still catches a truly stuck loop
- [Phase 164-02]: contrastInk implemented as a pure hex/#rgb/rgb()/rgba() parser (no Canvas/DOM) per the plan's locked LIBX-03 constraint, superseding RESEARCH.md's Canvas-normalization recommendation
- [Phase 164]: Plan 164-03 (LIBX-01): platformActionPanelEscapeHatch renamed+locked; suppressFromDock rides the actionMetadata channel exactly like manual
- [Phase 164-04]: displayedState computed re-wraps the shallower timeTravelState PlayerGameState into the GameState shape at one declaration site (mirrors gameView), unifying board+sidebar-extra :state on a single source of truth
- [Phase 164-04]: isViewingHistory guarded independently in all four useBoardActionBridge mutators (not composed with isMyTurn) since setSelectionValue/toggleMultiSelectValue never re-check isMyTurn mid-action
- [Phase ?]: Session lock grammar extended to "<slug> @ <session-id> — locked at <ISO timestamp>"; Bookkeeping Sequence grew 3->4 items with terminal lock release (SKILLDEF-01)
- [Phase 166]: SKILLDEF-02/03: build.md gained a game/library boundary section (board-only, read-only node_modules/boardsmith, file-not-patch, never-suppress built-in UI) and a never-without-client rule for platformActionPanelEscapeHatch
- [Phase 167]: SKILLAUTO-01: Milestone: field (none|core-loop|scoring|final-acceptance) set at sketch-derivation time, never inferred at runtime
- [Phase 167]: SKILLAUTO-01: non-milestone/UI-less chunks write Status: verified off automated test/sim pass rather than skipping verification
- [Phase ?]: Ask triple-gate (undetermined AND load-bearing AND no reasonable default, else proceed and record) codified in build/ask.md
- [Phase ?]: Cross-chunk continuation reframed as run-while-away + auto-advance; printed resume command is a crash fallback only, never the default end-of-close signal
- [Phase 167]: ≥50% context wind-down floor added beneath the unchanged 60% ceiling; sub-agent offload of research/audits/large reads/repairs codified as the lever; game-completion gets a loud banner + summary card, chunks get a lighter completion line
- [Phase ?]: [Phase 167-04]: SKILLAUTO-08 ledger-reconciliation step inserted before the terminal lock release; reconciles filings/library-gap, asset-debt, and waived-chunk ledgers and re-touches a filing/ruling when a fix lands
- [Phase ?]: [Phase 167-04]: fail-loud sim-exercised assertion implemented via action-level execute() counter instrumentation, not a fabricated SimulationResults coverage field
- [Phase 167]: [Phase 167-05]: state-machine.md's Autonomy Scope: How, Never What (PROC-02) section placed as its own top-level section before Session Handoff Seams
- [Phase 167]: [Phase 167-05]: PROC-02 Part D survives regression net — all six disciplines verified intact after Plans 01-04, zero restoration needed
- [Phase 168-01]: Seed file convention: seeds/<scenario>.json holding a raw GameStateSnapshot; ship raw snapshot format, defer scenario DSL until proven too low-level
- [Phase 168]: Seed rides on hostOptions.seedSnapshot, never gameOptions — mirrors the teachingDisabled WR-04/D-01 pattern so a seed never persists into a game's own snapshot.gameOptions.
- [Phase 169]: D32 recorded ABSENT by design (platform-side); crosswalk built per-filing from all 5 repos' own ledgers, gating all downstream removals
- [Phase ?]: lanternfall BUG 6/D29: comment-refresh only, valve kept
- [Phase ?]: lanternfall BUG 7/D26: removal attempted+reverted (suite went red), guard kept-and-noted
- [Phase ?]: lanternfall BSR-12: AI read/run only, left untracked, not committed by sweep
- [Phase 169]: seven sweep (169-03): removed redundant setVisibilityInternal(hidden) call from Mess.concealFromEverySeat() now that D24/SPACE-03 suppresses childCount at the zone-visibility level alone; converted 5 self-cancelling it.fails tripwires to plain it() (BSR-5 x4/D1, BSR-3 x1) after discovering baseline suite was actually red (196/205), not green
- [Phase 169-04]: one-two-punch's assertPlanLockHolds() (BUG 3/D1) kept, not removed: empirically proven load-bearing beyond BUG 3 via a red-test removal probe
- [Phase 169-04]: one-two-punch BUG 8/BSR-12 CLOSED: MCTS AI re-verified sound against AI-02 redacted-view + pre-reveal simultaneous baseline
- [Phase 169]: doom-machine 169-05: D9/BS-5 rewrite deferred (comment-only); D12/D23 kept-and-noted (load-bearing beyond workaround); BS-10 reclassified as game-side fix already handled (commit 6949fde)
- [Phase 169]: BOARDSMITH-BUG-02 required no logic removal, only pinned-defect test flip + docblock refresh
- [Phase 169]: BSR-12 CLOSED — all four AI-bearing repos show a recorded PASS status; doom-machine correctly excluded as N/A
- [Phase 170]: Exactly two worked examples for the Derived/Visual split per CONTEXT.md's locked cap; publisher-logo edge case mentioned in prose only
- [Phase 170]: openGaps[] added as a new seventh return field mirroring variants[], not folded into citedTerms[]
- [Phase ?]: [Phase 170-02]: Archive+hash landed as Step 3 item 1, not a new top-level step
- [Phase ?]: [Phase 170-02]: ## Open Rules Gaps heading pinned bare (no parenthetical), standardizing over seven's pre-phase hand-authored variant
- [Phase ?]: [Phase 170-02]: Interview path's Source:/Source hash: use explicit not-applicable sentinel rather than omission
- [Phase 170]: gaps-reconciliation treats a wholly-absent Open Rules Gaps heading as a 0-entry body rather than an unrunnable check
- [Phase 170]: conforming fixture rules.pdf is a 113-byte synthetic stand-in, not a copy of the real 2.1MB seven/rules.pdf
- [Phase 170]: No --add-dir passed to the driven claude session; source rulebook copied into throwaway tree at stage time so the reference game repo is structurally unreachable, not merely git-status-detected
- [Phase 170]: 170-PROOF-RUN.md header arithmetic corrected from 7-of-9 to 8-of-9 to match its own checklist table before using it as this baseline's comparison target
- [Phase ?]: Live harness stayed 1/10 across two attempts for INDEX.md template-copy mechanism; deferred deeper architectural fix to next plan
- [Phase 171]: 171-01: normalizeEdition collapses recognisably-empty --edition free text to EDITION_UNKNOWN, preserving designer wording on a separate un-parsed Edition note: line — F-1 fix per CONTEXT.md decision 5 -- PROV-01/PROV-03 read this field, so it must be machine-checkable before anything reads it
- [Phase 171]: readBoardsmithVersion() walks up to package.json (not fixed hop), throws rather than falling back; hashSkillsTree() hashes installer-owned bs- paths by relPath+content sorted, returns SKILLS_TREE_ABSENT when no root found
- [Phase 171]: 171-03: computeVerificationScope's five reason codes checked as a single top-to-bottom early-return chain (order is contract, not incidental); resolveCitedSlices resolves shorthand against the rulebook/ directory listing (not INDEX.md's ## Slices table, absent in one-two-punch); ambiguous/unresolvable citations recorded verbatim, never guessed or dropped — pinned against seven's genuine two-01--slice collision
- [Phase 171]: 171-04: chunk-check writes strictly between VERIFIED_AGAINST_BEGIN/END (distinct fence pair from GAPS_BEGIN/END); citation scan is scoped to content BEFORE any existing Verified Against section so the block can never re-poison its own next computation; program.parse() -> parseAsync()+try/catch in cli.ts fixes a repo-wide stack-trace leak affecting every CLI command, not just chunk-check
- [Phase ?]: unknown and verifiedWithoutProvenance compose by design (171-05)
- [Phase 171-06]: check-status.md item 8 consumes chunk-provenance-status's projectProvenanceState field rather than re-deriving severity, so a pre-provenance project (both reference games, 100% flagged) reports as informational not alarming
- [Phase ?]: 171-07: real chunk-check output disproves the plan's anticipated ambiguous rulebook/01 shorthand in seven's live prose; recorded honestly rather than assumed, per the phase honesty requirement
- [Phase 172]: parseBuildManifest distinguishes tabular:true-empty from tabular:false-prose via a table-structure scan, not row-count alone
- [Phase 172]: parseVerifiedAgainst fixed to use findHeadingIndex instead of chunkText.indexOf, closing the latent f73153a3 recurrence
- [Phase ?]: Three-rung claim-resolution ladder (owners -> live-claim validity -> authoring chunk) implemented as sequential array filters; rung 3 falls back to rung-2 survivors when authoring narrowing would empty the set, never dropping to nothing
- [Phase 172]: drift-check.ts: hand-written execFileAsync instead of promisify(execFile) — Node's util.promisify.custom symbol is dropped when execFile is wrapped for test mocking, silently changing the resolved shape from {stdout,stderr} to a positional array
- [Phase ?]: [Phase 172-04]: trace-check/drift-check registered on the CLI surface with --project/--json only, no mode flag; pinned findings-exit-0/tool-failure-exits-non-zero via a real child-process spawn of node bin/boardsmith.js (first such test in this repo)
- [Phase 172]: Phase 172 closed: trace-check/drift-check proven end-to-end against both reference games via cp -R copies; independent cross-check found and documented a real narrow-impact parser precision defect in AUTHORING_VERBS (filed for follow-up, not fixed in this proof-only plan)
- [Phase 173]: Wave-1 gate closed: ingest-archive existing-INDEX branch repaired and proven against both reference games — Unblocks decision 1 (adopt-on-first-verify) and every later plan needing real-game data; two plan hedges refuted empirically and documented in 173-PROOF.md rather than silently absorbed
- [Phase ?]: Decision 15 honored: reused transcription-subagent.md as a shared, parameterized contract instead of forking a verify-specific copy for VERIFY-07
- [Phase 173]: verify-shaped lock identity is verify:<run-id>, reusing SKETCH.md's existing Session Lock slug position rather than a second lock mechanism
- [Phase 173]: Removed literal --apply/cutover mentions from verify-game.md prose so the decision-8 absence guard in verify.test.ts is a real structural check
- [Phase ?]: Replaced all five hardcoded SKILL_NAMES test literals with a single exported source of truth (SKILL_NAMES), closing the drift hazard structurally
- [Phase ?]: SHARED_LEAF_PROBES verify/ leaf probe uses source-resolution.md per plan fallback instruction
- [Phase 173]: 173-06: source-resolution.md's post-adoption re-check used the wrong provenance field (chunk-provenance-status's projectProvenanceState, which never flips from ingest-archive alone) — found live, fixed to check rulebook/INDEX.md's Source hash: directly
- [Phase 173]: VERIFY-01 and VERIFY-07 left open — per-chunk-verdict/classification-in-subagents halves depend on Phase 174's classifier, which does not exist yet; marking complete now would be a third premature completion mark this phase caught
- [Phase 173]: VERIFY-08 marked complete despite a real finding (range-level resume re-dispatch is not idempotent) because the requirement's core no-data-loss guarantee holds under two real interruption mechanisms; the idempotency gap is tracked as an open item in 173-PROOF.md, not hidden
- [Phase 173]: Closed CR-01 (crash-unsafe ledger write) and PROOF.md Finding 1 (non-idempotent range resume) via plan 173-08, before Phase 174 build — 173-07 marked VERIFY-08 complete on a crash-safety guarantee code review then showed was false; fixing both defects together (same subsystem, same commits) before Phase 174's classifier builds on the corrected guarantee was cheaper than a third premature-completion correction.
- [Phase 174]: ClassificationRecord slot fields are plural (units[]/liveSlices[]/stagedSlices[]) mirroring SlicePair.stagedUnits[] with no collapsing step

### Pending Todos

None yet for v4.5.

### Blockers/Concerns

- 138-02: CLI dev-host (npx boardsmith dev) has a reproducible client/server seat-identity mismatch in the solo-human+AI-seat path (5/5 go-fish repro, 1/1 cribbage repro) -- blocks natural in-turn action testing for go-fish/cribbage smokes; root cause not fully isolated (see 138-02-SUMMARY.md)

## Session Continuity

Last session: 2026-07-29T23:43:55.604Z
Stopped at: Completed 173-08-PLAN.md — closed CR-01 crash-safety + Finding 1 resume determinism, re-proved SC-4, VERIFY-08 re-confirmed
Resume file: 
None

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone

## Deferred Items

Items acknowledged and deferred at v4.6 milestone close on 2026-07-05:

| Category | Item | Status |
|----------|------|--------|
| verification | 149 browser playtest (149-HUMAN-UAT.md) | human_needed — deferred by design (VAL-01's inherent human gate; user chose to ship with it outstanding) |
| uat | 149-HUMAN-UAT.md (Go Fish chunk-1 browser playtest) | pending — surfaces in /gsd:audit-uat |
| debug | knowledge-base | pre-existing, unrelated to v4.6 |
| todo | dev-host-ai-open-seat-not-auto-playing | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | dev-host-debug-toggle-panel-not-opening | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | dev-standalone-shell-height-gap | pre-existing dev-host tech debt, unrelated to v4.6 |
| todo | v4-slate-token-and-a11y-polish | pre-existing polish todo, unrelated to v4.6 |

## Current Position (v4.6 reopened — for the fresh context)

Milestone v4.6 shipped + tagged, then reopened to close VAL-01's deferred human playtest.

- **Phase 150 (Regenerate the pipeline-built Go Fish)** — READY TO PLAN. The Phase-149 dry-run's generated Go Fish lived only in a `/tmp` scratch dir that was deleted at cleanup, so there is no pipeline-built game to playtest. Phase 150 re-runs the ingest + chunk-1 build legs of the bs- pipeline against Go Fish into a STABLE location (recommend `~/BoardSmithGames/go-fish-dryrun/`, NOT `/tmp`), leaving it compiling+serving and NOT deleting it. Hand-built `~/BoardSmithGames/go-fish/` stays READ-ONLY.
- **Phase 151 (Human playtest)** — after 150, the user walks `149-HUMAN-UAT.md` in the browser (verification `human_needed`).

Reference for the fresh context: the Phase-149 artifacts (dry-run report, HUMAN-UAT script, the two SUMMARYs describing exactly how the machine-step dry-run was run, incl. the `${CLAUDE_SKILL_DIR}/../bs-shared/X` → `src/cli/slash-command/bs/X` path translation and the scaled-fan-out approach) are archived at `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/`.

**Next command (fresh context):** `/gsd-autonomous` (picks up Phase 150) — or `/gsd:plan-phase 150` then `/gsd:execute-phase 150`.
