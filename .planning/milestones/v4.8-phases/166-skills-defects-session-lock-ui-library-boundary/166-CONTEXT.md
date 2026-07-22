# Phase 166: Skills Defects — Session-Lock + UI/Library Boundary - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the two filed `bs-skills` defects and fence the game/library boundary, with regression tests (PROC-01):
- **SKILLDEF-01** (B.8, session-lock): the `close` ceremony reliably releases its lock, never fabricates the lock timestamp, cannot overwrite CHUNK.md, and a same-day resume does not false-alarm.
- **SKILLDEF-02** (B.8, never-suppress/never-edit-library): the skills state the boundaries explicitly — agent controls the game board only, `node_modules/boardsmith` (a live symlink) is read-only, built-in BoardSmith UI must not be suppressed, library gaps are FILED not patched.
- **SKILLDEF-03** (C.3-skills): the skills tell the agent not to use the fenced `platformActionPanelEscapeHatch` (the LIBX-01 rename) without the client.

**IMPORTANT architecture note (from scout):** The bs-* skills have their git-tracked source-of-truth in the REPO at `src/cli/slash-command/bs/` (installed to `~/.claude/skills/bs-*` via `install-claude-command`). ALL edits go to the repo copies; the `~/.claude/skills/` copies are installed artifacts. Existing vitest drift-tests read the repo copies.
</domain>

<decisions>
## Implementation Decisions

### SKILLDEF-01 — Session-lock / close ceremony
- Add a terminal **"release the lock"** step to `bs-shared/build/close.md`'s Bookkeeping Sequence, and to the `playtest` light-path where a chunk reaches a verified terminal state. Root cause of the same-day false alarm is that close never releases — releasing fixes it at the root.
- Source the lock timestamp with an **explicit `date -u +%Y-%m-%dT%H:%M:%SZ` clock-read** instruction at `bs-shared/templates/SKETCH.template.md:15` and the `state-machine.md` "Session Lock" spec — never fabricate a timestamp.
- Add a **session/chunk identity** to the lock line so a cleanly-closed chunk leaves **no** live lock and a same-chunk resume is recognized (not a "different, live lock" warn).
- Make close's `Status:` / lock / DECISIONS append writes an **explicit append-only atomic terminal sequence** — enforce the stated write-order invariant (`state-machine.md:56-61`) procedurally so CHUNK.md cannot be overwritten during close.

### SKILLDEF-02 — Game/library boundary (never suppress built-in UI, library read-only)
- Add a new **"## Boundaries" section to `src/cli/slash-command/bs/build/build.md`** (primary) and a read-only-library pointer in `build/investigate.md`'s Required Reading.
- Library-read-only rule is **absolute**: `node_modules/boardsmith` is a live symlink to the client's real checkout — read-only, never patch. A library gap is **FILED, never patched**.
- Never-suppress framing: "a built-in BoardSmith surface that can't drive the game is a **library gap to FILE, not a feature to switch off**." Also add "never override an explicit client instruction on design judgment" to `bs-shared/build/final-acceptance.md` (the client-gate step).

### SKILLDEF-03 — Fenced escape hatch (C.3-skills)
- Reference the **renamed** `platformActionPanelEscapeHatch` (LIBX-01; old name was `suppressActionPanel`): never set it without explicit client direction.
- **`.suppressFromDock()`** (the per-action metadata field from LIBX-01) is the only sanctioned per-action dock-hiding mechanism, used only when the game design legitimately calls for it.
- Place this "don't" in `build.md`'s UI-writing section alongside the SKILLDEF-02 boundary prose.

### PROC-01 — Tests
- Extend the existing drift-test suites with **marker-constant `toContain` assertions**: `src/cli/slash-command/bs/build-chunk.test.ts` (for close.md lock-release, build.md/investigate.md boundary prose, the escape-hatch "don't") and `templates.test.ts` (for the `SKETCH.template.md` clock-read/session-identity marker). Each new assertion **fails before** the prose/logic is added and passes after.
- Run: `npx vitest run src/cli/slash-command/bs`.

### Claude's Discretion
- Exact marker-constant names, the precise wording of the boundary prose, and the lock-line field format are at Claude's discretion, consistent with the existing skill voice and drift-test conventions.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / edit targets (repo source-of-truth)
- `src/cli/slash-command/bs/build-chunk/SKILL.md:37-57` — Step 0 lock acquire/classify (same-chunk resume 52; different-live-lock warn 53-55; stale >24h 56-57).
- `src/cli/slash-command/bs/build/close.md` (132 lines) — Bookkeeping Sequence (18-55), Sketch-Tail Delta Gate (57-92), Next Chunk (94-120). **No lock handling today** — add terminal release here.
- `src/cli/slash-command/bs/build/build.md` — "Build — Writing the Code"; add "## Boundaries" (near the scope prose ~30-45).
- `src/cli/slash-command/bs/build/investigate.md:1-16` — Required Reading; add read-only-library pointer.
- `src/cli/slash-command/bs/build/final-acceptance.md` — client-gate; add never-override-client rule.
- `bs-shared/state-machine.md:56-61` (Write Order invariant), `:102-112` (Session Lock / staleness).
- `bs-shared/templates/SKETCH.template.md:15` — the ONLY lock-timestamp write site; add clock-read + session identity.
- Library rename confirmed: `src/ui/components/GameShell.vue:147` `platformActionPanelEscapeHatch?: boolean` (was `suppressActionPanel`); per-action `suppressFromDock` at `src/engine/action/types.ts:467-469`, `src/engine/element/action-metadata.ts:76`.

### Established Patterns
- Drift tests (vitest): `read()` helper `readFileSync(join(__dirname, rel))` + named marker constants + `expect(content).toContain(...)`, one `describe` per requirement. Suites: `build-chunk.test.ts`, `templates.test.ts`, `ingest.test.ts`, `status-tools.test.ts`, `install-claude-command.test.ts`. Run via `vitest run`.
- No bs-skill currently references `node_modules`, suppressing UI, or any action-panel-suppression name (all zero grep hits) — pure additions, low regression risk.

### Integration Points
- Repo edits → installed to `~/.claude/skills/` via `install-claude-command` (repo is source of truth; do NOT edit `~/.claude/skills` copies directly).
</code_context>

<specifics>
## Specific Ideas

- Lab findings driving this phase: `~/BoardSmithLab/findings/bs-skills-session-lock-defect.md` (run-004 CHUNK.md overwrite + missing-Status wedge + same-day false alarm training click-through) and `~/BoardSmithLab/findings/bs-skills-never-suppress-builtin-ui.md` (Failure 2: agent suppressed built-in UI / considered editing library).
- SKILLDEF-03 is the skills half of feature C.3; the library half (LIBX-01) shipped in Phase 164 — reference the fenced hatch by its new name `platformActionPanelEscapeHatch`.
</specifics>

<deferred>
## Deferred Ideas

- The broader autonomy rewrite of the bs-skills (playtest-gate policy, batched questions, run-while-away, auto-advance, context-threshold offload) → Phase 167 (SKILLAUTO). Keep this phase to the two filed defects + the boundary fence.
</deferred>
