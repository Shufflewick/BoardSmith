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

Session Lock: <!-- none | "<slug> — locked at <ISO timestamp>" -->
<!-- A second concurrent session sees this lock note on entry and warns the user instead of
     silently clobbering the in-progress session's work. See state-machine.md "Session Lock". -->

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
     (none|touches|major), a derived status pointer (copy chunks/<slug>/CHUNK.md's Status line —
     do not re-decide it here), and an outcome-based human test script (state outcomes, not
     gestures — "move a pawn one space; the board reflects it", not "click the pawn twice"). -->

### <!-- slug -->
- What it builds: <!-- one-line description -->
- Citations: <!-- rulebook section(s) -->
- ui: <!-- none | touches | major -->
- Status (derived from chunks/<!-- slug -->/CHUNK.md): <!-- proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
- Test script (outcome-based): <!-- "move a pawn one space; the board reflects it" style description -->

<!-- Repeat one "### <slug>" block per chunk, in list order. Tail entries beyond the next 2-3
     chunks may omit Citations/Test script detail and stay at sketch-level. A tail entry has NO
     chunks/<slug>/ directory and NO CHUNK.md yet (ingest does not create stubs for the tail);
     its Status line uses exactly the sketch-level marker below, which exempts it from
     consistency-check item 1 (see state-machine.md "Consistency Check"). When the entry is
     detailed at a close gate, its directory + CHUNK.md are created and this Status line is
     rewritten to the derived form used above. -->

### <!-- slug (tail entry, sketch-level only) -->
- What it builds: <!-- one-line description -->
- ui: <!-- none | touches | major -->
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
