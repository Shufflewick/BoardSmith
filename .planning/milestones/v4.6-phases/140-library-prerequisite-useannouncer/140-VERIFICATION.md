---
phase: 140-library-prerequisite-useannouncer
verified: 2026-07-04T13:05:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 140: Library Prerequisite — useAnnouncer() Verification Report

**Phase Goal:** Game UIs can announce meaningful state changes to screen readers, so the per-chunk a11y floor can require it.
**Verified:** 2026-07-04T13:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A developer can import `useAnnouncer` from `boardsmith/ui` and call `announce(message)` from any game component | ✓ VERIFIED | `src/ui/index.ts:158-163` re-exports `useAnnouncer, provideAnnouncer, createAnnouncer, ANNOUNCER_KEY, type UseAnnouncerReturn` from `./composables/useAnnouncer.js`. `useAnnouncer()` in `src/ui/composables/useAnnouncer.ts:98-110` never returns undefined. |
| 2 | `announce()` writes to GameShell's existing `politeMessage`/`assertiveMessage` refs — no new live-region DOM node is created | ✓ VERIFIED | `GameShell.vue:360-361` calls `createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce })` with the pre-existing refs declared at lines 343-344 and pre-existing `emitAnnounce` at line 348. `grep -c "role=\"status\""` = 1, `grep -c "const politeMessage = ref"` = 1 (no duplication). `useAnnouncer.ts` contains zero `ref('')` calls (grep confirms 0) — it never creates its own refs. |
| 3 | Two consecutive identical `announce()` calls pass the target ref through `''` so screen readers re-announce the duplicate | ✓ VERIFIED | `useAnnouncer.ts:74-77`: `target.value = ''` synchronous clear, then `nextTick().then(() => target.value = message)`. Confirmed unconditional (locked decision A2), test `useAnnouncer.test.ts` covers this (7 tests passing). |
| 4 | `useAnnouncer()` called with no GameShell provider returns a usable no-op `{ announce }` and warns exactly once in dev mode | ✓ VERIFIED | `useAnnouncer.ts:98-110`: `inject(ANNOUNCER_KEY, undefined)` falls back to `devWarn('useAnnouncer-no-provider', ...)` + `{ announce: () => {} }`. `devWarn` (reused utility) dedups by key. Covered by unit test suite. |
| 5 | A custom-UI descendant and an AutoUI descendant both receive the same injected announcer (parity) | ✓ VERIFIED | `GameShell.announcer.test.ts` — "parity" describe block mounts two differently-named `defineComponent`s (`CustomUiDescendant`, `AutoUiDescendant`) under one `provideAnnouncer`/`createAnnouncer` host and proves both drive the same `politeMessage` ref and the same mock announcer instance. 3 tests passing. |
| 6 | Each `announce()` fires the existing `boardsmith-a11y` postMessage relay | ✓ VERIFIED | `useAnnouncer.ts:79` calls `emitAnnounce(level, message)` unconditionally on every announce; GameShell's `emitAnnounce` (line 348, unchanged) posts `{ source: 'boardsmith-a11y', type: 'announce', level, text }`. Relay test in `GameShell.announcer.test.ts` asserts exact postMessage shape for both polite and assertive calls. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/composables/useAnnouncer.ts` | `useAnnouncer/provideAnnouncer/createAnnouncer` + `ANNOUNCER_KEY` + `UseAnnouncerReturn`, `InjectionKey` | ✓ VERIFIED | All exports present and match target interface exactly (lines 29-110). |
| `src/ui/composables/useAnnouncer.test.ts` | Unit tests: no-provider warns once, clear-then-set duplicate, Symbol/function shape | ✓ VERIFIED | 7 tests, all passing (`npx vitest run` confirmed). |
| `src/ui/components/GameShell.announcer.test.ts` | jsdom mount test: custom-UI/AutoUI parity + postMessage relay | ✓ VERIFIED | 3 tests, all passing. Confirmed content matches described behavior. |
| `src/ui/index.ts` | Public export of `useAnnouncer` | ✓ VERIFIED | Export block present at lines 158-163. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `GameShell.vue` | `useAnnouncer.ts` | `createAnnouncer(...) + provideAnnouncer(announcer)` | ✓ WIRED | Lines 360-361, immediately after animation-events wiring, matching the described pattern. |
| `useAnnouncer.ts` | GameShell `politeMessage`/`assertiveMessage` refs | clear-then-set write-through | ✓ WIRED | `target.value = ''` at line 74, confirmed by grep and test coverage. |
| `useAnnouncer.ts` | boardsmith-a11y postMessage relay | `emitAnnounce(...)` called per announce | ✓ WIRED | Line 79, confirmed by relay test. |
| `src/ui/index.ts` | `useAnnouncer.ts` | barrel re-export | ✓ WIRED | `from './composables/useAnnouncer.js'` present. |

### Post-Fix Regression Check (commit 315bc390)

The fix commit routes four previously-direct `politeMessage.value = text; emitAnnounce(...)` write sites (turn-change, connection-status, opponent-turn, game-over, action-error watchers) through `announcer.announce(text, { assertive?: true })` instead. This is consistent with — and strengthens — the phase's intent: it eliminates a latent race where a direct synchronous ref write could be silently clobbered by the announcer's deferred (`nextTick`) commit from a concurrent `announce()` call, and it means ALL live-region writes (both GameShell's own built-in announcements and any game's custom announcements) now share one scheduling discipline. This does not modify `useAnnouncer.ts`, `GameShell.announcer.test.ts`, or the public API contract. `GameShell.live-region.test.ts` (14 tests, the pre-existing regression guard for these exact watchers) still passes unchanged. No regression to SC-1/SC-2/SC-3.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted test files (useAnnouncer, GameShell.announcer, GameShell.live-region) | `npx vitest run src/ui/composables/useAnnouncer.test.ts src/ui/components/GameShell.announcer.test.ts src/ui/components/GameShell.live-region.test.ts` | 3 files / 24 tests passed | ✓ PASS |
| Full suite (verifies no regression from fix commit 315bc390) | `npm test` | 178 files / 2386 tests passed | ✓ PASS |
| Acceptance-criteria greps (no new refs, no new live-region DOM node, no hand-rolled warn flag) | `grep -c "ref('')" useAnnouncer.ts` = 0; `grep -c "role=\"status\"" GameShell.vue` = 1; `grep -c "const politeMessage = ref" GameShell.vue` = 1 | matches plan's acceptance criteria exactly | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LIB-01 | 140-01-PLAN.md | Game UIs can announce game-state changes to screen readers via a `useAnnouncer()` composable exported from `boardsmith/ui` that writes to GameShell's existing live regions | ✓ SATISFIED | `useAnnouncer.ts` implemented, exported from `src/ui/index.ts`, wired into `GameShell.vue`, proven by parity + relay tests. REQUIREMENTS.md line 12 and line 85 both mark LIB-01 complete/Phase 140 — consistent with codebase evidence (not just document claim). |

No orphaned requirements found for Phase 140 in REQUIREMENTS.md.

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`HACK`/placeholder markers in any of the 5 files touched by this phase. No empty stub returns, no hardcoded empty data flowing to render.

### Human Verification Required

None required to gate phase completion. The plan's own `<verification>` section explicitly defers real assistive-technology confirmation (VoiceOver) as non-blocking manual verification for a later, integrated phase (since this phase ships a library primitive with no consuming game UI yet) — this is an intentional, documented scope boundary, not a gap.

### Gaps Summary

No gaps. All 6 derived observable truths (mapped 1:1 to the plan's `must_haves.truths` and the 3 ROADMAP success criteria) verified against actual code: the composable exists with the exact target interface, is wired into GameShell using GameShell's pre-existing refs/relay (zero new DOM nodes, confirmed by grep counts), is publicly exported, and custom-UI/AutoUI parity plus postMessage relay are proven by a real (non-mocked-away) component test. The post-execution fix commit (315bc390) that routes GameShell's own direct live-region writes through `announcer.announce()` does not touch the public contract or artifacts and does not regress `GameShell.live-region.test.ts`; full suite (2386 tests) is green.

---

*Verified: 2026-07-04T13:05:00Z*
*Verifier: Claude (gsd-verifier)*
