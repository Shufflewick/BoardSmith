# Phase 147: `/bs-check-status` & `/bs-insert-chunk` - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 4 (2 new skills, 1 new test, 1 edited existing skill)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli/slash-command/bs/check-status.md` | config (markdown agent-skill instructions, orchestrator) | request-response (read-only report synthesis) | `src/cli/slash-command/bs/ingest-rules.md` | exact (top-level thin-skill idiom) |
| `src/cli/slash-command/bs/insert-chunk.md` | config (markdown agent-skill instructions, orchestrator) | CRUD (read SKETCH/CHUNK, edit + write both) | `src/cli/slash-command/bs/ingest-rules.md` (structure) + `src/cli/slash-command/bs/build-chunk.md` (state-mutation/write-order idiom) | exact (structure) / role-match (mutation) |
| `src/cli/slash-command/bs/status-tools.test.ts` | test (vitest drift-protection) | transform (string/regex assertions over markdown content) | `src/cli/slash-command/bs/ingest.test.ts` (+ `templates.test.ts` constants, `build-chunk.test.ts` describe-per-req-id breadth) | exact |
| `src/cli/slash-command/bs/build-chunk.md` (edit lines ~63, ~65) | config (existing skill, 2 forward-reference sentences) | request-response (text substitution only) | itself — no external analog needed, this is a targeted 2-line edit | n/a (self-edit) |

## Pattern Assignments

### `src/cli/slash-command/bs/check-status.md` (config, request-response, read-only)

**Analog:** `src/cli/slash-command/bs/ingest-rules.md`

**Opening cite-not-restate preamble** (`ingest-rules.md` lines 1-8):
```markdown
# `/bs-ingest-rules` — Start the Project

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `state-machine.md` for all of that.
```
Adapt the second sentence for check-status: it is a lean **reader**, not a dispatcher — no subagents, orchestrator reads SKETCH.md/CHUNK.md/ASSETS.md directly (this is the sanctioned channel per build-chunk.md's Context-Economics Hard Rule below).

**Consistency-check-on-entry idiom to copy verbatim in spirit** (`build-chunk.md` lines 32-36, Step 0):
```markdown
## Step 0: Entry — Consistency Check + Session Lock

On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check"). Use literal `ls <file>` checks in the current directory, never
`**/glob` patterns that search subfolders.
```
check-status runs the Consistency Check only (no session-lock-resolution outcome-classification — that's build-chunk's write-path concern; check-status never takes the lock).

**Read-only orchestrator-reads-state-files sanction** (`build-chunk.md` lines 14-21, Context-Economics Hard Rule):
```markdown
**The orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself.**
Every fact this router needs about a chunk's rules or code content comes from the structured
return-shape a dispatched subagent hands back — never by re-reading a slice or source file a
subagent just wrote. State files are different: `CHUNK.md` is a state file, and reading state
files is exactly the orchestrator's job (alongside dispatching subagents, recording results, and
talking to the user).
```
check-status.md's own hard-rule paragraph should assert this is a NO-subagent skill entirely (stronger than build-chunk's — build-chunk still dispatches step subagents; check-status never does), citing the same "reading state files is exactly the orchestrator's job" sentence.

**"What's left?" self-answer this phase supersedes** (`build-chunk.md` lines 58-63, Step 1):
```markdown
- **"what's left?" / status questions** — answer self-contained from state files: read
  `SKETCH.md`'s ordered chunk list and, for the in-progress chunk, its `CHUNK.md` Status line
  and Step Checklist (all state files the orchestrator may read), then summarize what is
  verified, what is in progress (and at which step), and what remains. Never answer from memory
  or a partial read — read the state files first. Tell the user the fuller status view ships as
  `/bs-check-status` (Phase 147); until it lands, this summary IS the status behavior.
```
This is the exact seed content for check-status's item-1/item-2 report logic (chunks done/remaining derivation, current-chunk-and-step derivation) — reuse the identical "first chunk whose status is neither `verified` nor `verified (user-waived)`" resume-target rule (`build-chunk.md` line 41) and the identical "first incomplete step on the Step Checklist" rule (line 76) rather than inventing new derivation logic.

**"Next command" closing idiom** (`ingest-rules.md` line 189):
```markdown
End the session by printing the exact next command to run (`/bs-build-chunk`) and confirming
everything is saved in the game folder.
```
check-status's item 7 (exact next command) should close the same way, but the command is derived (see RESEARCH.md's source map row 7: `/bs-build-chunk` if mid-ceremony, `/bs-insert-chunk` if reshaping was just discussed, `/bs-ingest-rules` if nothing started).

**Reference Files + Installed-location footer** (`ingest-rules.md` lines 192-214):
```markdown
## Reference Files

This skill delegates its heavyweight, step-scoped prose to:
...
And to the shared reference files that ship with every `bs-` skill:

- `state-machine.md` — status enum, consistency check, session lock, write order, authority
- `templates/SKETCH.template.md` — the sketch skeleton this skill fills
- `templates/ASSETS.template.md` — the asset ledger skeleton this skill seeds

**Installed location:** every relative path above (the `ingest/` step files, `state-machine.md`,
and `templates/`) resolves against the directory containing THIS skill file — the installer
copies the whole `bs/` tree as one unit, so the shipped layout is identical wherever it is
installed. ... (Installer-phase dependency: `src/cli/commands/install-claude-command.ts` does
not yet install the `bs-` skills; the phase that teaches it to MUST preserve this
skill-file-relative layout — `ingest/`, `templates/`, and `state-machine.md` siblings of this
file — or update this paragraph.)
```
check-status.md has no step-scoped reference files to delegate to (it's a single-step reader) — its "Reference Files" section lists only `state-machine.md` + the three templates it reads (`SKETCH.template.md`, `CHUNK.template.md`, `ASSETS.template.md`), and the Installed-location paragraph should be copied near-verbatim (same installer-phase-dependency caveat, since Phase 148 wires installation).

**Exact state-machine.md sections to cite** (verified headings, `state-machine.md`):
- `## Consistency Check (every bs- entry point, before proceeding)` — lines 75-92
- `## Status Enum (exact)` — lines 5-21 (for the `verified (user-waived)` waived-status scan, item 4)
- `## Session Lock` — lines 102-112 (check-status may report lock state as read-only info)

---

### `src/cli/slash-command/bs/insert-chunk.md` (config, CRUD, editor)

**Analog:** `ingest-rules.md` for structure/preamble/footer; `build-chunk.md` for the write-order + stale-marker mutation idiom.

**Write-order rule to cite (never restate)** (`state-machine.md` lines 56-61, "Write Order"):
```markdown
- **Write order is always CHUNK.md first, then SKETCH.md second.** Never the reverse, and never SKETCH.md alone.
- Every write must leave the file valid for a cold resume:
  - Round entries (revise rounds, audit rounds) are **append-only** — never overwritten or renumbered.
  - The `Status:` line is updated **last**, after all other content for that write has landed.
```
insert-chunk's ops (c) stale-marking and (d) version bump must literally implement this: CHUNK.md's `Status:` line write happens before SKETCH.md's `Sketch Version:` line bump, and within each file's own write the `Status:`/version line lands last.

**Stale-marker byte-exact string** (`state-machine.md` lines 17-21):
```markdown
CHUNK-level stale marker (set by `/bs-insert-chunk` when an already-detailed pending CHUNK.md is invalidated by a sketch change):

`stale — re-derive before build`

(NOTE: the dash in `stale — re-derive before build` is an em-dash "—", not a hyphen.)
```
Copy this literal string (em-dash) into insert-chunk.md's op-(c) description — this is the exact string `status-tools.test.ts` must pin.

**Consumer-side behavior already shipped, to point back at** (`build-chunk.md` line 77):
```markdown
A chunk whose Status line reads `stale — re-derive before build` stops routing instead — see "Status Enum and Stale Marker" below.
```
insert-chunk.md should cross-reference that build-chunk.md already documents this consumer behavior — insert-chunk is the producer of the marker, build-chunk is the consumer; neither restates the other's half.

**Version-stamp field (cite the template field, NOT a nonexistent state-machine.md heading)** (`SKETCH.template.md` line 12 + inline comment):
```markdown
Sketch Version: 1
```
with the template's own inline comment: "Bumped by /bs-insert-chunk on every structural change to the ordered chunk list below." RESEARCH.md's Pitfall 2 is load-bearing here: cite `templates/SKETCH.template.md`'s `Sketch Version:` field directly, plus `state-machine.md`'s `## Write Order` section — do NOT write a citation string like `state-machine.md "Sketch Version"`, since no such heading exists (verified: `grep -n "^##" SKETCH.template.md` shows no such heading either — it's a top-of-file field, not a `##` section).

**Session Lock note (adjacent field insert-chunk must not corrupt)** (`SKETCH.template.md` line 15):
```markdown
Session Lock: <!-- none | "<slug> — locked at <ISO timestamp>" -->
```
insert-chunk's SKETCH.md write (op d) must preserve this line untouched — only the `Sketch Version:` line changes.

**Negotiation-posture idiom to reuse verbatim in spirit** (`ingest-rules.md` lines 157-160, Step 6):
```markdown
**Negotiation posture:** the user's ordering wins unless a hard dependency is violated, in which
case name the dependency concretely and propose the minimal prerequisite. Do not proceed to
writing final files until the user has explicitly approved.
```
This is the exact posture CONTEXT.md's decision (25) and RESEARCH.md's op (a) describe for insert-chunk's dependency-order revalidation — cite/reuse this phrasing rather than re-deriving new negotiation language.

**Citations location for the closed-chunk overlap diff** (`CHUNK.template.md` sections, confirmed headings at lines 82, 98):
```
## Interpretation
## Newly Discovered Citations
```
insert-chunk's op (b) must scan BOTH sections of every closed (`verified` / `verified (user-waived)`) chunk's CHUNK.md — not just Interpretation.

**Consistency-check-on-entry** — identical `build-chunk.md` Step 0 excerpt as cited above for check-status; insert-chunk runs the same check (and additionally is itself a write path, so should also resolve/refresh the session lock per the same three-outcome logic in `build-chunk.md` lines 44-52 if it takes the lock during its edit — Claude's discretion whether insert-chunk takes the lock at all, since CONTEXT.md doesn't require it explicitly; flag this as a planner decision, not asserted here).

**Reference Files + Installed-location footer** — same as check-status's, above; insert-chunk additionally cites `templates/CHUNK.template.md` (stale marker location) alongside `SKETCH.template.md` and `state-machine.md`.

---

### `src/cli/slash-command/bs/status-tools.test.ts` (test, transform/assertion)

**Analog:** `ingest.test.ts` (structure + per-requirement-ID describe blocks + `read()` helper) and `templates.test.ts` (named byte-identical-marker constants) and `build-chunk.test.ts` (breadth of one-`describe`-per-req-ID coverage, 20 describe blocks for BUILD-01..13/UIQ-01..05).

**Header comment + read() helper + per-`it()` isolation rule** (`ingest.test.ts` lines 1-35):
```typescript
/**
 * Structural drift-protection test for the `/bs-ingest-rules` skill (INGEST-01..07).
 * ...
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a
 * missing file fails only that one assertion instead of aborting the whole suite's
 * collection phase — required because several referenced files genuinely don't exist
 * yet in this Wave-0-first state.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}
```
Copy verbatim — same `__dirname`/`read()` helper, same per-`it()` read isolation (status-tools.test.ts's own files don't exist yet either, at Wave 0).

**Named byte-identical-marker-constant pattern** (`templates.test.ts` lines 30-69):
```typescript
const STATUS_ENUM_VALUES = [
  'proposed',
  'approved',
  'built',
  'verified',
  'verified (user-waived)',
] as const;

/** CHUNK-level stale marker (em-dash, not hyphen). */
const STALE_MARKER = 'stale — re-derive before build';

const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';

const DERIVED_POINTER_GRAMMAR = 'Status (derived from chunks/<slug>/CHUNK.md):';

const ASSETS_HEADER_ROW = '| needed-by-chunk | requested | received | placeholder-in-use | file path |';
```
status-tools.test.ts should declare/reuse the same `STALE_MARKER` and `'verified (user-waived)'` (as `WAIVED_STATUS`, per RESEARCH.md's Code Examples section) constants, plus a `REFERENCED_SECTIONS` array of the exact `state-machine.md` headings both skills must cite (`## Consistency Check (every bs- entry point, before proceeding)`, `## Write Order`, `## Status Enum (exact)`, `## Session Lock`, `## Cold-Resume Parse Contract`) — mirroring `ingest.test.ts`'s `REFERENCED_PATHS` array pattern (lines 48-56) but for section headings instead of file paths.

**`REFERENCED_PATHS` cross-file-consistency array idiom** (`ingest.test.ts` lines 47-56):
```typescript
/** Every path `ingest-rules.md` must cite by exact path (cross-file consistency, INGEST-*). */
const REFERENCED_PATHS = [
  'ingest/transcription.md',
  'ingest/interview-fallback.md',
  'ingest/sketch-derivation.md',
  'ingest/scaffold.md',
  'state-machine.md',
  'templates/SKETCH.template.md',
  'templates/ASSETS.template.md',
] as const;
```
status-tools.test.ts's analog: an array of paths check-status.md/insert-chunk.md must reference (`state-machine.md`, `templates/SKETCH.template.md`, `templates/CHUNK.template.md`, `templates/ASSETS.template.md`), asserted with `existsSync(join(__dirname, p))` to catch dangling pointers per CONTEXT.md's verification decision.

**One-`describe`-per-requirement-ID breadth** (`build-chunk.test.ts` describe names, e.g. lines 118, 149, 186, 263, 317...):
```typescript
describe('BUILD-01 — resume routing', () => { ... });
describe('BUILD-02 — investigate', () => { ... });
```
status-tools.test.ts should use `describe('STAT-01 — ...')` / `describe('STAT-02 — ...')` blocks per CONTEXT.md's Verification decision items (7-item report enumeration; 4-op enumeration + citation-dep revalidation + closed-chunk overlap + stale-mark + version-bump; both-cite-correct-sections; referenced-files-exist; check-status-read-only).

**Read-only assertion technique** — no existing analog file asserts "read-only" directly (check-status is the first read-only skill in this family); model it as a negative-assertion `it()` similar to `ingest.test.ts` line 67's `expect(...).not.toMatch(...)` pattern:
```typescript
expect(transcription).not.toMatch(/per[- ]page confirmation/i);
```
i.e. `expect(checkStatus).not.toMatch(/write .*SKETCH\.md|edit .*CHUNK\.md|mutate/i)` (exact regex is planner/task-author discretion) plus a positive assertion that the file states it performs no writes.

---

### `src/cli/slash-command/bs/build-chunk.md` (edit, lines ~63/~65)

**No external analog needed** — this is a 2-sentence in-place edit removing the "(Phase 147)" forward-reference and routing to the real skill names. Current text to replace (`build-chunk.md` lines 58-67):
```markdown
- **"what's left?" / status questions** — answer self-contained from state files: read
  `SKETCH.md`'s ordered chunk list and, for the in-progress chunk, its `CHUNK.md` Status line
  and Step Checklist (all state files the orchestrator may read), then summarize what is
  verified, what is in progress (and at which step), and what remains. Never answer from memory
  or a partial read — read the state files first. Tell the user the fuller status view ships as
  `/bs-check-status` (Phase 147); until it lands, this summary IS the status behavior.
- **"do the Chance cards next" / reordering intents** — forward reference: the insert/reorder
  behavior ships as `/bs-insert-chunk` (Phase 147). Until it lands, tell the user reordering
  is not wired up yet and stop for their decision — never improvise a reorder by editing
  `SKETCH.md`'s ordered chunk list ad hoc.
```
Per RESEARCH.md's Open Question 1 (recommendation (a)) and BoardSmith CLAUDE.md's "No Backward Compatibility" rule, replace both bullets to delegate to the now-existing skills (e.g. "answer self-contained ... OR tell the user to run `/bs-check-status` for the fuller view" / "tell the user to run `/bs-insert-chunk`") instead of self-answering-with-a-forward-reference. This is a targeted string edit at the two locations grepped at lines 63 and 65 (`grep -n "Phase 147" build-chunk.md`).

## Shared Patterns

### Cite-not-restate discipline
**Source:** `state-machine.md` line 3 (self-description) + `ingest-rules.md` lines 3-8 + `build-chunk.md` lines 3-9 (each skill's own preamble)
**Apply to:** Both new skill files — the opening paragraph pattern ("Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules...") must appear near-verbatim in both, adapted only in the second sentence describing what kind of router the skill is (dispatcher for build/ingest vs. pure reader for check-status vs. pure editor for insert-chunk).

### Consistency-Check-on-entry
**Source:** `state-machine.md` lines 75-92 ("Consistency Check (every bs- entry point, before proceeding)"); invocation idiom at `build-chunk.md` lines 32-36
**Apply to:** Both new skill files' Step 0 — identical citation, identical `ls <file>` (never glob) instruction.

### Installed-location footer + Reference Files section
**Source:** `ingest-rules.md` lines 192-214
**Apply to:** Both new skill files — same paragraph structure, same "Installer-phase dependency" caveat (Phase 148 not yet landed).

### Write Order (CHUNK.md first, then SKETCH.md)
**Source:** `state-machine.md` lines 56-61
**Apply to:** `insert-chunk.md` only (check-status never writes).

### Status Enum / stale marker byte-exact strings
**Source:** `state-machine.md` lines 5-21
**Apply to:** Both new skill files (check-status reads/reports `verified (user-waived)`; insert-chunk writes `stale — re-derive before build`) and `status-tools.test.ts` (pins both as named constants).

### drift-test scaffolding (`read()` helper, per-it() isolation, `REFERENCED_PATHS`-style arrays, named marker constants)
**Source:** `ingest.test.ts` lines 1-56, `templates.test.ts` lines 18-69
**Apply to:** `status-tools.test.ts`.

## No Analog Found

None — every file in scope has a strong (exact or role-match) analog already shipped in this repo. This phase adds no genuinely new pattern; it is two more instances of an already-established idiom (per RESEARCH.md's "State of the Art" table).

## Metadata

**Analog search scope:** `src/cli/slash-command/bs/` (entire directory — 4 existing skill/reference files, 3 existing test files, 3 relevant templates)
**Files scanned:** `ingest-rules.md`, `build-chunk.md`, `state-machine.md`, `ingest.test.ts`, `build-chunk.test.ts`, `templates.test.ts`, `templates/SKETCH.template.md`, `templates/CHUNK.template.md`, `templates/ASSETS.template.md`
**Pattern extraction date:** 2026-07-04
</content>
