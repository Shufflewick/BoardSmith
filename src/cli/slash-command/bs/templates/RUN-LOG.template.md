# Run Log: <!-- chunk slug -->

<!-- ONE CHUNK'S DISPATCH LOG, written only by `/bs-build-game` (see orchestrate/run-state.md),
     at design/run-log/<slug>.md. The chunk is the one this file is named for, so an entry has
     no Chunk field. It is a journal, never an authority on chunk state: the chunk's own
     CHUNK.md Status wins on any disagreement. When chunks are built at the same time, each on
     its own branch, the orchestrator writes each chunk's entries in that chunk's own checkout,
     so this file merges with the chunk and never with anyone else's writes (#294). -->

<!-- Append-only, one entry per chunk dispatch. A dispatch is recorded BEFORE the subagent is
     launched (so a crash mid-chunk is visible as a dispatch with no outcome) and its Outcome is
     filled in once, when that dispatch returns. Never delete, renumber, or rewrite an entry —
     a re-dispatch of the same chunk (after a gate is answered, or after a crash) is a NEW
     entry, not an edit of the old one. That is what makes the log a readable history of how many
     passes a chunk actually took.

     CHECKED AS CODE: `boardsmith ledger-check` fails when a Dispatched at or Finished at is not a
     clock read in that exact shape, when a finish is earlier than its dispatch, when a dispatch is
     earlier than the one logged before it, when Outcome and Finished at disagree about whether
     the dispatch has returned, and when a time is later than the commit in the game's history
     that recorded it. A hand-typed or estimated time is caught by that last comparison. -->

<!-- Each entry is a numbered "### Dispatch N" section with exactly these fields:
     - Pipeline: build-chunk | build-bot | insert-chunk
     - Dispatched at: ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ` (never fabricated — the
       same single sanctioned clock read state-machine.md "Session Lock" requires)
     - Finished at: `pending` while the dispatch runs, then an ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`,
       read when the dispatch returns and written together with Outcome (never fabricated, never
       copied from another entry, never typed from memory)
     - Outcome: pending | closed | gate | filing | stuck
     - Detail: one line — for `gate`, which gate; for `filing`, the filing id; for `stuck`, what
       was stuck; for `closed`, "n/a"

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Dispatch 1
     - Pipeline: build-chunk
     - Dispatched at: 2026-08-07T14:02:11Z
     - Finished at: 2026-08-07T14:29:02Z
     - Outcome: gate
     - Detail: design approval for the turn sequence

     ### Dispatch 2
     - Pipeline: build-chunk
     - Dispatched at: 2026-08-07T14:31:40Z
     - Finished at: 2026-08-07T15:10:23Z
     - Outcome: closed
     - Detail: n/a
-->
