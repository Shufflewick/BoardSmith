# Roadmap — BoardSmith

## Milestones

- ✅ **v4.0 UI Redesign (Slate)** — Phases 97–103 (shipped 2026-06-23) — full detail: [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md)
- ✅ **v4.1 Tutorial Primitives (Checkers)** — Phases 104–111 (shipped 2026-06-30) — full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md)
- ✅ **v4.2 Tutorial Primitives — Go Fish & Docs** — Phases 112–115 (shipped 2026-06-30) — full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md)
- ✅ **v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools** — Phases 116–122 (shipped 2026-07-01) — full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md)

### Shipped milestones

<details>
<summary>✅ v4.0 UI Redesign (Slate) — Phases 97–103 — SHIPPED 2026-06-23</summary>

48/48 requirements · BoardSmith 1245 tests · 8 games + MERC green. See [`milestones/v4.0-ROADMAP.md`](milestones/v4.0-ROADMAP.md).

</details>

<details>
<summary>✅ v4.1 Tutorial Primitives (Checkers) — Phases 104–111 — SHIPPED 2026-06-30</summary>

- [x] Phase 104: Tutorial Lifecycle & Action Gating (4/4) — 2026-06-25
- [x] Phase 105: Annotation Overlay (UI Parity) (5/5) — 2026-06-25
- [x] Phase 106: Predicate Triggers & CI-Verifiable Authoring (5/5) — 2026-06-26
- [x] Phase 107: AI-Assisted Teaching (4/4) — 2026-06-26
- [x] Phase 108: Lightweight Action Help (3/3) — 2026-06-27
- [x] Phase 109: Checkers Tutorial Content (4/4) — 2026-06-29
- [x] Phase 110: Demonstration & Refinement (5/5) — 2026-06-29
- [x] Phase 111: Host-Gated Teaching Lockout (5/5) — 2026-06-30

16/16 requirements (TUT-01..05, AI-01..03, HELP-01/02, CHK-01..04, DEMO-01, LOCK-01) · BoardSmith 1706 tests + checkers 38 green · audit passed (`milestones/v4.1-MILESTONE-AUDIT.md`). Full detail: [`milestones/v4.1-ROADMAP.md`](milestones/v4.1-ROADMAP.md).

</details>
<details>
<summary>✅ v4.2 Tutorial Primitives — Go Fish & Docs — Phases 112–115 — SHIPPED 2026-06-30</summary>

- [x] Phase 112: Go-Fish Tutorial Content (4/4) — 2026-06-30
- [x] Phase 113: Go-Fish AI Teaching (3/3) — 2026-06-30
- [x] Phase 114: Go-Fish Action Help & Host Lockout (3/3) — 2026-06-30
- [x] Phase 115: Developer Documentation (2/2) — 2026-06-30

14/14 requirements (GFT-01..06, GFAI-01/02, GFHELP-01, GFLOCK-01, DOC-01..04) · go-fish 78 + BoardSmith 1708 tests green · audit passed (`milestones/v4.2-MILESTONE-AUDIT.md`). Proved the v4.1 tutorial substrate generalizes to a hidden-information card game + shipped the developer authoring guide. Full detail: [`milestones/v4.2-ROADMAP.md`](milestones/v4.2-ROADMAP.md).

</details>

<details>
<summary>✅ v4.3 Agent-Ready Engine — Introspection, Test Ergonomics & Devtools — Phases 116–122 — SHIPPED 2026-07-01</summary>

- [x] Phase 116: Verification & API Design (3/3) — 2026-06-30
- [x] Phase 117: Action-Space Introspection (4/4) — 2026-06-30
- [x] Phase 118: Test Ergonomics (4/4) — 2026-06-30
- [x] Phase 119: Dev-Host Devtools Bridge (4/4) — 2026-07-01
- [x] Phase 120: Authoring Pit-of-Success Guards (5/5) — 2026-07-01
- [x] Phase 121: Game & MERC Migration (3/3) — 2026-07-01
- [x] Phase 122: Documentation (4/4) — 2026-07-01

27/27 requirements (DSGN-01..03, INTRO-01..05+F1, TEST-01..05, DEV-01..04, PIT-01..04, MIG-01/02, DOC-01..04) · BoardSmith 1873 tests + all 7 games + MERC 738 green · audit passed (`milestones/v4.3-MILESTONE-AUDIT.md`). Agent-drivable engine: serializable action-space introspection, self-explaining test ergonomics, dev-host devtools bridge (browser-proven), fail-fast authoring guards, full game+MERC migration. Full detail: [`milestones/v4.3-ROADMAP.md`](milestones/v4.3-ROADMAP.md).

</details>
