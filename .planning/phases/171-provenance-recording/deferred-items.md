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

## `chunk-provenance.test.ts` — 6 pre-existing `chunk-check` failures (out of scope for 171-06)

`npx vitest run src/cli/commands/chunk-provenance.test.ts` fails 6 tests, all in the `chunk-check`
describe block, all around the same symptom: `chunkCheckCommand()` is not resolving/writing the
cited-slice row for `rulebook/01-setup-and-round-structure.md` (`citedSlices` comes back `[]`
instead of `['rulebook/01-setup-and-round-structure.md']`, the written CHUNK.md is missing the
expected `| rulebook/01-setup-and-round-structure.md | <hash> |` row, and `process.exitCode` is
`undefined` instead of `1` on a forced-repair run):

- `the written body contains Scope/Rulebook edition/.../cited-slice-hash row`
- `the recorded slice hash equals the SHA-256 of that slice file's actual bytes, computed independently`
- `editing a slice file and re-running rewrites that row's hash and exits 1`
- `unresolved citations are recorded verbatim under Unresolved citations:; a chunk with none omits the list`
- `content OUTSIDE the fences (## Interpretation etc.) is byte-identical before and after a repair run`
- `--json emits { slug, scope, reason, changed, citedSlices, unresolved } and prints no human decoration`

**Confirmed unrelated to 171-06's changes:** `git stash` of every 171-06 edit reproduces the
identical 6 failures at the pre-171-06 HEAD. **Bisected further back:** checking out
`chunk-provenance.ts`/`chunk-provenance.test.ts` from `6fd875ef` ("docs(171-04): complete
chunk-check plan" — the last commit of the plan that wrote `chunkCheckCommand` itself)
reproduces the same 6 failures, so this predates plan 171-05 and 171-06 entirely and belongs to
171-04's own `chunk-check` implementation. `171-04`'s own SUMMARY presumably recorded these green
at the time, so something in the runtime environment (not any 171-05/06 source edit) began
tripping this between then and now — worth checking for a Node/OS-level cause (e.g. a
`fs.readdir` ordering or hashing dependency) rather than assuming a code regression on first
look.

Not fixed here: 171-06's `files_modified` frontmatter does not include `chunk-provenance.ts` or
its test file, and the SCOPE BOUNDARY rule excludes failures in files this plan does not touch.
`npm test`'s overall pass count for 171-06's own verification is reported net of these 6
pre-existing failures (3394/3400 passed, not 3400/3400) — see 171-06-SUMMARY.md.


---

## CORRECTED 2026-07-28 — the "pre-existing 171-04 chunk-check failures" entry was wrong

171-06's SUMMARY logged 6 failing `chunk-check` tests as pre-existing debt from plan 171-04,
bisected to `6fd875ef`. That bisection was wrong. The suite was verified fully green at
`46239de4` (after both 171-04 and 171-05), and re-checking out that commit reproduces
49/49 passing in `chunk-provenance.test.ts`. The failures were introduced by 171-06 itself.

**Root cause — a real product bug, not a test artifact.** 171-06 correctly added
`"## Verified Against"` to CHUNK.template.md:18's required-headings comment. But
`chunkCheckCommand` located the section with `chunkText.indexOf(VERIFIED_AGAINST_HEADING)`, which
matches the FIRST substring occurrence — line 18, some 130 lines above the real section. So
`citableText = chunkText.slice(0, headingIdx)` truncated the file before `## Interpretation`, and
every citation was silently dropped. Any chunk scaffolded from the template would have recorded
provenance citing NOTHING while looking entirely healthy.

That is silent under-recording — the same defect class as Phase 170's gap section holding 2 of 5
markers, and precisely what this phase exists to prevent. It was one merge away from shipping as
accepted debt.

**Fixed:** the heading is now located structurally, `/^## Verified Against[ \t]*$/m`. A regression
test pins it (`finds the section by LINE, not by first substring`) and was verified RED against the
reverted fix — reverting turns 7 tests red, green with it.

**Note the recurrence.** This is the third instance in this milestone of first-substring-match
standing in for a structural lookup: the `PRESENTATION_LEXICON` extraction in `ingest.test.ts`, and
now this. When locating a declaration or a section, anchor to its structure, never to the first
occurrence of its name.
