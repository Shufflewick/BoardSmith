---
phase: 176
slug: stale-chunk-repair
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 176 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `176-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.0 (pre-existing) |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run src/cli/commands/verify-ruling-recheck.test.ts src/cli/commands/verify-repair.test.ts` |
| **Full suite command** | `npm test` (3826/3826 green at Phase 175's close) |
| **Estimated runtime** | quick ~5s · full suite ~3–5 min |

---

## Sampling Rate

- **After every task commit:** the relevant unit test file(s)
- **After every plan wave:** `npm test` — any new failure is this phase's own regression
- **Before `/gsd:verify-work`:** Full suite green **AND** `176-PROOF.md` recording the real
  subagent-dispatch proofs that cannot be expressed as deterministic assertions
- **Max feedback latency:** ~10 seconds for unit work

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| CHECK-01 | `parseRulings` extension exposes ruling body text **additively**, no existing caller broken, no second `Ruling (\d+)` regex | unit | `npx vitest run src/cli/commands/build-manifest.test.ts` | ✅ extend | ⬜ pending |
| CHECK-01 | Verdict enum frozen-array + derived-type + pinning test: `still-needed \| resolved-by-source \| contradicted \| undetermined` | unit | `npx vitest run src/cli/commands/verify-ruling-recheck.test.ts` | ❌ W0 | ⬜ pending |
| CHECK-01 | Supersession: only explicit verbs parsed, BOTH directions handled, unparseable chains reported not assumed | unit | `... -t "supersession"` | ❌ W0 | ⬜ pending |
| CHECK-01 | `undetermined` is reachable and never collapsed into another verdict | unit | `... -t "undetermined"` | ❌ W0 | ⬜ pending |
| CHECK-01 · SC-3 | `seven`'s Ruling 1 (source-absence) verdicts **`still-needed`** with recorded reasoning, against a real fresh transcription | integration (real dispatch) | recorded in `176-PROOF.md` | ❌ proof-only | ⬜ pending |
| CHECK-02 | Stale-chunk → staged-slice-path resolution correct under real m:n pairing (`seven` 3 live → 6 staged) | unit | `npx vitest run src/cli/commands/verify-repair.test.ts` | ❌ W0 | ⬜ pending |
| CHECK-02 | Lens templates read VERBATIM from `build/audit.md` — **no forked copy exists anywhere** | unit (drift guard, mirroring 174/175's lexicon pins) | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ✅ extend | ⬜ pending |
| CHECK-02 | `build/repair.md`'s loop is cited, never forked | unit (drift guard) | same file | ✅ extend | ⬜ pending |
| CHECK-02 | **Post-repair `computeRepairGate` RE-INVOCATION** reflects code changed during repair — never the pre-repair snapshot (Pitfall 1) | unit | `npx vitest run src/cli/commands/verify-impact.test.ts` | ✅ extend | ⬜ pending |
| decision 17 | A verify episode opens a fresh 3-round budget; rounds append alongside build rounds **without renumbering**, and the episode boundary is legible in CHUNK.md | unit | `... -t "episode"` | ❌ W0 | ⬜ pending |
| decision 10 | Missing fresh transcription reports **scope-limited**, never silently falls back to live slices | unit | `... -t "scope-limited"` | ❌ W0 | ⬜ pending |
| decision 11 | `## Interpretation` never reachable by a lens dispatch | source assertion + drift guard | `verify.test.ts` | ✅ extend | ⬜ pending |
| CHECK-02 | Real lens dispatch against a real stale chunk + real staged fixture surfaces real findings | integration (real dispatch) | recorded in `176-PROOF.md` | ❌ proof-only | ⬜ pending |
| Cross-cutting | No self-contradicting boundary statement left in `verify-game.md` (lines 15 and 109 become false) | drift pin, old text asserted ABSENT | `verify.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/verify-ruling-recheck.test.ts` — new; CHECK-01's enumeration/recording mechanics.
- [ ] `src/cli/commands/verify-repair.test.ts` — new; CHECK-02's slice-resolution and episode mechanics.
- [ ] `build-manifest.test.ts` — extend for the widened `parseRulings` body-text output.
- [ ] `verify.test.ts` — extend with drift guards proving `build/audit.md` and `build/repair.md` are
      never forked, and with the boundary-statement absence pins.
- [ ] `verify-impact.test.ts` — extend for post-repair gate re-invocation.
- [x] **Fresh staged transcriptions** — ALREADY SATISFIED (decision 19). Full-coverage staged slices for
      both games are committed at
      `.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/slices/`.
      No re-transcription in scope. Do not rely on the uncommitted 323MB scratch copy.
- [ ] Framework install: none — Vitest already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| SC-3 — Ruling 1's verdict | CHECK-01 | The verdict IS a subagent judgment; no deterministic assertion can stand in for it | Real dispatch against the committed fresh transcription. Expect `still-needed`. Record the REASONING, not just the label — two wrong answers (`contradicted`, `resolved-by-source`) are both plausible-looking, and `resolved` would invite deleting `seven`'s only scoring authority. |
| Full ruling corpus | CHECK-01 | ~62 real rulings, judged | Re-validate ALL rulings across both games; record full measured counts per verdict (decision 14). A verdict distribution is the evidence the classifier neither over- nor under-flags; a subset cannot show that. |
| Real lens run | CHECK-02 | Fresh-context subagent dispatches | Run a REAL measured SUBSET of the 12 stale chunks (3 lenses × 12 = 36 dispatches is costly). **State coverage explicitly** — exactly which chunks were audited and which were not. An unstated sample reads as full coverage (decision 15). |
| Round-bound interaction | decision 17 | Depends on real chunks with existing round history | 4 of the 12 stale chunks already carry 3 build-era audit rounds (`best-seven-selection`, `table-and-draw`, `block`, `jab`). Confirm on real files that a verify episode opens a fresh budget and appends without renumbering. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s for unit work
- [ ] `176-PROOF.md` records SC-3's reasoning, full ruling counts, and explicit lens coverage
- [ ] Findings reported, NOT fixed on reference-game content (decision 16)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
