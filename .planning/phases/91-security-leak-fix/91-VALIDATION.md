---
phase: 91
slug: security-leak-fix
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-20
---

# Phase 91 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/engine/element/` |
| **Full suite command** | `npm test` (vitest run) |
| **Estimated runtime** | ~30–60 seconds full; ~5s for the element dir |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/engine/element/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 91-01-01 | 01 | 0 | SEC-01 | leak/$images.face | A hidden/owner-only/count-only element's serialized `$images` contains no `face` (only `back`); `$image` absent | unit | `npx vitest run src/engine/element/image-leak.test.ts` | ❌ W0 | ⬜ pending |
| 91-01-02 | 01 | 1 | SEC-01 | leak/$images.face | `redactHiddenElementAttrs` keeps `$images.back`, drops `$images.face` and `$image` | unit | `npx vitest run src/engine/element/image-leak.test.ts` | ❌ W0 | ⬜ pending |
| 91-01-03 | 01 | 1 | SEC-02 | $-whitelist over-broad | Only the 18 allowlisted layout `$`-keys survive on a hidden element; unknown `$`-keys dropped (fail-safe) | unit | `npx vitest run src/engine/element/image-leak.test.ts` | ❌ W0 | ⬜ pending |
| 91-01-04 | 01 | 1 | SEC-01, SEC-02 | leak via real game | Go Fish: a player's `toJSONForPlayer` view exposes no `face` URL for opponent-hand or pond cards | unit | `npx vitest run` (Go Fish / engine visibility suite) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/engine/element/image-leak.test.ts` — new test file proving redaction for SEC-01/SEC-02 (modeled on `deck-hand-visibility.test.ts` scaffold)

*Existing infrastructure (vitest) covers everything else — no framework install needed.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.* (Serialization redaction is fully unit-testable; no browser/manual step required for this phase.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-20
