---
name: bs-create-game
description: Start a new BoardSmith game — from just an idea or from an existing rulebook. The discoverable entry point for beginning a game project; it routes straight into the /bs-ingest-rules kickoff (structured interview when there's no rulebook, transcription when there is).
---

# `/bs-create-game` — Start a New Game

This is a **thin alias**, not a second implementation. Beginning a BoardSmith game — whether the
designer has a written rulebook or only an idea in their head — is the job of `/bs-ingest-rules`,
whose Step 2 already routes between the transcription path (rulebook exists) and the no-rulebook
structured interview. This skill exists only so that a designer who thinks "create a new game"
rather than "ingest rules" can find that entry point. There is deliberately **one**
implementation of project kickoff; keeping planning logic here would fork it.

Anything you say to the designer — here or after the hand-off — follows
`${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`: lead with what they need to do, describe the game
in their terms, and keep this pipeline's ids, paths, and step names out of it.

## What to do

Immediately hand off to `/bs-ingest-rules` and run it verbatim — do not reimplement, summarize,
or shortcut any of its steps:

1. Read `${CLAUDE_SKILL_DIR}/../bs-ingest-rules/SKILL.md` and follow it exactly in this same turn,
   starting at its Step 0 state-detection. Hand off by **reading and executing** that `SKILL.md`
   directly — never by re-dispatching `bs-ingest-rules` as a separate skill invocation.
   Re-dispatch would restart state detection in a fresh context and fork the one implementation
   of project kickoff; reading the sibling file keeps a single execution in this turn.
2. If the designer volunteered any context in the same breath as invoking `/bs-create-game`
   (e.g. "create a new game, it's a trick-taking card game about pirates"), carry that forward
   into `bs-ingest-rules`' routing: it seeds the interview's opening vision question or, if they
   pointed at a rulebook, the transcription path. Do not re-ask what they already told you.
3. **If they gave a path to a rulebook file** — as an argument to `/bs-create-game`, or anywhere
   in that same message — carry it forward as `bs-ingest-rules`' optional rulebook-path argument
   (see its "Invocation" section). Resolve it to an absolute path, expanding a leading `~`, before
   Step 1 runs; Step 1 `cd`s into the new project directory, so a relative path captured earlier
   is wrong afterward. Passing it through means Step 1 archives the source, which is where that
   work reliably happens — do not let the path arrive only at Step 2.

Everything else — scaffold, transcription vs. interview, synthesis, sketch derivation, the
context-economics hard rule — lives in `bs-ingest-rules` and its `bs-shared/` references. Cite
those; never copy them here.
