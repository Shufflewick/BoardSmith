# Deferred Items — Phase 171

## `npx tsc --noEmit` pre-existing rootDir error (out of scope for 171-02)

`npx tsc --noEmit` fails with:

```
error TS6059: File '/Users/jtsmith/BoardSmith/docs/seed-to-state.test.ts' is not under 'rootDir'
'/Users/jtsmith/BoardSmith/src'. 'rootDir' is expected to contain all source files.
```

This is unrelated to 171-02's changes (`src/cli/lib/boardsmith-version.ts`,
`src/cli/lib/skills-tree-hash.ts`, `src/cli/cli.ts`). `docs/seed-to-state.test.ts` was added in
phase 168 (commit `f13c16ce`, "test(168-01): add section-presence + citation-existence guard for
seed-to-state doc") and the tsconfig `rootDir`/`include` mismatch predates this plan. Confirmed
via `npm test` (which uses vitest, not `tsc`, and passes clean at 3344/3344) that this is a
`tsc --noEmit` config-scope issue only, not a type error introduced by this plan's code.

Not fixed here per the scope boundary rule: "Only auto-fix issues DIRECTLY caused by the current
task's changes." Logged for a future phase to address the tsconfig `include`/`rootDir` boundary.
