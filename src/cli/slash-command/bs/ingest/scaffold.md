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
Display names *from an already-kebab-cased name*, so do not re-derive those two — but the
kebab-casing itself is entirely your job. Use the derived Project Name (kebab-case) as `<name>`
in every command below.

## Directory Framing — `init` Always Creates a New Subdirectory

`npx boardsmith init <name>` **unconditionally creates `<cwd>/<name>`** and **errors** if that
path already exists (`Error: Directory "<name>" already exists`, `src/cli/commands/init.ts:19`).
There is no in-place mode and no "use the current directory if it's empty" mode — do not instruct
a session to run `init` inside an existing directory expecting it to scaffold that directory in
place. This corrects the old skill's stale Phase 1B framing, which conditionally used the current
directory; that directory-choice logic does not apply to `init` and must not be carried forward.

Run `init` from the **parent** directory of where the game project should live, using the derived
kebab-case Project Name:

```bash
cd <parent-of-where-the-project-should-live>
npx boardsmith init <name>   # ALWAYS creates ./<name>/ ; errors if it already exists
```

If the directory already exists, stop and ask the designer how to proceed (rename, or confirm the
existing directory should be reused via a different flow) rather than guessing.

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

   `--no-open` suppresses the browser auto-launch (`src/cli/commands/dev.ts:788` logs
   `Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.`) so this step never
   depends on a browser being available. Wait for the exact ready-state line before considering the
   server up:

   ```
   Ready! Press Ctrl+C to stop.
   ```

   (`src/cli/commands/dev.ts:791`.) As an additional confirmation, curl the resolved dev-server URL
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

A fresh session about to touch the scaffolded project's output should still read the base docs
list the old skill maintained (`src/cli/slash-command/instructions.md` lines 15-35 — e.g.
`docs/core-concepts.md`, `docs/common-pitfalls.md`, `docs/actions-and-flow.md`,
`docs/custom-ui-guide.md`, `docs/ui-components.md`). This file does not restate that list;
`/bs-build-chunk`'s own `investigate` step owns the full required-reading discipline for chunk
work. This scaffold step's concern is limited to: names derived correctly, `init` run from the
right place, and the empty skeleton proven to compile and serve before any rules are written.
