# Phase 149: End-to-End Dry-Run Validation - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the rulebook-to-playable-game pipeline (the `bs-` skill family built in Phases 140-148) end-to-end by DRY-RUNNING it against a real reference game — Go Fish — before it is ever pointed at an actual designer. This is a VALIDATION phase, not an authoring phase: the deliverable is (a) evidence the pipeline's machine steps actually work when the skill instructions are followed, (b) a documented comparison of the dry-run output against the hand-built go-fish, (c) fixes for every pipeline defect (skill-logic bug, template gap, gate friction) surfaced, and (d) the human browser-playtest captured as a manual-verification (HUMAN-UAT) item. Requirement VAL-01.

Canonical contract: `.planning/bs-skills-plan.md` (the whole pipeline) + the installed skills (`src/cli/slash-command/bs/`) + the hand-built `~/BoardSmithGames/go-fish/`.

</domain>

<decisions>
## Implementation Decisions

### Reference Game & Depth
- Target: **Go Fish** — a card game with hidden information (each player's hand is hidden from opponents), which exercises the pipeline's richest lens: the visibility/leak diff in the audit step. Standard public-domain Go Fish rules are the "rulebook" (no PDF needed; the rules text is the dry-run's INGEST-01 input, or the interview-fallback path INGEST-03)
- Depth: **ingest + the core-event-loop chunk (chunk 1)** run through the machine steps. Chunk 1 = the smallest slice where a player can take one action and see the game respond (deal hands + one "ask an opponent for a rank" turn resolving to a give-cards-or-go-fish outcome). This is the thinnest end-to-end proof; going deeper (matching/scoring/win) is out of scope for the dry-run
- Hand-built comparison target: `~/BoardSmithGames/go-fish/src/rules/` (~1079 LOC — game.ts, elements.ts, actions.ts, flow.ts) — the reference implementation the dry-run output is compared against

### Dry-Run Execution Model
- Run the pipeline's MACHINE STEPS autonomously via subagents that FOLLOW THE ACTUAL AUTHORED SKILL INSTRUCTIONS (`bs/ingest-rules.md` + `bs/ingest/*.md`; `bs/build-chunk.md` + `bs/build/{investigate,redteam,ask,build,test,audit,repair}.md`) — not a hand-waved approximation. Each step's subagent reads the real skill reference file and produces the artifact that skill mandates, in a scratch workspace (NOT ~/BoardSmithGames/go-fish — a fresh throwaway dir so the hand-built game is untouched)
- Steps covered autonomously: ingest (transcribe Go Fish rules → rulebook slices + INDEX + SKETCH.md + scaffold), then chunk-1 investigate → redteam → ask → build → test → audit → repair. The `ask` and `playtest` HUMAN GATES: the machine steps run up TO each gate and capture what the gate would present (the ask design proposal, the playtest script) as artifacts, rather than blocking on a human mid-run
- The `test` step's automated checks (tsc, eslint boardsmith plugin, unit/integration, random-sim) actually run against the dry-run's generated chunk-1 code — proving the generated game compiles and the test discipline works
- Server discipline: any dev server started for a check is killed before returning (repo hard rule); the human playtest server is NOT started autonomously (the user owns it — it's the deferred manual item)

### Comparison & Defect Handling
- Comparison methodology: compare the dry-run's chunk-1 artifacts against the hand-built go-fish on (1) rule fidelity — does the generated core loop match Go Fish's actual rules (ask for rank, give matching cards or "go fish"/draw)?; (2) hidden-info handling — does the generated code redact opponent hands via visibleAttributes like the hand-built one?; (3) BoardSmith idiom — does the generated code use the engine correctly (elements, actions, flow) vs the hand-built reference; (4) artifact quality — do SKETCH.md/CHUNK.md parse against the templates? Discrepancies are RECONCILED (fix the pipeline) or explicitly DOCUMENTED (acceptable divergence, e.g. a different-but-valid data model)
- Pipeline defects surfaced (skill-logic bugs, template gaps, gate friction, wrong/missing instructions in the bs- skills) are FIXED in the bs- skill files before the milestone ships — these fixes re-run the bs/ drift suites to stay green. Defects are logged in a dry-run report (`149-DRYRUN-REPORT.md`)
- The dry-run report documents: what ran, what the pipeline produced, the comparison table, every defect found + its disposition (fixed / documented), and the human-playtest items deferred

### Completion Bar
- Phase completes when: the autonomous machine-step dry-run runs CLEAN against Go Fish (ingest + chunk 1, generated code compiles + passes its automated tests), the comparison-vs-hand-built is documented, ALL surfaced pipeline defects are fixed (bs/ suites green), and the human browser-playtest is captured as a HUMAN-UAT manual-verification item. The milestone ships with that ONE manual gate outstanding (the user runs the real human playtest when back) — this is the honest completion bar for a pipeline whose playtest gate is human-by-design
- Verification status will be `human_needed` (the browser playtest) — routed to the user, not a blocker for the autonomous run

### Claude's Discretion
- Scratch-workspace location + cleanup, exact subagent decomposition per pipeline step, dry-run report format, how many redteam/audit agents to actually spawn (scaled-down from the skill's full fan-out is acceptable for a dry-run as long as the step's LOGIC is exercised)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.planning/bs-skills-plan.md` — the full pipeline spec being validated
- `src/cli/slash-command/bs/` — the installed skills the dry-run EXECUTES (ingest-rules.md, build-chunk.md, ingest/, build/, templates/, state-machine.md); the bs/*.test.ts drift suites must stay green after any skill fixes
- `~/BoardSmithGames/go-fish/src/rules/` — the hand-built reference (game.ts, elements.ts, actions.ts, flow.ts, ai.ts, tutorial.ts) to compare against; go-fish also has hidden-hand handling (a known v4.2 broadcast-bug fix lives in its history — good visibility-lens test)
- `npx boardsmith init` + the Phase 144 scaffold (axe-core/a11y harness) — what the dry-run's ingest scaffold step invokes
- BoardSmith testing module (TestGame random sim, `simulateRandomGames`), eslint-plugin — what the dry-run's test step runs against generated code
- The pipeline's own artifacts from Phases 141-147 (templates, state-machine authority) — the dry-run proves these are fillable/parseable in practice

### Established Patterns
- Subagent-driven multi-step execution (this whole autonomous run); scratch-workspace + cleanup; fresh-context adversarial agents; server-kill discipline; drift suites green after skill edits
- Fix-at-source: pipeline defects are fixed in the bs- skill files, not worked around in the dry-run

### Integration Points
- This phase VALIDATES all of 140-148; a defect here may require editing any bs- skill file (and re-running its drift suite)
- The go-fish hand-built game is READ-ONLY reference — never modified
- The human-playtest HUMAN-UAT item feeds `/gsd:audit-uat` / the milestone audit

</code_context>

<specifics>
## Specific Ideas

- The dry-run is the first time the pipeline is exercised as a WHOLE rather than per-phase drift-tested — it catches cross-skill friction the unit tests can't (e.g. does ingest's SKETCH.md actually feed build-chunk's resume routing? do the templates the ingest fills actually satisfy build-chunk's parse expectations?)
- Go Fish's hidden hands are the key visibility-lens exercise: the audit step's two-seat leak diff should catch any opponent-hand leak in the generated code
- "Done" for the milestone is defined by the plan as the final-acceptance chunk + coverage — but for THIS dry-run, chunk-1 + honest deferral of the human gate is the pragmatic proof
- Any defect that would have shipped a broken pipeline to a real designer is the highest-value find — that's the entire point of dry-running before pointing it at a designer

</specifics>

<deferred>
## Deferred Ideas

- Full multi-chunk dry-run through game-end/scoring/final-acceptance (this phase does chunk 1 only)
- Live human browser-playtest of the dry-run output (routed as the HUMAN-UAT manual item)

</deferred>
