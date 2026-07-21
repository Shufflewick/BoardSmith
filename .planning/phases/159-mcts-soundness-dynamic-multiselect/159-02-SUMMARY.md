---
requirements-completed: [AI-01, PROC-01]
---

# Plan 159-02 Summary — buildPickMetadata resolves function-valued multiSelect (AI-01 panel half / C.2)

**Plan:** 159-02 (execute — panel metadata resolution for dynamic `multiSelect`)
**Completed:** 2026-07-20
**Result:** PASS — both `buildPickMetadata` omission sites (choice, elements) now resolve
function-valued `multiSelect` through the SAME `resolveMultiSelect` helper Plan 01 wired into
MCTS enumeration. Delivers feature C.2 (panel-completable dynamic multi-pick, no single-select
fallback / "requires >=2, got 1" dead end). PROC-01's RED-before-GREEN gate satisfied; parity +
panel-completion proven; full suite at baseline.

## What was done

1. **Task 1 (RED):** Added `src/engine/element/action-metadata.test.ts` — an in-file
   `MultiSelectMetadataGame` registering five actions (choice + elements, each with a
   function-resolving-to-concrete-config case, plus a function-returning-`undefined` case and two
   static negative controls). Called `buildPickMetadata(game, player, selection)` directly on the
   registered `ActionDefinition.selections[0]`. Ran against CURRENT, unfixed source: the two
   function-resolving-to-concrete cases FAILED (metadata omitted `multiSelect`); the
   undefined-resolution and both static-control cases already PASSED (see verbatim output below).
   No production source touched in this commit.
2. **Task 2 (GREEN):** Imported `resolveMultiSelect` into `action-metadata.ts` and replaced BOTH
   hand-rolled `typeof multiSelect !== 'function'` omission blocks (choice `:148-158`, elements
   `:202-212`) with a single `resolveMultiSelect(selection, ctx)` call using the existing
   `{ game, player, args }` ctx already built at `:106`. A defined result sets `base.multiSelect`;
   `undefined` emits nothing. This subsumed the static path too (Plan 01's `resolveMultiSelect`
   already normalizes numbers and `{min,max}` objects via `parseMultiSelect`), so the hand-rolled
   number/object branching was deleted entirely — one call site per selection type instead of a
   3-way conditional. All 5 tests pass.
3. **Task 3 (panel-completion + parity):** Added three more cases to the same test file:
   - Two parity assertions (choice + elements) proving `buildPickMetadata(...).multiSelect` and
     `resolveMultiSelect(selection, ctx)` return byte-identical results for the same
     selection/state — the C.2 single-source-of-truth guarantee (CONTEXT D-01): the panel and
     MCTS enumeration cannot disagree because they now call the exact same function.
   - A controller-seam test: built a real `pickMeta` via `buildPickMetadata`, wrapped it into an
     `ActionMetadata` shape, fed it to a real `useActionController(...)` instance, called
     `controller.start('pickElements')` then `controller.toggleMultiSelect('items', 1)`, and
     asserted `controller.multiSelectDraft.value` recorded the toggle. This proves the existing
     checkbox-widget seam (`ActionPanel.vue:901`, `useActionController.ts:1785`
     `resolveMultiSelectConfig`) engages natively off the resolved metadata — no
     `ActionPanel.vue` / `useActionController.ts` source change was made or needed. Ran the full
     suite: no regression.

## resolveMultiSelect consumption (unchanged from Plan 01's contract)

```ts
// action-metadata.ts, both the choice and elements switch-cases:
const resolved = resolveMultiSelect(selection, ctx); // ctx = { game, player, args } at :106
if (resolved !== undefined) {
  base.multiSelect = resolved;
}
```

No new helper was written — Plan 01's `src/engine/utils/resolve-multiselect.ts` was imported
unchanged, per the plan's explicit "consume it, do not reimplement" instruction.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/engine/element/action-metadata.test.ts (5 tests | 2 failed) 8ms
   × buildPickMetadata: function-valued multiSelect (AI-01 / C.2) > resolves a function-valued
     multiSelect to a concrete {min,max} on a choice selection
     → expected undefined to deeply equal { min: 2, max: 2 }
   × buildPickMetadata: function-valued multiSelect (AI-01 / C.2) > resolves a function-valued
     multiSelect to a concrete {min,max} on an elements selection
     → expected undefined to deeply equal { min: 1, max: 3 }

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```
The 3 passing cases (function-returning-`undefined`, static-number, static-`{min,max}`) are
negative controls, proving the omission is specific to the function-resolves-to-concrete-config
case, not a general break in `buildPickMetadata`.

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/engine/element/action-metadata.test.ts (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Task 3 final state (panel-completion + parity)

```
 ✓ src/engine/element/action-metadata.test.ts (8 tests) 9ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## Verification

- `npx vitest run src/engine/element/action-metadata.test.ts` — 8/8 pass.
- `npm test` — **198 files / 2839 tests pass**, at/above the pre-phase baseline (197/2831 after
  159-01 + 159-03). The delta is exactly this plan's net-new coverage (+1 file, +8 tests); nothing
  regressed.
- `npx tsc --noEmit` — no new type errors in the touched files.
- Grep gate: `grep -v '^\s*\*' src/engine/element/action-metadata.ts | grep -c 'resolveMultiSelect'`
  → 3 (≥2 required — one import line + two call sites).
- Grep gate: `grep -c "typeof choiceSel.multiSelect !== 'function'" src/engine/element/action-metadata.ts`
  → 0 (the omitting guard is gone).

## Deviations from Plan

None — plan executed exactly as written. Task 3's controller-completion case used
`useActionController` end-to-end (per the plan's "smallest controller seam that reads
`metadata.multiSelect`" instruction) rather than reaching into the unexported
`resolveMultiSelectConfig` internal directly, since that function is not part of the composable's
public return surface — driving it through the real `toggleMultiSelect()` public API exercises the
identical code path and is a stronger proof (it's the actual seam the checkbox widget calls).

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigation specified in its own threat model (T-159-04, T-159-05);
no new, unlisted security-relevant surface was introduced. `resolve-multiselect.ts`,
`enumerate-moves.ts`, `mcts-bot.ts`, and `snapshot.ts` (Plan 01/03's territory) were not touched.

## Self-Check: PASSED

- `src/engine/element/action-metadata.ts` (rewired, both sites) — FOUND
- `src/engine/element/action-metadata.test.ts` — FOUND
- Commit `65954c57` (RED) — FOUND in `git log`
- Commit `8686c2e6` (GREEN) — FOUND in `git log`
- Commit `753e57cc` (panel-completion + parity) — FOUND in `git log`
