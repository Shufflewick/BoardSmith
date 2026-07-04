# Rulings

<!-- This is an append-only ledger of designer decisions: ambiguity resolutions, house rules,
     and deliberate digital adaptations of the printed rulebook. Every entry pairs a decision
     with the exact rulebook citation it interprets or overrides.

     RULINGS OUTRANK THE RULEBOOK (see ../state-machine.md "Rulings Outrank Rulebook"): every
     agent that reads a rulebook slice — investigate, redteam, audit — also reads this file.
     The rulebook plus RULINGS.md together form the composite source of truth. This is what
     stops an audit agent from "fixing" a deliberate house rule back to the printed rule.

     WHO WRITES HERE:
     - Any `ask` or `playtest` gate step, when the user makes an ambiguity call or requests a
       house rule / digital adaptation during that step.
     - Redteam refuted-twice escalation (see ../state-machine.md "Redteam Escalation"): when a
       redteam finding is refuted twice, that is by definition an ambiguity — it is escalated to
       the user as a plain-language question, and the ruling is recorded here.

     Sessions fill this ledger, never restructure it. Entries are append-only — never edit or
     delete a prior entry, even if a later ruling supersedes it (supersession is itself a new
     entry that references the one it supersedes). -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, the "## Ledger"
     heading, and (once populated) entries each carrying Decision / Citation / Rationale. If
     this file exists but "## Ledger" is missing, a resuming session STOPS and asks the user —
     it never guesses the intended state. See ../state-machine.md "Cold-Resume Parse Contract". -->

## Ledger

<!-- Each entry is a numbered "### Ruling N" section with exactly these three fields:
     - Decision: the designer decision itself (in plain language)
     - Citation interpreted or overridden: the exact rulebook section/page this decision
       interprets or overrides (or "n/a — no citation, pure digital adaptation" if the rulebook
       is silent on this point)
     - Rationale: why this call was made

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Ruling 1
     - Decision: A player who cannot make any legal move on their turn automatically passes;
       the digital client does not require them to click a "pass" button.
     - Citation interpreted or overridden: p.14, "Taking Your Turn" — rulebook is silent on the
       no-legal-move case.
     - Rationale: Digital adaptation — a physical pass requires ceremony (announcing it to the
       table); a digital client can detect "no legal moves" and skip the ceremony without losing
       any game-state fidelity.
-->
