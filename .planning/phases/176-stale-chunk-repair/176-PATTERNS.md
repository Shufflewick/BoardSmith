# Phase 176: Stale-Chunk Repair - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 8 (5 new command/skill files + 3 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/verify-ruling-recheck.ts` (+ `.test.ts`) | command (CLI enumerate+record, subagent judgment split) | request-response (dispatch subagent per ruling, record verdict) | `src/cli/commands/verify-classify.ts` (`computeChunkVerdicts`/`ChunkVerdict` enumerate+record split) | exact |
| `src/cli/commands/verify-repair.ts` (+ `.test.ts`) | command (slice-path resolution + round bookkeeping + gate re-invocation) | orchestration / batch (per-stale-chunk loop) | `src/cli/commands/verify-impact.ts` (`computeRepairGate`, `ImpactMapEntry`) | exact |
| `src/cli/slash-command/bs/verify/repair-dispatch.md` | route/skill-text (delegates to build/audit.md + build/repair.md by reference) | event-driven (fresh-context dispatch per lens, per round) | `src/cli/slash-command/bs/verify/classification-dispatch.md` | exact |
| `src/cli/slash-command/bs/verify/ruling-recheck.md` | route/skill-text (CHECK-01 dispatch prompt + verdict contract) | request-response | `src/cli/slash-command/bs/verify/classification-subagent.md` | exact |
| `src/cli/commands/build-manifest.ts` (extend `parseRulings`) | utility (parser, additive extension) | transform | itself — extend in place, no new analog needed | exact (self) |
| `src/cli/slash-command/bs/verify-game.md` (extend router) | route (six-step → adds repair routing) | request-response | itself — extend in place; see quoted boundary statements below | exact (self) |
| `src/cli/cli.ts` (register 2 new commands) | config (command registration) | request-response | existing `verify-classify-*`/`verify-impact-*` blocks (lines ~285-345) | exact |
| `src/cli/slash-command/bs/verify.test.ts` (extend) | test | transform (structural/lexicon-pin assertions) | its own existing `describe` blocks (lines 243-292, 477+) | exact (self) |

## Pattern Assignments

### `src/cli/commands/verify-ruling-recheck.ts` (command, CHECK-01)

**Analog:** `src/cli/commands/verify-classify.ts` (enumerate-and-record split) + `src/cli/commands/build-manifest.ts:284-378` (`parseRulings`, to extend)

**The exact gap to extend (verbatim, `build-manifest.ts:284-290`):**
```typescript
export interface ParsedRuling {
  number: number;
  /** Set only for the explicit supersede verbs, direction-resolved. */
  supersededBy?: number;
  /** Supersede-verb sentences whose target number or direction could not be resolved. */
  unparsedSupersession: string[];
}
```
`parseRulings` (signature at `build-manifest.ts:326`, `export function parseRulings(rulingsText: string): ParsedRuling[]`) already computes `bodyStart`/`bodyEnd` per `### Ruling N` heading internally (lines 328-346) to scan for supersede verbs, but the loop at lines 343-375 never returns the body text itself — only `supersededBy`/`unparsedSupersession`. Decision 18: **widen `ParsedRuling` additively** (add e.g. `body: string`) and populate it from the SAME `body` local already computed at line 346 — do not re-slice `rulingsText` a second time and do not add a second `### Ruling (\d+)` regex. `trace-check.ts:410-416` is the only other caller; it destructures `{ supersededBy, unparsedSupersession }` off array elements it gets back from `parseRulings(rulingsText)` and never assumes a closed object shape, so an additive field is non-breaking (confirm at implementation time, per Pitfall 3, but the read shows no risk).

**Verdict enum pattern to copy (frozen-array + derived-type), verbatim precedent from `verify-impact.ts:931-938`:**
```typescript
export const REPAIR_GATE_DISPOSITIONS = Object.freeze([
  'reopen-playtest',
  'close-without-replaytest',
  'unknown-drift',
  'not-applicable',
] as const);

export type RepairGateDisposition = (typeof REPAIR_GATE_DISPOSITIONS)[number];
```
CHECK-01's own verdict set (decision 1) should be a sibling constant in the same shape:
```typescript
export const RULING_VERDICTS = Object.freeze([
  'still-needed',
  'resolved-by-source',
  'contradicted',
  'undetermined',
] as const);
export type RulingVerdict = (typeof RULING_VERDICTS)[number];
```

**Enumerate-and-record split pattern, verbatim precedent from `verify-classify.ts:881-894`:**
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
    rung: CitationAnchorRung;
    attributed: boolean;
    reason: string;
  }>;
}
```
Mirror this shape for a `RulingVerdictRecord`: `{ number: number; verdict: RulingVerdict; reasoning: string; supersededBy?: number }` — one struct per non-superseded ruling, computed by the CLI from the subagent's ONE returned verdict, never derived by re-reading the subagent's prose in a second place.

**Supersession skip rule (decision 3), exact source to cite:** a ruling with `supersededBy !== undefined` is skipped, mirroring `trace-check.ts:418-419`:
```typescript
for (const ruling of parsedRulings) {
  if (ruling.supersededBy !== undefined) continue; // superseded rulings are not demanded a test
  ...
}
```
Reuse this exact skip condition for CHECK-01's enumeration loop (swap the untested-citation check for a judgment-subagent dispatch).

**SC-3's exact real target (verbatim, `~/BoardSmithGames/seven/RULINGS.md` lines 68-79 for Ruling 3's direction-reversed marker, and RESEARCH.md's quoted Ruling 1 text):**
```
### Ruling 3
- Decision: Mess exhaustion is treated as unreachable — no reshuffle rule is implemented, and no
  code path may handle an empty mess by silently degrading.
- Citation interpreted or overridden: n/a — the rulebook is entirely silent on the mess running out.
- Rationale: Designer ruling at ingest, grounded in arithmetic: the deck is 119 cards (112 numbered +
  7 bonus) and the maximum possible draw is 7 players x 10 cards = 70. The mess cannot empty. Per the
  no-fallbacks rule this is asserted as an invariant with a test, NOT defended with a fallback branch
  that would mask a real bug if the invariant were ever violated.
- **⚠ RATIONALE SUPERSEDED BY RULING 9 (the DECISION stands; the ARITHMETIC behind it was false).**
  The "7 players x 10 cards = 70" figure counts only the cards players KEEP. ... see Ruling 9 for
  the corrected arithmetic and the real margin.
```
This is the reversed-direction case `parseRulings`'s `SUPERSEDED_BY` regex (`build-manifest.ts:300`, `/supersede[sd]?\s+by\s+ruling\s+(\d+)/i`) already resolves correctly (Ruling 3's OWN entry sets `entry.supersededBy = 9`) — CHECK-01 does not need new parsing for this case, only to skip Ruling 3 from re-validation once `supersededBy` is set, per decision 3.

Ruling 1 (`seven`'s Citation field, quoted in RESEARCH.md "Code Examples"): *"The rulebook names this card and depends on it for all scoring, but never reproduces its face — see `rulebook/INDEX.md` 'Open Rules Gaps'."* — decision 4's target: the correct verdict is `still-needed`, never `resolved-by-source`/`contradicted`, and the judgment subagent (not CLI code) must recognize the absence-assertion pattern in prose, per Pitfall 4.

---

### `src/cli/commands/verify-repair.ts` (command, CHECK-02)

**Analog:** `src/cli/commands/verify-impact.ts` (`computeRepairGate`, `ImpactMapEntry`) + `src/cli/commands/verify-classify.ts` (`ChunkVerdict.attributions`, `pairSlices()`)

**`computeRepairGate`'s exact pure-function shape to re-invoke (verbatim, `verify-impact.ts:977-1039`):**
```typescript
export function computeRepairGate(input: {
  status: string;
  stale: boolean;
  driftState: 'clean' | 'drifted' | 'unknown';
}): RepairGate {
  const { status, stale, driftState } = input;

  if (driftState === 'unknown') {
    return { disposition: 'unknown-drift', clearMarker: false, reverifyStamp: false, reason: '...' };
  }
  if (!stale) {
    return { disposition: 'not-applicable', clearMarker: false, reverifyStamp: false, reason: '...' };
  }
  if (!status.startsWith('verified')) {
    return { disposition: 'not-applicable', clearMarker: false, reverifyStamp: false, reason: '...' };
  }
  if (driftState === 'drifted') {
    return { disposition: 'reopen-playtest', nextStatus: 'built', clearMarker: true, reverifyStamp: false, reason: '...' };
  }
  // driftState === 'clean'
  return { disposition: 'close-without-replaytest', nextStatus: status, clearMarker: true, reverifyStamp: true, reason: '...' };
}
```
Branch order is load-bearing (blindness-before-narrowing): `unknown` is checked FIRST. Phase 176 (Pitfall 1) must call this a SECOND time, post-repair, with a freshly re-derived `driftState` — never reuse Step 4's pre-repair snapshot. It is pure/no-I/O, safe to call again (Assumption A3 in RESEARCH.md, unverified by unit test but confirmed by direct read).

**`ImpactMapEntry`'s exact shape — Phase 176's `--json` input (verbatim, `verify-impact.ts:1042-1053`):**
```typescript
export interface ImpactMapEntry {
  slug: string;
  ruleDelta: string;
  stale: boolean;
  status: string;
  driftState: 'clean' | 'drifted' | 'unknown';
  changedFiles: string[];
  missingFiles: string[];
  attributions: ChunkVerdict['attributions'];
  gate: RepairGate;
  markerState: 'clear' | 'rules-stale' | 'unknown';
}
```
Consume this via Phase 175's existing `--json` output (design discretion note in RESEARCH.md: "design this phase's input around their `--json`, not around a re-derivation"). Decision 5: only entries where `stale === true` are dispatched into CHECK-02's lens loop — never every chunk.

**`ChunkVerdict.attributions` — the live↔staged pairing already computed (verbatim, `verify-classify.ts:881-894`):**
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
    rung: CitationAnchorRung;   // 'quoted-fragment' | 'cited-page' | 'slice-fallback'
    attributed: boolean;
    reason: string;
  }>;
}
```
`pairSlices()` is exported at `verify-classify.ts:277`. Use `pairIds`/`attributions[]` to resolve a stale chunk's `citedLiveSlices` to their staged counterparts via the run's own `RUN.md` classification records (`liveSlices[]`/`stagedSlices[]` keyed by `pairId`, per RESEARCH.md's Code Examples) — do NOT write a second filename-based pairing algorithm (Don't Hand-Roll table).

**Atomic ledger write — the ONE path, verbatim (`verify-run.ts:293-309`):**
```typescript
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
```
Comment at line 290-291: *"this is the ONE atomic ledger write path in the repo. `verify-classify.ts` is the second caller sharing it, never a second implementation."* Any new write Phase 176 makes (ruling-verdict record, repair-round bookkeeping) MUST route through this exact function — a third implementation reopens CR-01's defect class.

---

### `src/cli/slash-command/bs/verify/repair-dispatch.md` (CHECK-02 skill text)

**Analog:** `src/cli/slash-command/bs/build/audit.md` (lens templates) + `src/cli/slash-command/bs/build/repair.md` (bounded loop) + `src/cli/slash-command/bs/verify/classification-dispatch.md` (delegation style)

**The three lens dispatch templates — reuse VERBATIM, only `{slicePaths}` changes to staged paths (exact text, `build/audit.md:54-108`):**

Fidelity lens (lines 54-66):
```
You are auditing built code for {gameName}, chunk "{slug}", for RULES FIDELITY. Read the
following rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project — rulings
outrank the rulebook (state-machine.md "Rulings Outrank Rulebook"); the rulebook plus
RULINGS.md together form the composite source of truth. Do NOT read this chunk's CHUNK.md
"## Interpretation" section — you are checking the CODE against the RAW SOURCE, not against a
prior agent's summary of it.

Then read the built code at: {codeFilePaths}.

Return exactly: a list of { findingId, lens: 'fidelity', description, citation, severity } —
one entry per defect found (empty array if none).
```

Visibility lens (lines 68-94) — parameters `{gameName}`, `{slug}`, `{slicePaths}`, `{codeFilePaths}`, `{visibilityDeclarationText}`; core instruction: *"read RULINGS.md ... a house rule in RULINGS.md can make something public that the printed rulebook hides, or vice versa. These raw sources, NOT the Visibility Declaration, are the ground truth"* + dispatches `diffPlayerViews(testGame, seatA, seatB)` (`src/testing/view-diff.ts`, the atomic overload) and `assertNoHiddenInfoLeak(...)` (`src/testing/dom-leak.ts`). Return contract: `{ findingId, lens: 'visibility', description, citation, severity }`.

Undo lens (lines 96-108) — parameters `{gameName}`, `{slug}`, `{codeFilePaths}` only (no slice/RULINGS.md read — undo sanity is a code-only check). Return contract: `{ findingId, lens: 'undo', description, citation, severity }`.

**The parameter tokens Decision 6 says are the ONLY substitution points:** `{gameName}`, `{slug}`, `{slicePaths}` (→ staged paths per decision 9, never live), `{codeFilePaths}`, `{visibilityDeclarationText}` (visibility lens only). Every other word in all three templates is fixed prose reused unchanged — `repair-dispatch.md` must delegate by pointing at `build/audit.md`'s templates (the same "delegates by reference, never copies the prose" style `verify/classification-dispatch.md` and `verify/staging-dispatch.md` already use for `ingest/transcription-subagent.md`), not paste a second copy.

**4th (design-review) lens trigger, exact rule (`build/audit.md:45-48`):**
```
For `ui: touches|major` chunks, a 4th agent is dispatched via `build/design-review.md`
(forward-reference — authored in this phase's Plan 02): a screenshot-armed review against
DESIGN.md and frontend-design craft criteria. Its findings land in the same `## Findings
Ledger` as the three lenses above, through the orchestrator, never a separate track.
```
Decision 7: this rule is applied EXACTLY as written — no new policy for verify-context UI chunks.

**No-`## Interpretation` rule — quote once, apply everywhere:** every template's own line, e.g. fidelity's *"Do NOT read this chunk's CHUNK.md '## Interpretation' section — you are checking the CODE against the RAW SOURCE, not against a prior agent's summary of it"* (line 58-60) — decision 11 says this is MORE important for a rules-stale chunk, never less, since a stale chunk's `## Interpretation` was written against rules that have since moved.

**Findings Ledger persist-before-repair rule (`build/audit.md:126-140`):**
```
The orchestrator appends a `### Audit Round N` entry to CHUNK.md's `## Findings Ledger`
(`templates/CHUNK.template.md` — cite the section by name, never restructure it) as soon as all
of this round's lens agents (and the design-review agent, if dispatched) have returned — this
write happens **before** `repair` starts...

Cold-resume rule: a session resuming at `audit` (unchecked on the Step Checklist) with a
partial or missing current-round entry in `## Findings Ledger` re-dispatches this round's lenses
from scratch — the round is not considered complete, and no partial finding list is trusted,
until the full `### Audit Round N` entry lands.
```

**The bounded repair loop — exact FIX/refute/triage semantics (`build/repair.md:1-94`):**
```
During a repair round, repair itself does exactly one of two things to a finding: FIX the
code, or refute-it-with-citation. Those are the only two repair actions ...
deferred is NOT a repair action — it is only a user choice at the round-3 triage ... the third
terminal disposition alongside `fixed` and `refuted`.

- Fix: change the code so the finding no longer holds. Record the finding's disposition as
  `fixed` ...
- Refute-with-citation: the finding does not hold — record the disposition as `refuted`
  together with the rulings/rulebook citation ... A refutation with no citation attached is
  not a valid refutation; it is an unaddressed finding.

Maximum 3 audit rounds per chunk.
Round N+1 auditors see this ledger and report only NEW findings — repair never re-litigates a
finding already recorded in a prior round's entry.
After round 3, any remaining findings are triaged with the user (see "Round-3 User Triage").
```
Round-3 triage's exact three plain-language options (`build/repair.md:78-84`): **Real blocker**, **Defer to a later chunk**, **Auditor was wrong (refuted)** — never raw finding text, an agent transcript, or a severity score shown to the user.

**Decision 17's per-verify-episode round bound — how to keep the episode boundary legible.** Real precedent for a `### Audit Round N (...)` heading carrying free-text qualifiers already exists and is machine-ignorable (grep confirms all headings match `### Audit Round \d+` with optional trailing parenthetical): `~/BoardSmithGames/seven/chunks/table-and-draw/CHUNK.md:319` reads `### Audit Round 3 (final round — \`state-machine.md\` "Repair Loop Bound": max 3)`; `~/BoardSmithGames/one-two-punch/chunks/block/CHUNK.md:883` reads `### Audit Round 3 (FINAL — the round bound is 3; state-machine.md "Repair Loop Bound")`; `~/BoardSmithGames/one-two-punch/chunks/jab/CHUNK.md:822` reads `### Audit Round 3 (the last permitted — ...)`. All three of these chunks (plus `best-seven-selection`) are among the 4 chunks already AT round 3 from build. Decision 17's per-episode reading means CHECK-02's first verify-episode round for these 4 chunks is a NEW `### Audit Round 4 (verify-repair episode 1, round 1)` — or an equivalent explicit episode-labeled heading — appended AFTER the existing `### Audit Round 3 (...)` entry, never renumbering it and never inserting before it. `state-machine.md`'s Write Order rule (below) is the authority for this being append-only.

**A real multi-round entry to model the heading/table/repair-section shape on:** `seven/chunks/table-and-draw/CHUNK.md:202-330` — `### Audit Round 1` (finding table, IDs F1-F10) → `### Repair Round 1` (per-finding disposition prose, e.g. *"F1 — REFUTED, with citation..."* / *"F2 fixed — ..."*) → `### Audit Round 2` (only-new-findings, IDs continue from F11) → `### Repair Round 2` → `### Audit Round 3 (final round...)`. Use this exact heading/table/prose alternation for the verify-episode's own rounds.

---

### `src/cli/slash-command/bs/verify/ruling-recheck.md` (CHECK-01 skill text)

**Analog:** `src/cli/slash-command/bs/verify/classification-subagent.md` (the one judgment contract pattern — CLI enumerates, one fresh-context subagent judges, CLI records) — same architectural split as `verify-classify.ts`'s per-pair dispatch, just applied per-ruling instead of per-slice-pair. The subagent's prompt must instruct it to read: (a) this ruling's full body text (Decision/Citation/Rationale — now available via `parseRulings`'s additive extension), and (b) the fresh STAGED transcription only (decision 9 — never live slices), then return exactly ONE of `still-needed | resolved-by-source | contradicted | undetermined` plus reasoning text. Per decision 2 and Pitfall 4, the absence-of-source judgment (Ruling 1's case) is instructed IN THE PROMPT, not gated by a CLI-side keyword list.

---

### `src/cli/commands/build-manifest.ts` (extend `parseRulings`)

**No external analog needed — this is a self-extension.** Current exact signature and return shape (verbatim, lines 284-378) are quoted above under CHECK-01. The additive change: widen `ParsedRuling` with a `body: string` (or equivalent) field, populated from the SAME `body` local the loop already computes at line 346 (`const body = rulingsText.slice(h.bodyStart, bodyEnd);`) — zero new regex, zero new scan pass. The grep gate 175-03 already established (forbidding a second `Ruling (\d+)` regex in the repo) stays in force; the new field is populated from data this function ALREADY computes internally, not from a second parse.

---

### `src/cli/slash-command/bs/verify-game.md` (extend router — repair routing)

**Analog:** itself. Below are the exact boundary statements this phase's arrival makes false, quoted verbatim with line numbers, per the recurring defect class Phases 173/174/175 each had to fix.

1. **Line 15** (skill-level framing, in the intro paragraph):
   > "This skill does NOT rebuild the project. It reads the archived rulebook, stages a fresh
   > re-transcription into a run-scoped, non-live directory, records each completed unit through the
   > ledger CLI, classifies each staged/live pair's rule delta, and — since a `contradictory` verdict
   > demands it — adjudicates and marks affected chunks rules-stale. It never runs a build and never
   > edits a chunk's design."

   **Becomes false**: repair (decision 12, CHECK-02) MAY change code — that is explicitly the mechanism this phase adds. "It never runs a build and never edits a chunk's design" must be rewritten to distinguish "this skill does not run the BUILD pipeline's `investigate/redteam/ask/build` steps for a new chunk" (still true) from "repair may change an EXISTING chunk's already-built code" (now true, new). Do not delete the "does not rebuild the project" framing wholesale — narrow it precisely.

2. **Line 20-21**:
   > "Comparison happens in Step 3, below; no staged slice ever takes a live one's place, at that
   > step or any other. There is no flag or path anywhere in this skill that writes staged output
   > into a live location."

   **Still true, keep as-is** — CHECK-02 reads staged slices as lens input (decision 9) but never promotes staged→live. Flag for the plan to VERIFY this remains true after the repair-dispatch addition, not to change it.

3. **Line 109** (Step 4's closing sentence):
   > "Finally the stale fraction and each chunk's repair-gate disposition (`reopen-playtest`,
   > `close-without-replaytest`, or `unknown-drift`) are reported. Cite
   > `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` sections by name; restate nothing.
   > **Performing the repair itself is Phase 176's job — this step decides only which chunks need
   > it.**"

   **Becomes false the moment this phase lands**: the bolded sentence is a forward-reference placeholder that must be rewritten to actually describe the new Step 5 (or a Step 4.5) that dispatches `verify/repair-dispatch.md` — not merely deleted, since Step 4 genuinely still only decides WHICH chunks need repair; the NEXT step is what performs it. Also note: `REPAIR_GATE_DISPOSITIONS` (the frozen array quoted above) has FOUR values including `not-applicable`, but this line names only three (`reopen-playtest`, `close-without-replaytest`, `unknown-drift`) — confirm whether `not-applicable` is meant to be silently excluded from this report (likely, since it means "nothing to repair-gate") or whether this line is ALSO stale on the enumeration itself; verify against `verifyImpactStatusCommand`'s actual reporting behavior before rewriting.

4. **Line 112-127 (Step 5: Close)** — currently the terminal step; a repair-routing addition likely renumbers this to Step 6, or inserts repair as 4.5/5 and closes becomes 6. Whichever numbering the plan picks, the "Reference Files" section (lines 129-151) must gain `verify/repair-dispatch.md` and `verify/ruling-recheck.md` alongside the existing five bullets, following the exact same one-line style (e.g. `- \`${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md\` — the hard adjudication gate, the rules-staleness write, and the impact-map sequence`, line 141-142).

5. **CONTEXT.md's own framing** ("now a six-step router") confirms the current file is Steps 0-5 (six steps, 0-indexed) — the plan must decide whether repair routing is a NEW numbered step or folds into Step 4's existing prose, and update every place that says "six-step" if the count changes.

---

### `src/cli/cli.ts` (register 2 new commands)

**Analog:** the existing `verify-classify-*`/`verify-impact-*` registration blocks (`cli.ts:285-345`), exact style to copy:
```typescript
program
  .command('verify-classify-pairs')
  .description(
    "Enumerate a verify run's live/staged slice pairs with provenance and rule-bearing line " +
      'counts (read-only, machine-readable)',
  )
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--run-id <id>', 'Report on a specific run instead of the most recent')
  .option('--live-slice <path>', 'Restrict the report to pairs containing this rulebook/ slice')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyClassifyPairsCommand);
```
Import style (top of file, `cli.ts:33-38`):
```typescript
import {
  verifyImpactGateCommand,
  verifyImpactAdjudicateCommand,
  verifyImpactApplyCommand,
  verifyImpactStatusCommand,
} from './commands/verify-impact.js';
```
New commands (`verify-ruling-recheck`, `verify-repair` or similar per RESEARCH.md's recommended names) should follow this exact `.command()` / `.description()` / `.option('--project ...')` / `.option('--json', ...)` / `.action(...)` chain shape — every existing verify-* command takes `--project <dir>` and `--json` as its baseline options.

---

## Shared Patterns

### Atomic, single-write-path ledger persistence
**Source:** `src/cli/commands/verify-run.ts:293-309` (`atomicWriteFile`)
**Apply to:** `verify-ruling-recheck.ts` (recording each verdict), `verify-repair.ts` (recording round dispositions and any repair-gate re-derivation)
Exactly ONE atomic write path must remain in the repo (173-REVIEW.md CR-01's defect class, reaffirmed by RESEARCH.md's Don't Hand-Roll table). Import and call `atomicWriteFile`; never write a second `fs.writeFile`-based helper.

### Frozen-array + derived-type + pinning test for every enumerated set
**Source:** `src/cli/commands/verify-impact.ts:931-938` (`REPAIR_GATE_DISPOSITIONS`), `src/cli/commands/verify-classify.ts:907-913` (`CITATION_ANCHOR_RUNGS`)
**Apply to:** CHECK-01's `RULING_VERDICTS` (four values, decision 1) — write it as `Object.freeze([...] as const)` + derived `type`, with a pinning unit test asserting the exact four-member array, mirroring these two existing constants' own test coverage.

### CLI computes, subagent judges, skill formats
**Source:** `src/cli/commands/verify-classify.ts` (`computeChunkVerdicts` + `verify-classify-record`'s CLI-only recording) and `src/cli/slash-command/bs/verify/classification-subagent.md` (the one judgment contract)
**Apply to:** both CHECK-01 and CHECK-02 — decision 2 explicitly names this "the same split as Phase 174's classifier." The orchestrator (skill text) never reads a slice or a ruling body itself; it dispatches the subagent and records only the structured return.

### Verbatim template reuse, parameters only
**Source:** `src/cli/slash-command/bs/build/audit.md:54-108` (three lens templates)
**Apply to:** `verify/repair-dispatch.md` — the ONLY substitution points across all three templates are `{gameName}`, `{slug}`, `{slicePaths}`, `{codeFilePaths}`, `{visibilityDeclarationText}`. Any verify-specific framing sentence belongs in the surrounding orchestration file, never injected into the template text itself.

### Findings Ledger as per-chunk-lifetime, append-only persistence
**Source:** `src/cli/slash-command/bs/build/audit.md:126-145`, `src/cli/slash-command/bs/build/repair.md:63-70`, `src/cli/slash-command/bs/state-machine.md` "Write Order" (`- Round entries (revise rounds, audit rounds) are **append-only** — never overwritten or renumbered.`)
**Apply to:** `verify-repair.ts`'s round bookkeeping — a verify episode's `### Audit Round N` entries are appended AFTER a chunk's existing build-time entries, using an episode-labeled heading (see the three real `### Audit Round 3 (...)` precedents quoted above), never renumbering history.

### Post-mutation re-derivation, never a stale snapshot
**Source:** `src/cli/commands/verify-impact.ts:977-1039` (`computeRepairGate`, pure/total) and Pitfall 1
**Apply to:** `verify-repair.ts` — re-invoke `computeRepairGate`/`verifyImpactStatusCommand` AFTER the repair loop closes for a chunk, using a freshly re-derived `driftState`; never reuse Step 4's pre-repair `ImpactMapEntry.gate`.

### Structural drift guards (grep-style lexicon pins) over prose trust
**Source:** `src/cli/slash-command/bs/verify.test.ts:243-292` (pointer-not-restatement + forbidden-word guards), `:477+` (`PRESENTATION_EXCLUSION_MARKERS` cross-file lexicon pin)
**Apply to:** the CHECK-02 Wave-0 gap RESEARCH.md names explicitly: *"Lens dispatch templates are read VERBATIM from `build/audit.md` (no forked copy exists)"* — extend `verify.test.ts` with a test in this exact style: read every file under `bs/verify/`, assert it does NOT contain a second copy of the lens template body (pick 2-3 unique marker phrases from the fidelity/visibility/undo templates, e.g. `"you are checking the CODE against the RAW SOURCE"` or `"These raw sources, NOT the Visibility Declaration"`), mirroring `CONTRACT_BODY_MARKERS` at lines 257-260.

## No Analog Found

None — every file in this phase's scope has a strong existing analog; this phase is explicitly "100% internal reuse" per RESEARCH.md's Standard Stack section.

## Metadata

**Analog search scope:** `src/cli/commands/`, `src/cli/slash-command/bs/` (including `build/`, `verify/`), `src/cli/cli.ts`, plus read-only cross-repo reference at `~/BoardSmithGames/{seven,one-two-punch}/chunks/*/CHUNK.md` and `RULINGS.md` for real structural precedent (Findings Ledger round headings, ruling text).
**Files scanned directly (full or targeted read) this pass:** `build/audit.md` (full), `build/repair.md` (full), `build-manifest.ts` lines 280-379 (`parseRulings`, full), `verify-game.md` (full), `state-machine.md` (full), `verify-impact.ts` lines 925-1054, `verify-classify.ts` lines 860-920, `verify-run.ts` lines 270-315, `trace-check.ts` lines 400-440, `verify.test.ts` lines 243-292, `cli.ts` command-registration blocks, `~/BoardSmithGames/seven/chunks/table-and-draw/CHUNK.md` lines 195-330, `~/BoardSmithGames/seven/RULINGS.md` Ruling 3 (lines 68-79), `### Audit Round` grep across both reference games' full chunk trees.
**Pattern extraction date:** 2026-07-30
