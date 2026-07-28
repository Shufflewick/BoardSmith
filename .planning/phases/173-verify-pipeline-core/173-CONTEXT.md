# Phase 173: Verify Pipeline Core - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Requirements:** VERIFY-01, VERIFY-02, VERIFY-07, VERIFY-08

<domain>
## Phase Boundary

A designer can invoke `/bs-verify-game` against an existing bs-built project and get a
safely-staged, resumable re-transcription without disturbing the live project.

In scope:
- VERIFY-01 — `/bs-verify-game` installs as a new skill and runs against an existing bs-built
  project without rebuilding it.
- VERIFY-02 — re-transcribes the full archived rulebook into a staging tree non-destructively;
  existing slices are never overwritten before the pass closes.
- VERIFY-07 — the orchestrator never reads a full slice; re-transcription runs in subagents.
- VERIFY-08 — a pass is resumable; a crash resumes at the first unrecorded step.

Out of scope, explicitly:
- **All classification.** VERIFY-03's two-dimensional classifier is Phase 174. This phase stages
  and records; it does not compare, judge, or label anything. Any classifier logic appearing here
  should be rejected in plan review.
- The impact map and repair gating (175), stale-chunk repair (176), derived-line re-derivation
  (177), worked-example tests (178), source-free mode (179).
- Cutover — promoting staged slices over live ones. That is 175/176's business. This phase writes
  only inside the staging tree.
</domain>

<decisions>
## Implementation Decisions

### The sort: mechanical vs judgment

Phase 170's central finding (`170-MECHANISMS.md`) requires each requirement to be sorted before
planning, because skill text conveys judgment reliably and mechanics not at all — twelve
instruction-shaped mechanisms were skipped on live runs.

| Req | Sort | Consequence |
|---|---|---|
| VERIFY-01 | Mixed | Installer registration is mechanical (CLI). The skill's orchestration is judgment (skill text). |
| VERIFY-02 | Mechanical | Where files are written is a path computation, not a judgment. Enforce structurally. |
| VERIFY-07 | Mechanical-by-structure | "Never read a slice" must be made *impossible-ish*, not merely instructed — see decision 12. |
| VERIFY-08 | Mechanical | A ledger append/read is pure mechanics. CLI-backed (decision 9). |

**Therefore this phase is BOTH CLI work and skill work**, and the split is deliberate: every
mechanism gets a command; only orchestration and gating live in skill text.

### The finding that shapes the whole phase

**Neither reference game has an archived rulebook.** Verified this session: `~/BoardSmithGames/seven`
and `~/BoardSmithGames/one-two-punch` both lack `rulebook/source/` and both lack a `Source hash:`
line in `INDEX.md`; each carries `rules.pdf` at project root instead. Phase 171 already named this
state (`pre-provenance-project`, its decision 10).

Success criterion 2 says a verify pass re-transcribes the full **archived** rulebook. As literally
specified, the phase could not be demonstrated against either game it would be demonstrated
against. Area 1 below resolves this, and it is the phase's highest-risk item.

### Area 1 — Source resolution (accepted by the user, 2026-07-28)

1. **Adopt-on-first-verify.** When `rulebook/source/` is absent but an unarchived source (root
   `rules.pdf`) is present, verify detects it, asks the designer once, and runs the existing
   `ingest-archive` to archive and hash it — then proceeds as a normal full verify. This turns
   Phase 170's provenance contract into something existing projects migrate *into* by using the
   tool, rather than a wall that locks every pre-170 project out of verification forever.

   Rejected: reading the root PDF in place — unarchived and unhashed, there is no provenance anchor,
   which defeats PROV-02 and makes the resulting verdict unreproducible.
   Rejected: refusing and deferring to Phase 179's source-free mode — that mode does not exist yet,
   and it would leave this phase unprovable against real data.

1b. **`ingest-archive` MUST BE FIXED FIRST — it is broken on already-ingested projects.**
   Added 2026-07-28 after `173-RESEARCH.md` found this and the orchestrator independently
   reproduced it against a `cp -R` copy of `seven`. Decision 1 is **unimplementable until this
   lands**, and every other success criterion in this phase is unprovable against real data.

   Reproduced: `boardsmith ingest-archive rules.pdf` in an already-ingested project printed
   `index: rulebook/INDEX.md provenance header updated (existing sections untouched)` — a FALSE
   SUCCESS — while producing three distinct defects:

   | Field | Before | After |
   |---|---|---|
   | `Edition:` | `not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation` | `not stated in the rulebook` |
   | `Source:` | `` `rules.pdf` (2 pages). This index is the term → slice… `` (wrapped prose) | `rulebook/source/rules.pdf`, orphaning the continuation line |
   | `Source hash:` | absent | **still absent** |
   | `Transcribed:` | absent | **still absent** |

   Root causes, in order of severity:
   a. **Silent no-op insert.** `Source hash:` / `Transcribed:` are written with regex `.replace()`,
      which no-ops when the line is absent rather than inserting it. A fresh-ingest scaffold has
      those lines; a real existing `INDEX.md` does not.
   b. **Content corruption.** The real `Source:` line is WRAPPED prose. Replacing only its first
      line orphans the continuation into a dangling fragment.
   c. **Destroys a real `Edition:` value** when `--edition` is not resupplied — overwriting exactly
      the designer-pending qualifier that Phase 171's F-1 fix exists to protect.

   Payoff check, run independently: `chunk-provenance-status` still reports `pre-provenance`
   afterward. Adoption silently fails to do its one job.

   **Scope of the fix (wave 1, user-chosen 2026-07-28):** `ingestArchiveCommand`'s existing-INDEX
   branch only — insert-if-absent rather than replace-if-present, wrap-safe `Source:` replacement,
   and never clobber a real `Edition:`. Prove against copies of BOTH reference games. Do not let it
   grow into a rewrite of `ingest-archive`, and do not add the broader refuse-on-ambiguity hardening
   (considered and deliberately not chosen — file it as a todo if the fix surfaces more of the
   false-success class).

2. **Adoption is GATED on designer confirmation.** It writes to the live project (creates
   `rulebook/source/`, rewrites `INDEX.md`'s header). PROC-02's "how, never what" autonomy rule
   makes acquiring a source-of-truth the designer's call, not the session's. This is the one live
   write this phase performs, and it is the reason it is gated.

3. **A hash mismatch against a previously archived source is the `source-changed` SIGNAL, not an
   error.** Record it and proceed — re-verification against a new edition is the entire point of
   this milestone. Never silently overwrite the archived copy; the old archive is what the previous
   verdict was made against.

4. **Multiple candidate sources at root ⇒ STOP AND ASK.** Never guess which is authoritative. This
   is the TMPL-02 parse-contract rule (`state-machine.md` "Cold-Resume Parse Contract"): on an
   ambiguous state the session stops and asks, and never silently picks the most likely.
   Rejected: newest-mtime or largest-file heuristics — a guess wearing a result's clothing.

### Area 2 — Staging tree (accepted by the user, 2026-07-28)

5. **Location: `rulebook/.verify/<run-id>/slices/`.** Inside `rulebook/` so it is obviously
   rulebook-scoped; dot-prefixed so it can never be mistaken for a live slice by any glob that
   walks `rulebook/*.md`; run-scoped so two passes cannot collide.

   The dot prefix matters more than it looks: `INDEX.md`'s Slices table and every citation resolver
   built in Phases 171–172 walk `rulebook/`. A staged slice appearing as a live slice would corrupt
   provenance and traceability output.

6. **Committed, not gitignored.** A resumable pass needs its state to survive, and `state-machine.md`'s
   Git Protocol commits at every step completion. The pipeline does NOT add a `.gitignore` entry.
   Rejected: gitignoring — resume would not survive a clean checkout, and it would hide the very
   evidence each verdict rests on.

7. **Staging is KEPT after the pass closes**, and the closing pass records its path in the
   provenance block. It is the evidence behind every verdict; deleting it makes the verdict
   unauditable. Pruning old runs is a separate, later concern — do not build a retention policy here.

8. **Live slices are NEVER overwritten in this phase. Full stop.** No `--apply`, no cutover, no
   "just this once" path. VERIFY-02 states it, and cutover belongs to 175/176.

### Area 3 — Resume ledger (accepted by the user, 2026-07-28)

9. **A machine-owned, append-only `RUN.md` ledger** in the run directory, one record per completed
   step, using the fenced machine-owned region convention (`<!-- boardsmith:…:begin/end -->`). That
   fence is the only mechanism in this pipeline's history with a *proven* behavioural effect —
   Phase 170's Run 2 session had a real motive to edit a fenced region, recognised it, and declined
   because it was marked machine-owned. Reuse the shape; do not invent a second convention.

   Rejected: inferring resume state from which slice files exist on disk — that cannot distinguish
   "completed" from "crashed mid-write", and a truncated slice would silently be treated as done.

10. **Step granularity = the slice-unit of work** that `ingest/transcription.md`'s fan-out already
    dispatches. Resume replays exactly the unrecorded units. Same unit as the existing dispatch, so
    the two cannot drift out of correspondence.

11. **The ledger is written and read by a CLI COMMAND, not by skill text.** This is Phase 170's
    central finding applied directly: a ledger is pure mechanics, and instruction-shaped mechanics
    get skipped. Skill text's only job is to invoke the command.

12. **Verify reuses `SKETCH.md`'s EXISTING session lock**, with a verify-shaped identity, so a
    verify pass and a chunk build cannot run concurrently over one project. Reuse the documented
    24-hour staleness rule and the resume-refresh path verbatim.
    Rejected: a separate verify-only lock — two lock mechanisms means neither is trusted, and the
    existing lock already has a tested staleness/false-alarm design (SKILLDEF-01).

### Area 4 — Skill shape and VERIFY-07 enforcement (accepted by the user, 2026-07-28)

13. **Layout: `bs/verify-game.md` + a `bs/verify/` subdirectory**, mirroring `bs/ingest/` and
    `bs/build/` exactly. Registered in `install-claude-command.ts`'s skill list (the mechanical half
    of VERIFY-01) and surfaced in its post-install summary alongside the other bs- skills.

14. **VERIFY-07 is enforced STRUCTURALLY, not by restatement.** The orchestrator only ever receives
    subagents' structured return summaries; the re-transcription subagent is handed its output path
    and writes there directly, never returning slice content. This mirrors
    `ingest/transcription-subagent.md`'s existing hard rule — "RETURN a structured summary only —
    never the transcribed text itself" — which is the shape that already works.
    Rejected: restating the context-economics rule in prose and trusting it. Phase 170 disproved
    exactly that.

15. **Reuse `ingest/transcription-subagent.md` UNCHANGED, parameterized by output directory.**
    Forking a verify-specific copy guarantees the two transcriptions drift, and any drift between
    them makes every subsequent diff a false positive — the pass-1-vs-pass-2 comparison is only
    meaningful if both passes ran the same instructions. This is the same copy-drift trap that
    produced `f73153a3`, its latent recurrence fixed in Phase 172, and 172's duplicated path guard.

16. **This phase classifies NOTHING.** It stages and records. Phase 174 owns the classifier.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/slash-command/bs/ingest/transcription.md` (191 lines) — the fan-out dispatch, the
  context-economics hard rule, per-section user confirmation, and "Orchestrator Records (never
  writes slices, never re-reads them)". The verify orchestrator is this file's sibling.
- `src/cli/slash-command/bs/ingest/transcription-subagent.md` (199 lines) — reused UNCHANGED per
  decision 15. Note its `## Scope limit` and its structured-return contract.
- `src/cli/commands/ingest-archive.ts` — `ingest-archive` is invoked directly by decision 1's
  adoption path; it already computes the hash and rewrites `INDEX.md`'s header
  (`HEADER_LABELS`, `relArchivePath = \`rulebook/source/${fileName}\``, line ~495). Also the home of
  the fenced machine-owned region pattern decision 9 reuses.
- `src/cli/commands/build-manifest.ts` (Phase 172) — the line-anchored `findHeadingIndex` and
  `resolveManifestPath`. Any new parsing in this phase uses these; it does not hand-roll a third
  heading locator (that defect class has now recurred twice).
- `src/cli/commands/chunk-provenance.ts` (Phase 171) — where the provenance block decision 7 writes
  into lives, and the `--json` convention.

### Established Patterns
- `src/cli/slash-command/bs/state-machine.md` is the shared authority: Status Enum, Write Order,
  **Cold-Resume Parse Contract** (decision 4's stop-and-ask rule), **Consistency Check** run by every
  bs- entry point, **Session Lock** (decision 12), **Git Protocol**, **Autonomy Scope: How, Never
  What (PROC-02)** (decision 2's gate). `/bs-verify-game` is a bs- entry point and therefore runs the
  consistency check on entry like every other one.
- Skills install via `src/cli/commands/install-claude-command.ts` — a `SKILLS` array of
  `{ source, skillName }` plus a post-install summary block (~line 233).
- Commands register in `src/cli/cli.ts` one-file-per-command in `src/cli/commands/` with a colocated
  `*.test.ts`.

### Integration Points
- Phase 171's provenance fields are what this pipeline reads and writes; Phase 172's `trace-check` /
  `drift-check` are what it will eventually route findings through (Phase 175+). This phase must not
  wire the checks in — it establishes the pipeline they will later plug into.
- `/bs-check-status` should learn that a verify run exists / is resumable, but only if that falls out
  cheaply; it is not a requirement of this phase.

### Cross-repo proof targets
- `~/BoardSmithGames/seven` — READ-ONLY, pinned `a03f38d4792af9dfc7c798be69686fc3230f54dd`,
  porcelain-empty. 17 chunks, 4 slices, 2-page `rules.pdf`.
- `~/BoardSmithGames/one-two-punch` — pinned `7e69471bd8980a854f3e351f2f486e1fb6f712b9`; do NOT
  assert porcelain-empty (pre-existing unrelated deletions).
- **Both are pre-provenance**, so both exercise decision 1's adoption path. Use the Phase 171/172
  copy-based proof harness (`cp -R`, run against copies only, verify originals byte-identical
  before and after). It is now proven twice; reuse it verbatim.
</code_context>

<specifics>
## Specific Ideas

- The adoption path (decision 1) is the single highest-risk item and is planned FIRST as wave 1,
  because decision 1b's `ingest-archive` fix gates everything: no other success criterion can be
  proven against a real game until an adopted project actually computes `full` scope rather than
  `pre-provenance`. The wave-1 exit condition is exactly that — run adoption on copies of both
  games and confirm `chunk-provenance-status` reports the adopted scope, not merely that the
  command exited 0. **`ingest-archive` reported success while doing damage; do not trust an exit
  code as the proof.**
- Success criterion 4 (kill mid-run, re-invoke, resume) demands a REAL interrupted run, not a unit
  test of the ledger reader. Plan an actual kill-and-resume proof.
- Success criterion 3 (orchestrator never reads a slice) is an ABSENCE, which is hard to prove.
  Consider what observable evidence would demonstrate it — e.g. the orchestrator's own transcript
  never containing slice bodies, or a structural check that the dispatch passes a path and receives
  a summary. Decide the evidence during planning rather than asserting compliance at the end.
- Phase 170 spent itself discovering that instruction-shaped mechanisms get skipped. This phase adds
  at least two new skill-text→command invocations. Plan a proof that each one actually runs on a
  live session, rather than assuming it does. **Still unproven and carried forward: `/bs-build-chunk`
  Step 0's `ingest-check` call has never been exercised by a live session.**
- `run-id` wants to be sortable and collision-free without a clock the session can fabricate —
  `state-machine.md` already mandates `date -u +%Y-%m-%dT%H:%M:%SZ` as the only sanctioned timestamp
  source for the session lock. Reuse that rule rather than inventing an id scheme.

</specifics>

<deferred>
## Deferred / Carried In

Carried in, still open:
- **F-3** (from `170-PROOF-RUN-2.md`) — ownership of `boardsmith.json`'s stub `description`/`playtime`
  after `init` is unstated. Not this phase; still a todo.
- `/bs-build-chunk` Step 0's `ingest-check` call has never been exercised live (see specifics).

Deferred out of this phase:
- Classification (174), impact map + repair gating (175), stale-chunk repair (176), derived-line
  re-derivation (177), worked-example tests (178), source-free mode (179).
- Cutover / promoting staged slices over live ones.
- A retention or pruning policy for old `.verify/<run-id>/` runs (decision 7).
- Wiring `trace-check` / `drift-check` findings into the verify report.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never
again gate whether a manual pass is run.** It certified a broken contract twice.
</deferred>
