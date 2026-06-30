---
phase: 115
slug: developer-documentation
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-30
---

# Phase 115 — Validation Strategy

> Documentation phase: validation = factual-accuracy + coverage checks (a doc-verifier pass), not unit tests. No code changes (BoardSmith suite stays green).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual/agent verification (doc-verifier) + grep coverage checks; vitest only as a no-regression guard |
| **Config file** | n/a (markdown doc) |
| **Quick run command** | `grep` coverage checks against `docs/teaching-and-tutorials.md` |
| **Full suite command** | BoardSmith `npm test` (no-regression, expect green/no src changes) |
| **Estimated runtime** | seconds (grep) + ~90s (BoardSmith suite, unchanged) |

---

## Sampling Rate

- **After authoring:** run the coverage grep + the doc-verifier accuracy pass.
- **Before completion:** every cited symbol/snippet verified against live source; README links the guide; BoardSmith suite green.

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Check | Type | Command/Method | Status |
|---------|------|-------------|-------|------|----------------|--------|
| 115-01-* | 01 | DOC-01 | guide covers TutorialDefinition, lifecycle (start/advance/skip/exit), gating, overlay targets (cell/piece/card/panel/action) | coverage | grep concepts in the guide | ⬜ |
| 115-01-* | 01 | DOC-02 | predicate triggers + `simulateTutorial`/`assertTutorialCompletes` + green→red demo | coverage | grep | ⬜ |
| 115-01-* | 01 | DOC-03 | hint + narrated demo + heatmap (board-only noted) + `teachingDisabled` lockout + `.help()` | coverage | grep | ⬜ |
| 115-01-* | 01 | DOC-04 | checkers (notation/squares) + go-fish (name/cards) worked examples side-by-side + anchorAttrs parity | coverage | grep | ⬜ |
| 115-02-* | 02 | DOC-01..04 | every cited API/type/method/flag and code excerpt exists in the live source | accuracy | doc-verifier agent | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] Create `docs/teaching-and-tutorials.md`.
- [ ] Add a link to it in `docs/README.md`.

*No test framework needed — verification is accuracy + coverage.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Code excerpts compile/match the real API | DOC-01..04 | Markdown excerpts aren't executed | doc-verifier reads the guide + cited source files, reports per-claim PASS/MISMATCH; fix any mismatch. |

---

## Validation Sign-Off

- [ ] Guide addresses DOC-01, DOC-02, DOC-03, DOC-04 (coverage grep passes)
- [ ] Every cited symbol/snippet verified against live source (doc-verifier)
- [ ] `docs/README.md` links the new guide
- [ ] BoardSmith `npm test` green (no src changes)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
