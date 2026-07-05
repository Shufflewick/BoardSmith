---
phase: 149-end-to-end-dry-run-validation
verified: 2026-07-05T09:50:00Z
status: human_needed
score: 7/7 must-haves verified (automated); 1 inherently-manual gate outstanding by design
human_verification:
  - test: "Browser playtest of the dry-run's generated chunk-1 Go Fish code (or hand-built go-fish side-by-side) per the numbered script in 149-HUMAN-UAT.md"
    expected: "Ask/give/go-fish/extra-turn flow behaves correctly; seat 2 never sees seat 1's hand contents or the identity of a card drawn on a miss"
    why_human: "Real-time UI feel and cross-seat visual information leakage cannot be confirmed by static analysis alone; this is the one gate the pipeline's own design marks as human-only (bs/build/playtest.md)"
---

# Phase 149: End-to-End Dry-Run Validation Verification Report

**Phase Goal:** The full rulebook-to-playable-game pipeline is proven end-to-end against a real rulebook (Go Fish) before it is ever pointed at an actual designer.
**Verified:** 2026-07-05T09:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Dry-run ran ingest + chunk-1 build against Go Fish following the real bs- skills, producing a run log + 4-axis comparison table + defect ledger | ✓ VERIFIED | `149-DRYRUN-REPORT.md` exists with §1 (what ran, per-leg), §2 (4-axis comparison table: rule fidelity, hidden-info redaction, BoardSmith idiom, artifact/template quality — 3 MATCH + 1 MATCH-with-acceptable-divergence), §3 (defect ledger with D1/D2/F2/F3 + 2 no-defect items, each with a disposition) |
| 2 | D1 (project-scaffold.ts tsconfig defect) fixed at source with a load-bearing test that goes RED if `vite/client` is dropped | ✓ VERIFIED | `src/cli/lib/project-scaffold.ts:188` — `generateTsConfig()` now includes `types: ['vite/client']`; `vite: '^5.4.0'` added as explicit devDependency (line 148). Test `project-scaffold.test.ts:166-218` ("WR-02: Defect 1 is load-bearing") independently compiles the actual re-export graph (`boardsmith/ui` → `useActionController.ts`'s `import.meta.env.DEV`) twice via the real TS compiler API — once with `types: []` (asserts TS2339 error present) and once with `types: ['vite/client']` (asserts it's gone). This is a genuine differential test, not a string-presence check; dropping the fix would flip the second assertion and fail. Confirmed by reading the test body directly. |
| 3 | D2 (init.ts git-init defect) fixed at source with a test that actually forces a commit failure and confirms non-fatal behavior | ✓ VERIFIED | `src/cli/commands/init.ts:77-90` — `initCommand` now runs `git init` + `git add -A` + a best-effort commit wrapped in try/catch. Test `init.test.ts:122-149` ("is non-fatal to scaffolding when the commit fails") genuinely neutralizes git identity (`GIT_CONFIG_GLOBAL=/dev/null`, empty `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars) so the commit step actually fails, then asserts `initCommand` resolves without throwing and that `.git` + `package.json` still exist. Read the test body directly — this forces the real failure path, not a mocked one. |
| 4 | bs/ drift suites (237) stay green after the fixes | ✓ VERIFIED | Ran `npx vitest run src/cli/slash-command/bs/` myself: **237/237 pass** (4 files: status-tools, ingest, templates, build-chunk) |
| 5 | Full `npm test` suite green (claimed 2652) after all fixes | ✓ VERIFIED | Ran `npm test` myself: **2652/2652 pass, 184 files, 0 failures** — matches the claimed count exactly |
| 6 | 149-HUMAN-UAT.md exists capturing the deferred browser-playtest (correct deferral, not a gap) | ✓ VERIFIED | `149-HUMAN-UAT.md` exists: self-contained numbered click-by-click script (copied inline from the scratch project's `PLAYTEST-SCRIPT.md`, not referencing the throwaway scratch dir), regression/taste/second-seat-leak-check sections, unchecked Verified Checklist, `Status: partial / pending` — explicitly routed to `/gsd:audit-uat` |
| 7 | go-fish hand-built repo (`~/BoardSmithGames/go-fish/`) was NOT modified | ✓ VERIFIED | `git status --short` in `~/BoardSmithGames/go-fish/` shows only one untracked, pre-existing build artifact (`vite.config.ts.timestamp-*.mjs`, dated before this phase per `git log -1` showing the last real commit was 2026-07-04, one day prior); no tracked-file diffs, no new commits from this phase |

**Score:** 7/7 automated must-haves verified. 1 human-verification item outstanding by design (the browser playtest), which is the correct/expected phase-closing state for VAL-01 per `149-VALIDATION.md`'s own scope (`nyquist_compliant: true`, manual playtest gate documented as inherent).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `149-DRYRUN-REPORT.md` | Run log + 4-axis comparison + defect ledger | ✓ VERIFIED | Present, complete, all sections populated with concrete evidence (file:line citations, real check-result tables) |
| `149-HUMAN-UAT.md` | Self-contained browser-playtest capture | ✓ VERIFIED | Present, self-contained (script inlined, survives scratch cleanup), correctly unchecked |
| `src/cli/lib/project-scaffold.ts` | D1 fix (`types: ['vite/client']` + explicit `vite` devDep) | ✓ VERIFIED | Both present at lines 148, 188 |
| `src/cli/commands/init.ts` | D2 fix (non-fatal `git init` + commit) | ✓ VERIFIED | Present at lines 77-90, wrapped in try/catch |
| `src/cli/lib/project-scaffold.test.ts` | Load-bearing D1 regression tests | ✓ VERIFIED | 3 new tests, one is a genuine differential TS-compile test (not just string assertion) |
| `src/cli/commands/init.test.ts` | Load-bearing D2 regression tests | ✓ VERIFIED | 2 new tests, one genuinely forces commit failure via env-var identity neutralization |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `149-01/02-SUMMARY.md` defect logs | `149-DRYRUN-REPORT.md` §3 | Defect IDs D1/D2/F2/F3 carried through with same descriptions | ✓ WIRED | Matches across all three plan summaries and the report |
| `149-DRYRUN-REPORT.md` D1/D2 dispositions | Actual source fixes | Commit `7255e284` referenced in both SUMMARY and REPORT | ✓ WIRED | Commit exists in `git log`; fixes present in current source |
| `149-HUMAN-UAT.md` | `/gsd:audit-uat` | Explicit "Feeds:" frontmatter line + "route to the user via `/gsd:audit-uat`" | ✓ WIRED | Explicit routing statement present |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| VAL-01 | 149-01, 149-02, 149-03 | "The full pipeline is dry-run against a reference game rulebook end-to-end (ingest → several chunks → playtest gates) and compared against the hand-built implementation before release" | ✓ SATISFIED (with correct human-gate deferral) | Ingest + chunk-1 build legs both ran against Go Fish; comparison table complete; playtest gate deferred to human per the requirement's own design (playtest gates are inherently human-terminal) |

REQUIREMENTS.md marks VAL-01 as "Complete" for Phase 149 — consistent with this verification's finding that all automatable parts are done and the sole remaining item is the by-design human gate.

**Note on scope wording:** 149-03-PLAN.md's must-have truth reads "fixed at source in the bs- skill files," but both real fixes actually live in CLI scaffold/init source code (`project-scaffold.ts`, `init.ts`), not skill markdown. The SUMMARY documents this explicitly as a deliberate, reasoned deviation (root cause lived in generated-project code, not skill instruction text) and confirms no `bs/**` skill file needed editing. This is judged correct, not a gap — "fixed at source" is satisfied by fixing the actual root cause location.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in `project-scaffold.ts` or `init.ts` | — | None |

### Human Verification Required

### 1. Browser playtest of chunk-1 Go Fish

**Test:** Run `npx boardsmith dev --players 2` against either the dry-run's scratch chunk-1 project or the hand-built go-fish, and walk the numbered script in `149-HUMAN-UAT.md` (ask-hit, ask-miss/go-fish, seat-2-takes-turn, regression n/a, taste check, second-seat hidden-info leak check).
**Expected:** All 6 checklist items in `149-HUMAN-UAT.md`'s Verified Checklist confirm true — in particular, seat 2 never sees seat 1's hand or drawn-card identity.
**Why human:** Real-time UI behavior and cross-seat visual information leakage require a human clicking through a live session; this is the pipeline's own designated human-only gate (`bs/build/playtest.md`), not an automatable check. `149-VALIDATION.md` itself designates this the correct point of manual deferral (`nyquist_compliant: true`).

### Gaps Summary

No gaps found. All automatable must-haves for VAL-01 are verified against actual source code and re-run test suites (not just SUMMARY claims):

- Both D1 and D2 fixes exist in the claimed files at the claimed locations, and their regression tests were read directly and confirmed to be genuinely load-bearing (differential compile test for D1, forced-failure-path test for D2) rather than superficial string-presence checks.
- The bs/ drift suite (237/237) and full BoardSmith suite (2652/2652) were both re-run independently by this verifier and matched the SUMMARY's claimed counts.
- The hand-built `~/BoardSmithGames/go-fish/` repo was confirmed untouched (only a pre-existing untracked build artifact present, no tracked changes, no new commits).
- `149-DRYRUN-REPORT.md` and `149-HUMAN-UAT.md` both exist with the required structure and content.

The single outstanding item — the human browser playtest — is the phase's own designed terminal gate, not a defect. Per the phase's explicit scope (`149-VALIDATION.md`: "the human browser-playtest is inherently manual... this is the ONE deferred gate the milestone ships with outstanding"), `human_needed` is the correct and expected final status for this phase, not `gaps_found`.

---

_Verified: 2026-07-05T09:50:00Z_
_Verifier: Claude (gsd-verifier)_
