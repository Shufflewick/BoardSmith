---
phase: 171
slug: provenance-recording
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-28
---

# Phase 171 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing, repo-wide) |
| **Config file** | repo root `vitest.config.ts` (existing, unchanged) |
| **Quick run command** | `npx vitest run src/cli/commands/chunk-provenance.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~2s quick / ~30s full suite (3323 tests at phase start) |

---

## Sampling Rate

- **After every task commit:** run the owning plan's quick command
- **After every plan wave:** `npm test`
- **Before phase verification:** full suite green AND plan 07's real-reference-game proof recorded
- **Max feedback latency:** ~2s (quick), ~30s (full)

---

## What This Phase Can and Cannot Validate

This section exists because Phase 170 shipped green through every contract test while failing its
real run, twice. The distinction below is load-bearing, not commentary.

| Tier | What it proves | Confidence |
|---|---|---|
| Unit test vs. temp fixture | The command computes the right answer from a given tree | HIGH — these are deterministic, and everything mechanical in this phase belongs here |
| Command run vs. a copied real reference game | The command survives real, messy, pre-contract project data | HIGH — this is what catches fixture-shaped assumptions |
| Contract test on skill text | An instruction EXISTS in the installed text | **Proves existence only.** Phase 170 verified twelve instructions present and observed every one skipped on live runs |
| A live `/bs-build-chunk` session running `close` | That an agent actually invokes the command | **NOT VALIDATED IN THIS PHASE.** See "Known Unvalidated" below |

Because all three PROV requirements sort mechanical, tiers 1 and 2 carry this phase. The skill-text
wiring in plan 06 is deliberately *not* the guarantee — the machine-owned fence and
`chunk-provenance-status`'s `verifiedWithoutProvenance` flag are.

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; this map is keyed by requirement and updated during
> execution as tasks land.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | PROV-01 (F-1 edition sentinel) | — | designer wording preserved, never silently discarded | unit + RED-first | `npx vitest run src/cli/commands/ingest-archive.test.ts` | ✅ | ⬜ pending |
| TBD | 02 | 1 | PROV-01 (version + skills-tree hash) | — | hash covers installer-owned paths only | unit | `npx vitest run src/cli/commands/version.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | PROV-02 (5 enumerated reason codes) | T-171-scope | scope computed from disk, never from input | unit vs. temp fixtures | `npx vitest run src/cli/commands/chunk-provenance.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | PROV-01 (`resolveCitedSlices`) | — | unresolvable citation recorded verbatim, never dropped | unit vs. real citation-token fixtures | `npx vitest run src/cli/commands/chunk-provenance.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 04 | 3 | PROV-01, PROV-02 (`chunk-check`) | T-171-write | writes only between fences; refuses when absent | unit + exitCode save/restore | `npx vitest run src/cli/commands/chunk-provenance.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 05 | 4 | PROV-03, PROV-02 (`chunk-provenance-status`) | — | three states kept distinct in the `--json` shape | unit vs. multi-chunk fixture | `npx vitest run src/cli/commands/chunk-provenance-status.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 06 | 5 | PROV-01, PROV-03 (both close paths) | — | reuse-by-citation preserved; ordinals resolve | skill-text contract — **existence only** | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` | ✅ | ⬜ pending |
| TBD | 06 | 5 | ordinal-citation drift guard | — | renumbering close.md fails the suite | derived-numbering test (new) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 07 | 6 | PROC-01 + all three PROV | T-171-readonly | `seven` clean before AND after | real-reference-game proof on a COPY | `npm test` + recorded command output | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/chunk-provenance.test.ts` — new file; temp-project helper and
      `process.exitCode` save/restore both COPIED from `ingest-archive.test.ts`, not reinvented
- [ ] `src/cli/commands/chunk-provenance-status.test.ts` — new file, multi-chunk fixture covering
      all three states in one tree
- [ ] Citation-token fixtures taken from REAL chunk prose (both shorthand `rulebook/02 p.4` and
      full-filename forms, plus the trailing `**`/`}`/`.`/`'s` variants), not hand-invented — a
      hand-authored fixture would encode the assumption under test
- [ ] A fixture reproducing `seven`'s genuinely ambiguous two-`01-`-slices case, so "resolves to
      nothing, recorded verbatim" is pinned rather than assumed

---

## RED-First Obligations

Phase 170 accepted its lexicon fix only after observing it FAIL against pre-fix code. The same
discipline applies to every behavioural change here. These must be observed red before the fix
lands, and the observation recorded in the plan's SUMMARY:

| Change | Must first fail because |
|---|---|
| F-1 edition normalisation (01) | pre-fix, free text `none stated in rulebook` reaches `INDEX.md` unchanged |
| real `--version` (02) | pre-fix, `boardsmith --version` prints the hardcoded `0.0.1` regardless of package.json |
| `resolveCitedSlices` (03) | pre-fix the function does not exist; once it does, the ambiguous-`01-` fixture must fail any implementation that guesses |
| fence refusal (04) | pre-fix, a fence-less `## Verified Against` section is silently rewritten rather than refused |
| ordinal drift guard (06) | the test must fail against the CURRENT tree, where `state-machine.md:46` and `:113` cite item 4 while the sequence is about to renumber |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The commands produce correct provenance against real, pre-contract project data | PROC-01, PROV-01/02/03 | Both reference games predate Phase 170's `INDEX.md` contract — no `rulebook/source/`, no `Source hash:`, non-canonical `Edition:` free text, and `one-two-punch`'s `INDEX.md` has no `## Slices` heading at all. No fixture is a substitute for that mess. | Per `171-07-PLAN.md`: copy BOTH games to temp, run `chunk-check` on every chunk and `chunk-provenance-status --json`, assert all 29 pre-existing chunks classify `unknown` (NOT `code-conformance-only`), assert `pre-provenance-project` is the reason code for both, and assert `git -C ~/BoardSmithGames/seven status --porcelain` is empty and HEAD is `a03f38d4792af9dfc7c798be69686fc3230f54dd` both before and after. |

---

## Known Unvalidated (stated, not hidden)

1. **That a live `close` invocation actually runs `boardsmith chunk-check`.** Plan 06 wires it into
   both close paths, and its tests prove the instruction exists. They cannot prove a session follows
   it — Phase 170 established this across fourteen live runs. Mitigation is structural, not textual:
   the machine-owned fence makes a hand-authored block detectable, and
   `chunk-provenance-status`'s `verifiedWithoutProvenance` flag surfaces any chunk marked `verified`
   with no valid block. Both are load-bearing precisely because the instruction is not.
2. **Phase 170's `/bs-build-chunk` Step 0 `ingest-check` call has still never been exercised by a
   live session.** This phase adds a second skill-text→command invocation with the same risk
   profile. The first real `/bs-build-chunk` run on a project settles both at once; neither is
   settled here.

---

## Validation Sign-Off

- [x] Every task has an `<automated>` verify or a Wave 0 dependency; the sole non-automated item is
      plan 07's reference-game proof, whose criteria are concrete asserted command outputs
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (two new test files + real-prose citation fixtures +
      the ambiguous-slice fixture)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] Tiering is explicit — no contract test is credited with proving live-agent behaviour
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-28, alongside the plan-check revision closing blockers 1 and 2
(`171-06-PLAN.md` Task 2 ordinal fixes + the derived-numbering drift guard).
