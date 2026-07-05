# Phase 147: `/bs-check-status` & `/bs-insert-chunk` - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Author the two thin state-reader/editor skills: `/bs-check-status` (STAT-01 — read-only status report) and `/bs-insert-chunk` (STAT-02 — safe sketch reshaping). Both are thin operators over the SKETCH.md/CHUNK.md state the ingest (142) and build-chunk (143-146) skills produce, and both run the shared consistency-check-on-entry defined in state-machine.md. Installer wiring is Phase 148; behavioral proof is Phase 149.

Canonical contract: `.planning/bs-skills-plan.md` §"/bs-check-status" + §"/bs-insert-chunk" + §"Consistency check" + §"Session lock" + the `state-machine.md` Consistency Check / Session Lock / Sketch Version / Write Order sections. `SKETCH.template.md` and `CHUNK.template.md` define the state these skills read/edit.

</domain>

<decisions>
## Implementation Decisions

### File Structure
- New skill files: `src/cli/slash-command/bs/check-status.md` + `src/cli/slash-command/bs/insert-chunk.md` — thin readers/editors, NO build/ subfolder (they are top-level skills like ingest-rules.md, not step references)
- New drift test: `src/cli/slash-command/bs/status-tools.test.ts` (mirrors ingest.test.ts / build-chunk.test.ts pattern) covering STAT-01/02 + cross-file consistency
- Both skills cite (never restate) state-machine.md's "Consistency Check", "Session Lock", "Sketch Version" / version-stamp, and "Write Order" sections; check-status also cites the ASSETS.template.md ledger + SKETCH.template.md ideas-backlog/waived structures it reads

### check-status / insert-chunk Semantics
- `/bs-check-status` (STAT-01): runs the consistency check on entry, then reads SKETCH.md + the current CHUNK.md and reports the SEVEN items — (1) chunks done/remaining, (2) current chunk and step, (3) outstanding playtest feedback, (4) waived verifications (`verified (user-waived)` chunks, batched with a proposed batch-playtest per the plan), (5) outstanding asset debts (from ASSETS.md), (6) ideas backlog size, (7) the exact next command to run. Read-only: never mutates state (no writes beyond nothing). Orchestrator reads state files itself (thin skill, no subagents needed)
- `/bs-insert-chunk` (STAT-02): add / reorder / split / remove chunks. Must: (a) re-validate dependency order against citations (a chunk citing rules another chunk hasn't built yet is a dependency violation — name it concretely, propose minimal prerequisite); (b) diff the new/edited chunk's citations against CLOSED chunks' citations and flag overlaps ("chunk `movement` implemented 05-movement.md; your insertion also cites it — that chunk may need a revise round"); (c) mark any already-detailed pending CHUNK.md as `stale — re-derive before build` (the exact stale marker Phase 141 shipped); (d) bump the sketch version stamp so a concurrently resumed build session detects the sketch changed under it (ties to the session-lock/version-stamp mechanism). Write order CHUNK→SKETCH and per-edit persistence apply
- Both run the consistency-check-on-entry (every slug-with-detailed-entry has a directory, every directory has a sketch entry, statuses parse, no stale session lock) and report+confirm problems before proceeding; check-status is a natural surface for a standalone consistency report

### Verification
- Structural drift test asserting: both files exist and are non-thin-pointer full content; STAT-01's 7 report items are enumerated; STAT-02's 4 operations + citation-dep revalidation + closed-chunk citation-overlap diff + stale-marking (`stale — re-derive before build` byte-exact) + version-stamp bump are present; both cite the correct state-machine.md sections; referenced files exist (no dangling pointers); check-status is read-only (asserts it states/does not instruct state mutation)
- Behavioral proof (actual status report / insert operation) deferred to Phase 149

### Claude's Discretion
- check-status report format/ordering, insert-chunk operation sub-structure, exact prompt wording, whether insert-chunk dispatches a citation-diff subagent or does it inline (it's thin — likely inline)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` §check-status + §insert-chunk + §Consistency check + §Session lock + §Git protocol (session lock note) — the spec
- `bs/state-machine.md` — "Consistency Check (every bs- entry point)", "Session Lock" (24h staleness), "Sketch Version" / version stamp, "Write Order" — the sections both skills CITE
- `bs/ingest-rules.md` + `bs/build-chunk.md` — the top-level-skill idiom (consistency-check-on-entry, Installed location paragraph, cite-not-restate, "print what to run next"); ingest-rules.md is the closest analog (thin-ish orchestrator that reads/writes SKETCH state)
- `bs/templates/SKETCH.template.md` — ordered chunk list, ideas backlog, deferred variants, sketch version stamp, session lock note, tail entries (what check-status reads, insert-chunk edits)
- `bs/templates/CHUNK.template.md` — status grammar, `stale — re-derive before build` marker (insert-chunk sets), waived status; `bs/templates/ASSETS.template.md` — asset debt ledger (check-status reads)
- `bs/ingest.test.ts` (41) + `bs/build-chunk.test.ts` (112) + `bs/templates.test.ts` (44) — the drift-test pattern for status-tools.test.ts

### Established Patterns
- Top-level skill = lean orchestrator that reads state files itself (thin skills need no subagents); citation-not-restatement; consistency-check-on-entry; every session ends printing the next command; byte-identical drift pins; content-assertion vitest

### Integration Points
- check-status reads state written by ingest + all 4 build-chunk groups (waived chunks from playtest, asset debts from ask/ingest, ideas backlog from revise, current step from CHUNK.md)
- insert-chunk's stale-marking + version bump is consumed by build-chunk.md's Step 0/2 (lock + version-change detection) and the close-gate sketch-tail delta
- Phase 148 installs both skills; Phase 149 dry-runs them

</code_context>

<specifics>
## Specific Ideas

- These are the two skills the plan explicitly calls "thin readers/editors of the same state" — resist scope creep into build/ingest territory
- check-status batches accumulated `verified (user-waived)` chunks and proposes a batch playtest (from the playtest step's design)
- insert-chunk's version-stamp bump is the concurrency-safety mechanism: a build session resumed after an insert detects the sketch changed under it (ties to session lock)
- Negotiation posture (plan): user's ordering wins unless a hard dependency is violated, named concretely with minimal prerequisite proposed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
