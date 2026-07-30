---
phase: 176
slug: stale-chunk-repair
status: complete
nyquist_compliant: true
wave_0_complete: true
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
| CHECK-01 | `parseRulings` extension exposes ruling body text **additively**, no existing caller broken, no second `Ruling (\d+)` regex | unit | `npx vitest run src/cli/commands/build-manifest.test.ts` | ✅ extend | ✅ green |
| CHECK-01 | Verdict enum frozen-array + derived-type + pinning test: `still-needed \| resolved-by-source \| contradicted \| undetermined` | unit | `npx vitest run src/cli/commands/verify-ruling-recheck.test.ts` | ✅ done | ✅ green |
| CHECK-01 | Supersession: only explicit verbs parsed, BOTH directions handled, unparseable chains reported not assumed | unit | `... -t "supersession"` | ✅ done | ✅ green |
| CHECK-01 | `undetermined` is reachable and never collapsed into another verdict | unit | `... -t "undetermined"` | ✅ done | ✅ green |
| CHECK-01 · SC-3 | `seven`'s Ruling 1 (source-absence) verdicts **`still-needed`** with recorded reasoning, against a real fresh transcription | integration (real dispatch) | recorded in `176-PROOF.md` | ✅ done | ✅ green — `176-PROOF.md` §3, bar MET |
| CHECK-02 | Stale-chunk → staged-slice-path resolution correct under real m:n pairing (`seven` 3 live → 6 staged) | unit | `npx vitest run src/cli/commands/verify-repair.test.ts` | ✅ done | ✅ green (25 tests, incl. 176-06's `pairIds`/append-placement regressions) |
| CHECK-02 | Lens templates read VERBATIM from `build/audit.md` — **no forked copy exists anywhere** | unit (drift guard, mirroring 174/175's lexicon pins) | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ✅ extend | ✅ green |
| CHECK-02 | `build/repair.md`'s loop is cited, never forked | unit (drift guard) | same file | ✅ extend | ✅ green |
| CHECK-02 | **Post-repair `computeRepairGate` RE-INVOCATION** reflects code changed during repair — never the pre-repair snapshot (Pitfall 1) | unit | `npx vitest run src/cli/commands/verify-impact.test.ts` | ✅ extend | ✅ green — mechanics-level flip proven on a real 2-commit git fixture; live real-game flip NOT observed (176-PROOF.md §5, honestly reported) |
| decision 17 | A verify episode opens a fresh 3-round budget; rounds append alongside build rounds **without renumbering**, and the episode boundary is legible in CHUNK.md | unit | `... -t "episode"` | ✅ done | ✅ green — AND proven live on real `best-seven-selection`/`block` CHUNK.md (176-PROOF.md §4) |
| decision 10 | Missing fresh transcription reports **scope-limited**, never silently falls back to live slices | unit | `... -t "scope-limited"` | ✅ done | ✅ green |
| decision 11 | `## Interpretation` never reachable by a lens dispatch | source assertion + drift guard | `verify.test.ts` | ✅ extend | ✅ green |
| CHECK-02 | Real lens dispatch against a real stale chunk + real staged fixture surfaces real findings | integration (real dispatch) | recorded in `176-PROOF.md` | ✅ done | ✅ green — `176-PROOF.md` §4, 2 of 12 chunks, 15 real findings, 4th lens NOT dispatched (stated limitation) |
| Cross-cutting | No self-contradicting boundary statement left in `verify-game.md` (lines 15 and 109 become false) | drift pin, old text asserted ABSENT | `verify.test.ts` | ✅ extend | ✅ green |

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

- [x] All tasks have automated verify or a declared Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s for unit work
- [x] `176-PROOF.md` records SC-3's reasoning, full ruling counts, and explicit lens coverage —
      §2-§3 (ruling counts + SC-3), §3b (constructed-lexicon verdict-distribution closure), §4
      (explicit AUDITED/NOT-AUDITED coverage table, 2 of 12)
- [x] Findings reported, NOT fixed on reference-game content (decision 16) — 15 real lens findings
      recorded in §4, zero reference-game fixes; two REAL bugs found were fixed in BoardSmith's own
      `src/cli/commands/` (not reference-game content — decision 16 does not apply to BoardSmith's
      own shipped tooling)
- [x] `nyquist_compliant: true` set in frontmatter

**Honest caveats carried forward (not hidden by this sign-off):** the 4th design-review lens was
NOT dispatched for either audited chunk (needs a live dev-server/browser harness); 10 of 12 stale
chunks were NOT audited (decision 15's stated cost-containment subset); `resolved-by-source`/
`contradicted` verdicts are proven only on constructed lexicon input, never real data; native
Task/Agent-tool dispatch remains unproven throughout this phase. See `176-PROOF.md`'s own
"What is still unproven" section for the complete, phase-wide list.

**Approval:** approved — phase closed with `176-PROOF.md`'s live evidence, honest caveats carried
forward rather than hidden (see above).
