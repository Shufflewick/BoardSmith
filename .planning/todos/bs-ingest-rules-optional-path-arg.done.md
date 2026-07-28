# `/bs-ingest-rules` — optional rulebook path argument

**Raised:** 2026-07-27 (during Phase 170's human gate, by JT)
**Status:** IMPLEMENTED 2026-07-27. Kept for the record; nothing to do.

Landed as the optional `/bs-ingest-rules [path-to-rulebook]` argument, and it turned out to be
load-bearing rather than ergonomic: it is what let the source archive move into
`boardsmith init --rulebook`, which is one of only two mechanisms in Phase 170 that survived a
live run. All five design constraints below were implemented, including the loud failure on an
unreadable path. See `.planning/phases/170-ingest-contract-upgrade/170-MECHANISMS.md`.
**Scope:** `src/cli/slash-command/bs/ingest-rules.md`, `bs/create-game.md`,
`scripts/ingest-harness/run.mjs`, `src/cli/slash-command/bs/ingest.test.ts`

## Idea

`/bs-ingest-rules` should accept an optional path to the rules document:

```
/bs-ingest-rules ~/BoardSmithGames/seven/rules.pdf
```

When supplied, bind `{rulebookPath}` directly and skip the "do you have a written rulebook?"
question. When absent, current behavior is unchanged (ask, then route to transcription or the
structured interview).

## Why

- The designer already knows the path when they invoke the skill; asking for it is a wasted
  round-trip.
- `scripts/ingest-harness/run.mjs` currently has to state the path in prose inside its driver
  prompt. An argument makes the harness deterministic on that input instead of relying on the
  session parsing an instruction sentence.

## Design constraints (decided when raised)

1. **A supplied-but-unreadable path fails loudly — it must never fall through to the interview
   path.** If `/bs-ingest-rules ~/typo.pdf` silently becomes "no rulebook → structured
   interview", the designer hand-answers an interview for a game whose rulebook they have. Given
   a path argument, an unreadable file is a hard stop with an actionable message naming the path.
2. **Resolve to an absolute path BEFORE Step 1 scaffolds.** Step 1 runs `cd <name>` into the newly
   created project directory, so a relative path bound before that `cd` is wrong afterward. Same
   class of trap as the `scaffold.md` / `{rulebookPath}` timing issue found in Phase 170 research
   (`170-RESEARCH.md`).
3. **Expand `~`.** Designers will type `~/BoardSmithGames/...`.
4. **`bs-create-game` forwards the argument** — it is the discoverable entry point that routes
   into `/bs-ingest-rules`.
5. **Step 0 state detection still runs first.** A path argument must not let a session skip the
   "you are inside an existing bs- project" guard.

## Verification bar

Not a contract test alone. Phase 170 established that a green contract test proves an instruction
exists, not that an agent follows it (`170-PROOF-RUN.md`). Verify with `npm run harness:ingest`,
which now runs green 3/3 — extend the driver to pass the path as an argument rather than in prose,
and confirm the run still reports 10/10.

Also add a negative check: a deliberately bad path must stop rather than silently entering the
interview path.

## Related

- Phase 170 (`.planning/phases/170-ingest-contract-upgrade/`) — the ingest contract work this
  builds on, and the harness that makes verifying it cheap.
