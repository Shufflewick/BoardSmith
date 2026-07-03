# Phase 134: Findings Verification (PROC-01 Gate)

**Purpose:** Independent, evidence-based re-verification of all six in-scope Audit #3 findings
(F17/UIX-01, F18/UIX-02, F19/UIX-03, F29/SESS-01, F30/UIX-04, F31/UIX-05) BEFORE any fix is
planned or written, per the project's "Prove Before Fix" rule and the PROC-01 phase gate.

Phase 133 shipped between the original audit and this pass, so every citation below is a
freshly re-traced current file:line, not the audit's original line numbers (though in this
case they happened not to drift, confirmed by direct re-read).

This document is built in two passes: Task 1 covers the four composable findings (F17, F18,
F30, F31); Task 2 appends the remaining two (F19, F29 — board sizing and the runner facade).

---

## F17 / UIX-01 — Custom-UI action failures are silent (`lastError` has zero consumers; `start()` returns void)

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `grep -rn "lastError" src/ui --include="*.vue" --include="*.ts"` (excluding `useActionController.ts` itself and `*.test.ts`) returns exactly one hit: `src/ui/composables/useActionControllerTypes.ts:333`, which is only the `Ref<string | null>` type declaration on the composable's public return interface — not a consumer that surfaces the value to a user. No `.vue` component (GameShell.vue, ActionPanel.vue, or any custom-UI reference component) reads `lastError` anywhere in `src/ui`. This confirms the audit's central claim: a custom UI that calls `start()`/`execute()`/`fill()` and the call fails gets zero visible feedback — the failure is recorded in a ref nobody watches.
- `start()` (`src/ui/composables/useActionController.ts:1245-1263`) is declared `Promise<void>` and has exactly two synchronous failure branches that set `lastError` and `return` without any signal to the caller:
  - Line 1253: `if (!availableActions.value?.includes(actionName)) { lastError.value = ...; return; }`
  - Line 1260: `if (!meta) { lastError.value = ...; return; }`
  Both branches are unreachable from the caller's return value — `await start(...)` resolves to `undefined` in both the success and failure case.

**Conclusion:** The silent-failure defect is real and current. The fix scope from CONTEXT.md/RESEARCH.md (GameShell central `lastError` watch → toast; `start()` return-type widening to a checkable result; devWarn on the unavailable-action branch) directly targets this confirmed defect.

---

## F18 / UIX-02 — `fill()` accepts a scalar for a multiSelect pick with no guard

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `fill()` is declared at `src/ui/composables/useActionController.ts:1311` (`async function fill(selectionName: string, rawValue: unknown): Promise<ValidationResult>`).
- Its body (1311-1345) contains: a choice-object auto-unwrap block (1321-1332), then a `selection.repeat` branch (1335), then an `hasOnSelect`/`pendingOnServer` routing branch, then falls through to `validateSelection`. At no point does `fill()` call `resolveMultiSelectConfig()` — confirmed by `grep -n "resolveMultiSelectConfig" src/ui/composables/useActionController.ts`, whose only match inside the function body scope is the helper's own definition at line 1695 and its call site inside `toggleMultiSelect` (1727) — never inside `fill()`.
- The mirror-image guard already exists in the same file: `toggleMultiSelect()` (line 1716) calls `resolveMultiSelectConfig(selection)` at line 1727 and, if the selection is NOT a multiSelect config, fires a `devWarn` and returns (lines 1728-1734) — proving the codebase already has the symmetric guard pattern for the opposite direction (rejecting a non-multiSelect selection from `toggleMultiSelect`), but the multiSelect-into-`fill()` direction has no equivalent.

**Conclusion:** The asymmetry is real and current. `fill()` will happily forward a scalar into a multiSelect pick's `currentArgs`, letting it reach `isReady`/auto-execute with a type-mismatched payload. The fix scope (mirror `toggleMultiSelect`'s reverse guard inside `fill()`, reusing `resolveMultiSelectConfig()` verbatim, placed after the choice-object unwrap and before the `repeat`/`onSelect` routing) directly targets this confirmed defect.

---

## F30 / UIX-04 — `dragProps()` silently ignores the documented `when` option

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `dragProps` is declared at `src/ui/composables/useDragDrop.ts:212`: `const dragProps = (ref: ElementRef, options?: DragOptions): DragProps => ({ draggable: true, onDragstart: ..., onDragend: ... })`. The returned object literal (212-234) unconditionally sets `draggable: true` and only reads `options?.onDragStart`/`options?.onDragEnd` inside the handler bodies — `options.when` is never referenced anywhere in the function.
- `evalCondition()` — the helper that DOES implement `when` evaluation — is defined at `useDragDrop.ts:299` and is confirmed in use by two siblings in the same file: `dragClasses()` at line 308 (`'bs-draggable': evalCondition(options)`) and `drag()` at line 325 (`props: evalCondition(options) ? dragProps(ref, options) : {}`). `dragProps` itself is the one helper of the four (`dragProps`, `dropProps`, `dragClasses`, `drag`) documented to accept `DragOptions` that never calls `evalCondition`.

**Conclusion:** The silent-ignore defect is real and current. A developer calling `dragProps(ref, { when: canDrag(card) })` directly (the documented "Full API" pattern) gets a type-checking call that silently keeps the element draggable regardless of `when`. The fix scope (wire `evalCondition()` into `dragProps()`, mirroring `drag()`'s existing gate, widening the return type to `DragProps | { draggable: false }`) directly targets this confirmed defect.

---

## F31 / UIX-05 — `setBeforeAutoExecute()` silently replaces any previously registered hook

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `beforeAutoExecuteHook` is declared as a single-slot `ref` at `src/ui/composables/useActionController.ts:181`: `const beforeAutoExecuteHook = ref<(...) => void | Promise<void> | undefined>(initialBeforeAutoExecute);` — a single value, not a collection.
- `setBeforeAutoExecute()` is declared at line 938 and its body (line 941) is `beforeAutoExecuteHook.value = hook;` — a bare assignment that unconditionally overwrites whatever was previously registered, with no accumulation, no warning, and no returned unregister handle.
- The auto-execute watcher that consumes this single slot is at lines 856-857: `if (beforeAutoExecuteHook.value) { await beforeAutoExecuteHook.value(currentAction.value, buildServerArgs()); }` — only ever invokes the single currently-registered hook.
- `src/ui/composables/useActionController.test.ts:521` currently contains a test titled `'setBeforeAutoExecute replaces the previous hook (single-slot)'` that registers two hooks in sequence and asserts only the second one's side effect (`calls` array equals `['second']`) — this is the codebase's own committed proof that replace-semantics is the current, intentional (if undesirable) behavior, not a hypothetical.

**Conclusion:** The silent-replace defect is real and current. Two independently-correct component registrations (e.g. a board component and a player-stats panel, both needing pre-execute capture) will silently clobber each other with no error and a hard-to-attribute symptom (the earlier hook's side effect — e.g. animation start-position capture — simply stops firing). The fix scope (replace the single ref with an array, `setBeforeAutoExecute` pushes and returns an unregister closure, the watcher awaits all hooks sequentially in registration order, and `useActionController.test.ts:521`'s assertion is inverted per PROC-02) directly targets this confirmed defect.

---

## F19 / UIX-03 — Zoom container's `width: max-content` silently collapses responsive custom boards to 0×0

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `src/ui/components/GameShell.vue:2822` — `.game-shell__zoom-container { width: max-content; ... }`, confirmed via `grep -n "max-content" src/ui/components/GameShell.vue` (single match, exactly this line). This is the container the `#game-board` slot mounts inside, and it is the element `useAutoZoom` measures (`boardEl: zoomContainerEl`).
- `src/ui/composables/useAutoZoom.ts:34-38` — `computeFitZoom(natural, avail)`: `if (natural.width < 1 || natural.height < 1) return null;` (line 35) followed by the identical guard on `avail` (line 36). The doc comment directly above (line 31) states the null return means "not laid out yet" — i.e., the composable's own documented contract treats a <1px board as a transient pre-layout state, not an error.
- Cross-referencing `useAutoZoom.ts:85-110` (the `startupDone`/`onBoardResize`/`endStartup`/`SETTLE_MS` state machine): there is no branch anywhere in this file that ever logs, warns, or errors when `computeFitZoom` keeps returning `null` indefinitely — the observer simply keeps waiting. A percentage-width or `container-type: inline-size` board root genuinely has no definite containing width inside a `max-content` ancestor and will report `getBoundingClientRect()` width/height of 0 forever, matching the `natural.width < 1` branch permanently, with zero developer-facing signal.

**Structural-fix evaluation (required by CONTEXT.md before accepting dev-error+docs as the complete fix):** 134-RESEARCH.md's "UIX-03 Structural Fix Evaluation" section (re-read this pass) traces that giving the zoom container (or any wrapper inside it) a definite width would make `measureAndFit()`'s "natural" measurement equal the container's stretched size for every board, not the board's true intrinsic content size — breaking the v4.0 zoom-to-fit `computeFitZoom` calculation (`fit = avail/natural` degenerates to `1` for the stretched dimension) for every game, not just the percentage-width ones. This verdict independently confirms that evaluation: `computeFitZoom`'s formula (useAutoZoom.ts:37) is fundamentally incompatible with a definite-width ancestor. **The structural CSS fix is REJECTED; a loud dev-mode diagnostic + docs is the correct and complete fix**, exactly as CONTEXT.md's fallback clause anticipates.

**Conclusion:** The silent-collapse-and-wait-forever defect is real and current, and the rejection of the structural alternative is independently re-confirmed against current source, not merely inherited from RESEARCH.md.

---

## F29 / SESS-01 — `session.runner.performAction()` is a lookalike wrong path that silently skips persistence/broadcast/checkpoints/tutorials/AI-scheduling

**VERDICT: LEGITIMATE**

**Current evidence (re-traced 2026-07-03):**

- `get runner()` is declared at `src/session/game-session.ts:858`: `get runner(): GameRunner<G> { return this.#runner; }` — returns the raw, fully-mutable `GameRunner` instance with no narrowing.
- **Exact count and locations of `#runner` assignment sites** (re-grepped this pass, not trusted from the audit or research summary): `grep -n "#runner = " src/session/game-session.ts` returns **5** sites:
  - `game-session.ts:341` — `this.#runner = runner;` (constructor)
  - `game-session.ts:379` — `this.#runner = newRunner;`
  - `game-session.ts:484` — `session.#runner = newRunner;`
  - `game-session.ts:1462` — `this.#runner = newRunner;`
  - `game-session.ts:1482` — `this.#runner = newRunner;`
  This matches 134-RESEARCH.md's count of 5 (not the audit's original implied count of 3) — confirmed independently in this verification pass via direct re-grep of current source, satisfying the must_haves requirement that this count be re-confirmed, not assumed.
- `GameRunner.performAction` is declared at `src/runtime/runner.ts:155` with the same method name and a compatible call shape (`actionName, player, args`) as `GameSession.performAction`, declared at `src/session/game-session.ts:1336`. `GameSession.performAction` internally calls `this.#runner.performAction(...)` (line 1345) and then performs additional bookkeeping (persistence/broadcast/checkpoints/tutorials/AI-scheduling per the audit's uncontested trap description) that `GameRunner.performAction` alone does not perform.
- **Zero production consumers reach `.performAction` through `session.runner`:** `grep -rn "\.runner\." src --include="*.ts" --include="*.vue"` (excluding `*.test.ts`) surfaces only `src/testing/test-game.ts` hits — but `TestGame.runner` (declared at `test-game.ts:107`, `readonly runner: GameRunner<G>`) is `TestGame`'s own field wrapping a `GameRunner` directly; it is unrelated to `GameSession.runner` and out of this finding's scope (TestGame is not a `GameSession`). The one other non-test hit, `src/session/stateless-ops.ts:844` (`actionHistory: [...runner.actionHistory]`), operates on a local `runner` parameter, not `session.runner`.
- Test-file consumers of `GameSession.runner` (re-grepped: `restore-snapshot-authoritative.test.ts`, `teaching.test.ts`, `teaching-disabled-persistence.test.ts`, `stateful-timetravel-authoritative.test.ts`, `stateful-undo-authoritative.test.ts` — 10 call sites across these files) are exclusively read-only: `.game`, `.actionHistory`, `.getSnapshot()`. None call `.performAction()` through `session.runner`.

**Conclusion:** The lookalike-wrong-path defect is real and current; the exact 5-site `#runner` assignment inventory is confirmed by direct re-grep in this pass; zero production consumers call `.performAction` through `session.runner`, confirming the read-only facade fix (per the CONTEXT.md-locked decision) requires no production migration and only type-level (not logic-level) changes to the 10 existing read-only test call sites.

---

## Gate Summary

| Finding | Requirement | Verdict | Fix scope confirmed unblocked |
|---------|-------------|---------|-------------------------------|
| F17 | UIX-01 | LEGITIMATE | Yes |
| F18 | UIX-02 | LEGITIMATE | Yes |
| F19 | UIX-03 | LEGITIMATE (structural-CSS alternative independently re-confirmed REJECTED) | Yes |
| F29 | SESS-01 | LEGITIMATE (5 `#runner` sites confirmed, zero production `.performAction` consumers) | Yes |
| F30 | UIX-04 | LEGITIMATE | Yes |
| F31 | UIX-05 | LEGITIMATE | Yes |

All six findings are independently re-confirmed against current post-Phase-133 source. No fix code was written or planned in the course of producing this document. Plans 02-05 of Phase 134 are unblocked.
