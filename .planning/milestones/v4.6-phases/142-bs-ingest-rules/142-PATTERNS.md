# Phase 142: `/bs-ingest-rules` - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 6 (1 orchestrator skill, 4 step-scoped reference files, 1 test file)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/slash-command/bs/ingest-rules.md` | orchestrator (agent-prompt markdown) | event-driven (state-detection → route → synthesize → write) | `src/cli/slash-command/instructions.md` (Phases 1/1B/6 — state detection, naming, verify) + `src/cli/slash-command/bs/state-machine.md` (citation-not-restatement style) | role-match (same command family, but instructions.md is the anti-pattern for size/self-containment — extract narrowly, cite the rest) |
| `src/cli/slash-command/bs/ingest/transcription.md` | reference (subagent-prompt spec) | fan-out / batch | *no direct in-repo analog* — closest shape is the "Pattern 1: Orchestrator-delegates-to-subagents" description in RESEARCH.md itself, modeled on GSD's researcher/planner subagent convention (not present as a file in this repo checkout) | no analog — author from RESEARCH.md Pattern 1 + CONTEXT.md decisions |
| `src/cli/slash-command/bs/ingest/interview-fallback.md` | reference (extracted Q&A script) | request-response (one question at a time) | `src/cli/slash-command/instructions.md` lines 121–223 (Phase 2: Structured Interview) + lines 224–260 (Phase 2B: Aspect Detection, itself pointing at `aspects/index.md`) | exact (verbatim extraction source, output format re-targeted) |
| `src/cli/slash-command/bs/ingest/sketch-derivation.md` | reference (derivation/authoring rules) | transform (rulebook summaries → SKETCH.md entries) | `src/cli/slash-command/bs/templates/SKETCH.template.md` ("Mandated Chunks", "Ordered Chunk List" comments) — the template already encodes the exact target shape | exact (template defines the contract this file must honor, not restate) |
| `src/cli/slash-command/bs/ingest/scaffold.md` | reference (CLI-invocation steps) | request-response (init → compile-check → serve-check → kill) | `src/cli/slash-command/instructions.md` lines 90–120 (Phase 1B naming) + lines 2271–2313 (Phase 6 verify) + `src/cli/commands/init.ts` / `src/cli/commands/dev.ts` (actual CLI behavior) | exact (verbatim extraction + CLI ground-truth correction) |
| `src/cli/slash-command/bs/ingest.test.ts` | test (structural content-assertion) | transform (readFileSync → string assertions) | `src/cli/slash-command/bs/templates.test.ts` (44 tests, Phase 141) | exact (direct analog — same test style, same `__dirname`/`read()` helper, same "byte-identical marker" and "PARSE CONTRACT" patterns) |

## Pattern Assignments

### `src/cli/slash-command/bs/ingest-rules.md` (orchestrator)

**Analogs:** `bs/state-machine.md` (citation style) + `instructions.md` Phases 1/1B/6 (content to extract narrowly, NOT the file's overall structure — its 3,072-line self-containment is the anti-pattern this phase replaces)

**Citation-not-restatement pattern** (from `bs/state-machine.md` lines 1-3):
```markdown
Every `bs-` skill (`bs-ingest-rules`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`,
`bs-generate-ai`) cites this file rather than restating its rules. If you are authoring or
extending a `bs-` skill, link to the relevant section below instead of copying rule text.
```
Apply this exact convention in `ingest-rules.md`: cite `state-machine.md` for the consistency check, session lock, and status enum; cite `SKETCH.template.md`/`ASSETS.template.md` for artifact shape; never restate their content inline. This is the load-bearing anti-pattern-avoidance for this phase (instructions.md ballooned to 3,072 lines by doing the opposite).

**State-detection pattern to adapt, not copy verbatim** (`instructions.md` lines 39–89, "Phase 1: State Detection"):
```markdown
### Check 1: Is the current directory itself a game project?

Check if `PROJECT.md` exists **directly in the current directory** (use `ls PROJECT.md`, NOT
glob patterns like `**/PROJECT.md` which search subfolders).
```
Adapt: extend to a THIRD case beyond the old skill's two (fresh vs. old design-game project) — also check for `SKETCH.md` (existing bs- project → INGEST-07 re-run guard). Same `ls <file>` direct-check technique (not glob), same "ask, don't assume" tone.

**Consistency-check entry pattern** (`bs/state-machine.md` lines 75-92, "Consistency Check"):
```markdown
Every `bs-` skill, on entry, runs a consistency check before doing any other work:
1. Every sketch slug with a detailed SKETCH.md entry ... has a corresponding `chunks/<slug>/` directory ...
...
Any problems found are reported to the user, who confirms how to proceed, before the skill continues.
```
`ingest-rules.md` should cite this exact section (not reimplement it) for its own entry-point consistency check, layering INGEST-07's re-run/migration detection on top.

**Context-economics hard rule (must appear in the orchestrator itself, not just in `ingest/transcription.md`)** — per RESEARCH.md Common Pitfalls #2, state as a hard constraint directly in `ingest-rules.md`: the orchestrator never re-reads rulebook slice files it just had subagents write; INDEX.md is built exclusively from subagent-returned `citedTerms[]`.

---

### `src/cli/slash-command/bs/ingest/interview-fallback.md` (reference, request-response)

**Analog:** `src/cli/slash-command/instructions.md` lines 121–260

**Verbatim question-sequence pattern to extract** (lines 125–129, repeat shape for Q2–Q6):
```markdown
### Question 1: Open Vision

Start with an open question to capture the designer's vision:

> "Tell me about [Game Name] in a sentence or two! What's the theme and what do players do?"
```
Same one-question-at-a-time, blockquoted-prompt, "Listen for:" bullet-list shape carries over for all 6 questions (vision, components, turn structure, round completion, game end, summary+confirm) and the Clarification Protocol (lines 210–220).

**Aspect-detection pointer pattern** (lines 224–260, esp. line 230-236 table + line 260's "Store detected aspects... use them in code generation"):
```markdown
| Aspect | Keywords | Contributes |
|--------|----------|-------------|
| **Dice** | dice, roll, rolling, d4, d6, d8, d10, d12, d20 | Die3D, DicePool, roll action |
```
Do not re-copy this table — `src/cli/slash-command/aspects/index.md` already holds the canonical, standalone version (confirmed identical keyword set). `interview-fallback.md` should point at `aspects/index.md` exactly the way `bs/ingest-rules.md` points at `state-machine.md` — cite, don't restate.

**Required re-target (the one real adaptation, per RESEARCH.md Pitfall 4):** the old Phase 2's output was PROJECT.md prose feeding the old skill's own Phase 4 template. INGEST-03 requires the SAME `rulebook/NN-topic.md` + `INDEX.md` shape as the transcription path. Each answer becomes a cited slice with citation format `"designer statement, ingest session, Q{n}"` (per plan text quoted in RESEARCH.md), written to `rulebook/NN-topic.md`, with terms fed into INDEX.md exactly like the transcription path's `citedTerms[]`.

---

### `src/cli/slash-command/bs/ingest/scaffold.md` (reference, request-response)

**Analogs:** `instructions.md` lines 90–120 (naming) + lines 2271–2313 (verify) + ground-truth CLI behavior

**Naming-rules pattern to extract verbatim** (lines 96–106):
```markdown
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
```
Extract this verbatim. Do NOT extract the surrounding directory-choice logic (lines 108–117, "if empty use cwd, else create new dir") — per CONTEXT.md and RESEARCH.md's confirmed finding, `boardsmith init <name>` always creates a new subdirectory and errors if it exists (`src/cli/commands/init.ts:18` `existsSync(projectPath)`); this old directory-choice narration is the anti-pattern to explicitly correct (RESEARCH.md Pitfall 1).

**Compile-check pattern to extract verbatim** (lines 2275–2290):
```markdown
### Step 1: Compilation Check
\`\`\`bash
npx tsc --noEmit
\`\`\`
**If errors occur:**
1. Read the error message carefully
2. Fix the specific issue
3. Run tsc again
4. Repeat until clean
```

**Serve-check pattern to REPLACE, not extract** (lines 2293–2302, old "open a browser and eyeball it"):
```markdown
Run `npx boardsmith dev` and open the game in a browser. Verify:
- [ ] Game starts without console errors
```
Replace with the automated, killable sequence. Confirmed exact ready-state log line from `src/cli/commands/dev.ts` (grepped, line ~791):
```typescript
console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));
```
and the `--no-open` quiet-mode confirmation line (`dev.ts` line ~788):
```typescript
console.log(chalk.dim('  Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.'));
```
`scaffold.md` should instruct the session to run `npx boardsmith dev --no-open`, wait for the `Ready! Press Ctrl+C to stop.` line (or a resolved-URL curl check), then explicitly kill the process — this resolves RESEARCH.md's Open Question 1 with a concrete grep target and closes Pitfall 3 (never leave a dev server running; repo-wide CLAUDE.md hard rule).

**Exact CLI commands to cite** (RESEARCH.md "Code Examples" section, already verified against source):
```bash
npx boardsmith init <project-name>   # ALWAYS creates ./<project-name>/ ; errors if it exists
cd <project-name> && npx tsc --noEmit
npx boardsmith dev --no-open &       # start, capture PID
kill %1                              # or the captured PID — MUST happen before the skill returns
```

---

### `src/cli/slash-command/bs/ingest/sketch-derivation.md` (reference, transform)

**Analog:** `src/cli/slash-command/bs/templates/SKETCH.template.md` (Phase 141 output — the template defines the contract; this file must honor it, never restate its structure inline, per the same locked "consumed as logical reference" rule as `state-machine.md`)

**Mandated-chunks contract to cite, not restate** (`SKETCH.template.md` lines 93–100):
```markdown
## Mandated Chunks
- The first chunk in the Ordered Chunk List above is always the core event loop.
- The sketch must contain a game-end / scoring / winner-determination chunk.
- The sketch must contain a final-acceptance chunk: the full game played start-to-finish, a
  coverage check confirming every non-variant rulebook slice was built, plus the design-QA/a11y
  audit (gated by any chunk tagged `ui: touches` or `ui: major`).
```

**Status-line grammar to cite exactly** (`SKETCH.template.md` lines 55-59, 65-66, 76-79):
```markdown
- Detailed entry: "- Status (derived from chunks/<slug>/CHUNK.md): <enum-value>"
- Tail entry:     "- Status: proposed (sketch-level — no CHUNK.md yet)"
```
`sketch-derivation.md` must state the 2-3-chunk-detail hard cap (RESEARCH.md Pitfall 5) using this exact byte-identical marker string — `bs/ingest.test.ts` will assert on it verbatim (see below).

**`ui:` tag values to cite** (`SKETCH.template.md` line 64, confirmed by `templates.test.ts` line 174 regex `/none *\| *touches *\| *major/`):
```markdown
- ui: <!-- none | touches | major -->
```

---

### `src/cli/slash-command/bs/ingest/transcription.md` (reference, fan-out/batch)

**Analog:** No direct file in this repo. Closest concrete shape is RESEARCH.md's own "Pattern 1: Orchestrator-delegates-to-subagents" (itself modeled on the GSD researcher/planner subagent convention, referenced but not present as a checked-in file in this repo). Author from first principles using this shape, cross-checked against CONTEXT.md's locked mechanics.

**Subagent dispatch/return shape (author from this, RESEARCH.md lines 212-232):**
```
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
    page range (batched slice-summary review, not per-page, not one bulk gate)
```
This is the file that must most explicitly restate the context-economics hard rule (orchestrator never reads full slices) since it's the step where the temptation to "double-check by reading the slice" is strongest (RESEARCH.md Pitfall 2).

---

### `src/cli/slash-command/bs/ingest.test.ts` (test, structural content-assertion)

**Analog:** `src/cli/slash-command/bs/templates.test.ts` (Phase 141, 44 tests) — read in full; this is the direct, load-bearing analog for the entire file.

**Setup/helper pattern to copy exactly** (lines 18-28):
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}
```
Reuse verbatim (same `__dirname`/`read()` pair) if `ingest.test.ts` lives alongside `templates.test.ts` in `src/cli/slash-command/bs/`. If extending `templates.test.ts` instead (CONTEXT.md leaves file placement to executor discretion), these helpers already exist — do not redeclare.

**Byte-identical marker constant pattern to copy** (lines 43-60):
```typescript
const STALE_MARKER = 'stale — re-derive before build';
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';
const DERIVED_POINTER_GRAMMAR = 'Status (derived from chunks/<slug>/CHUNK.md):';
```
Apply the same technique to `ingest.test.ts`: pin any marker/grammar string that must stay byte-identical across `ingest-rules.md`/`ingest/*.md` and `state-machine.md`/`SKETCH.template.md` as a named constant with an explanatory comment, then assert both sides against the same constant (guards drift exactly like `templates.test.ts` does for the em-dash stale marker).

**"exists on disk" cross-file consistency pattern to copy** (existing precedent: `templates.test.ts` line 245-250's "all six template files exist and read non-empty" loop; extend with `existsSync`):
```typescript
it('all six template files exist and read non-empty', () => {
  for (const path of allTemplateFiles) {
    const content = read(path);
    expect(content.length).toBeGreaterThan(0);
  }
});
```
For `ingest.test.ts`'s "no dangling pointers" requirement (CONTEXT.md), add `existsSync` (already imported the same way in RESEARCH.md's proposed example) alongside this non-empty check, iterating over every file path `ingest-rules.md` references: `ingest/transcription.md`, `ingest/interview-fallback.md`, `ingest/sketch-derivation.md`, `ingest/scaffold.md`, `state-machine.md`, `templates/SKETCH.template.md`, etc.

**Per-requirement `describe` block pattern to copy** (structure used throughout, e.g. lines 83-98, 140-180): one `describe('TMPL-XX — ...')` per rule cluster, with the analog content loaded once at the top of the block via `const stateMachine = read(...)`. Mirror this exactly for `describe('INGEST-01 — ...')` through `describe('INGEST-07 — ...')`.

## Shared Patterns

### Citation-not-restatement (cross-cutting, applies to `ingest-rules.md` and all 4 `ingest/*.md` files)
**Source:** `src/cli/slash-command/bs/state-machine.md` line 3 ("link to the relevant section below instead of copying rule text") + Phase 141 locked decision on templates.
**Apply to:** Every new file that would otherwise need to explain the status enum, step names, consistency check, session lock, or template structure — always a citation/pointer, never inline restatement. This is the single biggest anti-pattern-avoidance mechanism preventing recurrence of the 3,072-line `instructions.md` monolith.

### Context-economics hard rule (orchestrator never reads full source material)
**Source:** RESEARCH.md "Pattern 1" + "Common Pitfalls #2"; must be explicit in both `ingest-rules.md` and `ingest/transcription.md`.
**Apply to:** `ingest-rules.md` (top-level constraint statement) and `ingest/transcription.md` (the step where the temptation to violate it is strongest).
```
INDEX.md is built exclusively from the citedTerms[] lists subagents return in their structured
summaries — never from re-reading the slice files. State this as a hard constraint in
ingest-rules.md itself, not just in the transcription reference file.
```

### Server-kill discipline (repo-wide hard rule)
**Source:** `/Users/jtsmith/BoardSmith/CLAUDE.md` ("Don't leave a dev server running that you start.") + `/Users/jtsmith/CLAUDE.md` ("Never leave processes running in the background that you start.") + plan text quoted in RESEARCH.md ("any server the skill starts is killed before returning").
**Apply to:** `ingest/scaffold.md` exclusively (the only step that starts a server) — make "kill the process" a numbered step in the same sequence as "start it"/"verify it's serving," never a footnote.

### Status/marker byte-identity testing technique
**Source:** `src/cli/slash-command/bs/templates.test.ts` (named-constant + `.not.toContain('...with wrong hyphen...')` guard pattern, lines 43-52, 133-137, 198-204).
**Apply to:** `ingest.test.ts` — any string ingest-rules.md/ingest/*.md quote from `state-machine.md` or `SKETCH.template.md` (status enum, em-dash markers, `Status (derived from...)` grammar) should be pinned as a shared constant and asserted identical on both sides, exactly as `templates.test.ts` already does between `state-machine.md` and the six templates.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/cli/slash-command/bs/ingest/transcription.md` | reference | fan-out/batch | No prior `bs-` skill or old-skill section performs multi-subagent fan-out with structured-summary returns; this mechanism is net-new to the codebase (RESEARCH.md's own "Key insight": INDEX.md synthesis and sketch-derivation heuristic have no prior-art source). Author from RESEARCH.md's Pattern 1 prompt-shape example plus the locked CONTEXT.md mechanics (batched per-section confirmation, never per-page/bulk). |

## Metadata

**Analog search scope:** `src/cli/slash-command/` (instructions.md, bs/state-machine.md, bs/templates/*.template.md, bs/templates.test.ts, aspects/index.md), `src/cli/commands/init.ts`, `src/cli/commands/dev.ts`
**Files scanned:** 9 (instructions.md full read at offsets 1-260 + 2260-2313; state-machine.md full; templates.test.ts full; SKETCH.template.md full; aspects/index.md full; dev.ts grepped for `--no-open`/ready-state log)
**Pattern extraction date:** 2026-07-04
