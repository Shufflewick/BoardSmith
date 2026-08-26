# Chunk Dispatch — One Fresh Subagent Per Chunk

Referenced by `build-game.md` Step 3 (The Chunk Loop). This file owns the dispatch contract: what
the orchestrator hands a chunk subagent, what that subagent is allowed to do, and the exact shape it
hands back. The orchestrator holds the designer's conversation; the subagent holds the work.

## Why a Subagent Per Chunk

A chunk's work — reading rulebook slices, writing code, running the adversarial audit lenses — is
what fills a context window. Running chunk after chunk in one session is what forced a `/clear`
every chunk or two, and every `/clear` cost the designer their answers and the run its momentum.
Dispatching each chunk into a **fresh context** moves that cost off the designer's session: the
subagent burns its window, returns a small structured report, and dies. The orchestrator's own
context grows by a few hundred tokens per chunk, so a whole game can be built in one sitting.

This is the same sub-agent-offload lever `state-machine.md` "Context floor + ceiling" already names,
applied one level up: there, steps offload to subagents inside a chunk; here, chunks offload to
subagents inside a run.

## Dispatch Mechanics

Dispatch with the **Agent tool** — one agent per dispatch, general-purpose, full tool access,
running in the game project directory. The subagent is told to **read the pipeline's own
instructions and follow them verbatim**: `${CLAUDE_SKILL_DIR}/../bs-build-chunk/SKILL.md` for an
ordinary chunk, `${CLAUDE_SKILL_DIR}/../bs-build-bot/SKILL.md` for the bot-opponent chunk,
`${CLAUDE_SKILL_DIR}/../bs-insert-chunk/SKILL.md` for a sketch reshape. Hand it the resolved
absolute path — the orchestrator has `${CLAUDE_SKILL_DIR}` expanded, the subagent does not.

Reading the sibling instructions is the only sanctioned handoff, exactly as `/bs-create-game`
hands off to the kickoff instructions by reading them: it keeps one implementation of the chunk
pipeline, executing in one context, with no second copy of its rules living in this file.

**Never dispatch two chunks at once.** Chunks share `SKETCH.md`, the ledgers, and the git working
tree; two concurrent dispatches would race on all three and interleave commits. The loop is strictly
sequential, and the session lock (`state-machine.md` "Session Lock") stays held by the run.

## The Brief (every field required)

The brief is the subagent's whole world — it has no memory of the run and no access to the
designer. Include all of:

1. **Project directory** — the absolute path to the game project. Its first act is to work there.
2. **Which pipeline to read** — the absolute path from "Dispatch Mechanics" above, with the
   instruction to follow it verbatim from its own Step 0 and to re-read anything it cites rather
   than assuming its content.
3. **The chunk slug** this dispatch is for, and this sentence, in these terms: **"You are running
   in orchestrated mode. Build exactly this one chunk and return. Do not auto-advance into the
   next chunk."** Orchestrated mode is always declared explicitly like this; a subagent never
   infers it (`build-chunk.md` "Orchestrated Mode").
4. **The answered-questions digest** — every settled answer from `QUESTIONS.md` that bears on this
   chunk, quoted as the designer gave it, with the `RULINGS.md`/`DECISIONS.md` entry each landed in
   (`orchestrate/questions.md` "The Digest"). This is what stops the pipeline re-asking a question
   the designer already answered in an earlier, now-forgotten session.
5. **The no-designer rule** — the subagent has no channel to the designer and must never behave as
   if it does: **it never asks a question, never waits for approval, and never assumes approval.**
   When it reaches a human gate it stops there and returns the gate payload for the orchestrator to
   put to the designer. It also never writes what a gate authorizes — no `Status: approved`, no
   ruling, no verified checklist — until a later dispatch arrives carrying the designer's actual
   answer (`build/ask.md` "Gate-Before-Write" holds unchanged; only who relays the answer changes).
6. **The filing rule** — a BoardSmith bug or a genuine library gap is recorded in `FILINGS.md` and
   returned in the report (`orchestrate/filings.md`); it is never patched into
   `node_modules/boardsmith` (`build/build.md` "Boundaries" rule 2), and it never silently becomes
   a workaround nobody wrote down.
7. **The return shape** below, verbatim, with the instruction that its final message must be
   exactly that report and nothing else.

## The Return Shape (consumed by field name)

The subagent's final message is a report in these fields. The orchestrator consumes it **by field
name** and never re-derives any of it by reading the chunk's files itself beyond the state lines it
already owns:

- `chunk` — the slug this dispatch was for.
- `outcome` — exactly one of:
  - `closed` — the chunk reached `close` (or the light path's equivalent) and its status is
    `verified` or `verified (user-waived)`.
  - `gate` — work stopped at a human gate. Requires `gate`.
  - `filing` — work stopped because a library gap or bug blocks the chunk outright. Requires
    `filings`, and the chunk is left at its last persisted step.
  - `context-ceiling` — the subagent hit its own context ceiling, persisted, and committed. Not an
    error; the orchestrator re-dispatches the same chunk.
  - `stuck` — an automated step cannot be made to pass and `repair` could not fix it. Requires
    `stuckDetail`.
- `stepsCompleted` — the pipeline step names it checked off this dispatch. For the run log only.
- `gate` — present when `outcome: gate`. Carries `kind` (`ask` | `playtest` | `rules-adjudication` |
  `repair-triage` | `tail-delta`), and `payload`: **the gate's full text exactly as the pipeline
  composed it for the designer** — an `ask` gate's four parts, a `playtest` gate's numbered test
  script, a triage's options. The orchestrator relays this payload; it does not rewrite it, and it
  never composes a substitute from the chunk's files.
- `questions` — every question this dispatch needs answered: each with `question` (designer
  language), `scope` (`this-chunk` | `cross-cutting` | `later-chunk`), and `options`. Written to
  `QUESTIONS.md` by the pipeline as they were posed; repeated here so the orchestrator can ask them
  without reading the ledger back.
- `filings` — every `FILINGS.md` entry this dispatch added or advanced: `id`, `kind`, `title`,
  `blocking` (true/false).
- `assetsRequested` — anything the designer needs to supply (art, copy), keyed to `ASSETS.md`. Never
  blocking (`build/ask.md` "Assets — Never-Blocking Placeholder Request").
- `designerSummary` — one to three sentences, in `reporting.md`'s voice, saying what changed in the
  game that the designer can see. This is the text the orchestrator relays; it never invents its own
  account of work it did not do.
- `stuckDetail` — present when `outcome: stuck`: what was stuck, what was tried, and what it would
  take to unblock.

A return missing a field its `outcome` requires is itself a stuck dispatch: the orchestrator does
not guess the missing half. Re-dispatch once with the missing field named; if the second return is
also malformed, stop the run and tell the designer plainly what did not come back.

## After the Return

The orchestrator, in this order: fills the `RUN.md` dispatch entry's `Outcome`/`Detail`
(`orchestrate/run-state.md` "Writing It"), records any `questions` and `filings`
(`orchestrate/questions.md`, `orchestrate/filings.md`), relays `designerSummary` if there is
anything the designer can see, and then routes on `outcome` per `build-game.md` Step 4.

**A `gate` outcome is answered, then re-dispatched — never resumed in the orchestrator's own
thread.** The orchestrator holds the conversation and the answer; the *work* always happens in a
fresh subagent, which picks up at the chunk's first incomplete step exactly as a cold resume does
(`build-chunk.md` Step 2). The orchestrator never continues a chunk's pipeline steps itself — doing
so would pull the whole context cost back into the thread this shape exists to protect.
