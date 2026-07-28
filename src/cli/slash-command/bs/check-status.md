---
name: bs-check-status
description: Report where a BoardSmith game project stands — chunks done/remaining, current chunk/step, outstanding playtest feedback, waived verifications, asset debts, ideas backlog, and the exact next command. Read-only. Use when the designer wants a status summary.
---

# `/bs-check-status` — Where Are We?

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean, READ-ONLY reader: it reads `SKETCH.md`, the in-progress chunk's `CHUNK.md`, and
`ASSETS.md` directly, and dispatches **no subagents** — cite `build-chunk.md`'s Context-Economics
Hard Rule, "reading state files is exactly the orchestrator's job." It does not explain the
status enum, the step names, the session lock, or the consistency check inline — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

Run any time the designer wants to know where the project stands. This is a query, never a
mutation — this session performs no writes of any kind, not even a housekeeping refresh of the
session-lock timestamp. It may REPORT the lock state it finds (cite `## Session Lock`), but it
never takes, refreshes, or clears the lock. Repair of any inconsistency the check finds below is
`/bs-build-chunk`'s job, not this skill's — this skill reports problems and confirms with the
user how to proceed; it does not repair them itself.

## Step 0: Consistency Check on Entry

On entry, before any other work, run the consistency check described in `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
("Consistency Check (every bs- entry point, before proceeding)"). Use literal `ls <file>` checks
in the current directory, never `**/glob` patterns that search subfolders. Report any problems
found (a sketch slug with no matching `chunks/<slug>/` directory, a directory with no matching
sketch entry, a status that doesn't parse, or a stale session lock) and confirm with the user how
to proceed before continuing — this skill never silently repairs a problem it finds, and it never
guesses the intended state. If `SKETCH.md` does not exist at all, report that no project has been
ingested yet and stop here — there is nothing to report status on.

## Body: Read, Then Synthesize the Eight Items

Read `SKETCH.md`'s `## Ordered Chunk List`, then the in-progress chunk's `chunks/<slug>/CHUNK.md`
(derived below), then `ASSETS.md`. Synthesize exactly the following eight items — this is the
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
create one; detailing a tail entry is `/bs-build-chunk`'s job. If instead that chunk's `Status:`
reads `stale — re-derive before build` (`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Status Enum (exact)"), report it as
"stale — needs re-derivation (run `/bs-insert-chunk` or re-derive)" and do NOT report a step off its
`## Step Checklist`: a stale chunk's checklist is invalid pending re-derivation, so `build-chunk.md`
Step 2 stops routing on it rather than resuming it as an ordinary pending chunk (`build-chunk.md`
"Status Enum and Stale Marker") — reporting a "current step" off an invalid checklist would be
bogus. Otherwise, read that chunk's `## Step Checklist` and report the current step as the first
unchecked `- [ ]` item, using the same first-incomplete-step rule `build-chunk.md` Step 2 applies
(reuse it verbatim in spirit; do not invent new derivation logic).

**3. Outstanding playtest feedback.** If the current chunk is not yet detailed (a sketch-level tail
entry with no `chunks/<slug>/CHUNK.md` yet — see the same guard in Item 2), report
"n/a — current chunk not yet detailed" and SKIP the Revision Rounds read entirely; do not attempt
to read a `CHUNK.md` that does not exist. Otherwise, read the current chunk's `## Revision Rounds`.
Report any round whose triaged feedback items have not yet reached a recorded disposition (see
`${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` "## Revision Rounds" — category (a) this-chunk-defect items are the
ones still open until fixed and re-tested clean). If there are none, say so explicitly rather than
omitting the item.

**4. Waived verifications.** Scan the entire `## Ordered Chunk List` for entries whose derived
status reads `verified (user-waived)` (see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Status Enum (exact)" — cite it, do
not restate the enum). List every waived chunk found. If two or more accumulate, propose a batch
playtest covering all of them in one sitting — this is the surfacing mechanism
`build-chunk.md`'s "playtest" step defers to this skill (`.planning/bs-skills-plan.md` "8.
playtest": "check-status surfaces accumulated waived chunks and proposes a batch playtest"). If
there are zero or one waived chunks, report the count and skip the batch proposal. This is also
the **waived-chunk ledger** `build/close.md`'s Bookkeeping Sequence ledger-reconciliation step
(SKILLAUTO-08) reads at each chunk's close — this scan is the source of truth that reconciliation
step reconciles against, cited by name, never re-derived.

**5. Outstanding asset debts.** Read `ASSETS.md`'s `## Ledger`. An asset debt is any row where
`requested = yes` AND `received = no`. List each such row's `needed-by-chunk` and `file path`.
This is informational, never blocking — a missing asset never blocks a chunk (see
`${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md`'s placeholder policy note); report it as a debt to keep visible,
not as something to fix here. This is also the **asset-debt ledger**
`build/close.md`'s Bookkeeping Sequence ledger-reconciliation step (SKILLAUTO-08) reads at each
chunk's close — this scan is the source of truth that reconciliation step reconciles against,
cited by name, never re-derived.

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
- (Note, not a live branch:) the no-`SKETCH.md` case is terminal at Step 0 — it stops and returns
  "no project has been ingested yet" before this eight-item synthesis is ever reached, so this item
  never fires for it. Documented here only so the next-command mapping is complete: that case maps
  to `/bs-ingest-rules`.

**8. Verification provenance and drift.** Run `boardsmith chunk-provenance-status --json` and
FORMAT its output — do not compute any of it here. Report: how many chunks are `full`,
`code-conformance-only` (with each one's reason code), and `unknown`; which rulebook edition and
skills-tree hash each group was verified against, calling out drift when more than one of either
is present; and, under its own heading, every slug in `verifiedWithoutProvenance` — chunks that
claim verification with no provenance record behind them. `unknown` means the chunk was verified
before provenance recording existed; it is not the same as `code-conformance-only` and must not
be reported as it.

Consume the command's own `projectProvenanceState` field rather than re-deriving severity from
the raw `verifiedWithoutProvenance` count: a `pre-provenance` project (no chunk in it carries a
`## Verified Against` block at all — both reference games are in this state, 12 and 17 chunks)
has every verified chunk flagged BY DEFINITION, and that is expected, not an alarm — report it
as informational, not a warning. `partial` (the project DOES record provenance elsewhere, yet
some verified chunk has none) is the suspicious case — the signature of a skipped `chunk-check`
at close — and is the one severity worth calling out. This skill formats that distinction; it
does not recompute it.

This command is read-only — item 8 does not violate this skill's no-writes-of-any-kind posture
(see `## Read-Only Posture (explicit)` below).

Present all eight items together as one report, in the order above, followed by the exact next
command on its own line.

## Read-Only Posture (explicit)

This skill performs **no writes** of any kind — not to `SKETCH.md`, not to any `CHUNK.md`, not to
`ASSETS.md`, and not to the session-lock timestamp inside `SKETCH.md`. Item 8's
`boardsmith chunk-provenance-status --json` call is itself read-only (it aggregates and reports;
it never writes a `CHUNK.md`), so it does not violate this posture. It may REPORT the
`## Session Lock` note it finds (cite `state-machine.md` "Session Lock") — whether a lock exists,
which chunk it names, and whether it looks stale — but it never takes, refreshes, or clears that
lock; refreshing a live-resume lock is `/bs-build-chunk`'s job (Step 0's "Same chunk resume"
outcome), not this skill's. If Step 0's consistency check finds a problem, this skill reports it
and asks the user how to proceed — it never repairs `SKETCH.md` or a `CHUNK.md` itself. There is
no mode, flag, or user request that causes this skill to write a state file; if a user asks this
skill to fix something it found, direct them to `/bs-build-chunk` or `/bs-insert-chunk` instead.

## Reference Files

This skill cites the shared reference files that ship with every `bs-` skill — it does not
duplicate their content. Item 8 above additionally runs `boardsmith chunk-provenance-status
--json` — a CLI command, not a file, so it is described in the body where the item is
synthesized rather than listed here:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session lock, write order, authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` — the `## Ordered Chunk List` / `## Ideas Backlog` grammar this
  skill reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` — the `## Step Checklist` / `## Revision Rounds` grammar this
  skill reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md` — the asset ledger this skill reads from

**Installed location:** this file installs as `.claude/skills/bs-check-status/SKILL.md`. The
shared `templates/` and `state-machine.md` referenced above install under the `bs-shared/`
namespace root alongside `bs-check-status/` — one directory up from this file then into
`bs-shared/`, at `.claude/skills/bs-shared/templates/` and
`.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is Claude Code's built-in substitution
for "the directory containing THIS skill file," resolved to an absolute path before the model
ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/templates/...` resolves correctly whether this
skill is installed at the project (`.claude/skills/`) or personal (`~/.claude/skills/`) level.
The installer phase (`src/cli/commands/install-claude-command.ts`) MUST preserve this layout —
`templates/` and `state-machine.md` under the `bs-shared/` root beside every `bs-*` skill
directory under `.claude/skills/` — or update this paragraph.
