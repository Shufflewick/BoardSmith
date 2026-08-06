---
name: bs-insert-chunk
description: Add, reorder, split, or remove a chunk in a BoardSmith game's sketch, re-validating dependency order and flagging citation overlaps with closed chunks. Use when the designer wants to reshape the plan.
---

# `/bs-insert-chunk` — Reshape the Sketch

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if you
are extending this skill, link to the relevant section instead of copying rule text. This file is
a lean EDITOR of `SKETCH.md`/`CHUNK.md` state: it reads those state files directly and, per this
skill's own discretion, performs the citation-overlap diff below INLINE — it never dispatches
subagents to do this work. This skill FLAGS overlaps; it does not trigger revise rounds,
re-investigate a chunk, or dispatch a redteam round itself — those remain `/bs-build-chunk`'s job.

Run any time the designer wants to add, reorder, split, or remove a chunk from the sketch.

## How to Talk to the Designer

Everything the designer reads follows `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`. In short:
lead with what they need to do, or say plainly that there's nothing; describe the plan change in
terms of what the game will and won't do, not in terms of sketch state; keep internal ids, file
paths, status spellings, and step names out of the body; never narrate bookkeeping. A citation
overlap is reported as what it means for their game ("this overlaps something you already tested —
you may need to play that part again"), never as a raw diff.

## Step 0a: Layout Check on Entry

Before anything else, run:

```bash
npx boardsmith doctor
```

Every design artifact this skill reads — `SKETCH.md`, `chunks/<slug>/CHUNK.md`, `ASSETS.md`,
`RULINGS.md`, `rulebook/` — lives under the project's `design/` directory, and every path named in
this file is written relative to it (see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
"Project Layout"): prepend `design/` whenever you actually Read one. `doctor` exits non-zero when
an artifact is still loose in the project root, which is the layout every game built before
`design/` existed has. On a non-zero exit run `npx boardsmith doctor --fix` — it moves everything
into place with `git mv` and deletes nothing — then continue. Never hand-move these files.

## Step 0: Consistency Check on Entry

On entry, before any other work, run the consistency check described in `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
("Consistency Check (every bs- entry point, before proceeding)"). Use literal `ls <file>` checks
in the current directory, never `**/glob` patterns. Report any problems found and confirm with the
user how to proceed before continuing — this skill never silently repairs a problem it finds
outside the scope of the reshape it was asked to perform.

**Live session-lock check (this skill WRITES state, so it must resolve a live lock).** The
consistency check's lock item (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "## Consistency Check" item 4) only detects a
*stale* lock (>24h). Because this reshape mutates state — operation (c) stale-marks a `CHUNK.md`,
operations (d)/(e) rewrite the ENTIRE `SKETCH.md` `## Ordered Chunk List` plus the version stamp —
you must ALSO handle a live (non-stale) lock exactly as `build-chunk.md` Step 0 outcome 2 does: if
the `SKETCH.md` `Session Lock:` note names ANY chunk (i.e. names in-flight work other than this
reshape) and the lock is NOT stale, warn the user and STOP for their decision before writing
anything. The condition is deliberately broad — NOT limited to a lock naming a chunk this reshape
will stale-mark or reorder — because this reshape rewrites the whole `## Ordered Chunk List` and
bumps the version stamp, so its write footprint is the entire `SKETCH.md` and can overlap ANY live
`/bs-build-chunk` session's in-flight SKETCH.md derived-pointer write, not just the reshaped entries.
Warn and STOP instead of silently clobbering it (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "## Session Lock": any live lock
naming different work triggers the warning; the plan's hard rule in
`.planning/bs-skills-plan.md`: "A second concurrent session, on entry, sees the lock note and warns
instead of silently clobbering"). Never touch, take, refresh, or clear the lock — only read it and
warn.

## The Operations

Every reshape (add, reorder, split, remove) runs all of the following. Operations (a)-(c) run in
the order shown; the single `SKETCH.md` write then rewrites the `## Ordered Chunk List` (operation
e) FIRST and stamps the new `Sketch Version:` line (operation d) LAST, per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
"## Write Order" (the version/status line is always written last). The two SKETCH.md operations are
therefore presented below in write order — list edit (e) before version bump (d) — so following the
list top-to-bottom is correct by construction; the letters are stable IDs, not a write sequence.
Operation (e) is the load-bearing mutation — the actual edit to the `## Ordered Chunk List` — and is
enumerated explicitly so its content and write-order placement are never left implicit.

**(a) Dependency-order re-validation.** Compare the moved/new chunk's `- Citations:` (from its
SKETCH.md entry) — or, if it is already detailed, its `## Interpretation` citations (from
`chunks/<slug>/CHUNK.md`) — against the ordered positions of chunks covering the same rulebook
section. A chunk that cites rules a not-yet-`verified`/`verified (user-waived)` chunk covers is a
dependency-order violation — name it concretely and propose the minimal prerequisite.
**Negotiation posture:** the user's ordering wins unless a hard dependency is violated, in which
case name the dependency concretely and propose the minimal prerequisite (same posture
`ingest-rules.md`'s Step 6 Approval Gate uses).

Fold in the `## Mandated Chunks` invariant guard here (OQ2 resolved YES — `${CLAUDE_SKILL_DIR}/../bs-shared/templates/
SKETCH.template.md` "## Mandated Chunks"): a reshape must never leave the sketch without all three
mandated chunks, and must never change their required positions. Apply ONE consistent rule to every
mandated chunk — reject both any `remove` targeting it AND any `reorder` that displaces it:
- The core-event-loop chunk (the first chunk) must remain present AND stay at position one — reject
  any remove targeting it and any reorder that moves it off position one.
- The game-end/scoring/winner-determination chunk must remain present — reject any remove targeting
  it.
- The final-acceptance chunk must remain present AND stay the last entry (the tail) — reject any
  remove targeting it and any reorder that moves it off the tail.

`remove` is one of the four reshape types operation (e) performs (add / reorder / split / remove),
so a "remove the final-acceptance chunk" or "remove the core-event-loop chunk" request is a
reachable delete path this guard must block — not merely a reorder. Removing a mandated chunk is permitted ONLY when the user explicitly
replaces it with another chunk serving the same mandated role in the same required position — never
as a silent drop. Flag any violation concretely rather than allowing the reshape to silently break a
mandated structural invariant.

**(b) Closed-chunk citation-overlap diff.** For each CLOSED chunk (`Status` reads `verified` or
`verified (user-waived)` — `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Status Enum (exact)"), union its `## Interpretation`
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

**(e) Ordered Chunk List edit — the reshape itself.** Actually add / reorder / split / remove the
entry in `SKETCH.md`'s `## Ordered Chunk List` (`${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` "## Ordered Chunk
List"). This is the entire point of the skill and must never be left implicit or skipped. It lands
in the SAME `SKETCH.md` write as the version bump (operation d), and is written FIRST within that
write: rewrite the `## Ordered Chunk List` FIRST, then write the `Sketch Version:` line LAST, per
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "## Write Order". Never bump the version stamp without rewriting the list, and
never rewrite the list in a separate, out-of-order write.

**(d) Version-stamp bump — written LAST.** Increment `SKETCH.md`'s `Sketch Version: N` field to
`N+1` (see `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md`'s `Sketch Version:` field and its inline comment: "Bumped
by `/bs-insert-chunk` on every structural change to the ordered chunk list"). Within the single
SKETCH.md write, this `Sketch Version:` line lands LAST — after the `## Ordered Chunk List` edit
(operation e) — per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "## Write Order". This is what lets a concurrently resumed
`/bs-build-chunk` session detect that the sketch changed under it. Preserve the adjacent
`Session Lock:` line exactly as found — this operation never touches the lock.

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

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, stale marker, consistency check, session lock, write order,
  authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` — the `## Ordered Chunk List` / `## Mandated Chunks` grammar this
  skill edits
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` — the `## Interpretation` / `## Newly Discovered Citations` /
  `Status:` grammar this skill reads and edits
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md` — unaffected by a reshape, referenced for completeness only

**Installed location:** this file installs as `.claude/skills/bs-insert-chunk/SKILL.md`. The
shared `templates/` and `state-machine.md` referenced above install under the `bs-shared/`
namespace root alongside `bs-insert-chunk/` — one directory up from this file then into
`bs-shared/`, at `.claude/skills/bs-shared/templates/` and
`.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is Claude Code's built-in substitution
for "the directory containing THIS skill file," resolved to an absolute path before the model
ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/templates/...` resolves correctly whether this
skill is installed at the project (`.claude/skills/`) or personal (`~/.claude/skills/`) level.
The installer phase (`src/cli/commands/install-claude-command.ts`) MUST preserve this layout —
`templates/` and `state-machine.md` under the `bs-shared/` root beside every `bs-*` skill
directory under `.claude/skills/` — or update this paragraph.
