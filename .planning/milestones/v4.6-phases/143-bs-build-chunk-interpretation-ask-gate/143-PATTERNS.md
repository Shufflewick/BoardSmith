# Phase 143: `/bs-build-chunk` — Interpretation & Ask Gate - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 5 (1 orchestrator + 3 reference files + 1 test file)
**Analogs found:** 5 / 5 (exact — this phase is an explicit sibling-skill mirror, not a novel design)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli/slash-command/bs/build-chunk.md` | orchestrator (lean router) | event-driven (state-detect → dispatch → record) | `src/cli/slash-command/bs/ingest-rules.md` | exact |
| `src/cli/slash-command/bs/build/investigate.md` | reference file (subagent fan-out spec) | request-response (dispatch → structured return, writes CHUNK.md directly) | `src/cli/slash-command/bs/ingest/transcription.md` | exact |
| `src/cli/slash-command/bs/build/redteam.md` | reference file (multi-subagent adversarial fan-out) | request-response (3 parallel fresh-context dispatches → verdict aggregation) | `src/cli/slash-command/bs/ingest/transcription.md` (fan-out mechanics) + `state-machine.md` "Redteam Escalation"/"Repair Loop Bound" (escalation logic) | role-match (no existing multi-verdict-aggregation analog; transcription.md is the closest fan-out shape) |
| `src/cli/slash-command/bs/build/ask.md` | reference file (user-facing gate) | request-response (present → user decision → gated write) | `src/cli/slash-command/bs/ingest-rules.md` Step 6 ("Approval Gate") + Step 7 ("Write Files", gate-before-write ordering) | exact |
| `src/cli/slash-command/bs/build-chunk.test.ts` | test (structural drift/pin suite) | batch (static string/path assertions, no runtime execution) | `src/cli/slash-command/bs/ingest.test.ts` | exact |

## Pattern Assignments

### `src/cli/slash-command/bs/build-chunk.md` (orchestrator, event-driven)

**Analog:** `src/cli/slash-command/bs/ingest-rules.md` (214 lines, full read)

**Header/citation-discipline pattern** (lines 1-8):
```markdown
Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `state-machine.md` for all of that.
```
Copy this discipline verbatim in spirit for `build-chunk.md`'s own header — same "cite, don't restate" contract, same "lean router" self-description.

**Context-Economics Hard Rule restated at orchestrator level** (lines 13-19):
```markdown
**The orchestrator never reads full rulebook slices.** `rulebook/INDEX.md` is built exclusively
from the `citedTerms[]` lists subagents return in their structured summaries — never by
re-reading a slice file the orchestrator just had a subagent write. This applies to every step
below; `ingest/transcription.md` restates it because that is the step where the temptation to
"double-check by reading the slice" is strongest.
```
`build-chunk.md` needs the equivalent section, restating that the orchestrator never reads rulebook slices/docs itself and that `build/investigate.md`/`build/redteam.md` restate it because those are the highest-temptation steps (per RESEARCH.md Anti-Patterns).

**State-detection / entry-consistency-check pattern** (Step 0, lines 21-63):
```markdown
On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check"). Then determine which of four cases applies (use `ls <file>` direct
checks in the current directory, never `**/glob` patterns that search subfolders):
```
Copy the "consistency check first, then case-branch" shape for `build-chunk.md`'s own Step 0/1 — but branch on resume cases (first non-verified chunk → its CHUNK.md → first incomplete step; awaiting-playtest re-pose; conversational-intent probe) rather than ingest's fresh/interrupted/existing/migration cases. The literal `ls <file>` (never glob) instruction should carry over.

**Delegation-to-reference-file pattern** (Step 1, lines 65-76; Step 2, lines 78-91):
```markdown
Delegate the entire scaffold-and-verify sequence to `ingest/scaffold.md`: deriving
display/project/class names, running `boardsmith init`, verifying the empty skeleton compiles
(`tsc --noEmit`) and serves, and killing any server this skill starts before returning.
```
```markdown
- **Rulebook available** — dispatch fan-out subagents per `ingest/transcription.md`.
- **No rulebook** (unpublished prototype, rules in the designer's head) — run the structured
  interview per `ingest/interview-fallback.md`, which produces the identical `rulebook/` shape so
  every downstream step is unaffected by which path was taken.
```
This is the exact shape for `build-chunk.md`'s step-group-1 dispatch: "Delegate the entire investigate sequence to `build/investigate.md`... Delegate the entire redteam sequence to `build/redteam.md`... Delegate the ask-gate presentation to `build/ask.md`."

**Gate-before-write / Step-6-Step-7 split pattern** (lines 153-187):
```markdown
## Step 6: Approval Gate
Present the proposed sketch... Do not proceed to writing final
files until the user has explicitly approved.

## Step 7: Write Files
This is the **single point** where sketch state is written — no earlier step writes `SKETCH.md`
or any `CHUNK.md`... Only after Step 6's explicit approval:
```
Directly reusable for the `ask` step: present the 4-part format, gate, then write `Status: approved` (or any RULINGS.md/ASSETS.md entries) only after the explicit yes — same two-step split, same "single point where gated state is written" phrasing. This is the load-bearing anti-pattern fix from `142-REVIEW-FIX.iter2.md` CR-01 that RESEARCH.md Pattern 4 flags as must-not-reintroduce.

**Session-ending handoff pattern** (lines 189-190):
```markdown
End the session by printing the exact next command to run (`/bs-build-chunk`) and confirming
everything is saved in the game folder.
```
Reuse for every session-group boundary in `build-chunk.md` (investigate/redteam/ask group end; build/test group end, etc. — those groups are Phase 144+ but the orchestrator's routing table names all of them now). CONTEXT.md's "Every session ends by printing what to run next time (non-programmer-readable handoff)" is this exact pattern generalized to all 4 step groups.

**Reference Files / Installed Location footer pattern** (lines 192-214):
```markdown
## Reference Files
This skill delegates its heavyweight, step-scoped prose to:
- `ingest/transcription.md` — fan-out subagent dispatch, per-section confirmation protocol
...
And to the shared reference files that ship with every `bs-` skill:
- `state-machine.md` — status enum, consistency check, session lock, write order, authority
...
**Installed location:** every relative path above (the `ingest/` step files, `state-machine.md`,
and `templates/`) resolves against the directory containing THIS skill file — the installer
copies the whole `bs/` tree as one unit...
```
Copy this footer structure exactly — list `build/{investigate,redteam,ask}.md` as authored-now reference files, list `build/{build,test,audit,repair,playtest,revise,close}.md` as forward-reference-only entries with the "authored in Phase 144/145/146" marker (per CONTEXT.md), then the shared `state-machine.md`/`templates/*.md` list, then the identical "Installed location" paragraph (same installer-phase-dependency caveat, since Phase 148 installs this skill too).

---

### `src/cli/slash-command/bs/build/investigate.md` (reference file, request-response)

**Analog:** `src/cli/slash-command/bs/ingest/transcription.md` (147 lines, full read)

**Context-Economics Hard Rule restated at step level** (lines 9-19):
```markdown
## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)
**The orchestrator never reads the full rulebook, and it never re-reads a slice file after a
subagent writes it.** Every fact the orchestrator needs about a slice's content — its cited
terms, its component mentions — comes from the structured summary the subagent returns, not
from opening the file again. The single most tempting mistake in this entire skill is adding a
"let me double-check by re-reading what I just wrote" step after a subagent returns. Do not do
this.
```
Copy verbatim in spirit for `investigate.md`'s own header, substituting "rulebook slice" → "cited slices / INDEX-discovered slices / RULINGS.md / DECISIONS.md / docs" and "orchestrator" → same. This satisfies RESEARCH.md Anti-Patterns ("orchestrator reading rulebook slices just to double-check").

**Fan-Out Dispatch prompt template shape** (lines 20-62), structured-return contract (lines 60-61):
```markdown
Dispatch one Task-tool subagent per page range... **The subagent writes the slice files itself**
— the transcribed text never flows back through the orchestrator's context.
...
Return exactly: one { slicePath, sectionSummary, citedTerms[], componentMentions[],
visualEvidence[], variants[] } per section.
```
Investigate's dispatch (per CONTEXT.md: reads cited slices + INDEX-discovered slices + RULINGS.md + DECISIONS.md + docs + DESIGN.md for ui≠none) should follow the identical shape: a fresh Task-tool subagent prompt naming exactly what to read, an explicit "write directly to CHUNK.md's `## Interpretation`/`## Visibility Declaration`/`## Newly Discovered Citations` sections yourself" instruction (per RESEARCH.md Pattern 3 — subagent writes state, orchestrator never re-reads), and a `Return exactly: { ... }` structured-summary contract for what flows back to the orchestrator (a short pointer/summary only, never the full claims text).

**"Do not ask a subagent to interpret" boundary note** (lines 92-94):
```markdown
Do not ask a subagent to interpret or evaluate the rules — only transcribe, write, and extract
the summary fields above. Interpretation is the orchestrator's and, later, `/bs-build-chunk`'s
job, not the transcription subagent's.
```
Note the inversion for investigate: THIS step's subagent's whole job IS interpretation (producing the claims list) — cite this line only to establish that transcription intentionally deferred interpretation to `/bs-build-chunk`, i.e. to this very file, closing the loop RESEARCH.md's "State of the Art" table describes.

**Orchestrator-accumulates-without-rereading pattern** (lines 112-129):
```markdown
## Orchestrator Records (never writes slices, never re-reads them)
The subagents write every `rulebook/NN-topic.md`; the orchestrator only accumulates the
summary fields.
```
Reuse this section shape for investigate.md's own "Orchestrator Records" — the orchestrator (build-chunk.md) accumulates only the claims-list summary/pointer investigate returns, never re-reading CHUNK.md's `## Interpretation` section itself before handing it to redteam.

**Downstream Shape footer (cite, never restate)** (lines 142-147):
```markdown
## Downstream Shape (cite, never restate)
The written slices, `rulebook/INDEX.md`, and the accumulated component inventory feed Step 3
(Synthesis) in `ingest-rules.md`... This file does not restate either template's
structure — the orchestrator fills them from what this step returns.
```
Reuse for investigate.md's footer: cite `CHUNK.template.md`'s `## Interpretation`/`## Visibility Declaration`/`## Newly Discovered Citations` sections and `build/redteam.md` as the consumer of the claims list, without restating either.

**Required-Reading doc list to cite (not re-derive)** — from `ingest/scaffold.md` lines 125-136:
```markdown
## Required Reading Pointer
A fresh session about to touch the scaffolded project's output should still read the base
BoardSmith docs before generating any code: `docs/core-concepts.md` and
`docs/common-pitfalls.md` always; `docs/actions-and-flow.md` when building actions;
`docs/custom-ui-guide.md` and `docs/ui-components.md` when building UI; `docs/dice-and-scoring.md`
for dice games. ... `/bs-build-chunk`'s own `investigate` step owns the full required-reading
discipline for chunk work.
```
`build/investigate.md` is the named durable owner of this doc list — cite these exact filenames verbatim (per RESEARCH.md Pitfall 6), adding `DESIGN.md` for `ui: touches|major` chunks per CONTEXT.md/BUILD-02.

---

### `src/cli/slash-command/bs/build/redteam.md` (reference file, request-response — 3-way fan-out + escalation)

**Analog (fan-out mechanics):** `src/cli/slash-command/bs/ingest/transcription.md` (dispatch-prompt shape, per-item confirmation-before-continue idiom, lines 20-62, 96-110)

**Analog (escalation/vote logic):** `src/cli/slash-command/bs/state-machine.md` "Redteam Escalation" (lines 127-131) and "Repair Loop Bound" (lines 121-125):
```markdown
## Redteam Escalation
- **Refuted once:** re-investigate with the specific objections attached. Maximum **one** re-investigate round.
- **Refuted twice:** that is by definition an ambiguity. Escalate to the user as a plain-language question; the ruling is recorded in `RULINGS.md`.
- Disputes go to the human, never to more agents.
```
```markdown
## Repair Loop Bound
- Round N+1 auditors see the existing findings ledger (stable IDs) and report **only NEW findings** — they do not re-litigate findings already recorded.
```
Cite these two sections verbatim rather than restating the max-1-round bound or the refuted-twice-escalates rule — `redteam.md` should say "see `state-machine.md` 'Redteam Escalation'" the same way `sketch-derivation.md` (per ingest.test.ts INGEST-05 assertions) cites `SKETCH_LEVEL_MARKER` byte-identically rather than re-deriving it.

**Fresh-context, no-framing dispatch template (Code Example from RESEARCH.md, adapted from transcription.md's Fan-Out Dispatch idiom):**
```
[Refuter agent, ×2 — identical prompt, independent dispatch]
You are reviewing a rules interpretation for {gameName}, chunk "{slug}". Read the following
rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project (rulings outrank the
rulebook — see state-machine.md "Rulings Outrank Rulebook").

Here is a numbered list of factual claims. For each claim, decide: does the cited slice (plus
RULINGS.md) support this claim as written? Default to REFUTED if you are uncertain.

{numberedClaimsList}

Return exactly: [{ claimNumber, verdict: 'stands' | 'refuted', objection (if refuted) }, ...]

[Coverage adversary — separate prompt, independent dispatch]
You are reviewing a rules interpretation for {gameName}, chunk "{slug}" for COMPLETENESS...
Return exactly: { missingInteractions: [{ ruleDescription, citation }, ...] }
```
This is the concrete pattern to copy: 3 independent Task-tool dispatches, prompt containing ONLY slice paths + numbered claims list (no investigator rationale/framing — per RESEARCH.md Pitfall 1 and transcription.md's "the transcribed text never flows back through the orchestrator's context" discipline applied to "the investigator's framing never flows to redteam").

**Vote-privacy pattern (never show raw verdicts to user):** no direct analog file — this is new logic this phase introduces; cite `state-machine.md` "Redteam Escalation" ("Disputes go to the human, never to more agents") as the closest existing authority and follow RESEARCH.md's Pattern 5 escalation-framing example verbatim as a style model (plain-language question with Option A/B, never a vote tally).

---

### `src/cli/slash-command/bs/build/ask.md` (reference file, request-response — user gate)

**Analog:** `src/cli/slash-command/bs/ingest-rules.md` Step 6 "Approval Gate" (lines 153-160) + Step 7 "Write Files" (lines 162-187), plus `templates/RULINGS.template.md` and `templates/ASSETS.template.md` for the two ledgers ask writes into.

**Approval-gate negotiation-posture pattern** (lines 155-160):
```markdown
Present the proposed sketch... The user edits, this skill revises, the user approves.
**Negotiation posture:** the user's ordering wins unless a hard dependency is violated, in
which case name the dependency concretely and propose the minimal prerequisite. Do not proceed
to writing final files until the user has explicitly approved.
```
Adapt the negotiation-posture framing for ask's ambiguity questions (present options, the user's answer wins, gate before write) — same "do not proceed... until explicitly approved" load-bearing sentence.

**"Single point where gated state is written" pattern + carve-out precedent** (lines 162-183):
```markdown
This is the **single point** where sketch state is written — no earlier step writes `SKETCH.md`
or any `CHUNK.md`. Only after Step 6's explicit approval: ...
`ASSETS.md` and `rulebook/00-visual-survey.md` were already written at Step 3 (they record
factual component inventory and visual evidence, not gated sketch state) — do not re-copy or
re-write them here.
```
This is the exact precedent for ask.md's own carve-out: the claims list/visibility declaration from investigate is NOT gated (already written progressively, per state-machine.md "every step writes its results... before the next step starts") — only `Status: approved` and any RULINGS.md/ASSETS.md entries stemming from the ask conversation itself are gated. Cite this ingest-rules.md precedent directly when explaining why investigate's output isn't re-gated at ask.

**RULINGS.md entry shape to fill (never restructure):** `templates/RULINGS.template.md` lines 35-51 — the `### Ruling N` / Decision / Citation interpreted or overridden / Rationale shape, used both for ask-gate house-rule choices and redteam refuted-twice escalations.

**ASSETS.md ledger row shape to fill:** `templates/ASSETS.template.md` lines 23-38 — the 5-column `needed-by-chunk | requested | received | placeholder-in-use | file path` table; ask appends a row per requested asset, never restructures the header.

**4-part presentation skeleton (Code Example from RESEARCH.md, Claude's discretion on exact copy):**
```
(a) Rules interpretation, plain language + citations
(b) Ambiguities as concrete questions with options
(c) What you will NOT see yet
(d) [zero implementation vocabulary anywhere above]
Assets needed for this chunk: {assetList}. ("Don't have art yet? No problem — a placeholder
that matches the final layout will be used; see ASSETS.md for what's tracked.")
```
Use this skeleton directly, keeping copy in the register of the example claims (rent/turn/hand/board) and explicitly avoiding engine vocabulary (action/flow/state/element) per RESEARCH.md Pitfall 2.

---

### `src/cli/slash-command/bs/build-chunk.test.ts` (test, batch/static-assertion)

**Analog:** `src/cli/slash-command/bs/ingest.test.ts` (295 lines, full read)

**File header / intent comment pattern** (lines 1-24):
```typescript
/**
 * Structural drift-protection test for the `/bs-ingest-rules` skill (INGEST-01..07).
 *
 * `bs/ingest-rules.md` (the lean orchestrator) and its four `bs/ingest/*.md` reference
 * files are plain markdown consumed by an agent session, NOT parsed by any runtime code
 * in this repo. This test pins the exact strings, citations, and cross-file pointers those
 * files depend on...
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a
 * missing file fails only that one assertion instead of aborting the whole suite's
 * collection phase...
 */
```
Copy this exact framing for `build-chunk.test.ts`'s header, substituting INGEST-01..07 → BUILD-01..04+BUILD-12, and noting explicitly (per CONTEXT.md) that BUILD-05..11 assertions either don't exist yet or assert only the forward-reference stub text.

**`__dirname`/`read()` helper (lines 26-35), copy verbatim:**
```typescript
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
Identical helper — `build-chunk.test.ts` lives in the same `bs/` directory, so relative paths resolve the same way.

**Byte-identical-marker constant pattern** (lines 37-45):
```typescript
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';
const UI_TAG_REGEX = /none *\| *touches *\| *major/;
```
Reuse `SKETCH_LEVEL_MARKER` and `UI_TAG_REGEX` as-is if `build-chunk.md` quotes either (it likely quotes the ui: tag values and the status enum). Add new pinned constants for BUILD-specific byte-identical strings: the full-ceremony 10-step list (`investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`), the light-path 3-step list (`build, test, playtest`), and the stale marker (`stale — re-derive before build`) — all quoted verbatim from `state-machine.md`.

**`REFERENCED_PATHS` cross-file-consistency array pattern** (lines 47-56, exercised at lines 282-295):
```typescript
const REFERENCED_PATHS = [
  'ingest/transcription.md',
  'ingest/interview-fallback.md',
  'ingest/sketch-derivation.md',
  'ingest/scaffold.md',
  'state-machine.md',
  'templates/SKETCH.template.md',
  'templates/ASSETS.template.md',
] as const;
...
describe('cross-file consistency — every referenced path resolves on disk', () => {
  it('ingest-rules.md cites every reference path (contains the pointer string)', () => {
    const ingestRules = read('ingest-rules.md');
    for (const path of REFERENCED_PATHS) {
      expect(ingestRules, `ingest-rules.md must cite "${path}"`).toContain(path);
    }
  });
  for (const path of REFERENCED_PATHS) {
    it(`${path} exists on disk`, () => {
      expect(existsSync(join(__dirname, path)), `${path} must exist`).toBe(true);
    });
  }
});
```
Directly reusable pattern for `build-chunk.test.ts`'s own `REFERENCED_PATHS` array — but scoped per CONTEXT.md to **current-phase files only**: `build/investigate.md`, `build/redteam.md`, `build/ask.md`, `state-machine.md`, `templates/CHUNK.template.md`, `templates/RULINGS.template.md`, `templates/ASSETS.template.md`. The Phase 144-146 stub paths (`build/build.md`, `build/test.md`, etc.) must NOT go in this existence-checked array — they get a separate assertion checking the routing table names them as plain text with the "authored in Phase 14X" marker, not that the file exists (per CONTEXT.md's explicit "referenced-file existence limited to current-phase files").

**`RETURN_SHAPE_FIELDS` pinning pattern** (lines 190-224):
```typescript
const RETURN_SHAPE_FIELDS = [
  'slicePath', 'sectionSummary', 'citedTerms[]', 'componentMentions[]',
  'visualEvidence[]', 'variants[]',
] as const;

describe('return-shape field names — pinned across the file set (WR-07)', () => {
  it('transcription.md defines every return-shape field', () => {
    const transcription = read('ingest/transcription.md');
    for (const field of RETURN_SHAPE_FIELDS) {
      expect(transcription, `transcription.md must define "${field}"`).toContain(field);
    }
  });
  it('ingest-rules.md consumes the synthesis-facing fields by the same names', () => { ... });
});
```
Directly reusable for pinning investigate's and redteam's return-shape field names (whatever Claude's-discretion names are chosen, e.g. `claimVerdicts[]`/`missingInteractions[]`) across `build-chunk.md` (consumer) and `build/investigate.md`/`build/redteam.md` (producers) — same technique, same assertion shape (define in producer, consume-by-same-name in orchestrator).

**Per-requirement `describe` block pattern** (lines 58-188, one block per INGEST-NN): copy this shape exactly — one `describe('BUILD-01 — ...', ...)` block per requirement ID (BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-12), each `it()` doing a `read()` + `toContain`/`toMatch` assertion inside the `it()` body (never hoisted to describe-level, per the file-header comment's own stated rule — this is a correctness constraint, not just style, since a missing file must fail only its own assertion).

**CLI-source-string pin pattern** (lines 226-249) — likely NOT needed this phase (investigate/redteam/ask don't shell out to CLI commands the way scaffold.md does), but note as available precedent if any step ends up quoting a CLI-emitted string verbatim.

## Shared Patterns

### Citation-Not-Restatement (applies to all 4 new markdown files)
**Source:** `src/cli/slash-command/bs/ingest-rules.md` lines 1-8; `state-machine.md` line 3 ("Every `bs-` skill... cites this file rather than restating its rules.")
**Apply to:** `build-chunk.md`, `build/investigate.md`, `build/redteam.md`, `build/ask.md` — every reference to the status enum, step names, session lock, write order, consistency check, or template structure must be a citation (`see state-machine.md "X"`), never a restatement of the rule's text.

### Subagent-Writes-State-Directly, Orchestrator-Never-Rereads
**Source:** `src/cli/slash-command/bs/ingest/transcription.md` lines 9-19, 112-129 (context-economics Hard Rule + "Orchestrator Records")
**Apply to:** `build/investigate.md` (subagent writes CHUNK.md's `## Interpretation`/`## Visibility Declaration`/`## Newly Discovered Citations` sections directly), `build/redteam.md` (redteam agents return verdicts, never rewrite CHUNK.md themselves — the orchestrator or investigate does that on re-investigate)

### Gate-Before-Write (CR-01 precedent)
**Source:** `src/cli/slash-command/bs/ingest-rules.md` Steps 6-7 (lines 153-187)
**Apply to:** `build/ask.md` — `Status: approved` and any RULINGS.md/ASSETS.md entries from the ask conversation are written only after explicit user approval; the claims list/visibility declaration is NOT gated (already written progressively by investigate).

### Byte-Identical Cross-File Pins
**Source:** `src/cli/slash-command/bs/ingest.test.ts` `SKETCH_LEVEL_MARKER`/`UI_TAG_REGEX`/`REFERENCED_PATHS`/`RETURN_SHAPE_FIELDS` constants (lines 37-56, 190-202)
**Apply to:** `build-chunk.test.ts` — pin the full-ceremony step list, light-path step list, status enum values, and return-shape field names byte-identically across `build-chunk.md` ↔ `state-machine.md` and `build-chunk.md` ↔ `build/{investigate,redteam,ask}.md`.

### Installed-Location Footer
**Source:** `src/cli/slash-command/bs/ingest-rules.md` lines 207-214
**Apply to:** `build-chunk.md`'s footer — identical paragraph shape (paths resolve relative to this skill file's own directory; installer-phase dependency note for Phase 148).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Redteam's 3-way independent-verdict aggregation + escalation logic (within `build/redteam.md`) | subagent orchestration | pub-sub-like (fan-out + vote, never auto-resolved) | No existing `bs-` skill runs more than one subagent role in parallel against the same input and aggregates disagreement into a human escalation — `transcription.md`'s fan-out is same-role parallel dispatch (page ranges), not adversarial-role parallel dispatch (2 refuters + 1 coverage adversary voting). Use `state-machine.md` "Redteam Escalation"/"Repair Loop Bound" (already cited above) plus RESEARCH.md's Code Examples redteam dispatch template as the primary basis instead of a codebase analog. |

## Metadata

**Analog search scope:** `src/cli/slash-command/bs/` (ingest-rules.md, ingest/*.md, state-machine.md, templates/*.template.md, ingest.test.ts, templates.test.ts)
**Files scanned:** 8 (ingest-rules.md, ingest/transcription.md, ingest/scaffold.md, ingest.test.ts, state-machine.md, templates/CHUNK.template.md, templates/RULINGS.template.md, templates/ASSETS.template.md)
**Pattern extraction date:** 2026-07-04
