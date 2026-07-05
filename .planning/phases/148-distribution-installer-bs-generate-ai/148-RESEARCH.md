# Phase 148: Distribution — Installer & `/bs-generate-ai` - Research

**Researched:** 2026-07-04
**Domain:** Claude Code slash-command/skill installation mechanics + Node.js file-copy installer rewiring
**Confidence:** HIGH (the load-bearing question is now resolved against current official docs, not assumption)

## Summary

The single most important finding: **Claude Code's legacy `.claude/commands/*.md` format (what the current installer uses) is a flat, single-file format with no bundled-sibling-files feature.** That is exactly why `install-claude-command.ts` embeds `instructions.md` inline today — a flat command file has no directory of its own to hold `build/`, `ingest/`, `templates/`, etc., and no reliable way to locate them at runtime. The bs- skills' "Installed location" paragraphs (authored in Phases 141-147) assume a directory-per-skill layout with sibling relative-path resolution — that assumption is **correct, but only realizable using Claude Code's current recommended format, Agent Skills (`.claude/skills/<name>/SKILL.md`)**, not the legacy flat-commands format the installer currently emits.

Agent Skills give exactly what the skill authors assumed: each skill is a **directory**, `SKILL.md` is its entrypoint, and the directory may contain arbitrary supporting files ("Skills can include multiple files in their directory... Reference supporting files from SKILL.md so Claude knows what each file contains and when to load it" — Claude reads them on demand via its normal Read tool, not via automatic inlining). Critically, Claude Code also exposes a frontmatter/body substitution variable, `${CLAUDE_SKILL_DIR}`, that resolves — before the model ever sees the content — to the **absolute path of the directory containing that skill's `SKILL.md`**, "regardless of the current working directory," and it works identically whether the skill is installed at the personal (`~/.claude/skills/`) or project (`.claude/skills/`) level. This is the concrete, install-location-agnostic mechanism the installer should use to make the bs- skills' relative references resolve correctly no matter where they're installed.

**Primary recommendation:** Convert the installer's target format from legacy flat `.claude/commands/<name>.md` files to Agent Skills directories: `.claude/skills/bs-ingest-rules/SKILL.md` (and 4 siblings), with the shared reference tree (`build/`, `ingest/`, `templates/`, `state-machine.md`, `aspects/`) copied as plain (non-skill) subdirectories directly under `.claude/skills/`, exactly mirroring the source repo's existing `src/cli/slash-command/bs/` shape (source layout already has entry-point files + `build/`, `ingest/`, `templates/`, `state-machine.md` as siblings). One necessary layout fix is required beyond a straight copy: `aspects/` currently lives as a **sibling of `bs/`** in the source tree (`src/cli/slash-command/aspects/`), but `bs/ingest/interview-fallback.md` references it as `../aspects/index.md` (one level up from `ingest/`, i.e. expecting `aspects/` to be a child of `bs/`, not a child of `slash-command/`). The installer must place `aspects/` at `bs/aspects/` in its copy (or the reference must be corrected) — this is a genuine pre-existing mismatch the researcher found by tracing the actual reference, not an installer nuance to invent.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Slash-command/skill discovery & naming | Claude Code runtime (external) | — | Governed entirely by Claude Code's own filesystem scan of `.claude/skills/` / `.claude/commands/`; BoardSmith has no control over discovery mechanics, only over what files it writes |
| Skill content resolution (sibling reads) | Claude Code runtime + the invoked model | — | `${CLAUDE_SKILL_DIR}` substitution happens in the Claude Code CLI before the model sees content; subsequent sibling reads are ordinary Read-tool calls the model makes using that resolved path |
| File-copy / install-layout construction | BoardSmith CLI (`install-claude-command.ts`) | — | BoardSmith owns exactly what gets written to disk and in what shape; this phase's entire scope |
| npm-link / global CLI availability | BoardSmith CLI (`install-claude-command.ts`) | — | Unrelated to skill-content resolution; kept as-is per CONTEXT.md |
| AI-generation logic (5 hooks) | Designer's game project (`src/rules/ai.ts`) | BoardSmith CLI (skill instructions only) | The skill only ships instructions; generated code lives in the game project, outside BoardSmith |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- The `bs-` skills reference sibling files by RELATIVE PATH (each skill's "Installed location" paragraph states relative paths resolve against the skill file's own directory — the bs/ tree is copied as a unit). The installer must copy the whole reference tree (`build/`, `ingest/`, `templates/`, `state-machine.md`, and the `aspects/` shared files) to the install target preserving structure, so those relative refs resolve at runtime — NOT the current single-file-embed-inline model (which only works for a self-contained skill with no sibling reads)
- Install the 5 command entry points so they are invocable as `/bs-*`. RESEARCH MUST confirm the exact Claude Code slash-command discovery + sibling-file resolution mechanism (does a command file resolve relative paths / read sibling files at runtime? does subdirectory namespacing map to `/bs-*` or `/bs:*`? are `@`-references supported?). If Claude Code CANNOT resolve runtime relative reads from a command file, the plan adapts — options the researcher should evaluate: (a) copy the bs/ tree to a known location and have thin command files point to absolute/`@`-paths, (b) namespaced subdir commands, (c) a documented layout the skills' existing "Installed location" wording already assumes. The skills were authored assuming (a-style) relative resolution against their own dir — the installer must deliver exactly that layout.
- Exclude the `.test.ts` files (ingest.test.ts, build-chunk.test.ts, status-tools.test.ts, templates.test.ts) from the installed set — they are BoardSmith's drift tests, not shipped skill content
- Preserve `local` (project `.claude/`) vs global (`~/.claude/`) install modes and `--force`; keep the `npm link` global-linking step

### generate-ai Rename & design-game Removal

- `/generate-ai` → `/bs-generate-ai`: keep the existing 5-hook AI-generator instructions (generate-ai-instructions.md content — objectives/threatResponseMoves/playoutPolicy/moveOrdering/uctConstant, Hex reference), and add framing positioning it as a LATE sketch chunk (invoked after game-end/scoring exists, since MCTS needs terminal states; also usable earlier for --ai solo-playtest seat-fill per the plan). The AI-generation CAPABILITY is preserved, only renamed + repositioned
- `/design-game` FULLY removed (no-backward-compat): drop it from the installer's install list, the uninstaller, the CLI command descriptions/help text (cli.ts line ~126 "Remove /design-game and /generate-ai"), and delete the now-dead `instructions.md` + `design-game.template.md` source files. No residual `design-game` references anywhere in the installed set or the installer code
- Update the installer's console output (the "Commands:" listing, the "/design-game skill is self-contained" blurb) to list the 5 bs- skills and describe the new model; the install changelog states the old-skill migration path (ingest offers the one-time conversion — already built in Phase 142)

### Verification — real installer test

- REAL vitest unit test (`install-claude-command.test.ts` or similar, mirroring project-scaffold.test.ts's real-install-to-temp-dir pattern): install to a temp dir, assert all 5 `bs-*` command entry points present, all shared reference files present with correct relative layout (so skills' refs resolve), `.test.ts` files excluded, `design-game` command + template ABSENT, `generate-ai` command absent and `bs-generate-ai` present
- No-residual-references check: grep the installed set (and the installer source) for `design-game` → zero hits post-removal
- End-to-end: the executor runs the real installer into a scratch temp dir once, verifies the layout + that a bs- skill's relative refs point at files that exist, then cleans up (no leftover global install, no npm link side-effects in the test — test the file-copy layer, not the npm link step)
- Behavioral proof that the installed skills actually RUN in Claude Code is Phase 149 (dry-run) / inherently manual

### Claude's Discretion

- Exact installer function decomposition, temp-dir test helper structure, whether to keep a single install function or split copy-tree vs install-commands, console-output wording

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| DIST-01 | `install-claude-command.ts` installs all five bs- skills + shared reference files (aspects, doc lists, templates) and removes the design-game template | See "The Load-Bearing Question" and "Recommended Install Layout" — Agent Skills format + exact directory tree to copy, including the `aspects/` placement fix |
| DIST-02 | `/generate-ai` is renamed `/bs-generate-ai` and positioned as a late sketch chunk after game-end exists | See "generate-ai → bs-generate-ai" section — exact content edits vs pure rename |

</phase_requirements>

## The Load-Bearing Question — Resolved

### 1. Where do slash commands/skills live, and how does filename/dirname map to command name?

Two coexisting mechanisms in current Claude Code (confirmed via official docs, `code.claude.com/docs/en/skills` and `code.claude.com/docs/en/agent-sdk/slash-commands`, fetched 2026-07-04):

**A. Legacy flat commands** (`.claude/commands/`) — what the current installer uses:
- Project: `.claude/commands/<name>.md`
- Personal: `~/.claude/commands/<name>.md`
- **Command name = filename without extension, full stop.** Subdirectory nesting does **NOT** change the invocable name and does **NOT** produce a `namespace:command` form. Official example: `.claude/commands/frontend/component.md` → `/component` (description shows `(project:frontend)` as metadata only). `[VERIFIED: code.claude.com/docs/en/agent-sdk/slash-commands]` — this directly falsifies one option CONTEXT.md asked the researcher to check ("does subdirectory namespacing map to `/bs-*` or `/bs:*`") for the **legacy commands format**: it maps to neither — nesting is cosmetic for legacy commands.
- **No supporting-files feature.** The docs explicitly state: "Files in `.claude/commands/` still work and support the same frontmatter... Skills are recommended since they support additional features like supporting files." A flat command file has no directory of its own; there is nothing for the file to be "the sibling of."

**B. Agent Skills** (`.claude/skills/`) — the current recommended format, and a superset of commands:
- Project: `.claude/skills/<skill-name>/SKILL.md`
- Personal: `~/.claude/skills/<skill-name>/SKILL.md`
- **Command name = the skill's own directory name**, not the filename (the file is always literally `SKILL.md`). Official example: `.claude/skills/deploy-staging/SKILL.md` → `/deploy-staging`. `[VERIFIED: code.claude.com/docs/en/skills, "How a skill gets its command name" table]`
- Subdirectory nesting DOES matter, but only in the specific case of **nested `.claude/skills/` directories at different levels of a monorepo with a name collision** (e.g. `apps/web/.claude/skills/deploy/SKILL.md` colliding with a root `deploy` skill → the nested one becomes `/apps/web:deploy`). This does not apply to our flat single-location install (`~/.claude/skills/` or project `.claude/skills/`, five uniquely-named skill dirs, no collision) — so **`/bs-ingest-rules`, `/bs-build-chunk`, `/bs-check-status`, `/bs-insert-chunk`, `/bs-generate-ai` are exactly the invocable names** if each is installed as `.claude/skills/bs-<name>/SKILL.md`. `[VERIFIED: same source]`
- **`.claude/commands/*.md` files and `.claude/skills/*/SKILL.md` are literally interchangeable for creating a command** — "A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way." `[VERIFIED: code.claude.com/docs/en/skills]`

### 2. Can a skill/command file read sibling files at runtime by relative path?

**Yes for Agent Skills, and this is an explicitly documented, first-class feature — not an assumption.** `[VERIFIED: code.claude.com/docs/en/skills, "Add supporting files" section]`

> "Skills can include multiple files in their directory. This keeps SKILL.md focused on the essentials while letting Claude access detailed reference material only when needed... Reference supporting files from SKILL.md so Claude knows what each file contains and when to load it."

Example directory shape from the official docs (structurally identical to the bs- skills' own "Installed location" paragraphs):

```
my-skill/
├── SKILL.md (required)
├── reference.md (loaded when needed)
├── examples.md (loaded when needed)
└── scripts/
    └── helper.py (executed, not loaded)
```

The mechanism is **not automatic inlining at load time** — Claude Code loads only `SKILL.md`'s body into context when the skill is invoked; sibling files are read by the model itself, on demand, via its normal Read tool, driven by prose in `SKILL.md` telling it what to read and when (e.g. "For complete API details, see [reference.md](reference.md)"). This matches — almost verbatim — the bs- skills' existing "Reference Files" sections (e.g. ingest-rules.md:192-206 lists `ingest/transcription.md`, `state-machine.md`, `templates/SKETCH.template.md` by relative path with descriptions of when to read each).

**Crucially, Claude Code provides a substitution variable purpose-built for this exact cross-install-location problem:** `${CLAUDE_SKILL_DIR}` — "The directory containing the skill's `SKILL.md` file... Use this... to reference scripts or files bundled with the skill, regardless of the current working directory." `[VERIFIED: code.claude.com/docs/en/skills, frontmatter reference table]` This substitution happens **before** the model sees the content (it's a pre-render string replacement, same mechanism as `` !`command` `` shell injection), so the model receives a literal, already-resolved absolute path — it does not need to infer "where am I" from context. This is the single most important mechanism for this phase: it lets the same `SKILL.md` content work correctly whether installed at `~/.claude/skills/bs-ingest-rules/` (global) or `<project>/.claude/skills/bs-ingest-rules/` (local), with zero templating/`{{BOARDSMITH_ROOT}}`-substitution logic needed in the installer for this purpose (contrast with the current `generate-ai.template.md`/`design-game.template.md`'s `{{BOARDSMITH_ROOT}}` string-replace approach).

**For legacy flat `.claude/commands/` files:** there is no equivalent built-in mechanism and no directory of the command's own to hold siblings. A flat command file *could* still mention a path and the model could still attempt a Read call on it (Claude Code's main agent has ordinary filesystem Read access, not sandboxed to "its own" directory) — but there is no reliable, install-location-independent way to tell the model where "here" is, which is precisely why the *existing* installer embeds `instructions.md`'s full content inline rather than trying to reference it by path. `[ASSUMED — inferred from the absence of any documented mechanism for flat commands; not contradicted by any source found]`

### 3. Correct install layout — concrete recommendation

**Recommendation: migrate the installed format from `.claude/commands/*.md` (flat) to `.claude/skills/<name>/SKILL.md` (directory-per-skill), and copy the full shared reference tree as non-skill sibling subdirectories under the same `.claude/skills/` root.** This is not a redesign of the bs- skills' content (Phases 141-147 already wrote every "Installed location" paragraph assuming exactly this shape) — it is the installer catching up to a layout the skill authors already assumed, using the actual mechanism (Agent Skills) that makes that assumption true.

Target layout (project-local example; global mirrors it under `~/.claude/skills/`):

```
.claude/skills/
├── bs-ingest-rules/
│   └── SKILL.md              # was: bs/ingest-rules.md — content unchanged except
│                              #   frontmatter (name/description) + optionally using
│                              #   ${CLAUDE_SKILL_DIR} in place of prose-only relative refs
├── bs-build-chunk/
│   └── SKILL.md               # was: bs/build-chunk.md
├── bs-check-status/
│   └── SKILL.md               # was: bs/check-status.md
├── bs-insert-chunk/
│   └── SKILL.md               # was: bs/insert-chunk.md
├── bs-generate-ai/
│   └── SKILL.md               # was: generate-ai-instructions.md, reframed (see below)
├── build/                     # copied verbatim (11 files, no SKILL.md — not a skill)
│   ├── ask.md, audit.md, build.md, close.md, design-ask.md, design-review.md,
│   │   final-acceptance.md, investigate.md, playtest.md, redteam.md, revise.md, test.md
├── ingest/                    # copied verbatim (4 files, no SKILL.md — not a skill)
│   ├── interview-fallback.md, scaffold.md, sketch-derivation.md, transcription.md
├── templates/                 # copied verbatim (6 files, no SKILL.md — not a skill)
│   ├── ASSETS.template.md, CHUNK.template.md, DECISIONS.template.md,
│   │   DESIGN.template.md, RULINGS.template.md, SKETCH.template.md
├── state-machine.md           # copied verbatim, sibling of the 5 skill dirs
└── aspects/                   # copied verbatim, but RELOCATED — see pitfall below
    ├── dice.md, hex-grid.md, index.md, playing-cards.md, square-grid.md
```

Because each of the 5 skill entry points becomes its own directory (`bs-ingest-rules/`, etc.), and `build/`/`ingest/`/`templates/`/`state-machine.md`/`aspects/` are its **siblings' siblings** (one level further up, at the `.claude/skills/` root, not inside any individual skill directory), every existing relative reference written from the 4 already-authored entry-point skills (e.g. `templates/SKETCH.template.md`, `state-machine.md`, `ingest/transcription.md`) needs **one additional `../`** prepended relative to how those files describe themselves today, because today's source tree has the entry-point `.md` files as flat siblings of `build/`/`ingest/`/`templates/`/`state-machine.md` inside `bs/`, whereas the target Skills layout nests each entry point one directory deeper (inside its own `bs-<name>/` folder). Concretely: `ingest-rules.md`'s current relative reference `templates/SKETCH.template.md` must become `../templates/SKETCH.template.md` when the content moves into `bs-ingest-rules/SKILL.md`. **This is a required content edit, not just a file copy** — every one of the 5 entry-point files' body text (their "Reference Files" / "Reference this skill's" sections) needs its relative paths bumped one level, OR (cleaner, and consistent with the docs' own recommended pattern) rewritten to use `${CLAUDE_SKILL_DIR}/../templates/...` absolute-resolving form, which sidesteps any ambiguity about "relative to what" and is exactly what the docs demonstrate for cross-directory sibling references.

**`build/` and `ingest/`'s own internal cross-references also need auditing**: e.g. `bs/ingest/interview-fallback.md`'s `../aspects/index.md` reference was written when `aspects/` was assumed to be `bs/aspects/` (one level up from `ingest/`). In the target Skills layout, `ingest/` sits at `.claude/skills/ingest/` (sibling of `bs-ingest-rules/`, not nested inside it — see layout above), so `../aspects/index.md` from `.claude/skills/ingest/interview-fallback.md` correctly resolves to `.claude/skills/aspects/index.md` **only if `aspects/` is installed as a direct sibling of `ingest/` at the `.claude/skills/` root** (which the layout above already places it at) — so this specific reference is fine as-is in the new layout. **The pre-existing bug is in the *source* tree** (`src/cli/slash-command/aspects/` currently sits as a sibling of `bs/`, not inside `bs/` — see Common Pitfalls below), not in the target install layout; the installer's copy step must source `aspects/` from `src/cli/slash-command/aspects/` and place it inside the copied `bs/`-equivalent tree so the already-written `../aspects/index.md` reference is satisfied.

**Both `local` and global install modes get the same skills-directory treatment**: `local` → `<cwd>/.claude/skills/...`, global → `~/.claude/skills/...`. No `npm link`/`{{BOARDSMITH_ROOT}}` string substitution is needed for the bs- skills specifically (contrast: `bs-generate-ai/SKILL.md` still needs to tell the designer to run `npx boardsmith analyze --json` etc. against *their game project*, which is unrelated to locating BoardSmith's own installed skill files).

### Alternative options considered and rejected

| Option | Why rejected |
|--------|--------------|
| (a) Keep flat `.claude/commands/*.md`, use absolute/`@`-paths pointing at the BoardSmith npm-linked install root | Works but reintroduces the exact fragility the current installer already avoids by embedding — the absolute path depends on `boardsmithRoot` resolution succeeding and staying stable across `npm link`/reinstall; Agent Skills' `${CLAUDE_SKILL_DIR}` needs no such indirection since the reference tree is copied alongside the skill, not left in the npm package |
| (b) Namespaced subdirectory commands (`/bs:ingest-rules`) | Confirmed NOT how legacy commands work (nesting is cosmetic there) and not how Skills work either at top-level scope (no collision → no namespace prefix) — this option doesn't actually exist for this install shape |
| (c) A documented layout the skills already assume, achieved by inlining everything (status quo model) | Directly contradicts the CONTEXT.md-locked decision to avoid the embed-inline model; would also balloon each of the 5 entry points to ~2,000+ lines (the `build/` subtree alone is part of the 3,854-line `bs/` tree total) each time, duplicating shared content 5x and making template edits require touching 5 files |

**Recommendation: Agent Skills format (`${CLAUDE_SKILL_DIR}`-anchored relative refs), copying the shared tree once as siblings under `.claude/skills/`.**

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs.promises` (built-in) | current | Recursive directory copy for the shared `bs/`-equivalent tree | Already used throughout `install-claude-command.ts`; no new dependency needed. `fs.cp(src, dest, { recursive: true })` (Node 16.7+) replaces manual per-file copy loops for the `build/`/`ingest/`/`templates/`/`aspects/` directories |
| `vitest` (already a devDependency) | existing pinned version | Real installer test, mirroring `project-scaffold.test.ts`'s temp-dir pattern | Established project convention; no alternative considered |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs.promises.mkdtemp` + `node:os.tmpdir` | built-in | Real install-to-temp-dir test harness | Exactly the pattern `project-scaffold.test.ts` uses (`mkdtempSync(join(tmpdir(), 'bs-scaffold-compile-'))`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs.cp(..., {recursive:true})` for tree copy | Manual recursive `fs.readdir`/`fs.copyFile` walk | `fs.cp` is simpler and already available (Node ≥16.7; repo's engines requirement should be checked, but this codebase already targets modern Node per `tsc`/ESNext usage) — no reason to hand-roll a recursive copier |

**Installation:** No new packages required — this phase is pure Node built-ins + existing devDependencies.

**Version verification:** N/A — no new external packages introduced.

## Package Legitimacy Audit

Not applicable — this phase introduces no new npm dependencies. No `slopcheck`/registry verification needed.

## Architecture Patterns

### System Architecture Diagram

```
npx boardsmith claude [--local] [--force]
        │
        ▼
installClaudeCommand()
        │
        ├─▶ resolve boardsmithRoot (existing logic, unchanged)
        ├─▶ verify package.json name === boardsmith (existing logic, unchanged)
        ├─▶ determine targetDir:
        │     --local  → <cwd>/.claude/skills
        │     (default) → ~/.claude/skills
        │
        ├─▶ copySkillTree(boardsmithRoot, targetDir, force)
        │     │
        │     ├─▶ for each of 5 entry points:
        │     │     read src/cli/slash-command/bs/<entry>.md
        │     │     rewrite relative refs (+1 "../" level, or ${CLAUDE_SKILL_DIR}-anchor)
        │     │     write targetDir/bs-<entry>/SKILL.md  (with frontmatter: name, description)
        │     │
        │     ├─▶ fs.cp(bs/build,     targetDir/build,     {recursive:true, filter: exclude *.test.ts})
        │     ├─▶ fs.cp(bs/ingest,    targetDir/ingest,    {recursive:true, filter: exclude *.test.ts})
        │     ├─▶ fs.cp(bs/templates, targetDir/templates, {recursive:true, filter: exclude *.test.ts})
        │     ├─▶ fs.copyFile(bs/state-machine.md, targetDir/state-machine.md)
        │     └─▶ fs.cp(slash-command/aspects, targetDir/aspects, {recursive:true})
        │
        ├─▶ writeSkill('bs-generate-ai', reframed generate-ai-instructions.md content)
        │
        ├─▶ npm link --force (existing logic, unchanged)
        │
        └─▶ console output: 5 bs- skills listed, migration-path blurb, no design-game mention
```

### Recommended Project Structure

(See "Recommended Install Layout" above under The Load-Bearing Question — this *is* the project structure for this phase; repeating here would be redundant.)

### Pattern 1: `${CLAUDE_SKILL_DIR}`-anchored sibling reference

**What:** Instead of a bare relative path like `templates/SKETCH.template.md` (which is ambiguous about "relative to what" once content moves between directory depths), reference bundled files as `${CLAUDE_SKILL_DIR}/../templates/SKETCH.template.md`.
**When to use:** In any of the 5 entry-point `SKILL.md` files, wherever they currently say "read `templates/X`", "read `state-machine.md`", "read `build/investigate.md`", etc.
**Example:**
```markdown
<!-- Source: code.claude.com/docs/en/skills, "Available string substitutions" -->
Read `${CLAUDE_SKILL_DIR}/../templates/SKETCH.template.md` to get the sketch skeleton
this skill fills in.
```
This is substituted by Claude Code to a literal absolute path (e.g.
`/Users/x/.claude/skills/bs-ingest-rules/../templates/SKETCH.template.md`) before the
model ever sees the text — no ambiguity about install location (project vs. personal).

### Pattern 2: Non-skill shared directories under `.claude/skills/`

**What:** `build/`, `ingest/`, `templates/`, `aspects/`, and `state-machine.md` are copied directly under `.claude/skills/` as plain directories/files with **no `SKILL.md`** at their root.
**When to use:** Any reference content shared by ≥2 of the 5 entry-point skills.
**Why it's safe:** Per the docs' "Where skills live" model, discovery treats `SKILL.md` as the entrypoint marker per directory; a directory lacking `SKILL.md` is simply not surfaced as an invocable skill. `[MEDIUM confidence — inferred from "Each skill is a directory with SKILL.md as the entrypoint" and the absence of any documented requirement that every top-level subdirectory under `.claude/skills/` must be a skill; not contradicted by any source, but not tested empirically in this research session — flag for confirmation during the Phase 148 installer test (assert no phantom `/build`, `/templates`, `/aspects` commands appear) and/or Phase 149's dry-run]`

### Anti-Patterns to Avoid

- **Leaving the flat `.claude/commands/*.md` format for the bs- skills:** it cannot support sibling reads at all (no bundled-files feature) — this would force back into the embed-everything-inline model CONTEXT.md explicitly rejects.
- **Copying `aspects/` as a sibling of the `bs-*` skill directories at the SAME level it currently sits in the source tree** (i.e., sibling of the whole `bs/` folder) without checking the actual relative-reference depth used by `ingest/interview-fallback.md` — this reproduces the pre-existing source-tree path mismatch instead of fixing it during install.
- **Re-deriving `{{BOARDSMITH_ROOT}}`-style template substitution for the bs- skills:** unlike `generate-ai`/`design-game`'s old model (pointing at a doc *inside the npm package*), the bs- skills' reference tree is copied *alongside* the skill at install time — there is no need to point back at `boardsmithRoot` for these files, only `${CLAUDE_SKILL_DIR}`-relative resolution within the copied tree.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive directory copy with per-file exclusion (skip `.test.ts`) | A manual `fs.readdir`/recursion walker | `fs.cp(src, dest, { recursive: true, filter })` (Node built-in) | Built into Node ≥16.7; `filter` callback receives `(src, dest)` and can `return !src.endsWith('.test.ts')` — no need to hand-roll traversal or exclusion logic |
| Cross-install-location path resolution (project vs. personal `.claude/skills/`) | A custom "detect where am I installed" heuristic inside SKILL.md prose | `${CLAUDE_SKILL_DIR}` substitution (Claude Code built-in) | Purpose-built for exactly this; resolved before the model sees content, so no runtime ambiguity |

**Key insight:** This phase's entire difficulty is a documentation-format migration (`.claude/commands/` → `.claude/skills/`), not a novel file-copy engineering problem — Node's built-in recursive copy and Claude Code's built-in path substitution cover both hard parts.

## Common Pitfalls

### Pitfall 1: `aspects/` relative-path depth mismatch (pre-existing, found by tracing the actual reference)
**What goes wrong:** `bs/ingest/interview-fallback.md:174-178` references `../aspects/index.md`, which (from `bs/ingest/`) resolves to `bs/aspects/index.md`. But the actual file lives at `src/cli/slash-command/aspects/index.md` — a **sibling of `bs/`**, not a child of it. A naive "copy `bs/` verbatim, copy `aspects/` verbatim to wherever it currently sits relative to `bs/`" install would leave this reference broken (file not found) at runtime.
**Why it happens:** `aspects/` was authored before the bs- skill family, as a shared resource for the pre-existing `design-game`/`instructions.md` skill; when the bs- ingest skill was authored in Phase 142, its reference assumed `aspects/` would be relocated into the `bs/` tree by the time this (148) phase ships, per its own "Installer-phase dependency" footnote style (see other entry points' matching footnotes about `state-machine.md`/`templates/`).
**How to avoid:** The installer's copy step must place `aspects/` at `<targetDir>/aspects/` where `<targetDir>` is the SAME parent that holds `ingest/` (i.e., `.claude/skills/aspects/`, sibling of `.claude/skills/ingest/`) — NOT nested inside any individual `bs-*` skill directory. Verify with `../aspects/index.md` traced literally from the installed `ingest/interview-fallback.md` location.
**Warning signs:** The Phase 148 installer test should include an explicit assertion that every file path referenced via markdown-relative syntax in the 5 SKILL.md bodies AND in `ingest/`, `build/`'s own cross-references resolves to a real file in the installed tree (a "no dangling relative reference" grep-and-glob check), not just that expected files exist.

### Pitfall 2: One-level relative-path shift when entry points move from flat files to per-skill directories
**What goes wrong:** Today, `ingest-rules.md` is a flat sibling of `templates/`, `state-machine.md`, `ingest/` inside `bs/` — so `templates/SKETCH.template.md` (no `../`) is correct *today*. Once it becomes `bs-ingest-rules/SKILL.md`, it is nested one directory deeper than `templates/`, `state-machine.md`, etc. (which stay at the `.claude/skills/` root as siblings of `bs-ingest-rules/`, not moved inside it). Every existing relative reference in the 4 already-authored entry points needs a `../` prepended, or must switch to the `${CLAUDE_SKILL_DIR}/../...` form.
**Why it happens:** The skills were authored against the source-repo `bs/` tree's shape (entry points flat, siblings of `templates/`/`ingest/`/`build/`/`state-machine.md`), which is one level shallower than the Skills-format layout requires (entry points must each be their own directory to get the `/bs-*` name).
**How to avoid:** Either rewrite the reference lines during the copy step (regex replace `` `templates/ `` → `` `${CLAUDE_SKILL_DIR}/../templates/ `` etc.) or, more robustly, edit the 4 existing entry-point source files once (in `src/cli/slash-command/bs/*.md`) to use the `${CLAUDE_SKILL_DIR}`-anchored form directly, so the installer's copy step becomes a pure verbatim copy with no text rewriting (safer — text-rewriting during install is itself a drift risk if the source files change again).
**Warning signs:** Any bs- skill session that reports "file not found" trying to read its own templates/state-machine/build steps.

### Pitfall 3: Console-output / uninstall / help-text residual `design-game` references
**What goes wrong:** `design-game` appears in `install-claude-command.ts` at minimum on lines 4 (file header comment), 52, 66, 127, 155, 186, 189, 204, 209-211 (uninstall path), and in `cli.ts:126` ("Remove /design-game and /generate-ai"). A partial removal (e.g. deleting the install-map entry but leaving the uninstall path or the header comment) fails the CONTEXT.md-mandated "zero residual references" grep check.
**Why it happens:** The references are spread across install, uninstall, existence-check, and console-output code paths that are easy to touch only some of during a refactor.
**How to avoid:** `grep -rn design-game src/cli` before considering the phase done; the CONTEXT.md-specified test should encode exactly this grep as an assertion, not just check the installed *output* files.
**Warning signs:** `grep -c design-game src/cli/commands/install-claude-command.ts` returns non-zero after the "done" commit.

### Pitfall 4: `.test.ts` files accidentally swept into the copy
**What goes wrong:** A naive `fs.cp(bs/, target/, {recursive:true})` for the whole `bs/` directory (rather than copying `build/`, `ingest/`, `templates/` individually) will also copy `bs/ingest.test.ts`, `bs/build-chunk.test.ts`, `bs/status-tools.test.ts`, `bs/templates.test.ts` (and any `.test.ts` inside `build/`/`ingest/` subdirectories, if present — checked: none found there currently, but the filter must still be defensive) into the installed skill tree.
**Why it happens:** `bs/` mixes drift-test files with shipped content at the same directory level as the entry-point `.md` files.
**How to avoid:** Use `fs.cp`'s `filter` callback to exclude any path ending in `.test.ts`, applied uniformly to every subtree copy, not just the top-level entry points.
**Warning signs:** `find <installed-target> -name '*.test.ts'` returns any hits.

## Code Examples

### Recursive tree copy excluding test files (Node built-in)
```typescript
// Source: Node.js fs.cp docs (built-in, no external package)
await fs.cp(
  join(boardsmithRoot, 'src', 'cli', 'slash-command', 'bs', 'templates'),
  join(targetDir, 'templates'),
  {
    recursive: true,
    filter: (src) => !src.endsWith('.test.ts'),
  }
);
```

### `${CLAUDE_SKILL_DIR}`-anchored reference inside a SKILL.md body
```markdown
<!-- Source: code.claude.com/docs/en/skills, "Available string substitutions" table -->
## Reference Files

- `${CLAUDE_SKILL_DIR}/../ingest/transcription.md` — fan-out subagent dispatch protocol
- `${CLAUDE_SKILL_DIR}/../state-machine.md` — status enum, consistency check, session lock
- `${CLAUDE_SKILL_DIR}/../templates/SKETCH.template.md` — the sketch skeleton this skill fills
```

### SKILL.md frontmatter for a manually-invoked, side-effecting workflow skill
```yaml
<!-- Source: code.claude.com/docs/en/skills, "Control who invokes a skill" -->
---
name: bs-ingest-rules
description: Ingest a board game rulebook and produce the initial sketch/chunk plan for a new BoardSmith game. Use when starting a new game project from a rulebook.
disable-model-invocation: true
---
```
`disable-model-invocation: true` is appropriate here (mirroring the docs' `/deploy` example) since these are explicit, stateful workflow steps the designer should trigger deliberately, not actions Claude should decide to run autonomously mid-conversation.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `.claude/commands/*.md` flat single-file commands, manual `{{BOARDSMITH_ROOT}}` template substitution for anything needing to reference the BoardSmith install | `.claude/skills/<name>/SKILL.md` directories with bundled supporting files and `${CLAUDE_SKILL_DIR}` substitution | Documented as "recommended" in current Claude Code docs (exact version-introduction date not found in the fetched pages; commands remain supported, not deprecated) | Enables the bs- skills' cross-file relative-reference design to actually work at runtime; removes the need for install-time template string-replacement for BoardSmith-bundled reference content |

**Deprecated/outdated:** Nothing is formally deprecated — `.claude/commands/` "still works," but is explicitly the format to move away from for any skill needing more than a single self-contained file, which is exactly this phase's situation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A directory under `.claude/skills/` that lacks a `SKILL.md` (e.g. `build/`, `templates/`, `aspects/`) is silently ignored by skill discovery rather than causing a warning/error or being (incorrectly) treated as an empty/broken skill | Architecture Patterns, Pattern 2 | If wrong, the installer would need an alternate location for shared files (e.g. outside `.claude/skills/` entirely, referenced via an absolute/`${CLAUDE_PROJECT_DIR}`-anchored path instead) — moderate rework, but easily caught by the Phase 148 installer test (assert `/build`, `/templates`, `/aspects` do NOT appear as phantom commands) before it ever reaches a real user |
| A2 | Flat `.claude/commands/*.md` files have no reliable mechanism for a model to resolve "my own directory" for sibling reads (no equivalent of `${CLAUDE_SKILL_DIR}`) | The Load-Bearing Question, item 2 | Low risk — this claim is used only to justify NOT choosing the flat-commands format; even if some undocumented mechanism exists, the Skills format is still the officially recommended, explicitly-designed-for-this-purpose choice, so the recommendation stands either way |
| A3 | The exact Claude Code version where Agent Skills / `${CLAUDE_SKILL_DIR}` became available is not pinned in this research (no min-version marker was present on the base skills doc, only on specific newer fields like `${CLAUDE_PROJECT_DIR}` v2.1.196 and the `/run`/`/verify` skills v2.1.145) | State of the Art | If a designer's Claude Code install predates Agent Skills entirely, `/bs-*` would silently not appear; low risk in practice since Skills are now the primary documented mechanism and any current install should have them, but worth a `--force`/README note recommending `claude --version` or `claude update` before install |

## Open Questions

1. **Does `fs.cp`'s `filter` need to be async-aware / does the installed Node engine support it without a polyfill?**
   - What we know: `fs.cp` with `recursive` and `filter` has been stable since Node 16.7+ (filter as sync or async callback supported since Node 18ish for some edge cases); this project's `tsc` config already targets ES2022/ESNext and the repo runs a modern Node toolchain per `project-scaffold.test.ts`'s use of the `typescript` package's `Bundler` module resolution.
   - What's unclear: The exact minimum Node version BoardSmith's own `package.json engines` field requires (not read in this research pass).
   - Recommendation: Planner should have a task read `package.json`'s `engines.node` field and confirm it's ≥16.7 (almost certainly true already, since Vite/Vitest tooling used elsewhere requires modern Node) before relying on `fs.cp`.

2. **Is `disable-model-invocation: true` the right choice for all 5 skills, or should `bs-check-status` (read-only, side-effect-free) be left model-invocable?**
   - What we know: The CONTEXT.md and bs-skills-plan.md describe all 5 as designer-triggered workflow commands with explicit state transitions.
   - What's unclear: Whether allowing Claude to autonomously invoke `/bs-check-status` (harmless, read-only) when a designer asks "where are we?" in conversation would be a net usability win consistent with the plan's "every bs- skill is state-aware and routes you" design, vs. adding surprising autonomous behavior.
   - Recommendation: Default all 5 to `disable-model-invocation: true` for this phase (safest, matches "Claude's Discretion" scope boundary — this is a content/UX nuance, not a distribution-mechanics question); leave loosening this as a follow-up idea, not a blocker for DIST-01/02.

3. **Exact Claude Code version-gating for `${CLAUDE_SKILL_DIR}` was not found with a min-version marker in the fetched docs (unlike some other substitutions).**
   - What we know: It's presented as a standard frontmatter/substitution field alongside `$ARGUMENTS`, `${CLAUDE_SESSION_ID}`, with no `{/* min-version */}` annotation, suggesting it's been available since Skills launched (unlike `${CLAUDE_PROJECT_DIR}` which is explicitly marked v2.1.196+).
   - What's unclear: Whether any currently-supported Claude Code version lacks it.
   - Recommendation: Treat as available; no fallback needed for this phase's scope.

## Environment Availability

Not applicable in the traditional sense (no external services/DBs) — the one relevant "environment" fact is the installed Claude Code CLI version, addressed in Open Questions #3 above; this is not a blocking dependency check performable from this research session (no `claude --version` invocation attempted, as it is orthogonal to writing the installer code).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (existing project standard) |
| Config file | repo root `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run src/cli/commands/install-claude-command.test.ts` |
| Full suite command | `npm run test` (or `npx vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-01 | Installing (local mode, temp dir) produces all 5 `bs-*` skill directories with `SKILL.md`, plus `build/`, `ingest/`, `templates/`, `state-machine.md`, `aspects/` at the correct relative depth, `.test.ts` files absent | integration (real install-to-temp-dir) | `npx vitest run src/cli/commands/install-claude-command.test.ts -t "installs bs- skill family"` | ❌ Wave 0 — new file |
| DIST-01 | No dangling relative reference: every markdown-relative path mentioned in an installed `SKILL.md`/`build/*.md`/`ingest/*.md` resolves to a real file post-install | integration | same file, `-t "no dangling references"` | ❌ Wave 0 |
| DIST-01 | `design-game` template/instructions files deleted from source; zero `design-game` string matches in installer source and in the installed output tree | integration + static grep | same file, `-t "no design-game residue"` | ❌ Wave 0 |
| DIST-02 | `bs-generate-ai` skill installed (not `generate-ai`); content still contains the 5 AI hooks (`objectives`, `threatResponseMoves`, `playoutPolicy`, `moveOrdering`, `uctConstant`) and new late-sketch-chunk framing language | integration | same file, `-t "bs-generate-ai renamed and repositioned"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/install-claude-command.test.ts`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/commands/install-claude-command.test.ts` — new file, covers DIST-01, DIST-02 (mirrors `src/cli/lib/project-scaffold.test.ts`'s temp-dir pattern: `mkdtempSync(join(tmpdir(), 'bs-install-'))`, install into it with `{ local: true }`-equivalent target override, assert layout, `rmSync(dir, {recursive:true, force:true})` in a `finally`)
- [ ] No new shared fixtures needed beyond the temp-dir helper already demonstrated in `project-scaffold.test.ts`

## Security Domain

Not applicable in the ASVS sense — this phase has no auth/session/input-validation surface; it is a local file-copy CLI operation. The one security-adjacent concern is generic to any installer: don't write outside the intended target directory. `fs.cp`'s `dest` argument is always an installer-constructed path (`join(targetDir, ...)`), never derived from unsanitized user input, so path-traversal is not a realistic risk here. `[ASSUMED — standard reasoning, not flagged as a distinct research finding]`

## Sources

### Primary (HIGH confidence)
- https://code.claude.com/docs/en/skills — Agent Skills: directory layout, command-name derivation table, supporting-files feature, `${CLAUDE_SKILL_DIR}` substitution, frontmatter reference (fetched 2026-07-04)
- https://code.claude.com/docs/en/agent-sdk/slash-commands — legacy `.claude/commands/` format: file locations, filename→name mapping, explicit statement that subdirectory nesting doesn't change command name (fetched 2026-07-04)
- This repo: `src/cli/commands/install-claude-command.ts`, `src/cli/cli.ts`, `src/cli/slash-command/bs/*.md` ("Installed location" paragraphs), `src/cli/slash-command/bs/ingest/interview-fallback.md` (aspects/ reference), `src/cli/slash-command/aspects/index.md`, `src/cli/lib/project-scaffold.test.ts`, `.planning/REQUIREMENTS.md`, `.planning/bs-skills-plan.md`, `.planning/phases/148-.../148-CONTEXT.md` — all read directly in this session

### Secondary (MEDIUM confidence)
- Inference that non-`SKILL.md` directories under `.claude/skills/` are silently ignored by discovery (Assumption A1) — reasoned from the docs' phrasing, not empirically tested in this session

### Tertiary (LOW confidence)
- Initial WebSearch snippet claiming `.claude/commands/release/notes.md` → `/release:notes` — this is **superseded/contradicted** by the authoritative fetched docs (which state nesting is cosmetic for legacy commands) and should be disregarded; flagged here only so the planner doesn't stumble on the same stale claim independently

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, pure Node built-ins already used in this codebase
- Architecture (Skills-format install layout): HIGH — directly verified against current official Claude Code docs, cross-checked against the actual source-tree reference paragraphs
- Pitfalls: HIGH for the `design-game` residue and `.test.ts` exclusion pitfalls (directly grepped in this session); MEDIUM for the `aspects/` depth mismatch (verified by tracing the literal reference text against the literal file location) and the one-level relative-path-shift pitfall (a design consequence of the format migration, not independently tested against a running Claude Code instance)

**Research date:** 2026-07-04
**Valid until:** 30 days (Claude Code skills docs are actively evolving; re-verify `${CLAUDE_SKILL_DIR}` availability and the non-SKILL.md-directory-ignored assumption if this phase's execution slips past early August 2026)
