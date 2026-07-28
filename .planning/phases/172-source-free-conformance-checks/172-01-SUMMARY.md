---
phase: 172-source-free-conformance-checks
plan: 01
subsystem: cli
tags: [vitest, cli, parser, regex, tdd]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    provides: chunk-provenance.ts's section-locating/line-anchoring discipline (f73153a3), CHUNK.template.md, chunk-provenance.test.ts fixture conventions
provides:
  - "src/cli/commands/build-manifest.ts — the single shared parser module for CHECK-03/CHECK-05: findHeadingIndex, extractSection, parseBuildManifest, parseInterpretationClaims, extractVerifiedCommitHash, parseRulings, FINDING_KINDS"
  - "chunk-provenance.ts's parseVerifiedAgainst fixed to use line-anchored heading location, closing the latent f73153a3 recurrence"
affects: [172-02-trace-check, 172-03-drift-check, 172-04-cli-registration, 172-05-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One heading-location primitive per codebase (findHeadingIndex), never a second hand-rolled indexOf(heading) copy"
    - "Section body extraction bounded to the next `^## ` line, never `^#+ `, so `### ` subheadings inside a section are included in its body"
    - "tabular:false vs tabular:true-with-zero-entries as distinct ParsedManifest states so callers can tell 'could not parse' from 'parsed, and there are none'"
    - "Narrow, direction-aware verb matching for RULINGS.md supersession — only 'supersedes Ruling N' / 'superseded by Ruling N', never a broader cross-reference vocabulary"

key-files:
  created:
    - src/cli/commands/build-manifest.ts
    - src/cli/commands/build-manifest.test.ts
  modified:
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts

key-decisions:
  - "parseBuildManifest reports tabular:true with zero entries when header/separator table structure is present but has no data rows, and tabular:false only when the section has non-table prose content — computed via a table-structure scan of the whole section body, not just the absence of data rows, so an EMPTY table isn't misclassified as prose"
  - "authoring in ManifestEntry checks editing verbs (edited/extended/rewritten/tightened) BEFORE the NEW/written test, so a status cell naming both is conservatively non-authoring, matching the plan's stated rationale for the resolution ladder's rung 3"
  - "parseRulings resolves supersession per-sentence (split on sentence terminators/newlines) so a 'superseded by' phrase and an unrelated 'supersedes the RATIONALE of' phrase in the same entry body are classified independently rather than one regex racing the other across the whole body"
  - "parseVerifiedAgainst's fix is bounded to exactly one import + one call-site change, per the plan's scope_override — no other change to chunk-provenance.ts"

patterns-established:
  - "extractSection(text, heading) -> string | undefined is the one section-body extraction primitive; parseInterpretationClaims/parseBuildManifest/extractVerifiedCommitHash are all built on it rather than each re-deriving their own heading-to-next-heading regex"

requirements-completed: [CHECK-03, CHECK-05]

duration: ~20min
completed: 2026-07-28
---

# Phase 172 Plan 01: Shared build-manifest.ts parser module + parseVerifiedAgainst fix Summary

**Line-anchored heading locator (`findHeadingIndex`/`extractSection`) plus Build Manifest, Interpretation-claim, Verified-Commit-Hash, and RULINGS.md parsers in one new `src/cli/commands/build-manifest.ts`, and a one-line fix closing the latent `f73153a3` substring-heading bug in `chunk-provenance.ts`'s `parseVerifiedAgainst`.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-28T14:56Z (approx, first tool call)
- **Completed:** 2026-07-28T20:02Z (approx, this summary)
- **Tasks:** 3 (all completed)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Built the single "one parser, one authority" module (`build-manifest.ts`) that plans 172-02 and 172-03 import from, exporting exactly the `<interfaces>` contract signatures.
- Every behavior bullet from the plan (comma-joined manifest rows, prose-vs-empty-table distinction, non-contiguous claim numbering, `### Corrections` continuation shape, all five commit-hash formats, both supersession directions, narrow verb matching) has a passing unit test built from the real shapes RESEARCH.md measured.
- Closed the latent `f73153a3` defect recurrence in `parseVerifiedAgainst` — proven with a regression test built from the REAL shipped `CHUNK.template.md` (not a hand-written approximation), reproducing the exact defect (section deleted, template's line-18 prose mention of the heading still present) and confirming the fix.

## Task Commits

Each task was committed atomically (TDD RED/GREEN per task):

1. **Task 1: Line-anchored locator, FINDING_KINDS, Build Manifest/claim/hash parsers**
   - `83778f5c` (test) — failing tests for the whole module (all 30, including Task 2's ruling tests, written up front per the plan's single-file TDD scope)
   - `5196c7ed` (feat) — `findHeadingIndex`, `extractSection`, `parseBuildManifest`, `parseInterpretationClaims`, `extractVerifiedCommitHash`, `FINDING_KINDS` (24/30 tests passing at this commit; `parseRulings` not yet exported)
2. **Task 2: RULINGS.md parser with narrow, direction-aware supersession**
   - `1b82b3c8` (feat) — `parseRulings` added; all 30/30 tests passing
3. **Task 3: Fix the latent f73153a3 recurrence in parseVerifiedAgainst**
   - `276ee3db` (test) — failing regression test, reproducing the bug against the real shipped template (confirmed RED: `blockMalformed` was `true`, expected `false`)
   - `eab5b7d5` (fix) — `parseVerifiedAgainst` now imports and calls `findHeadingIndex` instead of `chunkText.indexOf(VERIFIED_AGAINST_HEADING)`; all 54/54 `chunk-provenance.test.ts` tests passing

**Plan metadata:** (this commit, following)

_Note: Tasks 1 and 3 followed full RED→GREEN TDD; Task 2 built on Task 1's already-committed RED test file (the ruling `describe` block was part of the same up-front test file, isolated into its own commit once its implementation landed)._

## Files Created/Modified
- `src/cli/commands/build-manifest.ts` (334 lines) - `FINDING_KINDS`/`FindingKind`/`Finding`, `findHeadingIndex`, `extractSection`, `parseBuildManifest`/`ManifestEntry`/`ParsedManifest`, `parseInterpretationClaims`, `extractVerifiedCommitHash`, `parseRulings`/`ParsedRuling` — exactly the plan's `<interfaces>` contract, no drift
- `src/cli/commands/build-manifest.test.ts` (368 lines, 30 tests) - unit coverage for every behavior bullet in Tasks 1 and 2
- `src/cli/commands/chunk-provenance.ts` - added `import { findHeadingIndex } from './build-manifest.js'`; `parseVerifiedAgainst` now calls `findHeadingIndex(chunkText, VERIFIED_AGAINST_HEADING)` instead of `chunkText.indexOf(VERIFIED_AGAINST_HEADING)`; doc comment above the function updated to explain why
- `src/cli/commands/chunk-provenance.test.ts` - added `describe('parseVerifiedAgainst — heading location', ...)` (4 tests) nested inside the existing `chunk-provenance-status` describe block (reusing its `makeStatusProject`/`addChunk` fixture helpers)

## Exported Signatures (for Wave 2 — plans 172-02, 172-03)

No drift from the plan's `<interfaces>` block. Exact exports from `src/cli/commands/build-manifest.ts`:

```typescript
export const FINDING_KINDS: readonly [
  'claim-untested', 'ruling-untested', 'test-unlinked', 'unassociated-test',
  'ambiguous-claim-ref', 'unresolved-claim-ref', 'manifest-file-missing',
  'chunk-code-drifted', 'drift-unknown',
];
export type FindingKind = (typeof FINDING_KINDS)[number];
export interface Finding { kind: FindingKind; chunk: string; subject: string; detail: string; }
export function findHeadingIndex(text: string, heading: string): number;
export function extractSection(text: string, heading: string): string | undefined;
export interface ManifestEntry { path: string; status: string; authoring: boolean; }
export interface ParsedManifest { tabular: boolean; entries: ManifestEntry[]; pathlessRowIndexes: number[]; }
export function parseBuildManifest(chunkText: string): ParsedManifest;
export function parseInterpretationClaims(chunkText: string): number[];
export function extractVerifiedCommitHash(chunkText: string): string | undefined;
export interface ParsedRuling { number: number; supersededBy?: number; unparsedSupersession: string[]; }
export function parseRulings(rulingsText: string): ParsedRuling[];
```

No `indexOf('## ...')` heading-location call anywhere in the new module (verified via the plan's own grep check).

## Decisions Made
- **`tabular:true` for a table with header/separator structure and zero data rows, distinguished by scanning for structure independent of data-row presence.** The naive approach (rowLines.length === 0 → check if body has any content) misclassified an empty table (whose body still contains the literal header/separator rows) as `tabular:false`, since those two rows ARE non-whitespace content. Fixed by scanning for a header or separator row anywhere in the section, independent of whether any data row follows.
- **`extractSection`'s body-start index is the character AFTER the heading line's newline, not the newline character itself** — an off-by-one in the first implementation attempt included the heading line's own trailing newline in the body, producing a spurious leading blank line. Fixed and covered by the exact-body test.
- **Editing verbs checked before NEW/written** in `parseBuildManifest`'s authoring derivation, per the plan's explicit instruction — verified with a fixture status cell naming both ("edited, then NEW again") to pin the conservative direction.
- **Supersession sentences are matched per-sentence, not per-body** — `RULINGS.md` entry bodies can contain multiple sentences, only some of which use a supersede verb; splitting on sentence terminators before applying `SUPERSEDED_BY`/`SUPERSEDES_RULING` avoids one verb-shape's regex accidentally capturing text meant for a different sentence.

## Deviations from Plan

None — plan executed exactly as written. The interface contract was implementable as specified; no signature changes were needed for wave 2.

Two implementation bugs were caught and fixed during the RED→GREEN cycle for Task 1 before any commit landed (both are ordinary TDD iteration, not deviations from the plan's design):
1. `extractSection`'s off-by-one leading-newline bug (see Decisions above).
2. `parseBuildManifest`'s empty-table-vs-prose misclassification (see Decisions above).

Neither required touching the locked `<interfaces>` signatures or changing scope.

## Issues Encountered

**Grep-literal note on Task 3's done criterion:** the plan's done criterion states `grep -n "indexOf(VERIFIED_AGAINST_HEADING)" src/cli/commands/chunk-provenance.ts` should return nothing. A literal run of that grep still matches one PRE-EXISTING comment line at `chunk-provenance.ts:388` (`chunkCheckCommand`'s own doc comment, written during Phase 171, quoting the OLD bug's code shape as historical documentation — `` `indexOf(VERIFIED_AGAINST_HEADING)` also matched prose ``). This line was not modified by this plan (out of scope per the task's explicit "no other change to chunk-provenance.ts" constraint) and is prose inside a comment, not a live code call — `parseVerifiedAgainst`'s actual `indexOf(VERIFIED_AGAINST_HEADING)` call site (the only live one) has been removed and verified absent. My own new doc comment above `parseVerifiedAgainst` was worded to avoid literally containing the grepped string, so it does not add a second false-positive. Flagging this so the grep's literal result is understood rather than mistaken for an incomplete fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`build-manifest.ts`'s exports are ready for 172-02 (`trace-check.ts`) and 172-03 (`drift-check.ts`) to import without reading its implementation — no interface drift occurred. `parseVerifiedAgainst`'s fix is live and covered; `chunk-provenance-status`'s existing 50 tests plus the 4 new regression tests all pass unmodified/added. No blockers for wave 2.

---
*Phase: 172-source-free-conformance-checks*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/cli/commands/build-manifest.ts
- FOUND: src/cli/commands/build-manifest.test.ts
- FOUND: src/cli/commands/chunk-provenance.ts
- FOUND: src/cli/commands/chunk-provenance.test.ts
- FOUND commit: 83778f5c
- FOUND commit: 5196c7ed
- FOUND commit: 1b82b3c8
- FOUND commit: 276ee3db
- FOUND commit: eab5b7d5
- npx vitest run src/cli/commands/build-manifest.test.ts src/cli/commands/chunk-provenance.test.ts: 84/84 passed
- npm test (full suite): 3441/3441 passed (baseline 3407 + 34 new)
