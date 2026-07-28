---
phase: 173
slug: verify-pipeline-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 173 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `173-RESEARCH.md` § Validation Architecture and `173-PATTERNS.md`.

---

## The honest constraint on this phase

**Most of this phase's deliverable is skill text, and skill text is not behaviourally testable here.**
Every existing `.md` test in this repo (`ingest.test.ts`, `build-chunk.test.ts`, `templates.test.ts`,
`status-tools.test.ts`) asserts only string presence/absence in the raw file — never that a live
session follows the instruction. `ingest.test.ts:352-356` states this limitation in its own comment.

Phase 170's central finding is the same fact from the other direction: twelve instruction-shaped
mechanisms were skipped on live runs while every automated check stayed green. So a green suite is
**necessary and nowhere near sufficient** for this phase.

The split this strategy therefore enforces:

| Layer | Verifiable how |
|---|---|
| `ingest-archive` fix, ledger command, path computation, installer registration | Automated (vitest) — real assertions |
| Skill text says the right thing | Automated (string presence) — weak, but pins the contract against silent deletion |
| Skill text is actually FOLLOWED by a live session | **Live-session proof only** — `173-PROOF.md` |

Any task claiming VERIFY-01/07/08 is satisfied on the strength of `.toContain()` assertions alone
should be rejected in review.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`vitest.config.ts` at repo root; `"test": "vitest run"`) |
| **Quick run command** | `npx vitest run src/cli/commands/ingest-archive.test.ts src/cli/commands/verify-run.test.ts src/cli/commands/install-claude-command.test.ts src/cli/slash-command/bs/` |
| **Full suite command** | `npm test` |
| **Lint** | `npm run lint` — 3 pre-existing errors in `src/engine/` and `src/ui/`; **zero** permitted in `src/cli/` |
| **Estimated runtime** | quick ~10s · full suite ~30s |

Baseline: **3510/3510 green** at Phase 172 close (233 files). Any red at phase start is pre-existing
and must be reported, not absorbed. Note the suite total includes a concurrent unrelated change in
`src/session/stateless-ops.*` from another agent — not this phase's work.

---

## Sampling Rate

- **After every task commit:** the quick run command above
- **After every plan wave:** `npm test` + `npm run lint`
- **Before `/gsd:verify-work`:** full suite green **AND** `173-PROOF.md` exists with all four
  live-session proofs below
- **Max feedback latency:** ~10s (quick), ~30s (full)

---

## Wave 1 is a hard gate

Decision 1b: `ingest-archive` is broken on already-ingested projects — it reports success while
corrupting `INDEX.md` and silently failing to write `Source hash:`/`Transcribed:`. Reproduced twice
this session (research, then independently by the orchestrator against a `cp -R` copy of `seven`).

**Wave 1 exit condition is not "the command exits 0" — it is that an adopted project actually
computes the adopted scope.** Run adoption against copies of BOTH reference games and assert
`chunk-provenance-status` no longer reports `pre-provenance`. The command already lies about
success; its exit code is not evidence.

No later wave may be verified against real-game data until this passes.

---

## Per-Task Verification Map

> Populated by the planner. Every task lands here with a real automated command, except the
> live-session proofs, which are integration proofs recorded in `173-PROOF.md`.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| _pending planner_ | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Success Criterion → Observable Signal

| Criterion | Observable signal | Sufficient sample |
|---|---|---|
| **SC-1** — skill installs and runs against an existing project without rebuilding | `bs-verify-game/` present under the installed skills tree after `boardsmith claude`, including its `bs/verify/` subdir; all **five** `SKILL_NAMES` sites in `install-claude-command.test.ts` updated together (3–4 assertions silently keep testing the old 6-skill set otherwise) | unit + a real install into a temp dir |
| **SC-2** — non-destructive staging | Live slices byte-identical before/after a full pass; every write lands under `rulebook/.verify/<run-id>/`; no walker picks up the dot-dir | unit (path computation) + whole-tree byte manifest diff in the live proof |
| **SC-3** — orchestrator never reads a slice (**an ABSENCE**) | **Positive observable:** the orchestrator's captured transcript contains no slice-body-shaped line (`QUOTE`, `Derived (p.`, `Visual (p.`) anywhere across the pass; dispatch prompts carry only unit id + rulebook path + output dir; returns carry only structured-summary fields | live-session proof with a transcript grep — **never** a compliance assertion |
| **SC-4** — resumable | A real interrupted run: kill mid-pass with ≥1 unit recorded and ≥1 unrecorded, re-invoke, then assert (a) recorded units are NOT re-dispatched, (b) unrecorded ones ARE, (c) the end state matches a clean run | live kill-and-resume proof — **not** a unit test of the ledger reader |
| **Decision 1b** — the gate | `chunk-provenance-status` reports adopted (not `pre-provenance`) scope after adoption on copies of both games; `Edition:` preserved; `Source:` wrapped prose intact; `Source hash:`/`Transcribed:` present | unit + real-data proof on both games |

---

## Wave 0 Requirements

- [ ] `src/cli/commands/verify-run.ts` + colocated test — does not exist
- [ ] `src/cli/slash-command/bs/verify-game.md` + `bs/verify/*.md` — do not exist
- [ ] Installer registration for `bs-verify-game` (`SHARED_DIRS`, `SKILL_ENTRY_POINTS`, post-install summary) — hand-maintained arrays, not auto-discovered
- [ ] `ingest-archive.test.ts` cases for the existing-INDEX branch — the defect currently has no failing test
- [ ] No framework install needed — Vitest configured and green

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Adoption establishes real provenance on a pre-170 project | Decision 1b | Cross-repo; requires copies of real games and an independent scope re-check | `cp -R` both games to scratch, run adoption, assert `chunk-provenance-status` scope changed and `INDEX.md` header is intact field-by-field |
| A live verify pass stages non-destructively | VERIFY-02 / SC-2 | Requires a real skill session, not a unit test | Whole-tree byte manifest of `rulebook/*.md` before and after; must be identical |
| The orchestrator never reads a slice | VERIFY-07 / SC-3 | An absence; only observable in a real session transcript | Grep the captured transcript for slice-body-shaped lines; must find none |
| Kill-and-resume | VERIFY-08 / SC-4 | Requires a real interruption | Per SC-4 above; record verbatim in `173-PROOF.md` |
| Each new skill-text→command invocation actually runs | Phase 170 carry-forward | Instruction-shaped mechanisms get skipped; this is the failure mode the milestone exists to fight | For every new skill-text→command call, show it running in a live session. **Carried-forward debt: `/bs-build-chunk` Step 0's `ingest-check` call has still never been exercised live.** |

**Read-only invariant (non-negotiable):** `~/BoardSmithGames/seven` pinned at
`a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain-empty before and after.
`~/BoardSmithGames/one-two-punch` pinned at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`; do NOT
assert porcelain-empty there. All runs against `cp -R` copies. Harness proven in Phases 171 and 172 —
reuse verbatim.

---

## Validation Sign-Off

- [ ] Wave 1 gate passed: adoption changes computed scope on BOTH reference games
- [ ] All tasks have an automated verify command or a live-proof entry
- [ ] No task claims VERIFY-01/07/08 on `.toContain()` evidence alone
- [ ] All five `SKILL_NAMES` sites updated together
- [ ] `173-PROOF.md` exists with all four live proofs, verbatim output, and a "what is still unproven" section
- [ ] Both reference-game originals confirmed unchanged after every proof run
- [ ] Full suite green; zero lint errors in `src/cli/`
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
