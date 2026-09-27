# Filings

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- This is the FILINGS / LIBRARY-GAP ledger: everything this game's build discovered about
     BoardSmith itself — a bug in the library, or a core capability the game genuinely needs and
     the library does not have.

     WHY IT EXISTS: `build/build.md` "Boundaries" rule 3 says a library shortfall is FILED, never
     patched — `node_modules/boardsmith` is the designer's real library checkout and is read-only.
     This is where a filing lands, and `orchestrate/filings.md` is how it gets from here to the
     BoardSmith issue tracker (github.com/Shufflewick/BoardSmith) so it can actually be fixed.

     WHO WRITES HERE:
     - Any step that hits a library shortfall or a library bug — most often `build`, `test`, or
       `audit` — files it here as it is found, not at the end of the chunk.
     - `build/close.md`'s Bookkeeping Sequence re-touches an existing filing when this chunk's
       own work resolved or advanced it (SKILLAUTO-08), so the ledger never describes a gap the
       library no longer has.
     - `/bs-check-status` reads this ledger; it never writes it. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1 and the "## Ledger"
     heading, and (once populated) entries each carrying Kind / Title / What happened / Blocked /
     Workaround in the game / BoardSmith version / Reported / Issue. If this file exists but
     "## Ledger" is missing, a resuming session STOPS and asks the designer — it never guesses
     the intended state. See state-machine.md "Cold-Resume Parse Contract". -->

## Ledger

<!-- Entries are append-only: never delete or renumber one. The sanctioned in-place fills are an
     entry's `Reported` and `Issue` fields (recorded → posted, and the issue URL once it exists)
     and its `Workaround in the game` field when a later chunk changes how the gap is worked
     around. A filing that turns out to be wrong is superseded by a NEW entry that says "Supersedes
     Filing M.", never deleted, and Filing M gets one line added in place, `- Superseded by: Filing N`.

     STATUS LIVES IN THE FIELDS ONLY. `Reported` and `Issue` are the status every reader acts on;
     never add a banner line such as "POSTED <date>" above them. When a filing is posted, change
     the two fields. `Reported: posted` or `posted-by-designer` always has the issue URL in
     `Issue`; `recorded` or `declined` always has "n/a — not posted".

     CHECKED AS CODE: `boardsmith ledger-check` fails on a filing number used twice, on a
     supersession without its in-place pointer, on a missing or unknown `Reported` value, on two
     `Reported` fields that disagree, on `Reported` and `Issue` disagreeing, and on a status banner
     that contradicts `Reported`.

     Each entry is a numbered "### Filing N" section with exactly these fields:
     - Kind: bug | feature-request — `bug` is BoardSmith doing something it documents as working;
       `feature-request` is a core capability BoardSmith does not have and this game needs. A
       feature request is only a feature request when the game genuinely cannot do it itself
       (see orchestrate/filings.md's bar) — most gaps are the game's job, not the library's.
     - Title: one line, specific enough to be an issue title on its own
     - What happened: what was expected, what actually happened, and the smallest reproduction —
       for a feature request, what the game needs and why the library is the only place it can live
       (an example ledger id in a reproduction, such as `### Filing @x.1`, goes in a code span, or
       chunk-merge reads it as a citation of an entry that does not exist)
     - Blocked: the chunk slug this came out of, and whether it blocked that chunk or was worked
       around
     - Workaround in the game: what the game does instead, or "none — the chunk is blocked"
     - BoardSmith version: from the game's own `boardsmith` dependency (never guessed)
     - Reported: recorded | posted | posted-by-designer | declined — `recorded` means it lives
       only here; `declined` means the designer chose not to report it (and stands, never re-asked)
     - Issue: the issue URL, or "n/a — not posted"

     Example shape (illustrative only — not real content, delete-and-replace guidance stays):

     ### Filing 1
     - Kind: bug
     - Title: Dragging a card onto a full pile leaves the card mid-flight instead of snapping back
     - What happened: A drag onto a pile at its capacity limit should be rejected and the card
       should return to its origin. Instead the card stays where it was dropped and the next
       render draws it twice. Smallest repro: two-card pile with a max of two, drag a third onto
       it. Reproduced in the dev host, both seats.
     - Blocked: discard-pile — worked around
     - Workaround in the game: the pile hides its drop target once it is full, so the rejected
       drag cannot start.
     - BoardSmith version: file:../../BoardSmith (local checkout at commit f2f19c77)
     - Reported: posted
     - Issue: https://github.com/Shufflewick/BoardSmith/issues/123
-->
