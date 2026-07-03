# Phase 132: Engine Element & Builder Safety - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Element-tree mutation and action-builder APIs fail loudly on misuse instead of silently corrupting state or shipping a no-op. Covers audit findings F3, F12, F13, F28 (requirements ENG-01, ENG-05, ENG-06, ENG-08; PROC-01/PROC-02 discipline applies fractally). Scope: `src/engine/element/piece.ts` (moveToInternal), `src/engine/action/action.ts` (resolveArgs), `src/engine/flow/engine.ts` (executeForEach), `src/engine/action/action-builder.ts` + action registration.

</domain>

<decisions>
## Implementation Decisions

### Fail-Loud Mechanisms
- **ENG-01 (F3)**: `putInto()` onto self or own descendant **throws at the `moveToInternal` chokepoint** — O(depth) walk up `destination._t.parent` to root; if `this` is encountered (or `destination === this`), throw actionable error "Cannot move X into its own descendant Y". Covers all putInto call paths since moveToInternal is the shared chokepoint.
- **ENG-05 (F12)**: `resolveArgs` **only resolves non-selection args shaped like serialized elements** (`{id, className}` via `isSerializedElement`) — bare numbers are NEVER rewritten into GameElements. Clean break per No Backward Compatibility; any followUp patterns relying on bare-number coercion get fixed in games during Phase 138.
- **ENG-06 (F13)**: `forEach` **snapshots the collection once on loop entry** — stores a stable identity list (element ids for GameElements, values otherwise) in frame data, mirroring `eachPlayer`'s `eligibleSeats` snapshot pattern. Mutating the source collection mid-loop no longer skips items.
- **ENG-08 (F28)**: **Remove the default no-op `execute`**; `.build()` returns a definition flagged handler-less (for inspection), and `registerAction()` **throws** an actionable error on handler-less definitions ("action 'x' has no execute handler — end the chain with .execute(fn)").

### Process (carried over from Phase 131 locked decisions)
- PROC-01 verify-first: per-finding verdict (repro or file:line trace) recorded in `132-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED output recorded in SUMMARY.
- Tests placed alongside existing engine suites; full suite green per wave.
- Same-phase doc updates for any API whose documented behavior changes (DOCX-04).

### Claude's Discretion
- Exact error message wording (must name both elements and the fix).
- Whether the forEach snapshot stores ids vs. values for non-element collections — pick what round-trips serialization safely.
- Where the handler-less flag lives on ActionDefinition (type shape) as long as registerAction fails loudly.

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit, re-verify per PROC-01)
- `src/engine/element/piece.ts:80` — `moveToInternal` has no self/descendant check; existing tree-corruption detectors (element-collection.ts:337, piece.ts:88) only catch duplicate-reachability, not detached cycles. Note: Phase 131's WR-03 fix added a dev-mode detached-destination check in `Piece.moveToInternal` — read the current code first; the new throw must compose with it.
- `src/engine/action/action.ts:246` (second pass ~239-259) — walks non-selection args, rewrites any number whose value matches an existing element id.
- `src/engine/flow/engine.ts:1157` — `executeForEach` re-invokes `config.collection(context)` every iteration against persisted `itemIndex`; `eachPlayer`'s `eligibleSeats` snapshot is the in-repo template.
- `src/engine/action/action-builder.ts:77` (default `execute: () => {}`) and `:636-640` (`.build()`).

### Established Patterns
- Phase 131 established: `devWarn` for dev-mode warnings, actionable thrown errors for state corruption, red-first test files per finding.
- `eachPlayer` eligibleSeats snapshot (flow engine) — the identity-list pattern for ENG-06.

### Integration Points
- moveToInternal is called by putInto and related move APIs — single chokepoint fix.
- registerAction validation — v4.3 Phase 120 added element-registration + action-reachability validation there; the handler-less check joins that existing fail-fast validation layer.

</code_context>

<specifics>
## Specific Ideas

- Findings are mutually independent per audit guidance — plans can parallelize where files don't overlap.
- Full suite currently 168 files / 2135 tests green after Phase 131; keep it green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
