# Phase 174: Verify Classifier - Pattern Map

**Mapped:** 2026-07-29
**Files analyzed:** 8 (2 modified command/skill files with surgical edits, 3 new CLI+test files, 2 new skill/contract files, 1 registration edit)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/verify-classify.ts` (new) | command / ledger-extension | CRUD (append-read) + transform (pairing) | `src/cli/commands/verify-run.ts` | exact (same ledger family, same file it extends) |
| `src/cli/commands/verify-classify.test.ts` (new, colocated) | test | fixture-driven | `src/cli/commands/verify-run.test.ts` | exact |
| `src/cli/commands/verify-run.ts` (modify: export 7 helpers) | command / utility | CRUD | itself (widen exports only) | exact |
| `src/cli/cli.ts` (modify: register 2-4 new subcommands) | route/registration | request-response (CLI args → action) | existing `verify-run-init/-record/-status`, `trace-check`, `drift-check` blocks (`cli.ts:206-264`, `188-204`) | exact |
| `src/cli/slash-command/bs/verify/classification-dispatch.md` (new) | skill delegate (route + subagent dispatch) | event-driven (Task-tool dispatch) | `src/cli/slash-command/bs/verify/staging-dispatch.md` | exact |
| classification subagent contract (new; sibling section or file under `verify/` or `ingest/`) | subagent contract | request-response (structured RETURN) | `src/cli/slash-command/bs/ingest/transcription-subagent.md` | exact |
| `src/cli/slash-command/bs/verify-game.md` (rewrite lines ~19-20, ~96-98) | skill router | request-response | itself, before/after (its own Step 1/Step 2 delegation prose) | exact |
| enumerated `ruleDelta`/`provenance` finding-kind constants + pinning test | config/constant | — | `build-manifest.ts:20-32` (`FINDING_KINDS`) + `ingest-archive.ts:295-326` (`PRESENTATION_LEXICON`) + `ingest.test.ts:494-500` (pin test) | exact |

## Pattern Assignments

### `src/cli/commands/verify-classify.ts` (command, CRUD + transform)

**Analog:** `src/cli/commands/verify-run.ts` (full file is the host/pattern — this is an *extension* of the same ledger, not a fresh design)

**Imports pattern** (verify-run.ts:1-4):
```typescript
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
```
`verify-classify.ts` additionally imports the now-exported ledger helpers from `verify-run.ts` (see the "Reuse blocker" section below) plus `computeVerificationScope`/`parseVerifiedAgainst` from `chunk-provenance.ts` (already exported at lines 95 and 572) and the `FINDING_KINDS`-shape constant convention from `build-manifest.ts`.

**Path-escape guard pattern to copy verbatim** (verify-run.ts:756-763):
```typescript
// T-173-14: --slice must resolve inside this run's staging dir. Validated BEFORE any read, so
// a path pointing outside the run is refused rather than hashed.
const sliceAbs = resolve(stagingDir, slice);
const relToStaging = relative(stagingDir, sliceAbs);
if (relToStaging === '' || relToStaging.startsWith('..') || isAbsolute(relToStaging)) {
  throw new Error(
    `--slice "${slice}" resolves outside run "${runId}"'s staging dir (${relative(projectDir, stagingDir)}).\n` +
      `Pass a path relative to the staging dir that a subagent actually wrote to.`,
  );
}
```
Apply the identical shape to any new path parameter the pairing/status commands accept (e.g. a `--live-slice`/`--staged-slice` pair-id lookup), per RESEARCH.md's Security Domain note.

**Enumerated-kind constant + pinning-test pattern** (build-manifest.ts:19-32):
```typescript
/** The locked finding-kind enum from 172-CONTEXT.md decision 7. Never a hand-written union. */
export const FINDING_KINDS = Object.freeze([
  'claim-untested',
  'ruling-untested',
  // ...
] as const);

export type FindingKind = (typeof FINDING_KINDS)[number];
```
Mirror this shape for two new enums: `PROVENANCE_KINDS = ['source-changed', 'source-unchanged', 'unknown']` (CONTEXT.md decision 2b) and `RULE_DELTA_KINDS = ['cosmetic', 'sharper', 'contradictory', 'unclassified']` (decision 6/8). The presentation-exclusion lexicon (decision 12b: `Visual (p.N):` + legacy `Derived (p.N) — diagram description:`/`— art:`) should follow `PRESENTATION_LEXICON`'s exact shape (`ingest-archive.ts:295-326`) — `Object.freeze([...])`, a doc comment stating it is test-pinned, and cross-file sync verified the same way `ingest.test.ts:494-500` pins `PRESENTATION_LEXICON` against its `scripts/ingest-harness/check.mjs` sibling:
```typescript
// Source: src/cli/slash-command/bs/ingest.test.ts:494-500
const decl = /(?:export\s+)?const\s+PRESENTATION_LEXICON\s*=\s*(?:Object\.freeze\(\s*)?\[/.exec(src);
if (!decl) throw new Error('PRESENTATION_LEXICON declaration not found');
```

**Core CRUD pattern — new ledger record `kind`, appended through the SAME atomic path** (verify-run.ts:107-130, 318-325, 351-411):
```typescript
// Source: pattern extrapolated from verify-run.ts's existing LedgerRecord/RangeMarkerRecord shape
export interface ClassificationRecord {
  kind: 'classification';
  pairId: string;
  unit: string;
  liveSlice: string;
  stagedSlice: string;
  provenance: 'source-changed' | 'source-unchanged' | 'unknown';
  ruleDelta: 'cosmetic' | 'sharper' | 'contradictory' | 'unclassified';
  stale: boolean;          // DERIVED — never accepted as a caller-supplied field
  evidence: string;
  recordedAt: string;
}
```
Extend `parseLedgerBody`'s discriminated union (verify-run.ts:327-337, 384-408) with a fourth branch discriminating on `rec.kind === 'classification'`, following the exact same "malformed → `malformedLines`, never thrown" discipline the existing `range-complete`/`range-reset`/unit branches use (verify-run.ts:372-408). Append via `appendLedgerLine` + `atomicWriteFile` (verify-run.ts:213-229, 318-325) — never a second write path.

**Staleness-derivation pattern (pure function, zero I/O)** — no direct existing analog (this is the one genuinely new mechanical piece), but follow `resolveLedgerState`'s style (verify-run.ts:422-455): a pure function over parsed records, single input → single output, no ambient state:
```typescript
const STALE_BY_RULE_DELTA: Record<RuleDelta, boolean> = {
  cosmetic: false,
  sharper: true,
  contradictory: true,
  unclassified: true,
};
export function deriveStale(ruleDelta: RuleDelta): boolean {
  return STALE_BY_RULE_DELTA[ruleDelta];
}
```
CONTEXT.md decision 3 / RESEARCH.md Anti-Patterns: `provenance` must never be a parameter to this function, even optionally.

**Malformed-label normalization pattern** (mirrors `verifyRunStatusCommand`'s tamper-warning idiom, verify-run.ts:910-916):
```typescript
// Source: verify-run.ts:910-916 (tamper-warning shape to mirror, inverted: normalize not reject)
if (sha256(bytes) !== rec.sha256) {
  warnings.push(
    `unit "${rec.unitId}"'s recorded sha256 no longer matches ${rec.slicePath} on disk — ` +
      `treating as NOT recorded (hand-edit or tamper detected)`,
  );
  continue;
}
```
For `verify-classify-record --label <value>`: an out-of-enum or missing `--label` must silently normalize to `'unclassified'` with a `console.error(chalk.yellow(...))` warning naming what was received — never `throw` (CONTEXT.md decision 8; this is the one place the CLI's usual "throw on caller error" convention is deliberately inverted, because a bad label here is a subagent-fidelity failure, not a caller bug).

**Command-function signature + CLI-args idiom to copy** (verify-run.ts:485-487, 666-675, 847-849):
```typescript
export async function verifyRunInitCommand(
  options: VerifyRunOptions & { runId?: string; ranges?: string[] } = {},
): Promise<VerifyRunInitResult> { ... }
```
Every new command function (`verifyClassifyEnumeratePairsCommand`, `verifyClassifyRecordCommand`, `verifyClassifyStatusCommand`) should take one `options` object defaulting to `{}`, spread `VerifyRunOptions`-shaped `{ project?, json? }`, and return a typed `*Result` interface — never `void`, never throwing for a normal "nothing to report" case.

**`--json` / human-output split** (verify-run.ts:533-545, 944-958):
```typescript
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}
console.log(chalk.green(...));
// ...human-readable lines...
return result;
```

**Error-handling / actionable-message pattern** (verify-run.ts:145-154, 494-499, 576-580):
```typescript
throw new Error(
  `Invalid --run-id "${runId}".\n` +
    `Expected the shape YYYY-MM-DDTHH-MM-SSZ (UTC, colons replaced by "-"), e.g.\n` +
    `2026-07-28T22-18-00Z. Omit --run-id to mint a fresh one, or pass the exact value\n` +
    `\`boardsmith verify-run-init\` printed for the run you want to resume.`,
);
```
Every thrown error: one line naming exactly what was wrong, then 1-3 lines naming the actionable fix — never a stack trace, never an internal path (CLAUDE.md).

**Reuse blocker — MUST resolve before writing classify logic (RESEARCH.md Pitfall 1):**
`atomicWriteFile`, `appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow` are module-private in `verify-run.ts` today (no `export` keyword — verified directly at lines 213, 318, 254, 351, 422, 193, 568). Add `export` to all seven, and export `ParsedLine`/`ParsedUnitLine`/`ParsedMarkerLine` (or a widened union including a new `ParsedClassificationLine`) so `verify-classify.ts` can extend the discriminated union without a second parser. Do this as its own first task, before any classification logic, exactly as `RESEARCH.md`'s Pitfall 1 recommends.

---

### `src/cli/commands/verify-classify.test.ts` (test, colocated)

**Analog:** `src/cli/commands/verify-run.test.ts`

**Fixture-setup pattern to reuse/mirror** (verify-run.test.ts:1-66):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  verifyRunStatusCommand,
  stagingSlicesDir,
  RUN_LEDGER_BEGIN,
  RUN_LEDGER_END,
  RUN_ID_RE,
} from './verify-run.js';
import { renderIndex } from './ingest-archive.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-run-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const LIVE_03 = '## 03-setup\n\nLive setup slice content.\n';
const LIVE_07 = '## 07-turn\n\nLive turn slice content.\n';

/** A fixture project with rulebook/INDEX.md and two distinctive live slices. */
async function liveProject(name = 'game'): Promise<string> {
  const project = join(dir, name);
  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: 'game',
      edition: undefined,
      archivedPath: 'rulebook/source/rules.pdf',
      sourceHash: 'deadbeef',
      transcribed: '2026-07-28',
    }),
  );
  await fs.writeFile(join(rulebookDir, '03-setup.md'), LIVE_03);
  await fs.writeFile(join(rulebookDir, '07-turn.md'), LIVE_07);
  return project;
}

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text)).digest('hex');
}
```
Use `fs.mkdtemp(join(tmpdir(), 'bs-verify-classify-'))` (own prefix, same mechanism) — **real filesystem temp dirs, no mocks**, matching this file's own comment: "Every fixture here is a real filesystem temp dir... no mocks." A staged-project variant of `liveProject()` should additionally call `verifyRunInitCommand`/`verifyRunRecordCommand` to populate a staging dir with fake staged slices, so classification tests have both a live `rulebook/*.md` tree and a staged run to pair against — reuse the real commands to build the fixture rather than hand-writing ledger JSON.

**Test naming/grouping convention** (verify-run.test.ts:68-80):
```typescript
describe('verifyRunInitCommand — staging + run allocation', () => {
  it('S1: mints a run-id matching the fixed UTC shape and returns it via --json', async () => {
    const project = await liveProject();
    const result = await verifyRunInitCommand({ project, json: true });
    expect(result.runId).toMatch(RUN_ID_RE);
    ...
```
Mirror: one `describe` block per command, one `it` per numbered behavior tag (this phase's tags would be something like `PAIR-1`, `PROV-1`, `STALE-1`, `LEDGER-1` matching RESEARCH.md's Phase Requirements → Test Map).

---

### `src/cli/slash-command/bs/verify/classification-dispatch.md` (skill delegate)

**Analog:** `src/cli/slash-command/bs/verify/staging-dispatch.md` (full file — mirror its section shape exactly: Run Allocation → Resume → Dispatch → Recording → Close)

**Section-shape pattern to copy** (staging-dispatch.md:1-21, 41-53, 91-120, 158-164):
```
# Staging Run + Re-Transcription Dispatch (VERIFY-02, VERIFY-07, VERIFY-08)

This is `verify-game.md` Step 2's delegate — ...

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads a staged slice...**

## Run Allocation
...
## Resume — Before Any Dispatch
...
## Dispatch
...
## Recording
...
## Close
```
The new `classification-dispatch.md` should be `verify-game.md` Step 4's delegate, with the same "Context-Economics Hard Rule" framing restated for the comparison case: *the orchestrator never opens a slice, staged or live — the classification subagent is the ONE place a slice is legitimately read* (already established as the transcript observable in CONTEXT.md decision 1 / RESEARCH.md's State of the Art table row 3).

**BS-DISPATCH-V2 token-discipline pattern to copy verbatim, changing only the pointer target** (staging-dispatch.md:91-119):
```
For each pending range (per Resume above), dispatch one Task-tool subagent. **Do not compose, restate, or
summarize the transcription contract in the dispatch prompt.** The contract lives in
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`; the subagent reads it
directly. Copy this pointer block byte-identical except the last line, filling `Write slices to:`
with the run's `stagingDir` instead of `rulebook/`:

\`\`\`
BS-DISPATCH-V2

Read `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` in full and follow it
exactly.

Your page range: {N}-{M}
Rulebook path:   {rulebookPath}
Write slices to: {stagingDir}
\`\`\`

**The `BS-DISPATCH-V2` token is required and the subagent validates it.** A dispatch without it is
rejected unread. This is not ceremony: sessions reliably read the pointer, then send a prompt
composed from memory instead...
```
For classification: same discipline, new pointer target (the new classification subagent contract file), new fields (`Pair id`, `Live slice path`, `Staged slice path` in place of `Page range`/`Rulebook path`/`Write slices to`), same required token (reuse `BS-DISPATCH-V2` or mint a distinct `BS-DISPATCH-CLASSIFY-V1`-style token — Claude's Discretion, not locked by CONTEXT.md).

**"Ledger, not filesystem, is the source of truth" resume idiom to copy** (staging-dispatch.md:49-53):
```
Dispatch decisions are made at RANGE granularity, against `rangesPending`. **Do not decide what is
done by looking at which files exist in the staging directory.** A truncated slice from a crashed
write is indistinguishable, on disk alone, from a complete one — which is exactly why the ledger
exists...
```
Apply identically to pairs: `verify-classify-status` (never a directory scan) is the only source of truth for which pairs still need classifying.

---

### Classification subagent contract (new file/section)

**Analog:** `src/cli/slash-command/bs/ingest/transcription-subagent.md` (full file — mirror its four-part shape: handshake → inputs → core procedure → structured RETURN)

**Handshake pattern to copy verbatim, changing only the rejection prose specifics** (transcription-subagent.md:18-49):
```
## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before transcribing anything, check that the prompt you
were dispatched with contains the exact token `BS-DISPATCH-V2`.**

If it does not, STOP immediately. Write no slice files. Return exactly this and nothing else:

\`\`\`
DISPATCH REJECTED — missing BS-DISPATCH-V2 token.

You composed this dispatch prompt instead of copying the pointer block from
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md`. ...
\`\`\`
```
For classification: "before comparing anything, check the dispatch prompt for the required token... If missing, STOP. Read no slice. Return `DISPATCH REJECTED`..." — same structural shape, new file names.

**"Your inputs" section pattern** (transcription-subagent.md:52-64) → classification's equivalent: pair id, live slice path(s), staged slice path(s) (plural per RESEARCH.md Pitfall 4's many-to-many pairing), with the same "Do not read outside it" framing.

**Decision-procedure pattern (the ONE judgment section — write this from CONTEXT.md decisions 9-12, 12b, not from this analog, since it's genuinely new content)** — but structure it the same way `transcription-subagent.md` structures its Derived/Visual decision test (transcription-subagent.md:99-119):
```
**Deciding between `Derived` and `Visual` is a single decision test, not a category list:**

> Does this line affect **legality, scoring, or sequencing**?

- **Yes** → it is `Derived`. ...
- **No** → ... it is `Visual`.

Two worked examples:
- **Derived** — ...
- **Visual** — ...
```
Copy this exact "single test, not a category list, plus worked examples" structure for the `cosmetic`/`sharper`/`contradictory` decision procedure (CONTEXT.md decision 10: consequence-equivalence, not wording-similarity), and for the Visual/Derived-exclusion rule inside classification (CONTEXT.md decision 12b — use the exact real-data worked example RESEARCH.md's Code Examples section already extracted from `one-two-punch/rulebook/01-setup-and-round-structure.md`):
```
Derived (p.1) — diagram description: A layout diagram of the ring showing three dashed-outline
areas in a row, labeled left-to-right with downward arrows: "blue corner", "center ring", "red
corner"...
```
must be excluded from comparison identically to a `Visual (p.1):` line.

**RETURN-shape pattern** (transcription-subagent.md:151-186):
```
## 2. RETURN a structured summary only — never the transcribed text itself

- **(a) `slicePath`** — ...
...
Return exactly: one `{ slicePath, sectionSummary, citedTerms[], componentMentions[],
visualEvidence[], variants[], openGaps[], nextStep }` per section.
```
Classification's RETURN shape (per CONTEXT.md decision 6/9 and RESEARCH.md Pattern 3): `{ pairId, label, evidence, quotedPass1, quotedPass2 }` — with the SAME "never return prose outside this shape; never return the full slice bodies" framing, and the same requirement that `sharper`/`contradictory` labels REQUIRE `quotedPass1`/`quotedPass2` populated verbatim.

**"Scope limit" closing-section pattern** (transcription-subagent.md:198-201):
```
## Scope limit

Do not interpret or evaluate the rules — only transcribe, write, and extract the summary fields
above. Interpretation is the orchestrator's and, later, `/bs-build-chunk`'s job, not yours.
```
Classification's equivalent scope-limit paragraph: the subagent never computes staleness, never writes a ledger record, never opens more than the two (or more, per many-to-many pairing) slices it was given.

---

### `src/cli/slash-command/bs/verify-game.md` (rewrite, not append)

**Analog:** itself — the exact statements to rewrite are already line-cited in RESEARCH.md's Pitfall 3 and reproduced here for direct copy-paste into the plan's diff:

**Location 1 — lines 19-20 (before):**
```
It never runs a build, never edits a chunk, never writes a staged slice over a
live one, and never compares the staged output to what already exists. That comparison is a later
phase's job; this skill's job ends the moment staging closes. There is no flag or path anywhere in
this skill that writes staged output into a live location.
```
must become (per Pitfall 3's guidance) something like: "...and never writes a staged slice over a live one. Comparison happens in Step 4, below. There is no flag or path anywhere in this skill that writes staged output into a live location."

**Location 2 — lines 96-98 (before):**
```
**The pass ends here.** There is no comparison of the staged output to what already exists, no
classification, no verdict, and no promotion of a staged slice over a live one. Staging and
recording is the entire scope of this skill.
```
must be replaced entirely with a Step 4 section describing dispatch to `classification-dispatch.md`, since the pass no longer ends at Step 3 once Step 4 exists — this paragraph cannot survive unedited beside a new Step 4.

**Do NOT touch:** `staging-dispatch.md`'s own Close-section scope-fence sentence (lines 158-164) — it remains true (staging-dispatch.md itself performs no classification; that is the new delegate's job) and needs no edit, but a plan must not accidentally leave it contradicting the new Step 4 either — verify after editing `verify-game.md` that no remaining "there is no comparison... at this or any later point in this file" sentence anywhere still describes the WHOLE skill rather than just this one delegate file.

---

### `src/cli/cli.ts` (registration)

**Analog:** the existing `verify-run-init`/`-record`/`-status` block (cli.ts:206-264) and the `trace-check`/`drift-check` block (cli.ts:188-204)

**Registration pattern to copy** (cli.ts:258-264):
```typescript
program
  .command('verify-run-status')
  .description('Report which slice-units are recorded for a verify run (read-only, machine-readable)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyRunStatusCommand);
```
New commands (`verify-classify-status`, `verify-classify-record`, and whichever pairing/provenance command(s) the plan settles on — e.g. `verify-classify-pairs`) each get one `program.command(...)` block immediately after the existing `verify-run-status` registration (cli.ts:258-264), in the same file region, following the exact `.description()`/`.option()`/`.action()` chain shape. `--complete-range`/`--reset-range`-style mutually-exclusive-option validation (cli.ts:220-236, for `--ranges` JSON parsing) is the pattern to copy if `verify-classify-record` needs inline arg validation before calling its command function — note the `process.exit(1)` (not `process.exitCode = 1`) idiom used specifically inside a synchronous `.action()` callback for argument-parsing failures, vs. the `process.exitCode = 1` idiom (RESEARCH.md/CLAUDE.md) used for command-body failures that must let Node flush stdout first.

## Shared Patterns

### Atomic ledger write (crash-safety)
**Source:** `verify-run.ts:213-229` (`atomicWriteFile`)
**Apply to:** `verify-classify.ts`'s every mutating command (`verify-classify-record`) — reuse the exported function, never re-implement temp-file+fsync+rename.

### Enumerated-kind + pinning test
**Source:** `build-manifest.ts:20-32` (`FINDING_KINDS`), `ingest-archive.ts:295-326` (`PRESENTATION_LEXICON`), `ingest.test.ts:494-500` (cross-file pin)
**Apply to:** the new `PROVENANCE_KINDS`, `RULE_DELTA_KINDS`, and the presentation-exclusion lexicon constant — all three must be `Object.freeze([...])` arrays with a derived `type X = (typeof X_KINDS)[number]`, never a hand-written union, and every array a test asserts against directly (not re-typed).

### Path-escape guard
**Source:** `verify-run.ts:756-763`
**Apply to:** any new command parameter accepting a path relative to the staging dir or rulebook dir.

### `process.exitCode = 1`, never throw across the CLI boundary
**Source:** `drift-check.ts:183` doc comment + every `program.parse()` action in `cli.ts`
**Apply to:** all new command registrations — `program.parse()` does not await actions, so an uncaught throw surfaces a raw stack trace instead of the actionable one-liner.

### `--json` last, human report otherwise
**Source:** `verify-run.ts:533-545, 944-958`; `drift-check.ts:186-188` doc comment
**Apply to:** `verify-classify-status`/`-record`/pairing commands — `console.log(JSON.stringify(result, null, 2))` as the literal last statement before `return result`, human-readable branch otherwise, report VOLUME not emptiness (172's finding, restated in CONTEXT.md specifics).

### BS-DISPATCH-V2 token handshake
**Source:** `staging-dispatch.md:91-119` (dispatcher side), `transcription-subagent.md:18-49` (subagent side)
**Apply to:** `classification-dispatch.md` + the new classification subagent contract — copy the pointer-block-not-composed-prompt discipline verbatim, substituting the new contract's pointer path and dispatch fields.

### "Ledger/status command is the only source of truth, never the filesystem"
**Source:** `staging-dispatch.md:49-53`
**Apply to:** `classification-dispatch.md`'s resume logic — `verify-classify-status --json` decides which pairs still need classifying, never a directory scan of the staging tree.

## No Analog Found

None — every file in scope has a close, directly-cited analog. The two places genuinely new judgment content must be authored from CONTEXT.md's decisions rather than copied are:
1. The `cosmetic`/`sharper`/`contradictory` decision procedure itself (CONTEXT.md decisions 9-12, 12b) — structure per `transcription-subagent.md`'s Derived/Visual test, but content is new.
2. The page-span-overlap pairing algorithm (CONTEXT.md decision 4, RESEARCH.md Pattern 2/Pitfall 4) — no existing command does m:n overlap-join pairing; write it as a new pure function following `resolveLedgerState`'s style (pure, single input → single output, no ambient state), not copied from any one analog.

## Metadata

**Analog search scope:** `src/cli/commands/` (verify-run.ts, verify-run.test.ts, chunk-provenance.ts, trace-check.ts, drift-check.ts, build-manifest.ts, ingest-archive.ts), `src/cli/cli.ts`, `src/cli/slash-command/bs/` (verify-game.md, verify/staging-dispatch.md, ingest/transcription-subagent.md, ingest.test.ts), `src/cli/commands/install-claude-command.ts` (installer confirmation only, no new pattern needed — `verify/` is already a recursively-copied `SHARED_DIRS` entry at `install-claude-command.ts:59`, so `classification-dispatch.md` installs automatically with no installer code change).
**Files scanned:** 12 read in full or targeted ranges; 0 additional analogs needed beyond the 3-5 strong matches found.
**Pattern extraction date:** 2026-07-29
