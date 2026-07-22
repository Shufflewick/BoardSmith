# Phase 167: Skills Autonomy Rewrite - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the `bs-skills` build as autonomously as possible while every human interruption stays meaningful, WITHOUT eroding any Part D provenance discipline. Requirements: SKILLAUTO-01..08 (B.1–B.7, B.9), PROC-02, PROC-01.

**Scope reality (from scout):** Much of the autonomy substrate already exists — the "one step group per session, hand off at seams" rule was largely replaced by continuous-run prose (`state-machine.md:156-235`), and RULINGS.md is already a shared cross-session store. This phase is a **tightening/completion**, not a from-scratch rewrite. All edits target the REPO source-of-truth under `src/cli/slash-command/bs/` (never `~/.claude/skills/`).
</domain>

<decisions>
## Implementation Decisions

### SKILLAUTO-01 — B.1 milestone playtest gates
- Human playtest stop occurs ONLY at the **3 milestones**: (1) core-loop complete, (2) scoring/endgame complete, (3) final-acceptance — plus **always stop for a genuine rules adjudication / open question** regardless of milestone.
- Milestone chunks are identified by an **explicit milestone flag on the chunk in SKETCH** (set at sketch-derivation time), not inferred at runtime.
- Non-milestone chunks keep **all internal steps unchanged** (tests, audit, self-playtest / sim); only the *human* client-playtest stop moves to milestones.
- Edit targets: `state-machine.md:14,182-190` (status enum + human-gate list), `build/playtest.md:1-11,93-108` (the per-chunk gate — gate it on milestone/UI presence), `build-chunk.md:291-328` (Step Group 4 dispatch), `ingest/sketch-derivation.md:14-18,71-73` + `templates/SKETCH.template.md:107-108` (milestone flag + the three anchor chunks).

### SKILLAUTO-02..05 — B.2–B.5 question discipline + batching + run-while-away + auto-advance
- **Ask criteria (B.2):** ask only when the answer is genuinely undetermined by rules + prior answers AND the choice is load-bearing AND no reasonable default exists; otherwise proceed and **record the assumption**. Never re-ask already-granted approval; never route a human playtest for a chunk with **no visible UI**.
- **Batching (B.3):** accumulate open questions into a **queue**, keep building everything not blocked, and surface the batch at the next human gate/milestone (GSD-autonomous model).
- **Run-while-away (B.4) + auto-advance (B.5):** the pipeline keeps making progress on reasonable defaults and **auto-advances into the next chunk** (and the next logical step, e.g. generate-AI → final-acceptance) without the human re-invoking. The printed resume command is retained ONLY as a cold-resume/crash fallback — NOT as a stop signal. Remove the residual "print next command and hand off" stop behavior at `build/close.md:106-131` and `build-chunk.md:352-372`; the only human gates are B.1's three milestones (+ rules adjudication).
- Edit targets: `state-machine.md:80-101,146-235`, `build/ask.md`, `build/build.md:35-38`, `build/close.md:98-142`, `build-chunk.md:222-372`.

### SKILLAUTO-06/07 — B.6 context + B.7 loud completion
- **Context (B.6):** never wind down before **≥50% context consumed** (a floor); keep the existing **60% "obey-the-harness-warning" ceiling**. The substantive lever is **sub-agent offload**: research, audits, large reads, and repairs are offloaded to sub-agents so the main thread fills slowly and long autonomous runs are possible. Preserve the existing "orchestrator never reads the big stuff" rule (`build-chunk.md:19-36`). Edit target: `state-machine.md:220-233`, `build-chunk.md:276-278,358-372`.
- **Loud completion (B.7):** finishing a GAME emits a **loud, unambiguous banner + clean summary card** (what shipped, test count, deferred items) — never buried in a wall of text. A lighter chunk-level completion line is also added. NEW output at `build/close.md:106-142` (chunk-level) and `build/final-acceptance.md:142-168` (game-level).

### SKILLAUTO-08 — B.9 process gaps
- **B.9a close-time ledger reconciliation:** at `close`, reconcile the filings/library-gap ledger + asset-debt + waived-chunk ledgers against what the chunk changed ("audit the paperwork, not just the code"; re-touch the relevant filing when a fix lands). Edit target: `build/close.md:19-66` (Bookkeeping Sequence — add a reconciliation step), sourcing the ledgers surfaced by `check-status.md:71-82` and filings from `build/build.md:54-61`.
- **B.9b shared ruling store:** RULINGS.md is already a shared cross-session per-game store (`state-machine.md:103-105`); **strengthen** it so close-time reconciliation re-touches relevant rulings/filings when a fix lands.
- **B.9c fail-loud sims:** add an assertion that the sim/test **actually exercised this chunk's new actions** — a sim that stops exercising its target FAILS LOUD, not passes quietly. Edit target: `build/test.md:46-72` (random-sim), `build/playtest.md:59-70` (freshness guard).

### PROC-02 — Part D preservation (guardrails)
- Autonomy applies to **how to build**, never to **what the rules are**; genuine rule ambiguity is still surfaced (batched), never fabricated. Weave an explicit statement of this to the top-level autonomy prose, and add **drift tests asserting each Part D rule survives** the rewrite:
  - escalate-don't-hack / file-don't-workaround (`build/build.md:40-61,122-130`), reuse-not-rebuild (`build/test.md:71-72`, `build/build.md:28-38`), honest-derived labeling (`state-machine.md:74-98`, `:15` `verified (user-waived)`), surface-don't-fabricate (`state-machine.md:80-82`, `build/build.md:23-26,54-61`), in-process redteam (`state-machine.md:150-154` + `build/redteam.md`), build-literally (`build/build.md:10-26`, `build/playtest.md:32-52`).

### PROC-01 — Tests
- Add fail-pre/pass-post drift assertions across the four suites: `build-chunk.test.ts` (primary — milestone-gate, ask discipline, auto-advance, 50% floor, loud completion, close reconciliation), `ingest.test.ts` (milestone-chunk mandates), `templates.test.ts` (SKETCH milestone flag), `status-tools.test.ts` (ledger surfacing). Run `npx vitest run src/cli/slash-command/bs`; full suite green at the gate.

### Claude's Discretion
- Exact prose wording, the milestone-flag field name/format in SKETCH, the completion-card layout, and marker-constant names are at Claude's discretion, consistent with the existing skill voice and drift-test conventions.
</decisions>

<code_context>
## Existing Code Insights

### Edit targets (repo source-of-truth, from scout) — see per-requirement decisions above for line anchors
- `src/cli/slash-command/bs/state-machine.md` — status enum (14), human-gate list (182-194), session-handoff/continuous-run (156-235), context escape-hatch 60% (220-233), rulings-outrank (103-105), Part D anchors (74-98, 150-154).
- `src/cli/slash-command/bs/build-chunk.md` — Context-Economics Hard Rule (19-36), Step Group dispatch (222-372), resume-command handoff (352-372).
- `src/cli/slash-command/bs/build/{playtest,ask,build,close,test,redteam,audit,investigate,final-acceptance,design-review}.md`.
- `src/cli/slash-command/bs/ingest/sketch-derivation.md` (14-18 core-loop, 71-73 scoring/final anchors).
- `src/cli/slash-command/bs/templates/{SKETCH,RULINGS,CHUNK}.template.md`.
- Drift tests: `src/cli/slash-command/bs/{build-chunk,ingest,templates,status-tools}.test.ts` (read()+toContain marker-constant pattern).

### Established Patterns
- Much autonomy already present (continuous cross-chunk run; shared RULINGS). This is tightening, not rebuild — Pit of Success: extend, do not restructure.
- Drift-test convention: named marker constants + `expect(content).toContain(...)`, one describe per requirement; fail-pre by construction.
- NO backward-compat: replace the old per-chunk-handoff prose outright.

### Integration Points
- Repo edits → installed to `~/.claude/skills/` via `install-claude-command` (repo is source of truth; never edit installed copies).
- Phase 166 already fenced the boundary + fixed the session lock; this phase builds on that fenced boundary.
</code_context>

<specifics>
## Specific Ideas
- Tracking design doc: `.planning/bs-skills-plan.md` (esp. Hard Rules §139-158). This phase evolves those Hard Rules toward autonomy.
- Post-mortem Part B (autonomy) + Part D (disciplines to preserve) are the source; the "Caution for the autonomy work" note (Part B) maps to PROC-02.
</specifics>

<deferred>
## Deferred Ideas
- The seed-to-state platform feature spike → Phase 168.
- The game de-workaround sweep → Phase 169.
</deferred>
