---
phase: 148-distribution-installer-bs-generate-ai
plan: 01
subsystem: cli
tags: [claude-code, agent-skills, cli, markdown, installer-prep]

requires: []
provides:
  - Agent Skills frontmatter (name/description/disable-model-invocation) on all 5 bs- entry points
  - CLAUDE_SKILL_DIR-anchored shared-tree references in the 4 authored entry points, ready for
    verbatim copy by Plan 02's installer
  - bs-generate-ai: reframed as a late-sketch-chunk AI generator, 5 hooks preserved verbatim
  - design-game and old generate-ai.template.md dead sources deleted
affects: [148-02, 148-03]

tech-stack:
  added: []
  patterns:
    - "${CLAUDE_SKILL_DIR}/../<path>-anchored sibling references inside SKILL.md bodies"
    - "Agent Skills frontmatter block (name/description/disable-model-invocation) prepended to
      skill entry points"

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/ingest-rules.md
    - src/cli/slash-command/bs/build-chunk.md
    - src/cli/slash-command/bs/check-status.md
    - src/cli/slash-command/bs/insert-chunk.md
    - src/cli/slash-command/generate-ai-instructions.md

key-decisions:
  - "The pinned citation-convention phrase \"cite `state-machine.md`\" (used near Session Lock /
    Git Protocol / Session Handoff Seams headings, and pinned byte-exact by
    build-chunk.test.ts's BUILD-13 assertCitedNearby 250-char-window check) was deliberately kept
    BARE (not CLAUDE_SKILL_DIR-anchored) in build-chunk.md, check-status.md, and insert-chunk.md
    — anchoring it either broke the pinned substring or pushed the citing sentence outside the
    250-char window the test enforces around Session Lock/Session Handoff Seams."
  - "The generic top-of-file phrase \"Cite `state-machine.md` and `templates/*.template.md`\" (a
    glob-form pointer, not a resolvable path) was also left bare across all 4 entry points, both
    for BUILD-13 window-distance reasons and because `templates/*.template.md` is not a concrete
    sibling-file reference to anchor."
  - "Task 2's acceptance-criteria grep (`grep -rc 'design-game' src/cli/slash-command/` == 0) is
    satisfied for the files this plan actually touched (generate-ai-instructions.md + the 3
    deletions); it is NOT satisfied repo-wide because bs/ingest-rules.md,
    bs/ingest/interview-fallback.md, and bs/ingest/scaffold.md carry deliberate, already-shipped
    (Phase 142) references to the old `/design-game` skill for the one-time migration feature
    (INGEST-07 case 4) and the name-derivation/interview-question provenance notes. These are
    out of this plan's `files_modified` scope and removing them would break a shipped feature —
    left untouched."

requirements-completed: [DIST-01, DIST-02]

duration: 25min
completed: 2026-07-05
---

# Phase 148 Plan 01: Bs- Entry-Point Content Prep Summary

**Added Agent Skills frontmatter and `${CLAUDE_SKILL_DIR}/../`-anchored shared-tree references to all 5 bs- entry points, reframed generate-ai as bs-generate-ai with late-sketch-chunk framing, and deleted the 3 dead design-game/generate-ai template source files — all with the bs/ drift-test suites (237 tests across 4 files) kept green throughout.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 completed
- **Files modified:** 5 (4 bs/ entry points + generate-ai-instructions.md)
- **Files deleted:** 3 (instructions.md, design-game.template.md, generate-ai.template.md)

## Accomplishments

- All 4 authored `bs/*.md` entry points (`ingest-rules.md`, `build-chunk.md`, `check-status.md`,
  `insert-chunk.md`) now carry Agent Skills frontmatter (`name: bs-<name>`, a one-sentence
  `description`, `disable-model-invocation: true`).
- Every genuine shared-tree relative reference (`ingest/...`, `build/...`, `templates/...`,
  `state-machine.md`) inside those 4 files' bodies is now `${CLAUDE_SKILL_DIR}/../`-anchored, so
  it resolves correctly once Plan 02's installer nests each entry point one directory deeper (its
  own `bs-<name>/` skill directory) than the shared `ingest/`/`build/`/`templates/`/
  `state-machine.md` siblings.
- Each file's "Installed location" paragraph was rewritten to describe the concrete target layout
  (`.claude/skills/bs-<name>/SKILL.md` with shared reference dirs as siblings under
  `.claude/skills/`), replacing the old "the installer copies the whole `bs/` tree as one unit"
  framing that assumed the current flat-embed model.
- `generate-ai-instructions.md` now carries `name: bs-generate-ai` frontmatter and a new framing
  paragraph positioning it as a late sketch chunk (run after game-end/scoring exists since MCTS
  needs terminal states; usable earlier for `--ai` solo-playtest seat-fill) — the 5 AI hooks
  (objectives/threatResponseMoves/playoutPolicy/moveOrdering/uctConstant) and the Hex reference
  are preserved verbatim, untouched.
- Deleted the 3 dead source files: `instructions.md` (old `/design-game` skill body),
  `design-game.template.md` (its thin `{{BOARDSMITH_ROOT}}` pointer), and
  `generate-ai.template.md` (the old generate-ai thin-pointer template, superseded by the
  Agent Skills model where the reframed instructions file becomes the SKILL body directly).
- Verified empirically (per the objective's instruction) that the drift-test suites' `toContain`
  substring assertions survive the `${CLAUDE_SKILL_DIR}/../` prefix — confirmed by running the
  full suite green after every edit, not just asserted.

## Task Commits

1. **Task 1: Add frontmatter + CLAUDE_SKILL_DIR-anchored refs to the 4 authored entry points** -
   `e76c4bd1` (feat)
2. **Task 2: Reframe generate-ai as bs-generate-ai; delete dead design-game sources** -
   `a435f957` (feat)

_No separate plan-metadata commit was requested by the executor prompt beyond the final STATE/
ROADMAP update commit below._

## Files Created/Modified

- `src/cli/slash-command/bs/ingest-rules.md` - frontmatter + CLAUDE_SKILL_DIR-anchored refs +
  rewritten Installed-location paragraph
- `src/cli/slash-command/bs/build-chunk.md` - same treatment
- `src/cli/slash-command/bs/check-status.md` - same treatment
- `src/cli/slash-command/bs/insert-chunk.md` - same treatment
- `src/cli/slash-command/generate-ai-instructions.md` - frontmatter + late-sketch-chunk framing,
  5 hooks preserved verbatim
- `src/cli/slash-command/instructions.md` - DELETED (dead /design-game source)
- `src/cli/slash-command/design-game.template.md` - DELETED (dead thin-pointer template)
- `src/cli/slash-command/generate-ai.template.md` - DELETED (dead thin-pointer template,
  superseded by Agent Skills model)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Anchoring the "cite `state-machine.md`" citation-convention phrase broke a
locked drift test**
- **Found during:** Task 1, first `npx vitest run` pass after the bulk `${CLAUDE_SKILL_DIR}/../`
  rewrite
- **Issue:** `build-chunk.test.ts`'s BUILD-13 `assertCitedNearby` helper pins the exact substring
  `cite \`state-machine.md\`` and requires it within 250 characters of each occurrence of
  "Session Lock" / "Session Handoff Seams" / "Git Protocol". A blanket regex replace of every
  backtick-quoted `state-machine.md` (and `templates/*.template.md`) with the
  `${CLAUDE_SKILL_DIR}/../`-prefixed form broke this substring (case variants `Cite`/`cite`) and,
  in one case, pushed the citing sentence 264 chars from its anchor (just over the 250-char
  window) because the inserted `${CLAUDE_SKILL_DIR}/../` text added length between the anchor and
  the cite phrase.
- **Fix:** Reverted the specific "cite `state-machine.md`" citation-convention occurrences (both
  case variants) and the generic "`templates/*.template.md`" glob-form pointer back to their bare,
  unanchored form in all 4 files. These are documentation citation conventions ("go read
  state-machine.md's X section, don't restate it here"), not concrete sibling-file resolution
  instructions the model needs to open at runtime via a resolved path — so leaving them bare does
  not break the actual runtime reference-resolution goal Pattern 1 targets.
- **Files modified:** `src/cli/slash-command/bs/build-chunk.md`, `check-status.md`,
  `insert-chunk.md`, `ingest-rules.md`
- **Commit:** `e76c4bd1`

### Scope Clarifications (not auto-fixed, documented instead)

**2. Task 2's phase-wide `design-game`-residue grep is not fully zero, and should not be made
zero within this plan's scope**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan's Task 2 acceptance criteria and the phase-level `<verification>` section
  both state `grep -rc 'design-game' src/cli/slash-command/` should return 0. After deleting the
  3 dead source files, the grep still finds 4 hits: `bs/ingest-rules.md` (2, describing the
  one-time `/design-game`-project migration case, INGEST-07 case 4, and its citation format) and
  `bs/ingest/interview-fallback.md` + `bs/ingest/scaffold.md` (1 each, provenance notes tracing
  where their content was extracted from the old `/design-game` skill).
- **Why not fixed:** These are deliberate, already-shipped Phase 142 content — not residue from
  this plan's deletions. `ingest-rules.md`'s Step 0 case 4 migration path is a real, tested
  feature (the one-time `/design-game` → `bs-` project conversion) that legitimately needs to
  name the old skill by its slash-command string to detect and describe it. None of these 3
  files are in this plan's `files_modified` list. Removing or rewording this content would
  silently regress a shipped Phase 142 feature and is out of scope for a Phase 148
  distribution-mechanics plan. The Task 2 `<verify>` automated command (the actual pass/fail
  gate) does not include this grep — it only checks the 3 deletions + the `bs-generate-ai`
  frontmatter — and that command passes cleanly.
- **Recommendation:** If a future phase wants zero `design-game` string matches repo-wide
  (e.g. for a full historical-reference purge), it should explicitly scope that as its own task
  against `bs/ingest-rules.md`, `bs/ingest/interview-fallback.md`, and `bs/ingest/scaffold.md`,
  with a plan for how the migration feature communicates "the old /design-game skill" without
  using that literal string.

## Verification Results

- `npx vitest run src/cli/slash-command/bs/` — **237/237 tests passing** (4 test files:
  `ingest.test.ts`, `build-chunk.test.ts`, `check-status`/`insert-chunk` via
  `status-tools.test.ts`, `templates.test.ts`)
- `grep -l "^name: bs-" src/cli/slash-command/bs/{ingest-rules,build-chunk,check-status,insert-chunk}.md | wc -l` → `4`
- `grep -c 'disable-model-invocation: true' src/cli/slash-command/bs/ingest-rules.md` → `1`
- `test ! -e instructions.md && test ! -e design-game.template.md && test ! -e generate-ai.template.md && grep -c 'name: bs-generate-ai' generate-ai-instructions.md` → all deletions confirmed, frontmatter count `1`
- `grep -cE 'objectives|threatResponseMoves|playoutPolicy|moveOrdering|uctConstant' generate-ai-instructions.md` → `15` (≥5, all 5 hooks named multiple times)
- `grep -ciE 'late sketch chunk|terminal state|game-end' generate-ai-instructions.md` → `4` (≥1)

## Self-Check: PASSED

Verified on disk / in git log:
- `src/cli/slash-command/bs/ingest-rules.md`, `build-chunk.md`, `check-status.md`,
  `insert-chunk.md` — all FOUND, all contain `^name: bs-`
- `src/cli/slash-command/generate-ai-instructions.md` — FOUND, contains `name: bs-generate-ai`
- `src/cli/slash-command/instructions.md` — MISSING (deleted, as intended)
- `src/cli/slash-command/design-game.template.md` — MISSING (deleted, as intended)
- `src/cli/slash-command/generate-ai.template.md` — MISSING (deleted, as intended)
- Commit `e76c4bd1` — FOUND in `git log --oneline`
- Commit `a435f957` — FOUND in `git log --oneline`
