# Roadmap — BoardSmith

## Active Milestone

_None — v4.9 shipped 2026-08-01. Run `/gsd:new-milestone` to start the next._

## Shipped Milestones

- ✅ **v4.9 BS Skills Re-Verification** — Phases 170–180 incl. 177.1 (shipped 2026-08-01) — 12 phases, 25/25 requirements on real cited evidence, suite 4378 green. `/bs-verify-game` re-verifies a built game against its archived rulebook: full re-transcription staging, two-dimension classification, adjudication gate, impact map + bounded repair, ruling re-validation, derived-line dual-enumeration (CHECK-04, redesigned mid-milestone after the original was measured unanswerable), worked-example replay in both build and verify, and honest source-free degradation. **The milestone's defining lesson was reachability**: four requirements were closed against evidence produced by paths a user never takes — culminating in the discovery that `/bs-verify-game` itself was never installed. Phase 177.1 wired CHECK-04's closed design into the pipeline; Phase 179 wired the provenance write into verify's Close; Phase 180 installed the skill and ran it for real, finding 7 divergences no CLI-path proof could show. Full detail: [`milestones/v4.9-ROADMAP.md`](milestones/v4.9-ROADMAP.md) · [requirements](milestones/v4.9-REQUIREMENTS.md) · [audit](v4.9-MILESTONE-AUDIT.md)

- ✅ **v4.8 Battery Post-Mortem Fixes** — Phases 155–169 (shipped 2026-07-22) — 14/15 phases shipped; Phase 165 (D32 platform `[DRAWDROP]` logging) deferred-to-platform (proven absent from the library + all 5 game repos). Closed the 5-game build-battery post-mortem: D1–D31 library/dev-host/tooling/engine fixes, the two `bs-skills` defect fixes + the full autonomy rewrite (milestone playtest gates, batched questions, run-while-away, ≥50% context floor + sub-agent offload, loud completion, B.9 ledger reconciliation), the seed-to-state feasibility spike (+ thin `--seed` PoC), and the cross-repo de-workaround sweep across all 5 game repos (BSR-12 AI closed, BS-10 reclassified). Post-audit tech-debt pass also resolved the hidden-zone D24 game migration, v4.8-WR01 + v4.8-MCTS-UNDO. Library 3141 tests green; all 5 game repos green. Full detail: [`milestones/v4.8-ROADMAP.md`](milestones/v4.8-ROADMAP.md) · [requirements](milestones/v4.8-REQUIREMENTS.md) · [audit](milestones/v4.8-MILESTONE-AUDIT.md)
- ✅ **v4.7 Playtest Follow-Up Fixes** — Phases 152–154 (shipped 2026-07-06) — 5/5 requirements; closed DEF-A (asset completeness), DEF-C (dev-host reconnect turn-desync), and propagated DEF-B to MERC (738/7 green). Full detail: [`milestones/v4.7-ROADMAP.md`](milestones/v4.7-ROADMAP.md) · [requirements](milestones/v4.7-REQUIREMENTS.md) · [audit](milestones/v4.7-MILESTONE-AUDIT.md)
- ✅ **v4.6 BS Skills (Rulebook-Driven Game Building)** — Phases 140–151 (shipped 2026-07-05; reopened + re-closed same day for the human-playtest follow-up, Phases 150–151) — 36/36 requirements, human gate CLOSED, `v4.6.1` — full detail: [`milestones/v4.6-ROADMAP.md`](milestones/v4.6-ROADMAP.md) · [requirements](milestones/v4.6-REQUIREMENTS.md) · [audit](v4.6-MILESTONE-AUDIT.md)

_Prior milestones (v0.1–v4.5) archived under `.planning/milestones/`._
</content>
