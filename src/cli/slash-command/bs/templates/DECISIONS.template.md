# Decisions

<!-- This is an append-only ledger of implementation decisions: data-model choices, naming,
     and invariants. Unlike RULINGS.md (which records designer/rules-interpretation calls
     against the rulebook), this file records engineering decisions about how the rules are
     represented in code — the kind of thing a future contributor needs to know before they
     "fix" what looks like a bug but is actually a deliberate invariant.

     WHO WRITES HERE:
     - The `build` step, as data-model/naming/invariant decisions are made while implementing
       a chunk.
     - The `close` step, as a rollup — summarizing/confirming the decisions the chunk actually
       shipped with, in case build-time notes drifted from the final implementation.

     Sessions fill this ledger, never restructure it. Entries are append-only — never edit or
     delete a prior entry, even if a later decision supersedes it (supersession is itself a new
     entry that references the one it supersedes). -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, the "## Ledger"
     heading, and (once populated) entries each carrying Decision / Rationale / Invariant. If
     this file exists but "## Ledger" is missing, a resuming session STOPS and asks the user —
     it never guesses the intended state. See ../state-machine.md "Cold-Resume Parse Contract". -->

## Ledger

<!-- Each entry is a numbered "### Decision N" section with exactly these fields:
     - Decision: the data-model / naming / invariant choice itself
     - Rationale: why this representation was chosen over an alternative
     - Invariant: the specific invariant this decision establishes (what must always hold true
       elsewhere in the codebase because of this choice) — or "n/a — naming only, no invariant"
       if the decision is purely a naming convention with no enforced invariant

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Decision 1
     - Decision: Money is a plain `number` property on `Player`, not a dedicated `Wallet` element.
     - Rationale: Money never needs to be a targetable/movable board element (no piece
       represents it, no action selects "the money" as a target) — a plain property is simpler
       and avoids an element with no meaningful selection surface.
     - Invariant: `player.money` is always a non-negative integer; any action that would reduce
       it below zero must be rejected before it mutates state, not clamped after.

     ### Decision 2
     - Decision: Board spaces are indexed 0-39, with index 0 = GO.
     - Rationale: Matches the rulebook's own space numbering exactly, so citations in
       RULINGS.md/CHUNK.md that reference "space 12" need no translation layer.
     - Invariant: Space traversal always computes `(currentIndex + steps) % 40`; no code path
       may special-case wraparound past space 39 back to 0.
-->
