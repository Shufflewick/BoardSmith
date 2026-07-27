# Rulebook Index — <!-- game name -->

<!-- This file is FILLED, never edited in place in the shipped skill tree — matching the
     "never edit the shipped template itself" rule this skill family already applies to
     SKETCH.template.md and CHUNK.template.md. Copy this file to `rulebook/INDEX.md` and fill
     its placeholders; the shipped copy under templates/ stays byte-identical across every
     game project. -->

<!-- This is the rulebook slice index: the first file a designer reads to understand what
     ingest produced. It is written ONCE, at ingest Step 3 (Synthesis), from subagent-returned
     summaries only -- never by re-reading a slice this orchestrator just had a subagent
     write -- and is updated by later steps (e.g. /bs-insert-chunk) that add slices. -->

<!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this H1, the four header
     lines ("Edition:", "Source:", "Source hash:", "Transcribed:"), the "## Open Rules Gaps"
     heading, the "## Slices" heading, and the "## Term → Slice" heading. These three headings
     are LITERAL TEXT: they are never reworded, abbreviated, translated, or given a
     parenthetical suffix appended after the heading text. Fill the placeholders beneath each
     heading; do not rename the heading itself.
     `/bs-check-status` and every chunk's term→slice sweep parse the "## Slices" and
     "## Term → Slice" tables by these exact heading strings -- a renamed heading breaks both. -->

Edition: <!-- The edition/printing, from the `edition` field the opening-pages transcription
     subagent returns. If the rulebook states no edition, write exactly
     "not stated in the rulebook". IMPORTANT: "unpublished — designer statement" is the
     INTERVIEW PATH's value (no source rulebook at all) -- it must NEVER appear on this
     (rulebook) path, where a source file exists. -->

Source: <!-- The in-project archived path, exactly "rulebook/source/<original-filename>" --
     never an external absolute path (e.g. never "/Users/..." or "~/..."). The archive and its
     path are produced by ingest Step 2.5, not by this step. -->

Source hash: <!-- The bare 64-hex-character SHA-256 of the ARCHIVED file, computed in ingest
     Step 2.5 by actually running `shasum -a 256` (or `sha256sum`) -- never a value that was
     not produced by running that command. This line depends on Step 2.5 having run first. -->

Transcribed: <!-- The ISO date (YYYY-MM-DD) of this ingest session. -->

<!-- All four lines above are ALWAYS present -- a line is never dropped, never left blank, and
     never deleted. When a value is genuinely unknown, write the line with an explicit stated
     value (e.g. "not stated in the rulebook"), never omit it. -->

## Open Rules Gaps

<!-- Built EXCLUSIVELY from the accumulated `openGaps[]` return lists the transcription
     subagents (or the interview path) return -- never by re-reading or grepping slice files.
     This section is ALWAYS written. When no gaps were returned, the body below is exactly
     `_None._` and nothing else. Every returned `openGaps[]` entry is listed, one per numbered
     list item, with NO deduplication -- a rule name recurring across slices is itself signal
     (the rulebook names it in more than one place and defines it in none).

     This section reports what transcription MARKED as named-but-undefined during transcription
     -- it does not claim to be an exhaustive list of the rulebook's gaps. -->

<!-- Example entry shape (do not leave this comment or example in the filled file):
1. "Overtime" -- named in `03-scoring.md` but never defined; no rule found describing it.
-->

_None._

## Slices

<!-- One row per rulebook slice file, built as slices are written -- never by re-reading a
     slice back. -->

| Slice | Pages | Covers |
|-------|-------|--------|
<!-- | 02-solo-variant.md | p.5-6 | Solo mode setup and scoring adjustments | -->

## Term → Slice

<!-- Built EXCLUSIVELY from the accumulated `citedTerms[]` lists the transcription subagents
     (or the interview path) return -- never by re-reading slice files. Uses the rightwards
     arrow U+2192 in the heading above, never the ASCII "->" digraph. -->

| Term | Slice(s) |
|------|----------|
<!-- | Overtime | 03-scoring.md, 02-solo-variant.md | -->
