# Typechecking BoardSmith

## `tsc -p tsconfig.json` used to check NOTHING, and exit 0 doing it

Found 2026-08-25, during ShufflewickPub Phase 68.

`tsconfig.json` had no `include`. TypeScript therefore defaulted to `**/*`,
which picks up three `docs/*.test.ts` files. Those live outside
`rootDir: "src"`, so tsc emitted three **TS6059 config errors** and stopped
**before typechecking a single file** — while exiting **0**.

**Proven, not inferred:** a deliberate type error was planted in `src/` and went
completely unreported.

That is the same false-green class ShufflewickPub's `CLAUDE.md` documents for
`npx tsc --noEmit` (it cannot see inside `.vue` files, so it checks about half
that repo while looking green). A command that reports success while asserting
nothing is worse than no command, because it is quoted as evidence.

**Fixed** by adding `"include": ["src/**/*"]`. `tsc -p tsconfig.json` now really
typechecks, and the TS6059 errors are gone.

## Why this matters more here than in an ordinary repo

This package **ships TypeScript source**. `package.json`'s `exports` maps both
`types` and `import` straight at `src/**/*.ts`:

```json
".": { "types": "./src/engine/index.ts", "import": "./src/engine/index.ts" }
```

There is no build step and no emitted `.d.ts`. So every type error in this repo
is **inherited by consumers that do typecheck** — ShufflewickPub's `games/` and
`executor/` both consume this source through the vendored tarball. A type error
here is not local.

## The 213 pre-existing errors

With the config fixed, `tsc` reports **213 errors**, none of them new. The
concentration:

| File | Errors |
|---|---|
| `src/cli/cli.ts` | 27 |
| `src/ui/composables/actionControllerHelpers.test.ts` | 11 |
| `src/ui/index.ts` | 10 |
| `src/engine/element/image-leak.test.ts` | 9 |
| `src/ui/components/auto-ui/builtin-renderers.ts` | 8 |
| `src/ui/composables/anchorAttrs.test.ts` | 6 |
| `src/ui/components/helpers/index.ts` | 6 |
| `src/session/teaching.test.ts` | 6 |
| …long tail | rest |

This was **217** until 68-06, which added
`/// <reference types="vite/client" />` to
`src/engine/flow/flow-state-clone.test.ts` (that file needs `import.meta.glob`
to derive its fixture list). A triple-slash reference applies to the whole
program, so it also resolved four pre-existing `import.meta.env` errors in
`src/ui/composables/useActionController{,.devtools.test}.ts` and
`src/ui/game-uis.ts`. Nothing was suppressed and nothing was silenced — the
types were simply missing.

**Phase 68's own files are clean** — zero of the 213 are in
`boundary-key.ts`, `turn-boundary.test.ts`, `simultaneous-rounds-fixture.ts`,
`snapshot-session-host.ts` or `headless-session.ts`. Eight errors WERE
introduced by Phase 68 work and all eight were fixed once the broken config was
discovered; before that they were invisible.

## What has NOT been done, and why

The 213 are **not** fixed, and no `typecheck` npm script has been added. This
repo has exactly one script (`setup`), nothing runs tsc automatically, and a
script that always exits non-zero is a gate that cannot fail meaningfully —
the same objection this project raises to a vacuous green.

Paying the 213 down is real work with real risk (`src/cli` and `src/ui` are the
bulk) and it deserves to be sized on its own merits rather than absorbed by
whichever change happens to notice it. **This is a decision for the maintainer,
not for a plan about turn boundaries.**

The honest interim position: the tool now tells the truth, the number is
written down, and Phase 68 added nothing to it.
