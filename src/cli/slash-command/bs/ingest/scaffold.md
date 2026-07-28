# Scaffold + Verify

Referenced by `ingest-rules.md` Step 1 ("Scaffold + Verify"). This step runs BEFORE
transcription/interview — the `rulebook/` slices and every ledger the later steps write live
inside the project directory this step creates. This file owns the entire
scaffold-and-verify sequence: deriving the game's names, running `boardsmith init`, verifying the
empty skeleton compiles and serves, and killing any server this skill starts before returning.
Chunk 1 must start from a known-good, verified-compiling baseline — never begin rules work against
an unscaffolded or uncompiling project.

## Name Derivation (extracted verbatim from the old `/design-game` skill's Phase 1B)

Ask for the game name first:

> "What would you like to call your game?"

From their answer, generate:

- **Display Name:** The name as they wrote it (e.g., "Robot Arena 3000")
- **Project Name:** A filesystem-safe kebab-case version (e.g., "robot-arena-3000")
- **Class Name:** A PascalCase version for TypeScript classes (e.g., "RobotArena3000")

Rules for generating safe names:

- Convert to lowercase
- Replace spaces and special characters with hyphens
- Remove consecutive hyphens
- Remove leading/trailing hyphens
- For class names: remove hyphens and capitalize each word

**You must derive the kebab-case Project Name yourself using the rules above** — `boardsmith
init` does NOT sanitize its argument (pass it "Robot Arena 3000" and it will happily create a
directory with spaces and derive a broken class name). The CLI's `toPascalCase`/`toDisplayName`
helpers (`src/cli/lib/project-scaffold.ts`) split only on `-`/`_`: they derive the Class and
Display names *from an already-kebab-cased name*, so do not re-derive the Class name — but the
kebab-casing itself is entirely your job, and the CLI's Display Name derivation is **lossy**
(punctuation and casing are destroyed by the kebab-case round trip), so it must be reconciled
after `init` — see "Display Name correction" below. Use the derived Project Name (kebab-case)
as `<name>` in every command below.

## Directory Framing — `init` Always Creates a New Subdirectory

`npx boardsmith init <name>` **unconditionally creates `<cwd>/<name>`** and **errors** if that
path already exists (`Error: Directory "<name>" already exists` — `src/cli/commands/init.ts`).
There is no in-place mode and no "use the current directory if it's empty" mode — do not instruct
a session to run `init` inside an existing directory expecting it to scaffold that directory in
place. This corrects the old skill's stale Phase 1B framing, which conditionally used the current
directory; that directory-choice logic does not apply to `init` and must not be carried forward.

Run `init` from the **parent** directory of where the game project should live, using the derived
kebab-case Project Name:

```bash
cd <parent-of-where-the-project-should-live>
npx boardsmith init <name> --rulebook <absolute-rulebookPath>   # ALWAYS creates ./<name>/ ; errors if it already exists
```

**`--rulebook` is part of this command line whenever a rulebook path is known** — i.e. whenever
the designer passed one to `/bs-ingest-rules` (see its "Invocation" section). It is not a separate
step and not optional-when-convenient. With it, `init` archives the source to
`rulebook/source/<filename>`, computes its SHA-256, and writes `rulebook/INDEX.md` with the four
provenance header lines plus empty `## Open Rules Gaps`, `## Slices`, and `## Term → Slice`
sections for Step 3 to fill. Add `--edition "<edition>"` too if the edition is already known;
without it the header records an explicit `not stated in the rulebook` value rather than a blank.

**`init` refuses to run without an explicit rulebook decision** — it exits with an error naming
both options. That is deliberate: this flag was documented here first and a live session still
ran the bare `npx boardsmith init <name>`, reproducing the command line from memory rather than
from this file. An error is the one signal that reliably gets acted on.

When no rulebook path exists, pass `--without-rulebook` instead. Drop `--rulebook` only when no
path exists at this point: the designer has no rulebook (the
interview path writes the header values itself, per `ingest/interview-fallback.md`), or they will
supply a path later at Step 2 — in which case run `npx boardsmith ingest-archive <path>` from
inside the project as soon as it is bound.

**Why the flag rather than a separate archive step.** Eleven mechanisms were tried for this
archive. Ten lived in skill text at various points and none executed across ten measured live
runs. The eleventh made it item 4 of the Verification Sequence below — whose items 1-3 run
correctly in every single run — and the session performed items 1-3 and skipped item 4, from a
file it had just read: its prior that "the scaffold sequence is three steps" beat the file saying
four. What no run has ever skipped is `boardsmith init <name>` itself, because it needs the
command to create the directory. A flag on a command already being invoked survives where a new
step does not. Do not split this back out into its own step.

If the directory already exists, stop and ask the designer how to proceed (rename, or confirm the
existing directory should be reused via a different flow) rather than guessing.

**Display Name correction (immediately after `init` succeeds):** `init` sets
`boardsmith.json`'s `displayName` by round-tripping the kebab-case argument through
`toDisplayName` (`src/cli/commands/init.ts`), which is lossy for any name with punctuation
or nonstandard casing — "The Duke's Gambit" kebab-cases to `the-duke-s-gambit` and
round-trips to "The Duke S Gambit". Compare `boardsmith.json`'s `displayName` to the Display
Name as the designer wrote it; if they differ, edit `boardsmith.json` to the designer's
original. This correction applies ONLY to `displayName` — it is user-facing verbatim text.
Do not touch the Class name: "do not re-derive" (above) still governs it.

## Verification Sequence

Run the following as ONE numbered sequence immediately after `init` succeeds. Do not skip steps,
do not reorder them, and do not treat "it compiled" as sufficient without also confirming it
serves. Failures at any step STOP the sequence with an actionable message (what failed, the exact
error, and what to fix) — never proceed past a failing step assuming it will "work once deployed."

1. **Compile gate** — from inside `<name>/`:

   ```bash
   cd <name>
   npx tsc --noEmit
   ```

   If errors occur:
   1. Read the error message carefully.
   2. Fix the specific issue.
   3. Run `tsc --noEmit` again.
   4. Repeat until clean.

   Do not proceed to step 2 until this is clean.

2. **Serve-check** — start the dev server in non-interactive mode and confirm it actually serves:

   ```bash
   npx boardsmith dev --no-open
   ```

   `--no-open` suppresses the browser auto-launch (`src/cli/commands/dev.ts` logs
   `Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.`) so this step never
   depends on a browser being available. Wait for the exact ready-state line before considering the
   server up:

   ```
   Ready! Press Ctrl+C to stop.
   ```

   (Emitted by `src/cli/commands/dev.ts`; the drift test pins this string against the source, so
   trust it verbatim.) As an additional confirmation, curl the resolved dev-server URL
   and confirm a non-error response. If the ready-state line never appears (or the curl fails),
   treat this as a scaffold failure — stop and report the actual server output, don't assume it's
   "probably fine."

3. **Kill the process** — this is an explicit, numbered step in the SAME sequence as steps 1-2,
   never a footnote or an afterthought left for later. Kill the dev server process you started in
   step 2 (e.g. the captured PID, or `kill %1` if started as a background job) before this skill
   proceeds to any further step. Leaving a dev server running after the check is a repo-wide hard
   rule violation (`CLAUDE.md`: "Don't leave a dev server running that you start.") and independently
   required by the plan itself: any server this skill starts must be killed before it returns.

Only once all three steps have completed (compile clean, serve confirmed, process killed) is the
scaffold considered verified and chunk 1 work may begin against it. The session stays inside
`<name>/` from here on — every subsequent ingest step (transcription/interview, synthesis,
sketch writing) writes its artifacts into this directory, never the parent.

## Required Reading Pointer

A fresh session about to touch the scaffolded project's output should still read the base
BoardSmith docs before generating any code: `docs/core-concepts.md` and
`docs/common-pitfalls.md` always; `docs/actions-and-flow.md` when building actions;
`docs/custom-ui-guide.md` and `docs/ui-components.md` when building UI; `docs/dice-and-scoring.md`
for dice games. (This list is cited by the docs' own names deliberately — the old skill's
`instructions.md`, which used to host it, is deleted when the bs- skills ship; the docs
themselves are the durable reference.) This file does not restate the docs' content;
`/bs-build-chunk`'s own `investigate` step owns the full required-reading discipline for chunk
work. This scaffold step's concern is limited to: names derived correctly, `init` run from the
right place, and the empty skeleton proven to compile and serve before any rules are written.
