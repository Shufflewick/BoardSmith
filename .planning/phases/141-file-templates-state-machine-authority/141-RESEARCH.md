# Phase 141: File Templates & State-Machine Authority - Research

**Researched:** 2026-07-04
**Domain:** Documentation/template authoring (no external library integration) — literal markdown skeleton files + a shared rules doc, consumed by future `bs-` skills
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Location & Distribution Shape
- Template sources live at `src/cli/slash-command/bs/templates/` — a new `bs/` subtree alongside the existing `aspects/` shared-reference precedent
- Templates ship as standalone shared-reference files consumed by later bs- skills; installer wiring is Phase 148's job
- The state-machine authority rules are written once in `src/cli/slash-command/bs/state-machine.md`; every bs- skill will cite/include it rather than duplicating rules
- `/design-game` removal is NOT this phase — Phase 148 (Distribution) owns installer changes and removal

#### Template Content & Format
- Status enum exactly as the plan specifies: `proposed → approved → built → verified`, plus `verified (user-waived)`, plus `stale — re-derive before build` (CHUNK-level stale marker from /bs-insert-chunk)
- Step names exactly: `investigate, redteam, ask, build, test, audit, repair, playtest, revise, close` (light path for trivial chunks: build → test → playtest)
- Format: markdown headings with a `Status:` line, append-only round sections (revise-1, revise-2, …; audit rounds with ledgered finding IDs), HTML comments as fill-in guidance — sessions fill templates, never restructure them
- Per-file contents follow the plan's Durable Artifacts table verbatim:
  - SKETCH.md: ordered chunk list by stable slug, sketch-level detail per chunk (what it builds, citations, `ui:` tag `none|touches|major`, human test script), "Variants (deferred)" list, ideas backlog, sketch version stamp, session lock note
  - CHUNK.md: step checklist with statuses, interpretation (numbered factual claims with citations + visibility declaration), findings ledger with stable IDs, revision rounds, per-file build manifest, verified commit hash, Status line (authoritative)
  - RULINGS.md: designer decisions each with the rulebook citation it interprets/overrides
  - DECISIONS.md: implementation decisions ledger
  - DESIGN.md: direction + rationale, `--bsg-*`/applyTheme() overrides, typography/spacing, component recipes, placeholder policy, do/don't list
  - ASSETS.md: component/asset ledger (needed-by-chunk, requested, received, placeholder-in-use, file path)
- Each template explicitly defines its parse contract (required headings + status-line grammar) so TMPL-02's "fails to parse → stop and ask" has a concrete trigger

#### Enforcement & Verification
- TMPL-02/03 enforcement mechanism is `state-machine.md` itself: authority rules (CHUNK.md owns status; SKETCH.md derived; CHUNK wins on contradiction with log+repair), write order CHUNK→SKETCH, cold-resume write discipline (append-only rounds, `Status:` line updated last), stop-and-ask on parse failure, consistency-check-on-entry procedure (every slug has a directory, every directory has a sketch entry, statuses parse, no stale session lock), restyle/cutover rule (verified → built flip), session lock protocol, git protocol (`chunk-<slug>/step-<name>` commits, verified hash recorded at close)
- Drift protection: a vitest unit test in BoardSmith asserting template invariants — files exist, exact enum values, exact step names, required headings present
- Phase verification is structural (grep/test assertions on template content); behavioral criteria (a resumed session actually stops and asks) verified in Phase 149's end-to-end dry-run
- Template file naming: `SKETCH.template.md`, `CHUNK.template.md`, etc. — mirrors the existing `design-game.template.md` convention

### Claude's Discretion
- Exact wording of fill-in guidance comments, section ordering within templates, and the drift-test file location/naming

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TMPL-01 | Skills ship literal file templates for SKETCH.md, CHUNK.md, RULINGS.md, DECISIONS.md, DESIGN.md, and ASSETS.md with exact step names and status enums | "Exhaustive per-template field checklist" in Code Examples gives every required field per file, sourced verbatim from the plan; "Pattern 1/2/3" in Architecture Patterns define the exact format (Status line grammar, append-only rounds, HTML-comment guidance) |
| TMPL-02 | A resumed session that finds a state file not parsing against its template stops and asks the user instead of guessing | Pitfall 2 clarifies this phase's scope boundary (define the parse contract in-template; behavior is Phase 149's concern); Validation Architecture's Phase Requirements → Test Map gives the structural (non-behavioral) test for this requirement |
| TMPL-03 | Chunk status authority rules are enforced (CHUNK.md owns its status; SKETCH.md is derived; CHUNK.md wins on contradiction; write order CHUNK→SKETCH) | state-machine.md skeleton in Code Examples transcribes the full Authority/Write-Order rules verbatim; Pitfall 4 flags the cross-reference requirement between templates and state-machine.md |

</phase_requirements>

## Summary

This phase produces no runtime code — it produces **literal text artifacts**: six `.template.md` skeleton files and one rules document (`state-machine.md`), plus a vitest test that asserts their exact content (drift protection). Every fact needed to write these files already exists, fully specified, in `.planning/bs-skills-plan.md` — the phase is a faithful-transcription task, not a design task. The main research risk is *omission*: the plan scatters template fields and state-machine rules across the "Durable Artifacts" table, the "State-machine authority rules (hard)" block, the full 10-step `/bs-build-chunk` walkthrough, the UI section, and "Hard Rules." This document extracts every field and rule verbatim and maps each to its home file, so the planner can write tasks per-file without re-deriving the contract from prose.

There is exactly one existing on-disk convention to mirror: `src/cli/slash-command/design-game.template.md` (a thin pointer file) and `src/cli/slash-command/aspects/*.md` (shared-reference content files with an `index.md` registry). This phase's templates are closer in spirit to the `aspects/` files — full standalone content, not thin pointers — since later skills will read/cite them directly.

**Primary recommendation:** Write each of the 6 templates as a literal markdown skeleton (headings + `Status:` line grammar + HTML-comment fill-in guidance), write `state-machine.md` as a rules reference (not prose — a rules document other skills will cite), and write one vitest file co-located at `src/cli/slash-command/bs/templates.test.ts` that string-matches required headings/enums/step-names in each template and required-rule phrases in `state-machine.md`. No new npm dependencies are needed — no markdown parser required, since the templates use a deliberately simple `Status: <value>` line grammar checkable with a regex/`includes()`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Template skeleton files (6 `.template.md`) | CLI / static reference content | — | Plain files shipped alongside the CLI package; no runtime coupling, read by future skill instructions and by humans/agents authoring state files |
| State-machine authority rules doc | CLI / static reference content | — | A rules document other skill instruction files will cite/include, not code |
| Drift-protection test | CLI test suite (vitest) | — | Runs in BoardSmith's own CI; asserts the shipped template *files* (not any runtime parser) contain exact required strings |
| Parse-contract enforcement (TMPL-02 "stop and ask") | Future skill instructions (Phase 142-147) | — | This phase only *defines* the parse contract (required headings + status-line grammar) in prose within each template; the actual "stop and ask on parse failure" *behavior* is implemented by the skill instruction files in later phases, verified end-to-end in Phase 149 |

## Standard Stack

Not applicable in the conventional sense — this phase ships no runtime library code and requires no new npm dependencies (per CLAUDE.md "Don't add dependencies without discussing"). The only "stack" is:

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|---------------|
| vitest | ^2.1.0 (already in `package.json`) | Drift-protection unit test | Already the project's test framework (`vitest.config.ts`); no new dependency needed |
| Node `fs`/`path` (built-in) | n/a | Read template files from disk in the test | No parsing library needed — string/regex checks suffice for the simple `Status:` line grammar |

**No markdown parser is needed.** The plan's locked format ("markdown + `Status:` line + append-only rounds + HTML-comment guidance") is deliberately simple enough that `fs.readFileSync` + `String.includes()` / a small regex is sufficient to assert required headings and enum values exist verbatim. Introducing a markdown AST parser (e.g. `remark`) would be over-engineering for a structural existence/string-match test and is exactly the kind of unrequested dependency CLAUDE.md forbids adding without discussion.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| String/regex assertions on raw file text | A markdown AST parser + custom schema validator | Only worth it if templates need machine-validation at *skill runtime* (they will, eventually — but that's Phase 142-147's job, reading the templates directly as prose/citation, not parsing them programmatically). This phase's drift test only needs to prove the shipped files are correct, not build a reusable parser. |

**Installation:** none — no new packages.

## Package Legitimacy Audit

Not applicable. This phase installs zero external packages. Skipping the audit protocol per its own scope condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
.planning/bs-skills-plan.md  (source of truth, read-only input)
        │
        │  (this phase: transcribe verbatim, no reinterpretation)
        ▼
src/cli/slash-command/bs/
    ├── templates/
    │   ├── SKETCH.template.md      ─┐
    │   ├── CHUNK.template.md        │  literal skeletons:
    │   ├── RULINGS.template.md      │  headings + Status: line +
    │   ├── DECISIONS.template.md    │  HTML-comment fill guidance
    │   ├── DESIGN.template.md       │
    │   └── ASSETS.template.md      ─┘
    └── state-machine.md            ── rules doc (authority, write order,
                                         cold-resume, consistency-check,
                                         git protocol, session lock)
        │
        │  (consumed by, NOT written by, this phase)
        ▼
Phase 142-147 skill instructions (bs-ingest-rules, bs-build-chunk, ...)
        │  read/cite templates + state-machine.md when they fill
        │  actual game-project state files (SKETCH.md, CHUNK.md, ...)
        ▼
A real game project's chunks/<slug>/CHUNK.md, SKETCH.md, etc.
        (filled instances — NOT produced by this phase, produced by
         downstream skills operating on a real designer's game)

Drift protection (this phase):
src/cli/slash-command/bs/templates.test.ts
    reads the 6 template files + state-machine.md from disk
    asserts: files exist, exact step names present, exact status
    enum values present, required headings present, key rule
    phrases present in state-machine.md
```

### Recommended Project Structure
```
src/cli/slash-command/bs/
├── templates/
│   ├── SKETCH.template.md
│   ├── CHUNK.template.md
│   ├── RULINGS.template.md
│   ├── DECISIONS.template.md
│   ├── DESIGN.template.md
│   └── ASSETS.template.md
├── state-machine.md
└── templates.test.ts        # drift-protection vitest file (new dir seam is fine —
                              # vitest.config.ts's include glob is `src/**/*.test.ts`,
                              # so no config change needed to pick this up)
```

This mirrors the existing `aspects/` precedent (`src/cli/slash-command/aspects/*.md` + `index.md` registry) but templates don't need an `index.md` — the plan doesn't call for a keyword-detection registry over templates (that pattern is specific to `aspects/`, which is selected by *game mechanic keyword matching*; templates are a fixed, always-used set of 6 files, not conditionally selected).

### Pattern 1: Status-line grammar (the parse contract)
**What:** Every template's authoritative status lives on one line matching `Status: <enum-value>` (verbatim, case-sensitive), placed at a fixed, documented location (top-level, immediately after the file's H1, or immediately after the relevant chunk-level heading for CHUNK.md's per-step statuses).
**When to use:** Every one of the 6 templates that has a status concept (SKETCH.md's per-chunk status pointer, CHUNK.md's authoritative status).
**Example (CHUNK.template.md excerpt, illustrative — write the real file with full plan-derived content):**
```markdown
# Chunk: <!-- slug, e.g. movement -->

Status: proposed
<!-- Valid values (exact): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->
<!-- This line is authoritative. SKETCH.md's entry for this chunk is DERIVED and must match. -->
```
**Source:** `.planning/bs-skills-plan.md` "State-machine authority rules (hard)" + CONTEXT.md locked format decision.

### Pattern 2: Append-only round sections
**What:** Revise rounds and audit rounds are never overwritten or renumbered — new rounds append as new headings (`## Revise 1`, `## Revise 2`, …; `## Audit Round 1`, finding IDs stable across rounds).
**When to use:** CHUNK.template.md's revision-rounds and findings-ledger sections.
**Example:**
```markdown
## Revision Rounds
<!-- Append a new "### Revise N" section per round. Never edit or delete a prior round's entry. -->

### Revise 1
<!-- date, triaged feedback items, disposition -->
```

### Pattern 3: HTML-comment fill-in guidance, never restructured
**What:** Every section a session must fill carries an HTML comment explaining what goes there and its exact enum/format constraints; the comment stays in the file after filling (it's guidance for the *next* cold-resume session too, not a one-time hint to be deleted).
**When to use:** All 6 templates, throughout.
**Anti-pattern to avoid:** Do NOT model comments as "delete after filling" placeholder text (common scaffold convention) — CONTEXT.md's locked decision is that sessions "fill templates, never restructure them," and a cold-resumed session re-reading the file benefits from the same guidance the first session had.

### Anti-Patterns to Avoid
- **Encoding status as a heading level or checkbox instead of a `Status:` line:** breaks the single regex/string-match parse contract the plan specifies; checkboxes are fine for CHUNK.md's *step checklist* (`- [x] investigate`) but the chunk's overall `Status:` authority line is a distinct, separate grammar element.
- **Building a schema/parser dependency for this phase:** the actual runtime "does this file parse against its template" logic belongs to the Phase 142-147 skill instructions (they're the ones doing cold-resume), not to this phase's static template files or its drift test.
- **Silently diverging step names between CHUNK.template.md and state-machine.md:** both must use the exact same 10 words in the exact same order (`investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`) plus the light-path subset (`build, test, playtest`) — the drift test should assert both files agree, not just that each is internally consistent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown structural validation for the drift test | A custom markdown-to-AST parser | Plain `fs.readFileSync` + `String.includes()` / regex on raw text | The status-line grammar and required-heading check are simple exact-string/pattern checks; the plan's own design goal is a format simple enough not to need one (CONTEXT.md: "markdown + Status: line ... sessions fill templates, never restructure them") |
| Chunk-status state machine | A generic state-machine library (xstate, etc.) | A one-line enum comment in the template + prose rules in state-machine.md | The state machine has 4-6 states and is enforced by *humans/agents following written prose rules*, not by running code in this phase — no runtime engine exists yet to attach a state-machine library to (that's the job of the skill instructions in Phase 142-147, which are themselves markdown-driven agent instructions, not TypeScript) |

**Key insight:** This entire phase is anti-hand-rolling in the other direction — the risk isn't "don't reinvent a wheel," it's "don't invent machinery (parsers, state-machine libraries, schema validators) for a problem the plan deliberately solved with plain text and human/agent-readable prose rules." Match the plan's own chosen simplicity level.

## Common Pitfalls

### Pitfall 1: Treating this phase as free to reinterpret the plan
**What goes wrong:** A planner or executor paraphrases the Durable Artifacts table or the State-machine authority rules block instead of transcribing them, silently dropping a field (e.g. omitting the "session lock note" from SKETCH.md, or omitting "verified (user-waived)" from the enum).
**Why it happens:** The plan's rules are scattered — the Durable Artifacts table lists high-level contents, but several important details only appear later in the `/bs-build-chunk` step walkthrough (e.g. "per-file build manifest" is mentioned in step 4/build, not in the Durable Artifacts table row for CHUNK.md) or in the Hard Rules section (git protocol, restyle/cutover rule).
**How to avoid:** Use the exhaustive per-template field checklists in this document (below) as the task-level acceptance checklist; cross-reference against `.planning/bs-skills-plan.md` line-by-line before considering a template task done.
**Warning signs:** A template task's diff is shorter than the corresponding checklist below, or a reviewer can't find a specific plan-quoted phrase anywhere in the shipped file.

### Pitfall 2: Confusing "this phase enforces the rules" with "this phase's structural test enforces the rules"
**What goes wrong:** Treating TMPL-02 ("resumed session stops and asks on parse failure") as something this phase must make *actually happen* at runtime, leading to scope creep into building a parser/validator now.
**Why it happens:** TMPL-02 reads as a behavioral requirement, but CONTEXT.md is explicit: "Phase verification is structural (grep/test assertions on template content); behavioral criteria (a resumed session actually stops and asks) verified in Phase 149's end-to-end dry-run."
**How to avoid:** This phase's job for TMPL-02 is to *define the parse contract in the template itself* (required headings + status-line grammar, stated explicitly, e.g. as an HTML comment: "Required headings: ..., Status line must match: ..."), not to build the checker. The checker is the skill instructions written in Phase 142-147.
**Warning signs:** A task proposes writing TypeScript parsing/validation code in `src/cli/` for this phase — that's out of scope; only markdown content + a vitest content-assertion test belong here.

### Pitfall 3: Missing the "step names must match between CHUNK.md and state-machine.md" consistency requirement
**What goes wrong:** CHUNK.template.md and state-machine.md each independently list the 10 step names (or 3 for light path); if authored separately without cross-checking, they drift (e.g. one says "redteam", the other says "adversarial review").
**Why it happens:** The plan itself uses varied prose to describe the same step ("redteam — 3 fresh-context adversarial agents") across different sections; naive transcription risks importing that prose variance into the canonical enum.
**How to avoid:** Define the canonical step-name list once (it's given verbatim in CONTEXT.md: `investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`), and the drift test should assert this exact list appears identically in both CHUNK.template.md and state-machine.md.
**Warning signs:** Grep for one step name matches only one of the two files.

### Pitfall 4: Under-specifying the CHUNK.md ↔ SKETCH.md write-order and authority rule inside the *templates themselves*
**What goes wrong:** The authority rule (CHUNK wins, write order CHUNK→SKETCH) is written only in state-machine.md, but CHUNK.template.md and SKETCH.template.md ship with no cross-reference, so a skill author reading only SKETCH.template.md in isolation doesn't discover the rule.
**Why it happens:** CONTEXT.md's locked decision says "every bs- skill will cite/include it rather than duplicating rules" — meaning the templates themselves should have a short pointer comment ("See state-machine.md — CHUNK.md is authoritative for status"), not a full rules restatement, but it's easy to omit the pointer entirely and assume future skill authors will "just know."
**How to avoid:** Each of SKETCH.template.md and CHUNK.template.md should carry a one-line HTML-comment pointer to state-machine.md at the status line, even though the full rule text lives only in state-machine.md.
**Warning signs:** Grep for "state-machine.md" inside the templates directory returns zero hits.

## Code Examples

### state-machine.md skeleton shape (illustrative structure, not full content — write the real file transcribing every rule below)
```markdown
# BS Skills — State-Machine Authority Rules

<!-- Cited/included by every bs- skill instruction file. Do not duplicate these
     rules elsewhere — bs- skills should reference this file, not restate it. -->

## Chunk Status Enum (exact values)
`proposed` | `approved` | `built` | `verified` | `verified (user-waived)`
CHUNK-level stale marker (set by /bs-insert-chunk): `stale — re-derive before build`

## Step Names (exact, full ceremony)
`investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`

## Step Names (exact, light path — trivial chunks)
`build, test, playtest`

## Authority
- CHUNK.md owns its chunk's status. SKETCH.md holds only the ordered list + derived pointers.
- On contradiction: CHUNK.md wins. The session logs the contradiction and repairs SKETCH.md.

## Write Order
- Always CHUNK.md first, SKETCH.md second.
- Every write leaves the file valid for cold resume: append-only round entries; `Status:` line updated last.

## Cold-Resume Parse Contract
- If a state file does not parse against its template (required headings/status-line grammar
  missing or malformed), STOP and ask the user. Never guess the intended state.

## Consistency Check (every bs- entry point, before proceeding)
- Every sketch slug has a `chunks/<slug>/` directory.
- Every directory has a corresponding SKETCH.md entry.
- All statuses parse against the enum above.
- No stale session lock (see Session Lock below).
- Report problems and get user confirmation before proceeding.

## Restyle/Cutover Rule
- Any change that re-styles or re-lays-out previously verified surfaces flips those chunks
  back to `built` (general form of the AutoUI→Custom-UI cutover rule).

## Session Lock
- SKETCH.md carries a lightweight lock note: chunk + timestamp.
- A second concurrent session on entry sees the lock and warns instead of silently clobbering.

## Git Protocol
- Commit at every step completion: `chunk-<slug>/step-<name>` (revise rounds: `chunk-<slug>/revise-2`).
- Commit BEFORE `build` starts, so WIP is always distinguishable from the verified baseline.
- `close` records the verified commit hash in CHUNK.md.

## Repair Loop Bound
- Max 3 audit rounds. Round N+1 auditors report only NEW findings (ledger has stable IDs).
- Remaining findings after round 3: triaged with the user (blocker / defer / auditor-wrong).

## Redteam Escalation
- Refuted once: re-investigate with objections attached (max 1 re-investigate round).
- Refuted twice: escalate to the user as a plain-language ruling → recorded in RULINGS.md.

## Session Handoff Seams (structural, not self-assessed)
- {investigate + redteam + ask}
- {build + test}
- {audit + repair}
- {playtest + one revise round}
A single session runs at most one step group; hand off at these seams.
```
**Source:** transcribed from `.planning/bs-skills-plan.md` "State-machine authority rules (hard)", "Hard Rules" (Subagent discipline / Context management / Human gates / Git protocol), and the `/bs-build-chunk` step walkthrough.

### Exhaustive per-template field checklist (extracted from the full plan, cross-referenced across all sections)

**SKETCH.md** must contain / support:
- Ordered chunk list, ordered by stable slug (not ordinal)
- Per-chunk sketch-level detail: what it builds, cited rulebook sections, `ui:` tag (`none|touches|major`), human test script (outcome-based, not gesture-based — "move a pawn one space; the board reflects it")
- "Variants (deferred)" list (out-of-scope-by-default variant/optional/advanced rules)
- Ideas backlog (fed by revise-step triage category (b) "future scope")
- Sketch version stamp (bumped by `/bs-insert-chunk`)
- Session lock note (chunk + timestamp)
- Min/max player counts + per-count setup differences (recorded at sketch level per ingest)
- Mandated chunks: first chunk = core event loop; must contain a game-end/scoring/winner chunk; must contain a final-acceptance chunk (full game played start→finish, coverage check of every non-variant rulebook slice, plus design-QA/a11y audit)
- Only next 2-3 chunks detailed; tail stays sketch-level, re-derived and presented as a delta at close gate

**CHUNK.md** must contain / support:
- Step checklist (10-step full ceremony or 3-step light path) with per-step completion state
- `Status:` line — authoritative chunk status (see enum above)
- Ceremony type declared (full vs light path, decided at proposal time)
- Interpretation: numbered list of factual claims with citations
- Visibility declaration (what's hidden from whom, per claim list)
- Newly discovered citations (appended during investigate, via INDEX search)
- Findings ledger with stable IDs (audit step; round N+1 reports only NEW findings)
- Revision rounds, append-only (revise-1, revise-2, …)
- Per-file build manifest (for build-step crash/resume, file-by-file not step-by-step)
- Verified commit hash (recorded at close)
- Playtest test script: numbered click-by-click, seat count + per-seat steps, dev-host affordances taught once, build stamp, one-line regression check, standing "anything look off" taste line, second-seat leak check (hidden-info chunks)
- "Verified" explicit item-by-item checklist; `verified (user-waived)` recordable state
- `ui:` tag (propagated from SKETCH.md; gates whether a11y-floor + design-review audit apply)

**RULINGS.md** must contain / support:
- Designer decisions: ambiguity resolutions, house rules, deliberate digital adaptations
- Each entry paired with the rulebook citation it interprets or overrides
- Written by: any `ask`/`playtest` gate, and redteam refuted-twice escalation

**DECISIONS.md** must contain / support:
- Implementation decisions ledger: data model choices, naming, invariants (example given in plan: "money is a number on Player; spaces indexed 0–39 from GO")
- Written by: build step, close step (rollup)

**DESIGN.md** must contain / support:
- Chosen direction + rationale (Adopt / Derive / Original)
- `--bsg-*` / `applyTheme()` token overrides
- Typography/spacing
- Component recipes
- Placeholder policy
- Do/don't list
- Rule statement: color literals live only in the theme block; everything else references tokens
- Written at: first UI chunk's `ask` step; changing DESIGN.md is itself a chunk (re-opens verified chunks per restyle/cutover rule)

**ASSETS.md** must contain / support:
- Component/asset ledger columns: needed-by-chunk, requested, received, placeholder-in-use, file path
- Populated at: ingest (component inventory with aspect ratios) + per-chunk `ask` step (asset requests, never-blocking placeholder path)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `/design-game` monolithic interview skill (`instructions.md`, 3,072 lines, single-pass whole-rulebook context) | `bs-` skill family with persistent state files + small fresh-context sessions per slice | This milestone (v4.6), starting Phase 141 | Templates in this phase are the state substrate that makes the new approach possible; `/design-game` removal is explicitly deferred to Phase 148, not this phase |

**Deprecated/outdated:** None yet formally deprecated by this phase — `/design-game` still exists and is not touched until Phase 148 (installer removal). This phase must not modify `design-game.template.md`, `instructions.md`, or the `aspects/` files.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The UI strategy decision (Custom UI from chunk 1 vs AutoUI-with-cutover), made "at ingest, with the user" per the plan, is recorded in SKETCH.md (the plan doesn't name the file explicitly for this specific decision, only that it's "made here, with the user" during ingest) | SKETCH.md field checklist | Low — if the planner instead decides this decision belongs in DECISIONS.md or a dedicated line in CHUNK.md for the first UI chunk, that's a same-milestone file-placement choice with no behavioral risk; flag for planner discretion, not a blocking gap |
| A2 | The per-chunk "estimated chunk count and rough per-chunk wall time" shown at the sketch approval gate (INGEST-05) is a gate-time presentation, not a field persisted inside SKETCH.md itself | SKETCH.md field checklist | Low — if wrong, the planner should add an "Estimated chunk count / wall-time" field to SKETCH.template.md; no downstream breakage either way since this is Phase 142's concern, not this phase's |
| A3 | `src/cli/slash-command/bs/templates.test.ts` is a workable location/name for the drift test (vitest picks it up automatically via the existing `src/**/*.test.ts` glob in `vitest.config.ts`, no config change needed) | Validation Architecture / Recommended Project Structure | Low — CONTEXT.md explicitly leaves "drift-test file location/naming" to Claude's discretion, so any reasonable location the planner chooses is equally valid; verified the vitest include glob does NOT need editing for this new path |

**Note:** No assumption in this log concerns package legitimacy, security, or retention policy — this phase is pure documentation authoring with no external dependencies, so risk is uniformly low (file-placement/scope choices, not factual/security claims).

## Open Questions (RESOLVED — both recommendations adopted into plans)

1. **Which file records the ingest-time UI strategy decision (Custom-from-chunk-1 vs AutoUI-with-cutover)?**
   - What we know: The plan says it's "made here, with the user" during ingest (`/bs-ingest-rules` section), and separately that DESIGN.md is written "at the first UI chunk's ask" — a later point in time.
   - What's unclear: Whether the *decision itself* (which strategy) is recorded in SKETCH.md at ingest time, or deferred/duplicated into DESIGN.md later.
   - Recommendation: Add a small "UI Strategy" field to SKETCH.template.md (recorded at ingest) since DESIGN.md doesn't exist until the first UI chunk's ask, which may be several chunks later — the decision needs a home before then. Flag this as a template-content nuance the planner should resolve explicitly in a task rather than leaving implicit.

2. **Does CHUNK.md need a machine-checkable "ui:" tag field distinct from its free-text description, given that it gates a11y-floor and design-review-audit applicability?**
   - What we know: SKETCH.md tags each chunk `ui: none|touches|major`; CHUNK.md is "that chunk's step checklist... status" per the Durable Artifacts table, which doesn't explicitly restate the `ui:` tag as a CHUNK.md field.
   - What's unclear: Whether CHUNK.md re-states the tag (for a session that only has CHUNK.md open, without re-reading SKETCH.md) or always looks it up from SKETCH.md.
   - Recommendation: Include the `ui:` tag as a restated field at the top of CHUNK.template.md (redundant-but-safe — matches the plan's general philosophy of "every write must leave the file valid for cold resume" without forcing a second file read to know whether the a11y floor applies).

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies. It writes markdown files and a vitest test using already-installed tooling (vitest ^2.1.0, Node built-ins). No CLI tools, databases, or services are required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 (already configured, `vitest.config.ts`) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` (no changes needed — `include: ['src/**/*.test.ts', ...]` already covers a new file anywhere under `src/`) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/templates.test.ts` |
| Full suite command | `npm test` (runs `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TMPL-01 | All 6 templates exist with exact step names + status enum values | unit (string/content assertion) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-01"` | ❌ Wave 0 — new file |
| TMPL-02 | Each template defines its own parse contract (required headings + status-line grammar stated as content, e.g. HTML comment) — behavioral "stop and ask" is NOT testable here (deferred to Phase 149) | unit (content assertion that the parse-contract text exists) + manual-only for the actual stop-and-ask behavior (justification: no skill instruction code exists yet to execute a resume in this phase) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-02"` | ❌ Wave 0 — new file |
| TMPL-03 | state-machine.md contains the authority rule (CHUNK wins, write order CHUNK→SKETCH) and CHUNK.template.md's Status line matches the documented grammar | unit (content assertion) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-03"` | ❌ Wave 0 — new file |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/templates.test.ts`
- **Per wave merge:** `npm test` (full suite — cheap here since this phase touches no other subsystem, but running full suite catches accidental collateral edits)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/slash-command/bs/templates.test.ts` — new file, covers TMPL-01, TMPL-02 (structural half), TMPL-03
- [ ] No shared fixtures needed — the test reads the shipped template files directly from disk, no mocking required
- [ ] Framework install: none — vitest already present

## Security Domain

Not applicable / omitted. This phase ships static markdown reference files consumed by future Claude Code skill instructions — no authentication, session management, access control, input validation, or cryptography surface exists in this phase's deliverables. `security_enforcement` config was not checked (absent from `.planning/config.json`'s visible keys) but this phase's content (markdown templates + a content-assertion test) has no attack surface regardless of that setting; there is nothing to apply ASVS categories to.

## Project Constraints (from CLAUDE.md)

From `/Users/jtsmith/CLAUDE.md` (global) and `/Users/jtsmith/BoardSmith/CLAUDE.md` (project):
- **No dummy data / fallbacks / hacks** — templates must transcribe the plan's real content, not placeholder Lorem-ipsum-style stand-ins.
- **Don't add dependencies without discussing** — confirmed no new dependency is needed for this phase (see Standard Stack); if the planner considers a markdown-parsing library, that requires a separate discussion first.
- **Pit of Success** — the template format itself (literal skeletons, HTML-comment guidance kept in place, not deleted after fill) is designed so the correct usage (fill without restructuring) is the easy path; the planner should make sure task descriptions preserve this (e.g. don't ask an executor to "clean up" the HTML comments after writing example content).
- **No Backward Compatibility** — do not add compatibility shims for `/design-game`; that's explicitly Phase 148's job, and this phase must not touch `design-game.template.md` / `instructions.md`.
- **Never leave a dev server running** — not applicable; this phase involves no dev server.
- **Verify behavior by running the application** — for this phase, "running" means running the vitest drift test, not a browser check; there's no UI/runtime surface to browser-test in Phase 141 itself (behavioral verification of actual skill sessions is Phase 149's job).

## Sources

### Primary (HIGH confidence)
- `.planning/bs-skills-plan.md` (read in full, all 192 lines) — the canonical design contract; every claim in this document about template fields and state-machine rules is a direct transcription/citation from this file
- `.planning/phases/141-file-templates-state-machine-authority/141-CONTEXT.md` — locked implementation decisions (format, file locations, enum values, drift-test approach)
- `.planning/REQUIREMENTS.md` — TMPL-01/02/03 definitions and traceability
- `.planning/STATE.md` — project history/decision log confirming Phase 141's sequencing and no conflicting prior decisions
- `src/cli/slash-command/design-game.template.md` (read directly) — existing `.template.md` naming/thin-pointer convention
- `src/cli/slash-command/aspects/index.md` (read directly) — existing shared-reference-file registry convention
- `vitest.config.ts` (read directly) — confirmed `include: ['src/**/*.test.ts', ...]` glob covers any new test file location without config changes
- `package.json` (read directly) — confirmed vitest ^2.1.0 already a devDependency, `npm test` runs `vitest run`

### Secondary (MEDIUM confidence)
None used — no WebSearch was needed; this phase's entire factual basis is internal to the already-authored, already-adversarially-reviewed plan document and the existing repo conventions, both read directly.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, confirmed vitest already present and its include glob needs no changes
- Architecture: HIGH — directly transcribed from the plan's own explicit Durable Artifacts table + State-machine authority rules block + full step walkthrough, cross-referenced line by line
- Pitfalls: HIGH — derived directly from CONTEXT.md's own locked-decision caveats (e.g. "Phase verification is structural... behavioral criteria verified in Phase 149") and from careful re-reading of where fields are scattered across the plan

**Research date:** 2026-07-04
**Valid until:** Stable — this research is a transcription of an already-locked design contract (`bs-skills-plan.md` v2, already adversarially reviewed) and existing repo conventions that are not expected to change; safe to treat as valid for the remainder of the v4.6 milestone (through Phase 149).
