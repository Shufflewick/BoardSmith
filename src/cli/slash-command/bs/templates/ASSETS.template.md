# Assets

<!-- This is the component/asset ledger: every visual component or media asset this game's UI
     needs, tracked from first mention through delivery.

     POPULATED AT:
     - Ingest: an initial component inventory (with aspect ratios) is recorded here from the
       rulebook's component list / visual identity survey.
     - Every chunk's `ask` step: as a chunk's build needs a specific asset, it is requested here
       (if not already present from ingest).

     A MISSING ASSET NEVER BLOCKS A CHUNK. If an asset is requested but not yet received, the
     chunk proceeds with a designed placeholder (see DESIGN.template.md "Placeholder Policy") —
     correct aspect ratio, styled with DESIGN.md's own tokens — and this ledger's
     "placeholder-in-use" column records that fact so it's visible which components are still
     running on placeholders. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, the "## Ledger"
     heading, and a table whose header row contains exactly these five columns, in this order:
     needed-by-chunk | requested | received | placeholder-in-use | file path
     If this file exists but the table header doesn't match, a resuming session STOPS and asks
     the user — it never guesses the intended state. See ../state-machine.md
     "Cold-Resume Parse Contract". -->

## Ledger

<!-- Append a row per component/asset. Do not delete or renumber rows — an asset that becomes
     obsolete gets a note in its row, not deletion (state files are append-only per
     ../state-machine.md "Write Order"). -->

| needed-by-chunk | requested | received | placeholder-in-use | file path |
|------------------|-----------|----------|---------------------|-----------|
<!-- | movement | yes | no | yes | src/assets/pawn.png (placeholder) | -->
