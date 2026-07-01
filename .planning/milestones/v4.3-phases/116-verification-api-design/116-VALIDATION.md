---
phase: 116
slug: verification-api-design
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-30
---

# Phase 116 — Validation Strategy

> Per-phase validation contract. Phase 116 is a **read-only verification + design-doc** phase — it produces no production code. Validation is therefore document-completeness + evidence-integrity + human approval, not automated test sampling.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (BoardSmith existing suite) — used only to confirm no regression, since this phase changes no `src/` code |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm test` (sanity only — no new tests expected) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | existing suite (~minutes) |

---

## Sampling Rate

- **After doc tasks:** No code changes → no test sampling required. Validate the doc's claims by re-reading the cited `file:line` evidence.
- **Before approval gate:** Confirm BoardSmith suite is still green (no `src/` mutation occurred) and every verdict's file:line citation resolves to real code.
- **Max feedback latency:** N/A (documentation phase)

---

## Per-Task Verification Map

| Task ID | Requirement | Verification Type | How Verified | Status |
|---------|-------------|-------------------|--------------|--------|
| Verdicts table | DSGN-01 | evidence-integrity | Every claim has confirmed/false/partial verdict + resolvable `file:line` + exists-vs-build note | ⬜ pending |
| API-design spec | DSGN-02 | doc-completeness | Names, signatures, return shapes, serialization, and owning-module recorded for every IN surface | ⬜ pending |
| Speculative scope | DSGN-03 | doc-completeness | Each Future Requirement marked IN or DEFERRED with rationale; promotions flagged for sign-off | ⬜ pending |
| No-regression | — | source assertion | `git diff src/` is empty (no production code changed); `npm test` still green | ⬜ pending |
| Approval gate | DSGN-02 | human | User explicitly approves `.planning/v4.3-API-DESIGN.md` before Phase 117 | ⬜ pending |

*Status: ⬜ pending · ✅ done*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test scaffolding — this phase writes a design document, not code.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Design-doc approval | DSGN-02 | The locked API surface is a human design decision; criterion explicitly requires approval before implementation | User reads `.planning/v4.3-API-DESIGN.md`, confirms the surface, signatures, ownership, and IN/DEFERRED dispositions are correct, then approves |
| Verdict spot-check | DSGN-01 | Evidence integrity is judgment, not a test | Reviewer opens 2–3 cited `file:line` references and confirms they support the recorded verdict |
