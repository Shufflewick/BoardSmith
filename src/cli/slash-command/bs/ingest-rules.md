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

## How to Talk to the Designer

Everything the designer reads — step narration, questions, confirmations, the sketch presentation
— follows `${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`. In short: lead with what they need to
do, or say plainly that there's nothing; describe the game in their own terms, not this pipeline's;
keep internal ids, step names, file paths, and ledger counts out of the body; never narrate
bookkeeping. An ordinary step completion is one to three sentences.

## Invocation

```
/bs-ingest-rules [path-to-rulebook]
```

The path is optional. When given, treat it as `{rulebookPath}` for the whole session and **skip
the "do you have a written rulebook?" question in Step 2** — the designer has already answered it.

Resolve it to an **absolute** path immediately, before Step 1 runs, expanding a leading `~`.
Step 1 does `cd <name>` into the newly created project, so a relative path captured before that
`cd` is wrong afterward.

**If a path was supplied but does not exist or cannot be read, STOP and say so, naming the path.**
Do not fall through to the structured interview. A designer who supplied a path has a rulebook;
silently interviewing them for a game whose PDF is sitting on disk is a worse outcome than an
error, because nothing looks wrong until much later.

## Context-Economics Hard Rule

**The orchestrator never reads full rulebook slices.** `rulebook/INDEX.md` is built exclusively
from the `citedTerms[]` lists subagents return in their structured summaries — never by
re-reading a slice file the orchestrator just had a subagent write. This applies to every step
below; `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` restates it because that is the step where the temptation to
"double-check by reading the slice" is strongest.

## Context Floor + Ceiling (SKILLAUTO-06)

This session obeys the same two numbers every other `bs-` skill does — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` "Session Handoff Seams" → "Context floor +
ceiling" for the full rule; do not restate it beyond this summary. **≥50% floor, ~60% ceiling.**
Below 50% used, this session never winds down, never wraps up, and never suggests a `/clear` —
"the sketch is done, this feels like a clean resume point" is exactly the premature bail the floor
forbids. Stopping at 24% or 40% because the work ahead "feels big" is a bug, not prudence. The one
authoritative override is a real harness context-low warning: if the harness itself signals below
the floor, obey it immediately, persist, and stop.

Read the harness's actual context-usage percentage against these numbers. Never stop on a vague
"this is getting long" hunch that ignores the real figure.

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

**If a rulebook path was supplied at invocation, skip this question** — `{rulebookPath}` is
already bound and Step 1 has already archived it. Go straight to the transcription path.

Otherwise ask whether the designer has a written rulebook (PDF/images/text).

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

> **STOP. Re-read this step from the file before doing anything in it.**
>
> Open `${CLAUDE_SKILL_DIR}/SKILL.md` and re-read Step 3 in full, right now, as an actual file
> read. Do not proceed from memory.
>
> This is not boilerplate caution. Step 2's per-section confirmation loop takes many turns, and
> by the time you arrive here you last read this text a long way back in the session. Measured
> behavior: a session reaching Step 3 in one turn performs this step correctly; the same text in
> a 5-turn session performs it partially; in 8- and 13-turn sessions, and in a real designer's
> session, it fails almost completely — the archive is skipped, `rulebook/INDEX.md` gets composed
> freehand with invented headings, and the delegation below is silently replaced by writing the
> file directly.
>
> That failure does not feel like forgetting. It feels like already knowing what this step says.
> The re-read is what makes the difference, so do it before the first action, not after.

Once transcription or interview output has landed, this orchestrator-only step assembles the
following artifacts **from subagent-returned summaries only** — never from re-reading slices.

`rulebook/INDEX.md` already exists: Step 1 created it, with the four provenance header lines
(`Edition:`, `Source:`, `Source hash:`, `Transcribed:`) and empty `## Open Rules Gaps`,
`## Slices`, and `## Term → Slice` sections. Your job here is to fill those sections, not to
create the file.

1. **Synthesis runs itself — you do not need to invoke it.** `init` installed a `pre-commit`
   hook that runs `npx boardsmith ingest-gaps` on the first commit after slices exist. Run it
   manually only if you are not going to commit before the approval gate:

   ```
   npx boardsmith ingest-gaps
   ```

   It does two things. First it relabels any `Derived (p.N):` line whose text is pure
   presentation description (typography, palette, layout, wordmark) onto the `Visual (p.N):`
   prefix — only the prefix changes, no text is rewritten and nothing is deleted. Lines needing
   real judgment are reported rather than guessed at; read that report and fix any it names by
   hand. Then it fills `## Open Rules Gaps`:

   It sweeps the slice files for every `Named-but-undefined (p.N): <rule>` line and writes them
   into the section verbatim, without deduplicating — a rule named in two slices and defined in
   neither is two entries, and the recurrence is signal. If there are none it leaves the
   `_None._` token. Nothing about this section requires judgment, and a live session left it
   empty while the slices carried four markers, so it is code now.

2. **Fill the two tables by hand** — these do need judgment:

   - `## Slices` — one row per slice: path, pages, one-line coverage.
   - `## Term → Slice` — one row per accumulated `citedTerms[]` pair, sorted.

   **Keep every heading exactly as Step 1 wrote it.** Do not rename, reword, reorder, or
   "improve" them, and do not rewrite the header lines — downstream tooling parses those exact
   strings, and inventing a nicer heading is the single most repeated failure in this step's
   history.

3. **If `Edition:` reads `not stated in the rulebook` and the transcription subagent returned an
   actual edition**, update just that line with the returned value. Leave `Source:`,
   `Source hash:`, and `Transcribed:` untouched — those are the provenance record a later verify
   pass reads, and they describe the archive Step 1 made.

4. **Component inventory + aspect ratio(s)** — every component mentioned, with citations and
   approximate aspect ratios (cards, tiles, board proportions), accumulated from the transcription
   subagents' `componentMentions[]` returns and seeded into `ASSETS.md` below.
5. **`ASSETS.md`** — the component/asset ledger (needed-by-chunk, requested, received,
   placeholder-in-use, file path — see `${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md`), seeded from the
   component inventory above. Assets are recorded as debt here, never requested up front.
6. **Visual identity survey** — evidence only, no decision made cold: dominant palette
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
7. **Player counts** — min/max player counts and any per-count setup differences, recorded at
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

## Step 8: Continue Into the First Chunk

**The ingest→build seam is a continuation seam, not a session terminus** — the same rule
`state-machine.md` gives the chunk→chunk seam ("Cross-chunk continuation") applies here. Once the
files are written, confirm in a sentence that everything is saved, then **auto-advance straight
into `/bs-build-chunk` for the first chunk in the same session**, stopping at that chunk's first
human gate (its `ask` approval). Do not end the turn telling the designer to `/clear` and re-invoke.

Stop at this seam ONLY if one of the state-machine's three stop conditions actually holds: the
designer said stop, an automated step is stuck, or context is at/above the ~60% ceiling (or the
harness surfaced a real context-low warning) — **and never below the ≥50% floor** on a
self-assessed hunch, per "Context Floor + Ceiling" above. If a stop condition does hold, print the
exact next command (`/bs-build-chunk`) as the cold-resume path and say what it will pick up.

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
