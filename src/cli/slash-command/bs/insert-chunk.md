# `/bs-insert-chunk` — Reshape the Sketch

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if you
are extending this skill, link to the relevant section instead of copying rule text. This file is
a lean EDITOR of `SKETCH.md`/`CHUNK.md` state: it reads those state files directly and, per this
skill's own discretion, performs the citation-overlap diff below INLINE — it never dispatches
subagents to do this work. This skill FLAGS overlaps; it does not trigger revise rounds,
re-investigate a chunk, or dispatch a redteam round itself — those remain `/bs-build-chunk`'s job.

Run any time the designer wants to add, reorder, split, or remove a chunk from the sketch.

## Step 0: Consistency Check on Entry

On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check (every bs- entry point, before proceeding)"). Use literal `ls <file>` checks
in the current directory, never `**/glob` patterns. Report any problems found and confirm with the
user how to proceed before continuing — this skill never silently repairs a problem it finds
outside the scope of the reshape it was asked to perform.

## The Operations

Every reshape (add, reorder, split, remove) runs all of the following, in order. Operation (e) is
the load-bearing mutation — the actual edit to the `## Ordered Chunk List` — and is enumerated
explicitly so its content and write-order placement are never left implicit.

**(a) Dependency-order re-validation.** Compare the moved/new chunk's `- Citations:` (from its
SKETCH.md entry) — or, if it is already detailed, its `## Interpretation` citations (from
`chunks/<slug>/CHUNK.md`) — against the ordered positions of chunks covering the same rulebook
section. A chunk that cites rules a not-yet-`verified`/`verified (user-waived)` chunk covers is a
dependency-order violation — name it concretely and propose the minimal prerequisite.
**Negotiation posture:** the user's ordering wins unless a hard dependency is violated, in which
case name the dependency concretely and propose the minimal prerequisite (same posture
`ingest-rules.md`'s Step 6 Approval Gate uses).

Fold in the `## Mandated Chunks` invariant guard here (OQ2 resolved YES — `templates/
SKETCH.template.md` "## Mandated Chunks"): a reshape must never leave the sketch without all three
mandated chunks, and must never change their required positions. Apply ONE consistent rule to every
mandated chunk — reject both any `remove` targeting it AND any `reorder` that displaces it:
- The core-event-loop chunk (the first chunk) must remain present AND stay at position one — reject
  any remove targeting it and any reorder that moves it off position one.
- The game-end/scoring/winner-determination chunk must remain present — reject any remove targeting
  it.
- The final-acceptance chunk must remain present AND stay the last entry (the tail) — reject any
  remove targeting it and any reorder that moves it off the tail.

`remove` is a first-class operation (see the heading below), so a "remove the final-acceptance
chunk" or "remove the core-event-loop chunk" request is a reachable delete path this guard must
block — not merely a reorder. Removing a mandated chunk is permitted ONLY when the user explicitly
replaces it with another chunk serving the same mandated role in the same required position — never
as a silent drop. Flag any violation concretely rather than allowing the reshape to silently break a
mandated structural invariant.

**(b) Closed-chunk citation-overlap diff.** For each CLOSED chunk (`Status` reads `verified` or
`verified (user-waived)` — `state-machine.md` "Status Enum (exact)"), union its `## Interpretation`
citations with its `## Newly Discovered Citations` citations (both sections of `chunks/<slug>/
CHUNK.md`) into one citation set. Intersect that set with the new/edited chunk's citations. Flag
every overlap by name, in the plan's own example shape: "chunk `movement` implemented
05-movement.md; your insertion also cites it — that chunk may need a revise round." This
operation only flags — resolving an overlap (a revise round) is a later `/bs-build-chunk` session's
job, not this skill's.

**(c) Stale-marking.** For any already-DETAILED PENDING chunk — it has a `chunks/<slug>/`
directory and its Status is not `verified` or `verified (user-waived)` — that the sketch change
invalidates, set that `CHUNK.md`'s `Status:` line to `stale — re-derive before build` (byte-exact,
em-dash). Only the `Status:` line changes; the rest of the chunk's content (Interpretation,
Redteam Rounds, Findings Ledger, etc.) is preserved untouched, never wiped. `build-chunk.md`
already documents the consumer side of this marker (a chunk whose Status reads `stale — re-derive
before build` stops routing rather than being resumed as an ordinary pending chunk) — this skill
is the PRODUCER of that marker; it does not restate the consumer behavior.

**(d) Version-stamp bump.** Increment `SKETCH.md`'s `Sketch Version: N` field to `N+1` (see
`templates/SKETCH.template.md`'s `Sketch Version:` field and its inline comment: "Bumped by
`/bs-insert-chunk` on every structural change to the ordered chunk list"). This is what lets a
concurrently resumed `/bs-build-chunk` session detect that the sketch changed under it. Preserve
the adjacent `Session Lock:` line exactly as found — this operation never touches the lock.

**(e) Ordered Chunk List edit — the reshape itself.** Actually add / reorder / split / remove the
entry in `SKETCH.md`'s `## Ordered Chunk List` (`templates/SKETCH.template.md` "## Ordered Chunk
List"). This is the entire point of the skill and must never be left implicit or skipped. It lands
in the SAME `SKETCH.md` write as the version bump (operation d): rewrite the `## Ordered Chunk List`
FIRST, then write the `Sketch Version:` line LAST, per `state-machine.md` "## Write Order". Never
bump the version stamp without rewriting the list, and never rewrite the list in a separate,
out-of-order write.

## Write Order

Cite `state-machine.md` "## Write Order" rather than restating it: within this reshape, `CHUNK.md`
edits (operation c, the stale-marking) land FIRST, then the `SKETCH.md` write lands SECOND. That
single `SKETCH.md` write carries BOTH the `## Ordered Chunk List` edit (operation e) and the version
bump (operation d): rewrite the ordered chunk list first, then the `Sketch Version:` line last.
Within each file, the `Status:` (or version) line is written last, after all other content for that
write has landed — this is what keeps every intermediate state valid for a cold resume.

## Close

After all operations land, print the exact next command: most reshapes end with
`/bs-build-chunk` (to continue building), but if more reshaping is queued in the same
conversation, the next command is another `/bs-insert-chunk`.

## Reference Files

This skill cites the shared reference files that ship with every `bs-` skill — it does not
duplicate their content:

- `state-machine.md` — status enum, stale marker, consistency check, session lock, write order,
  authority
- `templates/SKETCH.template.md` — the `## Ordered Chunk List` / `## Mandated Chunks` grammar this
  skill edits
- `templates/CHUNK.template.md` — the `## Interpretation` / `## Newly Discovered Citations` /
  `Status:` grammar this skill reads and edits
- `templates/ASSETS.template.md` — unaffected by a reshape, referenced for completeness only

**Installed location:** every relative path above (`state-machine.md` and `templates/`) resolves
against the directory containing THIS skill file — the installer copies the whole `bs/` tree as
one unit, so the shipped layout is identical wherever it is installed. (Installer-phase
dependency: `src/cli/commands/install-claude-command.ts` does not yet install the `bs-` skills;
the phase that teaches it to MUST preserve this skill-file-relative layout — `templates/` and
`state-machine.md` siblings of this file — or update this paragraph.)
