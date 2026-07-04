# `/bs-ingest-rules` — Start the Project

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `state-machine.md` for all of that.

Run once per game. Re-running on an existing project is destructive to sketch state and requires
explicit confirmation (see Step 0 below).

## Context-Economics Hard Rule

**The orchestrator never reads full rulebook slices.** `rulebook/INDEX.md` is built exclusively
from the `citedTerms[]` lists subagents return in their structured summaries — never by
re-reading a slice file the orchestrator just had a subagent write. This applies to every step
below; `ingest/transcription.md` restates it because that is the step where the temptation to
"double-check by reading the slice" is strongest.

## Step 0: State Detection (INGEST-07)

On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check"). Then determine which of three cases applies (use `ls <file>` direct
checks in the current directory, never `**/glob` patterns that search subfolders):

1. **Empty / fresh directory** — no `SKETCH.md`, no `PROJECT.md`. The current directory is the
   **parent** the game project will be created under. Proceed straight to Step 1, which
   scaffolds `<name>/`; every subsequent step then runs from inside `<name>/`.
2. **Existing bs- project** (`SKETCH.md` present — i.e. the session was invoked *inside* a
   project this skill already created) — this is a **re-run guard**: re-ingesting is
   destructive to sketch state (it would overwrite the ordered chunk list and rulebook slices).
   STOP and ask the user to explicitly confirm before proceeding. Do not treat re-run as a resume
   — resuming mid-sketch is `/bs-build-chunk`'s job, not this skill's.
3. **Old `/design-game` project** (`PROJECT.md` + `STATE.md` + `HISTORY.md` present, no
   `SKETCH.md`) — offer a **one-time migration**: interview data and the old skill's Deferred
   Ideas become sketch chunks; already-completed features are marked verified with a note that
   they were verified under the old process. On acceptance, **skip Step 1 (Scaffold) entirely**
   — the old project is already scaffolded, and `npx boardsmith init` hard-fails on an existing
   directory (`src/cli/commands/init.ts`); at most re-run only the compile/serve verification
   portion of `ingest/scaffold.md` (no `init`) to prove the old codebase still compiles. Skip
   Step 2's questioning, but NOT its output shape: convert the old project's captured content
   into the standard `rulebook/` shape first — write the old interview/PROJECT.md content as
   `rulebook/NN-topic.md` slices (grouped by topic, per `ingest/interview-fallback.md`
   "Output Re-Target"), with citation format
   `designer statement, migrated from /design-game project`. Collect `citedTerms[]` /
   `componentMentions[]` from those slices as you write them, exactly as the interview path
   does. Then proceed to Step 3 (Synthesis), which runs unchanged — preserving the
   input-path identity `ingest/interview-fallback.md` declares (every downstream step,
   including `/bs-build-chunk`'s citation reads, consumes the same `rulebook/NN-topic.md` +
   `rulebook/INDEX.md` shape regardless of input path). Migration is never a fourth shape.

## Step 1: Scaffold + Verify

Delegate the entire scaffold-and-verify sequence to `ingest/scaffold.md`: deriving
display/project/class names, running `boardsmith init`, verifying the empty skeleton compiles
(`tsc --noEmit`) and serves, and killing any server this skill starts before returning. Chunk 1
must start from a known-good, verified-compiling baseline.

This step deliberately runs **before** transcription/interview: every artifact the later steps
write (`rulebook/NN-topic.md`, `rulebook/INDEX.md`, `ASSETS.md`, `SKETCH.md`, ...) lives inside
the game project, which does not exist until `init` creates `<name>/`. Once the scaffold is
verified, `cd <name>` and treat the project directory as the working directory for every
remaining step — nothing this skill produces is ever written to the parent directory.

## Step 2: Route to Transcription or Interview Fallback

Ask whether the designer has a written rulebook (PDF/images/text).

- **Rulebook available** — dispatch fan-out subagents per `ingest/transcription.md`.
- **No rulebook** (unpublished prototype, rules in the designer's head) — run the structured
  interview per `ingest/interview-fallback.md`, which produces the identical `rulebook/` shape so
  every downstream step is unaffected by which path was taken.

Both paths produce `rulebook/NN-topic.md` slice files — written by the transcription subagents
themselves in the rulebook path (their full text never enters this orchestrator's context), and
by this session from the designer's short answers in the interview path — and return
`citedTerms[]` / `componentMentions[]` for Step 3's synthesis; no slice is ever read back in
full by this orchestrator.

## Step 3: Synthesis

Once transcription or interview output has landed, this orchestrator-only step assembles the
following artifacts **from subagent-returned summaries only** — never from re-reading slices:

1. **`rulebook/INDEX.md`** — a term → slice-file cross-reference table, built exclusively from
   the accumulated `citedTerms[]` lists.
2. **Variant/edition tagging** — the rulebook's edition is recorded as a header line in
   `rulebook/INDEX.md`, sourced from the `edition` field the opening-pages transcription
   subagent returns (or from the user if the rulebook states none; on the interview path it
   reads "unpublished — designer statement" — see `ingest/transcription.md` "Edition").
   Variant/optional/advanced rules were already tagged out-of-scope-by-default **in the slices
   at write time** by the transcription subagents (per `ingest/transcription.md` "Variant /
   Optional / Advanced Rules" — this orchestrator never edits a slice); this step's only
   variant job is to build the `SKETCH.md` "Variants (deferred)" listing from the accumulated
   `variants[]` lists the subagents return.
3. **Component inventory + aspect ratio(s)** — every component mentioned, with citations and
   approximate aspect ratios (cards, tiles, board proportions), seeded into `ASSETS.md`.
4. **`ASSETS.md`** — the component/asset ledger (needed-by-chunk, requested, received,
   placeholder-in-use, file path — see `templates/ASSETS.template.md`), seeded from the
   component inventory above. Assets are recorded as debt here, never requested up front.
5. **Visual identity survey** — evidence only, no decision made cold: dominant palette
   candidates, typography feel, iconography, notes on board/card art, and descriptions of setup
   diagrams and embedded component images. Built exclusively from the accumulated
   `visualEvidence[]` lists the transcription subagents return (parallel to how INDEX.md is
   built from `citedTerms[]`) — the orchestrator never opens the PDF/images itself. On the
   interview path, whatever visual description the designer volunteers stands in for
   `visualEvidence[]`. **Written to `rulebook/00-visual-survey.md`** in this step, alongside
   INDEX.md and ASSETS.md — it is factual evidence, not gated sketch state, so pre-approval
   writing is consistent with Step 7's carve-out. Its consumer is the first UI chunk's `ask`
   step — a later, fresh-context session — so an in-context-only survey would be data loss:
   the evidence the design ask depends on would be gone the moment this session ends. The
   actual design direction is decided there, at the first UI chunk's `ask` step, against
   `DESIGN.md`.
6. **Player counts** — min/max player counts and any per-count setup differences, recorded at
   sketch level.

## Step 4: Sketch Derivation

Delegate the sketch-authoring heuristic to `ingest/sketch-derivation.md`: how chunks are carved
from the rulebook slices, the lazy-tail 2-3-chunk detail cap, and the Mandated Chunks contract
(cite `templates/SKETCH.template.md`'s "## Mandated Chunks" section — do not restate it here).
The result of this step is an in-conversation **proposal** only — do **not** write `SKETCH.md`
yet. The sketch is proposed, not imposed: the file is written exactly once, at Step 7, after
the Step 6 approval gate. A rejection at Step 6 must leave no sketch state on disk to undo.

## Step 5: UI Strategy (INGEST-06)

Made **with the user**, at ingest. The decision lands in the proposed sketch's `## UI Strategy`
section — the skeleton for which comes from `templates/SKETCH.template.md`, where that section
already exists (fill it, do not invent a new field, and never edit the shipped template itself)
— and is written to the game project's `SKETCH.md` at Step 7 with the rest of the approved
sketch. Two values:

- **`custom-from-chunk-1`** (default) — the playtest artifact is always the real product surface.
- **`autoui-with-cutover`** — an AutoUI scaffold with a scheduled custom-UI cutover chunk named
  now. Any later cutover explicitly flips **all** previously verified chunks back to `built` and
  re-opens their test scripts (see `state-machine.md` "Restyle/Cutover Rule") — there is no
  silent "we'll make it custom later."

## Step 6: Approval Gate

Present the proposed sketch: estimated chunk count and rough per-chunk wall time
(expectation-setting), with only the next 2-3 chunks detailed — the tail stays sketch-level per
the lazy-tail rule. The user edits, this skill revises, the user approves. **Negotiation
posture:** the user's ordering wins unless a hard dependency is violated, in which case name the
dependency concretely and propose the minimal prerequisite. Do not proceed to writing final
files until the user has explicitly approved.

## Step 7: Write Files

This is the **single point** where sketch state is written — no earlier step writes `SKETCH.md`
or any `CHUNK.md`. Only after Step 6's explicit approval:

- Copy `templates/SKETCH.template.md` into the game project as `SKETCH.md` and fill it with the
  approved content from Steps 4-6 (ordered chunk list, UI Strategy, Variants (deferred), player
  counts). Copy-and-fill is one operation — never copy a blank skeleton over a file that
  already carries content.
- Create `chunks/<slug>/CHUNK.md` from `templates/CHUNK.template.md` for the detailed next 2-3
  chunks only (tail entries get no directory and no stub — see `ingest/sketch-derivation.md`).
- Seed `RULINGS.md` and `DECISIONS.md` as empty ledgers from their templates. This is a
  deliberate choice, not "copy everything": their first real content arrives at later gates
  (any ask/playtest gate, and build/close respectively), and seeding them now means those later
  steps append to an existing ledger instead of deciding whether to create one.
- Do **NOT** create `DESIGN.md`. Per `templates/DESIGN.template.md`'s own header, it is written
  at the FIRST UI chunk's `ask` step, not at ingest — there is no visual identity to decide
  until a UI chunk needs one, and the file's very existence is the signal `/bs-build-chunk`
  uses to know the identity decision was made. Creating it blank here breaks that trigger.
- `ASSETS.md` and `rulebook/00-visual-survey.md` were already written at Step 3 (they record
  factual component inventory and visual evidence, not gated sketch state) — do not re-copy or
  re-write them here.

Never restate template or state-machine content inline in this file or in the written project
files beyond what each template already documents — fill the placeholders, don't reinvent the
structure.

End the session by printing the exact next command to run (`/bs-build-chunk`) and confirming
everything is saved in the game folder.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `ingest/transcription.md` — fan-out subagent dispatch, per-section confirmation protocol
- `ingest/interview-fallback.md` — the no-rulebook structured interview
- `ingest/sketch-derivation.md` — chunk-carving heuristic and lazy-tail detail cap
- `ingest/scaffold.md` — naming rules, `boardsmith init`, compile + serve verification, kill

And to the shared reference files that ship with every `bs-` skill:

- `state-machine.md` — status enum, consistency check, session lock, write order, authority
- `templates/SKETCH.template.md` — the sketch skeleton this skill fills
- `templates/ASSETS.template.md` — the asset ledger skeleton this skill seeds
