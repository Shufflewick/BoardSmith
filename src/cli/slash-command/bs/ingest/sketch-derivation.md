# Sketch Derivation

Referenced by `ingest-rules.md` Step 4 ("Sketch Derivation"). This file is the chunking heuristic
that FILLS `templates/SKETCH.template.md` — it cites that template's "## Mandated Chunks" and
"## Ordered Chunk List" sections by name and never restates their structure inline. If you are
extending this file, link to the template section instead of copying its rule text (the same
citation-not-restatement convention `state-machine.md` establishes for every `bs-` skill).

## 1. First Chunk Is Always the Core Event Loop

Per `templates/SKETCH.template.md`'s "## Mandated Chunks" section, the first entry in the
Ordered Chunk List is always the core event loop: the smallest slice where a human takes one
browser action and sees a response. Do not open with setup/config chunks, menu chunks, or
data-modeling-only chunks — the very first thing a playtester touches must be a real, observable
turn of the game.

## 2. Mandated Downstream Chunks

Per the same "## Mandated Chunks" section, the sketch MUST also contain:

- A **game-end / scoring / winner-determination chunk** — the point at which the game reaches its
  actual finishing condition and a winner (or outcome) is determined.
- A **final-acceptance chunk** — the full game played start-to-finish, a coverage check confirming
  every non-variant rulebook slice was built, plus the design-QA/a11y audit (gated by any chunk
  tagged `ui: touches` or `ui: major`).

Do not treat either of these as optional or "implied by the last chunk" — each must appear as its
own explicit entry in the Ordered Chunk List.

## 3. The `ui:` Tag

Every chunk entry records a `ui:` tag with exactly one of these values:

```
ui: none | touches | major
```

`none` — no UI surface is added or changed. `touches` — the chunk touches existing UI surface
without introducing a new interaction pattern. `major` — the chunk introduces a new interaction
pattern or a substantial new UI surface. This tag is what gates the final-acceptance chunk's
design-QA/a11y audit (per Mandated Chunks above) and downstream `/bs-build-chunk` steps (UIQ-01
through UIQ-05) — get it right at sketch time rather than leaving it blank for later
reinterpretation.

## 4. Outcome-Based Test Scripts

Each chunk's test script states an OUTCOME, not a gesture. Write "move a pawn one space; the board
reflects it," never "click the pawn twice." A test script that only describes UI mechanics (which
button, how many clicks) fails to communicate what a playtester should actually observe as correct
behavior — state the observable result.

## 5. Hard Cap: Only the Next 2-3 Chunks Are Detailed

Detail only the next 2-3 chunks in the Ordered Chunk List. Do not detail the entire game up front —
this is a deliberate anti-completeness constraint, not an oversight to "fix" by filling in more.
Every entry beyond the next 2-3 stays at sketch level: `What it builds` and `ui:` only, no
Citations, no Test script detail, and its Status line uses the exact byte-identical tail marker:

```
Status: proposed (sketch-level — no CHUNK.md yet)
```

A tail entry has NO `chunks/<slug>/` directory and NO `CHUNK.md` file — ingest does not create
stubs for the tail. This exact marker string is what exempts tail entries from consistency-check
item 1 (see `state-machine.md` "Consistency Check"); using any other wording (different
capitalization, a hyphen instead of the em-dash, dropped parenthetical) breaks that exemption and
must never drift. When a tail entry is later detailed at a close gate, its directory and `CHUNK.md`
are created and this line is rewritten to the detailed form (`templates/SKETCH.template.md`'s
"Status (derived from chunks/<slug>/CHUNK.md): ..." grammar).

## 6. Variants Are Out-of-Scope-by-Default

Variant, optional, and advanced rules found in the rulebook are tagged out-of-scope-by-default and
listed under `SKETCH.md`'s "Variants (deferred)" section — acknowledged and deliberately deferred,
never silently dropped and never folded into the main Ordered Chunk List without an explicit
decision to bring one in scope.

## 7. Negotiation Posture

When the designer proposes a different chunk ordering than this heuristic would derive, the
user's ordering wins unless a named hard dependency is violated — e.g. a scoring chunk that
genuinely cannot function without a prerequisite chunk's element already existing. When a hard
dependency blocks the requested ordering, name it concretely and propose the minimal prerequisite
chunk needed to unblock it; do not silently reorder without explanation, and do not block the
designer's ordering on a soft preference dressed up as a dependency.
