# Ask — The Human-Approval Gate (BUILD-04)

Referenced by `build-chunk.md` Step 3 (`ask`, third and last of the `{investigate, redteam,
ask}` session step group — see `state-machine.md` "Session Handoff Seams"). This is the
human-approval boundary: the point where a plain-language design is authorized before a single
line of code is written. Mirrors `ingest-rules.md` Step 6 (Approval Gate) + Step 7 (Write
Files) — same negotiate-then-gate posture, same single-point-of-write discipline, applied here
to one chunk instead of the whole sketch.

## First-UI-Chunk Design Check (pre-check, before Part (a))

If this chunk's `## ui:` tag is `touches` or `major` AND DESIGN.md does not yet exist on disk,
dispatch `build/design-ask.md` to completion (it writes `DESIGN.md`) before continuing to Part
(a) of this file's 4-part presentation for this same chunk. A chunk whose `## ui:` tag is
`none`, or whose game already has a `DESIGN.md` from an earlier UI chunk's ask, skips this
pre-check entirely and proceeds straight to Part (a) below.

## Inputs

The settled interpretation that clears `build/redteam.md` with no unresolved refuted-twice
escalations: CHUNK.md's `## Interpretation` and `## Visibility Declaration` sections (written by
`build/investigate.md`), plus CHUNK.md's `## Redteam Rounds` section (written by the
orchestrator at the end of each redteam round — see `build/redteam.md` "Persisting the Round").
The ask step has no subagent — the orchestrator reads these three CHUNK.md sections itself, the
sanctioned state-file read defined in `build-chunk.md`'s Context-Economics Hard Rule, and
restates them below; it never opens the rulebook slices or docs behind the claims.

`## Redteam Rounds` is what makes this gate cold-resumable: a session resuming directly at ask
(redteam checked, ask unchecked) consumes the **persisted** per-claim verdicts, objections, and
round dispositions from that section — which claims were refuted and superseded, and whether any
round's disposition reads `escalation open at ask` — never from conversation memory it does not
have. Any round disposition of `escalation open at ask`, and any ambiguity the redteam round
escalated to the user directly (`state-machine.md` "Redteam Escalation" — refuted-twice disputes
go to the human, never to more agents), is surfaced as a part (b) question below; a ruling
already recorded in RULINGS.md may already answer it.

## The Fixed 4-Part Presentation Format

Present the chunk's design to the user in exactly these four parts, in this order. This shape is
fixed — never reorder it, never merge parts, never add a fifth part:

**(a) Rules interpretation in plain designer language, with citations.** Every **live** claim
from CHUNK.md's `## Interpretation` restated in the register a designer would use, each carrying
its citation into the rulebook or RULINGS.md. A superseded claim is not live: a claim named as
superseded by a later claim (marked in place, or recorded as refuted in the latest `## Redteam
Rounds` entry with a superseding claim appended and no standing resolution) is **omitted** from
this presentation — its superseding claim is presented in its place and carries the citation.
Presenting a refuted original and its correction side by side as flat design facts would have
the user approve a contradictory interpretation:

> "When you land on an owned property, you pay rent equal to the amount shown on its card
> (p.6, 'Rent'). If it's mortgaged, no rent is owed (p.9, 'Mortgages')."

**(b) Ambiguities as concrete questions with explicit options.** Anything the rulebook and
RULINGS.md leave undecided is put to the user as a named choice, never a vague open question:

> "The rulebook doesn't say what happens if you can't afford rent and have no mortgageable
> property. Option A: you go bankrupt immediately. Option B: you may sell buildings first.
> Which do you want?"

**(c) what you will NOT see yet.** An explicit deferred list, so the user isn't surprised by
what this chunk excludes:

> "This chunk does not yet include: trading with other players, building houses/hotels, or the
> auction rule for declined purchases."

**(d) Zero implementation vocabulary.** The entire presentation body — parts (a)-(c) — contains
NO engine or implementation terms. This is a total ban, not a style preference.

## Prohibited Vocabulary

The presentation body must never use BoardSmith API or engine vocabulary to describe the
design. Forbidden words (non-exhaustive; the spirit is "designer language only", these are the
recurring offenders per 143-RESEARCH.md Pitfall 2):

- `action` — describe what the player does ("you pay rent"), never "the rent action fires."
- `flow` — describe what happens next ("then the next player takes their turn"), never
  "control returns to the flow."
- `state` — describe the game situation ("the property is now mortgaged"), never "state
  updates" or "game state."
- `element` — describe the physical/visual thing ("the property card", "the token"), never
  "element" or "GameElement."

If a claim from CHUNK.md's `## Interpretation` was written using engine vocabulary internally,
translate it into designer language for this presentation — the citation carries forward, the
wording does not.

## Assets — Never-Blocking Placeholder Request

Request any assets this chunk's build needs, keyed to `ASSETS.md`'s existing component
inventory (seeded at ingest — see `ingest-rules.md` Step 3). A missing asset never blocks a
chunk: if the user doesn't have final art yet, that's fine — "I don't have art yet" never
blocks the chunk from proceeding. A placeholder that matches the final layout is used instead
(correct aspect ratio, styled with `DESIGN.md`'s own tokens), and the debt is recorded, not
hidden.

Recording the debt: append a row to `ASSETS.md`'s 5-column ledger (`needed-by-chunk | requested
| received | placeholder-in-use | file path` — `templates/ASSETS.template.md`). Fill this row;
never restructure the ledger's header. If the asset was already requested at ingest, update its
existing row rather than duplicating it.

## House-Rule / Adaptation Choices — RULINGS.md

Any house-rule or digital-adaptation choice the user makes while answering part (b) — including
any answer to a redteam refuted-twice escalation still open when this step starts — is recorded
as a new `### Ruling N` entry in `RULINGS.md`, filling `templates/RULINGS.template.md`'s
Decision / Citation interpreted or overridden / Rationale shape exactly. Never restructure the
ledger's header, and never overwrite or renumber a prior entry — RULINGS.md is append-only.

## Gate-Before-Write

Present all four parts, then negotiate: the user's answer wins on any ambiguity in part (b)
unless a hard dependency is violated, in which case name the dependency concretely and propose
the minimal resolution. Do **not** write anything durable — not `Status: approved`, not a
RULINGS.md entry, not an ASSETS.md row — until the user has given explicit approval. Presenting
is not approving; only an explicit yes authorizes the write.

Only after that explicit yes:

1. Write any RULINGS.md `### Ruling N` entries from house-rule/adaptation choices made above.
2. Write any ASSETS.md ledger row updates from the asset request above.
3. Check off `ask` on CHUNK.md's Step Checklist (investigate and redteam were already checked
   off when those steps completed — see `build-chunk.md` "Step Group 1 Dispatch").
4. Write `Status: approved` to CHUNK.md **last**, after every other write for this gate has
   landed (cite `state-machine.md` "Write Order" — the `Status:` line is updated last so a
   session that crashes mid-write leaves a file whose status still reflects the last
   fully-completed state, never a half-written one).
5. Then update this chunk's derived-status pointer in SKETCH.md to match: `Status (derived from
   chunks/<slug>/CHUNK.md): approved`. This is the second half of every status write —
   `state-machine.md` "Write Order": CHUNK.md first, then SKETCH.md second, never SKETCH.md
   alone and never a status write without the derived pointer following. Step 4's **last**
   governs CHUNK.md's own writes; this mirror write always follows it. Skipping it leaves
   SKETCH.md reading `proposed` against CHUNK.md's `approved` — a known contradiction the next
   session's consistency check would have to log and repair.

**Carve-out:** `build/investigate.md`'s claims list — CHUNK.md's `## Interpretation`, `##
Visibility Declaration`, and `## Newly Discovered Citations` — was already written progressively
during the `investigate` step, before this gate. It is NOT re-gated or re-copied here; those
sections are settled facts about what the rulebook says, not the design authorization this gate
covers (the same carve-out `ingest-rules.md` Step 7 applies to `ASSETS.md` and
`rulebook/00-visual-survey.md`, which record factual evidence written at Step 3, not gated
sketch state re-written at Step 7).

## Downstream Shape (cite, never restate)

Once `Status: approved` lands, the settled, user-approved interpretation from `build/redteam.md`
is the upstream authority for `build/build.md` — the next session picks up the step group
`{build, test}`. This file does not restate that step group's structure.
