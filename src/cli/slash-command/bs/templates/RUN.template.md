# Run

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- This is the ORCHESTRATED-RUN journal, written and read by `/bs-build-game` only (see
     orchestrate/run-state.md). It exists for exactly one reason: so a run that ends in a
     `/clear`, a crash, or a closed laptop can be picked up again without re-asking the designer
     anything and without re-doing a chunk that already closed.

     IT IS NOT AN AUTHORITY ON CHUNK STATE. Every chunk's status lives in its own
     chunks/<slug>/CHUNK.md, and SKETCH.md holds the derived pointer (state-machine.md
     "Authority"). If this journal disagrees with CHUNK.md about whether a chunk is done,
     CHUNK.md wins and this file is repaired to match — never the reverse. A resuming run
     therefore derives WHAT to build next from SKETCH.md/CHUNK.md, and reads this file only for
     run-level facts those two cannot carry: which gate is open, what the designer was last
     asked, and why a previous run stopped. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, "Run Status:",
     "Open Gate:", "Stop Reason:", "## Run Log". If a required line or heading is missing or
     malformed, or "Run Status:" carries an unrecognized value, a resuming run STOPS and asks
     the designer — it never guesses the intended state. See state-machine.md
     "Cold-Resume Parse Contract". -->

Run Status: <!-- active | paused | complete -->
<!-- `active` — a run is in flight (this is what a crash leaves behind, indistinguishable from a
     live run except by the session lock's timestamp — see state-machine.md "Session Lock").
     `paused` — the designer stopped the run, or the orchestrator stopped it (context ceiling,
     stuck step, an open gate the designer has not answered). `complete` — the final-acceptance
     chunk closed; there is nothing left to orchestrate. -->

Open Gate: <!-- none | "<slug> — <what the designer must answer or play>" -->
<!-- The one thing a resuming run must NOT lose: which human gate was open when the run stopped.
     `none` means no gate is pending. When a gate is open, the resuming run re-poses it verbatim
     from the source that owns its text (the chunk's own CHUNK.md test script, or the open
     QUESTIONS.md entry) rather than re-deriving it in new words. Cleared to `none` the moment
     the gate is answered and the answer is recorded. -->

Stop Reason: <!-- none | designer-stopped | context-ceiling | stuck | gate-open -->
<!-- Why the last run ended, so the resume message can lead with something true. `stuck` always
     names what was stuck in the Run Log entry beside it. -->

## Run Log

<!-- Append-only, one entry per chunk dispatch. A dispatch is recorded BEFORE the subagent is
     launched (so a crash mid-chunk is visible as a dispatch with no outcome) and its Outcome is
     filled in once, when that dispatch returns. Never delete, renumber, or rewrite an entry —
     a re-dispatch of the same chunk (after a gate is answered, or after a crash) is a NEW
     entry, not an edit of the old one. That is what makes the log a readable history of how many
     passes a chunk actually took. -->

<!-- Each entry is a numbered "### Dispatch N" section with exactly these fields:
     - Chunk: the chunk slug this dispatch was for
     - Pipeline: build-chunk | build-bot | insert-chunk
     - Dispatched at: ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ` (never fabricated — the
       same single sanctioned clock read state-machine.md "Session Lock" requires)
     - Outcome: pending | closed | gate | filing | stuck
     - Detail: one line — for `gate`, which gate; for `filing`, the filing id; for `stuck`, what
       was stuck; for `closed`, "n/a"

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Dispatch 1
     - Chunk: core-loop
     - Pipeline: build-chunk
     - Dispatched at: 2026-08-07T14:02:11Z
     - Outcome: gate
     - Detail: design approval for the turn sequence

     ### Dispatch 2
     - Chunk: core-loop
     - Pipeline: build-chunk
     - Dispatched at: 2026-08-07T14:31:40Z
     - Outcome: closed
     - Detail: n/a
-->
