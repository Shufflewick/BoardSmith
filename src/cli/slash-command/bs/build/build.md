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

The same surface-don't-fabricate posture applies to a load-bearing **rules** ambiguity discovered
mid-build (as opposed to an architectural one): if writing this chunk's code exposes a genuine gap
the rulebook and `RULINGS.md` do not settle, it is surfaced (queued per `state-machine.md`'s
batched-question model — see `build/ask.md` "Ask Triple-Gate (SKILLAUTO-02)"), never quietly
decided by the build step itself. `build` writes code from the interpretation `ask` already
gated; it does not re-litigate or unilaterally patch that interpretation when a fresh ambiguity
surfaces — the same "surface, don't unilaterally decide" boundary the restructuring gate above
enforces for code shape applies here to rules meaning.

## Boundaries — the agent controls the game board only

`build` writes the game's own source under this project — the board, its rules, its UI. It does
not control, patch, or configure the platform underneath it. Four rules, in the same pit-of-success
spirit as every other rule in this file — the right move (file the gap) is always the easy move,
the wrong move (patch or suppress) is always out of bounds:

1. **The agent controls the game board only.** Everything this step writes lives in the game's own
   project source. The platform the game runs on is not this chunk's concern and is never edited to
   make a chunk's build easier.
2. **`node_modules/boardsmith` is a live symlink to the client's real BoardSmith checkout — it is
   READ-ONLY and is NEVER patched or edited.** A change made there does not stay local to this
   project; it silently mutates the client's actual library on disk. There is no scenario in which
   editing a file under `node_modules/boardsmith` is the correct move for a `build` chunk.
3. **A shortfall in the library is a library gap, and a library gap is FILED, never patched.** If
   this chunk's design needs something the library does not do, the correct action is to file the
   gap (report it, concretely, as a finding) and build the chunk around the gap — never reach into
   `node_modules/boardsmith` to add or change the missing behavior yourself. Every filing made
   here is a durable ledger entry, not a one-off note: `build/close.md`'s Bookkeeping Sequence
   (SKILLAUTO-08) reconciles this filings/library-gap ledger against what each chunk actually
   changed and re-touches a filing when a later fix resolves or advances it — a filing recorded
   here is expected to stay accurate, not go stale once the code around it changes.
4. **Built-in BoardSmith UI must NEVER be suppressed.** If a built-in surface cannot drive this
   chunk's game the way the design needs, that is a library gap to FILE, not a feature to switch
   off. Turning off, hiding, or fencing a built-in surface to route around a real limitation hides
   the gap instead of fixing it — filing it is the right path, and it must stay the easy one.

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

A chunk's UI MUST NEVER emit a bare asset `<img>` for card/piece art. All such art routes through
the scaffold-shipped `AssetImage.vue` component — emitted by `project-scaffold.ts` into every
project from Chunk 0 — which draws the game-semantic fallback and overlays the real image only
once it has loaded. `AssetImage.vue` is the operationalization of `## Placeholder Policy` above:
it is the one code path that makes the zero-layout-diff guarantee hold structurally, rather than
by convention every chunk's author has to remember. A bare asset `<img>` is not merely
discouraged — it is a `test`-step failure (see `build/test.md`'s asset-reachability gate), so the
prohibition is enforced, not just advised.

### The Action Panel is always on, and it always agrees with the board

The Action Panel is on at all times, and it offers exactly what the board offers. A custom board
control is IN ADDITION to the panel, never instead of it. The panel is the keyboard and
screen-reader path and the path that still works when a board control is off-screen, mid-animation,
or not built yet — which, in a chunked build, is most controls most of the time.

Expect the arrangement this produces: the custom board control AND the panel offering the same
choices beneath it. That is the floor, not a duplicate to clean up. A chunk that reports the panel's
copy of a board control as a defect has misread this rule; the finding to raise instead is the two
surfaces DISAGREEING, which is a wiring bug in the game UI.

Never set `platformActionPanelEscapeHatch` (the LIBX-01 rename of the now-retired whole-panel
escape hatch) without EXPLICIT client direction. It fences off the entire built-in action
panel, and switching it off without the client is exactly the never-suppress-built-in-UI violation
named in "## Boundaries" above. Never CSS-hide the panel either: that leaves operable controls in
the tab order with nothing visible, which is strictly worse.

If a specific action legitimately needs its redundant START BUTTON hidden from the Action Panel —
a game-design call, not a workaround — the ONLY sanctioned mechanism is the per-action
`.suppressFromActionPanel()` metadata field, applied to that one action. Its reach stops at the
button: the panel still renders that action's full choice list once the action is under way, and
nothing suppresses a live choice list. It is never a way to suppress the panel wholesale.

## Downstream Shape (cite, never restate)

Once this chunk's files are all written (every Build Manifest row `written`) and the test script
reflects the real interaction, the next step in this same session group is `build/test.md` —
authored alongside this file, in Phase 144. This file does not restate that step's structure.
