---
phase: 148
slug: distribution-installer-bs-generate-ai
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 148 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes) |
| **Quick run command** | `npx vitest run src/cli/commands/install-claude-command.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/commands/install-claude-command.test.ts` (+ bs/ suites if skill files edited: `npx vitest run src/cli/slash-command/bs/`)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 148-* | * | * | DIST-01 | — | N/A | REAL install-to-temp-dir unit test | `npx vitest run src/cli/commands/install-claude-command.test.ts -t "DIST-01"` | ❌ W0 | ⬜ pending |
| 148-* | * | * | DIST-02 | — | N/A | REAL install-to-temp-dir unit test | `npx vitest run src/cli/commands/install-claude-command.test.ts -t "DIST-02"` | ❌ W0 | ⬜ pending |

Real test asserts (Agent Skills format per research): all 5 `bs-*` skills install as `<name>/SKILL.md` with their bundled/shared reference tree (build/, ingest/, templates/, state-machine.md, aspects/) present at the depth the skills' reference paths point to (references RESOLVE to real files — the internal-consistency safety net); `.test.ts` files EXCLUDED; `design-game` command + template + instructions.md ABSENT with ZERO residual `design-game` references in installed set OR installer source; `generate-ai` absent, `bs-generate-ai` present; `interview-fallback.md`'s `aspects/` reference resolves to an installed file (the pre-existing depth bug fixed). Skill-file bs/ drift suites (ingest/build-chunk/status-tools/templates.test.ts) stay green after any reference-path edits.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/install-claude-command.test.ts` — REAL installer unit test (install to temp dir, assert layout + references resolve + design-game absent + rename)
- [ ] Test the FILE-COPY layer only — do NOT run `npm link` in the test (no global side-effects)
- [ ] No new npm dependencies (Node built-in `fs.cp` recursive/filter)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Installed skills actually invoke + resolve refs inside a live Claude Code | DIST-01/02 | Requires a running Claude Code instance | Phase 149 end-to-end dry-run installs then runs the pipeline |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
