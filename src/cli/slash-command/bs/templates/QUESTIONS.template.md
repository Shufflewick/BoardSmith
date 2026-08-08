# Questions

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- This is the ANSWER CACHE: every question this pipeline has put to the designer, and the
     answer they gave. It exists so a question is asked exactly once. A session that ends in a
     `/clear` or a crash loses its conversation, not its answers — the next session reads this
     ledger before any gate and supplies the recorded answer instead of re-asking (see
     orchestrate/questions.md, and build/ask.md's "Never re-ask an already-granted approval").

     IT IS A TRANSCRIPT, NOT AN AUTHORITY. A rules call recorded here is ALSO recorded in
     RULINGS.md, which stays the one composite source of truth with the rulebook
     (state-machine.md "Rulings Outrank Rulebook"); an engineering assumption recorded here is
     ALSO recorded in DECISIONS.md. Each entry's "Recorded in" field names where the durable
     decision landed. If this ledger and RULINGS.md ever disagree about a rules call, RULINGS.md
     wins.

     WHO WRITES HERE:
     - Any gate step that puts a question to the designer — `ask`, `playtest`, a redteam
       refuted-twice escalation, a repair round-3 triage — writes the question the moment it is
       posed, with the Answer field left `pending`.
     - Whoever receives the designer's answer fills that entry's Answer/Answered at/Recorded in
       fields, once. Under `/bs-build-game` that is always the orchestrator, because the
       dispatched chunk subagent never talks to the designer directly. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1 and the "## Ledger"
     heading, and (once populated) entries each carrying Question / Asked by / Scope / Options /
     Answer / Answered at / Recorded in. If this file exists but "## Ledger" is missing, a
     resuming session STOPS and asks the designer — it never guesses the intended state. See
     state-machine.md "Cold-Resume Parse Contract". -->

## Ledger

<!-- Entries are append-only: never delete or renumber one, and never rewrite an answered
     entry. The ONE sanctioned in-place fill is an OPEN entry's Answer / Answered at / Recorded
     in fields, written once when the designer answers (the same fill-once discipline
     ASSETS.md's `received` column uses). If the designer later changes their mind, that is a
     NEW entry that names the one it supersedes — never an edit of the original.

     Each entry is a numbered "### Question N" section with exactly these fields:
     - Question: the question in the designer's own terms, as it was actually put to them
       (reporting.md's voice — no step names, ids, or engine vocabulary)
     - Asked by: the chunk slug whose work raised it
     - Scope: this-chunk | cross-cutting | later-chunk — `this-chunk` blocked that chunk's own
       progress; the other two were queued and surfaced at the next gate (state-machine.md
       "Batched-question queue")
     - Options: the named options offered, or "open question — no options offered"
     - Answer: pending | the designer's answer, in their words
     - Answered at: ISO timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`, or "n/a — pending"
     - Recorded in: RULINGS.md Ruling N | DECISIONS.md Decision N | ASSETS.md row | n/a — no
       durable decision followed

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Question 1
     - Question: When you can't afford rent and have nothing left to mortgage, do you go bankrupt
       straight away, or may you sell buildings back first?
     - Asked by: rent-payment
     - Scope: this-chunk
     - Options: A — bankrupt immediately; B — sell buildings first
     - Answer: B — you may sell buildings back at half price first.
     - Answered at: 2026-08-07T14:31:40Z
     - Recorded in: RULINGS.md Ruling 3

     ### Question 2
     - Question: Should the deck reshuffle when it runs out, or does the game just end there?
     - Asked by: draw-phase
     - Scope: cross-cutting
     - Options: A — reshuffle the discards; B — game ends
     - Answer: pending
     - Answered at: n/a — pending
     - Recorded in: n/a — no durable decision followed
-->
