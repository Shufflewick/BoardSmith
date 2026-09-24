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
     "Open Gate:", "Stop Reason:". If a required line or heading is missing or
     malformed, or "Run Status:" carries an unrecognized value, a resuming run STOPS and asks
     the designer — it never guesses the intended state. See state-machine.md
     "Cold-Resume Parse Contract". -->

Run Status: <!-- active | paused | complete -->
<!-- `active` — a run is in flight (this is what a crash leaves behind, indistinguishable from a
     live run except by the session lock's timestamp — see state-machine.md "Session Lock").
     `paused` — the designer stopped the run, or the orchestrator stopped it (context ceiling,
     stuck step, an open gate the designer has not answered). `complete` — the final-acceptance
     chunk closed; there is nothing left to orchestrate. -->

Open Gate: <!-- none | "<slug> — <what the designer must answer or play>" (chunks built at the
     same time can each hold a gate: list them separated by "; ") -->
<!-- The one thing a resuming run must NOT lose: which human gate was open when the run stopped.
     `none` means no gate is pending. When a gate is open, the resuming run re-poses it verbatim
     from the source that owns its text (the chunk's own CHUNK.md test script, or the open
     QUESTIONS.md entry) rather than re-deriving it in new words. Cleared to `none` the moment
     the gate is answered and the answer is recorded. -->

Stop Reason: <!-- none | designer-stopped | context-ceiling | stuck | gate-open -->
<!-- Why the last run ended, so the resume message can lead with something true. `stuck` always
     names what was stuck in that chunk's run log. -->

<!-- THE DISPATCH LOG IS NOT IN THIS FILE (#294). Each chunk has its own log,
     design/run-log/<slug>.md, created from RUN-LOG.template.md the first time that chunk is
     dispatched. Chunks built at the same time on separate branches each append only to their
     own file, so no two writers ever share a field; this file holds only the three run-level
     lines above, written only by the orchestrator in the main checkout. `boardsmith
     ledger-check` fails a dispatch entry written here. -->
