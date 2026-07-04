# Phase 140: Library Prerequisite — useAnnouncer() - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship a `useAnnouncer()` composable from `boardsmith/ui` that lets any game component (custom UI or AutoUI) announce meaningful state changes to screen readers by writing to GameShell's existing live regions — no new DOM nodes. This is the library prerequisite for the v4.6 per-chunk a11y floor (LIB-01). Skill-side work (templates, bs- skills) is out of scope.

</domain>

<decisions>
## Implementation Decisions

### API Surface & Shape
- Call signature: `const { announce } = useAnnouncer()`; `announce(message, { assertive?: boolean })` — matches the composable object-return convention in `src/ui/composables/`
- Polite by default; assertive is opt-in via the option — assertive interrupts and should be deliberate
- Used outside GameShell (no provider): no-op + one-time dev-mode `console.warn` — matches the `useAnimationEvents` inject-with-undefined pattern while staying loud in dev
- Minimal API scope: just `announce()` — no `clear()`, no raw ref exposure

### Live-Region Semantics
- Messages write to GameShell's existing `politeMessage`/`assertiveMessage` refs via provide/inject — satisfies the "no new DOM nodes" success criterion
- Repeated identical messages use clear-then-set (reset to empty string, then `nextTick` write) so screen readers re-announce duplicates
- Collisions with GameShell's own announcements (turn/connection/game-over): last-write-wins, no queue — simple, matches current behavior
- Message lifetime: persists until overwritten (current GameShell behavior)

### Parity & Distribution
- Export from the `boardsmith/ui` index (`src/ui/index.ts`), alongside `useBoardSize`
- AutoUI parity via the same inject path — AutoUI renders inside GameShell so injection works identically; include a test proving it
- Each announce also fires the existing `boardsmith-a11y` postMessage relay (`emitAnnounce` in GameShell.vue) so platform-mode hosts can relay announcements
- Testing: unit tests + behavioral tests in the `GameShell.live-region.test.ts` style, covering both custom-UI and AutoUI paths

### Claude's Discretion
- Exact injection key naming, TypeScript types, and file placement — follow existing composable conventions

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/ui/composables/liveRegionAnnouncer.ts` — pure mapping functions for existing announcements (turn, connection, game over); dependency-free unit-test style to mirror
- `GameShell.vue:340-349` — `politeMessage`/`assertiveMessage` refs + `emitAnnounce()` postMessage relay; live regions rendered at `GameShell.vue:1913-1914` (`role="status"` polite, `role="alert"` assertive)
- `src/ui/composables/useAnimationEvents.ts` — the provide/inject composable pattern to follow (`InjectionKey` symbol, `provideX()` from GameShell, `useX()` injects with `undefined` default)

### Established Patterns
- GameShell writes live regions only from watchers with `immediate: false` to avoid the silent-first-announcement pitfall (Pitfall 2 in 101-RESEARCH.md)
- Composables live in `src/ui/composables/useX.ts` with adjacent `useX.test.ts`
- Public exports flow through `src/ui/index.ts`

### Integration Points
- GameShell provides the announcer near its other `provide()` calls (`GameShell.vue:962-970`)
- `src/ui/index.ts` export list (`useBoardSize` at line 154 is the closest analog)

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the decisions above — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
