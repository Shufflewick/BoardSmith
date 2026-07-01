---
phase: 119
slug: dev-host-devtools-bridge
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-30
---

# Phase 119 — Validation Strategy

> Derived from 119-RESEARCH.md "## Validation Architecture". Devtools instrumentation: unit-test the data-attr parity, the CustomEvent, and the bridge message; browser-prove the DEV-04 agent loop (the real acceptance gate). Design-doc corrections from research are authoritative.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run** | `npx vitest run src/ui/composables/useActionController.devtools.test.ts src/ui/composables/anchorAttrs.test.ts` |
| **Full suite** | `npx vitest run` |
| **Browser proof** | Chrome extension against `npx boardsmith dev` (:5173) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/ui/composables/ src/ui/components/`
- **After every plan wave:** `npx vitest run`
- **Phase gate:** full suite green + DEV-04 browser proof confirmed (custom UI + AutoUI, success + failure)

---

## Per-Requirement Verification Map

| Req | Behavior | Type | Command / Method | File (W0=new) |
|-----|----------|------|------------------|------|
| DEV-01 | `data-bs-el-id` present in all 4 AutoUI renderers' DOM (via anchorAttrs, NOT inline literals) + `data-element-id` alias kept | unit (mount) | `npx vitest run src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts` | ❌ W0 |
| DEV-01 | single-source guard still passes (no inline data-bs-el-* literals) | unit (static) | `npx vitest run src/ui/composables/anchorAttrs.test.ts` | ✅ exists |
| DEV-02 | GameShell posts `boardsmith:devtools-state-update` to window.parent on reactive change (dev only) | unit | `npx vitest run src/ui/components/GameShell.devtools.test.ts` | ❌ W0 |
| DEV-02 | DevHost receiver caches snapshot + exposes `window.__BOARDSMITH_DEVTOOLS` read methods | unit / browser | receiver logic unit-tested; end-to-end in DEV-04 | ❌ W0 |
| DEV-03 | `boardsmith:action-resolved` fires (success:true) on execute() success path | unit | `npx vitest run src/ui/composables/useActionController.devtools.test.ts` | ❌ W0 |
| DEV-03 | fires (success:false, error) on execute() failure | unit | same | ❌ W0 |
| DEV-03 | fires on selection-step completion path | unit | same | ❌ W0 |
| DEV-04 | DISCOVER→SELECT→DRIVE→CONFIRM loop, custom UI (go-fish) + AutoUI; success + failure both observed | browser-only | manual (Chrome extension) — acceptance gate | N/A |

---

## Design-Doc Corrections (research-authoritative — planner MUST honor)

1. **DEV-01 already implemented.** All four AutoUI renderers emit `data-bs-el-id` via `v-bind="selectableAttrs"` → `useSelectable.attrs` → `anchorAttrs(identity())`. The design doc's suggested inline `:data-bs-el-id` additions would BREAK the single-source guard at `anchorAttrs.test.ts:174`. DEV-01 deliverable = a new DOM-mount parity test, NOT renderer code changes.
2. **Dev guard is `import.meta.env.DEV`** (GameShell.vue:174 pattern), NOT `__BOARDSMITH_DEV__` (declared but never set as a Vite define).
3. **DEV-03: one existing increment site (1505, selection-step).** execute() uses `isExecuting` toggle. Add NEW CustomEvent dispatches at execute()'s two send branches (~1005, ~1069) AND at 1505. Capture `currentAction.value` BEFORE it's nulled at 1492.
4. **`success===false` proof** needs a direct `execute()` with invalid args from the iframe context — clicking a non-valid element silently no-ops (useSelectable.ts:48 guard).

---

## Cross-Layer Boundary Integration Tests (CLAUDE.md)

| Boundary | Test | Covers |
|----------|------|--------|
| renderer → anchorAttrs (ui) | renderers.devtools-attrs.test.ts | DEV-01 data-bs-el-id parity |
| useActionController → window event (ui) | useActionController.devtools.test.ts | DEV-03 CustomEvent dispatch |
| GameShell (iframe) → DevHost (outer) postMessage | GameShell.devtools.test.ts + DEV-04 browser proof | DEV-02 bridge |
| full agent loop across frames | DEV-04 browser proof (custom UI + AutoUI) | DEV-04 |

---

## Wave 0 Requirements (new test files)

- [ ] `src/ui/components/auto-ui/renderers/renderers.devtools-attrs.test.ts` — DEV-01 parity (4 renderers)
- [ ] `src/ui/composables/useActionController.devtools.test.ts` — DEV-03 (3 dispatch paths)
- [ ] `src/ui/components/GameShell.devtools.test.ts` — DEV-02 sender (postMessage on change)

Existing anchorAttrs.test.ts single-source guard must stay green (do NOT add inline literals).

---

## Manual-Only Verifications (DEV-04 acceptance gate)

DEV-04 cannot run in jsdom (needs a real dev process, real cross-frame iframe, full action pipeline). Browser-prove via Chrome extension:

**Custom UI (go-fish):** `cd ~/BoardSmithGames/go-fish && npx boardsmith dev` (:5173) → open in Chrome → confirm `window.__BOARDSMITH_DEVTOOLS` present, `getAvailableActions()`/`getBoardInteractionState().validElements` non-empty on your turn → dispatch click on a valid `[data-bs-el-id]` → observe `boardsmith:action-resolved` `success:true` → force an invalid `execute()` → observe `success:false` + error → **kill dev server**.

**AutoUI:** same, after switching the dev-chrome UI dropdown to "Auto UI"; confirm `[data-bs-el-id]` selectors still resolve and the loop works.

Both must show success AND failure signals. **Kill any dev server started (project hard rule).**
