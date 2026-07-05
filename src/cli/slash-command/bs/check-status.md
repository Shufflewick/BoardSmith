# `/bs-check-status` — Where Are We?

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean, READ-ONLY reader: it reads `SKETCH.md`, the in-progress chunk's `CHUNK.md`, and
`ASSETS.md` directly, and dispatches **no subagents** — cite `build-chunk.md`'s Context-Economics
Hard Rule, "reading state files is exactly the orchestrator's job." It does not explain the
status enum, the step names, the session lock, or the consistency check inline — see
`state-machine.md` for all of that.

Run any time the designer wants to know where the project stands. This is a query, never a
mutation — this session performs no writes of any kind, not even a housekeeping refresh of the
session-lock timestamp. It may REPORT the lock state it finds (cite `## Session Lock`), but it
never takes, refreshes, or clears the lock. Repair of any inconsistency the check finds below is
`/bs-build-chunk`'s job, not this skill's — this skill reports problems and confirms with the
user how to proceed; it does not repair them itself.

## Step 0: Consistency Check on Entry

On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check (every bs- entry point, before proceeding)"). Use literal `ls <file>` checks
in the current directory, never `**/glob` patterns that search subfolders. Report any problems
found (a sketch slug with no matching `chunks/<slug>/` directory, a directory with no matching
sketch entry, a status that doesn't parse, or a stale session lock) and confirm with the user how
to proceed before continuing — this skill never silently repairs a problem it finds, and it never
guesses the intended state. If `SKETCH.md` does not exist at all, report that no project has been
ingested yet and stop here — there is nothing to report status on.

## Body: Read, Then Synthesize the Seven Items

Read `SKETCH.md`'s `## Ordered Chunk List`, then the in-progress chunk's `chunks/<slug>/CHUNK.md`
(derived below), then `ASSETS.md`. Synthesize exactly the following seven items — this is the
canonical contract (see `.planning/bs-skills-plan.md` "/bs-check-status"). Do not add or omit
items.

**1. Chunks done/remaining.** Walk every entry in the `## Ordered Chunk List`. An entry is "done"
when its derived status (or, for the tail, its sketch-level marker) reads `verified` or
`verified (user-waived)`; everything else — `proposed`, `approved`, `built`, `stale — re-derive
before build`, and every sketch-level tail entry — is "remaining." Report both counts and, for
"remaining," the ordered list of what's left.

**2. Current chunk + current step.** Derive the current chunk exactly the way `build-chunk.md`
Step 2 does — cite it, do not re-derive the rule independently: the current chunk is the first
entry in the `## Ordered Chunk List` whose derived status is neither `verified` nor `verified
(user-waived)`. If that entry is still a sketch-level tail entry (no `chunks/<slug>/` directory
yet), report it as "not yet detailed" rather than reading a CHUNK.md that doesn't exist — do not
create one; detailing a tail entry is `/bs-build-chunk`'s job. Otherwise, read that chunk's
`## Step Checklist` and report the current step as the first unchecked `- [ ]` item, using the
same first-incomplete-step rule `build-chunk.md` Step 2 applies (reuse it verbatim in spirit; do
not invent new derivation logic).

**3. Outstanding playtest feedback.** Read the current chunk's `## Revision Rounds`. Report any
round whose triaged feedback items have not yet reached a recorded disposition (see
`templates/CHUNK.template.md` "## Revision Rounds" — category (a) this-chunk-defect items are the
ones still open until fixed and re-tested clean). If there are none, say so explicitly rather than
omitting the item.

**4. Waived verifications.** Scan the entire `## Ordered Chunk List` for entries whose derived
status reads `verified (user-waived)` (see `state-machine.md` "Status Enum (exact)" — cite it, do
not restate the enum). List every waived chunk found. If two or more accumulate, propose a batch
playtest covering all of them in one sitting — this is the surfacing mechanism
`build-chunk.md`'s "playtest" step defers to this skill (`.planning/bs-skills-plan.md` "8.
playtest": "check-status surfaces accumulated waived chunks and proposes a batch playtest"). If
there are zero or one waived chunks, report the count and skip the batch proposal.

**5. Outstanding asset debts.** Read `ASSETS.md`'s `## Ledger`. An asset debt is any row where
`requested = yes` AND `received = no`. List each such row's `needed-by-chunk` and `file path`.
This is informational, never blocking — a missing asset never blocks a chunk (see
`templates/ASSETS.template.md`'s placeholder policy note); report it as a debt to keep visible,
not as something to fix here.

**6. Ideas backlog size.** Read `SKETCH.md`'s `## Ideas Backlog` and report the count of entries.

**7. The exact next command.** Derive this from what was found above — never guess, derive it
from the state just read:
- If the current chunk exists and is not yet fully verified — whether it is mid-ceremony (some
  steps checked, more remain), detailed but not yet started (zero steps checked), or still a
  sketch-level tail entry "not yet detailed" (no `chunks/<slug>/` directory yet, per Item 2) — the
  next command is `/bs-build-chunk` (to start, detail, or resume it). This one bullet covers every
  in-progress state so none falls through.
- If a sketch reshape was just discussed with the user in this same conversation (reordering,
  inserting, splitting, or removing a chunk), the next command is `/bs-insert-chunk` (this
  overrides the build-chunk case above).
- If nothing has started yet (no `SKETCH.md`, caught at Step 0 above), the next command is
  `/bs-ingest-rules`.

Present all seven items together as one report, in the order above, followed by the exact next
command on its own line.

## Read-Only Posture (explicit)

This skill performs **no writes** of any kind — not to `SKETCH.md`, not to any `CHUNK.md`, not to
`ASSETS.md`, and not to the session-lock timestamp inside `SKETCH.md`. It may REPORT the
`## Session Lock` note it finds (cite `state-machine.md` "Session Lock") — whether a lock exists,
which chunk it names, and whether it looks stale — but it never takes, refreshes, or clears that
lock; refreshing a live-resume lock is `/bs-build-chunk`'s job (Step 0's "Same chunk resume"
outcome), not this skill's. If Step 0's consistency check finds a problem, this skill reports it
and asks the user how to proceed — it never repairs `SKETCH.md` or a `CHUNK.md` itself. There is
no mode, flag, or user request that causes this skill to write a state file; if a user asks this
skill to fix something it found, direct them to `/bs-build-chunk` or `/bs-insert-chunk` instead.

## Reference Files

This skill cites the shared reference files that ship with every `bs-` skill — it does not
duplicate their content:

- `state-machine.md` — status enum, consistency check, session lock, write order, authority
- `templates/SKETCH.template.md` — the `## Ordered Chunk List` / `## Ideas Backlog` grammar this
  skill reads from
- `templates/CHUNK.template.md` — the `## Step Checklist` / `## Revision Rounds` grammar this
  skill reads from
- `templates/ASSETS.template.md` — the asset ledger this skill reads from

**Installed location:** every relative path above (`state-machine.md` and `templates/`) resolves
against the directory containing THIS skill file — the installer copies the whole `bs/` tree as
one unit, so the shipped layout is identical wherever it is installed. (Installer-phase
dependency: `src/cli/commands/install-claude-command.ts` does not yet install the `bs-` skills;
the phase that teaches it to MUST preserve this skill-file-relative layout — `templates/` and
`state-machine.md` siblings of this file — or update this paragraph.)
