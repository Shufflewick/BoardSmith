---
phase: 154-merc-re-vendor
verified: 2026-07-06T17:15:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 154: MERC Re-Vendor Verification Report

**Phase Goal:** MERC's vendored BoardSmith copy carries the DEF-B dev-host lost-update fix (281e8155) plus the v4.7 asset (Phase 152) and dev-host (Phase 153) fixes, proven by MERC's own test suite staying green.
**Verified:** 2026-07-06T17:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MERC's vendored copy is refreshed to current BoardSmith src/ (post 152/153) | ✓ VERIFIED | `package.json` boardsmith dep = `file:./vendor/boardsmith-0.0.1-20260706164142.tgz` (new tgz, superseding prior `20260703202418.tgz`); tgz timestamp (Jul 6 11:41) postdates Phase 152/153 commits (57737141, abdda55b) |
| 2 | Installed vendored copy actually contains the DEF-B + Phase 152 + Phase 153 fixes | ✓ VERIFIED | `grep` in `node_modules/boardsmith/src/` and `dist/cli.js` found `generateAssetImageVue` (152), `connection-handler.ts` file present (153), and the `clients.get(clientId) === socket` guard (153) in both src and bundled dist |
| 3 | DEF-B commit (281e8155) is an ancestor of the BoardSmith HEAD that was packed | ✓ VERIFIED | `git merge-base --is-ancestor 281e8155 HEAD` → exit 0, printed "yes" |
| 4 | MERC's full test suite passes at same-or-better rate than baseline (738/7) | ✓ VERIFIED | Independently re-ran `npm test` in MERC repo: **738 passed / 7 skipped (745), 28 test files, 33.62s** — exact match to documented baseline, zero regressions |
| 5 | No MERC-side source changes were needed (or documented if any were) | ✓ VERIFIED | `git show --stat HEAD` on MERC's re-vendor commit `38ac286` shows only `package.json` (4 lines) + `package-lock.json` (8 lines) changed — the mechanical dep-bump only, no MERC src/ modifications |
| 6 | Re-vendor committed in MERC repo as integration proof | ✓ VERIFIED | `git log` shows `38ac286 chore: re-vendor boardsmith (v4.7 playtest follow-up: DEF-B + ASSET/DEVHOST fixes)` as MERC's HEAD |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `~/Dropbox/MERC/BoardSmith/MERC/vendor/boardsmith-0.0.1-20260706164142.tgz` | New packed tarball from current BoardSmith HEAD | ✓ VERIFIED | Present in vendor/, 1,521,416 bytes, dated Jul 6 11:41, largest/newest of all historical tgz's in that directory |
| `~/Dropbox/MERC/BoardSmith/MERC/package.json` | Updated `boardsmith` dep + overrides pointing at new tgz | ✓ VERIFIED | `dependencies.boardsmith` and `overrides.boardsmith` both = `file:./vendor/boardsmith-0.0.1-20260706164142.tgz` |
| `~/Dropbox/MERC/BoardSmith/MERC/node_modules/boardsmith` | Installed copy carrying all three v4.7 fixes | ✓ VERIFIED | `generateAssetImageVue`, `connection-handler.ts`, `clients.get(clientId) === socket` all present in src/ and dist/cli.js |
| MERC git commit `38ac286` | Re-vendor commit, mechanical dep-bump only | ✓ VERIFIED | `git show --stat` confirms package.json + package-lock.json only |
| BoardSmith repo (`/Users/jtsmith/BoardSmith`) | Unchanged except planning docs (no library-side changes in this phase) | ✓ VERIFIED | `git status --short` shows only an unrelated untracked audit report HTML; no staged/modified src changes from this phase |

### Key Link Verification

Not applicable in the traditional import/wiring sense — this is a cross-repo dependency-propagation phase. The "link" verified is: BoardSmith HEAD → `npm pack` → tgz → MERC `package.json` dependency → `node_modules/boardsmith` (installed) → MERC test suite exercising that installed copy. All links independently confirmed above (grep for fix markers inside the installed `node_modules/boardsmith`, and an independent `npm test` re-run consuming exactly that installed copy).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|-------------|--------|----------|
| VENDOR-01 | 154-01 | MERC's vendored BoardSmith copy re-vendored to include DEF-B + v4.7 fixes; MERC's full suite passes against re-vendored copy | ✓ SATISFIED | All truths above verified independently; suite re-run confirms 738/7 exactly matching baseline |

REQUIREMENTS.md still shows VENDOR-01 as unchecked (`- [ ]`) in the source-of-truth table, but this is expected — the checkbox update is typically applied by the milestone-close/orchestrator step, not the phase execution itself; the underlying work and success criteria are fully verified above.

### Anti-Patterns Found

None. This phase's only changes are in the MERC repo (mechanical dependency bump: package.json + package-lock.json) and BoardSmith's own planning docs — no source code was authored in this phase to scan for stub patterns, TODOs, or hollow implementations.

### Human Verification Required

None. All success criteria are technical/mechanical (dependency version, file contents via grep, test suite pass/fail counts) and were independently re-executed rather than taken on faith from SUMMARY.md.

### Gaps Summary

No gaps found. All three phase success criteria are met:

1. **Vendored copy refreshed** — confirmed via new tgz filename/timestamp and package.json pointing at it, postdating both Phase 152 and Phase 153 BoardSmith commits.
2. **MERC suite passes at same-or-better rate** — independently re-ran the suite (not trusting SUMMARY's reported numbers) and got the exact same result: 738 passed / 7 skipped, 28 files, no regressions.
3. **No MERC-side source changes** — confirmed via `git show --stat` on the re-vendor commit; only package.json/package-lock.json touched, no compatibility gap to document.

Additionally confirmed DEF-B (`281e8155`) is a real ancestor of the packed BoardSmith HEAD (not just claimed), and that the specific fix markers (`generateAssetImageVue`, `connection-handler.ts`, the `clients.get(clientId) === socket` guard) are physically present in the installed `node_modules/boardsmith` that MERC's test run actually consumed.

---

_Verified: 2026-07-06T17:15:00Z_
_Verifier: Claude (gsd-verifier)_
