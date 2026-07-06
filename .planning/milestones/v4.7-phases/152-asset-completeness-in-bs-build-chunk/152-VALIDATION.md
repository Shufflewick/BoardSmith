---
phase: 152
slug: asset-completeness-in-bs-build-chunk
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 152 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (this repo's own suite; generated projects also use Vitest per `generatePackageJson()`) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60–120 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed test file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green + real-browser Go Fish regeneration proof (Success Criterion 2)
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 152-AssetImage-gen | TBD | 1 | ASSET-01 | — | N/A | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts -t AssetImage` | ❌ W0 | ⬜ pending |
| 152-AssetImage-onerror | TBD | 1 | ASSET-01 | — | N/A | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts -t "onerror"` | ❌ W0 | ⬜ pending |
| 152-autoui-cardrenderer | TBD | 1 | ASSET-01 | — | N/A | unit | `npx vitest run src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` (or new render test) | ❌ W0 | ⬜ pending |
| 152-autoui-piecerenderer | TBD | 1 | ASSET-01 | — | N/A | unit | `npx vitest run <PieceRenderer render/fallback test>` | ❌ W0 | ⬜ pending |
| 152-build-prose | TBD | 1 | ASSET-01 | — | N/A | skill-guidance | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "bare.*img|AssetImage"` | ❌ W0 | ⬜ pending |
| 152-asset-scan | TBD | 1 | ASSET-02 | — | N/A | unit (fixture) | `npx vitest run src/cli/lib/asset-scan.test.ts` | ❌ W0 | ⬜ pending |
| 152-test-prose | TBD | 1 | ASSET-02 | — | N/A | skill-guidance | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "asset-reachability"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/lib/asset-scan.test.ts` — new file; passing fixture (asset wrapped in `AssetImage`) + failing fixture (bare `<img>` to nonexistent path) — covers ASSET-02
- [ ] `src/cli/lib/project-scaffold.test.ts` — extend with `AssetImage.vue` generation + fallback/overlay/onerror assertions — covers ASSET-01
- [ ] AutoUI renderer render/fallback test(s) — synthetic `load`/`error` events (jsdom-safe) against `CardRenderer.vue`/`PieceRenderer.vue` — covers ASSET-01 (AutoUI scope)
- [ ] `build-chunk.test.ts` — extend existing UIQ-02 + BUILD-06 describe blocks with new prose assertions
- [ ] No new test framework install — Vitest/`@vue/test-utils`/`axe-core` already wired in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Regenerated Go Fish renders every card with zero broken `<img>` (`naturalWidth > 0`) | ASSET-01 (SC-2) | jsdom cannot decode real images (Pitfall 4); needs a real browser | Regenerate Go Fish via the scaffold path, `npx boardsmith dev --no-open`, browser-check every card `naturalWidth > 0`, no hand-added asset set — per `149-HUMAN-UAT.md` script shape |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
