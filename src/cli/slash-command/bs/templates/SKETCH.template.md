# Sketch: <!-- game name -->

<!-- "state-machine.md" in this file refers to the bs- skills' shared reference file, installed
     alongside the bs- skills themselves (the skill instructions state its installed location).
     Decision: it is NOT copied into the game project — a copy would drift from the shipped
     authority; the skills resolve the reference. -->

<!-- Sketch entries below are DERIVED — each chunk's authoritative status lives in its own
     chunks/<slug>/CHUNK.md. On contradiction, CHUNK.md wins; this session logs the contradiction
     and repairs this file to match, never the reverse. See state-machine.md "Authority". -->

Sketch Version: 1
<!-- Bumped by /bs-insert-chunk on every structural change to the ordered chunk list below. -->

Session Lock: <!-- none | "<slug> @ <session-id> — locked at <ISO timestamp>" -->
<!-- A second concurrent session sees this lock note on entry and warns the user instead of
     silently clobbering the in-progress session's work. See state-machine.md "Session Lock".

     The ISO timestamp is ALWAYS produced by running `date -u +%Y-%m-%dT%H:%M:%SZ` at the moment
     the lock is taken or refreshed — never typed from memory, estimated, or otherwise fabricated;
     this is the only sanctioned source for the timestamp. `<session-id>` names which session
     holds the lock (any short session-scoped identifier generated once per session is fine) so
     the lock unambiguously names both which chunk and which session holds it.

     `none` is the released/no-lock value. A cleanly-closed chunk's `close` step sets this line
     back to `none` as its terminal write (see build/close.md's "Bookkeeping Sequence") — so a
     same-day session that later resumes a DIFFERENT next chunk finds no live lock here at all. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: "Sketch Version:", "Session Lock:",
     "## Player Counts", "## UI Strategy", "## Ordered Chunk List", "## Variants (deferred)",
     "## Ideas Backlog", "## Mandated Chunks". If any required heading is missing or malformed,
     a resuming session STOPS and asks the user — it never guesses the intended state. See
     state-machine.md "Cold-Resume Parse Contract". -->

## Player Counts
<!-- Min/max player counts and any per-count setup differences, recorded at ingest. -->

Min players: <!-- N -->
Max players: <!-- N -->
Per-count setup differences: <!-- e.g. "3-player variant removes the yellow deck", or "none" -->

## UI Strategy
<!-- Decided at ingest, with the user (Open Question 1 / RESEARCH.md): Custom UI from chunk 1,
     or AutoUI with a scheduled cutover to Custom UI at a later named chunk. Recorded here because
     DESIGN.md doesn't exist until the first UI chunk's `ask` step, which may be several chunks
     later — this decision needs a home before then. -->

Strategy: <!-- custom-from-chunk-1 | autoui-with-cutover -->
Cutover chunk (if autoui-with-cutover): <!-- slug, or n/a -->

<!-- Reminder: any later change to UI strategy (the AutoUI→Custom-UI cutover) flips ALL
     previously verified chunks back to `built` and re-opens their test scripts; any change to
     DESIGN.md flips every chunk whose verified surface it re-styles (state-machine.md
     "Restyle/Cutover Rule"). There is no silent "we'll re-verify later." -->

## Ordered Chunk List
<!-- Keyed by stable slug, not ordinal position — reordering this list never breaks
     chunks/<slug>/ directory references. Only the next 2-3 chunks need full sketch-level detail;
     the tail stays at a coarser sketch-level description and is re-derived as a delta at each
     chunk's close gate. Each entry: what it builds, cited rulebook sections, a `ui:` tag
     (none|touches|major), a `Milestone:` flag (see below), a derived status pointer (copy
     chunks/<slug>/CHUNK.md's Status line — do not re-decide it here), and an outcome-based human
     test script (state outcomes, not gestures — "move a pawn one space; the board reflects it",
     not "click the pawn twice").

     Status-line grammar (exactly two forms, machine-distinguishable — see state-machine.md
     "Cold-Resume Parse Contract"):
     - Detailed entry: "- Status (derived from chunks/<slug>/CHUNK.md): <enum-value>"
     - Tail entry:     "- Status: proposed (sketch-level — no CHUNK.md yet)"
     No other Status-line form is valid in this file.

     Milestone-flag grammar (SKILLAUTO-01): every chunk entry — detailed or tail — carries a
     `Milestone:` line with exactly one of `none | core-loop | scoring | final-acceptance`. This
     flag is what state-machine.md's human-gate list and build/playtest.md's Verified Gate read
     to decide whether a chunk gets the human client-playtest stop — it is set explicitly HERE,
     at sketch-derivation time (see ingest/sketch-derivation.md), never inferred at runtime. Only
     the three milestone anchors named in "## Mandated Chunks" below ever carry a non-`none`
     value; every other chunk (including every tail entry) is `Milestone: none`. -->

### <!-- slug -->
- What it builds: <!-- one-line description -->
- Citations: <!-- rulebook section(s) -->
- ui: <!-- none | touches | major -->
- Milestone: <!-- none | core-loop | scoring | final-acceptance -->
- Status (derived from chunks/<!-- slug -->/CHUNK.md): <!-- proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
- Test script (outcome-based): <!-- "move a pawn one space; the board reflects it" style description -->

<!-- Repeat one "### <slug>" block per chunk, in list order. Tail entries beyond the next 2-3
     chunks may omit Citations/Test script detail and stay at sketch-level. A tail entry has NO
     chunks/<slug>/ directory and NO CHUNK.md yet (ingest does not create stubs for the tail);
     its Status line uses exactly the sketch-level marker below, which exempts it from
     consistency-check item 1 (see state-machine.md "Consistency Check"). When the entry is
     detailed at a close gate, its directory + CHUNK.md are created and this Status line is
     rewritten to the derived form used above. Its Milestone flag carries forward unchanged. -->

### <!-- slug (tail entry, sketch-level only) -->
- What it builds: <!-- one-line description -->
- ui: <!-- none | touches | major -->
- Milestone: <!-- none | core-loop | scoring | final-acceptance -->
- Status: proposed (sketch-level — no CHUNK.md yet)

## Variants (deferred)
<!-- Out-of-scope-by-default variant/optional/advanced rules from the rulebook. Listed here so
     they are acknowledged and deliberately deferred, not silently dropped. -->

- <!-- variant name --> — <!-- rulebook citation -->

## Ideas Backlog
<!-- Fed by the revise step's triage category (b): "future scope" items surfaced during
     playtest that are real but out of scope for the current chunk. Append-only. -->

- <!-- idea, with source chunk if known -->

## Mandated Chunks
<!-- Every sketch must satisfy these structural requirements regardless of game specifics: -->

- The first chunk in the Ordered Chunk List above is always the core event loop.
- The sketch must contain a game-end / scoring / winner-determination chunk.
- The sketch must contain a final-acceptance chunk: the full game played start-to-finish, a
  coverage check confirming every non-variant rulebook slice was built, plus the design-QA/a11y
  audit (gated by any chunk tagged `ui: touches` or `ui: major`).

These three chunks — core event loop, game-end/scoring, final-acceptance — are the sketch's
three **milestone anchors** (SKILLAUTO-01): the ONLY chunks that ever carry a non-`none`
`Milestone:` value (`core-loop`, `scoring`, and `final-acceptance` respectively, matching their
Milestone-flag value one-to-one). Every other chunk entry's `Milestone:` line MUST be `none`.
These are the only chunks where a human client-playtest stop occurs by default — see
state-machine.md's human-gate list and build/playtest.md's Verified Gate.
