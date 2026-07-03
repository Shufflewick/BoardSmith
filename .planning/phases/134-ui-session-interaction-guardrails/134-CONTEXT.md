# Phase 134: UI & Session Interaction Guardrails - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Developers building custom UIs or scripting sessions get loud, actionable feedback the moment they take a wrong-but-plausible path, instead of a silent no-op. Covers audit findings F17, F18, F19, F29, F30, F31 (requirements SESS-01, UIX-01..05; PROC-01/PROC-02 discipline applies fractally). Scope: `src/ui/composables/useActionController.ts`, `src/ui/composables/useDragDrop.ts`, `src/ui/components/GameShell.vue` (+ useAutoZoom), `src/session/game-session.ts` (runner accessor), `docs/custom-ui-guide.md`.

</domain>

<decisions>
## Implementation Decisions

### Failure Surfacing & Session Guardrails
- **UIX-01 (F17)**: All three parts: (1) GameShell centrally watches `lastError` (and failed execute/fill results) and fires `toast.error` — custom UIs get the same failure feedback ActionPanel users get, for free; (2) `start()` returns `Promise<result>` (ActionResult/ValidationResult) so failure is programmatically detectable; (3) devWarn when `start()` is called for an unavailable action. Docs updated to model checking results.
- **SESS-01 (F29)**: **Read-only facade** — `GameSession.runner` no longer exposes the raw `GameRunner`; it returns a read-only facade (state/view/history getters only) with no `performAction` reachable. All write-paths go through `session.performAction` (persistence, broadcast, checkpoints, tutorials, AI scheduling intact). Clean break per No Backward Compatibility; internal callers migrate.
- **UIX-02 (F18)**: `fill()` **rejects a scalar for a multiSelect pick with an actionable error**, mirroring `toggleMultiSelect`'s existing reverse guard: "selection X is multiSelect (min/max) — use toggleMultiSelect()/confirmMultiSelect() or pass an array". No silent auto-wrap.

### Composable Contracts & Board Sizing
- **UIX-04 (F30)**: **Implement `when`** — `dragProps()` honors the documented `when` option by returning inert props (`draggable: false`, no live handlers) when the condition is false.
- **UIX-05 (F31)**: **Accumulate hooks** — `setBeforeAutoExecute` registers multiple hooks, runs all in registration order, returns an unregister function. Docs/JSDoc updated (the "REPLACES" note goes away).
- **UIX-03 (F19)**: **Loud dev-mode error + docs**: once game state has arrived and the #game-board slot has children, if the zoom container measures ~0×0 (board collapsed under `width:max-content`), fire an actionable `console.error` pointing at a new "board sizing" section in docs/custom-ui-guide.md (covering max-content, percentage widths, container-type, boardregion measurement). Research additionally evaluates a structural CSS fix (giving the slot a definite containing width) — adopt ONLY if proven not to break the v4.0 zoom-to-fit architecture; otherwise the dev-error + docs is the complete fix.

### Process (carried over from Phases 131-133 locked decisions)
- PROC-01 verify-first: per-finding verdict in `134-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.
- **Custom-UI/ActionPanel parity rule (CLAUDE.md hard rule)**: all interaction changes must work in Custom UI and Action Panel in parity through useBoardInteraction.

### Claude's Discretion
- Toast implementation reuse (GameShell already has a toast/message mechanism from v4.0 — reuse it; do not add dependencies).
- Facade type name and exact getter surface for SESS-01 (state/view/history + whatever read-only accessors internal consumers need).
- Whether UIX-01's `start()` return type unifies with `execute()`'s existing result shape.
- Exact placement of the UIX-03 dev check (GameShell vs useAutoZoom) — wherever the 0-size signal is reliable post-state-arrival.

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit; re-verify per PROC-01)
- `src/ui/composables/useActionController.ts:1252-1262` — `start()` sets lastError and returns void; `:1311` — `fill()` never consults multiSelect config; `:1729` — toggleMultiSelect's reverse guard (the template); `:938` — setBeforeAutoExecute single-slot.
- `grep lastError src/ui` — zero consumers outside the controller (F17 evidence).
- `src/ui/components/GameShell.vue:2822` — `.game-shell__zoom-container { width: max-content }`; `useAutoZoom.ts:36` — <1px board treated as "not laid out yet", waits forever.
- `src/session/game-session.ts:832` — `get runner()` exposes raw GameRunner; GameRunner.performAction has identical name/signature to session.performAction.
- `src/ui/composables/useDragDrop.ts:212` — dragProps reads only onDragStart/onDragEnd from options; `when` unread. Drag auto-start via useDragDropTargets.ts Case B.
- `docs/custom-ui-guide.md:120,141,242,316` — models fire-and-forget calls and scalar fill; no board-sizing section.

### Established Patterns
- devWarn convention (Phases 131-133); actionable error messages naming the fix.
- v4.0 Slate: GameShell owns chrome-level messaging (turn status, prompt, Game Over card) — the error toast belongs there; live regions exist for a11y (WCAG 2.2 AA work).
- Phase 133's actionError flows engine→runner→session→client; UIX-01 surfaces the client end of that chain (contract user-approved: FlowHaltedError failures also arrive as {success:false}).
- Memory: GameShell `#player-stats` slot exposes actionController — hook accumulation (UIX-05) matters exactly there (board + panel both registering).

### Integration Points
- `session.runner` consumers: internal call sites in BoardSmith (dev host, tests, ai) must migrate to the facade or session methods — enumerate via grep during research; games/MERC checked in Phase 138.
- Custom-UI/ActionPanel parity through useBoardInteraction (hard rule).

</code_context>

<specifics>
## Specific Ideas

- No new dependencies (toast must reuse existing GameShell messaging).
- Browser verification: CLAUDE.md requires confirming UI features end-to-end in the browser (boardsmith dev + a reference game) before marking complete — plan a human-verify or devtools-driven check for the toast and drag gating; kill any dev server started.
- Suite baseline after Phase 133: 168 files / 2183 tests green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
