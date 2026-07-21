# Phase 166 Plan Check — Skills Defects: Session-Lock + UI/Library Boundary

**Verdict: PASS**

## Scope
2 plans, 2 waves. 166-01 (wave 1, SKILLDEF-01/PROC-01) → 166-02 (wave 2, depends_on 166-01,
SKILLDEF-02/SKILLDEF-03/PROC-01).

## 1. Success-criteria coverage (ROADMAP.md Phase 166, 4 criteria)

| # | Criterion | Plan/Task |
|---|-----------|-----------|
| 1 | close releases lock deterministically, no fabricated timestamp, no CHUNK.md overwrite, no same-day false alarm | 166-01 Task 1+2 |
| 2 | boundaries stated: board-only, read-only symlink, never-suppress built-in UI, file-not-patch | 166-02 Task 1 |
| 3 | forbid fenced `platformActionPanelEscapeHatch` (LIBX-01 rename of `suppress-action-panel`) without client | 166-02 Task 2 |
| 4 | regression-tested per PROC-01 (fail-pre/pass-post) | both plans, both tasks — drift assertions added to templates.test.ts / build-chunk.test.ts |

All 4 covered. No orphaned criteria.

## 2. Requirement-ID coverage

SKILLDEF-01 → 166-01 frontmatter `requirements`. SKILLDEF-02, SKILLDEF-03 → 166-02 frontmatter.
PROC-01 → both plans' frontmatter. All 4 requirement IDs from ROADMAP.md's Phase 166 line present
in at least one plan's `requirements` field. No PROJECT.md/REQUIREMENTS.md requirement mapped to
this phase is missing.

## 3. Fail-pre / pass-post marker spot-check (live grep against current repo source)

Ran the specified greps plus two more, all under `src/cli/slash-command/bs/`:

```
grep -rn "date -u" ...                          → no matches (absent, as claimed)
grep -rn "platformActionPanelEscapeHatch" ...    → no matches (absent, as claimed)
grep -n "## Boundaries" build/build.md           → no matches (absent, as claimed)
grep -rn "suppressFromDock" ...                  → no matches (absent, as claimed)
grep -irn "release the lock" ...                 → no matches (absent, as claimed)
grep -rn "suppressActionPanel" ...               → no matches (retired name genuinely absent)
```

All 6 markers confirmed absent pre-fix. Every acceptance-criteria grep in both plans will be
red-first by construction, satisfying PROC-01.

Also spot-checked the plans' cited line anchors against real files — all accurate:
- `SKETCH.template.md:15` lock line — confirmed at line 15, exact grammar as described.
- `GameShell.vue:147` `platformActionPanelEscapeHatch?: boolean` — confirmed, with doc comment
  already pointing at `.suppressFromDock()` and "Phase 166 SKILLDEF-03" by name.
- `action/types.ts:467-469` and `action-metadata.ts:76` `suppressFromDock` — confirmed present
  and wired (per-action metadata field already implemented; only the skill prose is missing).
- `close.md` Bookkeeping Sequence — exactly 3 numbered items (34/39/52), no lock handling — matches
  claimed pre-state.
- `state-machine.md` "Session Lock" (~102) / "Write Order" (~56) — confirmed present, no release
  semantics yet — matches claimed pre-state.
- `build-chunk.md` "Step 0" (~37) — same-chunk/different-live/stale branches present, no
  released/none branch — matches claimed pre-state.

## 4. Wave safety on shared build-chunk.test.ts

166-01 (wave 1, `depends_on: []`) and 166-02 (wave 2, `depends_on: ["166-01"]`) both modify
`build-chunk.test.ts`. The explicit wave/depends_on ordering serializes the two plans, avoiding a
git-write race on the shared file — confirmed correct per the "Parallel executor git race" project
lesson (file-disjoint ≠ git-disjoint).

## 5. Repo-source-only edits (no installed-artifact drift)

Every `files_modified` path in both plans resolves under `src/cli/slash-command/bs/`. Both plans'
`<context>` blocks carry an explicit CRITICAL warning against editing `~/.claude/skills/bs-*`, and
166-01 Task 2's acceptance criteria explicitly assert "No `~/.claude/skills/` path was edited."
No task edits the installed-artifact path.

## 6. SKILLDEF-03 naming

166-02 Task 2 explicitly requires the NEW name `platformActionPanelEscapeHatch` and
`.suppressFromDock()`, with an acceptance criterion asserting `suppressActionPanel` (retired name)
has zero occurrences in build.md post-edit. Consistent with the LIBX-01 rename (Phase 164) and
CONTEXT.md. Note: ROADMAP.md's own Phase 166 success-criterion-3 text and REQUIREMENTS.md's
SKILLDEF-03 line still say `suppress-action-panel` (the OLD name) — this is a wording lag in
ROADMAP/REQUIREMENTS, not a plan defect; the plans correctly use the renamed identifier per
CONTEXT.md's explicit instruction ("Reference the renamed platformActionPanelEscapeHatch ... old
name was suppressActionPanel").

## 7. No bs-shared/ directory — edit targets resolve to real files

Confirmed no `bs-shared` directory exists anywhere under `src/cli/slash-command/`. All 7 named
edit targets exist as real files:
close.md, state-machine.md, SKETCH.template.md, build.md, investigate.md, final-acceptance.md,
build-chunk.md (+ playtest.md, referenced read-only in 166-01 Task 2's read_first) — all present
under `src/cli/slash-command/bs/`. No dangling path.

## Other checks

- Dependency graph: acyclic, 2 nodes, correct wave numbers (wave = max(deps)+1).
- Scope: 2 tasks/plan in both plans (within 2-3 target), 4-6 files/plan (within budget).
- must_haves: truths are behavior-observable ("close releases the lock", "Step 0 does not
  false-alarm"), not merely implementation-focused; artifacts/key_links map cleanly to the truths.
- Nyquist (Dimension 8): VALIDATION.md exists, nyquist_compliant: true. Every task's `<verify>` has
  an `<automated>` vitest command (fast, non-watch, non-E2E). No Wave-0/MISSING markers used, so
  8d is N/A. Sampling continuity trivially satisfied (2/2 tasks per plan have automated verify).
- CLAUDE.md compliance: docs/test-only changes, no new dependencies, no background processes
  introduced — no conflict with root or BoardSmith CLAUDE.md.
- Context compliance: all CONTEXT.md decisions (session-lock release+clock-read+identity,
  append-only write order, Boundaries section, escape-hatch don't, PROC-01 drift tests) are mapped
  to tasks with no scope reduction language ("v1", "static for now", "future enhancement", etc.)
  found in either plan's task actions. Deferred Ideas (SKILLAUTO rewrite) are not present in either
  plan.

## Warnings (non-blocking)

**1. [task_completeness] 166-01's Interfaces section misdescribes an existing drift-test
convention.**
- Plan: 166-01
- Description: The plan states "`read()` calls go INSIDE each `it()` body (not at describe
  level)" as the established convention for `templates.test.ts`, and cites the "TMPL-01 block,
  ~line 155" as the anchor where `'Session Lock:'` is already asserted. Live inspection of
  `templates.test.ts` (describe block at line 140, `SKETCH.template.md carries the machine
  anchors` at ~152) shows `read()` is actually called at describe-level (`const sketchTemplate =
  read(...)` right after `describe(...) => {`), not inside each `it()`. `build-chunk.test.ts`
  does follow the it()-level convention the plan describes, but `templates.test.ts` does not,
  uniformly, across its describe blocks.
- Fix: Not blocking — the plan's actual instruction is "extend, do not restructure," so the
  executor should follow whichever convention the specific describe block it extends already uses.
  Recommend correcting the Interfaces prose before/during execution so it doesn't mislead the
  agent into "fixing" existing describe blocks or introducing an inconsistent one.

## Recommendation

No blockers. Proceed to `/gsd:execute-phase 166`.
