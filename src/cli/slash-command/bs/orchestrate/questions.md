# Questions — Ask Once, Record Always

Referenced by `build-game.md` Step 4 (Handling a Gate) and by `build/ask.md`. This file owns the
answer cache: how a question reaches the designer, how its answer is recorded, and why the same
question is never put to them twice.

## The Problem This Solves

A question lived only in the conversation that asked it. A `/clear`, a crash, or a new day and it
was gone — so the next session asked it again, and the designer answered the same thing a second
time. That is not a memory problem to work around with a longer session; it is a missing file.
`QUESTIONS.md` is that file (`${CLAUDE_SKILL_DIR}/../bs-shared/templates/QUESTIONS.template.md`), and
under `/bs-build-game` it is load-bearing: the designer's answers must outlive the subagent that
needed them, because that subagent is gone the moment it returns.

## The Two Non-Negotiables

1. **A question is written the moment it is posed** — before the designer answers, with
   `Answer: pending`. Never written "once we know the answer": a session that dies between asking
   and answering must leave evidence that the question is outstanding, and `RUN.md`'s `Open Gate:`
   points at it (`orchestrate/run-state.md`).
2. **An answer is written before the run does anything with it.** The order is: designer answers →
   the `QUESTIONS.md` entry's `Answer`/`Answered at`/`Recorded in` fields are filled → the durable
   decision lands in `RULINGS.md` (a rules call) or `DECISIONS.md` (an engineering assumption) →
   only then is the answering dispatch launched. An answer that shaped a build but was never written
   down is the exact failure this ledger exists to prevent.

## Check Before Asking

Before any question reaches the designer — under an orchestrated run or a bare `/bs-build-chunk` —
read `QUESTIONS.md` and `RULINGS.md`. If an answered entry already decides the question, **it is
answered**: supply the recorded answer and move on. Do not re-present it "for confirmation"; a
re-asked question tells the designer their earlier answer did not count (`build/ask.md` "Never
re-ask an already-granted approval").

A question that is *related but not decided* by an existing entry is a new question, and it names
the entry it builds on so the designer can see the connection without re-litigating it.

## The Digest

Every chunk dispatch carries an **answered-questions digest** in its brief
(`orchestrate/chunk-dispatch.md` "The Brief" item 4): the settled answers bearing on that chunk,
quoted as the designer gave them, each with the `RULINGS.md`/`DECISIONS.md` entry it landed in.

Scope decides what is included: every `cross-cutting` answer, plus every answer whose `Asked by`
chunk is this chunk or a chunk this one depends on, plus any `later-chunk` answer whose subject is
now this chunk. When in doubt, include it — the digest is small, and an omitted answer becomes a
re-asked question, which is the one outcome this file forbids. Never send the whole ledger: quote
the entries, so the subagent needs no read of its own.

## Who Writes What, Under an Orchestrated Run

The dispatched subagent has no channel to the designer
(`orchestrate/chunk-dispatch.md` "The Brief" item 5). So:

- The **subagent** writes the question entries it poses (`Answer: pending`) and returns them in its
  report's `questions` field.
- The **orchestrator** puts them to the designer, in `reporting.md`'s voice — the question and its
  named options, nothing else — fills each entry's answer fields, writes the `RULINGS.md` or
  `DECISIONS.md` entry the answer earns, clears `RUN.md`'s `Open Gate:`, and only then re-dispatches
  the chunk with the answers in the digest.

Batching holds unchanged: a question that does not block the chunk it came from is queued and
surfaced at the next gate rather than interrupting the run
(`state-machine.md` "Batched-question queue"). Under an orchestrated run the queue **is**
`QUESTIONS.md`'s set of `pending` entries — durable, not in-conversation, so a batch survives the
`/clear` that used to lose it.

## What Never Changes

The ask bar is unchanged: a question must still clear `build/ask.md`'s triple-gate (genuinely
undetermined, load-bearing, no reasonable default) before it is asked at all, and an item that fails
the gate is still recorded as an assumption in `DECISIONS.md` rather than put to the designer. This
file makes asking *cheaper to remember*, never cheaper to do — a run that asks more questions
because they are now well-filed has misread it.

Nor does it move authority. `RULINGS.md` remains the rules authority that composes with the rulebook
(`state-machine.md` "Rulings Outrank Rulebook"); `QUESTIONS.md` is the transcript of how a ruling
came to be asked. On any disagreement between them, `RULINGS.md` wins.
