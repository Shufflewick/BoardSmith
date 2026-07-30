# Phase 177: Derived-Line Re-Derivation - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 8 (4 new, 4 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/verify-derive-recheck.ts` (new) | service/CLI-command | event-driven (enumerate → dispatch → validate → record) | `src/cli/commands/verify-ruling-recheck.ts` (Phase 176) | exact |
| `src/cli/commands/verify-derive-recheck.test.ts` (new) | test | — | `src/cli/commands/verify-ruling-recheck.test.ts` (Phase 176) | exact |
| `src/cli/slash-command/bs/verify/derive-recheck.md` (new, blind-derive contract) | judgment-subagent-contract | request-response | `src/cli/slash-command/bs/verify/classification-subagent.md` ("Your inputs" restriction shape) | role-match |
| `src/cli/slash-command/bs/verify/derive-compare.md` (new, comparison contract) | judgment-subagent-contract | request-response | `src/cli/slash-command/bs/verify/ruling-recheck.md` (Phase 176, four-verdict shape) | exact |
| `src/cli/commands/verify-classify.ts` (modified, decision 13 regex fix) | utility | transform | itself (existing `PRESENTATION_EXCLUSION_MARKERS`/`isPresentationLine`, lines 93-106) | exact — in-place fix |
| `src/cli/cli.ts` (modified, command registration) | config/route | request-response | `verify-ruling-recheck` registration block, lines 388-401 | exact |
| `src/cli/slash-command/bs/verify-game.md` (modified, new step + stale-claim sweep) | config/route | request-response | Phase 176's Step 5/6 insertion (176-04) | exact |
| `src/cli/commands/install-claude-command.ts` (modified, leaf probes) | config | file-I/O | existing `SHARED_LEAF_PROBES` array, lines 67-78 | exact |

## Pattern Assignments

### `src/cli/commands/verify-derive-recheck.ts` (service/CLI-command, event-driven)

**Analog:** `src/cli/commands/verify-ruling-recheck.ts` (389 lines, full file read)

This is a near-line-for-line structural mirror. Copy the file's overall shape section-by-section;
do not invent a different structure.

**Module doc-comment pattern** (lines 1-16) — states what the CLI does NOT do (judge) as
explicitly as what it does:
```ts
import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { parseRulings } from './build-manifest.js';
import { atomicWriteFile, RUN_ID_RE, stagingSlicesDir } from './verify-run.js';

/**
 * `verify-ruling-recheck.ts` — CHECK-01's mechanical half ... this module only validates
 * that verdict against the frozen enum and persists it. In particular, this module contains NO
 * absence-detecting keyword list and NO verdict heuristic ... recognizing X is subagent
 * judgment, never a string match here.
 */
```
CHECK-04's equivalent doc comment must state: this module contains no rule-bearingness keyword
list (decision 2) and its own quote-line filter never leaks a `Derived`/`Visual` line into the
blind-derivation payload (decision 5) — the two "what this module refuses to do" guarantees this
phase actually needs, mirroring the shape but not the content of 176's guarantee.

**Frozen four-value enum** (lines 28-35) — copy verbatim shape, swap values:
```ts
export const RULING_VERDICTS = Object.freeze([
  'still-needed', 'resolved-by-source', 'contradicted', 'undetermined',
] as const);
export type RulingVerdict = (typeof RULING_VERDICTS)[number];
function isRulingVerdict(value: string): value is RulingVerdict {
  return (RULING_VERDICTS as readonly string[]).includes(value);
}
```
→ becomes (per 177-CONTEXT.md decision 6):
```ts
export const DERIVE_VERDICTS = Object.freeze([
  'agrees', 'disagrees', 'underivable', 'not-rule-bearing',
] as const);
export type DeriveVerdict = (typeof DERIVE_VERDICTS)[number];
```

**Single validation choke point** (`createRulingVerdictRecord`, lines 59-84) — the ONE place a
verdict string is checked against the enum; throws on out-of-enum verdict OR empty reasoning:
```ts
export function createRulingVerdictRecord(input: {
  number: number; verdict: string; reasoning: string; supersededBy?: number;
}): RulingVerdictRecord {
  if (!isRulingVerdict(input.verdict)) {
    throw new Error(`Invalid verdict "${input.verdict}" for Ruling ${input.number}.\n` +
      `Expected one of: ${RULING_VERDICTS.join(', ')}.`);
  }
  if (input.reasoning.trim().length === 0) {
    throw new Error(`Ruling ${input.number}'s verdict has no recorded reasoning.\n` + ...);
  }
  return { number: input.number, verdict: input.verdict, reasoning: input.reasoning, ... };
}
```
CHECK-04's `createDeriveVerdictRecord` needs a STRICTER version per decision 8: for a `disagrees`
verdict specifically, both `originalReading` and `rederivedReading` must be non-empty verbatim
quotes, not just non-empty `reasoning`. Model the extra field-presence check as an additional `if`
block in the same choke-point function — never a second validator elsewhere.

**Enumeration with skip/report split** (`enumerateRulingsForRecheck`, lines 124-146) — the shape
to reuse (enumerate everything surviving a mechanical filter; report ambiguity, never silently
drop it). CHECK-04's enumeration stage is simpler (no supersession concept for `Derived` lines)
but must keep the same "surviving a mechanical filter, report anything not resolved" posture:
mechanically filter with `isPresentationLine` (imported from `verify-classify.js`, decision 1),
then every surviving `Derived` line is enumerated for judgment — no second enumeration function.

**Do NOT reuse `resolveFreshTranscription`** (lines 186-251) as-is. It resolves the STAGED tree
under `rulebook/.verify/<runId>/slices/`. CHECK-04 targets LIVE slices (decision 12) — read the
live `rulebook/*.md` tree directly, mirroring `verify-classify.ts:585-613`'s live-slice read
(excluding `INDEX.md` and `00-visual-survey.md` — see the Blind-Dispatch Payload section below).

**Report command shape** (`verifyRulingRecheckCommand`, lines 299-364) — mirror exactly:
`--project`/`--run-id`/`--json` options, `console.log(JSON.stringify(result, null, 2))` early
return under `--json`, chalk-yellow scope-limited warning, chalk-green summary line, per-row
console output, findings-never-exit-nonzero (no `process.exitCode` set anywhere), tool-failure
throws a single actionable line naming the missing file/dir and `--project` — no stack frame, no
`.ts:` reference:
```ts
let rulingsText: string;
try {
  rulingsText = await fs.readFile(rulingsPath, 'utf-8');
} catch {
  throw new Error(
    `No RULINGS.md found in this project directory.\n` +
      `Pass --project <dir> to target the bs-project this run should read.`,
  );
}
```

**Atomic ledger write** (`recordRulingVerdicts`, lines 372-388) — the ONE place this module
writes durably, always through `atomicWriteFile`:
```ts
export async function recordRulingVerdicts(
  projectDir: string, runId: string, records: RulingVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const runRoot = join(stagingSlicesDir(projectDir, runId), '..');
  const ledgerPath = join(runRoot, 'RULING-VERDICTS.md');
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Ruling Verdicts — run ${runId}\n\n` +
    `<!-- boardsmith:ruling-verdicts:begin -->\n` +
    lines.join('\n') + (lines.length > 0 ? '\n' : '') +
    `<!-- boardsmith:ruling-verdicts:end -->\n`;
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}
```
CHECK-04 has no run-id prerequisite per decision 14 ("no `--run-id` scope... project-scoped,
reuses the single atomic write path") — write a project-level ledger sibling (e.g.
`rulebook/.derive-recheck/DERIVE-VERDICTS.md`), same `atomicWriteFile` import, same fenced-body
JSON-lines shape, never a second write function.

**The blind-dispatch payload filter — genuinely new code, no direct analog.** Needed: a filter
that selects ONLY quoted-rulebook-content lines from a slice, excluding `Derived`/`Visual`/
`Named-but-undefined` lines ENTIRELY (not merely the presentation-tagged subset `isPresentationLine`
excludes). None of `verify-classify.ts`'s existing functions do this — `ruleBearingLines()` KEEPS
unqualified `Derived` lines; CHECK-04 needs the opposite selection. Build on the SAME machinery
`verify-classify.ts` already exposes rather than re-deriving line classification from scratch:
```ts
// Existing building blocks to compose from (verify-classify.ts:93-141):
const CITATION_HEADER_RE = /^p\.\d+,.*:$/;   // bare `p.N, <label>:` header — line 115
// isPresentationLine(line) — lines 103-106
// A quote line, for CHECK-04's purposes, is any non-blank, non-heading, non-citation-header
// line that does NOT start with `Derived (p.` or `Visual (p.` — the inverse of what
// ruleBearingLines() keeps for the `Derived` case.
```
Write this as a new exported function in `verify-derive-recheck.ts` itself (it is 177-specific,
not a `verify-classify.ts` export decision 1 locks reuse of) — name it something like
`quoteLinesOnly(sliceText): string[]`, and pin it with a test asserting zero `Derived (p.`/
`Visual (p.` lines ever survive the filter, against both real reference-game slices.

**Live-slice read target** (`computeRunPairs`, `verify-classify.ts:585-613`) — the correct
source of "which files are slices" (excludes `INDEX.md` and `00-visual-survey.md`):
```ts
const rulebookDir = join(projectDir, 'rulebook');
const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
ruleFileNames = entries
  .filter((e) => e.isFile() && e.name.endsWith('.md') &&
    e.name !== 'INDEX.md' && e.name !== '00-visual-survey.md')
  .map((e) => e.name).sort();
const liveSlices = await Promise.all(
  ruleFileNames.map(async (name) => ({
    path: `rulebook/${name}`,
    text: await fs.readFile(join(rulebookDir, name), 'utf-8'),
  })),
);
```
CHECK-04 reads this same live tree directly — no staged-tree resolution function needed at all
(decision 12; Pitfall 3 in RESEARCH.md).

---

### `src/cli/commands/verify-derive-recheck.test.ts` (test)

**Analog:** `src/cli/commands/verify-ruling-recheck.test.ts` (not yet read line-by-line here, but
its existence and naming convention is the direct precedent — colocated, same-named-with-`.test`
suffix, mirrors `verify-ruling-recheck.ts`'s exported surface one test block per export).

Required pinning tests, per RESEARCH.md's Phase Requirements → Test Map (SC-1/2/3):
- `createDeriveVerdictRecord`-equivalent: throws on out-of-enum verdict; throws on empty
  `reasoning`; throws on `disagrees` with empty `originalReading`/`rederivedReading` (decision 8).
- `quoteLinesOnly()`: zero `Derived (p.`/`Visual (p.` survivors on real slice fixtures from both
  reference games.
- Source-free-by-construction: a before/after whole-project byte-hash test mirroring
  `trace-check.ts`'s T-171-19 class (see `chunk-provenance.ts:706-714` for the exact style) —
  proves no rulebook PDF/archive path is ever opened.
- `isPresentationLine` reuse pin: import directly from `verify-classify.js`, never re-declare the
  regex array locally (a duplicate-definition drift guard, same spirit as `verify.test.ts`'s
  "does not restate a hardcoded ... list" tests below).

---

### `src/cli/slash-command/bs/verify/derive-recheck.md` (judgment-subagent-contract, blind derivation)

**Analog:** `src/cli/slash-command/bs/verify/ruling-recheck.md` for overall shape (178 lines, full
file read) + `classification-subagent.md`'s "Your inputs" restriction discipline (lines 40-52,
full file read).

**Dispatch-token validation FIRST** (`ruling-recheck.md:18-37`) — copy this block's structure
verbatim, new token:
```
## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading either input, check that the prompt you
were dispatched with contains the exact token `BS-DERIVE-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

DISPATCH REJECTED — missing BS-DERIVE-V1 token.

You composed this dispatch prompt instead of copying the pointer block from
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-dispatch.md` (or whichever orchestrator dispatched
you). Re-read that file and send the pointer block verbatim, including the token.

A composed prompt cannot be trusted to carry the blind-independence rule intact — the token is
proof this block was copied, not recalled, because it cannot be produced from memory.
```

**"Your inputs" section — the structural-independence enforcement point** (mirrors
`classification-subagent.md:40-52`'s "exactly three things" discipline, but INVERTED — this
contract must state what it does NOT receive):
```
The dispatching prompt gives you exactly ONE thing:

- **This slice's quote lines** — every directly-quoted rulebook sentence and citation header,
  with every `Derived (p.` and `Visual (p.` line already stripped out by the orchestrator before
  you ever see this prompt.

You are NEVER given the `Derived` line you are re-deriving, any other `Derived` line from this or
any slice, or any `Visual` line. If you believe you can infer what the original derivation said
from context, you cannot — it was never included. Read exactly what you were given and nothing
else; do not ask for or assume access to the live `rulebook/` files.
```

**Rule-bearingness taught via worked absence-style trap, NOT a phrase list** — mirror the "absence-
of-source trap" section shape (`ruling-recheck.md:96-131`) exactly: one real named worked example,
naming both plausible wrong answers and why each is catastrophic. Use a real `seven`-side
unqualified page-layout `Derived` line (per RESEARCH.md Assumption A3 and Pitfall 1 — e.g. the
`02-solo-variant.md:17` / `01-definitions-and-components.md:33` area) as the worked example for
`not-rule-bearing`, and a real diagram-dependent line (`seven`'s deck-math line, whose supporting
fact is itself a `Derived` diagram-description line — RESEARCH.md Question 2) as the worked
example for `underivable`. Never supply a keyword/trigger-phrase list for either verdict
(decision 2; Anti-Pattern in RESEARCH.md).

**RETURN shape — no verdict field at all** (decision 7's split — this contract returns a
derivation, not a verdict):
```
{
  rederivedValue: string | 'not-rule-bearing' | 'underivable',
  sourceQuotes: string[]   // the specific quote lines this derivation drew on; empty if not-rule-bearing
}
```
Mirror `ruling-recheck.md:147-165`'s "single enumerated object, no slice bodies returned beyond
the specific quotes" discipline exactly — never return the full quote-lines payload back.

**Scope limit paragraph** (mirror `ruling-recheck.md:169-177`): this subagent never writes any
file, never decides `agrees`/`disagrees` (that is the SEPARATE comparison dispatch's job), never
opens a live slice beyond the quote lines it was handed.

---

### `src/cli/slash-command/bs/verify/derive-compare.md` (judgment-subagent-contract, comparison)

**Analog:** `ruling-recheck.md`'s four-verdict RETURN shape and reasoning-is-the-artifact
discipline (lines 73-92, 147-165) — this contract's shape is closer to 176's than the blind-derive
contract above, because it DOES see both sides and DOES return a verdict.

**Dispatch-token** — separate token, `BS-DERIVE-COMPARE-V1`, same rejection-block shape as above.

**"Your inputs" — this contract legitimately receives what the blind-derive contract must not**:
```
The dispatching prompt gives you exactly two things:

- **The original `Derived` line**, verbatim, as recorded in the live slice.
- **The blind-derivation subagent's recorded `rederivedValue`** (and, if present, its
  `sourceQuotes`) — the OTHER subagent's output, never anything it composed after seeing this
  input.

You are comparing two ALREADY-PRODUCED readings — you do not re-derive anything yourself, and you
never open the live slice to check either reading against a third source.
```

**Four verdicts, mirroring `ruling-recheck.md:73-88`'s shape and decision 6's load-bearing
`underivable`:**
```
- **`agrees`** — the rederived value and the original state the same fact, in substance.
- **`disagrees`** — the two state incompatible facts.
- **`underivable`** — the blind-derivation subagent itself returned `underivable` (or a value
  that plainly could not have come from quote lines alone) — pass this through, never
  re-adjudicate it into agrees/disagrees.
- **`not-rule-bearing`** — the blind-derivation subagent returned `not-rule-bearing` — pass this
  through unchanged.
```
State explicitly (per decision 6 and the first-class-blindness principle already applied six
times this milestone — drift-unknown, unknown provenance, unclassified, unknown-drift,
undetermined): never collapse `underivable` into `agrees` or `disagrees` to avoid an "incomplete"
answer.

**RETURN shape — decision 8's "cite both derivations" requirement**:
```
{
  verdict: 'agrees' | 'disagrees' | 'underivable' | 'not-rule-bearing',
  reasoning: string,
  originalReading: string,     // verbatim quote of the original Derived line
  rederivedReading: string,    // verbatim quote of the blind-derivation's rederivedValue
}
```
`originalReading`/`rederivedReading` are REQUIRED and verbatim for `disagrees` specifically
(mirrors `classification-subagent.md:171-177`'s "`quotedPass1` must be an exact, byte-for-byte
substring" discipline — apply the identical byte-for-byte requirement here, for the same
downstream-attribution reason).

---

### `src/cli/commands/verify-classify.ts` (modified — decision 13's regex fix)

**Current code, exact (lines 93-106)** — the fix target:
```ts
export const PRESENTATION_EXCLUSION_MARKERS = Object.freeze([
  '^Visual \\(p\\.\\d+\\):',
  '^Derived \\(p\\.\\d+\\) — diagram description:',
  '^Derived \\(p\\.\\d+\\) — art:',
] as const);

export function isPresentationLine(line: string): boolean {
  const trimmed = line.trim();
  return PRESENTATION_EXCLUSION_MARKERS.some((source) => new RegExp(source, 'i').test(trimmed));
}
```

**The gap (verified live-tested, RESEARCH.md):**
```
isPresentationLine("Derived (p.1) — diagram description: A layout diagram...")            → true
isPresentationLine("Derived (p.1) — diagram description (Plan phase): Two boxer cards...") → false  // GAP
isPresentationLine("Derived (p.1) — diagram description (Fight phase): Two action...")     → false  // GAP
isPresentationLine("Derived (p.2) — art: A full-color illustration...")                    → true
```
The regex requires the colon IMMEDIATELY after `description`/`art` — no parenthetical qualifier
tolerated. 4 of `one-two-punch`'s 6 dash-qualified lines slip: `— diagram description (Plan
phase):`, `(Fight phase):`, `(first Punch example):`, `(second Punch example):`.

**The fix (widen to allow an optional parenthetical before the colon):**
```ts
export const PRESENTATION_EXCLUSION_MARKERS = Object.freeze([
  '^Visual \\(p\\.\\d+\\):',
  '^Derived \\(p\\.\\d+\\) — diagram description(?: \\([^)]*\\))?:',
  '^Derived \\(p\\.\\d+\\) — art(?: \\([^)]*\\))?:',
] as const);
```
(Confirm the exact widened pattern in the plan/task — the key requirement is: an optional
`(qualifier)` group before the colon, tested against the 4 REAL slipping lines named above, not
invented cases. `classification-subagent.md:88` already states the correct rule prose-wise —
"An unqualified `Derived (p.N):` line — no ` — diagram description` or ` — art` qualifier —
stays rule-bearing" — key on the qualifier's PRESENCE, matching that correct prose.)

**Test to extend:** find `verify-classify.ts`'s existing pinning test for
`PRESENTATION_EXCLUSION_MARKERS`/`isPresentationLine` (likely `verify-classify.test.ts`, not read
directly this pass — locate via `grep -rn "isPresentationLine" src/cli/commands/*.test.ts`) and
add the 4 real slipping lines as new `true`-expected cases, plus a regression case confirming the
existing 2 unqualified forms still return `true` and the bare `Derived (p.N):` (no dash at all)
still returns `false`.

**174-PROOF.md note (do not re-run 174's proof):** document in `174-PROOF.md` that its recorded
`lineFindings[]` came from the subagent layer (whose prose rule was already correct), not from
this mechanical constant — the mechanical gate is a second filter, not the source of those
findings. This is a documentation addition to an existing closed-phase PROOF file, not new code.

---

### `src/cli/cli.ts` (modified — command registration)

**Analog:** the `verify-ruling-recheck` registration block, lines 388-401 (full block read):
```ts
// CHECK-01 / CHECK-02 (176-CONTEXT.md): re-checking every RULINGS.md entry against the fresh
// staged transcription, and reporting each rules-stale chunk's next repair step. Neither command
// registers a bypass option of any kind — the same no-bypass discipline verify-impact-* holds.
program
  .command('verify-ruling-recheck')
  .description(
    "Re-check every RULINGS.md entry against the fresh staged transcription, reporting one of " +
      'four verdicts (still-needed / resolved-by-source / contradicted / undetermined) per ' +
      'non-superseded ruling (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report against a specific verify run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRulingRecheckCommand);
```
CHECK-04's registration mirrors this exactly, minus `--run-id` (decision 14 — no run-id scope) and
plus the import line (`import { verifyDeriveRecheckCommand } from './commands/verify-derive-
recheck.js';` alongside the existing `verify-ruling-recheck` import at line 39). Also add a
`recordDeriveVerdicts`-invoking recording command if the CLI surface needs a separate record verb
(mirror whatever `verify-ruling-recheck`'s sibling recording command is named, if one exists
distinct from the report command — check `cli.ts` around line 401 for a paired
`verify-ruling-record`-style command before assuming report and record are the same command).

---

### `src/cli/slash-command/bs/verify-game.md` (modified — new step + stale-claim sweep)

**Analog:** Phase 176's own Step 5/6 insertion — the exact same maneuver CHECK-04 needs to repeat
for a Step 7 (or wherever Claude's Discretion places it — RESEARCH.md recommends between Step 6
Repair Dispatch and Step 7 Close, since CHECK-04 is explicitly independent of staleness/repair).

**Current structure, confirmed by direct read** (this session, full 201-line file):
- Step 0: State Detection and Lock (VERIFY-01) — lines 48-71
- Step 1: Source Resolution (VERIFY-01) — lines 73-80
- Step 2: Staging Run and Re-Transcription (VERIFY-02/07/08) — lines 82-90
- Step 3: Classification (VERIFY-03/07) — lines 92-101
- Step 4: Adjudication Gate and Impact Map (VERIFY-04/05/06) — lines 103-117
- Step 5: Ruling Re-Check (CHECK-01) — lines 119-129
- Step 6: Repair Dispatch (CHECK-02) — lines 131-144
- Step 7: Close (VERIFY-02) — lines 146-161
- Reference Files — lines 163-200

**Step 5's prose is the direct template for the new step** (lines 119-129):
```
## Step 5: Ruling Re-Check (CHECK-01)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` for the full judgment
contract. In short: every `RULINGS.md` entry without a resolved `supersededBy` (parsed once, via
`parseRulings` — the one ruling parser in this repo, never a second regex path) is dispatched, in
turn, to a fresh-context subagent carrying the `BS-RULING-RECHECK-V1` handshake token, together
with that ruling's own full body text (Decision/Citation/Rationale) and the fresh STAGED
transcription only — never the live `rulebook/` slices. Each subagent returns exactly one of
`still-needed`, `resolved-by-source`, `contradicted`, or `undetermined`, with mandatory reasoning,
recorded via `boardsmith verify-ruling-recheck`. This orchestrator never reads a ruling body or a
slice itself; it dispatches, then records exactly what comes back.
```
The new CHECK-04 step's prose must state, in the SAME "in short" compressed form: (a) every
`Derived` line surviving `isPresentationLine` exclusion is enumerated project-wide (decision 3 —
ALL 22 lines, not scoped to stale chunks); (b) each is dispatched BLIND (only quote lines, never
the original line — decision 5, structural) to `BS-DERIVE-V1`; (c) a SEPARATE dispatch, carrying
both readings, goes to `BS-DERIVE-COMPARE-V1` for the verdict (decision 7); (d) findings quoting
both derivations verbatim are reported, exit 0, never gating Close (decision 15).

**Renumbering Close.** Inserting a step before Close pushes it from Step 7 to Step 8 (or wherever
placed) — `verify.test.ts:626-634`'s contiguity test requires 0-indexed, no gaps; run the full
numeric renumber, not a spliced insertion that leaves a duplicate or gap.

**The no-hardcoded-step-count regex only catches spelled-out words `five`-`nine`** (RESEARCH.md,
`verify.test.ts:638` / this session's read at line 636-640) — it does NOT catch `four` or digit
counts. Sweep the prose for ANY spelled-out or digit step count beyond what that regex guards
(e.g. an "eight-step skill" or "9 steps" sentence anywhere in the file), per Pitfall/precedent
from 176-04.

**Full stale-claim sweep — quote EVERY claim this phase could falsify, with line numbers, plus
claims checked and confirmed still true:**

- Lines 25-27 ("Comparison happens in Step 3... no staged slice ever takes a live one's place...
  no flag or path anywhere in this skill that writes staged output into a live location") —
  **CONFIRMED STILL TRUE.** CHECK-04 touches only live slices (decision 12), introduces no
  staged-to-live promotion path. No revision needed, but note in the plan that this was
  specifically re-verified after CHECK-04's insertion, not merely assumed.
- Lines 37-46 (`## Context-Economics Hard Rule` — "this skill's own transcript should never
  contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line") — **NEEDS AN
  EXPLICIT CARVE-OUT NOTE, not a text revision.** CHECK-04's own dispatch prompts legitimately DO
  carry quote lines (to `BS-DERIVE-V1`) and a `Derived (p.` line (to `BS-DERIVE-COMPARE-V1`, per
  decision 8). This is the SAME exception already documented for the classification subagent's
  RAW RETURN in `174-PROOF.md` §3 (`quotedPass1`/`quotedPass2`) — state explicitly in this file
  (or in `derive-recheck.md`'s / `derive-compare.md`'s own scope-limit paragraphs) that the
  exception belongs to the SUBAGENT dispatch prompt/return, never the orchestrator's own
  transcript, which still shows zero slice-body lines. Do not silently assume the existing
  sentence is falsified — state the distinction, mirroring 174's precedent.
- Lines 113 (`REPAIR_GATE_DISPOSITIONS` cited, never restated) — **CONFIRMED STILL TRUE**, no
  restatement introduced by this phase's changes.
- Lines 146-149 (Close condition: "`verify-run-status` reports every unit recorded and
  `verify-classify-status` reports every pair classified") — **OPEN DESIGN DECISION, not
  automatically stale.** Per decision 15 (CHECK-04 reports, does not gate Close), this sentence
  stays accurate AS-IS if CHECK-04 is invoked as its own ungated step — do not add a third
  condition unless a later plan explicitly decides CHECK-04 gates Close (it should not, per
  decision 15's explicit text).
- Lines 163-200 (Reference Files list) — **NEEDS a new bullet** for `derive-recheck.md` and
  `derive-compare.md` (or however the plan names the two contract files), one-line-bullet style,
  mirroring the existing `ruling-recheck.md` bullet at lines 177-178. `verify.test.ts:619-624`'s
  "lists both new routes in Reference Files" test is the precedent pattern — a CHECK-04-specific
  version of that exact test must be added (see `verify.test.ts` section below).
- Lines 190-200 (installer-layout paragraph naming `install-claude-command.ts` and the
  `verify/`, `ingest/`, `state-machine.md` leaf-probe contract) — **CONFIRMED STILL TRUE as
  written**; no revision needed unless the plan places the two new contract files somewhere other
  than `bs-shared/verify/` (it should not — decision/analog above keeps them there).

---

### `src/cli/commands/install-claude-command.ts` (modified — leaf probes)

**Analog:** `SHARED_LEAF_PROBES` array, lines 67-78 (full array read):
```ts
const SHARED_LEAF_PROBES = [
  join(SHARED_ROOT, 'state-machine.md'),
  join(SHARED_ROOT, 'build', 'build.md'),
  join(SHARED_ROOT, 'ingest', 'transcription.md'),
  join(SHARED_ROOT, 'templates', 'SKETCH.template.md'),
  join(SHARED_ROOT, 'aspects', 'index.md'),
  join(SHARED_ROOT, 'verify', 'source-resolution.md'),
  join(SHARED_ROOT, 'verify', 'classification-subagent.md'),
  join(SHARED_ROOT, 'verify', 'adjudication-gate.md'),
  join(SHARED_ROOT, 'verify', 'ruling-recheck.md'),
  join(SHARED_ROOT, 'verify', 'repair-dispatch.md'),
];
```
Add two new entries, same style, one per new contract file:
```ts
  join(SHARED_ROOT, 'verify', 'derive-recheck.md'),
  join(SHARED_ROOT, 'verify', 'derive-compare.md'),
```
This array feeds BOTH `expectedInstallPaths()` (lines 104-109, complete-vs-partial install
detection) and (indirectly, via `ownedPaths`/directory copy) the installer's recursive copy of
`SHARED_DIRS` (line 59, already includes `'verify'` — no change needed there, since `verify/` as a
whole directory is already copied; only the LEAF PROBE list needs the two new file names to
correctly detect a complete vs. partial install).

---

## Shared Patterns

### Presentation-line exclusion (decision 1 — verbatim reuse)
**Source:** `src/cli/commands/verify-classify.ts:93-106` (`PRESENTATION_EXCLUSION_MARKERS`,
`isPresentationLine`, both already exported)
**Apply to:** `verify-derive-recheck.ts`'s mechanical enumeration stage — import directly, never
redefine.
```ts
import { isPresentationLine } from './verify-classify.js';
```

### Enumerated verdict validation choke point
**Source:** `createRulingVerdictRecord`, `verify-ruling-recheck.ts:59-84`
**Apply to:** `verify-derive-recheck.ts`'s `createDeriveVerdictRecord` — one place a verdict
string is checked against `DERIVE_VERDICTS`; every recording path routes through it.

### Atomic ledger writes — exactly ONE write path in the whole repo
**Source:** `atomicWriteFile`, `src/cli/commands/verify-run.ts:282-...` (exported); consuming
precedent at `recordRulingVerdicts`, `verify-ruling-recheck.ts:372-388`
**Apply to:** any new `recordDeriveVerdicts`-style function. Never `fs.writeFile`/`writeFileSync`
directly (173-REVIEW.md CR-01's defect class).

### Dispatch-token handshake — "copied, not composed" proof
**Source:** `BS-RULING-RECHECK-V1` (`ruling-recheck.md:18-37`), `BS-CLASSIFY-V1`
(`classification-subagent.md:16-37`), `BS-DISPATCH-V2` (`staging-dispatch.md:91-115`)
**Apply to:** both new contracts, with two DISTINCT tokens (`BS-DERIVE-V1` / `BS-DERIVE-COMPARE-V1`)
— a single shared token risks one contract accidentally serving both roles (decision 7's whole
point is that the two dispatches must be genuinely separate).

### Enumerated code sets — frozen array + derived type + pinning test, never a hand-written union
**Source:** `RULING_VERDICTS` (`verify-ruling-recheck.ts:28-35`), `FINDING_KINDS`
(`build-manifest.ts:20-25`), `PAIR_KINDS` (`verify-classify.ts:213`)
**Apply to:** `DERIVE_VERDICTS` in the new command module.

### Source-free-by-construction posture
**Source:** `trace-check.ts:1-15` doc comment + its T-171-19-class before/after byte-hash test
(precedent: `chunk-provenance.ts:706-714`)
**Apply to:** `verify-derive-recheck.ts`'s own doc comment and its own before/after whole-project
byte-hash pinning test — CHECK-04 must never open the archived source, structurally, not by flag
(decisions 4, 14, 15).

### Findings exit 0; non-zero reserved for tool failure
**Source:** `verifyRulingRecheckCommand` (`verify-ruling-recheck.ts:299-364`) never sets
`process.exitCode`; 172-CONTEXT.md decision 6 ("these are advisory sweeps a verify pipeline
consumes, not gates")
**Apply to:** `verify-derive-recheck.ts`'s report command — a disagreement finding never sets a
non-zero exit; only an unreadable project/rulebook throws.

### CLI computes, skill formats `--json`
**Source:** PROV-03's split, `verifyRulingRecheckCommand`'s `if (options.json)` early-return
branch, `verify-game.md:154-156` ("Report the run's classification verdicts to the designer by
formatting `verify-classify-status --json`'s output — formatted, never computed by this skill")
**Apply to:** `verify-game.md`'s new step's report language — cite the JSON, never recompute
counts in prose.

### VERIFY-07-style transcript observable (grep, not assertion)
**Source:** `verify-game.md:37-46`'s "Context-Economics Hard Rule" + 174-PROOF.md §3's
`quotedPass1`/`quotedPass2` exception precedent
**Apply to:** the phase's proof document — grep the raw `BS-DERIVE-V1` dispatch prompt for the
literal string `Derived (p.` (expect ZERO matches, no exception carve-out needed, per
177-RESEARCH.md's answer to Question 3 — this is STRONGER than VERIFY-07's own check since no
exception applies to the blind-derive prompt). Separately grep the `BS-DERIVE-COMPARE-V1` prompt
and its RETURN (expect matches, accounted for, mirroring the `quotedPass1`/`quotedPass2`
precedent). State both explicitly and separately in the proof — never one blanket check.

## No Analog Found

None — every file in this phase's scope has a direct, closed-phase structural precedent. The two
genuinely novel pieces (the blind-dispatch quote-lines-only payload filter, and the two-dispatch
split itself) are new CODE, not new PATTERN SHAPES — the enumerate → filter → dispatch → validate
→ record shape and the judgment-subagent-contract shape both transfer completely from Phase 176.

## Metadata

**Analog search scope:** `src/cli/commands/verify-*.ts`, `src/cli/commands/trace-check.ts`,
`src/cli/commands/build-manifest.ts`, `src/cli/commands/install-claude-command.ts`, `src/cli/cli.ts`,
`src/cli/slash-command/bs/verify/*.md`, `src/cli/slash-command/bs/verify-game.md`,
`src/cli/slash-command/bs/verify.test.ts`
**Files scanned:** 12 (all fully or near-fully read; line numbers cited throughout are from direct
reads this session, not the research doc's citations alone — cross-checked against
177-RESEARCH.md's Sources section)
**Pattern extraction date:** 2026-07-30
