# Phase 149: End-to-End Dry-Run Validation - Research

**Researched:** 2026-07-05
**Domain:** Validation/dry-run of an LLM-executed skill pipeline (bs-ingest-rules + bs-build-chunk) against a reference game (Go Fish)
**Confidence:** MEDIUM-HIGH (all core files read directly from the repo; a few CLI runtime behaviors are cited from source but not executed live in this research session)

## Summary

This phase does not build new product code — it proves that the `bs-` skill family (Phases 140-148, spec'd in `.planning/bs-skills-plan.md`) actually works when a subagent follows the literal skill instructions against a real ruleset, end-to-end from `/bs-ingest-rules` through chunk-1's `build-chunk` machine steps. The skills are markdown files read by an LLM (not code executed by a test runner), so the "dry-run" mechanism is: spawn a subagent, hand it the skill file (`src/cli/slash-command/bs/*.md` + its `${CLAUDE_SKILL_DIR}/../bs-shared/...` references, resolved from source as `src/cli/slash-command/bs/` siblings since this dry-run runs from the BoardSmith source tree, not an installed `.claude/skills/` tree), a scratch working directory, and the Go Fish rulebook text; then check whether the subagent produces the artifact that skill step mandates (SKETCH.md, CHUNK.md sections, generated game code, test results).

The hand-built reference (`~/BoardSmithGames/go-fish/src/rules/`, 1079 LOC across game.ts/elements.ts/actions.ts/flow.ts/ai.ts/tutorial.ts/index.ts) is a complete, working comparison target. Its core event loop — the `ask` action plus `game-loop`/`player-turns`/`turn-loop` flow — maps directly onto what the plan calls "chunk 1": deal hands, one player asks an opponent for a rank, opponent gives matching cards or the asker "goes fish" (draws), and a successful catch or matching draw grants an extra turn. This is a complete, runnable slice of Go Fish today and is the ground truth the dry-run's generated chunk-1 code should structurally resemble (though not byte-for-byte — the audit lens in `build/audit.md` explicitly allows "acceptable divergence" documentation for a different-but-valid data model).

**Primary recommendation:** Structure the plan as five sequential waves — (1) scratch-workspace setup + scaffold verification, (2) ingest dry-run (interview-fallback path, since Go Fish's rules are supplied as plain text, not a PDF — this also dry-runs `bs/ingest/interview-fallback.md`, a path the transcription-fan-out path would not exercise), (3) chunk-1 build-chunk machine steps through `test` (investigate → redteam → ask-artifact-capture → build → test), (4) audit + repair (with the visibility lens as the highest-value check, since Go Fish hides opponent hands), (5) comparison report + defect fix-and-verify loop. Each wave is its own subagent dispatch reading the real skill files from `src/cli/slash-command/bs/`. The `ask` and `playtest` human gates are captured as artifacts (the proposal text, the click-by-click script) rather than blocking — per CONTEXT.md's locked decision.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill-instruction execution (ingest, investigate, redteam, build, test, audit) | Subagent (Task-tool, fresh context) | Orchestrator (dry-run driver) | The skills are LLM-executed markdown; each step is designed as an independent fresh-context dispatch. The dry-run driver plays the orchestrator role the skill file itself describes. |
| Scratch game project (scaffold + generated chunk-1 code) | Filesystem (scratch dir, not `~/BoardSmithGames/go-fish`) | — | `npx boardsmith init` unconditionally creates a subdirectory; the dry-run must run it in a throwaway location so the hand-built reference stays untouched (locked decision). |
| Automated verification (tsc, boardsmith lint, unit/integration tests, simulateRandomGames) | Generated project's own toolchain (npm scripts inside the scratch project) | CI/test runner invoking them | These are real commands run against the generated code, per `bs/build/test.md` — not simulated. |
| Comparison / defect logging | Dry-run report (`149-DRYRUN-REPORT.md`) | — | Human-readable artifact comparing dry-run output to the hand-built reference; not itself part of the pipeline. |
| Pipeline defect fixes | `src/cli/slash-command/bs/*.md` skill source files | `bs/*.test.ts` drift suites | Any skill-logic bug found is fixed at the source (the skill file), then its drift test is re-run — never patched around in the dry-run output. |
| Human browser playtest | Human (deferred) | — | Explicitly out of scope for the autonomous run; captured as a HUMAN-UAT manual-verification item per CONTEXT.md. |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Reference Game & Depth**
- Target: Go Fish (hidden-information game, exercises the audit step's visibility/leak diff). Standard public-domain rules are the "rulebook" input — no PDF, use interview-fallback (INGEST-03) or a plain rules-text ingest.
- Depth: ingest + chunk 1 (core event loop: deal hands + one ask-a-rank turn resolving to give-cards-or-go-fish). Matching/scoring/win is out of scope.
- Comparison target: `~/BoardSmithGames/go-fish/src/rules/` (~1079 LOC).

**Dry-Run Execution Model**
- Machine steps run autonomously via subagents that follow the ACTUAL skill instructions (`bs/ingest-rules.md` + `bs/ingest/*.md`; `bs/build-chunk.md` + `bs/build/{investigate,redteam,ask,build,test,audit,repair}.md`) in a scratch workspace (never `~/BoardSmithGames/go-fish`).
- Steps covered: ingest (transcribe/interview → rulebook slices + INDEX + SKETCH.md + scaffold), then chunk-1 investigate → redteam → ask → build → test → audit → repair.
- `ask` and `playtest` human gates: machine steps run up TO each gate and capture the artifact the gate would present, rather than blocking.
- The `test` step's automated checks (tsc, boardsmith lint, unit/integration, random-sim) actually run against the dry-run's generated chunk-1 code.
- Any dev server started for a check is killed before returning; the human playtest server is NOT started autonomously.

**Comparison & Defect Handling**
- Compare on: (1) rule fidelity, (2) hidden-info handling (visibleAttributes/redaction), (3) BoardSmith idiom (elements/actions/flow usage), (4) artifact quality (do SKETCH.md/CHUNK.md parse against templates?).
- Discrepancies: RECONCILED (fix the pipeline) or DOCUMENTED (acceptable divergence).
- Pipeline defects are fixed in the bs- skill files before the milestone ships; fixes re-run the bs/ drift suites. Logged in `149-DRYRUN-REPORT.md`.

**Completion Bar**
- Autonomous machine-step dry-run runs CLEAN against Go Fish (ingest + chunk 1, generated code compiles + passes automated tests), comparison documented, ALL surfaced defects fixed (bs/ suites green), human playtest captured as HUMAN-UAT.
- Verification status: `human_needed`.

### Claude's Discretion
- Scratch-workspace location + cleanup.
- Exact subagent decomposition per pipeline step.
- Dry-run report format.
- How many redteam/audit agents to actually spawn (scaled-down fan-out acceptable as long as the step's LOGIC is exercised).

### Deferred Ideas (OUT OF SCOPE)
- Full multi-chunk dry-run through game-end/scoring/final-acceptance.
- Live human browser-playtest of the dry-run output (routed as HUMAN-UAT).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VAL-01 | The full pipeline is dry-run against a reference game rulebook end-to-end (ingest → several chunks → playtest gates) and compared against the hand-built implementation before release | This phase narrows VAL-01 to ingest + chunk 1 (per CONTEXT.md); research below documents exactly what each skill step demands, what the hand-built go-fish baseline looks like, and what "clean run" + "compared" concretely mean for chunk 1. |

## Project Constraints (from CLAUDE.md)

- Never leave a dev server running that the dry-run itself starts (repo-wide hard rule, restated inside `bs/ingest/scaffold.md`'s Verification Sequence step 3 and `bs/build/test.md`'s command sequence — both already bake in the kill step).
- No dummy data / fallbacks / hacks to "get something working" — a dry-run defect must be fixed at the skill source, not worked around in the generated output.
- Verify behavior by running the application, not just reviewing code — the `test` step's tsc/lint/unit/random-sim commands must actually execute against the scratch project, not be asserted from reading the skill file.
- Don't add dependencies without discussing — the dry-run should need no new npm dependencies; it exercises `npx boardsmith init` and the generated project's own devDependencies (already pinned by the scaffold template, including axe-core per the UI a11y floor).
- "Pit of Success": a dry-run that skips a machine step "because it's slow" or "because we're confident it works" defeats the entire purpose of Phase 149 — the plan must not shortcut the steps CONTEXT.md locked as in-scope.

## The Pipeline Steps This Dry-Run Exercises (concrete mechanics)

### `/bs-ingest-rules` (`src/cli/slash-command/bs/ingest-rules.md`)

Step 0 state detection → Step 1 **Scaffold + Verify** (`bs/ingest/scaffold.md`) → Step 2 transcription-or-interview → Step 3 synthesis (INDEX.md, ASSETS.md, visual survey) → Step 4 sketch derivation (`bs/ingest/sketch-derivation.md`) → Step 5 UI strategy → Step 6 approval gate → Step 7 write files.

**Scaffold mechanics (`bs/ingest/scaffold.md`), verified against `src/cli/commands/init.ts`:**
- Derive kebab-case Project Name + PascalCase Class Name + Display Name from the game name the "designer" gives (for the dry-run, hardcode "Go Fish" as the answer — no live human needed for this ask, since it's not a locked decision the plan needs to surface).
- `npx boardsmith init <name>` **unconditionally creates `<cwd>/<name>`** and **errors if that directory already exists** `[VERIFIED: src/cli/commands/init.ts]` — confirmed by reading `init.ts` directly (`Error: Directory "${name}" already exists`). There is no in-place/current-directory mode. This means: run `init` from a scratch **parent** directory (e.g. a fresh temp dir), never inside an existing directory expecting reuse.
- `toDisplayName`/`toPascalCase` (`src/cli/lib/project-scaffold.ts`) derive Class/Display names from an already-kebab-cased name and are lossy for punctuation — not relevant for "go-fish" (no punctuation), so no display-name correction needed for this dry-run.
- Verification sequence (numbered, non-reorderable): (1) `cd <name> && npx tsc --noEmit` must be clean; (2) `npx boardsmith dev --no-open`, wait for the exact string `Ready! Press Ctrl+C to stop.` (pinned by a drift test against `src/cli/commands/dev.ts` — trust it verbatim `[VERIFIED: src/cli/commands/dev.ts via ingest/scaffold.md citation]`), then curl the resolved dev URL to confirm a non-error response; (3) kill the process. This whole sequence is real commands the dry-run subagent must actually run, not simulate.
- `npx boardsmith dev` supports `--no-open` specifically so a non-interactive/no-browser verification step works `[VERIFIED: src/cli/commands/dev.ts]`.

**Ingest input mode for the dry-run:** Go Fish's rules will be supplied as plain rules text, not a PDF/scan. This is a decision point for the plan: either (a) treat it as a written "rulebook" and run the transcription fan-out path (`bs/ingest/transcription.md`) by feeding the text directly (no OCR/page-range fan-out needed since it's already plain text — a degenerate one-slice-set fan-out), or (b) run the interview-fallback path (`bs/ingest/interview-fallback.md`) by having a "designer" subagent answer the interview questions using the standard Go Fish ruleset as its script. **Recommendation: use the interview-fallback path.** It's the path most likely to be under-exercised by the phase-140-148 unit/drift tests (those tests likely focus on the transcription path's fan-out mechanics), and CONTEXT.md explicitly names "the interview-fallback path INGEST-03" as an acceptable input for the rulebook. `[ASSUMED — the phase-140-148 test suites were not read in this research session; verify at plan time by grepping `bs/ingest.test.ts` for interview-fallback coverage before committing to this path.]`

**Sketch derivation constraints that the dry-run's proposed sketch must satisfy** (`bs/ingest/sketch-derivation.md`): first chunk = core event loop (exactly what CONTEXT.md calls chunk 1); sketch must also list (but not build, for this dry-run) a game-end/scoring chunk and a final-acceptance chunk; every chunk gets a `ui: none|touches|major` tag (chunk 1 is `ui: major` — it's the first playable surface); only the next 2-3 chunks get full CHUNK.md detail, the rest stay sketch-level tail entries with the exact marker string `Status: proposed (sketch-level — no CHUNK.md yet)`.

### `/bs-build-chunk` for chunk 1 (`src/cli/slash-command/bs/build-chunk.md`)

Full ceremony, 10 steps: `investigate, redteam, ask, build, test, audit, repair, playtest, revise, close`. CONTEXT.md's locked scope runs through `test` fully, then `audit`+`repair` (explicitly named in scope), and captures (does not execute) `ask` and `playtest`.

**investigate** (`bs/build/investigate.md`): fresh-context subagent reads cited slices + INDEX-discovered slices + RULINGS.md + DECISIONS.md + `docs/core-concepts.md` + `docs/common-pitfalls.md` + `docs/actions-and-flow.md` (chunk 1 has actions) + `docs/custom-ui-guide.md`/`docs/ui-components.md` (ui: major) — writes a numbered claims list + visibility declaration directly into CHUNK.md. For Go Fish chunk 1, the visibility declaration must explicitly state: "the asked-for rank and outcome (gave cards / go fish) are public; the identity of any card drawn from the pond is hidden from all other seats until played; opponents' hand contents are hidden from everyone but the owner." This maps directly onto the hand-built game's `contentsVisibleToOwner()` on `Hand` and `contentsHidden()` on `Pond`.

**redteam** (`bs/build/redteam.md`, referenced but not read in depth this session): 2 refuters + 1 coverage adversary, framing-free (claims list only, no investigator rationale). For a well-known game like Go Fish, expect the refuters to converge quickly; the real value is the coverage adversary catching omitted claims like "if you have no cards, you draw before your turn ends" (a rule the hand-built flow.ts's `turn-loop.while` implements) or "extra turn on successful catch" — both real Go Fish rules the flow.ts encodes.

**test** (`bs/build/test.md`): non-reorderable numbered sequence — (1) `tsc --noEmit`, (2) `boardsmith lint` (the 7 sandbox rules: `no-network`, `no-filesystem`, `no-timers`, `no-nondeterministic`, `no-eval`, `no-element-identity-comparison`, `no-element-array-state` — implemented in `src/cli/lib/sandbox-scan.ts` `[VERIFIED: src/cli/lib/sandbox-scan.ts]`), (3) chunk unit/integration tests, (4) full accumulated suite, (5) `simulateRandomGames` from `boardsmith/testing` asserting `results.crashed === 0 && results.stuck === 0 && results.timedOut === 0 && results.exceededMaxActions === 0` `[VERIFIED: src/testing/random-simulation.ts]`, (6) the 5-item a11y floor (keyboard-only ActionPanel completion, axe-core scan, no-color-literal grep + contrast, real controls with aria-labels, focus management + prefers-reduced-motion) because chunk 1 is `ui: major`. All of these are real, runnable commands against the scratch project — the dry-run must actually execute them, not describe expected output.

**audit** (`bs/build/audit.md`): 3 fresh-context lenses (fidelity, visibility, undo) + a 4th design-review lens for `ui: touches|major`. The visibility lens is the highest-value check for Go Fish: it must run `diffPlayerViews(testGame, seatA, seatB)` (`src/testing/view-diff.ts`) and `assertNoHiddenInfoLeak(...)` (`src/testing/dom-leak.ts`) `[VERIFIED: src/testing/view-diff.ts, src/testing/dom-leak.ts — both cited by exact name in audit.md]` — these are real, importable APIs, not hypothetical. Findings land in CHUNK.md's `## Findings Ledger` with stable IDs (F1, F2, ...) before `repair` starts.

**repair**: fix-or-refute-with-citation loop, max 3 audit rounds, round-N+1 auditors see only new findings.

## Standard Stack

### Core (all internal — no new external packages)
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `boardsmith` CLI (`init`, `dev`, `lint`, `validate`) | 0.0.1 (this repo) | Scaffolds and verifies the generated project | The exact commands `bs/ingest/scaffold.md` and `bs/build/test.md` cite by name `[VERIFIED: package.json, src/cli/commands/*.ts]` |
| `boardsmith/testing` (`simulateRandomGames`, `diffPlayerViews`, `assertNoHiddenInfoLeak`, `TestGame`) | this repo, `src/testing/` | Automated correctness checks the `test`/`audit` steps run | Cited by exact function name in the skill files; real, existing modules `[VERIFIED: src/testing/*.ts]` |
| `boardsmith/eslint-plugin` sandbox rules | this repo, `src/eslint-plugin/` | The 7 AST-based rules `boardsmith lint` enforces | Single source of truth is `src/cli/lib/sandbox-scan.ts`, shared by `lint` and `validate` `[VERIFIED]` |
| axe-core | devDependency of generated scaffold (per bs-skills-plan UI section) | a11y structural/semantic scan for the a11y floor | Decided once at scaffold-template level, not per game — confirm it's actually wired into the current scaffold template before relying on it (see Open Questions) |

**No new packages need installation for this phase** — Package Legitimacy Audit is not applicable; skip that section.

## Architecture Patterns

### System Architecture Diagram

```
[Dry-run driver / orchestrator session]
        |
        | reads skill files directly from source (not installed .claude/skills/)
        v
  src/cli/slash-command/bs/ingest-rules.md ---> Subagent A: Scaffold+Verify
        |                                          (npx boardsmith init in scratch dir,
        |                                           tsc --noEmit, boardsmith dev --no-open,
        |                                           curl, kill)
        |
        +--> Subagent B: Ingest (interview-fallback OR transcription)
        |      writes rulebook/NN-topic.md + INDEX.md + ASSETS.md + 00-visual-survey.md
        |
        +--> Orchestrator synthesis (Step 3) --> proposes sketch (Step 4-6, in-conversation only)
        |
        +--> Write Files (Step 7): SKETCH.md, chunks/<slug>/CHUNK.md (chunk 1 only),
        |      RULINGS.md, DECISIONS.md (empty ledgers)
        v
  src/cli/slash-command/bs/build-chunk.md  (chunk 1, full ceremony)
        |
        +--> Subagent C: investigate --> CHUNK.md ## Interpretation + ## Visibility Declaration
        +--> Subagent D/E/F: redteam (2 refuters + 1 coverage adversary) --> verdicts
        +--> [ask gate CAPTURED, not executed live: presentation text written as artifact]
        +--> Subagent G: build --> generated game code (game.ts/elements.ts/actions.ts/flow.ts equivalents)
        +--> Subagent H: test --> tsc, boardsmith lint, unit/integration, full suite,
        |      simulateRandomGames, 5-item a11y floor  (REAL commands, real pass/fail)
        +--> Subagent I/J/K: audit (fidelity, visibility, undo lenses)
        |      visibility lens runs diffPlayerViews + assertNoHiddenInfoLeak for real
        +--> Subagent L: repair (fix or refute findings)
        |
        v
  [149-DRYRUN-REPORT.md: comparison vs ~/BoardSmithGames/go-fish/src/rules/,
   defect ledger (fixed/documented), HUMAN-UAT deferred-playtest item]
        |
        v
  Any defect found in a bs/*.md skill file --> fix at source --> re-run bs/*.test.ts drift suite
```

### Recommended Project Structure (for the plan's own artifacts, not the scratch game)
```
.planning/phases/149-end-to-end-dry-run-validation/
├── 149-RESEARCH.md          # this file
├── 149-PLAN.md              # produced by planner
├── 149-DRYRUN-REPORT.md     # produced during execution: comparison + defect log
└── (scratch workspace path recorded here, e.g. /tmp or scratchpad — NOT committed)
```

### Pattern 1: Fresh-context subagent per skill step, never inherited conversation
**What:** Every investigate/redteam/audit dispatch in the real skills is a separate Task-tool call with no inherited context — this is a hard rule in the skill files themselves ("Redteamers and auditors get independent context, always").
**When to use:** The dry-run driver must honor this literally: do not let one long-running conversation "simulate" all the steps by just narrating what each step would find. Each step must be a genuine separate dispatch reading the real skill file, or the dry-run doesn't prove anything about whether the skill's context-economics design actually works in practice.
**Example (dispatch shape, from `bs/build/investigate.md`):**
```
Investigate the rules interpretation for {gameName}, chunk "{slug}". Read the following:
  - Cited slices: {citedSlicePaths}
  - INDEX-discovered slices ...
  - RULINGS.md ...
  - DECISIONS.md
  - {resolvedDocList}
WRITE directly into this chunk's CHUNK.md: ## Interpretation, ## Visibility Declaration, ## Newly Discovered Citations
Return exactly: { claimsList, visibilityDeclaration, newlyDiscoveredCitations }
```

### Pattern 2: State-file-only orchestrator reads (context-economics discipline)
**What:** The orchestrator (dry-run driver) never re-reads the rulebook slices, docs, or generated code directly — only CHUNK.md/SKETCH.md state-file sections, and only the sanctioned ones (`## Interpretation`, `## Visibility Declaration`, `## Redteam Rounds`).
**When to use:** The dry-run plan should itself follow this discipline where the driver plays the orchestrator role — this is part of what's being validated (does the discipline actually keep context bounded across a real run?), so violating it in the dry-run's own execution would mask exactly the failure mode the phase exists to catch.

### Anti-Patterns to Avoid
- **Narrating instead of dispatching:** Writing "the investigate step would find claim 1: ..." in the driver's own context instead of spawning a real subagent that reads the real skill file. This produces zero evidence about whether the skill instructions are followable by an LLM that has never seen this plan before.
- **Running `boardsmith init` inside `~/BoardSmithGames/go-fish`** or any location that could collide with or mutate the hand-built reference. Always a fresh scratch directory.
- **Skipping the automated `test` step's real command execution** and asserting "the generated code would pass tsc" without running `npx tsc --noEmit`. CLAUDE.md's global rule ("verify behavior by running the application, not just reviewing code") applies directly here.
- **Treating a light-ceremony shortcut for chunk 1.** Chunk 1 is never light-ceremony — it's the mandated first full-ceremony chunk per `sketch-derivation.md`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random-playthrough crash/deadlock detection | A custom loop that plays random moves and checks for hangs | `simulateRandomGames` from `boardsmith/testing` (`src/testing/random-simulation.ts`) | Already implements the exact four result fields (`crashed`, `stuck`, `timedOut`, `exceededMaxActions`) the `test` step's audit criteria require; a hand-rolled loop would miss the flow-deadlock-vs-stuck distinction the skill file explicitly warns about |
| Hidden-info leak detection | Manually diffing two players' JSON state by eye | `diffPlayerViews(testGame, seatA, seatB)` + `assertNoHiddenInfoLeak(...)` (`src/testing/view-diff.ts`, `src/testing/dom-leak.ts`) | Cited by exact name in `bs/build/audit.md`; the atomic overload avoids a documented same-instant footgun (WR-02) a hand-rolled diff would reintroduce |
| Sandbox-rule enforcement (no-network/no-timers/etc.) | A custom grep/regex scan for `setTimeout`/`fetch`/etc. | `boardsmith lint` (backed by `src/cli/lib/sandbox-scan.ts`) | Single source of truth already shared between `lint` and `validate`; a parallel hand-rolled scan would drift from it |

**Key insight:** Every automated check the `test`/`audit` steps require already exists as a real, importable BoardSmith API — the dry-run's job is to prove these APIs are actually invoked correctly when a subagent follows the skill's prose, not to build new verification tooling.

## Common Pitfalls

### Pitfall 1: Scaffold collision with the hand-built reference
**What goes wrong:** Running `npx boardsmith init go-fish` inside or near `~/BoardSmithGames/` risks either erroring against the existing `go-fish` directory or, worse, someone later confusing the scratch output with the real reference.
**Why it happens:** `init` always creates `./<name>/` — an easy directory-choice mistake if the dry-run driver `cd`s to a convenient-but-wrong parent.
**How to avoid:** Use a session-scoped scratch directory (e.g. under the OS temp dir or the harness's scratchpad), name the scratch project something unambiguous ("go-fish-dryrun" or similar) even though the "designer" answer to the name prompt is "Go Fish" — record the actual scratch path chosen in the DRYRUN-REPORT.
**Warning signs:** Any `cd ~/BoardSmithGames/...` in the dry-run's command history.

### Pitfall 2: `${CLAUDE_SKILL_DIR}` substitution doesn't resolve when reading skill files from source
**What goes wrong:** The skill files use `${CLAUDE_SKILL_DIR}/../bs-shared/...` — a Claude Code built-in substitution that only resolves when a file is loaded as an *installed* skill (`.claude/skills/bs-ingest-rules/SKILL.md`). Reading these files directly from `src/cli/slash-command/bs/` (as this dry-run must, since the milestone is mid-development and not yet installed anywhere) means that substitution never fires.
**Why it happens:** The dry-run is validating source files, not an installed skill tree.
**How to avoid:** The subagent dispatch prompts must explicitly tell each subagent the real, resolved relative paths in the source layout — e.g. "the file `bs/ingest-rules.md` refers to `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/scaffold.md`; in this source checkout that resolves to `src/cli/slash-command/bs/ingest/scaffold.md`" (confirmed: `ingest/`, `build/`, `templates/`, and `state-machine.md` all sit as direct siblings under `src/cli/slash-command/bs/` alongside `ingest-rules.md`/`build-chunk.md` — there is no separate `bs-shared/` directory in source; that split only exists post-install). This is itself worth flagging as a possible defect/gap: **does the installer (`install-claude-command.ts`) actually create the `bs-shared/` sibling layout the skill files assume?** If Phase 148's installer work already verified this, it's a non-issue; if not, this dry-run is a natural place to catch it, but only if the plan explicitly calls out this path-resolution translation up front rather than each subagent guessing.
**Warning signs:** A subagent reporting "file not found: bs-shared/state-machine.md" — this is a dry-run-harness mapping issue, not a skill bug, unless the installer itself is later found not to produce this layout.

### Pitfall 3: Interview-fallback vs transcription path choice affects which skill code path gets proven
**What goes wrong:** Defaulting to "just paste the rules text as if it were a transcribed rulebook" silently picks the transcription path and never exercises `bs/ingest/interview-fallback.md` at all — a real, distinct code path with its own citation format ("designer statement, ingest session").
**Why it happens:** Feeding plain text looks equally natural for either path.
**How to avoid:** The plan should make an explicit choice (recommend interview-fallback, per Standard Stack section above) and state why, rather than defaulting silently. If time allows, exercising both paths would give more pipeline coverage, but CONTEXT.md's discretion note ("exact subagent decomposition") suggests picking one is acceptable for this dry-run's depth.

### Pitfall 4: Random-sim / a11y floor run against an incomplete chunk-1 UI
**What goes wrong:** Chunk 1 is `ui: major` (first playable surface) — the a11y floor's keyboard-only ActionPanel completion test requires the *real* wiring (`useActionController` + `useBoardActionBridge` + `createBoardInteraction`), not a mocked controller, per `bs/build/test.md`'s explicit citation of `interaction-integration.test.ts`'s pattern. A generated chunk-1 UI that only wires a mock controller will pass a shallow keyboard test but not the real one, and the skill file explicitly calls this out as a known trap ("a mocked controller misses the real fill → fetchChoicesForPick → snapshotVersion++ → currentChoices reactive chain").
**Why it happens:** Mocking is the path of least resistance for a fast-generated first UI chunk.
**How to avoid:** The `build` step subagent must be told to wire the real controller pattern from the start; the `test` step subagent must verify this by checking the actual test file's imports, not just its pass/fail result.
**Warning signs:** A11y floor test file that imports a hand-rolled fake controller instead of `useActionController`/`useBoardActionBridge`.

### Pitfall 5: Confusing "compared against hand-built" with "must match line-for-line"
**What goes wrong:** Treating any data-model or naming difference from `~/BoardSmithGames/go-fish/src/rules/` as a defect.
**Why it happens:** The hand-built reference is right there, tempting a byte-diff mentality.
**How to avoid:** CONTEXT.md's comparison methodology explicitly allows "acceptable divergence, e.g. a different-but-valid data model" — the check is rule fidelity + hidden-info correctness + BoardSmith idiom, not structural identity. Example: the hand-built game uses a `turn-loop` while-condition that auto-draws when a player's hand is empty (a subtle rule: "if you have no cards, you draw before your turn ends, from the pond, without asking"); the generated chunk-1 code might legitimately model this differently as long as the same rule outcome holds.

## Code Examples

### Verified pattern: `simulateRandomGames` invocation (from `bs/build/test.md`, citing `src/testing/random-simulation.ts`)
```typescript
// Source: src/testing/random-simulation.ts, cited verbatim in bs/build/test.md
import { simulateRandomGames } from 'boardsmith/testing';

const results = await simulateRandomGames(MyGame, {
  count: 50,          // 50 light / 100 full — use judgment for the chunk's ceremony
  playerCounts: [2, 3, 4],
  timeout: 5000,      // optional
  seed: 'some-base-seed', // optional
});

expect(results.crashed).toBe(0);
expect(results.stuck).toBe(0);
expect(results.timedOut).toBe(0);
expect(results.exceededMaxActions).toBe(0);
```

### Verified pattern: scaffold verification sequence (from `bs/ingest/scaffold.md`)
```bash
# From the scratch parent directory:
npx boardsmith init go-fish-dryrun   # errors if ./go-fish-dryrun already exists

cd go-fish-dryrun
npx tsc --noEmit                     # step 1: compile gate, must be clean

npx boardsmith dev --no-open         # step 2: serve-check
# wait for the exact line: "Ready! Press Ctrl+C to stop."
# curl the resolved dev URL to confirm non-error response

# step 3: kill the dev server process before proceeding
```

### Reference: the hand-built ask action's public/private message discipline (`~/BoardSmithGames/go-fish/src/rules/actions.ts`)
```typescript
// Every game.message() call is checked by the hand-built game to be public-safe;
// the drawn card's identity is NEVER broadcast — only the public outcome is:
if (drewMatch) {
  game.message(`${player.name} drew a ${rank} and gets another turn!`);
} else {
  game.message(`No match — play passes to the next player.`);
}
```
This is the concrete pattern the audit step's visibility lens should confirm the generated chunk-1 code also follows — any `game.message()` in the generated `ask` action that reveals a drawn card's identity to all seats is exactly the class of defect `diffPlayerViews`/`assertNoHiddenInfoLeak` exists to catch.

## Hand-Built Go-Fish Baseline (comparison reference)

**Files:** `~/BoardSmithGames/go-fish/src/rules/{game,elements,actions,flow,ai,tutorial,index}.ts` (1079 LOC total; `game.ts` 299, `flow.ts` 117, `actions.ts` 164, `elements.ts` 46, `ai.ts` 246, `tutorial.ts` 179, `index.ts` 28).

**Data model (`elements.ts`):** `Card extends BaseCard` (suit, rank, `.value` getter for sort order); `Hand extends BaseHand` (per-player, `contentsVisibleToOwner()`); `Pond extends Deck` (`contentsHidden()` — hidden from everyone); `Books extends Space` (`contentsVisible()` — public, per-player collected 4-of-a-kind sets); `GoFishPlayer extends Player` adds `bookCount`.

**Setup (`game.ts` constructor):** creates the pond (52-card standard deck, `setOrder('stacking')`), a `Hand` + `Books` space per player, deals 7 cards each for 2-3 players / 5 cards each for 4-6 players (`dealCards()`), registers the single `ask` action, sets the flow.

**Core turn loop (`flow.ts`):** `game-loop` (while not `isFinished()`) → `eachPlayer` `player-turns` (skips a player only if both their hand AND the pond are empty) → per-player `turn-loop`: resets `extraTurn`/`turnEnded` vars, runs the `ask` action step, then an `execute` block reads `ctx.lastActionResult.data.extraTurn` to decide whether to loop again or end the turn. Notably: if a player's hand is empty at the top of the loop, the `while` condition itself auto-draws them a card from the pond before continuing — an important rule detail a generated chunk-1 might miss unless the rulebook slice explicitly states it.

**The `ask` action (`actions.ts`):** two `chooseFrom` params (target player, then rank — filtered to ranks the asker actually holds, enforced via `.condition()` requiring `canPlayerTakeAction`). `execute()` transfers all matching cards on a hit (public message: who/rank/count), or draws from the pond on a miss ("Go Fish!" — public), granting an extra turn (`data.extraTurn: true`) either for a successful ask or for drawing a matching card from the pond. `checkForBooks()` is called after every card movement and forms/publicly-announces 4-of-a-kind books. The drawn card's identity is deliberately never included in any public `game.message()` call — only the public outcome (matched or not).

**Win condition (`game.ts`):** `isFinished()` = 13 total books formed across all players; `getWinners()` = player(s) with max `bookCount`.

**What chunk 1 maps to:** deal + the `ask` action + the turn-loop's give-or-go-fish resolution + the extra-turn rule. Book-forming and the 13-book win condition are part of the SAME action's `execute()` in the hand-built version but are explicitly out of scope for chunk 1 per CONTEXT.md ("matching/scoring/win is out of scope for the dry-run") — the generated chunk-1 code may legitimately omit `checkForBooks()` and the win condition entirely, or stub it, as long as this is documented as an intentional depth cut rather than a missed rule.

## Standard Go Fish Rules (the dry-run's "rulebook" input)

Canonical public-domain ruleset to feed the ingest step:
- 2-6 players. Deal 7 cards each for 2-3 players, 5 cards each for 4-6 players; remaining cards form a face-down draw pile ("the pond" / "the ocean").
- On your turn, ask ONE specific opponent for a specific rank you hold at least one card of (you may not ask for a rank you don't hold).
- If the opponent has any cards of that rank, they must give ALL of them to you, and you take another turn (ask again, anyone).
- If the opponent has none, they say "Go Fish" — you draw the top card of the pond. If the drawn card matches the rank you asked for, you show it (or just claim it) and take another turn. If not, your turn ends.
- Whenever you collect all 4 cards of a rank, you lay it down as a "book" (removed from your hand, kept in front of you, visible to all).
- The game ends when either all 13 books have been formed, or (variant) the pond is empty and no player can complete their hand — the standard/simplest end condition (and the one the hand-built game uses) is "all 13 books formed."
- The player with the most books wins.

**Ambiguities a real ingest would likely surface (and should redteam/escalate, per the pipeline's own design):**
1. Does asking require holding at least one card of that rank? (Yes, universally — but the rulebook text must state this explicitly or the investigate step may miss it as an implicit constraint; the hand-built game enforces it via `.condition()`.)
2. Does drawing a matching card from the pond grant an extra turn, or does the turn simply end regardless? (Most rule variants say yes, extra turn — this matches the hand-built flow.ts.) Some simplified rule texts omit this nuance entirely, which would surface as a redteam coverage-adversary finding if the "rulebook" text fed to ingest is a minimal one.
3. What happens when the pond is empty and a player has an empty hand? (End-of-game trigger nuance — out of scope for chunk 1's depth, but the ingest sketch should note it as a mandated-chunk concern for the eventual game-end chunk, per `sketch-derivation.md`'s Mandated Chunks rule.)
4. Is there a maximum-players cap or a different card-count-per-player rule for larger groups? (5 vs 7 cards is a real edge the rulebook text must state, and which the redteam coverage adversary should catch if omitted.)

These four are good candidates to deliberately include (or deliberately omit, to test whether redteam catches the omission) in whatever plain-text ruleset the dry-run feeds to ingest — this is itself a design choice the plan should make explicit: is the fed-in rulebook text intentionally "clean and complete" (best-case dry-run) or intentionally ambiguous in 1-2 spots (stress-tests the redteam escalation path)? **Recommendation: feed a clean, complete ruleset for chunk 1's dry-run** (matching CONTEXT.md's framing of proving the pipeline works, not stress-testing edge-case handling) but note the four ambiguities above as documented expectations if any appear despite a clean input — that itself would be a defect finding.

## Runtime State Inventory

Not applicable — this is a validation/dry-run phase, not a rename/refactor/migration. Skipped per the output format's own guidance.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Interview-fallback is the better path to exercise for this dry-run (vs. transcription) because it's more likely under-tested by Phase 140-148's own suites | Standard Stack / Pitfall 3 | If the transcription path is actually the less-tested one, the dry-run would prove the wrong path clean and miss real transcription-fan-out bugs. Verify by reading `bs/ingest.test.ts` at plan time before locking the input-mode choice. |
| A2 | The installer (`install-claude-command.ts`) produces the `bs-shared/` sibling directory layout the skill files' `${CLAUDE_SKILL_DIR}/../bs-shared/...` paths assume | Pitfall 2 | If it doesn't (e.g. Phase 148 changed the layout since this research), every path-resolution instruction given to dry-run subagents would be wrong, and subagents would report false "file not found" defects that are actually harness-mapping bugs, not real skill bugs. Verify by reading `install-claude-command.ts` at plan time. |
| A3 | axe-core is already wired as a devDependency in the current `boardsmith init` scaffold template (per the bs-skills-plan's UI section claim: "decided once at the scaffold-template level as a devDependency of generated games") | Standard Stack | If axe-core isn't actually in the current scaffold template yet (this may be pending/partial from an earlier phase), the a11y floor's axe-core scan step would fail for a reason unrelated to the bs- skill logic itself — worth a quick scaffold-template check before running the dry-run so this doesn't get miscategorized as a pipeline defect. |
| A4 | A clean, unambiguous plain-text Go Fish ruleset (rather than a deliberately ambiguous one) is the right dry-run input for proving pipeline function, per CONTEXT.md's framing | Standard Go Fish Rules section | If the plan instead wants to stress-test redteam's escalation path, a clean ruleset would under-exercise that path — but CONTEXT.md's locked scope (chunk 1 depth, prove-the-pipeline-works framing) supports the clean-input choice. |

## Open Questions (RESOLVED — Q1: scratch dir outside repo + file: dep per Plan 01; Q2: all 13 bs/build/*.md fully authored, no stubs, verified; A3: axe-core ^4.12.1 confirmed in project-scaffold.ts)

1. **Does the dry-run need to run in the BoardSmith source tree, or a fully separate scratch location outside this repo?**
   - What we know: `npx boardsmith init` works from any cwd with `boardsmith` resolvable (either via the monorepo's local package or a published version); `~/BoardSmithGames/go-fish` symlinks to this repo's source for live dev.
   - What's unclear: whether the dry-run's scratch project should also symlink to this repo (to pick up any bs- skill-triggered library changes live) or install a snapshot.
   - Recommendation: use the same `file:../../BoardSmith`-style local dependency the sibling game repos use (per CLAUDE.md's "Related Repositories" note), scaffolded in a scratch directory adjacent to (not inside) `~/BoardSmithGames/`, so any BoardSmith library-side fix made during this phase is picked up without a re-vendor step.

2. **Are the Phase 140-148 skill files (ingest-rules.md, build-chunk.md, and all `bs/ingest/*.md` + `bs/build/*.md`) already fully authored and stable, or is any part still a stub/forward-reference?**
   - What we know: every file this research read is fully authored prose (not a stub) — `build/design-review.md` is explicitly marked "forward-reference — authored in this phase's Plan 02" inside `audit.md`, suggesting some cross-references were written slightly ahead of full authoring but the referenced files exist.
   - What's unclear: whether `redteam.md`, `ask.md`, `build.md`, `repair.md` (referenced heavily but not read in full in this research session due to context budget) are equally complete.
   - Recommendation: the planner should do a final `ls`+quick-read pass over all referenced `bs/build/*.md` files before finalizing the wave breakdown, to confirm none are placeholder stubs that would make a wave undispatchable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `npx` / Node.js toolchain | `boardsmith init`, `dev`, `lint` | ✓ (repo is an active Node/TS monorepo) | — | — |
| `boardsmith` CLI (this repo, unpublished v0.0.1) | scaffold + verify | ✓ (local package) | 0.0.1 | Use `file:` local dependency reference, as sibling games do |
| axe-core | a11y floor scan | Unconfirmed at scaffold-template level (see A3) | — | If missing from the scaffold template, add it as part of this phase's defect-fix work (it's already named as required by the bs-skills-plan UI section) |
| curl | scaffold serve-check | ✓ (standard on macOS/Darwin) | — | — |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** axe-core in the scaffold template (A3) — resolvable during defect-fix if absent.

## Validation Architecture

This phase's own verification is explicitly `human_needed` per CONTEXT.md (the deferred browser playtest), but the AUTOMATABLE portion of the dry-run itself has a real test map — the dry-run's "clean run" bar IS the validation architecture for VAL-01's chunk-1 scope:

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (BoardSmith's own suite) for the `bs/*.test.ts` drift suites; the SCRATCH project's own generated test files (also Vitest, per scaffold template) for chunk-1 code |
| Config file | this repo's existing vitest config for drift suites; scaffold-generated `vitest.config.ts` for the scratch project |
| Quick run command | `npm test -- bs/` (drift suites) once a defect fix is made; `npx tsc --noEmit && npx boardsmith lint` (fast scratch-project gate) |
| Full suite command | full `npm test` in this repo (drift suites) + the scratch project's full `test` step sequence (tsc, lint, unit/integration, full suite, `simulateRandomGames`, a11y floor) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VAL-01 (chunk-1 scope) | Scaffold compiles + serves | smoke | `npx tsc --noEmit` + `npx boardsmith dev --no-open` + curl | ✅ (scaffold template already produces these) |
| VAL-01 (chunk-1 scope) | Generated chunk-1 code compiles, lints clean, passes unit/integration + full suite | integration | the `test` step's numbered sequence, run for real in the scratch project | ✅ once `build` step produces code |
| VAL-01 (chunk-1 scope) | No flow deadlock / crash across randomized play | integration | `simulateRandomGames` assertions per `bs/build/test.md` | ✅ (API exists: `src/testing/random-simulation.ts`) |
| VAL-01 (chunk-1 scope) | No hidden-hand leak (opponent's hand / drawn card identity) | integration | `diffPlayerViews` + `assertNoHiddenInfoLeak` per audit's visibility lens | ✅ (APIs exist: `src/testing/view-diff.ts`, `src/testing/dom-leak.ts`) |
| VAL-01 (chunk-1 scope) | a11y floor (keyboard ActionPanel, axe-core, contrast, real controls, focus/motion) | integration | the 5-item sequence in `bs/build/test.md` | ✅ patterns exist (`CardRenderer.a11y.test.ts`, `interaction-integration.test.ts`, `Toast.a11y.test.ts` cited as precedents) |
| Any bs-skill fix made during this phase | Skill drift suites still pass after edit | regression | `bs/ingest.test.ts`, `bs/build-chunk.test.ts`, `bs/status-tools.test.ts`, `bs/templates.test.ts` (all present in `src/cli/slash-command/bs/`) | ✅ all present in repo |
| Human browser playtest of generated chunk-1 | Real gameplay feel/correctness | manual-only (HUMAN-UAT) | N/A — `npx boardsmith dev` run by the user | N/A — deferred by design |

### Sampling Rate
- **Per subagent-dispatch (each pipeline step):** the step's own defined commands (tsc/lint/tests as applicable to that step) — not a separate quick-check, since the skill files already define the exact commands.
- **Per wave merge (after test+audit+repair loop closes):** full `test` step sequence re-run once more to confirm repair didn't regress anything.
- **Phase gate:** the `149-DRYRUN-REPORT.md`'s completion bar (all four bullets in CONTEXT.md's "Completion Bar") must be true, and the repo's own `bs/*.test.ts` drift suites green, before `/gsd:verify-work`.

### Wave 0 Gaps
None — existing test infrastructure (`boardsmith/testing`, the scaffold template's generated Vitest setup, the repo's own `bs/*.test.ts` drift suites) covers all phase requirements. The only conditional gap is A3 (axe-core devDependency presence in the current scaffold template) — verify at plan time, and if missing, add "wire axe-core into scaffold template" as an explicit task before the `test` step's a11y floor item can run for real.

## Security Domain

Not applicable in the ASVS sense — this phase touches no auth/session/network-facing surface; it's a local CLI/subagent dry-run against generated game code that itself must already pass the sandbox rules (`no-network`, `no-eval`, etc.) as a correctness gate, which is already covered under Standard Stack / Don't Hand-Roll above rather than a separate security domain. Omitting per the "no external dependencies/auth surface" applicability judgment — though note the sandbox-rule enforcement IS itself the closest analog to a security control in this codebase (preventing generated game code from doing non-deterministic/network/filesystem things that would break replay integrity), and it's already the `test` step's step 2.

## Sources

### Primary (HIGH confidence — read directly from repo)
- `.planning/phases/149-end-to-end-dry-run-validation/149-CONTEXT.md` — locked decisions
- `.planning/bs-skills-plan.md` — the full pipeline spec
- `src/cli/slash-command/bs/ingest-rules.md`, `bs/ingest/scaffold.md`, `bs/ingest/sketch-derivation.md`
- `src/cli/slash-command/bs/build-chunk.md`, `bs/build/investigate.md`, `bs/build/test.md`, `bs/build/audit.md`
- `src/cli/commands/init.ts` (directory-creation error message, name derivation)
- `src/cli/lib/sandbox-scan.ts` (the 7 sandbox rule names, error-severity config)
- `src/testing/` directory listing (`random-simulation.ts`, `view-diff.ts`, `dom-leak.ts`, `test-game.ts`, etc.)
- `~/BoardSmithGames/go-fish/src/rules/{game,elements,actions,flow}.ts` (hand-built baseline, read in full)
- `.planning/REQUIREMENTS.md` (VAL-01 text and traceability)
- `package.json` (boardsmith package name/version)

### Secondary (MEDIUM confidence)
- `src/cli/slash-command/bs/ingest/transcription.md`, `interview-fallback.md`, `build/redteam.md`, `ask.md`, `build.md`, `repair.md`, `close.md`, `playtest.md`, `revise.md`, `final-acceptance.md`, `design-review.md` — referenced heavily and cited by the files that were read in full, but not directly opened in this research session due to context budget. Their content is inferred from the citing files' descriptions (`build-chunk.md`'s dispatch table and step-group descriptions), which is a reasonably strong secondary source since `build-chunk.md` names their exact structure, but the planner should do a direct pass over these before finalizing task-level detail.

### Tertiary (LOW confidence)
- None — no unverified WebSearch claims were needed for this phase; everything is internal-repo research.

## Metadata

**Confidence breakdown:**
- Standard stack (internal APIs, CLI commands): HIGH — every command/API cited was confirmed by reading the actual source file it comes from.
- Architecture (pipeline step mechanics): HIGH for ingest-rules.md/scaffold.md/sketch-derivation.md/build-chunk.md/investigate.md/test.md/audit.md (read in full); MEDIUM for redteam/ask/build/repair/playtest/revise/close/final-acceptance/design-review (cited, not directly read this session).
- Hand-built go-fish baseline: HIGH — game.ts, flow.ts, actions.ts, elements.ts all read in full.
- Pitfalls: MEDIUM-HIGH — several are directly evidenced (init directory-collision error, `${CLAUDE_SKILL_DIR}` substitution mechanics), one (A2/installer layout) is an assumption flagged for plan-time verification.

**Research date:** 2026-07-05
**Valid until:** This research is tightly coupled to the current state of Phases 140-148's skill files, which may still be under active development elsewhere in the milestone. Re-verify against the actual `bs/build/*.md` files not read here (redteam.md, ask.md, build.md, repair.md, playtest.md, revise.md, close.md, final-acceptance.md, design-review.md) at plan time — valid for roughly 7 days or until any of those files change, whichever is sooner.
