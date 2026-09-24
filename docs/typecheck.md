# Typechecking BoardSmith

There is one command, and this file states what it covers.

```
boardsmith typecheck     # from the repository root
```

It runs `vue-tsc --noEmit -p tsconfig.json`. Exit code 0 means clean. `main`
has been at **zero errors** since #312 (2026-09-24), and the gates below keep
it there.

## Where it runs

1. **`boardsmith test`** runs it first in this repository and runs no test at
   all if it fails. So a type error is found while you are still working, not
   at merge.
2. **`bash scripts/merge-branch.sh <branch> "<summary (#issue)>"`** is how a
   branch reaches `main`. Run it from the main checkout on a clean `main`. It
   merges the branch without committing, runs `boardsmith test` on the merged
   tree, and commits the merge only if that passes. Otherwise it aborts the
   merge and `main` is left as it was. Because it checks the merged tree, a
   branch that was clean on its own but conflicts in types with something that
   landed since is refused too.

A plain `npx vitest run` does not type-check. Use `boardsmith test`.

It is a CLI command and not an npm script because this repository keeps
exactly one npm script (`npm link`), and every other capability goes through
`boardsmith`. `src/cli/cli-single-entry-point.test.ts` holds that rule.

## Why `vue-tsc` and not `tsc`

Plain `tsc` cannot read a `.vue` file. It checks neither an SFC's `<script>`
nor its template, and it cannot type an import of one. Before #312 part of the
reported error count was that noise, and the real errors inside the shell's
SFCs were checked by nobody. `vue-tsc` compiles SFC scripts and templates for
real.

## What it covers

`tsconfig.json` includes, explicitly:

| Covered | Notes |
| --- | --- |
| `src/**/*.ts` | Library, CLI, tests and test helpers |
| `src/**/*.vue` | SFC scripts and template expressions |
| `docs/**/*.ts` | The documentation tests |
| `vitest.config.ts` | |

`scripts/typecheck-coverage.test.mjs` asks `vue-tsc` which files it compiled
and fails if any tracked `.ts` or `.vue` file under `src/` or `docs/` is
missing, so narrowing `include` is a failing test rather than a quiet change.

The compiler options are a game's options (compare `generateTsConfig` in
`src/cli/lib/project-scaffold.ts`), plus `node` in `types` because the CLI and
the tests use Node globals. That matters because this package ships
TypeScript source: `exports` points `types` and `import` straight at
`src/**/*.ts`, and a game's own `vue-tsc` (which `boardsmith validate` runs and
`boardsmith publish` requires) compiles these files. An error here is an error
in every game.

## What it does NOT cover

- **The `.mjs` scripts** under `scripts/` and `bin/`. They are JavaScript and
  are not type-checked.
- **What a consumer's install lacks.** This check runs inside this checkout,
  where every devDependency is installed. `src/contract/dev-host-typecheck.test.ts`
  and `src/contract/dice-typecheck.test.ts` compile the modules consumers import
  in a sandbox holding only what we ship.
- **Anything at runtime.** Types say nothing about a shape crossing a boundary
  the types do not describe.

## House rules for fixing an error

Fix the code, not the types. No `any`, no `@ts-ignore` or `@ts-expect-error`,
and no cast added only to make an error go away. When a test fails to compile
because it passes a field that no longer exists, work out what it was meant to
prove and move it to the current API, so it still proves that.

## History

- `tsconfig.json` once had no `include`, so TypeScript defaulted to `**/*`,
  picked up `docs/*.test.ts` outside `rootDir: "src"`, and stopped on TS6059
  config errors before checking a single file, while exiting 0. Adding an
  `include` fixed that, and it revealed 213 errors.
- Nothing ran the check, so the count grew to 289 under `tsc` (#312). Under
  `vue-tsc` with the current config the starting count was 165. #312 fixed all
  of them and added the gates above. `tsconfig.public.json` and its test, which
  checked only the public entry points, were removed because the whole-package
  check covers them.
- Two of the errors were real gaps in the engine contract fixture
  (`src/contract/fingerprint.ts`), which nothing had type-checked. The world
  wire fixture was missing the `order` field every `world_command` has carried
  since #195, and the prompt meant to put the activity watermark in the payload
  hash was a function on an action prompt, which only takes a string, so JSON
  dropped it. Neither moved the contract's hash.
- Until #314 four bot tests imported `@boardsmith/checkers-rules` and
  `@boardsmith/cribbage-rules`, packages this repository does not contain, so
  both this check and `vitest.config.ts` excluded them and nothing ran them.
  Three were deleted because other bot tests already cover what they checked,
  and the fourth, a simultaneous multi-card discard, became
  `src/bot/simultaneous-discard.test.ts` against an in-repo game. Nothing is
  excluded now.
