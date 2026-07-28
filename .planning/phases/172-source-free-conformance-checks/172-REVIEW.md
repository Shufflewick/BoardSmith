---
phase: 172-source-free-conformance-checks
reviewed: 2026-07-28T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/cli/commands/build-manifest.ts
  - src/cli/commands/build-manifest.test.ts
  - src/cli/commands/trace-check.ts
  - src/cli/commands/trace-check.test.ts
  - src/cli/commands/drift-check.ts
  - src/cli/commands/drift-check.test.ts
  - src/cli/cli.ts
  - src/cli/cli-conformance-commands.test.ts
  - src/cli/commands/chunk-provenance.ts
  - src/cli/commands/chunk-provenance.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 172: Code Review Report

**Reviewed:** 2026-07-28
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed the two new read-only CLI commands (`trace-check`, `drift-check`), the shared
`build-manifest.ts` parser they both consume, the one bounded change to
`chunk-provenance.ts`, and the exit-code contract test. Ran the full suite for these files
(146/146 green), `tsc --noEmit` (clean), and `eslint` (clean) on every file in scope.

**Design contracts verified sound, not just asserted:**

- **Locked 9 finding kinds** — `FINDING_KINDS` is frozen, exactly 9 members; both commands
  only ever push kinds from that array. Verified by direct read, no 10th kind anywhere.
- **Exit 0 on findings, non-zero only on tool failure** — confirmed by reading
  `traceCheckCommand`/`driftCheckCommand` (no `process.exitCode` write in either file) and by
  the real-process spawn test in `cli-conformance-commands.test.ts`, which passed.
- **Read-only** — no mutating `fs` call in `trace-check.ts` or `drift-check.ts`; `drift-check.ts`
  only shells out to `git diff`, `git rev-parse`, `git merge-base --is-ancestor`, never a
  mutating git subcommand. Before/after byte-hash tests pass.
- **One heading-locator** — `grep` across `src/cli/commands/*.ts` found zero
  `text.indexOf('## ...')`-style substring heading searches outside `build-manifest.ts` itself.
  The `chunk-provenance.ts` change is exactly the one-line, one-call-site fix the commit
  message describes (`git show eab5b7d5`), correctly reusing `findHeadingIndex`.
- **Three-rung claim-resolution ladder** — traced `resolveClaimCitation` by hand against the
  "rung 3 empties a non-empty rung-2 set" invariant: `survivors = authoringCandidates.length >
  0 ? authoringCandidates : validCandidates` correctly falls back to the rung-2 set rather than
  discarding it. Confirmed by the dedicated test at `trace-check.test.ts:122`.
- **Git argv/hash validation** — `diffedFilesSince` validates `HASH_SHAPE` before ever calling
  `execFileAsync`, closing the flag-injection hole (`--upload-pack=...`) described in the task
  context; `isAncestorOfHead` is module-private and its one call site in
  `driftCheckCommand` is always reached only after the same `HASH_SHAPE` check. `cwd` is
  explicit and set to the resolved game-project directory on every git invocation.
- **Path traversal on manifest-supplied paths** — both `resolveManifestPath` implementations
  correctly reject `../` escapes (including absolute-path inputs, since `relative()` from an
  absolute path outside `projectDir` also produces a leading `..`), verified against the
  `../../../etc/...` test cases in both test files.
- **No stack-trace/path leakage** — `cli.ts`'s top-level `catch` prints only `err.message`; the
  spawned-process test asserts stderr contains neither `at .../(` nor `.ts:NNN` nor the repo's
  own `src` path.

No blocker-class defect found. Two warnings (code-quality risk, not incorrect-output-today)
and two informational notes below.

## Warnings

### WR-01: `resolveManifestPath` is byte-identically duplicated across two files

**File:** `src/cli/commands/trace-check.ts:222-227` and `src/cli/commands/drift-check.ts:162-167`

**Issue:** Both files independently define the exact same function:
```ts
function resolveManifestPath(projectDir: string, relPathStr: string): string | 'escapes' {
  const resolved = pathResolve(projectDir, relPathStr);
  const rel = relative(projectDir, resolved);
  if (rel === '..' || rel.startsWith(`..${sep}`)) return 'escapes';
  return resolved;
}
```
This is the security-relevant path-traversal guard both commands rely on to keep
manifest-supplied file paths from escaping the project root. `build-manifest.ts`'s own header
comment states the module's entire reason for existing is "one parser, one authority" so a
correctness-critical primitive is never re-derived in two places — and this phase's own
history (`f73153a3`, and this phase's own `eab5b7d5` recurrence at a second call site) is a
direct demonstration of what happens when the same logic is copied instead of shared: one copy
gets fixed, the other doesn't. This guard is exactly the kind of function that class of bug
recurs in — it is not currently wrong, but it is one future edit away from silently diverging
(e.g. someone hardens one copy against a symlink-escape case and forgets the other).

**Fix:** Move `resolveManifestPath` into `build-manifest.ts` and export it; import it from both
`trace-check.ts` and `drift-check.ts`.

### WR-02: Manifest status-cell leading-verb classifier can be defeated by markdown emphasis

**File:** `src/cli/commands/build-manifest.ts:134-142`

**Issue:** `leadingVerb()` takes the first whitespace/punctuation-delimited token of the status
cell and `AUTHORING_VERBS` (`/^(new|written)$/i`) requires an exact match against that token. A
status cell that bolds its verb — `**new** — added X` or `**written** — implemented Y`, a
plausible authoring style since the sibling `## Interpretation` section's own claim items are
required to be `N. **bold text**` — produces a leading token of `**new**` / `**written**`,
which fails the exact-match regex and is silently classified as non-authoring. Because rung 3
of the claim-resolution ladder narrows *to* the authoring chunk, a false-negative here has the
same dangerous-direction consequence the file's own comment (line 120-124) warns about for the
false-positive case: a legitimately authoring chunk can lose its claim attribution to another
candidate, or fall through to `ambiguous` where it should have resolved cleanly. This shape is
untested — `build-manifest.test.ts` covers `NEW (test step)`, `written`, and various non-bold
editing-verb-with-"new"-in-prose cases, but no bolded-verb case.

**Fix:** Strip a leading/trailing `**` (or any markdown emphasis marker) before tokenizing, e.g.
`status.trimStart().replace(/^\*+/, '')`, or extend `AUTHORING_VERBS` to
`/^\*{0,2}(new|written)\*{0,2}$/i`. Add a regression test alongside the existing leading-verb
suite (`build-manifest.test.ts:189`).

## Info

### IN-01: `PATH_TOKEN` can double-count a path inside markdown link syntax

**File:** `src/cli/commands/build-manifest.ts:112,196`

**Issue:** `PATH_TOKEN = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g` scans the manifest's first cell for
path-shaped tokens. If a manifest row ever writes its file cell as a markdown link —
`[game.ts](src/rules/game.ts)` — the regex matches twice: `game.ts` (from inside the `[...]`)
and `src/rules/game.ts` (from inside the `(...)`), producing two manifest entries where one was
intended. In `drift-check.ts` this can generate a spurious `manifest-file-missing` finding for
the bare `game.ts` entry (since no such file exists at the project root), and in `trace-check.ts`
it can create a phantom, un-ownable file-owner key. All of this phase's own test fixtures and
the documented real-data formats use plain paths, not markdown links, so this is not observed
on real data — flagging as a latent gap rather than a live defect.

**Fix:** No action required unless markdown-link-style manifest cells are observed in practice;
if so, prefer the last (rightmost) match per row, or strip `[...]  (...)`  link brackets before
tokenizing.

### IN-02: `HASH_TOKEN` in `extractVerifiedCommitHash` silently truncates hashes longer than 40 hex chars

**File:** `src/cli/commands/build-manifest.ts:241`

**Issue:** `HASH_TOKEN = /\`?([0-9a-f]{7,40})\`?/` is not anchored and caps the capture group at
40 characters. A hand-typed or malformed `## Verified Commit Hash` value with more than 40
contiguous lowercase-hex characters (e.g. a hash accidentally concatenated with another hex
string) is silently truncated to the first 40 characters rather than rejected outright.
`drift-check.ts`'s own `HASH_SHAPE` re-validates the *extracted* value and would still route a
malformed-but-hex-shaped truncation to `git`, which will simply fail to resolve it and correctly
fall through to `drift-unknown` — so there is no correctness or security consequence today, only
an opaque failure mode a user would have to debug by inspecting `CHUNK.md` themselves rather than
getting a clear "hash malformed" message.

**Fix:** Optional. If tightened, anchor the token to a full-length boundary (`\b`) so an
over-long hex run fails to extract at all rather than silently truncating.

---

_Reviewed: 2026-07-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
