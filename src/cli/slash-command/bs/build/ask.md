# Ask — Settle the Interpretation, Park Only on a Rules Question (BUILD-04)

Referenced by `build-chunk.md` Step 3 (`ask`, third and last of the `{investigate, redteam,
ask}` session step group — see `state-machine.md` "Session Handoff Seams"). This is where a
chunk's plain-language design is settled before a single line of code is written.

**The ask step does not stop the run.** It writes the chunk's interpretation, and every default
it took, to `DECISIONS.md` and continues into `{spec, build, test}`. The designer reviews the
accumulated decisions in one batch at the next blocking playtest (`build/playtest.md` "Reviewing
the Decisions"); a decision they reject becomes a fix chunk. The one thing that stops a chunk here
is a **rules question** the rulebook and `RULINGS.md` do not answer: that chunk is parked until the
designer answers, and the run keeps building every chunk that does not depend on it
(`build-game.md` Step 3).

## Who Answers a Rules Question

Only the designer answers a rules question or signs off a playtest. An unattended run parks the
chunk at that question and keeps building the chunks that do not need the answer. The run, the
orchestrator, and any dispatched subagent pose the question; none of them answers it, and none of
them writes a `RULINGS.md` entry on the designer's behalf. A ruling or an archive override being
"reversible" does not make it the run's to take. There is no waiver for a rules question: a
playtest waiver (`build/playtest.md`) never covers one. A designer decision about one chunk is
never a precedent for another (see "Never re-ask an already-granted approval" below for what an
earlier answer does cover).

## Inputs

The settled interpretation that clears `build/redteam.md` with no unresolved refuted-twice
escalations: CHUNK.md's `## Interpretation` and `## Visibility Declaration` sections (written by
`build/investigate.md`), plus CHUNK.md's `## Redteam Rounds` section (written by the
orchestrator at the end of each redteam round — see `build/redteam.md` "Persisting the Round").
The ask step has no subagent — the orchestrator reads these three CHUNK.md sections itself, the
sanctioned state-file read defined in `build-chunk.md`'s Context-Economics Hard Rule, and
restates them below; it never opens the rulebook slices or docs behind the claims.

`## Redteam Rounds` is what makes this step cold-resumable: a session resuming directly at ask
(redteam checked, ask unchecked) consumes the **persisted** per-claim verdicts, objections, and
round dispositions from that section — which claims were refuted and superseded, and whether any
round's disposition reads `escalation open at ask` — never from conversation memory it does not
have. Any round disposition of `escalation open at ask`, and any ambiguity the redteam round
escalated to the user directly (`state-machine.md` "Redteam Escalation" — refuted-twice disputes
go to the human, never to more agents), is a rules question below; a ruling already recorded in
RULINGS.md may already answer it.

The game's design is already settled: `DESIGN.md` was signed off in the design session before
the first chunk (`ingest/design-session.md`). This step never re-opens it.

## Ask Triple-Gate (SKILLAUTO-02) — a question only when all three hold

Not every open item earns a question. Before any ambiguity reaches the designer, it must clear
all three gates:

1. **Genuinely undetermined by rules + prior answers.** The rulebook, `RULINGS.md`, and this
   chunk's already-settled interpretation do not decide the question between them.
2. **Load-bearing.** The answer actually changes what gets built for this chunk — a cosmetic or
   inconsequential choice does not qualify, no matter how undetermined it technically is.
3. **No reasonable default exists.** There is no sensible, low-risk assumption a competent
   designer would make without asking.

**If any one gate fails, do NOT ask: proceed and record the assumption.** Write the assumption as
a `DECISIONS.md` entry the moment it is made (cite `build/build.md` "Decisions — Append to
DECISIONS.md" — same append-as-made precedent, applied here to a design assumption instead of a
data-model choice), naming what was assumed and why no question was needed, with
`- Designer review: pending` so the designer sees it at the next blocking playtest.

**If all three hold, it is a rules question**, and only the designer can answer it: the chunk
parks (below). A choice that is about how the game is built rather than what its rules are always
has a reasonable default, so it is always recorded as a decision, never parked.

**A `Q<N>.` open question in `## Interpretation` is always a rules question**, unless an existing
`RULINGS.md` or `QUESTIONS.md` answer already settles it. It is something the sources were checked
for and do not say (`build/investigate.md` "Quoted Claims, Checked as Code"), so the triple-gate's
reasonable-default escape does not apply: the answer is recorded as a ruling, never an invented
rule.

**Never re-ask an already-granted approval.** If the designer already settled a choice — at this
chunk's own earlier redteam escalation, at a prior chunk's rules question, at a decision review,
or as a standing `RULINGS.md` entry — that answer stands; re-presenting it as a fresh question
wastes the designer's attention and implies their prior answer didn't count. An earlier answer
covers only the question it answered, as recorded in `QUESTIONS.md`, `RULINGS.md` or
`DECISIONS.md` with the designer's own answer. A "standing precedent" that no record states is
not an answer, and an answer given for one chunk does not settle a different question in a later
chunk: that is a new question, and it is asked.

**Read the answer cache before asking, and write to it as you ask.** A question that lived only in
a conversation was lost to the next `/clear`, and the designer got asked it again — so `QUESTIONS.md`
(`templates/QUESTIONS.template.md`, protocol in `orchestrate/questions.md`) is the durable half of
the rule above, and both directions are mandatory:

- **Before** a rules question reaches the designer, read `QUESTIONS.md` alongside `RULINGS.md`. An
  answered entry that already decides it means it is answered: use that answer, do not re-present it
  "to confirm." Under an orchestrated run the settled answers arrive quoted in the dispatch brief's
  digest, so no read is needed — but a question the digest already answers is just as forbidden.
- **As** each rules question is posed, append its `### Question N` entry with `Answer: pending`,
  in the designer's own words. Not after the answer arrives: a session that dies between asking and
  answering must leave the question on record as outstanding.
- **When** the answer lands, fill that entry's `Answer`/`Answered at`/`Recorded in` fields once, and
  name in `Recorded in` the `RULINGS.md` ruling below. `QUESTIONS.md` is the transcript;
  `RULINGS.md` stays the authority (`state-machine.md` "Rulings Outrank Rulebook").

**Never route a human playtest for a chunk with no visible UI.** A `ui: none` chunk has nothing
for a human to click through — this ask step never proposes or implies a client-playtest stop for
it (see `state-machine.md` "Session Handoff Seams" — the milestone/UI-gated `playtest` stop,
SKILLAUTO-01 — this ask step never overrides or second-guesses that gating).

Open questions that clear the triple-gate but do not block THIS chunk — because they concern a
later chunk, or a cross-cutting choice this chunk does not need settled to proceed — go to the
batched queue instead of parking this chunk; see `state-machine.md`'s batched-queue model.

## Parking the Chunk on a Rules Question

A rules question this chunk cannot proceed without parks the chunk at this step: nothing durable
past the pending `QUESTIONS.md` entry is written, and `ask` stays unchecked.

- **In orchestrated mode** this step does not converse: it writes the pending question entries and
  returns `outcome: gate` with `gate.kind: rules-adjudication` and the question as `gate.payload`,
  each put as a concrete choice in the designer's language (part (b) below)
  (`build-chunk.md` "Orchestrated Mode"). The orchestrator records the chunk in `RUN.md`'s
  `Open Gate:` and moves on to the chunks that do not depend on it (`build-game.md` Step 3).
- **In a session the designer is in**, ask them, and wait for the answer.

When the answer arrives (in a later dispatch's digest, or from the designer in the session),
record it as a ruling and run the write sequence below.

## The Interpretation Record (the 4-Part Format)

The chunk's design is recorded in `DECISIONS.md` for the designer to review later, in exactly
these four parts, in this order. This shape is fixed — never reorder it, never merge parts, never
add a fifth part:

**(a) Rules interpretation in plain designer language, with citations.** Every **live** claim
from CHUNK.md's `## Interpretation` restated in the register a designer would use, each carrying
its citation into the rulebook or RULINGS.md. A superseded claim is not live: a claim named as
superseded by a later claim (marked in place, or recorded as refuted in the latest `## Redteam
Rounds` entry with a superseding claim appended and no standing resolution) is **omitted** from
this record — its superseding claim is presented in its place and carries the citation.
Presenting a refuted original and its correction side by side as flat design facts would have
the designer review a contradictory interpretation:

> "When you land on an owned property, you pay rent equal to the amount shown on its card
> (p.6, 'Rent'). If it's mortgaged, no rent is owed (p.9, 'Mortgages')."

**(b) Ambiguities as concrete choices with explicit options.** Anything the rulebook and
RULINGS.md leave undecided is named as a choice, never a vague open question, with the option this
chunk took when it was a default, or put to the designer when it is a rules question:

> "The rulebook doesn't say what happens if you can't afford rent and have no mortgageable
> property. Option A: you go bankrupt immediately. Option B: you may sell buildings first.
> Which do you want?"

**(c) what you will NOT see yet.** An explicit deferred list, so the designer isn't surprised by
what this chunk excludes:

> "This chunk does not yet include: trading with other players, building houses/hotels, or the
> auction rule for declined purchases."

**(d) Zero implementation vocabulary.** The entire record — parts (a)-(c) — contains NO engine or
implementation terms. This is a total ban, not a style preference.

## Prohibited Vocabulary

The record must never use BoardSmith API or engine vocabulary to describe the design. Forbidden
words (non-exhaustive; the spirit is "designer language only", these are the recurring offenders
per 143-RESEARCH.md Pitfall 2):

- `action` — describe what the player does ("you pay rent"), never "the rent action fires."
- `flow` — describe what happens next ("then the next player takes their turn"), never
  "control returns to the flow."
- `state` — describe the game situation ("the property is now mortgaged"), never "state
  updates" or "game state."
- `element` — describe the physical/visual thing ("the property card", "the token"), never
  "element" or "GameElement."

If a claim from CHUNK.md's `## Interpretation` was written using engine vocabulary internally,
translate it into designer language for this record — the citation carries forward, the
wording does not.

This ban is one instance of the general rule in `reporting.md`, which applies to every message the
designer reads, not just this record — and which extends the forbidden list beyond engine
vocabulary to internal ids, file paths, step names, ledger counts, and status/verdict spellings.

## Assets — Never-Blocking Placeholder Request

Record any assets this chunk's build needs, keyed to `ASSETS.md`'s existing component
inventory (seeded at ingest — see `ingest-rules.md` Step 3). A missing asset never blocks a
chunk: if the designer doesn't have final art yet, that's fine — "I don't have art yet" never
blocks the chunk from proceeding. A placeholder that matches the final layout is used instead
(correct aspect ratio, styled with the theme file's own tokens per `DESIGN.md`'s Placeholder
Policy), and the debt is recorded, not hidden.

Recording the debt: append a row to `ASSETS.md`'s 5-column ledger (`needed-by-chunk | requested
| received | placeholder-in-use | file path` — `templates/ASSETS.template.md`). Fill this row;
never restructure the ledger's header. If the asset was already requested at ingest, update its
existing row rather than duplicating it.

## House-Rule / Adaptation Choices — RULINGS.md

Any house-rule or digital-adaptation choice the designer makes while answering a rules question —
including any answer to a redteam refuted-twice escalation still open when this step starts — is
recorded as a new `### Ruling N` entry in `RULINGS.md`, filling `templates/RULINGS.template.md`'s
Decision / Citation interpreted or overridden / Rationale shape exactly. Never restructure the
ledger's header, and never overwrite or renumber a prior entry — RULINGS.md is append-only.

## The Write Sequence

Once no rules question is open for this chunk (none arose, or the designer has answered each one;
a ruling is written only from the designer's explicit answer):

1. Write any RULINGS.md `### Ruling N` entries from the designer's answers.
2. Write any ASSETS.md ledger row updates from the asset request above.
3. Write the interpretation record above as one `DECISIONS.md` entry ("Interpretation of
   <chunk>"), and each default taken as its own entry if it is not one already, each with
   `- Designer review: pending`.
4. Check off `ask` on CHUNK.md's Step Checklist (investigate and redteam were already checked
   off when those steps completed — see `build-chunk.md` "Step Group 1 Dispatch").
5. Write `Status: approved` to CHUNK.md **last**, after every other write for this step has
   landed (cite `state-machine.md` "Write Order" — the `Status:` line is updated last so a
   session that crashes mid-write leaves a file whose status still reflects the last
   fully-completed state, never a half-written one). `approved` means the interpretation is
   settled: every rules question explicitly approved by the designer's own answer, and every
   default recorded for their review.
6. Then update this chunk's derived-status pointer in SKETCH.md to match: `Status (derived from
   chunks/<slug>/CHUNK.md): approved`. This is the second half of every status write —
   `state-machine.md` "Write Order": CHUNK.md first, then SKETCH.md second, never SKETCH.md
   alone and never a status write without the derived pointer following. Step 5's **last**
   governs CHUNK.md's own writes; this mirror write always follows it. Skipping it leaves
   SKETCH.md reading `proposed` against CHUNK.md's `approved` — a known contradiction the next
   session's consistency check would have to log and repair.

Then continue straight into `{spec, build, test}`: no designer stop.

**Carve-out:** `build/investigate.md`'s claims list — CHUNK.md's `## Interpretation`, `##
Visibility Declaration`, and `## Newly Discovered Citations` — was already written progressively
during the `investigate` step, before this step. It is NOT re-copied here; those sections are
settled facts about what the rulebook says, not the design record this step writes (the same
carve-out `ingest-rules.md` Step 7 applies to `ASSETS.md` and `rulebook/00-visual-survey.md`,
which record factual evidence written at Step 3, not gated sketch state re-written at Step 7).

## Downstream Shape (cite, never restate)

Once `Status: approved` lands, the settled interpretation from `build/redteam.md` is the upstream
authority for `build/spec.md` — the session picks up the step group `{spec, build, test}`, whose
FIRST step writes this chunk's tests from that interpretation and observes them failing before any
code exists. `build/build.md` runs after it, not first. This file does not restate that step
group's structure.
