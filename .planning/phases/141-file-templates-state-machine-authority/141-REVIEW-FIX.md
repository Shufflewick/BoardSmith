---
phase: 141-file-templates-state-machine-authority
fixed_at: 2026-07-04T21:25:00Z
review_path: .planning/phases/141-file-templates-state-machine-authority/141-REVIEW.md
iteration: 3
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 141: Code Review Fix Report

**Fixed at:** 2026-07-04T21:25:00Z
**Source review:** .planning/phases/141-file-templates-state-machine-authority/141-REVIEW.md (iteration 2)
**Iteration:** 3

**Summary:**
- Findings in scope: 3 (3 Warning; 6 Info findings out of scope per fix_scope=critical_warning)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: Light-path chunks never run `close` — no prescribed mechanism records their verified commit hash

**Files modified:** `src/cli/slash-command/bs/state-machine.md`
**Commit:** 6b5b4122
**Applied fix:** Rewrote the light-path status-transition paragraph. Removed the misleading "at `playtest` exactly as a full-ceremony chunk does" (which pointed the verified transition at the wrong step) and added the prescription: because the light path has no `close` step, the light-path `playtest` step also performs `close`'s bookkeeping — records the verified commit hash in CHUNK.md (bisect anchor, cross-referenced to Git Protocol), updates the Status line CHUNK.md-first/SKETCH.md-second per Write Order, and rolls up decisions. The pinned light-path step-name string `build, test, playtest` is unchanged, so the drift tests and plan remain aligned.

### WR-02: Fixed state-machine.md contradictions were not back-ported to `.planning/bs-skills-plan.md`

**Files modified:** `.planning/bs-skills-plan.md`
**Commit:** a1c4f749
**Applied fix:** Two one-line edits so phases 142+ authored from the plan don't reintroduce resolved defects. (1) Consistency-check bullet (line ~47): "every sketch slug has a directory" → "every sketch slug with a detailed entry has a directory (sketch-level tail entries exempt — they gain their directory when detailed at a close gate)", matching the CR-02 resolution in state-machine.md. (2) Session step groups (line ~147): group 4 is now "{playtest + one revise round + close}", matching the WR-04 resolution (close assigned to handoff group 4).

### WR-03: New grammar strings pinned only on the template side — state-machine.md's copies could drift silently

**Files modified:** `src/cli/slash-command/bs/templates.test.ts`
**Commit:** 1f970314
**Applied fix:** Hoisted two shared strings to suite-level consts alongside `STALE_MARKER`: `SKETCH_LEVEL_MARKER` (`Status: proposed (sketch-level — no CHUNK.md yet)`) and `DERIVED_POINTER_GRAMMAR` (`Status (derived from chunks/<slug>/CHUNK.md):`). Added three tests to the CHUNK/SKETCH ↔ state-machine consistency block: (1) sketch-level marker byte-identical in both state-machine.md and SKETCH.template.md, with a hyphen-regression guard on both copies; (2) derived-pointer grammar byte-identical in both files; (3) CHUNK.template.md pins Ceremony valid values as exactly `Valid values: full | light`. The existing SKETCH.template.md marker assertion now uses the shared const. Suite grew 41 → 44 tests.

## Verification

- `npx vitest run src/cli/slash-command/bs/templates.test.ts` — 44/44 passing.
- `npm test` (full suite) — 179 files, 2430 tests, all passing.

---

_Fixed: 2026-07-04T21:25:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
