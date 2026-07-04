---
phase: 134
slug: ui-session-interaction-guardrails
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 134 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (node default; per-file `// @vitest-environment jsdom` for DOM specs) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | Targeted: `npx vitest run src/ui/composables/useActionController.test.ts src/ui/composables/useDragDrop.test.ts src/ui/components/GameShell.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~120 seconds (full suite, 2183+ tests baseline) |

---

## Sampling Rate

- **After every task commit:** targeted test file(s) for the fix
- **After every plan wave:** `npm test` (full suite; 168 files / 2183+ green)
- **Phase gate:** full suite green + manual browser verification per CLAUDE.md (boardsmith dev + hex or go-fish; toast, drag gating; kill the dev server after)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | UIX-01 | F17 | `start()` returns checkable result; GameShell toasts on `lastError` | unit + component | `npx vitest run src/ui/composables/useActionController.test.ts -t "start"` + `GameShell.test.ts -t "action failure toast"` | ✅ add cases | ⬜ pending |
| TBD | TBD | TBD | UIX-02 | F18 | `fill()` rejects scalar for multiSelect with actionable error | unit | `npx vitest run src/ui/composables/useActionController.selections.test.ts -t "multiSelect"` | ✅ add case | ⬜ pending |
| TBD | TBD | TBD | UIX-03 | F19 | dev console.error on 0×0 board post-state-arrival (not on startup) | unit/component | `GameShell.test.ts` or `useAutoZoom.test.ts` per placement | ✅ add case | ⬜ pending |
| TBD | TBD | TBD | SESS-01 | F29 | `session.runner` read-only facade; `.performAction` unreachable (runtime + `@ts-expect-error`) | unit + type | session test file (confirm exact) | ⚠️ confirm | ⬜ pending |
| TBD | TBD | TBD | UIX-04 | F30 | `dragProps()` inert when `when` false | unit | `npx vitest run src/ui/composables/useDragDrop.test.ts -t "when"` | ✅ add case | ⬜ pending |
| TBD | TBD | TBD | UIX-05 | F31 | hooks accumulate in order; unregister fn | unit | flip `useActionController.test.ts:521` replace-semantics test to accumulation (the RED test) | ✅ flip existing | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | `134-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `134-FINDINGS-VERIFICATION.md` — PROC-01 verdicts BEFORE fixes
- [ ] Confirm exact session test file for SESS-01 facade tests (game-session.test.ts or nearest, e.g. restore-snapshot-authoritative.test.ts)

No new test files or framework installs needed otherwise.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Toast renders + drag gating works live | UIX-01, UIX-04 | Browser behavior per CLAUDE.md verification rule | `cd ~/BoardSmithGames/go-fish && npx boardsmith dev`; trigger an unavailable action from a custom UI; verify toast; verify gated drag inert. Kill the server after. |
| PROC-01 verdict quality | PROC-01 | Judgment call | Review `134-FINDINGS-VERIFICATION.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
