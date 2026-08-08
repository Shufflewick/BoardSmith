# Filings — Reporting BoardSmith Bugs and Library Gaps Upstream

Referenced by `build-game.md` Step 4 (Handling a Filing) and by `build/build.md` "Boundaries".
This file owns what happens after a filing is recorded: how it gets from the game's `FILINGS.md`
ledger to the BoardSmith issue tracker, and what to do when it cannot get there by itself.

## What Is Filed, and What Is Not

`build/build.md` "Boundaries" rule 3 is the bar: a shortfall in the library is FILED, never patched
— `node_modules/boardsmith` is a live symlink to the designer's real BoardSmith checkout and is
read-only, so a "quick fix" there silently mutates their library. Two kinds of filing exist:

- **A bug.** BoardSmith does not do what it documents. This bar is low on purpose: a wrong behavior
  found while building a game is worth reporting even if the game routes around it, because the next
  game will hit it too.
- **A feature request.** The game needs a core capability BoardSmith does not have, and the game
  genuinely cannot supply it itself. This bar is **high**. Almost everything a game needs is the
  game's own job — its rules, its layout, its own components. A feature request is warranted only
  when the thing must live in the library for the game to work at all: a built-in surface that
  cannot be driven the way the design needs (`build/build.md` "Boundaries" rule 4 — suppressing it
  is never the answer), an engine capability with no game-side expression, a protocol the game
  cannot reach around. "It would be more convenient in the library" is not a feature request; it is
  a note, and it belongs in the sketch's ideas backlog.

Every filing is recorded in `FILINGS.md`
(`${CLAUDE_SKILL_DIR}/../bs-shared/templates/FILINGS.template.md`) **as it is found**, by whichever
step found it, with its `Reported:` field starting at `recorded`. Recording is unconditional and
never waits on the designer; reporting upstream is the separate, gated act below.

## Adopting a Pre-Existing Bug Ledger (one-time conversion)

Games built before `FILINGS.md` existed kept the same information by hand, in a file the session
invented — usually `design/BOARDSMITH-BUGS.md`. That file is not a rival ledger to ignore or
duplicate; it is this project's filings ledger under an older name, and other design files already
cite it by that name. On first contact, convert it once:

1. Create `FILINGS.md` from the template if it does not exist.
2. Transcribe every entry in the old file into a `### Filing N` entry, in the old file's own order.
   **Keep its original id inside the `Title:`** (e.g. "BS-1 — MCTS can select a proven-loss terminal
   action") so a citation elsewhere in the project still finds it by the name it was cited under.
   Preserve what the entry already records — severity, where, symptom, suggested fix — inside
   `What happened`; do not re-investigate or re-word its findings. An entry the maintainer already
   rejected or withdrawn is transcribed with `Reported: declined`, never dropped: a withdrawn filing
   kept visible is the whole point of how those files were written.
3. Replace the old file's body with one line pointing at `FILINGS.md`, and leave the file in place.
   Deleting it would break the citations in `SKETCH.md`, `DECISIONS.md`, and the chunk files that
   name it; a one-line pointer keeps every one of them resolvable while leaving exactly one ledger
   with content.
4. Tell the designer in one sentence that their bug notes are now kept with the rest of the game's
   records — not a migration report.

Never run this conversion twice, and never write a new filing to the old file after it has been
converted.

## The Repository

BoardSmith lives at **https://github.com/Shufflewick/BoardSmith** — `Shufflewick/BoardSmith` as a
`gh` repo argument. That is the only repository a filing is ever posted to; a game project's own
repo is not where a library bug belongs.

## Posting: Ask, Then Post

Posting an issue is an outward-facing act on the designer's behalf, so it is **always confirmed
first** — one short confirmation per filing, showing the title and what it says, and never a
standing "post everything from now on" assumption. If the designer declines, record
`Reported: declined` and never raise that filing again; a declined filing stands, exactly like an
answered question (`orchestrate/questions.md` "Check Before Asking").

When they approve, check whether posting is even possible before promising it:

```bash
gh auth status
```

A non-zero exit (no `gh`, or `gh` present but not authenticated) means the run cannot post — go
straight to "When Posting Is Not Possible" below. Do not attempt the post and report a URL that does
not exist.

With `gh` authenticated, check for a duplicate before creating anything:

```bash
gh issue list --repo Shufflewick/BoardSmith --state all --search "<distinctive words from the title>"
```

If an existing issue already describes this, do not open a second one: record that issue's URL in
the filing's `Issue:` field with `Reported: posted`, and tell the designer it was already known.

Otherwise write the body to a scratch file — `.boardsmith/scratch/filing-<N>.md`, the gitignored
scratch directory every throwaway file goes in (`state-machine.md` "Project Layout"), never the
project root — and create the issue:

```bash
gh issue create --repo Shufflewick/BoardSmith --title "<the filing's Title>" --body-file .boardsmith/scratch/filing-<N>.md
```

The body is the filing's own content, written for someone who has never seen this game: what was
expected, what happened, the smallest reproduction, the BoardSmith version, and — for a feature
request — what the game needs and why the library is the only place it can live. Add nothing about
this pipeline: no step names, no chunk ids, no ledger names. A BoardSmith maintainer reading the
issue must be able to act on it without knowing the game was built by these skills.

`gh issue create` prints the new issue's URL. Record it in the filing's `Issue:` field and set
`Reported: posted`. If the command fails for any reason, fall through to the next section rather
than retrying blindly — a failed post with a recorded URL is worse than no post.

## When Posting Is Not Possible

No `gh`, no authentication, or a failed create — the filing still gets reported, by the designer.
Show them the complete issue on screen: the title on one line, then the body exactly as it would
have been posted, in a fenced block they can copy whole. Then ask them to post it at
https://github.com/Shufflewick/BoardSmith/issues and say plainly why the run could not (the GitHub
command-line tool is not set up here — one sentence, no diagnostics dump).

Nothing is lost either way: the filing is already in `FILINGS.md`. If the designer posts it and
gives back the URL, record it with `Reported: posted-by-designer`. If they do not answer, leave
`Reported: recorded` — the run continues; a filing never blocks it.

## Blocking vs. Worked Around

A filing's `Blocked:` field says whether the chunk could proceed:

- **Worked around** — the chunk builds, with the workaround recorded in the filing's
  `Workaround in the game` field and in `DECISIONS.md` if it shaped the code. The run continues to
  the next chunk normally.
- **Blocked** — the chunk cannot be built until the library changes. The run does not fake progress:
  it reports the block to the designer in their terms (what the game cannot do yet, and that it is
  the library's job, not theirs), leaves the chunk at its last persisted step, and asks whether to
  skip ahead to the next independent chunk or stop the run. Never mark a blocked chunk verified, and
  never suppress a built-in surface to make the block go away (`build/build.md` "Boundaries" rule 4).

## Keeping the Ledger Honest

`build/close.md`'s Bookkeeping Sequence re-touches filings at each chunk's close (SKILLAUTO-08): a
gap this chunk's own work resolved or advanced is updated, so the ledger never describes a library
that has since moved. `/bs-check-status` reports the ledger's open filings; it never writes them.
