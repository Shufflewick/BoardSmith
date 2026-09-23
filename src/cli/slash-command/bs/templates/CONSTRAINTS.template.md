# Constraints

<!-- The project's hard constraints, and every piece of persistent state that grows with the
     number of players or with time. `boardsmith constraint-check` reads this file and refuses
     (exits non-zero) on anything below that does not hold; `boardsmith chunk-signoff` refuses
     to sign a chunk off while it does. Built from a rulebook or from existing code, the rules
     are the same.

     WHO WRITES HERE: the audit step (build/audit.md), from the constraints lens's report. A
     constraint or structure is never deleted; one that no longer applies says so in its entry. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, "## Hard Constraints"
     and "## Growing Structures". `boardsmith constraint-check` reads the "### C<n>" and
     "### G<n>" entries under them. -->

## Hard Constraints

<!-- One "### C<n>" entry per hard constraint. Every bullet in the project CLAUDE.md's
     "## Hard constraints" (or "## Hard Rules") section must be quoted by an entry.
     - Quote: exact text from the source file (whitespace and ** / ` markup are ignored).
     - Source: the file it is quoted from, relative to the project root (usually CLAUDE.md).
     - Kind: measured (a test proves it) or reviewed (the constraints lens judges it).
     - Test: for measured, the test file that proves it, relative to the project root.

     ### C1
     - Quote: A partition is refused past 512 KiB
     - Source: CLAUDE.md
     - Kind: measured
     - Test: tests/world-budget.test.ts
-->

## Growing Structures

<!-- One "### G<n>" entry per list, map or counter in persistent state that grows with players
     or with time. A structure with no cap is refused unless a designer ruling allows it.
     - State: where it lives, e.g. Almanac.mail in the world partition.
     - Grows with: players, time, or players and time.
     - Chunk: the slug of the chunk that added it.
     - Cap: <CONSTANT> in <file>: the constant the code enforces, and the file enforcing it.
     - Measured by: the test that fills the structure to that cap at the declared maximum
       population (every per-seat list full) and checks the size budget. It must use the
       cap constant, so the measurement is tied to the cap the code enforces.
     - Ruling: instead of Cap, "Ruling <n>": a RULINGS.md ruling where the designer
       allowed it to grow without a cap.

     ### G1
     - State: Almanac.mail, in the world partition
     - Grows with: players and time
     - Chunk: clans
     - Cap: MAILBOX_CAP in src/rules/mail.ts
     - Measured by: tests/mail-budget.test.ts
-->
