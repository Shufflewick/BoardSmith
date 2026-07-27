---
name: bs-ingest-rules
description: Ingest a board game rulebook (or run a structured interview if none exists) and produce the initial sketch/chunk plan for a new BoardSmith game. Use when starting a new game project from a rulebook or from scratch.
---

# `/bs-ingest-rules` — Start the Project

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

Run once per game. Re-running on an existing project is destructive to sketch state and requires
explicit confirmation (see Step 0 below).

## Context-Economics Hard Rule

**The orchestrator never reads full rulebook slices.** `rulebook/INDEX.md` is built exclusively
from the `citedTerms[]` lists subagents return in their structured summaries — never by
re-reading a slice file the orchestrator just had a subagent write. This applies to every step
below; `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` restates it because that is the step where the temptation to
"double-check by reading the slice" is strongest.

## Step 0: State Detection (INGEST-07)

On entry, before any other work, run the consistency check described in `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
("Consistency Check"). Then determine which of four cases applies (use `ls <file>` direct
checks in the current directory, never `**/glob` patterns that search subfolders):

1. **Empty / fresh directory** — no `SKETCH.md`, no `PROJECT.md`, no `rulebook/`, no
   `ASSETS.md`. The current directory is the **parent** the game project will be created
   under. Proceed straight to Step 1, which scaffolds `<name>/`; every subsequent step then
   runs from inside `<name>/`.
2. **Interrupted ingest** (`rulebook/` or `ASSETS.md` present, but no `SKETCH.md`) — a
   previous ingest session crashed after transcription/interview started but before Step 7
   wrote the sketch. This is NOT a fresh directory: running Step 1's `init` here would
   scaffold a nested `<name>/<name>/` project, and re-transcribing would orphan the
   already-confirmed slices. STOP and ask the user whether to **resume from the existing
   slices** (skip Steps 1-2, re-run Step 3 onward from the slices' accumulated INDEX/ASSETS
   content — re-dispatching narrow subagents only for anything missing) or **discard and
   restart** (delete `rulebook/`, `ASSETS.md`, and any `chunks/`, then treat the project
   directory per Step 1's verification-only path — `init` already ran). Never proceed
   silently on either path.
3. **Existing bs- project** (`SKETCH.md` present — i.e. the session was invoked *inside* a
   project this skill already created) — this is a **re-run guard**: re-ingesting is
   destructive to sketch state (it would overwrite the ordered chunk list and rulebook slices).
   STOP and ask the user to explicitly confirm before proceeding. Do not treat re-run as a resume
   — resuming mid-sketch is `/bs-build-chunk`'s job, not this skill's.
4. **Old `/design-game` project** (`PROJECT.md` + `STATE.md` + `HISTORY.md` present, no
   `SKETCH.md`, no `rulebook/` — the trio distinguishes it from case 2) — offer a
   **one-time migration**: interview data and the old skill's Deferred
   Ideas become sketch chunks; already-completed features are marked verified with a note that
   they were verified under the old process. On acceptance, **skip Step 1 (Scaffold) entirely**
   — the old project is already scaffolded, and `npx boardsmith init` hard-fails on an existing
   directory (`src/cli/commands/init.ts`); at most re-run only the compile/serve verification
   portion of `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/scaffold.md` (no `init`) to prove the old codebase still compiles. Skip
   Step 2's questioning, but NOT its output shape: convert the old project's captured content
   into the standard `rulebook/` shape first — write the old interview/PROJECT.md content as
   `rulebook/NN-topic.md` slices (grouped by topic, per `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/interview-fallback.md`
   "Output Re-Target"), with citation format
   `designer statement, migrated from /design-game project`. Collect `citedTerms[]` /
   `componentMentions[]` from those slices as you write them, exactly as the interview path
   does. Then proceed to Step 3 (Synthesis), which runs unchanged — preserving the
   input-path identity `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/interview-fallback.md` declares (every downstream step,
   including `/bs-build-chunk`'s citation reads, consumes the same `rulebook/NN-topic.md` +
   `rulebook/INDEX.md` shape regardless of input path). Migration is never a fourth shape.

## Step 1: Scaffold + Verify

Delegate the entire scaffold-and-verify sequence to `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/scaffold.md`: deriving
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

- **Rulebook available** — dispatch fan-out subagents per `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md`.
- **No rulebook** (unpublished prototype, rules in the designer's head) — run the structured
  interview per `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/interview-fallback.md`, which produces the identical `rulebook/` shape so
  every downstream step is unaffected by which path was taken.

Both paths produce `rulebook/NN-topic.md` slice files — written by the transcription subagents
themselves in the rulebook path (their full text never enters this orchestrator's context), and
by this session from the designer's short answers in the interview path — and return
`citedTerms[]` / `componentMentions[]` for Step 3's synthesis; no slice is ever read back in
full by this orchestrator.

## Step 3: Synthesis

Once transcription or interview output has landed, this orchestrator-only step assembles the
following artifacts **from subagent-returned summaries only** — never from re-reading slices.

Items 1 and 2 are ordered and coupled: item 1 produces the archived path and hash that item 2's
header block requires. Both live inside this step deliberately. An earlier revision made the
archive its own `Step 2.5` between Step 2 and Step 3, and a live run skipped it outright —
leaving item 2 with an unfillable `Source hash:` line, at which point the session abandoned the
template and composed `rulebook/INDEX.md` freehand, failing every structural check. Every input
`INDEX.md` needs is now produced by this same step. Do not promote item 1 back out to a step of
its own.

1. **Archive the source rulebook and compute its hash (INGEST-01).** Run this as the first
   concrete action of this step. It has exactly one deliverable: after it,
   `rulebook/source/<original-filename>` exists on disk and its SHA-256 is known.

   Concretely, in order: (1) run a copy command placing the source file bound at Step 2
   (`{rulebookPath}`) at `rulebook/source/<original-filename>`, preserving the original filename
   verbatim; (2) run `shasum -a 256 rulebook/source/<original-filename>` (or the `sha256sum`
   fallback on Linux/CI) and read its actual output, taking the first whitespace-delimited field;
   (3) hold that 64-hex value for item 2's `Source hash:` line. All three are real tool
   invocations this session runs itself — never report a hash you did not compute by running the
   command, and never summarize these as already done.

   This is a **copy**, never a move, rename, delete, or overwrite: ingest never touches the
   designer's original. A source already sitting at the project root stays exactly where it is,
   untouched, in addition to the new copy under `rulebook/source/`. If a file already exists at
   the archive destination, STOP and ask the designer rather than clobbering it.

   If this item cannot complete, item 2 is **blocked** — say so and stop. A missing archive must
   never surface as a silently missing `Source hash:` line.

   **Interview-path exception:** on the interview path there is no source file — this item does
   not run, no `rulebook/source/` directory is created, and that absence is expected only on that
   path. See `ingest/interview-fallback.md`'s "Output Re-Target" for that path's header values.

2. **`rulebook/INDEX.md` — copy and fill the template.** Do this immediately after item 1,
   before drafting any other Step 3 artifact. Read
   `${CLAUDE_SKILL_DIR}/../bs-shared/templates/INDEX.template.md` in full, then write
   `rulebook/INDEX.md` starting from that exact structure — same H1, same comments-become-fills,
   same three headings, same order — with its placeholders filled. This is a **copy-then-fill**
   operation on a real file this session reads and writes itself, the same mechanical action Step
   7 performs for `SKETCH.template.md` and `CHUNK.template.md` — it is not a paraphrase of what
   the template roughly says. If what gets written does not contain, verbatim, `## Open Rules
   Gaps`, `## Slices`, and `## Term → Slice`, the template was not actually read. Cite the
   template rather than restating its content: it carries the four header labels, the
   `## Open Rules Gaps` heading and its `_None._`/no-deduplication rules, the `## Slices` table,
   and the `## Term → Slice` table, each with its own fill instructions. The fill needs:
   - the `edition` field the opening-pages transcription subagent returned (or the interview
     path's `unpublished — designer statement` value — never the reverse);
   - the archived path and hash item 1 of this step produced;
   - today's ISO date;
   - the accumulated `openGaps[]` lists, for `## Open Rules Gaps`;
   - the accumulated `citedTerms[]` lists, for `## Term → Slice`.

   Two prohibitions, stated explicitly because they are the exact defects a prior proof run
   produced: do not rewrite, reword, abbreviate, or reorder any heading the template ships, and
   do not compose an `INDEX.md` from scratch as an alternative to copying the template.
2. **Component inventory + aspect ratio(s)** — every component mentioned, with citations and
   approximate aspect ratios (cards, tiles, board proportions), seeded into `ASSETS.md`.
3. **`ASSETS.md`** — the component/asset ledger (needed-by-chunk, requested, received,
   placeholder-in-use, file path — see `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md`), seeded from the
   component inventory above. Assets are recorded as debt here, never requested up front.
4. **Visual identity survey** — evidence only, no decision made cold: dominant palette
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
5. **Player counts** — min/max player counts and any per-count setup differences, recorded at
   sketch level.

Variant/optional/advanced rules were already tagged out-of-scope-by-default **in the slices at
write time** by the transcription subagents (per
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` "Variant / Optional / Advanced Rules"
— this orchestrator never edits a slice); this step's only variant job is to build the
`SKETCH.md` "Variants (deferred)" listing from the accumulated `variants[]` lists the subagents
return.

## Step 4: Sketch Derivation

Delegate the sketch-authoring heuristic to `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/sketch-derivation.md`: how chunks are carved
from the rulebook slices, the chunk-granularity rule (one observable behavior per chunk; split a
family of similar mechanics into one chunk each; the first chunk is the *smallest* core-loop turn,
not the *coherent* whole), the lazy-tail 2-3-chunk detail cap, and the Mandated Chunks contract
(cite `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md`'s "## Mandated Chunks" section — do not restate it here).
The result of this step is an in-conversation **proposal** only — do **not** write `SKETCH.md`
yet. The sketch is proposed, not imposed: the file is written exactly once, at Step 7, after
the Step 6 approval gate. A rejection at Step 6 must leave no sketch state on disk to undo.

## Step 5: UI Strategy (INGEST-06)

Made **with the user**, at ingest. The decision lands in the proposed sketch's `## UI Strategy`
section — the skeleton for which comes from `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md`, where that section
already exists (fill it, do not invent a new field, and never edit the shipped template itself)
— and is written to the game project's `SKETCH.md` at Step 7 with the rest of the approved
sketch. Two values:

- **`custom-from-chunk-1`** (default) — the playtest artifact is always the real product surface.
- **`autoui-with-cutover`** — an AutoUI scaffold with a scheduled custom-UI cutover chunk named
  now. Any later cutover explicitly flips **all** previously verified chunks back to `built` and
  re-opens their test scripts (see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Restyle/Cutover Rule") — there is no
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

- Copy `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` into the game project as `SKETCH.md` and fill it with the
  approved content from Steps 4-6 (ordered chunk list, UI Strategy, Variants (deferred), player
  counts). Copy-and-fill is one operation — never copy a blank skeleton over a file that
  already carries content.
- Create `chunks/<slug>/CHUNK.md` from `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CHUNK.template.md` for the detailed next 2-3
  chunks only (tail entries get no directory and no stub — see `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/sketch-derivation.md`).
- Seed `RULINGS.md` and `DECISIONS.md` as empty ledgers from their templates. This is a
  deliberate choice, not "copy everything": their first real content arrives at later gates
  (any ask/playtest gate, and build/close respectively), and seeding them now means those later
  steps append to an existing ledger instead of deciding whether to create one.
- Do **NOT** create `DESIGN.md`. Per `${CLAUDE_SKILL_DIR}/../bs-shared/templates/DESIGN.template.md`'s own header, it is written
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

- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` — fan-out subagent dispatch, per-section confirmation protocol
- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/interview-fallback.md` — the no-rulebook structured interview
- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/sketch-derivation.md` — chunk-carving heuristic and lazy-tail detail cap
- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/scaffold.md` — naming rules, `boardsmith init`, compile + serve verification, kill

And to the shared reference files that ship with every `bs-` skill:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session lock, write order, authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/SKETCH.template.md` — the sketch skeleton this skill fills
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md` — the asset ledger skeleton this skill seeds
- `${CLAUDE_SKILL_DIR}/../bs-shared/templates/INDEX.template.md` — the rulebook index skeleton Step 3 copies and fills

**Installed location:** this file installs as `.claude/skills/bs-ingest-rules/SKILL.md`. The
shared `ingest/`, `templates/`, and `state-machine.md` referenced above install under the
`bs-shared/` namespace root alongside `bs-ingest-rules/` — one directory up from this file then
into `bs-shared/`, at `.claude/skills/bs-shared/ingest/`,
`.claude/skills/bs-shared/templates/`, and `.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is
Claude Code's built-in substitution for "the directory containing THIS skill file," resolved to
an absolute path before the model ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/...`
resolves correctly no matter whether this skill is installed at the project (`.claude/skills/`)
or personal (`~/.claude/skills/`) level. When Step 7 says to "copy" a template, resolve
`${CLAUDE_SKILL_DIR}/../bs-shared/templates/<file>`, never a path relative to the game project or the
current working directory. The installer phase (`src/cli/commands/install-claude-command.ts`)
MUST preserve this layout — `ingest/`, `templates/`, and `state-machine.md` under the
`bs-shared/` root beside every `bs-*` skill directory under `.claude/skills/` — or update this
paragraph.
