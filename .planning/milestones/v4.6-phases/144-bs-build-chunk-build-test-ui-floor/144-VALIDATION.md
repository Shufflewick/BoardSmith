---
phase: 144
slug: bs-build-chunk-build-test-ui-floor
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 144 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` (+ scaffold tests if touched: `npx vitest run src/cli/commands/init.test.ts src/cli/lib/`)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 144-* | * | * | BUILD-05 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-05"` | ❌ W0 (extend) | ⬜ pending |
| 144-* | * | * | BUILD-06 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-06"` | ❌ W0 (extend) | ⬜ pending |
| 144-* | * | * | UIQ-01 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-01"` | ❌ W0 (extend) | ⬜ pending |
| 144-* | * | * | UIQ-02 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-02"` | ❌ W0 (extend) | ⬜ pending |
| 144-* | * | * | UIQ-03 | — | N/A | structural + REAL scaffold unit test (axe-core devDep + a11y harness file present in generated package.json/scaffold output) | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-03"` + scaffold test command | ❌ W0 (extend) | ⬜ pending |

Plus: REFERENCED_PATHS updated for build.md/test.md/design-ask.md; 145/146 forward-reference markers retained; scaffold-template unit test asserts axe-core in generated devDependencies and the example a11y test file in scaffold output.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `src/cli/slash-command/bs/build-chunk.test.ts` (BUILD-05/06, UIQ-01..03 describes)
- [ ] Scaffold unit test (extend existing init/project-scaffold tests) for axe-core devDep + a11y harness file
- [ ] axe-core is added ONLY to the generated-game template (project-scaffold.ts), NOT BoardSmith's own package.json

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full build/test step run on a real chunk | BUILD-05/06, UIQ-01..03 | LLM-executed skill | Phase 149 end-to-end dry-run |
| Example a11y test actually passes inside a freshly generated game | UIQ-03 | Requires generating a game + npm install | Executor generates a scratch game once during execution, runs its a11y test, deletes it (or Phase 149 covers it) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
