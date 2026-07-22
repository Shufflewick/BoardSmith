# BoardSmith — Living Retrospective

## Milestone: v4.1 — Tutorial Primitives (Checkers)

**Shipped:** 2026-06-30
**Phases:** 8 (104–111) | **Plans:** 35

### What Was Built

A reusable, CI-verifiable tutorial substrate (lifecycle + action gating, annotation
overlay with custom-UI/AutoUI parity, predicate triggers, testing DSL), proven by a
complete checkers tutorial; MCTS-powered AI teaching (hint, narrated AI-vs-AI demo,
evaluation heatmap); per-action help with a global toggle; a live browser
demonstration/refinement gate (DEMO-01); and a host-gated teaching lockout (LOCK-01).

### What Worked

- **DEMO-01 as a real refinement gate.** Walking the features live in the browser
  surfaced 16 concrete defects (R-01..R-16) that the green test suite had missed —
  custom-UI anchor gaps (hint/heatmap invisible), a multi-jump hang, an inert
  action-help toggle, a dead action-dock destination button. Each got a proven root
  cause + regression test. Live demonstration caught what unit tests structurally could not.
- **Parity hard-rule paid off.** Routing overlays through `useBoardInteraction` and
  gating in the shared ControlsMenu meant LOCK-01's lockout and the teaching affordances
  worked in both UI paths with one implementation.
- **Server-authoritative anti-cheat.** Treating server op-rejection (not UI hiding) as
  the real LOCK-01 control, proven by cross-layer tests that bypass the UI, made the
  human "craft a console op" check redundant.

### What Was Inefficient

- Several refinements (R-04 especially) took multiple attempts because the first fix
  addressed a symptom, not the timing-race root cause — reinforced "Prove Before Fix."
- Custom games silently break ALL teaching overlays if they forget to spread
  `anchorAttrs` (R-09/R-10). Captured as a pit-of-success follow-up (lint/dev-warning).

### Patterns Established

- Dedicated session-level config (not gameOptions) for host policy flags.
- Cross-layer trace tests per boundary (config→broadcast→UI, CLI→running host).
- A game with zero `.help()` text now hides the inert global toggle (R-14b).

### Key Lessons

- A live human demo gate is worth its cost on UI-heavy substrate work.
- Additive, well-wired changes keep the dead-code audit clean; the audit's whole-repo
  baseline failures are pre-existing and mostly external-API false positives.

### Cost Observations

- Model mix: planning/verification on opus; executors + checkers on sonnet.
- Phase 111 (lockout) executed fully autonomously (discuss→plan→execute) with a single
  human gate; Wave 1+2 plans each ~5–7 min on the main tree (worktrees disabled).

## Milestone: v4.8 — Battery Post-Mortem Fixes

**Shipped:** 2026-07-22 | **Phases:** 14/15 (165 deferred-to-platform) | **Plans:** 44

### What Was Built
The full 5-game build-battery post-mortem closeout — 31 library/engine/dev-host/tooling defects, the two `bs-skills` defects + a complete autonomy rewrite, a seed-to-state feasibility spike (+ `--seed` PoC), and a conservative fix-gated de-workaround sweep across all 5 game repos. Ran end-to-end via `/gsd-autonomous`.

### What Worked
- **Scout-before-discuss on every phase.** A read-only Explore/general scout mapping exact file:line targets before the grey-area discuss made the smart-discuss proposals concrete and the planner prompts precise — near-zero re-work at plan time.
- **Adversarial verify caught real defects the green bar missed, repeatedly.** Phase 164 code-review surfaced 2 Criticals (LIBX-04 guard incomplete at the true chokepoint; contrastInk crashing on valid CSS colors). Phase 167's coherence verify caught a floor-vs-harness precedence contradiction. Phase 168's verify caught a false "proven against go-fish" doc claim. Each was a genuine gap behind a passing suite.
- **The de-workaround gate proved itself.** Two removals (lanternfall BUG 7, one-two-punch BUG 3) turned suites red and were reverted-and-noted — "kept + note is a valid success" prevented forcing cleanliness over correctness on shipped games.
- **Prove-before-fix on the tech-debt pass.** The "3 game repos failing hidden-zone" scare was diagnosed (not guessed) to a deliberate D24/SPACE-03 API split the games never migrated — a 2-file game-side call-site swap, not a library regression. Guessing would have "fixed" the library and broken the intentional contract.

### What Was Inefficient
- **Baselines assumed green that weren't.** Three game repos had pre-existing red suites (seven 204/205, doom 399/405, BSG2/seven) that plans described as "green baseline." The executors handled it honestly (logged to deferred-items.md, no masking), but the plans should have captured the real baseline first.
- **Phase 165 was roadmapped into a repo it couldn't touch.** A quick "is the target even here?" grep at roadmap time would have flagged D32 as platform-only before it became a mid-run blocker.

### Patterns Established
- **Fix-present crosswalk as an explicit gate artifact** (169-CROSSWALK.md): grep-verify each library fix is PRESENT with file:line before any downstream removal cites it. Made the cross-repo sweep auditable.
- **File-scoped commits with `git show --stat` self-proof** when sweeping repos with pre-existing dirty trees — the audit trail distinguishes swept changes from unrelated WIP.

### Key Lessons
- A "3 repos broke" signal is more often one shared upstream contract change than three independent regressions — trace the common surface before touching any of them.
- When a milestone phase targets code, verify the code is reachable from this repo at roadmap time, not execution time.

### Cost Observations
- Model mix: orchestrator opus; planners opus; researchers/scouts/executors/verifiers/checkers sonnet.
- Long single autonomous session; ~50+ subagent dispatches. Sequential main-tree execution (worktrees disabled) — external game-repo sweeps ran ~15–55 min each.

## Milestone: v4.7 — Playtest Follow-Up Fixes

**Shipped:** 2026-07-06
**Phases:** 3 (152–154) | **Plans:** 8

### What Was Built
Closed v4.6's three playtest follow-ups: DEF-A (scaffold `AssetImage.vue` + AutoUI renderer guards + `scanAssetReachability` build gate), DEF-C (dev-host `dev.ts` stale-close socket-identity guard, shared into `connection-handler.ts`), and DEF-B propagation (MERC re-vendor, 738/7 green).

### What Worked
- **Prove-before-fix paid for itself twice.** The Phase 153 researcher *empirically reproduced* DEF-C in a throwaway vitest and pinned the true root cause in `dev.ts` — refuting the discuss-phase's leading `reinitSeat` hypothesis. Guessing would have "fixed" the wrong file.
- **Both automated quality gates caught real defects the execution missed.** Code review found a genuine critical in 152 (shipped `AssetImage.vue` never reset `loaded` on `src` change → stale/broken flash) and a drift-risk in 153 (fix hand-duplicated between `dev.ts` and its test). Both fixed + regression-locked; the 153 fix was extracted into a shared handler so the test now guards the literal code.
- **Playwright fallback held up again.** The Chrome extension was down for both browser proofs (152 asset rendering, 153 reload-storm/reconnect/AI-handoff); headless Playwright against the real `boardsmith dev` server closed SC-3 both times.
- **Re-vendor-as-integration-test** once more validated the whole milestone in one shot: MERC absorbed all three fixes with zero source changes.

### What Was Inefficient
- The SC-3 browser proof burned real effort fighting the go-fish dev-host seat-picker UX (auto-seat vs "Take seat", game-in-iframe) before landing on a game-agnostic observable (WS-instrumented broadcast-delivery survival). A dev-host test-mode hook for "is this client still receiving broadcasts" would have made it a one-liner.
- Left-behind dev-host processes from setup attempts collided on :5173 (had to hunt/kill a stray listener). A stricter "kill by port before start" preflight would avoid the churn.
- Nyquist `VALIDATION.md` `nyquist_compliant` flags were left `false` on 152/153 even though real coverage was green — a bookkeeping-flag gap the audit correctly flagged as advisory.

### Patterns Established
- **Structural pit-of-success for missing assets:** a scaffold-emitted wrapper that renders a drawn fallback and only overlays the real `<img>` on `@load` — broken images become impossible, not merely discouraged.
- **Static, file-system-level reachability gates** (never HTTP probes — Vite's SPA fallback 200s a missing path), mirroring `sandbox-scan.ts`'s single-source-of-truth shape.
- **Share the handler under test:** when a regression test must mirror production wiring, extract the wiring into one exported function both import — the test then has teeth against the literal code (verified by neutering the guard).

### Key Lessons
- A green automated bar is not a substitute for a human/browser gate: DEF-A/DEF-C shipped green in v4.6 and only surfaced under real play. v4.7's real-browser proofs + adversarial code review are the structural answer.
- Reproduction is the hard 80% of a concurrency/transport bug; once reproduced, the fix was one line.

### Cost Observations
- Model mix: planning on opus, research/executors/verifiers/reviewers on sonnet; orchestration on opus.
- Worktrees disabled → wave-1 plans serialized on the main tree; fine at this scale (≤5 plans/phase).
- Two browser proofs + one MERC full-suite run (independently re-run by the verifier) were the main wall-clock costs.

## Cross-Milestone Trends

_(Seeded at v4.1 — populate as future milestones complete.)_

**Recurring wins:** re-vendor-as-integration-test (v4.3/4.4/4.5/4.7); the human/browser gate catching what the automated bar shipped green (v4.6→v4.7); prove-before-fix refuting a plausible-but-wrong hypothesis (v4.7 DEF-C).
**Recurring friction:** Chrome extension unavailability → standing Playwright fallback (v4.6/v4.7); dev-host process/port hygiene; Nyquist compliance flags left unflipped despite green coverage.
