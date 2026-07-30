# Phase 175: Impact Map & Repair Gating - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 10 (2 new, 8 modified)
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/verify-impact.ts` (new) | service (CLI command family) | event-driven (gate) + CRUD (marker write) + batch (impact map) | `src/cli/commands/verify-classify.ts` (174) + `chunk-provenance.ts` (171) | role-match, composite |
| `src/cli/commands/verify-impact.test.ts` (new) | test | — | `src/cli/commands/verify-classify.test.ts` / `drift-check.test.ts` | exact (colocated-test convention) |
| `src/cli/commands/chunk-provenance.ts` (modify — new `VERIFIED_AGAINST_LABELS` entry) | service | CRUD (fenced-region write) | itself (extend existing extension pattern) | exact |
| `src/cli/slash-command/bs/state-machine.md` (modify) | config/skill-text (shared reference) | — | itself | exact |
| `src/cli/slash-command/bs/verify-game.md` (modify) | route/orchestrator (skill-text router) | request-response (dispatch) | itself, using 174-05's in-place-rewrite technique | exact |
| `src/cli/slash-command/bs/templates/CHUNK.template.md` (modify) | config (template) | — | itself, `## Verified Against` section as the precedent for the new section | exact |
| `src/cli/slash-command/bs/templates/SKETCH.template.md` (modify) | config (template) | — | itself, "Status (derived from ...)" pointer pattern | exact |
| `src/cli/cli.ts` (modify) | route (command registration) | — | itself — the `verify-run-*` / `verify-classify-*` registration block | exact |
| `src/cli/slash-command/bs/check-status.md` (modify) | route (read-only reporting skill) | request-response (format `--json`) | itself — Item 8's `chunk-provenance-status --json` pattern | exact |
| `src/cli/slash-command/bs/status-tools.test.ts` (modify) | test | — | itself (`STALE_MARKER` pin) | exact |

## Pattern Assignments

### `src/cli/commands/verify-impact.ts` (new — service, composite data flow)

This is a NEW file, so there is no single analog — it composes THREE existing modules. Do not
re-derive any of the following; import and call them.

**1. Consumes `verify-classify.ts`'s `ChunkVerdict[]` (lines 881-894):**
```typescript
export interface ChunkVerdict {
  slug: string;
  citedLiveSlices: string[];
  pairIds: string[];
  ruleDelta: RuleDelta;
  stale: boolean;
  attributions: Array<{
    pairId: string;
    liveSlice: string;
    rung: CitationAnchorRung;      // 'quoted-fragment' | 'cited-page' | 'slice-fallback'
    attributed: boolean;
    reason: string;
  }>;
}
```
Also reuse (do not redefine): `CITATION_ANCHOR_RUNGS` (lines 907-911), `CHUNK_ATTRIBUTION_WARNING_KINDS`
(lines 924-928), `parseClaimCitationAnchors` (lines 986-1025) — these give the full per-chunk
line-level evidence decision 16 hands to Phase 176. `RULE_DELTA_SEVERITY` (lines 874-879) is the
one shared severity-order constant for any max-severity roll-up this file needs — never a
duplicated if/else chain.

**2. Reuses `verify-run.ts`'s atomic ledger family (exports, lines 70-160+):**
```typescript
export const RUN_LEDGER_BEGIN = '<!-- boardsmith:verify-run:begin -->';
export const RUN_LEDGER_END = '<!-- boardsmith:verify-run:end -->';

export interface ClassificationRecord {
  kind: 'classification';
  pairId: string;
  units: string[];
  liveSlices: string[];
  stagedSlices: string[];
  provenance: 'source-changed' | 'source-unchanged' | 'unknown';
  ruleDelta: 'cosmetic' | 'sharper' | 'contradictory' | 'unclassified';
  stale: boolean;
  evidence: string;
  recordedAt: string;
  quotedPass1?: string;
  quotedPass2?: string;
}
```
Follow the SAME pattern 174-02 used to widen this file: add a new ledger record `kind` (e.g.
`'impact'` or `'adjudication'`) to the SAME `RUN.md` ledger this phase's atomic
`atomicWriteFile`/`appendLedgerLine`/`locateFences`/`parseLedgerBody`/`resolveLedgerState`/
`ledgerFilePath`/`readLedgerOrThrow` exports already provide. There must be exactly ONE atomic
write path in the repo (decision 17 / CR-01's defect class) — do not add a second `fs.writeFile`
call anywhere in this new file for ledger persistence.

**3. Reuses `drift-check.ts`'s three-state code-movement authority (exports, lines 148-165):**
```typescript
export interface ChunkDrift {
  chunk: string;
  hash?: string;
  state: 'clean' | 'drifted' | 'unknown';
  changedFiles: string[];
  missingFiles: string[];
  manifestFileCount: number;
}
export interface DriftCheckResult {
  chunks: ChunkDrift[];
  findings: Finding[];
  counts: { clean: number; drifted: number; unknown: number };
  head: string;
}
```
Call `driftCheckCommand(...)` directly for decision 10/12/13's "did this chunk's code move"
question — never re-implement a second hash/diff scheme. `state: 'drifted'` maps to `Status: built`
+ gate re-open (decision 12); `state: 'clean'` maps to keeping `Status: verified` + the re-verify
stamp (decision 11); `state: 'unknown'` must be treated the same conservative way 172 treats it —
never silently collapsed into `clean`.

**Exit-code / findings convention to copy** (from `drift-check.ts` lines 176-189 and
`chunk-provenance.ts` lines 505-511):
```typescript
// Findings exit 0; non-zero is reserved for TOOL failure (no chunks/, not a git repo, etc.) —
// never for a finding. process.exitCode = 1 is used for "the write repaired something and you
// should re-read the file", not for reporting a finding.
process.exitCode = 1;
```
`program.parse()` does not await action handlers — never `throw` from inside the normal report
path; only throw for a structural tool-failure the caller must see loudly (missing `chunks/`,
missing fences, not a git repo).

**`--json` / human-report split to copy** (from `drift-check.ts` lines 353-360):
```typescript
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}
printHumanReport(result);
return result;
```

---

### `src/cli/commands/chunk-provenance.ts` (modify — extend `VERIFIED_AGAINST_LABELS`)

**Analog:** itself — the existing extension pattern (this IS the machine-owned fenced-region
pattern that decision 2/18's new rules-staleness marker copies, and decision 11's re-verification
stamp extends this same block).

**The exact current label array to extend** (lines 234-243):
```typescript
export const VERIFIED_AGAINST_LABELS = Object.freeze([
  'Scope:',
  'Reason:',
  'Rulebook edition:',
  'Rulebook source hash:',
  'BoardSmith version:',
  'Skills tree hash:',
  'Cited slices:',
  'Unresolved citations:',
] as const);

const [
  LABEL_SCOPE,
  LABEL_REASON,
  LABEL_EDITION,
  LABEL_SOURCE_HASH,
  LABEL_VERSION,
  LABEL_SKILLS_HASH,
  LABEL_CITED,
  LABEL_UNRESOLVED,
] = VERIFIED_AGAINST_LABELS;
```
Decision 11 requires a NEW label appended here (e.g. `'Re-verified (no code change):'`) — a simple
append, never a restructure, so every consumer's positional destructuring keeps working. Do
**NOT** reuse `SCOPE_REASONS` (lines 49-55) — that array is a completely different concept (why a
verification's SCOPE was reduced: `source-missing`, `source-hash-mismatch`, `index-missing`,
`no-rulebook-project`, `pre-provenance-project`) and encodes nothing about whether code moved.

**The section-locate-by-line discipline (f73153a3), to copy for the NEW rules-staleness fenced
region** (lines 388-396):
```typescript
// The heading position in the file AS READ, before this run writes anything. Computed once and
// reused both for scanning citations and for locating where to write below.
//
// Anchored to a LINE, not to the first substring occurrence. `indexOf(VERIFIED_AGAINST_HEADING)`
// also matched prose, and CHUNK.template.md:18 legitimately names "## Verified Against" inside
// its required-headings comment — 130 lines above the real section. ... Silent
// under-recording is the exact defect class this phase exists to prevent, so the heading is
// located structurally rather than by substring.
const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
const headingIdx = headingMatch ? headingMatch.index : -1;
```
And the exported `findHeadingIndex` helper (from `build-manifest.js`, used at line 573) is the
by-line-anchored lookup to reuse for ANY new heading search — never a bare `indexOf`.

**The fence-pair-per-section discipline** (lines 218-226):
```typescript
export const VERIFIED_AGAINST_HEADING = '## Verified Against';
export const VERIFIED_AGAINST_BEGIN = '<!-- boardsmith:verified-against:begin -->';
export const VERIFIED_AGAINST_END = '<!-- boardsmith:verified-against:end -->';
// A DISTINCT fence pair from GAPS_BEGIN/GAPS_END (171-CONTEXT.md decision 3): two unrelated
// machine-owned sections sharing one fence pair is a data-corruption risk, not a convenience.
```
The new rules-staleness marker (decision 2/18) needs its OWN heading (e.g. `## Rules Staleness`)
and its OWN distinct fence pair (e.g. `<!-- boardsmith:rules-staleness:begin -->` / `:end`) —
never reusing `VERIFIED_AGAINST_BEGIN`/`END`.

**Write/repair path to copy** (`chunkCheckCommand`, lines 355-511) — repair-then-fail, never a
"tell you to fix it yourself" model:
```typescript
if (begin === -1 || end === -1 || end < begin) {
  throw new Error(
    `${relChunkPath}'s "${VERIFIED_AGAINST_HEADING}" section is missing its machine-owned fences.\n` +
      `Expected ${VERIFIED_AGAINST_BEGIN} ... ${VERIFIED_AGAINST_END}.\n` +
      `This section is written by \`boardsmith chunk-check\`, never by hand. Restore it by\n` +
      `deleting the entire "${VERIFIED_AGAINST_HEADING}" section from ${relChunkPath},\n` +
      `then re-run \`boardsmith chunk-check ${slug}\`.`,
  );
}
```
The repair lands on disk in the SAME call, so an immediate re-run passes — the ONE thing that
throws is the fence-refusal structural error (file untouched, loud actionable failure); everything
else is repair-then-report with `process.exitCode = 1` when something changed.

**Parse function to model the new marker's parser on** (`parseVerifiedAgainst`, lines 572-645) —
strict by design: a missing fence, missing required label, or the not-yet-recorded sentinel body
all yield an "unknown"/unparsed state; a PARTIALLY parsed block is never returned as valid.

---

### `src/cli/slash-command/bs/state-machine.md` (modify — register the new marker)

**Analog:** itself. Quote EXACTLY (do not paraphrase) when writing the plan's diff:

**Item 3 of the Cold-Resume Parse Contract, current text (lines 98-101):**
```
3. All statuses parse against a recognized value: the Status Enum above, the CHUNK-level stale
   marker (`stale — re-derive before build`), or — in SKETCH.md tail entries only — the
   sketch-level marker `proposed (sketch-level — no CHUNK.md yet)`. Any of these three is a
   valid parse; anything else is a parse failure (stop and ask).
```
Per research's Open Question 1 recommendation: do NOT fold the new marker into this item (it is
not a status-line form, per decision 1). Add a SEPARATE, ADDITIONAL numbered item to the
Consistency Check list (and cite it from a corresponding new subsection) stating that the
rules-staleness marker — present/absent, in its own fenced section — parses against its own
two-value set, and a malformed/unrecognized value there is ALSO a parse failure.

**The existing stale marker text, to copy the em-dash discipline from (lines 17-21):**
```
CHUNK-level stale marker (set by `/bs-insert-chunk` when an already-detailed pending CHUNK.md is invalidated by a sketch change):

`stale — re-derive before build`

(NOTE: the dash in `stale — re-derive before build` is an em-dash "—", not a hyphen.)
```
The new rules-staleness marker's string MUST be unmistakably distinct from this one (decision 1's
own warning: "built against rules that changed" is the OPPOSITE situation from "never built").

**Authority / Write Order sections to cite, not restate** (lines 51-73) — CHUNK.md wins on
contradiction, write order is always CHUNK.md first then SKETCH.md second, `Status:` line last.
This is exactly what decision 3 requires the new marker write to follow.

---

### `src/cli/slash-command/bs/verify-game.md` (modify — rewrite Step 3's boundary statement, add gate step)

**Analog:** itself, using the SAME in-place-rewrite technique Phase 174 (174-05) had to apply to
this identical file for Phase 173's boundary statement.

**The exact now-false text to find and rewrite (Step 3, lines 85-94, specifically the last
sentence):**
```
## Step 3: Classification (VERIFY-03, VERIFY-07)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md` for the full pair
enumeration, ledger-driven resume, per-pair subagent dispatch, and verdict recording sequence. In
short: a `verify-classify-pairs` call groups live and staged slices by page-span overlap, a
`verify-classify-status` call decides exactly which pairs still need classifying, each pending pair
is dispatched to the shared classification-subagent contract (the one place either slice is
legitimately read), and each returned verdict is recorded via `verify-classify-record` — never by
the orchestrator opening a slice itself. This step records verdicts only: it flips no staleness
marker anywhere and opens no repair loop (that is Phase 175's job).
```
The final sentence (`"This step records verdicts only... that is Phase 175's job."`) is now FALSE
and must be rewritten in place — grep this file for "Phase 175" and "flips no staleness marker" as
an explicit pre-commit check (this is Pitfall 4 in 175-RESEARCH.md, named after 174-05's identical
fix to this same file for Phase 173's boundary claim).

**Step numbering to extend, following the existing Step 0-4 shape (lines 41-111):** insert a new
step (the adjudication gate + staleness write) between the existing "Step 3: Classification" and
"Step 4: Close", renumbering Close to Step 5. Model the new step's format on Step 3/Step 4's own
structure: a one-paragraph "in short" summary, a dispatch line to a new
`verify/adjudication-gate.md` reference file (mirroring how Step 1/2/3 each dispatch to their own
`verify/*.md` file rather than inlining prose), and citations to `state-machine.md` rather than
restated rules.

**Step 4/Close's existing "format never compute" convention to copy (lines 104-106):**
```
- Report the run's classification verdicts to the designer by formatting
  `verify-classify-status --json`'s output — **formatted, never computed** by this skill; every
  number in the report comes from the command's JSON, not from this skill's own arithmetic.
```
Apply the identical discipline to the new impact-map/staleness report.

---

### The Hard Gate pattern — `src/cli/slash-command/bs/build/ask.md` "Gate-Before-Write" (lines 153-190)

**Analog for decision 9's no-bypass adjudication gate.** Quote verbatim:
```
## Gate-Before-Write

Present all four parts, then negotiate: the user's answer wins on any ambiguity in part (b)
unless a hard dependency is violated, in which case name the dependency concretely and propose
the minimal resolution. Do **not** write anything durable — not `Status: approved`, not a
RULINGS.md entry, not an ASSETS.md row — until the user has given explicit approval. Presenting
is not approving; only an explicit yes authorizes the write.

Only after that explicit yes:
...
1. Write any RULINGS.md `### Ruling N` entries from house-rule/adaptation choices made above.
2. Write any ASSETS.md ledger row updates from the asset request above.
3. Check off `ask` on CHUNK.md's Step Checklist ...
4. Write `Status: approved` to CHUNK.md **last**, after every other write for this gate has
   landed (cite `state-machine.md` "Write Order" — the `Status:` line is updated last so a
   session that crashes mid-write leaves a file whose status still reflects the last
   fully-completed state, never a half-written one).
5. Then update this chunk's derived-status pointer in SKETCH.md to match ...
```
The new `verify/adjudication-gate.md` (suggested new file) should follow this EXACT shape:
present all contradictory findings at once (decision 6/14 — never one gate per finding, never per
chunk), require an explicit yes before ANY durable write (no bypass flag anywhere — decision 9 is
satisfied structurally by never writing a code path that offers one, exactly as `ask.md` never
does), then write in this order: `RULINGS.md` append (or `UNADJUDICATED` record per decision 8) →
staleness markers into CHUNK.md then SKETCH.md → `Status:`-adjacent field last.

**The terminal "refused/deferred" state to model `UNADJUDICATED` on** — `state-machine.md`'s
"Redteam Escalation" (lines 164-168):
```
- **Refuted once:** re-investigate with the specific objections attached. Maximum **one** re-investigate round.
- **Refuted twice:** that is by definition an ambiguity. Escalate to the user as a plain-language question; the ruling is recorded in `RULINGS.md`.
- Disputes go to the human, never to more agents.
```
Decision 8's `UNADJUDICATED` state must be an equally NAMED, honest terminal marker — never a
silent "proceed as if resolved."

---

### `src/cli/slash-command/bs/templates/CHUNK.template.md` (modify — the marker's own `##` heading)

**Analog:** the existing `## Verified Against` section at the end of this same file (lines
193-203), which is the ONLY existing precedent for a second machine-owned field alongside
`Status:`:
```
## Verified Against
<!-- MACHINE-OWNED. Written by `boardsmith chunk-check <slug>` and by nothing else — never
     hand-author anything between the fences below; the next `chunk-check` run overwrites it
     regardless of what a session puts there. It is fenced rather than merely documented because
     on 2026-07-28 a session filled a machine-owned section (`## Open Rules Gaps`) by hand and the
     result looked entirely healthy while being wrong — prose asking a session not to do this did
     not stop it; a fence makes hand-authoring detectable, and `chunk-check` makes it fatal. -->

<!-- boardsmith:verified-against:begin -->
_Not yet recorded._
<!-- boardsmith:verified-against:end -->
```
Decision 18 makes the new marker its OWN `##` heading (e.g. `## Rules Staleness`) with this exact
shape: heading, explanatory MACHINE-OWNED comment, its own distinct fence pair, a
`_Not yet recorded._`-equivalent empty-state sentinel.

**Two sites in THIS file that must NOT be touched** (per decision 1 / 18's orthogonality guard):
- Line 8-9's `Status:` line and its "Valid values" comment:
  ```
  Status: proposed
  <!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
  ```
- The PARSE CONTRACT required-heading list (lines 14-21):
  ```
  <!-- PARSE CONTRACT (TMPL-02): this file must contain, in order: this Status line, "## ui:",
       "## Ceremony", "## Step Checklist", "## Interpretation", "## Visibility Declaration",
       "## Newly Discovered Citations", "## Redteam Rounds", "## Findings Ledger", "## Revision Rounds",
       "## Build Manifest", "## Playtest Test Script",
       "## Verified Checklist", "## Verified Commit Hash", "## Verified Against". If any required
       heading is missing, or the Status line doesn't match a recognized enum value above, a
       resuming session STOPS and asks the user — it never guesses the intended state. See
       state-machine.md "Cold-Resume Parse Contract". -->
  ```
  If the new marker becomes its own `##` section, ITS heading name must be ADDED to this list (it
  is a required heading like every other one here) — but the Status-line comment above it must
  stay byte-for-byte unchanged.

---

### `src/cli/slash-command/bs/templates/SKETCH.template.md` (modify — derived reflection)

**Analog:** the existing "Status (derived from ...)" pointer pattern (lines 61-85):
```
### <!-- slug -->
- What it builds: <!-- one-line description -->
- Citations: <!-- rulebook section(s) -->
- ui: <!-- none | touches | major -->
- Milestone: <!-- none | core-loop | scoring | final-acceptance -->
- Status (derived from chunks/<!-- slug -->/CHUNK.md): <!-- proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
- Test script (outcome-based): <!-- "move a pawn one space; the board reflects it" style description -->
```
Add a sibling derived-pointer line for the new marker (e.g. `- Rules Staleness (derived from
chunks/<slug>/CHUNK.md): <!-- clear | stale -->`), mirroring the EXACT "derived from ..." qualifier
grammar this Status line already uses — never fold it into the Status line itself (decision 1).
Do NOT touch the Status line's own enum list at line 85 — it is pinned byte-for-byte by
`templates.test.ts`'s `TEMPLATE_ENUM_LINE`.

---

### `src/cli/cli.ts` (modify — command registration)

**Analog:** the existing `verify-run-*` / `verify-classify-*` registration block (lines 214-320).
Copy this exact shape for the new `verify-impact-*` command(s):
```typescript
program
  .command('verify-classify-status')
  .description(
    'Report which pairs still need classifying, summary counts, and per-chunk staleness ' +
      'verdicts (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyStatusCommand);
```
And the mutating-command shape (with `--json` option always last):
```typescript
program
  .command('verify-classify-record')
  .description(
    'Record one classification verdict for a pair, atomically appended to the run\'s ledger ' +
      '(stale and provenance are derived, never supplied)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--run-id <id>', 'The run to record against')
  .requiredOption('--pair-id <id>', 'The pair id to classify (see verify-classify-pairs)')
  ...
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyRecordCommand);
```
Import new command functions at the top of the file the same way (see the existing imports at
lines 20-32: `import { chunkCheckCommand, chunkProvenanceStatusCommand } from
'./commands/chunk-provenance.js';` etc.) — one import block per module, named exports only.

---

### `src/cli/slash-command/bs/check-status.md` (modify — decision 19's rules-stale count)

**Analog:** Item 8's existing "format `--json`, never compute" pattern (lines 108-127), which is
explicitly named in 175-CONTEXT.md as the surface decision 19 revives:
```
**8. Verification provenance and drift.** Run `boardsmith chunk-provenance-status --json` and
FORMAT its output — do not compute any of it here. Report: how many chunks are `full`,
`code-conformance-only` (with each one's reason code), and `unknown`; ...

Consume the command's own `projectProvenanceState` field rather than re-deriving severity from
the raw `verifiedWithoutProvenance` count: a `pre-provenance` project ... has every verified
chunk flagged BY DEFINITION, and that is expected, not an alarm — report it as informational,
not a warning. `partial` ... is the suspicious case ... This skill formats that distinction; it
does not recompute it.
```
Add a new Item 9 (or fold into Item 1's "done/remaining" synthesis, per decision 15's "6 of 16
chunks rules-stale, never capped") that runs the new `verify-impact` command's `--json` output and
formats the stale-fraction count — same discipline: format only, never compute, never cap or
truncate the list (decision 15 is explicit that report VOLUME must never be suppressed — group and
summarize, but never drop, following 172's finding).

**Read-only posture to preserve (lines 132-144):** `check-status.md` performs NO writes of any
kind; the new item must call a read-only reporting command, never anything that writes a marker.

---

### `src/cli/slash-command/bs/status-tools.test.ts` (modify — new pin)

**Analog:** the existing `STALE_MARKER` pin in this same file:
```typescript
const STALE_MARKER = 'stale — re-derive before build';
const WAIVED_STATUS = 'verified (user-waived)';
...
it('pins STALE_MARKER byte-exact as the CHUNK.md Status value it sets', () => {
  ...
  expect(insertChunk).toContain(STALE_MARKER);
});
```
Add a sibling constant + assertion pinning the new rules-staleness marker's exact string against
`check-status.md`'s prose, mirroring this pattern exactly.

**`templates.test.ts`'s parallel pinning infrastructure (lines 44-90)** — the single-source-of-truth
pattern to extend for the new marker:
```typescript
const STATUS_ENUM_VALUES = [
  'proposed', 'approved', 'built', 'verified', 'verified (user-waived)',
] as const;
const STALE_MARKER = 'stale — re-derive before build';
const STATE_MACHINE_ENUM_LINE = STATUS_ENUM_VALUES.map((v) => `\`${v}\``).join(' | ');
const TEMPLATE_ENUM_LINE = [...STATUS_ENUM_VALUES, STALE_MARKER].join(' | ');
```
Per decision 1/18 (and 175-RESEARCH.md's explicit warning): **none of `STATUS_ENUM_VALUES` /
`STALE_MARKER` / `STATE_MACHINE_ENUM_LINE` / `TEMPLATE_ENUM_LINE` should change.** Add a NEW,
separate pinned constant for the new marker's own string (imported from `chunk-provenance.ts` if
it is exported as a constant there, mirroring how this test file already imports
`VERIFIED_AGAINST_HEADING`/`VERIFIED_AGAINST_BEGIN`/`VERIFIED_AGAINST_END`), asserted in a NEW
test, never inserted into the existing enum-pinning assertions. The same applies to
`build-chunk.test.ts`'s local `STATUS_ENUM_VALUES`/`STALE_MARKER` consts (lines 67/70, used at
957/964/1364) — if `build-chunk.md`'s prose references the new marker, pin it there as a sibling
assertion, never by touching the existing pinned arrays.

---

### `RULINGS.md` — the real, human-authored `### Ruling N` shape (decision 7's append target)

**Analog:** both reference games' real files — read directly, not paraphrased. The literal shape
(from `~/BoardSmithGames/one-two-punch/RULINGS.md`, Ruling 22, lines 159-162):
```markdown
### Ruling 22
- Decision: **A Punch resolving against an opponent who has ZERO Guards remaining THROWS — it is treated as a reached-illegal-state bug, not a silent no-op.** ...
- Citation interpreted or overridden: rulebook/02-action-cards-and-resolution.md, "End of Game" (p.2) — "Once a player has broken all 3 of their opponent's Guard cards, they have knocked them out and immediately win the game!" — establishes that a legal game ends the instant the third Guard breaks ...
- Rationale: Designer's call at the `punch` ask gate (Open Question C). ...
```
Three fields, exactly: `Decision:` / `Citation interpreted or overridden:` / `Rationale:` — free
prose, no structured supersession syntax (confirmed: only ~3/62 real rulings across both games use
a supersede verb at all, one direction-reversed — e.g. Ruling 26's "This supersedes provisional
DECISIONS.md Decision 4" is itself just prose inside the `Decision:` field, not a separate
field). Decision 7's append writes a NEW `### Ruling N` entry (N = highest existing + 1) using
THIS EXACT shape, embedding `quotedPass1`/`quotedPass2` verbatim inside `Decision`/`Citation` prose.

**The number-assignment authority to reuse, not re-derive:** `trace-check.ts` already has a
`### Ruling (\d+)` matching regex (used for its untested-ruling sweep, READ-ONLY — grep confirmed
no write path anywhere touches `RULINGS.md` today). Import/reuse that matching logic (or extract
it to a shared helper) for finding the highest existing ruling number — never write a second,
subtly-different regex (Pitfall 2 in 175-RESEARCH.md).

---

## Shared Patterns

### Machine-owned fenced region (decision 2/18)
**Source:** `src/cli/commands/chunk-provenance.ts` lines 218-332 (`VERIFIED_AGAINST_*` constants +
`renderVerifiedAgainstSection`)
**Apply to:** the new rules-staleness marker section in CHUNK.md
```typescript
export const VERIFIED_AGAINST_HEADING = '## Verified Against';
export const VERIFIED_AGAINST_BEGIN = '<!-- boardsmith:verified-against:begin -->';
export const VERIFIED_AGAINST_END = '<!-- boardsmith:verified-against:end -->';
```
A DISTINCT heading + DISTINCT fence-sentinel pair per section — never share a fence pair across
two unrelated machine-owned regions.

### Line-anchored section lookup (f73153a3)
**Source:** `src/cli/commands/chunk-provenance.ts` line 395, `parseVerifiedAgainst` line 573
(`findHeadingIndex` from `build-manifest.js`)
**Apply to:** any new section-locate helper this phase writes
```typescript
const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
const headingIdx = headingMatch ? headingMatch.index : -1;
```
Never a bare `indexOf(heading)` — a prose mention of the heading text elsewhere in the file (e.g.
inside a PARSE CONTRACT comment or another section's explanatory prose) is a real, previously-hit
defect class, not a theoretical one.

### Exactly one atomic ledger write path (decision 17 / CR-01)
**Source:** `src/cli/commands/verify-run.ts` exports (`atomicWriteFile`, `appendLedgerLine`,
`locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow`)
**Apply to:** the impact map's persistence
Add a new ledger record `kind` (mirroring how 174-02 added `kind: 'classification'` alongside the
pre-existing `kind: 'unit'`/`'range-complete'`/`'range-reset'` records) — never a second
standalone-file write path or a second atomic-write implementation.

### Findings exit 0; only tool failure is non-zero
**Source:** `src/cli/commands/drift-check.ts` doc comment lines 182-184, `chunk-provenance.ts`
lines 505-511
**Apply to:** `verify-impact.ts`'s command actions
A contradictory finding, a stale chunk, an unresolved citation — none of these ever set
`process.exitCode`. Only a structural tool failure (no `chunks/`, no `rulebook/`, corrupted fences)
throws or sets a non-zero code.

### `--project`/`--json` option convention
**Source:** every command in `src/cli/commands/` (`chunk-provenance.ts`, `drift-check.ts`,
`verify-classify.ts`, `verify-run.ts`)
**Apply to:** all new `verify-impact-*` commands
```typescript
options: { project?: string; json?: boolean } = {}
const projectDir = resolve(options.project ?? process.cwd());
```

### Format `--json`, never compute (skill-text ↔ CLI split)
**Source:** `check-status.md` Item 8 (lines 108-127), `verify-game.md` Step 4 (lines 104-106)
**Apply to:** every new/modified `bs-*` skill-text file this phase touches
Skill text formats a CLI command's `--json` output for human presentation; it never performs its
own arithmetic on counts, percentages, or classifications. This is the PROV-03 split held
throughout Phases 171-174.

### Cite, never restate `state-machine.md`
**Source:** every existing `bs-*` skill file (e.g. `verify-game.md` line 3, `check-status.md`
lines 8-9)
**Apply to:** all skill-text edits in this phase
Every `bs-` skill links to the relevant `state-machine.md` section instead of copying its rule
text — new prose in `verify-game.md`'s adjudication-gate step and `check-status.md`'s new item
must follow this convention, not duplicate Write Order/Authority/Cold-Resume Parse Contract prose
inline.

## No Analog Found

None. Every file in this phase's scope has a directly measured, concrete analog — this is a
composition/extension phase, not a greenfield one (per 175-RESEARCH.md's Summary: "almost entirely
mechanical CLI/skill-text extension of code that already exists and already works").

## Metadata

**Analog search scope:** `src/cli/commands/`, `src/cli/slash-command/bs/`,
`src/cli/slash-command/bs/templates/`, `src/cli/slash-command/bs/build/`, `src/cli/cli.ts`,
`~/BoardSmithGames/one-two-punch/RULINGS.md`
**Files scanned:** `chunk-provenance.ts` (874 lines, full), `drift-check.ts` (405 lines, full),
`verify-classify.ts` (lines 860-1080), `verify-run.ts` (lines 1-210), `state-machine.md` (331
lines, full), `verify-game.md` (144 lines, full), `build/ask.md` (lines 140-195), `cli.ts` (lines
185-325), `CHUNK.template.md` (203 lines, full), `SKETCH.template.md` (128 lines, full),
`templates.test.ts` (lines 1-90), `build-chunk.test.ts` (grep only), `status-tools.test.ts` (grep
only), `check-status.md` (170 lines, full), `trace-check.ts` (grep only), `RULINGS.md` (grep +
lines 1-20, 155-180)
**Pattern extraction date:** 2026-07-30
