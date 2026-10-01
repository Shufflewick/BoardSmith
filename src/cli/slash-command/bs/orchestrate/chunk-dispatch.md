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

Dispatch with the **Agent tool**: one agent per dispatch, full tool access, running in the game
project directory, as the `judgement` role's agent: a chunk touches rulings, so it is judgement
work (`routing.md` "Which Role Each Step Uses"). Run `npx boardsmith agent judgement` and dispatch
exactly the agent type it prints: the one the project maps the role to in `boardsmith.json`, or
BoardSmith's own `bs-judgement`. Never name a model. The chunk's own steps are then dispatched
role by role from inside it, as `routing.md` says. The subagent is told to **read the pipeline's own
instructions and follow them verbatim**: `${CLAUDE_SKILL_DIR}/../bs-build-chunk/SKILL.md` for an
ordinary chunk, `${CLAUDE_SKILL_DIR}/../bs-build-bot/SKILL.md` for the bot-opponent chunk,
`${CLAUDE_SKILL_DIR}/../bs-insert-chunk/SKILL.md` for a sketch reshape. Hand it the resolved
absolute path — the orchestrator has `${CLAUDE_SKILL_DIR}` expanded, the subagent does not.

Reading the sibling instructions is the only sanctioned handoff, exactly as `/bs-create-game`
hands off to the kickoff instructions by reading them: it keeps one implementation of the chunk
pipeline, executing in one context, with no second copy of its rules living in this file.

**Two chunks never share a checkout.** Chunks share `SKETCH.md`, the ledgers, and the git working
tree, so two dispatches in one checkout would race on all three and interleave commits. By default
the loop dispatches one chunk at a time in the main checkout. Chunks that are independent may
instead be built at the same time, each in its own worktree, under the rules in "Parallel Dispatch"
below. Either way the session lock (`state-machine.md` "Session Lock") stays held by the run.

## Parallel Dispatch

Chunks may be built at the same time when, and only when, `boardsmith parallel-check <slug> <slug>
[...]` exits zero for the whole batch. It passes chunks that are **independent in the sketch's
dependency graph** (every chunk each one names in its `- Depends on:` line is already verified, so
none of them waits on another) and that have **no rulebook section in common** (the citations in
each chunk's sketch `Citations:` line and its CHUNK.md `## Interpretation`, less the claims a later
claim supersedes, and `## Newly Discovered Citations`). The unit is a section of a slice, not the
slice, so chunks that cite different parts of one shared page (a designer-decisions page) can run
together. A citation claims:

- `rulebook/<file>.md §"<section>"`: that section, named by its heading or by its citation prefix
  without the page (`p.2, Designer Decisions > Economy:` is `§"Designer Decisions > Economy"`); a
  heading also claims every section under it;
- `rulebook/<file>.md:N-M`: the sections holding those lines;
- `rulebook/<file>.md` alone, whatever prose follows it: the whole page, every section of it.

A refusal names the shared sections. A refusal over a whole-page citation is lifted by narrowing
that citation to the sections the chunk needs, never by guessing. A citation that names no slice
file, no section of it, or lines it does not have, or a chunk with no citations yet, cannot be shown
to be independent, so it is refused. Never start a batch the check refused, and never start one
without running it.

### When Chunks Run One at a Time

Build in order, in the main checkout, whenever any of these holds. The check enforces the first
five; the last two are dispatches it is never asked about:

- the check refused the batch, for any reason;
- a chunk depends, directly or through another chunk, on one that is not verified;
- two chunks cite a section of a rulebook slice in common;
- the chunk is the core-loop chunk or the final-acceptance chunk (they always run alone);
- the chunk has no `- Depends on:` line, or no rulebook citations yet;
- the dispatch is a sketch reshape (`/bs-insert-chunk`), which rewrites the whole Ordered Chunk List
  and so runs only when no chunk is being built;
- any merge's cross-chunk references are still awaiting the audit (see step 5 below).

### How a Parallel Batch Runs

1. **Check.** Run `boardsmith parallel-check <slug> <slug> [...]` from the main checkout. A non-zero
   exit ends the attempt: dispatch the first of them alone and continue in order.
2. **One worktree per chunk.** From the main checkout, for each chunk:
   `git worktree add .boardsmith/worktrees/<slug> -b chunk/<slug>`. Set `SKETCH.md`'s session lock to
   the batch (`state-machine.md` "Session Lock", the comma-separated form) and commit it BEFORE
   creating the worktrees, so every branch starts from it.
3. **Dispatch every chunk of the batch in one message**, so they run at the same time. Each brief is
   the ordinary seven fields plus: the project directory is that chunk's worktree, not the main
   checkout; it is building on a parallel branch, so it numbers every new ledger entry with a
   provisional id, `Ruling @<slug>.<n>` (`state-machine.md` "Ledger Numbers on a Parallel Branch");
   and it never writes `RUN.md` or another chunk's files. The orchestrator writes each chunk's run
   log entry in that chunk's own worktree, `design/run-log/<slug>.md`, and commits it there.
4. **Gates.** A chunk that returns a gate is handled as always, one gate at a time with the
   designer. Its answers are written in that chunk's worktree, numbered provisionally, and its
   re-dispatch goes back to the same worktree. `RUN.md`'s `Open Gate:` lists every open gate.
5. **Merge, one merge at a time.** When a chunk closes, run `boardsmith chunk-merge <slug>` from the
   main checkout. Never merge a chunk branch by hand: this command is the gate. It merges under a
   lock, allocates real ledger numbers on the combined tree, re-runs `ledger-check`,
   `constraint-check` with its measurement tests, every sign-off and the whole test suite on the
   combined tree, and refuses (leaving the main checkout exactly as it was) when any of them fails,
   even though the branch passed them alone. A source file this chunk and one merged while it was
   built both edited is code neither sign-off saw: the merge vouches for it by re-running both
   chunks' own tests, `chunk-check` and `claim-quote-check` on the combined tree, then records it
   in `design/MERGE-SIGNOFFS.md` (the file, both chunks, the merge), which the sign-off check
   accepts. A source file whose provisional ledger citations the merge renumbered to real numbers
   is vouched for the same way. No designer sign-off is asked for. When one of those checks fails, the refusal names
   the check and the chunk. A branch never writes `design/MERGE-SIGNOFFS.md` itself. A refusal is fixed on the chunk's branch: merge the
   main line into it in its worktree, resolve and re-test there, commit, and run `chunk-merge`
   again. When the merge lists references between this chunk and the chunks merged while it was
   being built, they land in `design/CROSS-CHUNK.md` as pending, and `ledger-check` (so every close
   and every later merge) fails until the audit rules on them: dispatch the cross-chunk lens, the
   `judgement` role's agent (`build/audit.md` "The Cross-Chunk Lens"), against the main checkout
   before anything else.
6. **Clean up.** After a chunk merges, `git worktree remove .boardsmith/worktrees/<slug>` and
   `git branch -d chunk/<slug>`. When the last chunk of the batch has merged, set the session lock
   back to the next chunk the run dispatches.

## The Brief (every field required)

The brief is the subagent's whole world — it has no memory of the run and no access to the
designer. The first line of the brief is `Work package: <slug>`, the chunk's slug, so every
report and log line the dispatch produces can be traced to its chunk. Then include all of:

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
    `verified` or `verified (user-waived)`, and close ended with `build/close.md` "The Done Gate":
    its last command was `npx boardsmith verify --check --chunk <slug>`, which exited zero, and
    nothing was written or committed after it. So the chunk's last commit, on a clean tree, has a
    passing `boardsmith verify` result that measured the chunk's whole change (the full suite,
    typecheck, build, validate, the smoke test and the mutation check of everything since the chunk began).
    A subagent never returns `closed`, and never says done or green anywhere in its report, without
    that; the orchestrator runs the same check before it believes one.
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

A `closed` return whose checkout fails `npx boardsmith verify --check --chunk <slug>` is not
closed, whatever its `designerSummary` says. It is a failure of the chunk's dispatch at the
`judgement` role, the top of the ladder, so it is never re-dispatched at that role on the
orchestrator's own say-so (`routing.md` "When a Step Fails: One Role Up, Never the Same Role"):
the orchestrator records the dispatch `failed`, stops, and puts it to the designer with the
check's message (`build-game.md` Step 4). Once they answer, the chunk is re-dispatched with the
answer and the check's message in the brief, so the fresh subagent fixes what it names and runs
`build/close.md` "The Done Gate" again. That re-dispatch's run log entry records where the
designer's answer is in `Designer answer:`; `boardsmith ledger-check` refuses a re-dispatch of
failed work at `judgement` without it.

A return missing a field its `outcome` requires is itself a stuck dispatch: the orchestrator does
not guess the missing half. Re-dispatch once with the missing field named; if the second return is
also malformed, stop the run and tell the designer plainly what did not come back.

## After the Return

The orchestrator, in this order: for a `closed` return, first runs
`npx boardsmith verify --check --chunk <slug>` in the chunk's checkout (`build-game.md` Step 4)
before it writes anything, since any write to that
checkout (the run log included) leaves its tree dirty and the check would refuse the chunk for the
orchestrator's own change; then fills the chunk's `design/run-log/<slug>.md` dispatch entry's `Outcome`/`Detail`
(`orchestrate/run-state.md` "Writing It"), recording a refused check as `failed`; records any `questions` and `filings`
(`orchestrate/questions.md`, `orchestrate/filings.md`), relays `designerSummary` if there is
anything the designer can see, and then routes on `outcome` per `build-game.md` Step 4.

**A `gate` outcome is answered, then re-dispatched — never resumed in the orchestrator's own
thread.** The orchestrator holds the conversation and the answer; the *work* always happens in a
fresh subagent, which picks up at the chunk's first incomplete step exactly as a cold resume does
(`build-chunk.md` Step 2). The orchestrator never continues a chunk's pipeline steps itself — doing
so would pull the whole context cost back into the thread this shape exists to protect.
