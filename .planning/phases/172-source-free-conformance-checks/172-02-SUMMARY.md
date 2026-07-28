---
phase: 172-source-free-conformance-checks
plan: 02
subsystem: cli
tags: [vitest, cli, parser, regex, tdd, traceability]

# Dependency graph
requires:
  - phase: 172-source-free-conformance-checks
    plan: 01
    provides: build-manifest.ts's shared FINDING_KINDS/parseBuildManifest/parseInterpretationClaims/parseRulings — the "one parser, one authority" this plan builds on without re-deriving
provides:
  - "src/cli/commands/trace-check.ts — CHECK-03's traceCheckCommand, scanTestCitations, resolveClaimCitation, TraceCheckResult"
affects: [172-04-cli-registration, 172-05-proof, 173-bs-verify-game]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-rung candidate narrowing (owners -> live-claim validity -> authoring chunk) implemented as sequential array filters, never collapsed into a single boolean expression, so each rung's deciding case stays independently testable"
    - "Narrowing must never discard every survivor: rung 3 falls back to the rung-2 survivor set when authoring narrowing would empty it, rather than reporting an empty/unresolved result"
    - "Shared vitest console.log spy installed once in a file-level beforeEach so every test's incidental report output is silenced by default; only the tests asserting on stdout read the shared spy's captured calls"

key-files:
  created:
    - src/cli/commands/trace-check.ts
    - src/cli/commands/trace-check.test.ts
  modified: []

key-decisions:
  - "scanTestCitations scans forward from each `claim(s)`/`ruling(s)` head token via a custom number-list scanner (not a single regex) so a Ruling token naturally terminates a claim list — 'claim 28 / Ruling 9/15' stops the claim scan at 28 without a lookahead exclusion list that would need updating for every new stop-word"
  - "The `CHUNK.md claim N` prefix needed NO special-casing: since the head regex never requires anything before `claim`, the prefix is simply invisible to the scanner, exactly matching CONTEXT.md's instruction to treat it identically to a bare `claim N`"
  - "resolveClaimCitation's rung 3 uses 'survivors = authoringCandidates.length > 0 ? authoringCandidates : validCandidates' — the single line that encodes 172-CONTEXT.md's amended subtlety that narrowing must never empty a non-empty set"
  - "importsRules matches any from/require string literal containing a `rules/` path segment (case-insensitive substring), deliberately looser than a strict relative-path grammar, to cover both relative ('../src/rules/x') and aliased ('@/rules/x') import forms per the plan's explicit scope"
  - "Ruling citations from an unassociated test file still count toward global ruling coverage (added to citedRulings before the owners.length===0 branch is even checked) — ruling numbers are global, so file ownership is irrelevant to them, matching the seven/match.a11y.test.ts real case CONTEXT.md calls out"
  - "manifest-listed test-file path resolution rejects any path escaping projectDir via relative()-prefix check BEFORE any fs.readFile — the escaping path is named in a manifest-file-missing finding and never touched by fs (T-172-02)"

patterns-established:
  - "trace-check.ts imports build-manifest.ts's parsers directly and adds zero new heading-location code — grep for `indexOf('##` returns nothing in the new file, confirmed"

requirements-completed: [CHECK-03]

duration: ~35min
completed: 2026-07-28
---

# Phase 172 Plan 02: CHECK-03 traceability sweep (`trace-check.ts`) Summary

**`boardsmith trace-check`'s CLI-side implementation: a citation scanner, the locked three-rung claim-resolution ladder, the full sweep over `chunks/*/CHUNK.md` + `RULINGS.md` + every test file, and both `--json` and grouped-human-report output — CLI registration deferred to plan 172-04 per this plan's stated scope.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-28 (first tool call)
- **Completed:** 2026-07-28 (this summary)
- **Tasks:** 3 (all completed)
- **Files modified:** 2 (both created)

## Accomplishments
- Implemented `scanTestCitations` covering every citation form the plan's behavior bullets name: bare `claim N`, comma-joined `claims 3, 4, 5, 29`, slash-joined `claim 4/14`, capitalised `Claim 7`, the self-referential `CHUNK.md claim N` prefix (needs no special-casing), the mixed `claim 28 / Ruling 9/15` form (splits correctly, never swallows ruling numbers as claims), bare `Ruling 23`, and slash-joined `rulings 21/22`; plus `importsRules` detection for any relative/aliased `src/rules/` import.
- Implemented `resolveClaimCitation` as the exact three-rung ladder from 172-CONTEXT.md decision 3 (AMENDED): owners → live-claim validity → authoring chunk, with `ambiguous` reported ONLY when more than one candidate survives all three rungs, and the pinned subtlety that rung 3 emptying a non-empty rung-2 set falls back to the rung-2 survivors (never silently drops to nothing).
- Implemented `traceCheckCommand`: full sweep over chunk manifests/claims, test-file discovery (`tests/**/*.test.ts` plus manifest-listed `.test.ts` paths outside `tests/`, with project-root-escape rejection per threat T-172-02), and emission of every finding kind relevant to CHECK-03 (`unassociated-test` + paired `unresolved-claim-ref`, stale-citation `unresolved-claim-ref`, `ambiguous-claim-ref`, `claim-untested`, `ruling-untested` with supersession exemption, `test-unlinked` gated on decision 6b's three-part trigger, and both `manifest-file-missing` senses).
- Implemented `--json` (the exact `chunk-provenance.ts:794-797` two-line convention) and a grouped, count-first human report with a bounded per-kind item cap and a "+N more — run --json for the full list" tail.
- Confirmed the read-only invariant with a before/after whole-project byte-hash test (the T-171-19 class) and confirmed zero mutating `fs` calls anywhere in the file.

## Task Commits

1. **Task 1: Citation scanner and the three-rung resolution ladder**
   - `9ec51b4c` (feat) — `scanTestCitations`, `resolveClaimCitation`; 18/18 new tests passing, each ladder rung independently exercised as the deciding rung
2. **Task 2: traceCheckCommand — sweep, findings, and the read-only invariant**
   - `b036905d` (feat) — full sweep + all CHECK-03 finding kinds + read-only byte-hash test; 31/31 tests passing (13 new)
3. **Task 3: --json contract and the grouped, count-first human report**
   - `6d9047bb` (feat) — `--json`/human-report output modes, shared console.log spy consolidation; 35/35 tests passing (4 new)

**Plan metadata:** (this commit, following)

_Note: tasks were implemented as ordinary iterative TDD within each task's scope (write tests, confirm RED against the not-yet-extended module, implement, confirm GREEN) rather than a strict single up-front RED commit per task — each task's commit lands only once its slice is fully green, matching the plan's task boundaries exactly (no interface drift between tasks)._

## Files Created/Modified
- `src/cli/commands/trace-check.ts` (502 lines) — `scanTestCitations`, `resolveClaimCitation`/`ClaimResolution`, `traceCheckCommand`/`TraceCheckResult`, `printHumanReport`; imports `FINDING_KINDS`/`parseBuildManifest`/`parseInterpretationClaims`/`parseRulings` from `./build-manifest.js`, zero re-derivation
- `src/cli/commands/trace-check.test.ts` (497 lines, 35 tests) — table-driven citation-form tests, per-rung resolution-ladder tests, fixture-based (`makeProject`/`makeChunk`/`writeTestFile`/`writeRulings`) sweep tests for every finding kind, the read-only byte-hash test, and `--json`/human-report contract tests

## Exported Signatures (for plan 172-04's CLI registration, 172-05's proof, and Phase 173)

Exactly the plan's `<interfaces>` contract, no drift:

```typescript
export interface ScannedCitations { claims: number[]; rulings: number[]; importsRules: boolean; }
export function scanTestCitations(sourceText: string): ScannedCitations;

export type ClaimResolution =
  | { status: 'resolved'; chunk: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unresolved'; reason: 'no-owner' | 'no-live-claim' };
export function resolveClaimCitation(
  claimNumber: number,
  owners: string[],
  liveClaims: Record<string, number[]>,
  authoring: Record<string, boolean>,
): ClaimResolution;

export interface TraceCheckResult {
  findings: Finding[];
  counts: Record<FindingKind, number>;
  totals: { chunks: number; claims: number; rulings: number; testFiles: number; claimCitations: number; rulingCitations: number };
  unparsedSupersessions: Array<{ ruling: number; sentence: string }>;
}
export async function traceCheckCommand(
  options?: { project?: string; json?: boolean },
): Promise<TraceCheckResult>;
```

`traceCheckCommand` is NOT yet registered in `src/cli/cli.ts` — that is plan 172-04's explicit scope, per this plan's `<objective>`.

## Decisions Made
- **Custom forward-scanning number-list parser instead of a single monolithic regex.** A single regex trying to express "digits separated by comma/slash/and/whitespace, but stop before a Ruling token" either needs a negative lookahead re-derived per stop-word or over-matches. The forward scanner naturally terminates the moment the next token after a separator isn't a digit — `Ruling` simply fails the digit test and the scan stops, with no explicit exclusion list to maintain.
- **`CHUNK.md claim N` needed zero special-case code.** Because the citation head regex (`\bclaims?\b`) never requires anything to precede it, a `CHUNK.md ` prefix is invisible to the scanner by construction — it resolves through the exact same code path as a bare `claim N`, matching CONTEXT.md's explicit instruction without a dedicated branch.
- **Ambiguous-claim-ref's `chunk` field is the joined candidate list** (`resolution.candidates.join(', ')`), since `Finding.chunk` is a single string field but an ambiguous finding inherently names more than one chunk — `subject`/`detail` also name the claim number, citing file, and candidates explicitly, so no information is lost to the joined string.
- **`test-unlinked`'s owner attribution also joins multiple owners** the same way, for the same reason (a file can be manifest-listed by more than one chunk even when it correctly triggers `test-unlinked`).
- **Manifest-listed test-file discovery only scans paths ending in `.test.ts`** among all collected manifest entries (not every manifest path) — non-test manifest entries (source files) are drift-check's (172-03's) concern, never read by this module.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' `<action>` and `<behavior>` bullets are implemented without needing to touch `build-manifest.ts` or alter the locked interface contract.

## Issues Encountered

**Test-output noise during initial write of Task 3 tests:** early Task 2/3 test drafts each created a fresh `vi.spyOn(console, 'log')` per test, but every OTHER test in the file (which does not silence output) was printing the full human report to stdout during `npm test`, cluttering output with no assertion value. Fixed by consolidating a single shared `logSpy` into the file-level `beforeEach`/`afterEach` (silences by default; Task 3's assertion-bearing tests read the shared spy's `.mock.calls` directly instead of installing a second, competing spy). This is ordinary TDD/test-hygiene iteration, not a deviation from the plan's design — no production code changed as a result.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

`trace-check.ts`'s three exports (`traceCheckCommand`, `scanTestCitations`, `resolveClaimCitation`) and the `TraceCheckResult` shape are ready for:
- **172-03** (drift-check, same wave) — no shared surface with this plan beyond `build-manifest.ts`, already independent.
- **172-04** (CLI registration) — `traceCheckCommand(options)` is ready to wire into `cli.ts` as `boardsmith trace-check [--json] [--project <dir>]`, matching `chunk-provenance-status`'s existing registration shape exactly.
- **172-05** (real-game proof) — the command is unproven against `~/BoardSmithGames/seven`/`one-two-punch` real data; this plan's fixtures are all synthetic `mkdtemp` projects per the read-only invariant instruction (`~/BoardSmithGames/` was never touched). 172-05 must run `traceCheckCommand` against COPIES of both reference games and record real finding counts, per the proof-harness template `172-RESEARCH.md` specifies.
- **Phase 173** (`/bs-verify-game`) — `TraceCheckResult`'s `--json` shape is stable and fully populated (all nine `FINDING_KINDS` always present as keys, zero-valued when absent) — ready to be a pipeline input without further shape negotiation.

No blockers for wave 2's remaining plans or for 172-04/172-05.

---
*Phase: 172-source-free-conformance-checks*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/cli/commands/trace-check.ts
- FOUND: src/cli/commands/trace-check.test.ts
- FOUND commit: 9ec51b4c
- FOUND commit: b036905d
- FOUND commit: 6d9047bb
- npx vitest run src/cli/commands/trace-check.test.ts: 35/35 passed
- npm test (full suite): 3476/3476 passed (baseline 3441 + 35 new)
