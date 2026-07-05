# Phase 142: `/bs-ingest-rules` - Research

**Researched:** 2026-07-04
**Domain:** Claude-skill (slash-command) markdown authoring; rulebook-to-project ingestion pipeline for BoardSmith
**Confidence:** HIGH (this is an internal-codebase design phase — nearly every claim is verifiable directly against files in this repo, not external libraries)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Skill File Structure**
- Lean orchestrator skill file + step-scoped reference files under `src/cli/slash-command/bs/ingest/` (e.g. transcription, interview-fallback, sketch-derivation, scaffold) that subagent prompts embed — the 3,072-line design-game monolith is the anti-pattern being replaced
- Skill entry file: `src/cli/slash-command/bs/ingest-rules.md`; installer maps command names in Phase 148
- Reuse from old skill by EXTRACTION into `bs/` shared reference files: Phase 2 structured-interview question sequence (instructions.md lines ~121-223) becomes the no-rulebook fallback reference; Phase 1B naming rules (~lines 90-120) become the scaffold-step reference. Do NOT delete or modify instructions.md (Phase 148 owns removal)
- Templates consumed as logical references: the skill instructs sessions to copy `bs/templates/*.template.md` skeletons into the game project and follow `state-machine.md` — never restates template content inline (Phase 141 decision)

**Ingest Pipeline Mechanics**
- Transcription confirmed per rulebook section (batched slice-summary review with the user), not per page and not one bulk confirmation
- `rulebook/INDEX.md` is a term → slice-file table built by the orchestrator from subagent-returned term lists — the orchestrator never reads full slices (context economics hard rule)
- Sketch approval gate presents estimated chunk count + rough per-chunk wall time; only the next 2–3 chunks are detailed (lazy tail per state-machine.md); user edits → skill revises → user approves; user ordering wins unless a hard dependency is violated (named concretely with minimal prerequisite proposed)
- Scaffold verification: `npx boardsmith init` + compile check + serve-then-kill check before any rules work; failures stop with an actionable message; any server the skill starts is killed before returning (repo hard rule)

**Verification for This Phase**
- Structural drift test asserting contract strings in the skill files (status enums cited correctly, gates present, INGEST-01..07 anchor content, template/state-machine references) — either `bs/ingest.test.ts` or extending `bs/templates.test.ts`; executor's discretion on file placement
- Cross-file consistency assertion: every file path the skill references exists (templates, state-machine.md, ingest/ reference files) — no dangling pointers
- Behavioral proof (an actual ingest run) deferred to Phase 149's dry-run

### Claude's Discretion
- Exact decomposition of ingest/ reference files, section ordering, prompt wording for subagents, INDEX table format details

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INGEST-01 | Designer can ingest a rulebook (PDF/images/text) that is transcribed once by fan-out subagents into canonical `rulebook/` slices with citations, each confirmed with the user | See "Transcription Fan-Out" pattern below; plan §"1. `/bs-ingest-rules`" ¶2 (Input modes: Written rulebook) |
| INGEST-02 | Ingest produces `rulebook/INDEX.md`, variant/edition tagging, component inventory with aspect ratios, ASSETS.md, visual identity survey, and player-count data | See "Ingest Output Artifacts — Exhaustive List" below; `ASSETS.template.md` ledger contract |
| INGEST-03 | Designer with no written rulebook can use an interview fallback that produces the same `rulebook/` files section by section | Old skill Phase 2 (instructions.md:121-223) is the extraction source — see "Old-Skill Extraction Map" |
| INGEST-04 | Ingest scaffolds the project (`boardsmith init`, naming rules) and verifies the skeleton compiles and serves before rules work begins | See "Scaffold Step — CLI Reality" below (init.ts, project-scaffold.ts, dev.ts `--no-open`) |
| INGEST-05 | Ingest proposes a SKETCH.md whose first chunk is core event loop, mandates game-end/final-acceptance, tags `ui:`, outcome-based test scripts, gates on approval with chunk-count/time estimate | `SKETCH.template.md` "Mandated Chunks" + "Ordered Chunk List" sections are the exact target shape — see "Sketch Derivation" below |
| INGEST-06 | UI strategy decision (Custom UI from chunk 1 vs AutoUI-with-cutover) made with the user at ingest and recorded | `SKETCH.template.md` "## UI Strategy" section already exists (Phase 141 output) — ingest fills it, does not invent the field |
| INGEST-07 | Re-running ingest on existing project detects state and requires explicit confirmation; old `/design-game` projects get one-time conversion offer | See "Re-run Protection & Old-Skill Migration" below |
</phase_requirements>

## Summary

Phase 142 is a pure authorship task: write Claude-skill markdown (an orchestrator file plus several step-scoped reference files) that a Claude Code session reads and executes when a designer runs `/bs-ingest-rules`. There is no new runtime code, no new npm package, and no external library research — the "research" here is exhaustive extraction from three internal sources: (1) `.planning/bs-skills-plan.md` §ingest (the canonical design contract, already read in full above), (2) the old `/design-game` skill (`src/cli/slash-command/instructions.md`, 3,072 lines) for verbatim-extractable content (Phase 2 interview, Phase 1B naming, PROJECT.md/STATE.md/HISTORY.md shapes for migration), and (3) the actual CLI behavior of `npx boardsmith init` / `tsc --noEmit` / `npx boardsmith dev --no-open` that the scaffold step's instructions must describe accurately (Claude sessions executing this skill will run these exact commands).

The single most important non-obvious finding: **`npx boardsmith init <name>` unconditionally creates a NEW subdirectory named `<name>`** (`cli.ts:25` — `.command('init <name>')`; `init.ts:18` — `existsSync(projectPath)` errors if it already exists) — there is no in-place/"use current directory" mode. This diverges from the old skill's Phase 1B behavior, which asked the user and conditionally used the current directory. The old skill's actual Phase 5 Step 1, however, always calls `npx boardsmith init <project-name>` regardless (instructions.md:434), so in practice the old skill never used "current directory" for `init` either — Phase 1B's directory logic governed *where the interview/PROJECT.md* lived, not the scaffold step. The ingest skill should be explicit: always run `init` with the derived kebab-case project name from a location one level above where the game should live, and treat the resulting subdirectory as the game project root for every downstream artifact (`rulebook/`, `SKETCH.md`, `ASSETS.md`, etc.).

**Primary recommendation:** Author `bs/ingest-rules.md` as a thin orchestrator (state-detection → route to interview-fallback-or-transcription → INDEX+survey+inventory synthesis → scaffold+verify → sketch-derivation → approval gate → UI-strategy decision → write files per templates) that delegates all heavyweight prose to `bs/ingest/{transcription,interview-fallback,sketch-derivation,scaffold}.md` reference files, each concretely extracted or adapted from the sources below and each cited by exact path so the drift test can assert the pointers resolve.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rulebook transcription (fan-out subagents) | Claude session (orchestrator + subagents) | — | No runtime code; this is agent-prompt orchestration, analogous to GSD's researcher/planner subagent pattern |
| INDEX.md cross-reference synthesis | Claude session (orchestrator) | — | Orchestrator-only per context-economics hard rule — never reads full slices itself |
| Project scaffold (`boardsmith init`) | CLI (`src/cli/commands/init.ts`) | Claude session (invokes it, verifies output) | Scaffold generation is existing CLI code; ingest's job is to call it correctly and verify, not reimplement it |
| Compile/serve verification | CLI (`tsc --noEmit`, `boardsmith dev`) | Claude session (runs + interprets + kills) | Same split as scaffold: CLI does the work, skill markdown instructs the session how to invoke and gate on it |
| SKETCH.md / rulebook/ / ASSETS.md file writes | Claude session (orchestrator) | Filesystem (game project dir) | These are markdown state files per Phase 141's templates — orchestrator fills them, never restructures |
| UI strategy decision | Claude session (orchestrator, with user) | `SKETCH.md` "## UI Strategy" (Phase 141 artifact) | Decision-making is conversational (ingest skill); the durable record is the pre-existing template field |
| Old-skill migration detection | Claude session (orchestrator) | Filesystem (`PROJECT.md`/`STATE.md`/`HISTORY.md` presence check) | Detection is a file-existence check the skill's state-detection step performs, same pattern as old skill's own Phase 1 |

## Standard Stack

Not applicable in the conventional sense — this phase produces markdown (Claude-skill instructions), not application code with npm dependencies. No new packages are installed. The "stack" is:

| Component | Location | Purpose |
|-----------|----------|---------|
| Claude Code slash-command markdown | `src/cli/slash-command/bs/ingest-rules.md` (new) | Entry point read when `/bs-ingest-rules` runs |
| Step-scoped reference files | `src/cli/slash-command/bs/ingest/*.md` (new) | Detail embedded/linked by the orchestrator for each major step |
| `bs/state-machine.md` (existing, Phase 141) | `src/cli/slash-command/bs/state-machine.md` | Cited, never restated, per locked decision |
| `bs/templates/*.template.md` (existing, Phase 141) | `src/cli/slash-command/bs/templates/` | Copied into the game project by the skill; ingest fills SKETCH.md + seeds ASSETS.md |
| `aspects/*.md` (existing) | `src/cli/slash-command/aspects/` | Doc-reading list source the old skill used for code-gen; ingest's interview-fallback path should still reference these for the aspect-detection step it inherits |
| `docs/*.md` (existing) | `src/cli/../docs/` (repo `docs/`) | "Required Reading" doc list precedent (old skill lines 15-35) — the ingest scaffold step should preserve an equivalent required-reading pointer for chunk-building sessions, not duplicate the whole list itself (that belongs more to `/bs-build-chunk`, but ingest's scaffold-step reference file should note which base docs a fresh session reads before touching `boardsmith init` output) |

**Installation:** None — no `npm install` in this phase. `vitest` is already a devDependency (used by `bs/templates.test.ts`); the phase's own drift test extends that or adds a sibling file, both zero-install.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. Skip per protocol (no packages recommended).

## Architecture Patterns

### System Architecture Diagram

```
Designer runs /bs-ingest-rules
        │
        ▼
┌─────────────────────────┐
│ 0. State Detection       │  Is this an empty dir? An old design-game project
│    (bs/ingest/state.md   │  (PROJECT.md/STATE.md/HISTORY.md present)? An existing
│    or inline in entry)   │  bs- project (SKETCH.md present — re-run guard, INGEST-07)?
└───────────┬──────────────┘
            │
   ┌────────┴─────────┐
   │  old design-game  │──► offer one-time conversion (INGEST-07) ──► merges into sketch below
   │  detected?        │
   └────────┬─────────┘
            │ no (or converted)
            ▼
┌─────────────────────────┐        ┌──────────────────────────┐
│ 1a. Written rulebook?    │──yes──►│ Transcription fan-out:    │
│                          │        │ subagents per page range  │
└───────────┬──────────────┘        │ → rulebook/NN-topic.md    │
            │ no                    │ → per-section user confirm│
            ▼                       │ → orchestrator builds     │
┌─────────────────────────┐         │   INDEX.md from returned  │
│ 1b. Interview fallback   │────────►│   term lists (never reads │
│  (bs/ingest/             │         │   full slices itself)    │
│  interview-fallback.md,  │         └────────────┬─────────────┘
│  extracted old Phase 2)  │                      │
└──────────────────────────┘                      │
            │                                      │
            └──────────────────┬───────────────────┘
                                ▼
                 ┌───────────────────────────────┐
                 │ 2. Synthesis (orchestrator,    │
                 │ from subagent summaries only): │
                 │ - component inventory + aspect │
                 │   ratios → ASSETS.md seed      │
                 │ - visual identity survey       │
                 │   (evidence only, no decision) │
                 │ - variant/edition tagging       │
                 │ - min/max player counts +       │
                 │   per-count setup diffs         │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 3. Scaffold (bs/ingest/        │
                 │ scaffold.md, extracted old      │
                 │ Phase 1B naming rules):         │
                 │ npx boardsmith init <name>      │
                 │ → tsc --noEmit                  │
                 │ → boardsmith dev --no-open,     │
                 │   verify serving, KILL           │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 4. Sketch derivation            │
                 │ (bs/ingest/sketch-derivation.md)│
                 │ - first chunk = core event loop │
                 │ - mandated game-end + final-     │
                 │   acceptance chunks              │
                 │ - ui: none|touches|major per     │
                 │   chunk                          │
                 │ - outcome-based test scripts     │
                 │ - only next 2-3 detailed, tail    │
                 │   stays sketch-level             │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 5. UI strategy decision (with   │
                 │ the user) → SKETCH.md           │
                 │ "## UI Strategy" field           │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 6. Approval gate: chunk count +  │
                 │ rough wall time estimate; user   │
                 │ edits → revise → approve         │
                 └───────────────┬─────────────────┘
                                 ▼
                 ┌───────────────────────────────┐
                 │ 7. Write files (templates copied,│
                 │ never restated): SKETCH.md,      │
                 │ rulebook/*.md + INDEX.md,         │
                 │ ASSETS.md, RULINGS.md/DECISIONS.md│
                 │ /DESIGN.md skeletons (empty,      │
                 │ populated later by build-chunk)   │
                 └───────────────┬─────────────────┘
                                 ▼
                     Session ends: print next command
                     (/bs-build-chunk, chunk 1's slug)
```

### Recommended Project Structure (skill authoring, this repo)

```
src/cli/slash-command/bs/
├── state-machine.md              # existing (Phase 141) — cited, not restated
├── templates/                    # existing (Phase 141) — copied into game projects
│   ├── SKETCH.template.md
│   ├── CHUNK.template.md
│   ├── RULINGS.template.md
│   ├── DECISIONS.template.md
│   ├── DESIGN.template.md
│   └── ASSETS.template.md
├── templates.test.ts             # existing — extend, or...
├── ingest.test.ts                # ...new sibling (executor's discretion per CONTEXT.md)
├── ingest-rules.md               # NEW — lean orchestrator, this phase's main deliverable
└── ingest/                       # NEW — step-scoped reference files
    ├── transcription.md          # fan-out subagent prompt + per-section confirmation protocol
    ├── interview-fallback.md     # extracted old Phase 2 (instructions.md:121-223), adapted
    ├── sketch-derivation.md      # chunking heuristic, mandated-chunks enforcement, ui: tagging
    └── scaffold.md                # extracted old Phase 1B naming (instructions.md:90-120) + init/verify steps
```

### Pattern 1: Orchestrator-delegates-to-subagents (context economics)

**What:** The top-level skill file never reads large artifacts (full rulebook, full generated code) itself. It dispatches Task-tool subagents that read a bounded slice and return a small structured summary (term list, claims list, transcription text for one section). The orchestrator's own context stays small regardless of rulebook size.

**When to use:** Any step touching more than a few hundred lines of source material — transcription (per page range), INDEX construction (aggregating only the *returned* term lists, not re-reading slices).

**Example (prompt-shape, not literal code — this is markdown authoring, not TypeScript):**
```
# Source: .planning/bs-skills-plan.md — "Ingest respects its own context economics" + GSD
# researcher/planner precedent (~/.claude/get-shit-done/agents/gsd-researcher.md pattern:
# spawned subagent, single-purpose, returns structured findings, never the raw source)

Dispatch one subagent per rulebook page range (e.g. pp. 1-8, 9-16, ...):
  Task: "Transcribe pages {N}-{M} of the rulebook to canonical text. For each section,
         emit: (a) the transcribed text with page/section citations, (b) a list of terms
         this section defines or references (for INDEX.md), (c) any component/asset
         mentioned with its approximate aspect ratio if depicted."
  Return: { sectionText, citedTerms[], componentMentions[] }

Orchestrator:
  - writes each returned sectionText to rulebook/NN-topic.md
  - accumulates citedTerms[] into INDEX.md (term → file) WITHOUT re-reading the file it just wrote
  - accumulates componentMentions[] into the ASSETS.md seed
  - presents each section's summary to the user for confirmation BEFORE moving to the next
    page range (batched slice-summary review, not per-page, not one bulk gate — CONTEXT.md
    locked decision)
```

### Pattern 2: Structural-content-assertion test (not integration/behavioral)

**What:** A vitest file that reads the skill markdown files off disk via `readFileSync` and asserts specific strings/anchors are present — mirrors `bs/templates.test.ts` (Phase 141) and `src/cli/commands/init.test.ts`. No markdown parser, no execution of the skill itself.

**When to use:** This phase's own verification (per CONTEXT.md locked decision) — asserting INGEST-01..07 anchor content, correct status-enum citations, and that every file path the skill references actually exists on disk.

**Example:**
```typescript
// Source: src/cli/slash-command/bs/templates.test.ts (Phase 141 precedent, read in full above)
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

describe('INGEST-01 — transcription fan-out + per-section confirmation', () => {
  it('cites the per-section confirmation protocol, not per-page or bulk', () => {
    const orchestrator = read('ingest-rules.md');
    expect(orchestrator).toContain('ingest/transcription.md');
  });
});

describe('cross-file consistency — no dangling pointers', () => {
  const referencedPaths = [
    'ingest/transcription.md',
    'ingest/interview-fallback.md',
    'ingest/sketch-derivation.md',
    'ingest/scaffold.md',
    'state-machine.md',
    'templates/SKETCH.template.md',
    // ... every templates/*.template.md the orchestrator names
  ];
  it.each(referencedPaths)('%s exists on disk', (relPath) => {
    expect(existsSync(join(__dirname, relPath))).toBe(true);
  });
});
```

### Anti-Patterns to Avoid

- **Restating template content inline in ingest-rules.md:** Phase 141's locked decision is that `bs/templates/*.template.md` are consumed as logical references (copy the skeleton, follow state-machine.md) — never restated. Ingest's job is to *fill* SKETCH.md/ASSETS.md using those skeletons, not to re-describe their structure in its own prose (that duplication is exactly what caused instructions.md to reach 3,072 lines).
- **Orchestrator reading full rulebook text:** Violates the plan's explicit context-economics hard rule ("the orchestrator never reads full slices"). Every rulebook-reading step must be a subagent dispatch that returns a structured summary.
- **Single bulk "does this all look right?" confirmation for the whole rulebook:** CONTEXT.md explicitly rejects this — confirmation is per-section (batched slice-summary review), matching human working-memory limits on a 100+ page rulebook.
- **Detailing the entire sketch tail up front:** `SKETCH.template.md`'s own template comments mandate only the next 2-3 chunks be detailed; the tail is deliberately sketch-level and re-derived later at close gates.
- **Treating `npx boardsmith init` as accepting an in-place/no-name mode:** It always creates `<cwd>/<name>` and errors if it exists (`init.ts:18`) — the scaffold-step reference file must instruct the session to run `init` from the parent directory of where the project should live, using the derived kebab-case name.
- **Leaving a dev server running after the serve-verification check:** Repo-wide hard rule (CLAUDE.md, and independently the plan's "any server the skill starts is killed before returning"). The scaffold step must explicitly instruct: start `boardsmith dev --no-open`, confirm it's serving (e.g. curl the URL or check process output for the ready message), then kill the process before proceeding — never leave it running across the ingest session.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Project scaffolding (package.json, tsconfig, vite config, starter rules/elements/actions/flow/test files) | A custom file-generation step inside ingest-rules.md | `npx boardsmith init <name>` (`src/cli/commands/init.ts` + `src/cli/lib/project-scaffold.ts`) | Already generates a complete, compiling, tested starter project; re-implementing this in skill markdown would duplicate and drift from the CLI's own generator |
| Compile verification | A bespoke "read every .ts file and check types" prompt | `npx tsc --noEmit` (exact command the old skill already uses, instructions.md:2278/2998) | Already the project's own compile-check convention; consistent with `tsconfig.json`'s generated `strict: true` config |
| Serve verification | Parsing Vite/dev-server logs manually with ad-hoc heuristics | `npx boardsmith dev --no-open` (existing `--no-open` flag, `dev.ts:35`) then a request/port check, then kill | `--no-open` already exists specifically so an automated caller (like this skill) doesn't need a browser to pop up; avoid reinventing a "quiet mode" |
| Naming derivation (display/project/class name from user's game name) | A new slugification/PascalCase algorithm | Extract old skill's Phase 1B rules verbatim (instructions.md:90-120: lowercase, hyphenate, strip leading/trailing hyphens, PascalCase for class names) plus the CLI's own `toPascalCase`/`toDisplayName` helpers (`project-scaffold.ts`) | The CLI already has canonical name-derivation helpers used by `init.ts` itself (`toPascalCase(name)` at init.ts:48); the old skill's naming *rules* text describes the same algorithm for a human-facing narration, so extraction + a pointer to reuse the CLI helpers avoids two divergent implementations |
| Structured interview flow (no-rulebook path) | A new question sequence from scratch | Extract old skill Phase 2 verbatim (instructions.md:121-223) into `bs/ingest/interview-fallback.md`, adapting citations to read "designer statement, ingest session" instead of page numbers | This is explicitly the CONTEXT.md-locked and plan-mandated reuse path — "reusing the old skill's Phase 2 question sequence" |

**Key insight:** Nearly every "don't hand-roll" item in this phase is "don't re-derive something the old skill or the existing CLI already does correctly" — the entire phase is an extraction-and-recombination exercise, not new mechanism design. The one genuinely new mechanism is the INDEX.md cross-reference synthesis and the sketch-derivation heuristic, neither of which has a prior-art source in this codebase (both are net-new to the bs- skill family).

## Old-Skill Extraction Map

Verbatim line-range provenance in `src/cli/slash-command/instructions.md` (3,072 lines total), confirmed by direct read:

| Old-skill section | Lines | Becomes | Adaptation needed |
|---|---|---|---|
| Required Reading (doc-reading lists by game type) | 15-35 | Referenced by `bs/ingest/scaffold.md` (pointer, not full copy) | None — same docs still exist (`docs/core-concepts.md`, `docs/common-pitfalls.md`, `docs/dice-and-scoring.md`, `docs/custom-ui-guide.md`, `docs/ui-components.md`, `docs/actions-and-flow.md`, all confirmed present in `docs/`) |
| Phase 1: State Detection (PROJECT.md-in-cwd check, subfolder search, ask-before-assuming) | 39-89 | `bs/ingest-rules.md`'s own state-detection step (adapted: also check for `SKETCH.md` — a bs- project — for INGEST-07 re-run guard, and check for `PROJECT.md`+`STATE.md`+`HISTORY.md` — an old design-game project — for the migration offer) | Extend detection to a THIRD case (existing bs- project) beyond the old skill's two (fresh vs. old design-game project) |
| Phase 1B: Game Name (naming rules: lowercase, hyphenate, PascalCase) | 90-120 | `bs/ingest/scaffold.md` | Directory-choice logic ("if empty use cwd, else create new dir") should be REMOVED, not extracted — `boardsmith init <name>` always creates a new subdirectory regardless (see Scaffold Step section below); only the *name-derivation* rules (lowercase/hyphenate/PascalCase) are still correct and reusable |
| Phase 2: Structured Interview (6 questions: vision, components, turn structure, round completion, game end, summary+confirm) | 121-223 | `bs/ingest/interview-fallback.md` | Citations changed from implicit "designer said X" to explicit `"designer statement, ingest session"` per plan; output must additionally produce `rulebook/` files (the old skill only produced PROJECT.md prose — INGEST-03 requires the SAME `rulebook/` files the transcription path produces, so the interview must be re-targeted to write `rulebook/NN-topic.md` + `INDEX.md`, not just fill interview-summary prose) |
| Phase 2B: Aspect Detection (keyword table: Dice/PlayingCards/HexGrid/SquareGrid) | 224-260 | Referenced from `bs/ingest/interview-fallback.md` and reusable for rulebook-path component inventory too | `aspects/index.md` already holds this exact table as a standalone reference file — point to it rather than re-copying |
| Phase 4: Create Artifacts — PROJECT.md/STATE.md/PLAN.md templates | 312-411 | NOT extracted into the bs- skill (superseded by SKETCH.md/CHUNK.md per Phase 141); referenced ONLY by the migration-detection logic, which needs to recognize this exact shape to detect an old project | Read-only reference for migration detection — the ingest skill parses these old files' *sections* (Identity/Core Mechanics/Detected Aspects/Deferred Ideas) to map into new sketch chunks, never writes this format itself |
| Phase 5 Step 1: `npx boardsmith init <project-name>` | 431-437 | `bs/ingest/scaffold.md` | Same command, same semantics — confirmed still current against `cli.ts:25`/`init.ts` |
| Phase 6: Verify Functionality (`tsc --noEmit`, then `boardsmith dev`, checklist) | 2271-2313 | `bs/ingest/scaffold.md` | Extend: old skill's dev-server check was a manual "open browser" step; ingest's automated verification should use `--no-open` and explicitly kill the process (repo hard rule) instead of leaving it for a human to eyeball |
| Phase 9: Gather Playtest Feedback — triage categories | 2389+ | NOT this phase's concern — this is `/bs-build-chunk`'s `revise` step (BUILD-10, Phase 146) | No extraction needed here; noted only so the researcher for Phase 146 knows where to look |

## Runtime State Inventory

Not applicable in the "rename/refactor" sense (this phase authors new files, it does not rename or migrate BoardSmith's own runtime state). However, INGEST-07's migration-detection requirement has an analogous shape worth stating explicitly:

| Category | Question | Finding |
|----------|----------|---------|
| Old-project on-disk artifacts | What files does an old `/design-game` project leave that the new skill must recognize? | `PROJECT.md` (Identity/Core Mechanics/Detected Aspects/Deferred Ideas sections, instructions.md:316-357), `STATE.md` (Current Phase/Progress checklist/Last Action/Next Steps, instructions.md:359-382), `HISTORY.md` (append-only phase log, instructions.md:2840-2887, "3-5 bullets per phase") — all three are plain files directly in the game project root, detectable via `ls PROJECT.md` per the old skill's own Check 1 pattern |
| bs- project on-disk artifacts (re-run guard) | What marks an existing bs- project so re-running ingest is detected as destructive? | `SKETCH.md` presence (created by a prior ingest run) is the signal; INGEST-07 requires "explicit confirmation" before re-running, since re-ingest is destructive to sketch state |
| Nothing else to migrate | Are there databases, external services, or OS-registered state for a design-game project? | None — `/design-game` projects are pure git-tracked markdown + generated TS/Vue source; there is no external datastore, service config, or OS registration to account for |

**Migration mapping (from plan §"Old-skill migration"):** "interview data and Deferred Ideas become sketch chunks; completed features are marked verified with a note that they were verified under the old process." Concretely: `PROJECT.md`'s Core Mechanics/Components sections seed the rulebook-equivalent slices (citations become "migrated from old design-game PROJECT.md"); `PROJECT.md`'s Deferred Ideas section becomes `SKETCH.md`'s Ideas Backlog seed; `HISTORY.md`'s phase log entries that describe completed, working features become already-`verified` chunks in the new SKETCH.md (with a CHUNK.md note: "migrated — verified under /design-game process, not re-audited").

## Common Pitfalls

### Pitfall 1: Assuming `boardsmith init` supports in-place scaffolding
**What goes wrong:** Skill instructions tell the session to `cd` into an existing directory and run `init` there, expecting it to scaffold the current directory.
**Why it happens:** The old skill's Phase 1B directory logic ("if empty, use current directory") creates the false impression that `init` itself is directory-aware.
**How to avoid:** State explicitly in `bs/ingest/scaffold.md`: `init <name>` always creates `<cwd>/<name>` and errors (`Error: Directory "<name>" already exists`) if that path exists. Run it from the parent of where the project should live.
**Warning signs:** A drafted skill instruction that says "run `boardsmith init` in the current directory" without a `<name>` argument, or that doesn't handle the pre-existing-directory error path.

### Pitfall 2: Orchestrator reading the whole rulebook to "double check" the subagents
**What goes wrong:** A well-meaning instruction like "review all the slice files for consistency before writing INDEX.md" causes the orchestrator to read every `rulebook/NN-topic.md` file it just had subagents write, defeating the whole context-economics design.
**Why it happens:** Feels like a natural "sanity check" step, but silently reintroduces the exact context-exhaustion failure mode the plan is designed to avoid.
**How to avoid:** INDEX.md is built exclusively from the `citedTerms[]` lists subagents return in their structured summaries — never from re-reading the slice files. State this as a hard constraint in `ingest-rules.md` itself, not just in the transcription reference file.
**Warning signs:** Any instruction phrase like "review the slices" or "read back the transcription" outside the per-section user-confirmation step (which is a *user*-facing confirmation, not an orchestrator re-read).

### Pitfall 3: Leaving a dev server running after the scaffold verification check
**What goes wrong:** `boardsmith dev` starts a long-running WS server; if the skill instructions don't explicitly say "kill it," the Claude session may consider its job done and leave the process running.
**Why it happens:** The check is "does it serve?" — the natural-feeling verification is "start it, see it's up, move on," with killing feeling like an afterthought.
**How to avoid:** `bs/ingest/scaffold.md` must make "kill the process" an explicit, numbered step in the same sequence as "start it" and "verify it's serving" — not a footnote. This is both a repo-wide CLAUDE.md hard rule and the plan's own explicit requirement ("any server the skill starts is killed before returning").
**Warning signs:** A scaffold-step reference file that describes starting the server and checking output but has no corresponding kill instruction in the same numbered sequence.

### Pitfall 4: Producing an interview-fallback output that isn't the same shape as the transcription output
**What goes wrong:** The interview fallback (adapted from old Phase 2) produces PROJECT.md-style prose (matching the old skill's own Phase 4 template) instead of `rulebook/NN-topic.md` + `INDEX.md` files.
**Why it happens:** The old skill's Phase 2 was designed to feed directly into its own Phase 4 PROJECT.md template — that's the path of least resistance when extracting the question sequence.
**How to avoid:** INGEST-03 explicitly requires "the SAME `rulebook/` files" as the written-rulebook path. The interview-fallback reference file must re-target the interview's *output format*, not just reuse its *questions* — each answer becomes a cited slice (citation = "designer statement, ingest session, Q{n}") written to `rulebook/NN-topic.md`, with terms fed into INDEX.md exactly like the transcription path.
**Warning signs:** A drafted `interview-fallback.md` whose "Outputs" section names PROJECT.md fields instead of `rulebook/` file paths.

### Pitfall 5: SKETCH.md tail entries created with directories that don't exist yet
**What goes wrong:** Ingest details every chunk (not just the next 2-3) and/or creates `chunks/<slug>/` directories for tail entries, contradicting `SKETCH.template.md`'s own comment ("ingest does not create stubs for the tail") and `state-machine.md`'s consistency-check exemption for tail entries.
**Why it happens:** Feels more "complete" to sketch the whole game up front; the lazy-tail design is a deliberate anti-completeness constraint that's easy to over-deliver past.
**How to avoid:** `bs/ingest/sketch-derivation.md` must state the 2-3-chunk-detail limit as a hard cap, matching `SKETCH.template.md`'s exact tail-entry status-line grammar (`Status: proposed (sketch-level — no CHUNK.md yet)`) for everything beyond that.
**Warning signs:** A drafted sketch-derivation instruction without an explicit "stop detailing after chunk N+2/N+3" cutoff.

## Code Examples

### Scaffold step — exact CLI commands the skill markdown should instruct

```bash
# Source: src/cli/commands/init.ts (cli.ts:25 `.command('init <name>')`), verified by direct read
npx boardsmith init <project-name>   # ALWAYS creates ./<project-name>/ ; errors if it exists

# Source: instructions.md:2278/2998 (old skill's own compile-check convention, still current —
# tsconfig.json generated by project-scaffold.ts has strict: true)
cd <project-name> && npx tsc --noEmit

# Source: src/cli/commands/dev.ts:35 (--no-open flag), :788 (its exact console message),
# repo CLAUDE.md hard rule + bs-skills-plan.md "any server the skill starts is killed before
# returning"
npx boardsmith dev --no-open &   # start, capture PID
# ... verify it's serving (e.g. curl the resolved URL, or watch for the ready-state log line) ...
kill %1                          # or the captured PID — MUST happen before the skill returns
```

### INDEX.md term-table shape (Claude's discretion per CONTEXT.md, proposed format)

```markdown
<!-- rulebook/INDEX.md — built by the orchestrator from subagent-returned citedTerms[] lists.
     The orchestrator never re-reads the slice files themselves to build this table. -->

| Term | Slices |
|------|--------|
| jail | 03-movement.md, 07-chance-cards.md |
| rent | 04-properties.md |
```

### SKETCH.md UI Strategy field — already exists, ingest only fills it

```markdown
<!-- Source: src/cli/slash-command/bs/templates/SKETCH.template.md (Phase 141 output, read
     verbatim above) -->
## UI Strategy
Strategy: custom-from-chunk-1
Cutover chunk (if autoui-with-cutover): n/a
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `/design-game`: one 3,072-line monolithic skill file, single interview, whole-game generation in one pass | `bs-` family: `/bs-ingest-rules` (this phase) does chunked ingestion only; `/bs-build-chunk` grows the game in small vetted increments | This milestone (v4.6), designed 2026-07-04 in `bs-skills-plan.md` | Ingest's scope is deliberately narrow — it produces a *plan* (SKETCH.md) and a *scaffold*, not a finished game; all rules implementation moves to `/bs-build-chunk` |
| Old skill's manual "open browser and eyeball it" dev-server check (Phase 6 Step 2) | Automated `--no-open` + explicit serve-check + explicit kill | This phase | Makes scaffold verification a scriptable gate rather than a human-observation step, consistent with ingest's non-interactive verification requirement (INGEST-04) |
| Old skill's Phase 1B "if directory empty, use cwd; else create new dir" | `boardsmith init <name>` always creates a new named subdirectory (unchanged CLI behavior, but the *skill's* prior narration around it was misleading) | Confirmed current (`init.ts`/`cli.ts`), not something this phase changes — only the skill's own description of it | Ingest's scaffold reference file must describe the CLI's real behavior, not carry forward the old skill's inaccurate framing |

**Deprecated/outdated:** `/design-game`'s whole-rulebook-in-one-pass approach is the explicit failure mode this milestone replaces (`bs-skills-plan.md` "Problem" section) — not deprecated by version, but by design; Phase 148 removes `instructions.md` from the installer once all five bs- skills exist.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The scaffold-step's serve-verification should use `curl`/HTTP-check against the resolved dev-server URL rather than parsing console log text, since `--no-open` suppresses the browser-open message but the server still logs a ready-state line (dev.ts:766 `uiPort` resolution logic was read, but the exact ready-state log string was not read/quoted here) | Scaffold Step / Common Pitfalls | If the exact log string differs from what a plan assumes, the "verify it's serving" instruction may need a concrete grep pattern — planner/executor should re-check `dev.ts`'s console output around line 766-790 before finalizing the exact verification command |
| A2 | An automated serve-check + kill is feasible within a single Claude Code tool-call sequence (background process start, health check, kill) without leaving a lingering process across a context handoff | Scaffold Step | If the harness's background-process handling makes an unattended start/check/kill sequence unreliable, the scaffold step may need a more conservative "compile-only" verification with serve-check deferred to the human's own first `boardsmith dev` at the end of ingest — this would be a real scope adjustment for the plan, not just a wording change |

**If this table is empty:** N/A — two assumptions are logged above; both are implementation-detail risks the plan should resolve via direct testing during Task execution (running `npx boardsmith dev --no-open` once and reading its actual stdout), not left unresolved.

## Open Questions (RESOLVED — dev ready-string confirmed in PATTERNS.md via dev.ts grep; RULINGS/DECISIONS templates impose no citation parse contract)

1. **Exact ready-state log line from `npx boardsmith dev --no-open`**
   - What we know: `--no-open` exists and suppresses auto-open (dev.ts:35, :788); the server resolves a URL/port (dev.ts:766).
   - What's unclear: The literal stdout string a script should grep/wait-for to confirm "now serving" before attempting a health-check request (not read in this research pass — dev.ts is 900+ lines and only the flag/port logic was sampled).
   - Recommendation: During planning/execution, run `npx boardsmith dev --no-open` once in a scratch game project and capture its actual stdout to pin the exact wait-condition string in `bs/ingest/scaffold.md`.

2. **Where exactly does the interview-fallback's rulebook/ output get its citation format validated?**
   - What we know: Citations should read "designer statement, ingest session" per the plan text (quoted verbatim in bs-skills-plan.md ¶"Input modes").
   - What's unclear: Whether `RULINGS.template.md`/other templates' citation-format parse contracts (if any) constrain the exact string shape ingest must produce — the templates read in this research pass (CHUNK/ASSETS/DESIGN/SKETCH) don't parse-validate rulebook citation *strings* themselves, only Status-line grammar, so this is likely a non-issue, but should be double-checked against `RULINGS.template.md` and `DECISIONS.template.md` (not read in full during this research pass) before finalizing the interview-fallback reference file.
   - Recommendation: Planner should have the executor briefly grep `RULINGS.template.md`/`DECISIONS.template.md` for any citation-format parse contract before finalizing citation wording.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x (already a devDependency; see `bs/templates.test.ts` precedent) |
| Config file | Repo root `vitest.config.ts` (existing, unmodified by this phase) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` (new file) or the extended `templates.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INGEST-01 | `ingest-rules.md` references the transcription reference file and its per-section confirmation protocol | structural content-assertion | `npx vitest run -t "INGEST-01"` | ❌ Wave 0 — create `bs/ingest.test.ts` |
| INGEST-02 | Orchestrator/synthesis section names all six sub-artifacts (INDEX.md, variant/edition tagging, component inventory + aspect ratios, ASSETS.md, visual identity survey, player counts) | structural content-assertion | `npx vitest run -t "INGEST-02"` | ❌ Wave 0 |
| INGEST-03 | `interview-fallback.md` exists, is referenced, and its stated Outputs are `rulebook/` files (not PROJECT.md prose) | structural content-assertion | `npx vitest run -t "INGEST-03"` | ❌ Wave 0 |
| INGEST-04 | `scaffold.md` names `npx boardsmith init`, `tsc --noEmit`, and an explicit kill instruction after the serve check | structural content-assertion | `npx vitest run -t "INGEST-04"` | ❌ Wave 0 |
| INGEST-05 | Sketch-derivation reference cites SKETCH.template.md's "Mandated Chunks" verbatim requirement (core event loop first, game-end + final-acceptance chunks, `ui:` tag, outcome-based scripts, 2-3-chunk detail cap) | structural content-assertion | `npx vitest run -t "INGEST-05"` | ❌ Wave 0 |
| INGEST-06 | Orchestrator's UI-strategy step references `SKETCH.template.md`'s "## UI Strategy" section by name, not a re-invented field | structural content-assertion | `npx vitest run -t "INGEST-06"` | ❌ Wave 0 |
| INGEST-07 | State-detection step names both re-run-guard (existing `SKETCH.md`) and old-project migration (existing `PROJECT.md`/`STATE.md`/`HISTORY.md`) cases | structural content-assertion | `npx vitest run -t "INGEST-07"` | ❌ Wave 0 |
| (cross-file) | Every file path `ingest-rules.md` references (templates, state-machine.md, ingest/*.md) exists on disk | structural content-assertion | `npx vitest run -t "consistency"` | ❌ Wave 0 |

All tests in this phase are structural/content-assertion only, per CONTEXT.md's locked "Verification for This Phase" decision — behavioral proof of an actual ingest run is explicitly deferred to Phase 149.

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/ingest.test.ts` (or extended `templates.test.ts`)
- **Per wave merge:** `npx vitest run` (full suite, confirms no regression to Phase 141's 44 tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/slash-command/bs/ingest.test.ts` (or extend `templates.test.ts`) — covers INGEST-01..07 + cross-file consistency
- [ ] No new fixtures/conftest needed — same `readFileSync`/`__dirname` pattern as `templates.test.ts`, zero new infrastructure

## Security Domain

Not applicable — this phase authors static markdown instructions consumed by a Claude Code session, not application code with a network/auth surface. No ASVS categories apply; the closest analog (untrusted PDF/image input during transcription) is a content-interpretation concern for the Claude session at *runtime* (Phase 149's dry-run), not a code-level attack surface introduced by this phase's deliverables.

## Sources

### Primary (HIGH confidence — direct file reads in this repo)
- `.planning/bs-skills-plan.md` — canonical design contract, read in full
- `.planning/phases/142-bs-ingest-rules/142-CONTEXT.md` — locked decisions, read in full
- `.planning/REQUIREMENTS.md` — INGEST-01..07 exact text, read in full
- `src/cli/slash-command/bs/state-machine.md` — read in full
- `src/cli/slash-command/bs/templates/SKETCH.template.md`, `ASSETS.template.md`, `CHUNK.template.md`, `DESIGN.template.md` — read in full
- `src/cli/slash-command/bs/templates.test.ts` (header/pattern portion) — read
- `src/cli/slash-command/instructions.md` — read in full (all 3,072 lines, across multiple offsets)
- `src/cli/slash-command/aspects/index.md` — read in full
- `src/cli/commands/init.ts` — read in full
- `src/cli/lib/project-scaffold.ts` (package.json/tsconfig/scripts generation portions) — read
- `src/cli/commands/dev.ts` (grep for `--no-open`, port resolution) — sampled, not read in full (see Open Question 1)
- `src/cli/cli.ts` (command registration) — grepped
- `.planning/STATE.md`, `.planning/config.json` — read in full
- `.planning/phases/141-file-templates-state-machine-authority/141-01-SUMMARY.md` — read (precedent confirmation for test-file pattern and naming convention)

### Secondary (MEDIUM confidence)
None — no external web research was needed for this phase; every claim traces to a direct file read in this repository.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Old-skill extraction map: HIGH — direct line-range reads of instructions.md
- Scaffold/CLI behavior: HIGH for `init`/`tsc` (fully read); MEDIUM for the exact `dev --no-open` ready-state log string (sampled, not fully read — flagged as Open Question 1)
- Ingest output artifacts / sketch derivation shape: HIGH — directly matches `SKETCH.template.md`/`ASSETS.template.md`'s existing parse contracts (Phase 141 already built these; ingest's job is to fill them correctly)
- Validation architecture: HIGH — mirrors the exact, already-proven `bs/templates.test.ts` pattern

**Research date:** 2026-07-04
**Valid until:** Stable — no external dependencies with a decay clock; re-validate only if `src/cli/commands/init.ts`, `dev.ts`, or the Phase 141 templates change before planning executes.
