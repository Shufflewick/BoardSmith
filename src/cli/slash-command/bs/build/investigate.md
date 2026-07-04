# Investigate — Claims-List Interpretation (BUILD-02)

Referenced by `build-chunk.md` Step 2 (`investigate`, first of the `{investigate, redteam, ask}`
session step group — see `state-machine.md` "Session Handoff Seams"). This is the interpretation
engine of the build-chunk pipeline: it turns a chunk's cited rulebook slices plus the project's
accumulated ledgers into a numbered, citation-backed claims list and an explicit
hidden-information visibility declaration — the input `redteam.md` independently reviews and
`ask.md` presents to the user. Mirrors `ingest/transcription.md`'s fan-out-dispatch idiom.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads the chunk's cited slices, the INDEX-discovered slices,
RULINGS.md, DECISIONS.md, the required BoardSmith docs, or DESIGN.md itself, and it never
re-reads a CHUNK.md section after the investigate subagent writes it.** Every fact the
orchestrator needs about this chunk's rules content comes from the structured summary the
subagent returns, not from opening any of those files again. The single most tempting mistake in
this step is adding a "let me double-check by re-reading what I just wrote" pass after the
subagent returns. Do not do this. It silently reintroduces the exact context-exhaustion failure
mode the fan-out design exists to avoid. If something looks wrong in a returned summary, dispatch
a narrower follow-up subagent or ask the user — never fall back to reading the chunk's sources
yourself.

## Required Reading (cite verbatim — do not re-derive)

This step is the permanent, durable owner of the doc-reading discipline `ingest/scaffold.md`
handed off ("this scaffold step's concern is limited to... `/bs-build-chunk`'s own `investigate`
step owns the full required-reading discipline for chunk work"). Every investigate dispatch
names, by exact filename, the docs relevant to this chunk:

- `docs/core-concepts.md` — always.
- `docs/common-pitfalls.md` — always.
- `docs/actions-and-flow.md` — when the chunk involves actions.
- `docs/custom-ui-guide.md` and `docs/ui-components.md` — for `ui: touches` or `ui: major`
  chunks (this chunk's CHUNK.md `## ui:` tag).
- `docs/dice-and-scoring.md` — for dice-mechanic chunks.
- `DESIGN.md` — for `ui: touches` or `ui: major` chunks. (`DESIGN.md` does not exist until the
  first UI chunk's `ask` writes it, which is why `ingest/scaffold.md` could not name it —
  investigate is the first step downstream of that write.)

## Inputs to Read

A fresh-context Task-tool subagent reads, for this chunk:

1. The chunk's cited slices — the `rulebook/NN-topic.md` files this CHUNK.md already cites.
2. INDEX-discovered slices — search `rulebook/INDEX.md` for this chunk's key terms and read any
   additional slice the search surfaces that isn't already cited.
3. `RULINGS.md` — rulings outrank the rulebook; the rulebook plus `RULINGS.md` together form the
   composite source of truth (`state-machine.md` "Rulings Outrank Rulebook").
4. `DECISIONS.md` — prior house-rule/design decisions this chunk must stay consistent with.
5. The Required Reading docs above, resolved for this chunk's tags.
6. `DESIGN.md` — for `ui: touches|major` chunks only.

## Fan-Out Dispatch

Dispatch one fresh Task-tool subagent — fill `{gameName}`, `{slug}`, the resolved slice paths,
and the resolved doc list from above; a fresh-context subagent has no inherited knowledge of
where this chunk's sources live:

```
Investigate the rules interpretation for {gameName}, chunk "{slug}". Read the following:
  - Cited slices: {citedSlicePaths}
  - INDEX-discovered slices (search rulebook/INDEX.md for this chunk's key terms): any
    additional slice the search surfaces
  - RULINGS.md (rulings outrank the rulebook — read it as the composite source of truth
    together with the slices above)
  - DECISIONS.md
  - {resolvedDocList} (e.g. docs/core-concepts.md, docs/common-pitfalls.md, and any of
    docs/actions-and-flow.md / docs/custom-ui-guide.md / docs/ui-components.md /
    docs/dice-and-scoring.md that apply to this chunk)
  - DESIGN.md (only if this chunk's `## ui:` tag is touches or major)

WRITE directly into this chunk's CHUNK.md — do not return this content, write it yourself:
  1. `## Interpretation` — a numbered list of factual claims this chunk's design rests on, each
     with a citation into the rulebook (via INDEX.md) or RULINGS.md. Append new claims after any
     already present — never renumber existing claims (CHUNK.template.md's parse contract).
  2. `## Visibility Declaration` — what is hidden from whom, keyed to the claim numbers above
     (e.g. "claim 3: the drawn card is hidden from all other seats until played"). If this chunk
     has no hidden information, write that explicitly ("none — no hidden information in this
     chunk") rather than leaving the section blank.
  3. `## Newly Discovered Citations` — append any INDEX-discovered slice not already cited by
     the chunk, so the record shows what search surfaced beyond the original citations.

Do not restructure CHUNK.md's other sections. Fill only the three named above.

Return exactly: { claimsList (a short pointer/count summary, e.g. "7 claims written, see
## Interpretation"), visibilityDeclaration (the declaration text or a pointer to it),
newlyDiscoveredCitations (the list of any newly discovered citations, or empty) }
```

The subagent is the sole writer of `## Interpretation`, `## Visibility Declaration`, and
`## Newly Discovered Citations`. What flows back to the orchestrator is the short structured
return above — never the full claims text, never the full visibility declaration prose beyond
what's needed to relay it forward. This is the same discipline that fixed
`142-REVIEW-FIX.iter2.md`'s CR-03 ("`sectionText` defeated context economics") — a subagent
writes state directly; it does not hand its output back through the orchestrator's context.

## Re-Investigate Round Behavior (redteam refuted-once path)

When `redteam.md` returns a refuted-once verdict on a claim, the re-investigate round APPENDS a
new claim noting supersession of the objected claim — it does NOT renumber or silently rewrite
the existing numbered list. Concretely: if claim 7 is refuted with a specific objection and
re-investigation concludes the objection is valid, the subagent appends a new claim (e.g. claim
12) whose text states what claim 7 should have said and explicitly notes "supersedes claim 7 per
redteam objection," leaving claim 7's original text and number untouched in place. This keeps the
append-only philosophy that governs the Revision Rounds and Findings Ledger sections of
CHUNK.template.md consistent across every append-only section in the file — no numbered claim's
text is ever edited or removed once written; correction always takes the form of a new, later
claim that supersedes it.

## Orchestrator Records (never re-reads CHUNK.md's `## Interpretation`)

The investigate subagent writes every section named above; the orchestrator only accumulates the
returned `claimsList`, `visibilityDeclaration`, and `newlyDiscoveredCitations` fields — it never
opens CHUNK.md itself to double-check what the subagent wrote before handing the claims list
forward to `redteam.md`. If a returned summary looks incomplete or wrong, dispatch a narrower
follow-up investigate subagent rather than reading the file to verify.

## Downstream Shape (cite, never restate)

The claims list this step writes into CHUNK.md's `## Interpretation` and `## Visibility
Declaration` feeds `build/redteam.md` — the 3 fresh-context adversarial reviewers (2 refuters + 1
coverage adversary) that independently check this interpretation next — and, once redteam
clears it, `build/ask.md`'s user-facing presentation. This file does not restate either
consumer's structure; `redteam.md` and `ask.md` read directly from CHUNK.md and from the
`claimsList`/`visibilityDeclaration`/`newlyDiscoveredCitations` return-shape fields defined
above.
