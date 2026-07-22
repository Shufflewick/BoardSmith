---
requirements-completed: [TOOL-01, TOOL-02, PROC-01]
---

# Plan 162-01 Summary — Comment-Strip Asset-Scan Gate + boardsmith/testing Export (TOOL-01, TOOL-02, PROC-01)

**Plan:** 162-01 (execute — asset-scan comment-stripping + additive export barrel)
**Completed:** 2026-07-21
**Result:** PASS — `scanAssetReachability` no longer false-FAILs on commented-out `<img>` tags
(JS line/block, Vue HTML, multi-line block) and is now importable from `boardsmith/testing`;
PROC-01's RED-before-GREEN and adversarial-bypass gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/cli/lib/__fixtures__/asset-scan/commented-img/src/ui/CommentedImg.vue`
   — a real false-FAIL repro with a Vue HTML comment (line 2), a JS line comment (line 9), a
   same-line JS block comment (line 12), a multi-line block comment whose interior line (16) carries
   an `<img`, and ONE genuinely-live `<img>` (line 4) as the negative control. Extended
   `asset-scan.test.ts` with two cases pointed at the fixture. Added
   `src/testing/scan-asset-export.test.ts` importing `scanAssetReachability` from
   `'boardsmith/testing'`. Ran all three against unfixed source and captured the real RED (below). No
   production source touched in this commit.
2. **Task 2 (GREEN):** Added `stripComments()` to `asset-scan.ts` — a line-oriented state machine
   tracking block-comment (`/* */`) and HTML-comment (`<!-- -->`) open state ACROSS lines, blanking
   comment characters to spaces (preserving line length/index so `AssetViolation.line` stays accurate
   against the original source). A `//` immediately preceded by `:` (URL scheme separator, e.g.
   `https://`) is not treated as a line-comment opener. Wired the stripped view in front of the single
   `BARE_IMG_TAG` regex — no second detector. Added an additive re-export of `scanAssetReachability` +
   `AssetViolation` from `src/testing/index.ts` (`../cli/lib/asset-scan.js`), mirroring the existing
   `dom-leak.js` export shape; internal relative-path importers untouched.
3. **Task 3:** Added four adversarial cases attempting to defeat the strip: a live `<img>` before a
   same-line comment opener (still flagged), a live `<img>` genuinely inside a same-line block comment
   (not flagged), `<img>` text inside a non-comment string literal (still flagged — strip is
   comment-scoped only), and an unterminated block comment (no crash, stays stripped through EOF). Ran
   the full suite to confirm no collateral breakage.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ src/testing/scan-asset-export.test.ts > ... resolves to a callable function
  AssertionError: expected 'undefined' to be 'function'
❯ src/testing/scan-asset-export.test.ts > ... scans a real fixture and returns no violations ...
  TypeError: scanAssetReachability is not a function
❯ src/cli/lib/asset-scan.test.ts > ... does NOT flag <img> tags that only appear inside comments ...
  AssertionError: expected { file: 'src/ui/CommentedImg.vue', line: 2, message: '...' } to be undefined
❯ src/cli/lib/asset-scan.test.ts > ... still flags a genuinely-live <img> ...
  AssertionError: expected 5 to be 1 // Object.is equality

Test Files  2 failed (2)
     Tests  4 failed | 7 passed (11)
```
The 7 passing tests were the 8 pre-existing legacy cases minus one shared file's collection (unrelated
to this defect), proving the fixture/test wiring itself works and the failures are the real defects
(commented `<img` wrongly flagged; export unresolvable), not a mechanical/import error.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
✓ src/cli/lib/asset-scan.test.ts (9 tests) 7ms
✓ src/testing/scan-asset-export.test.ts (2 tests) 2ms

Test Files  2 passed (2)
     Tests  11 passed (11)
```

## Adversarial verification (Task 3, real over-strip attempts)

- Live `<img>` followed on the same line by an HTML comment containing another `<img>` → still
  flagged (line reported correctly), proving the strip does not over-consume the line.
- Live `<img>` genuinely inside a same-line `/* ... */` block comment → not flagged.
- `const s = "<img src='/cards/x.svg'>";` (non-comment string literal) → still flagged, unchanged
  from pre-fix behavior (strip is comment-scoped, not a blanket markup filter).
- Unterminated `/*` block comment → no crash; every subsequent line (including one with a bare
  `<img`) stays stripped through end-of-file.

All four attempts failed to defeat the fix (see `asset-scan.test.ts`, the adversarial cases added in
Task 3's commit).

## Verification

- `npx vitest run src/cli/lib/asset-scan.test.ts src/testing/scan-asset-export.test.ts` — 13 tests in
  `asset-scan.test.ts` (9 legacy/repro + 4 adversarial) and 2 in `scan-asset-export.test.ts`, all
  pass.
- `npm test` — **208 files / 2931 tests pass**, at/above the pre-phase baseline (207/2923). The
  increase is this plan's 8 net-new tests (2 repro + 2 export + 4 adversarial); nothing regressed.
- Grep gate: `grep -c 'scanAssetReachability' src/testing/index.ts` → 1 (≥1 required).
- Grep gate: `grep -c 'BARE_IMG_TAG' src/cli/lib/asset-scan.ts` → 2 (definition + the one test site,
  unchanged from pre-fix — still a single detector).

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 2 - missing critical correctness guard] Added a URL-scheme (`://`) guard to the
line-comment detector**
- **Found during:** Task 2 (implementation), before any test wrote it up as a defect
- **Issue:** A naive `//`-anywhere-in-line detector would misinterpret `https://` inside a live
  string (e.g. an asset URL) as a line-comment opener, silently blanking the rest of that line —
  which could hide a live `<img>` later on the same line and weaken the gate exactly as
  T-162-01 warns against.
- **Fix:** `stripComments()` skips a `//` match when the preceding character is `:`, continuing the
  scan for the next real comment opener on that line.
- **Files modified:** `src/cli/lib/asset-scan.ts`
- **Commit:** `78876f55`

None else — the rest of the plan executed exactly as written.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model (T-162-01 through
T-162-03); no new, unlisted security-relevant surface was introduced. The additive
`boardsmith/testing` export (T-162-03, disposition `accept`) carries no new authority.

## Self-Check: PASSED

- `src/cli/lib/__fixtures__/asset-scan/commented-img/src/ui/CommentedImg.vue` — FOUND
- `src/testing/scan-asset-export.test.ts` — FOUND
- `src/cli/lib/asset-scan.ts` (`stripComments`) — FOUND
- `src/testing/index.ts` (`scanAssetReachability` re-export) — FOUND
- Commit `3fde2ca0` (RED) — FOUND in `git log`
- Commit `78876f55` (GREEN) — FOUND in `git log`
- Commit `f3a57746` (adversarial + full-suite sweep) — FOUND in `git log`
