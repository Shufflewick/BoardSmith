---
phase: 149-end-to-end-dry-run-validation
fixed_at: 2026-07-05T09:43:00Z
review_path: .planning/phases/149-end-to-end-dry-run-validation/149-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 149: Code Review Fix Report

**Fixed at:** 2026-07-05T09:43:00Z
**Source review:** .planning/phases/149-end-to-end-dry-run-validation/149-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (WR-01, WR-02, WR-03, WR-04)
- Fixed: 4
- Skipped: 0
- Info findings (IN-01, IN-02): out of scope (critical_warning), not addressed

## Fixed Issues

### WR-03: git-skip message is inaccurate when only the commit failed

**Files modified:** `src/cli/commands/init.ts`
**Commit:** dc57305e
**Applied fix:** Split the single git `try` block into two — one wrapping `git init` + `git add -A` (guarded by a `gitRepoInitialized` flag), and a separate one wrapping `git commit`. The init-failure message now says "git not available; run `git init` manually", while the commit-failure message says "git repo created but initial commit skipped — set `git config user.name` / `user.email`, then run `git commit`". Each message now names the actual failure point per CLAUDE.md's actionable-error rule.

### WR-01: "non-fatal on commit failure" test never actually triggers a commit failure

**Files modified:** `src/cli/commands/init.test.ts`
**Commit:** 6bffca1e
**Applied fix:** Rewrote the test to genuinely force the commit-failure path by neutralizing git identity for the spawned commit: `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, and empty `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL`. `git init`/`git add` still succeed but `git commit` fails, so the non-fatal catch is actually exercised. Restores `process.env` in a `finally`. Asserts init still resolves undefined, `package.json` and `.git` both exist (repo created, no commit). This test would now fail if the try/catch were removed.

### WR-02: no test compiles the generated UI type-graph

**Files modified:** `src/cli/lib/project-scaffold.test.ts`
**Commit:** da0bca05
**Applied fix:** Added a real `ts.createProgram` compile test that reproduces the original failing graph: writes a UI entry re-exporting `UseActionControllerReturn` from `boardsmith/ui` (mapped via `paths` to the repo's `src/ui/index.ts`), which reaches `useActionController.ts`'s `import.meta.env.DEV`. Compiles the graph twice and asserts the TS2339 `ImportMeta.env` error appears WITHOUT `types: ['vite/client']` and vanishes WITH it. Verified load-bearing — the negative assertion actually finds the env error, so dropping `vite/client` from `generateTsConfig()` turns this test RED.

### WR-04: `types: ["vite/client"]` silently disables auto-inclusion of all other ambient @types

**Files modified:** `src/cli/lib/project-scaffold.ts`
**Commit:** d8807a5d
**Applied fix:** Extended the inline comment above `types: ['vite/client']` with a COUPLING note documenting that listing `types` at all switches tsc from auto-including every `@types/*` to including only the listed entries, and that any future ambient dependency (`@types/node`, vitest globals, `@types/web`) must be appended here explicitly and added as a devDependency. Makes the non-local coupling discoverable per the Pit-of-Success principle.

## Skipped Issues

_None in scope. IN-01 (nested git repo) and IN-02 (`tests/**` outside tsconfig include) are Info-tier, explicitly marked optional/out-of-scope by the reviewer, and are not one-liners — deferred._

## Verification

- Targeted: `npx vitest run src/cli/lib/project-scaffold.test.ts src/cli/commands/init.test.ts src/cli/slash-command/bs/` → 6 files, 275 tests passed.
- Full: `npm test` → 184 files, 2652 tests passed.
- `git status --short package.json` empty — no new dependencies.
- No dev server or background process started.

---

_Fixed: 2026-07-05T09:43:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
