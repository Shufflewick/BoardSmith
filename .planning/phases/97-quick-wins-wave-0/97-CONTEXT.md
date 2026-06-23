# Phase 97: Quick Wins (Wave 0) - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; grey-areas resolved from `planning/boardsmith-ui-redesign-spec.md` Wave 0)

<domain>
## Phase Boundary

The isolated, no-token-dependency quick wins from the redesign audit — they need no part of the Slate token system and carry negligible risk, so they land first to bank credibility and de-risk later waves.

**In scope (this repo only):**
- QUICK-01 — visible error feedback: replace `alert()` and silent `console.error` swallows with `toast.error(result.error)`
- QUICK-02 — accessible names on icon-only controls + `aria-expanded`/`aria-controls` + `aria-hidden` on decorative glyphs
- QUICK-03 — delete dead menu items (no-op Settings/Help) and engine branding (`BS` chip, "BoardSmith Dev Mode")
- QUICK-04 — `100vh` → `100dvh` (with `100vh` fallback)
- QUICK-05 — `env(safe-area-inset-*)` on fixed/sticky chrome edges + `viewport-fit=cover` where the engine controls it

**Out of scope (host repo — ShufflewickPub):** the Wave 0 items that live in host files are deferred to the future HOST-* milestone and must NOT be touched here:
- `GameFrame.vue` iframe accessible-name
- `[sessionId].vue` Game Over exit / "Back to Shufflewick"
- host `main.css` / nuxt head `viewport-fit`
These are tracked as HOST-01..04 in REQUIREMENTS.md (Future).

</domain>

<decisions>
## Implementation Decisions

### Error feedback (QUICK-01)
- Use the **existing BoardSmith toast system** (`Toast.vue` / the toast composable already in `src/ui`) — do not add a new dependency or a new notification mechanism.
- Replace every `alert(...)` call and every silent `console.error(...)` swallow in the in-repo chrome with `toast.error(result.error)` (or the action/selection error message), and re-enable the panel/control afterward so the player can retry.
- Spec anchors: `GameShell.vue` (~755, 825, 908, 939, 944, 482, 494), `ActionPanel.vue` (~675, 729). Verify exact lines at execution time (Prove Before Fix) — line numbers are from the audit and may have drifted.
- Error text must be the actionable `result.error` string from the engine/session — never a generic "something went wrong."

### Accessible naming (QUICK-02)
- Every icon-only `<button>` (hamburger, ✕ close/cancel/clear) gets an `aria-label`.
- The hamburger toggle gets `aria-expanded` (bound to drawer open state) + `aria-controls` (the drawer id). Full dialog semantics/focus-trap are Phase 101 — Wave 0 only adds the names + expanded/controls state.
- Decorative glyph spans (the ✕/☰ characters themselves) get `aria-hidden="true"` so SR users hear the label, not "multiplication x".
- Spec anchors: `HamburgerMenu.vue` (~70, 87), `ActionPanel.vue` (~804, 813), `GameHeader.vue` (~58).

### Dead-weight removal (QUICK-03)
- Delete the two no-op menu items (Settings, Help) from `HamburgerMenu.vue` (~55-62) — they do nothing today.
- Remove engine product-identity from player-facing chrome: the `BS` chip (~84) and the "BoardSmith Dev Mode" string (~128). The host owns product identity in platform mode; the dev-server's own branding is handled later in Wave 5 (Phase 102), not here.
- This is deletion only — do not relocate Leave/New-Game in this phase (that's the Wave 3 host-contract change, Phase 100).

### Mobile viewport (QUICK-04, QUICK-05)
- Replace `height:100vh`/`min-height:100vh` with `100dvh` and keep a `100vh` line immediately before as the fallback for browsers without `dvh`.
- Spec anchors: `GameShell.vue` (~1441, 1451, 1483), `HamburgerMenu.vue` (~192).
- Add `padding-bottom: max(<existing>, env(safe-area-inset-bottom))` (and the matching top/left/right insets where a fixed/sticky edge touches the device edge) to the sticky action bar (`GameShell.vue` ~1552) and `GameHeader.vue` (~97). Engine-controlled surfaces only.

### Claude's Discretion
- Toast auto-dismiss timing, stacking, and exact placement: use whatever the existing `Toast.vue` already does — do not redesign it here (full toast a11y — role/dismiss button/timeout — is A11Y-10 in Phase 101).
- Whether to extract a tiny shared `notifyError(result)` helper vs. inline `toast.error` calls: executor's choice, but a single helper is preferred (DRY, one place to evolve in Phase 101).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Toast system already exists in `src/ui` (`Toast.vue` + composable) — QUICK-01 reuses it, no new dependency.
- `result.error` strings flow from the engine/session action results into `ActionPanel`/`GameShell` already (the values are currently swallowed, not surfaced).

### Established Patterns
- BoardSmith chrome is Vue 3 SFCs under `src/ui`. Conventions: scoped `<style>`, composables in `src/ui/composables` or co-located.
- Hard rule (CLAUDE.md): no fallbacks/hacks; the right path must be the easy path. Error messages must be actionable.

### Integration Points
- `GameShell.vue`, `ActionPanel.vue`, `HamburgerMenu.vue`, `GameHeader.vue` are the four in-repo chrome files this phase touches. All four are also touched by later waves — keep changes surgical and token-free (no `--bsg-*` yet; that's Phase 98).

</code_context>

<specifics>
## Specific Ideas

Design source of truth: `planning/boardsmith-ui-redesign-spec.md` → "Part II — Prioritized Roadmap" → **Wave 0 — Quick wins** table (lines ~1236-1250). Take the in-repo rows only; the four host-file rows are out of scope (see Phase Boundary). The reasoning column ("rejected moves silently swallowed today", "competing product identity", etc.) is the rationale for each change.

</specifics>

<deferred>
## Deferred Ideas

- Host-side Wave 0 items (iframe name, Game Over exit, host `viewport-fit`) → HOST-01..04 (future host milestone).
- Full toast a11y (role/assertive, dismiss button, auto-timeout) → A11Y-10 (Phase 101).
- Hamburger full dialog semantics + focus trap + Escape → A11Y-07 (Phase 101).
- Dev-server branding/title cleanup → Phase 102 (Wave 5).

</deferred>
