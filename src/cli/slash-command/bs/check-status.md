---
name: bs-check-status
description: Report where a BoardSmith game project stands — chunks done/remaining, current chunk/step, outstanding playtest feedback, waived verifications, asset debts, ideas backlog, unanswered questions, BoardSmith bugs filed, and the exact next command. Read-only. Use when the designer wants a status summary.
---

# `/bs-check-status` — Where Are We?

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean, READ-ONLY reader: it reads `SKETCH.md`, the in-progress chunk's `CHUNK.md`,
`ASSETS.md`, `QUESTIONS.md`, `FILINGS.md`, and `RUN.md` directly, and dispatches **no subagents** — cite `build-chunk.md`'s Context-Economics
Hard Rule, "reading state files is exactly the orchestrator's job." It does not explain the
status enum, the step names, the session lock, or the consistency check inline — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

Run any time the designer wants to know where the project stands. This is a query, never a
mutation — this session performs no writes of any kind, not even a housekeeping refresh of the
session-lock timestamp. It may REPORT the lock state it finds (cite `## Session Lock`), but it
never takes, refreshes, or clears the lock. Repair of any inconsistency the check finds below is
`/bs-build-chunk`'s job, not this skill's — this skill reports problems and confirms with the
user how to proceed; it does not repair them itself.

## How to Talk to the Designer

This skill's whole output is a report, so it is the one place structure is welcome — but it is
written in `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`'s voice, not the pipeline's. Report the
eleven items in plain words: what's done, what's left, what needs the designer, and the one command
to run next. Translate every internal spelling rather than printing it (`verified (user-waived)` →
"you chose to skip testing this one"; `rules-stale` → "needs re-testing, because the rules
underneath it changed"; `reopen-playtest` → "you'll need to play this one again after the fix").
Keep requirement tags, run ids, file paths, step names, and command names other than the next
command out of the body. A count belongs in the report only when it tells the designer something
about their game.

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
`design/` existed has.

**This skill is read-only, so it never passes `--fix`.** On a non-zero exit, read the paths from
the plain `doctor` report so the rest of this status pass reads the files where they actually are,
and tell the designer their project predates the current layout and one command
(`boardsmith doctor --fix`) moves it — then let them decide. Repair is `/bs-build-chunk`'s job,
exactly as it is for every other inconsistency this skill finds.

## Step 0: Consistency Check on Entry

On entry, before any other work, run the consistency check described in `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
("Consistency Check (every bs- entry point, before proceeding)"). Use literal `ls <file>` checks
in the current directory, never `**/glob` patterns that search subfolders. Report any problems
found (a sketch slug with no matching `chunks/<slug>/` directory, a directory with no matching
sketch entry, a status that doesn't parse, or a stale session lock) and confirm with the user how
to proceed before continuing — this skill never silently repairs a problem it finds, and it never
guesses the intended state. If `SKETCH.md` does not exist at all, report that no project has been
ingested yet and stop here — there is nothing to report status on.

## Body: Read, Then Synthesize the Eleven Items

Read `SKETCH.md`'s `## Ordered Chunk List`, then the in-progress chunk's `chunks/<slug>/CHUNK.md`
(derived below), then `ASSETS.md`, `QUESTIONS.md`, `FILINGS.md`, and `RUN.md`. Synthesize exactly
the following eleven items — this is the
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
  next command builds it. Which one depends on scope, and `RUN.md` decides it: if `RUN.md` exists
  and its `Run Status:` is `active` or `paused`, an orchestrated run is in play and the next command
  is `/bs-build-game` (it resumes at the open gate and keeps going through the remaining chunks);
  otherwise the next command is `/bs-build-chunk` for that one chunk, and mention `/bs-build-game`
  once as the way to build the rest in one run. This one bullet covers every in-progress state so
  none falls through.
- If a sketch reshape was just discussed with the user in this same conversation (reordering,
  inserting, splitting, or removing a chunk), the next command is `/bs-insert-chunk` (this
  overrides the build-chunk case above).
- (Note, not a live branch:) the no-`SKETCH.md` case is terminal at Step 0 — it stops and returns
  "no project has been ingested yet" before this nine-item synthesis is ever reached, so this item
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

**9. Rules staleness and the repair gate.** Run `boardsmith verify-impact-status --json` and
FORMAT its output — do not compute any of it here. Distinguish this explicitly from item 8: item 8
reports what a chunk was verified AGAINST; item 9 reports whether the rulebook underneath it has
since MOVED. The chunk-level marker's value is `rules-stale — rulebook moved since this chunk was verified`.

This is an entirely different, unrelated marker from item 2's Status-line carve-out above — the
two describe opposite situations (never built, vs. already built and rules-stale) and are never
described as the same thing. See `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`'s "Rules Staleness Marker" section rather than restating it here.

Report the fraction as `"N of M chunks rules-stale"`, taken directly from the command's
`staleFraction` field, and list EVERY slug in `staleSlugs` — never capped, never truncated, never
"and N more". State the reason in the prose: on short, heavily cross-referenced rulebooks the stale
set is broader than ideal (Phase 174 measured 6 of 16 on `seven` and 6 of 11 on `one-two-punch`),
and truncating that list would hide exactly the signal the designer needs.

Group by the command's own `gate.disposition`, consuming `dispositionCounts` rather than
re-deriving severity — the same discipline item 8 applies to `projectProvenanceState`. Explain each
group in one clause: `reopen-playtest` (repair will re-open the human playtest gate because the
chunk's code moved), `close-without-replaytest` (the chunk passes unchanged and closes with no
re-playtesting), `unknown-drift` (code movement could not be determined — reported as undecided,
never as clean), `not-applicable` (the chunk never had a playtest gate to re-open).

Report `contradictionsPending` under its own heading when non-empty, naming `/bs-verify-game`'s
adjudication gate as where they are answered — `check-status.md` reports them, it never answers
them.

If no verify run exists yet, the command has nothing to report and this item says so plainly
rather than inventing a zero (never a fabricated clean).

This command is read-only — item 9 does not violate this skill's no-writes-of-any-kind posture
(see `## Read-Only Posture (explicit)` below).

**10. Unanswered questions.** Read `QUESTIONS.md`'s `## Ledger`. Report every entry whose `Answer:`
is still `pending` — the question in the designer's own words, and which part of the game raised it.
These are the things the pipeline is waiting on them for; if a run is paused with an open gate
(`RUN.md`'s `Open Gate:`), say which of these questions is that gate. If there are none, say so
explicitly rather than omitting the item. Never re-pose an ANSWERED entry here: a report is not a
gate, and re-surfacing a settled answer reads as re-asking it
(`${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/questions.md`).

**11. BoardSmith bugs and gaps filed.** Read `FILINGS.md`'s `## Ledger`. Report each entry whose
`Reported:` is `recorded` (found, not yet reported upstream) or `posted`/`posted-by-designer` with
an open issue, in plain terms: what BoardSmith can't do yet, whether this game worked around it,
and whether it has been reported. Name the ones still only recorded as things the designer may want
reported — reporting them is `/bs-build-game`'s job
(`${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/filings.md`), never this skill's, which stays
read-only. A `declined` filing is not reported here; the designer already decided. If `FILINGS.md`
does not exist, check for a pre-conversion ledger under the older hand-rolled name
(`BOARDSMITH-BUGS.md`) and report from that instead — its one-time conversion is `/bs-build-game`'s
job, not this skill's (`${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/filings.md` "Adopting a
Pre-Existing Bug Ledger"). If neither exists, this game has hit no library gaps — say that plainly.

Present all eleven items together as one report, in the order above, followed by the exact next
command on its own line.

## Read-Only Posture (explicit)

This skill performs **no writes** of any kind — not to `SKETCH.md`, not to any `CHUNK.md`, not to
`ASSETS.md`, not to `QUESTIONS.md`, `FILINGS.md`, or `RUN.md`, and not to the session-lock timestamp
inside `SKETCH.md`. Items 10 and 11 read their ledgers and report them; answering a pending question
and reporting a filing upstream are `/bs-build-game`'s jobs. Item 8's
`boardsmith chunk-provenance-status --json` call and item 9's
`boardsmith verify-impact-status --json` call are themselves read-only (they aggregate and report;
neither ever writes a `CHUNK.md` or `SKETCH.md`), so neither violates this posture. It may REPORT the
`## Session Lock` note it finds (cite `state-machine.md` "Session Lock") — whether a lock exists,
which chunk it names, and whether it looks stale — but it never takes, refreshes, or clears that
lock; refreshing a live-resume lock is `/bs-build-chunk`'s job (Step 0's "Same chunk resume"
outcome), not this skill's. If Step 0's consistency check finds a problem, this skill reports it
and asks the user how to proceed — it never repairs `SKETCH.md` or a `CHUNK.md` itself. There is
no mode, flag, or user request that causes this skill to write a state file; if a user asks this
skill to fix something it found, direct them to `/bs-build-game`, `/bs-build-chunk`, or
`/bs-insert-chunk` instead.

## Reference Files

This skill cites the shared reference files that ship with every `bs-` skill — it does not
duplicate their content. Item 8 above additionally runs `boardsmith chunk-provenance-status
--json`, and item 9 runs `boardsmith verify-impact-status --json` — both CLI commands, not files,
so each is described in the body where its item is synthesized rather than listed here:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session lock, write order, authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` — the `## Ordered Chunk List` / `## Ideas Backlog` grammar this
  skill reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` — the `## Step Checklist` / `## Revision Rounds` grammar this
  skill reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md` — the asset ledger this skill reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/QUESTIONS.template.md` — the answer cache item 10 reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/FILINGS.template.md` — the filings ledger item 11 reads from
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/RUN.template.md` — the orchestrated-run journal items 7 and 10 read from

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
