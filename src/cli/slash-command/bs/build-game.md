---
name: bs-build-game
description: Build a whole BoardSmith game from its approved sketch — orchestrates one chunk at a time in fresh subagents, handles every question and playtest itself, files BoardSmith bugs upstream, and resumes cleanly after a /clear or crash. Use to run or resume a full build.
---

# `/bs-build-game` — Build the Whole Game

Cite `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`,
`${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`, and the `orchestrate/` reference files rather than
restating their rules — if you are extending this skill, link to the relevant section instead of
copying rule text. This file is a lean **run loop**: it checks the project, resolves run state,
dispatches one chunk at a time into a fresh subagent, conducts every human gate itself, and stops
only when it must. It does not explain the chunk pipeline, the status enum, or the session lock
inline — `/bs-build-chunk` and `state-machine.md` own those.

Run to start or resume a full build. `/bs-build-chunk` remains the single-chunk entry point (and is
exactly what this skill dispatches); this skill is the whole-game one.

## What This Skill Is For

Building a game is a long sequence of chunks, and the thing that used to end a session was context,
not progress: a chunk or two of real work filled the window, the designer was told to `/clear`, and
the next session started over — re-reading state, and too often re-asking questions they had already
answered. This skill removes that ceiling from the designer's session by moving the work off it.
Each chunk is built by a **fresh subagent** that burns its own context window and returns a short
report (`orchestrate/chunk-dispatch.md`). The orchestrator keeps only the conversation: the
questions, the playtests, the decisions, and the run's own journal. So a whole game can be built in
one sitting, and a `/clear` or a crash costs a re-invocation and nothing else.

Three things it owns that no single chunk can:

- **Answers that outlive the session.** Every question and answer is filed in the game's own
  `QUESTIONS.md`, and every dispatch carries the settled answers with it, so a question is asked
  once (`orchestrate/questions.md`).
- **Bugs that go where they can be fixed.** A BoardSmith bug or a genuine library gap found while
  building is filed in `FILINGS.md` and, with the designer's say-so, posted to the BoardSmith issue
  tracker (`orchestrate/filings.md`).
- **A resumable run.** `RUN.md` records which gate was open and why the last run stopped, so a cold
  start picks up exactly there (`orchestrate/run-state.md`).

## How to Talk to the Designer

Everything the designer reads follows `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`: lead with what
they need to do or say plainly that there's nothing, describe what changed in the game they can see,
and keep chunk slugs, step names, ledger names, file paths, dispatch counts, and status spellings out
of the body. This skill is chattier than most only in that it runs longer — that is not licence to
narrate the machinery. A chunk closing is one to three sentences about the game. A run of six chunks
is not six progress reports about a pipeline.

When relaying a subagent's work, relay **its** `designerSummary` — do not compose your own account
of work you did not do (`reporting.md` "Don't Defend the Work").

## Context-Economics Hard Rule

**The orchestrator never reads rulebook slices, BoardSmith docs, generated code, or a chunk's
`CHUNK.md` body.** It reads exactly: `SKETCH.md`, `RUN.md`, `QUESTIONS.md`, `FILINGS.md`, the
`Status:`/Step-Checklist lines of the chunk it is routing, and the verbatim gate payload a subagent
hands back. Everything else comes from a structured return
(`orchestrate/chunk-dispatch.md` "The Return Shape").

This is the rule the whole shape rests on. The moment the orchestrator starts reading slices or code
"to check the subagent's work," its context fills at the same rate a single session's did and the run
regains the ceiling it exists to remove. If the work needs checking, that is what the pipeline's own
adversarial audit steps are for — dispatch, don't re-read.

## Step 0: Entry — Layout, Ingest Synthesis, Consistency, Lock

Identical to `/bs-build-chunk` Step 0, which owns these checks — run them, do not re-derive them:

```bash
npx boardsmith doctor
npx boardsmith ingest-check
```

`doctor` is the layout gate: on a non-zero exit run `npx boardsmith doctor --fix` (it moves design
artifacts under `design/` with `git mv` and deletes nothing) and continue; never proceed against a
project that failed it. `ingest-check` repairs `rulebook/` synthesis when needed: on a non-zero exit
re-read `rulebook/INDEX.md`, re-run it, and only then continue. Then run the consistency check in
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Consistency Check", using literal `ls <file>`
checks, and resolve the session lock per that file's "Session Lock" — all three outcomes (same-chunk
resume refreshes silently, a different live lock warns and stops, a stale lock is reported for the
designer to clear), classified against the chunk this run is about to resume.

The run holds the lock for its whole duration, refreshing it at each dispatch boundary with a fresh
`date -u +%Y-%m-%dT%H:%M:%SZ` read. A dispatched subagent finds a lock naming the chunk it was sent
to build — its own Step 0 classifies that as a same-chunk resume and refreshes it, which is correct
and silent.

**If `SKETCH.md` does not exist,** there is no sketch to build from. Hand off to project kickoff by
reading `${CLAUDE_SKILL_DIR}/../bs-ingest-rules/SKILL.md` and following it in this same turn (the
handoff `/bs-create-game` uses — read the sibling instructions, never re-dispatch them as a separate
skill invocation). When it finishes, continue into Step 1 here.

## Step 1: Run State

Resolve `RUN.md` per `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/run-state.md`: create it from
`${CLAUDE_SKILL_DIR}/../bs-shared/templates/RUN.template.md` if this is the project's first
orchestrated run, otherwise run that file's six-step resume algorithm — read the journal, derive the
true build position from `SKETCH.md`, reconcile the two (`CHUNK.md` always wins), read the answered
and pending questions, and resolve any open gate **before** dispatching anything.

If this project predates the filings ledger — no `FILINGS.md`, but a hand-rolled
`BOARDSMITH-BUGS.md` — run that file's one-time conversion now, before the first dispatch, so a
chunk never files into two places (`${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/filings.md`
"Adopting a Pre-Existing Bug Ledger").

Then tell the designer where the run stands and what it will do next, in one or two sentences. On a
resume, lead with the open gate if there is one — that is the thing they are holding.

## Step 2: Confirm the Run

Before the first dispatch, say what the run will do and get a yes: how many chunks remain, that you
will build them one at a time, and that you will stop whenever you need a question answered or the
game played. Name the ones that will need them if the sketch already says so (the milestone chunks —
`state-machine.md`'s human-gate list). This is one short exchange, not a menu of options, and it
happens once per run — a resumed run that already has a yes does not re-ask; it reports and
continues.

If the designer wants a single chunk instead of a run, that is `/bs-build-chunk` — say so and stop.

## Step 3: The Chunk Loop

Loop until there is nothing left to build or a stop condition fires
(`orchestrate/run-state.md` "Stop Conditions"). Each pass:

1. **Derive the target chunk** from `SKETCH.md` exactly as `/bs-build-chunk` Step 2 does: the first
   entry whose derived status is neither `verified` nor `verified (user-waived)`. Never take it from
   `RUN.md` — the journal is not an authority (`orchestrate/run-state.md` "The One Authority Rule").
2. **Pick the pipeline** for it:
   - the sketch's bot-opponent chunk → `bs-build-bot` (see Step 6);
   - anything else, including the mandated final-acceptance chunk → `bs-build-chunk`, which routes
     ceremony and final-acceptance itself (`build-chunk.md` Steps 2-3). This skill never routes
     steps within a chunk.
3. **Refresh the lock**, append the `### Dispatch N` entry to `RUN.md` with `Outcome: pending`, and
   dispatch one fresh subagent per
   `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/chunk-dispatch.md` — its seven-field brief, its
   no-designer rule, and its return shape. One dispatch at a time, never two.
4. **Consume the return by field name** and fill that entry's `Outcome`/`Detail`. Then route on
   `outcome` per Step 4.

Between chunks, say one plain sentence about what the designer can now see in their game — or
nothing, if there is nothing visible yet. Do not announce each dispatch.

## Step 4: Routing a Return

- **`closed`** — relay the subagent's `designerSummary`, record any `assetsRequested` and `filings`,
  and continue the loop. No re-invocation prompt, no handoff: continuing is the default.
- **`gate`** — conduct the gate yourself, here, in the main thread. Relay the `payload` **verbatim**
  — an `ask` gate's four parts, a `playtest` gate's numbered script, a triage's options — because
  that text was composed by the step that owns its format
  (`build/ask.md` "The Fixed 4-Part Presentation Format", `build/playtest.md`). Write each question
  to `QUESTIONS.md` before the designer answers and their answer after, then the `RULINGS.md` or
  `DECISIONS.md` entry it earns, then clear `RUN.md`'s `Open Gate:`
  (`orchestrate/questions.md` "The Two Non-Negotiables"). Then **re-dispatch the same chunk** with
  the answers in its digest — the work never happens in this thread
  (`orchestrate/chunk-dispatch.md` "After the Return").
- **`filing`** — handle it per `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/filings.md`: confirm,
  then post to `Shufflewick/BoardSmith` with `gh`, or show the designer the issue to post when `gh`
  cannot. If the filing blocked the chunk, ask whether to skip to the next independent chunk or stop;
  if it was worked around, continue.
- **`context-ceiling`** — re-dispatch the same chunk. This is the ordinary case, not a problem, and
  the designer does not need to hear about it.
- **`stuck`** — stop the run. Tell the designer what the game cannot do yet and what would unblock
  it, in their terms, and write `Stop Reason: stuck`. Never retry a stuck chunk a third time, and
  never route around it by marking it verified.

## Step 5: Stopping

Stop for exactly the four reasons `orchestrate/run-state.md` "Stop Conditions" lists — the designer
said stop, a gate is unanswered, a dispatch is stuck, or this thread crossed its own context ceiling
— and never for a vaguer "this is getting long." Write `RUN.md`'s `Run Status:`/`Stop Reason:` last,
after everything else has landed, and print the one command that resumes it: `/bs-build-game`.

## Step 6: The bot Opponent, Then Final Acceptance

The run is not finished when the last rules chunk closes.

**The bot opponent.** When the sketch's bot-opponent chunk comes up, dispatch it against
`${CLAUDE_SKILL_DIR}/../bs-build-bot/SKILL.md` instead of the chunk pipeline (same brief, same return
shape). It belongs late — after game-end/scoring is verified, since an opponent needs real terminal
states to evaluate against. If the sketch has **no** bot-opponent chunk, ask the designer once,
before final acceptance, whether they want a computer opponent; if yes, dispatch a subagent against
`${CLAUDE_SKILL_DIR}/../bs-insert-chunk/SKILL.md` to insert it ahead of final acceptance (which
re-validates dependency order and bumps the sketch version — never edit the ordered chunk list by
hand), then continue the loop. If no, record the decision in `DECISIONS.md` and move on.

**Final acceptance.** The sketch's mandated final-acceptance chunk is the run's last chunk and runs
through `bs-build-chunk` like any other — its own routing dispatches the coverage check and design-QA
pass and then the human playtest of the finished game (`build-chunk.md` Step 2 "Final-acceptance
chunk target"). When it closes, set `Run Status: complete` and tell the designer their game is
finished, what it does, and anything still outstanding — open questions, asset debts, filings — in
one short list. That is the run's terminus; there is no next command to print.

## Reference Files

This skill delegates its heavyweight prose to:

- `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/chunk-dispatch.md` — the per-chunk subagent contract:
  dispatch mechanics, the seven-field brief, the return shape
- `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/run-state.md` — `RUN.md`, the resume algorithm, the
  stop conditions, the orchestrator's own context budget
- `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/questions.md` — the answer cache: ask once, record
  always, and the answered-questions digest every dispatch carries
- `${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/filings.md` — BoardSmith bug/feature reporting via
  `gh` to `Shufflewick/BoardSmith`, and the designer-posts fallback

And to the shared reference files that ship with every `bs-` skill:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session lock,
  write order, authority, session handoff seams, git protocol
- `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md` — how everything above is said to the designer
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/RUN.template.md` — the run journal this skill creates
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/QUESTIONS.template.md` — the answer cache this skill
  fills
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/FILINGS.template.md` — the filings ledger this skill
  reports from

The pipelines it dispatches: `${CLAUDE_SKILL_DIR}/../bs-build-chunk/SKILL.md`,
`${CLAUDE_SKILL_DIR}/../bs-build-bot/SKILL.md`, `${CLAUDE_SKILL_DIR}/../bs-insert-chunk/SKILL.md`.

**Installed location:** this file installs as `.claude/skills/bs-build-game/SKILL.md`. The shared
`orchestrate/`, `templates/`, `state-machine.md`, and `reporting.md` referenced above install under
the `bs-shared/` namespace root alongside `bs-build-game/` — one directory up from this file then
into `bs-shared/`. `${CLAUDE_SKILL_DIR}` is Claude Code's built-in substitution for "the directory
containing THIS skill file," resolved to an absolute path before the model ever sees the content, so
`${CLAUDE_SKILL_DIR}/../bs-shared/orchestrate/...` resolves whether this skill is installed at the
project (`.claude/skills/`) or personal (`~/.claude/skills/`) level. The installer phase
(`src/cli/commands/install-claude-command.ts`) MUST preserve this layout — `orchestrate/` under the
`bs-shared/` root beside every `bs-*` skill directory — or update this paragraph.
