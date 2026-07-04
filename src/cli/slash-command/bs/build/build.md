# Build — Writing the Code (BUILD-05)

Referenced by `build-chunk.md` Step 4 (`build`, first of the `{build, test}` session step
group — see `state-machine.md` "Session Handoff Seams"). This is the step that actually writes
code: everything through `ask` produced an approved, plain-language design; `build` turns that
design into working BoardSmith source for this one chunk, and nothing beyond it.

## Fresh-Context Exception (the one step allowed to read raw slices)

Every other step in this pipeline restates the Context-Economics Hard Rule
(`build-chunk.md` "Context-Economics Hard Rule") — the orchestrator never reads rulebook slices,
docs, or generated code itself, only the structured summaries a subagent returns. `build` is the
sole exception: a fresh-context executor (main context or a dedicated Task-tool subagent) reads
this chunk's cited raw rulebook slices directly, in addition to the approved interpretation
already settled in CHUNK.md. Two dual inputs, never one alone:

1. **The chunk's cited raw rulebook slices** — the actual `rulebook/NN-topic.md` text this
   chunk's citations point at, read fresh, not re-derived from memory of what `investigate`'s
   claims said about them.
2. **The approved interpretation** — CHUNK.md's `## Interpretation` and `## Visibility
   Declaration` sections, settled and gated by `ask` (`Status: approved` on disk).

The approved interpretation is design layered on top of the raw slice, never a replacement for
it: the interpretation tells you what the rulebook *means* for this chunk; the raw slice is what
it *says*. Building from the interpretation alone risks silently reproducing any residual gap
between the two; reading both together is what this fresh-context exception exists to allow.

## Extends, Never Restructures

The build step extends rather than restructures existing code — adds files, adds functions, adds
cases to an existing switch, adds fields to an existing type. It does not restructure verified
code: renaming
an existing export, splitting an existing file, or changing an existing function's signature in a
way that ripples beyond this chunk's own new code is a restructuring change, not an extension.
Restructuring verified code requires a user gate — stop, name the concrete restructuring needed
and why the chunk cannot proceed without it, and get explicit approval before making the change.
Do not make architectural calls unilaterally mid-build; a build session that discovers it needs to
restructure something is exactly the situation this gate exists for.

## Decisions — Append to DECISIONS.md

Any data-model or naming decision made while writing this chunk's code — a new field's name, a
new type's shape, which existing module a new function lives in — is appended to `DECISIONS.md`
as it is made, not batched up for later. This keeps the decision log accurate even if the session
crashes mid-build: whatever decisions were already made are already recorded.

## Per-File Build Manifest (crash/resume)

Fill CHUNK.md's existing `## Build Manifest` table row-by-row as each file is written — never
invent a new section, never restructure the `| File | Status |` header. Add a row (`written` or
`pending`) for each file this chunk's build touches, and flip a row from `pending` to `written`
the moment that file is actually saved to disk, not in a batch at the end. A session that crashes
mid-build resumes by reading this table: any row still `pending` is unfinished work, any row
`written` is done and must not be redone or clobbered. This is the file-by-file resume signal
`state-machine.md`'s crash-resume discipline relies on for the `build` step specifically — it is
finer-grained than the step-level Step Checklist, because a single `build` step can span many
files.

## Test Script — Rewritten in Interaction Terms

Rewrite this chunk's test script (CHUNK.md's `## Playtest Test Script`) in actual interaction
terms once the real UI/controls exist — click targets, seat names, the literal sequence a human
plays through — replacing any earlier placeholder language written before the code existed. The
script must describe what is now really on screen, not what was planned.

## Git Protocol (cite, never restate)

Cite `state-machine.md` "Git Protocol" — commit at every step completion
(`chunk-<slug>/step-<name>`). Commit **before** `build` starts: the last commit before this step
begins is the verified baseline (everything through `ask`, no code yet); the commit this step
produces at its end is the WIP snapshot for this chunk's code. Never conflate the two — a session
resuming mid-build needs to be able to tell "nothing built yet" from "some files written" from
git history alone, which is exactly what the per-file Build Manifest above exists to make
explicit inside CHUNK.md as well.

## Placeholders — UIQ-02 (cite DESIGN.md, never restate)

When a `ui: touches|major` chunk needs a component for which no final asset exists yet, follow
this chunk's `DESIGN.md` `## Placeholder Policy` verbatim — do not restate its rules here, cite
the section by name and apply it as written. In practice this means: the placeholder is built at
the asset's correct declared aspect ratio, styled with `DESIGN.md`'s own `--bsg-*` tokens, and
labeled so it never reads as "broken," only "not-yet-final."

The load-bearing guarantee this policy protects: asset arrival later replaces the placeholder's
fill only — the image, the texture, the icon — and never changes geometry or layout. A real asset
swap is a zero-layout-diff swap; if incorporating a real asset would require resizing or
repositioning anything, the placeholder's aspect ratio was declared wrong at design time and that
is a `DESIGN.md` correction (its own chunk), not something `build` improvises around.

## Downstream Shape (cite, never restate)

Once this chunk's files are all written (every Build Manifest row `written`) and the test script
reflects the real interaction, the next step in this same session group is `build/test.md` —
authored alongside this file, in Phase 144. This file does not restate that step's structure.
