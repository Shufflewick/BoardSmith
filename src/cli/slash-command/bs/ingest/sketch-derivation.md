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

The operative word is **smallest**, not *coherent*. The most common sizing mistake is to reason
"the core loop of this game is <the whole family of core mechanics>, so chunk 1 must implement
all of it" — which bundles the single biggest slice of the entire plan into position one. Resist
it. Pick the **one simplest instance** of the core interaction and nothing more. Two concrete
tells that chunk 1 has been over-scoped:

- **It is the heaviest chunk in the plan.** Chunk 1 should be near the *lightest*, not the
  heaviest. If you catch yourself flagging it as "the big one," back it down.
- **It bundles several members of a mechanic family** (see Section 2) when one member would
  already produce an observable turn.

A static render with no action is NOT a valid first chunk either — a board that only *displays*
is a screen, not a turn. Pair that first render with the single simplest real action (the one
that is cheapest to make correct) so the result is a genuine, observable core-loop turn — render
**plus one simple action**, never render-plus-every-action.

**Milestone flag (SKILLAUTO-01):** set the milestone flag on this chunk — SKETCH.template.md's
`Milestone:` field, on the Ordered Chunk List entry — to `core-loop` at sketch-derivation time.
This is an explicit sketch-time assignment, never inferred at runtime: write the value into this
chunk's entry the moment it is placed in the Ordered Chunk List, so a resuming session never has
to guess which chunk is the core-loop milestone. This is one of the sketch's three milestone
anchors (see Section 3 and `templates/SKETCH.template.md`'s "## Mandated Chunks"); it is where the
human client-playtest stop occurs (state-machine.md's human-gate list, `build/playtest.md`'s
Verified Gate) — not on every chunk.

## 2. Prefer Many Small, Single-Behavior Chunks — Split Families of Similar Mechanics

A chunk should deliver **one observable behavior a human can verify in isolation** — the smallest
change that produces a new, checkable result on screen. Bias toward more, smaller chunks; never
compress the plan into fewer, larger ones.

When a game has a **family of similar-but-distinct mechanics** — several piece/unit movement
types, several card types, several player actions, several resource or scoring rules, several
enemy behaviors — give **each member its own chunk**, ordered simplest-first (and by hard
dependency where one member genuinely requires another; see Section 8). Do not collapse the whole
family into one "movement" / "actions" / "cards" chunk. Each member is separately playtestable and
separately verifiable, and a single bug in a bundled chunk blocks the human sign-off on every
member it contains — whereas split chunks let a playtester confirm one behavior, sign off, and
move on.

Two principles keep this from feeling wasteful:

- **Chunk boundaries track observable behavior, not code structure.** Members of a family will
  often converge on one internal primitive (a shared resolver, one reused component, a common
  base rule). That convergence is a *build-time refactor* and is **not** a reason to merge their
  chunks. Splitting by behavior keeps each playtest gate crisp even when the code underneath is
  shared; the build steps are free to factor out the common primitive without touching the chunk
  list.
- **A finer-grained list is free up front.** The Hard Cap (Section 6) means only the next 2-3
  chunks are ever detailed at ingest — the rest stay one-line sketch-level entries until their
  turn. So splitting a family into six entries instead of one costs nothing now: five of them
  remain sketch-level and un-elaborated. There is no token or planning penalty for a longer list,
  so never shorten it just to keep the count down.

When a family member becomes genuinely trivial *because* its siblings already exist — it is only
a composition of already-built mechanics — keep it as its own entry and tag it a light-path
candidate (trivial chunks run the light path — see `state-machine.md` "Step Names (exact, light
path — trivial chunks)"), rather than merging it back into a sibling.

## 3. Mandated Downstream Chunks

Per the same "## Mandated Chunks" section, the sketch MUST also contain:

- A **game-end / scoring / winner-determination chunk** — the point at which the game reaches its
  actual finishing condition and a winner (or outcome) is determined.
- A **final-acceptance chunk** — the full game played start-to-finish, a coverage check confirming
  every non-variant rulebook slice was built, plus the design-QA/a11y audit (gated by any chunk
  tagged `ui: touches` or `ui: major`).

Do not treat either of these as optional or "implied by the last chunk" — each must appear as its
own explicit entry in the Ordered Chunk List.

**Milestone flags (SKILLAUTO-01):** set the milestone flag — SKETCH.template.md's `Milestone:`
field — on these two chunks at sketch-derivation time, the same explicit sketch-time assignment
described in Section 1: the game-end/scoring/winner-determination chunk gets `Milestone: scoring`,
and the final-acceptance chunk gets `Milestone: final-acceptance`. Together with the core-loop
chunk (Section 1, `Milestone: core-loop`) these are the sketch's three milestone anchors, exactly
matching `templates/SKETCH.template.md`'s "## Mandated Chunks" list. **Every other chunk in the
Ordered Chunk List — every non-anchor chunk, including every tail entry — gets `Milestone: none`.**
This flag is never inferred at runtime; the human client-playtest stop is scoped to these three
milestones plus a genuine rules-adjudication escalation (see state-machine.md's human-gate list),
so getting the flag right here is load-bearing for the whole autonomous run.

## 4. The `ui:` Tag

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

Note the interaction with Section 2: when a family is split into one chunk per member, usually
only the **first** member that introduces the shared surface/interaction is `ui: major`; its
siblings, which reuse that same surface, are typically `ui: touches`. That asymmetry is expected
and is another sign the split is sized correctly — a plan where every member chunk is `ui: major`
usually means the surface should have been introduced once, up front, and reused.

## 5. Outcome-Based Test Scripts

Each chunk's test script states an OUTCOME, not a gesture. Write "move a pawn one space; the board
reflects it," never "click the pawn twice." A test script that only describes UI mechanics (which
button, how many clicks) fails to communicate what a playtester should actually observe as correct
behavior — state the observable result. A well-sized single-behavior chunk (Section 2) makes this
easy: its test script is one crisp observable outcome. If a chunk's honest test script needs
"and… and… and…" to cover several unrelated outcomes, that is a signal it bundles behaviors that
should be separate chunks.

## 6. Hard Cap: Only the Next 2-3 Chunks Are Detailed

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

This cap is also what makes Section 2's "split the family" guidance cheap: a long, finely-split
Ordered Chunk List is almost entirely sketch-level tail at ingest, so granularity adds entries,
not up-front work.

## 7. Variants Are Out-of-Scope-by-Default

Variant, optional, and advanced rules found in the rulebook are tagged out-of-scope-by-default and
listed under `SKETCH.md`'s "Variants (deferred)" section — acknowledged and deliberately deferred,
never silently dropped and never folded into the main Ordered Chunk List without an explicit
decision to bring one in scope.

## 8. Negotiation Posture

When the designer proposes a different chunk ordering than this heuristic would derive, the
user's ordering wins unless a named hard dependency is violated — e.g. a scoring chunk that
genuinely cannot function without a prerequisite chunk's element already existing. When a hard
dependency blocks the requested ordering, name it concretely and propose the minimal prerequisite
chunk needed to unblock it; do not silently reorder without explanation, and do not block the
designer's ordering on a soft preference dressed up as a dependency.

The same posture governs chunk **granularity**, not just ordering: present the finely-split list
from Section 2 as the default proposal, but if the designer wants members merged (or split
further), that is their call — surface the trade-off (a merged chunk means one coarser playtest
gate covering several behaviors) and follow their decision. Granularity is a strong default, not a
mandate to impose over the designer's stated preference.
