---
phase: 173-verify-pipeline-core
reviewed: 2026-07-28T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/cli/commands/ingest-archive.ts
  - src/cli/commands/ingest-archive.test.ts
  - src/cli/commands/verify-run.ts
  - src/cli/commands/verify-run.test.ts
  - src/cli/commands/install-claude-command.ts
  - src/cli/commands/install-claude-command.test.ts
  - src/cli/cli.ts
  - src/cli/slash-command/bs/verify-game.md
  - src/cli/slash-command/bs/verify/source-resolution.md
  - src/cli/slash-command/bs/verify/staging-dispatch.md
  - src/cli/slash-command/bs/verify.test.ts
  - src/cli/slash-command/bs/ingest/transcription-subagent.md
  - src/cli/slash-command/bs/ingest/transcription.md
  - src/cli/slash-command/bs/ingest.test.ts
findings:
  critical: 1
  warning: 1
  info: 3
  total: 5
status: issues_found
---

# Phase 173: Code Review Report

**Reviewed:** 2026-07-28
**Depth:** standard
**Files Reviewed:** 14 (listed above; `install-claude-command.test.ts` reviewed as fixture context)
**Status:** issues_found

## Summary

The four `ingest-archive.ts` "existing-INDEX branch" root causes (T-173-01/02/03) are genuinely
closed: the existence probe is isolated outside any write-performing `try`, `Source hash:`/
`Transcribed:` are insert-if-absent via `findLabelLine` rather than blind `.replace()`, the
`Source:` wrap-safe logic correctly checks the already-canonical case *before* the bare-path/prose
branch (so idempotence holds across a second run), and a repair error can no longer fall through to
a scaffold overwrite because the two write paths are no longer sharing a `try`. Traced through B1–
B12 in `ingest-archive.test.ts` by hand against `repairExistingIndex`; all hold.

`verify-run.ts`'s staging-tree allocator and traversal guards are sound (`RUN_ID_RE` +
resolve-and-prefix belt-and-suspenders in `stagingSlicesDir`, and an independent `--slice`
resolve-and-prefix check in `verifyRunRecordCommand`). The ledger correctly orders "confirm the
slice is on disk, non-empty, and in-staging" before any append, and read-time handling of malformed
lines / hash mismatches degrades to "not recorded" rather than throwing. `run-id` is minted only by
the command; skill text never composes one. Fence constants are distinct across `GAPS_BEGIN`,
`VERIFIED_AGAINST_BEGIN`, and `RUN_LEDGER_BEGIN`. No classification/comparison vocabulary anywhere
in the new skill text (verified against the module's own drift-guard tests). The
`transcription-subagent.md` generalization is surgical — both load-bearing sentences ("RETURN a
structured summary only…", the never-writes/never-re-reads framing) survive verbatim, and a
structural no-fork test guards the verify side from ever restating the contract body.

One finding contradicts a guarantee the module's own doc comment states as fact, which matters
because Phase 174 will build on that stated guarantee.

## Critical Issues

### CR-01: `verify-run.ts`'s crash-safety claim is false — every ledger write is a full-file truncate+rewrite, not an append

**File:** `src/cli/commands/verify-run.ts:24-27`, `160-167`, `389`, `259`

**Issue:** The module doc comment states: *"a torn append can damage at most the final line, and a
line that does not parse as a well-formed record is read as NOT recorded rather than as an error or
as complete — this is what makes resume safe (T-173-13)."* This is not what the code does.
`appendLedgerLine` builds the *entire* new file content in memory (`ledgerText.slice(0, bodyStart) +
body + ledgerText.slice(endIdx)`, line 166) and `verifyRunRecordCommand` writes it with
`await fs.writeFile(ledgerFile, newText)` (line 389) — `fs.writeFile`'s default flag is `'w'`, which
truncates the file to zero length at `open()` and then writes the new content from offset 0. This is
a full rewrite, not a POSIX append (`O_APPEND`). Consequently:

- A process kill between the truncate and the first `write()` syscall completing leaves a
  zero-byte (or partially-written) `RUN.md` — not just the newest record damaged, but every
  *previously durably-recorded* unit in that run lost in one shot.
- Because every `verify-run-record` call re-truncates and rewrites the whole file, EVERY historical
  record is re-exposed to loss on every subsequent call, for the lifetime of the run — not merely
  "the final line" at the moment of the specific crash the comment describes.

This is a distinct root cause from the already-documented Finding 2 (fence-wording gap): Finding 2
describes a documentation-precision issue about what happens when a crash destroys the trailing
fence. This finding is that the underlying write primitive itself is not append-safe at all, so the
"at most the final line" framing is inaccurate as a description of the actual failure envelope — a
crash can destroy any or all of a run's recorded progress, not just its newest record. The read path
correctly throws a "missing machine-owned fences" error in the worst case (so it fails loud, not
silent), but the practical consequence for a long verify run is that a crash near the end can force
re-dispatching the *entire* run's already-completed units, which is the exact failure mode VERIFY-08
exists to prevent.

**Fix:** Use a true append for the record write, and a durable create for `renderEmptyRunMd`, e.g.:

```ts
// verifyRunInitCommand — atomic create, never touches an existing file's bytes:
await fs.writeFile(ledgerFile, renderEmptyRunMd(runId), { flag: 'wx' }); // fails if it exists

// appendLedgerLine's caller — true append instead of read-whole-file/rewrite-whole-file:
await fs.appendFile(ledgerFile, `${JSON.stringify(record)}\n`, { flag: 'a' });
```

This requires restructuring `appendLedgerLine`/`locateFences` slightly (the END fence can no longer
live at a fixed offset that a later append writes "before" — e.g. write records unfenced and treat
end-of-file as the boundary, or keep the END fence but rewrite only via a fresh temp-file +
`fs.rename` — an atomic filesystem operation whose interrupted state is either the old file or the
new file, never a mix) so a crash mid-write can never regress previously-durable content. At minimum,
the doc comment's "at most the final line" claim needs correcting to match what `fs.writeFile`
actually guarantees, since Phase 174 is likely to build resume-safety assumptions on this text.

## Warnings

### WR-01: `repairExistingIndex` can corrupt document structure when `Edition:`/`Source:` are both absent from an existing INDEX.md

**File:** `src/cli/commands/ingest-archive.ts:656-660`, `666-676`

**Issue:** When an existing INDEX.md has no `Edition:` line at all (not merely a stale one),
`repairExistingIndex` inserts the sentinel at the *very start of the string*:

```ts
} else if (!editionLine) {
  text = `Edition: ${EDITION_UNKNOWN}\n\n${text}`;
}
```

and the equivalent branch for a wholly-absent `Source:` line with no `Edition:` present does the
same (`text = \`Source: ${relArchivePath}\n\n${text}\`;`, line 675). Both prepend unconditionally
ahead of whatever is at offset 0 of the *existing* file — which, for every real fixture in this
suite, is `# Rulebook Index — <name>` (the H1 title). The result is a header line landing above the
document's own title:

```
Edition: not stated in the rulebook

# Rulebook Index — seven

...
```

This is untested: every B-series fixture in `ingest-archive.test.ts` includes a real `Edition:` line
(`SEVEN_EDITION`), so this path never executes in the suite. It's a real, if narrow, gap — an
INDEX.md hand-authored or produced by an older/different tool without a `Edition:` header would hit
it. Given `repairExistingIndex`'s whole purpose is repairing arbitrary pre-existing INDEX.md shapes
(decision 1b explicitly exists because real designer files diverge from the emitted template), this
edge is inside the stated scope, not outside it.

**Fix:** Locate the title line (`^# .*$`) and insert after it (falling back to offset 0 only when no
title line exists either), the same way the `Source:`-absent-but-`Edition:`-present branch already
inserts relative to a located anchor rather than at a fixed offset.

## Info

### IN-01: Dead/misleading `restOfLine` computation in the wrapped-prose `Source:` repair branch

**File:** `src/cli/commands/ingest-archive.ts:682-684`, `698`

**Issue:** `findLabelLine`'s regex (`^${label}(.*)$`, `m` flag, no `s` flag) always matches to the
end of the physical line, so `sourceLine.end` is always the position immediately before the line's
own `\n` (or end-of-string). `text.indexOf('\n', sourceLine.end)` therefore always returns
`sourceLine.end` itself when a following line exists, making `restOfLine = text.slice(sourceLine.end,
lineEnd)` provably `''` in every reachable case — the concatenation `sourceLine.value + restOfLine`
on line 698 is equivalent to `sourceLine.value` alone. The comment above it ("leaving the prose
intact, rejoined with its continuation") describes behavior this line doesn't perform — the actual
continuation preservation happens via `text.slice(lineEnd === -1 ? sourceLine.end : lineEnd)` further
down, unrelated to `restOfLine`. Not a functional bug (the output is correct either way), but dead
code paired with a comment that misattributes what makes the fix work, which will mislead the next
person who touches this function under time pressure.

**Fix:** Remove `restOfLine` and the `lineEnd`/`restOfLine` pairing entirely; use `sourceLine.value`
directly, and let the comment describe the real mechanism (`text.slice(lineEnd)` preserving
everything after the label line).

### IN-02: Stale "5 skill dirs" counts left in three comments after this phase raised the count to 7

**File:** `src/cli/commands/install-claude-command.ts:84`, `118`, `313`

**Issue:** This phase's commit (`b18a933b`) added `bs-verify-game` as `SKILL_ENTRY_POINTS`'s 7th
entry and updated the top-of-file doc comment to list all seven skills, but left three other
comments referencing a stale count of "5": `ownedPaths`'s doc comment ("the 5 `bs-<name>/` skill
dirs", line 84), `copySkillTree`'s doc comment ("5 SKILL.md entry points", line 118), and
`uninstallClaudeCommand`'s inline comment ("the 5 skill dirs", line 313). None of these were ever
accurate even before this phase (the count was 6 once `bs-generate-ai` shipped), but this phase
touched this exact file and fixed one of the four stale-count sites without fixing the other three.

**Fix:** Replace the hardcoded counts with `${SKILL_ENTRY_POINTS.length}` in template literals, or
drop the specific number from the prose entirely, so a future addition can't strand a fourth stale
count.

### IN-03: `runDir` computed and discarded via `void` in `verifyRunInitCommand`

**File:** `src/cli/commands/verify-run.ts:248`, `279`

**Issue:** `const runDir = runRootDir(projectDir, runId);` is computed and then explicitly discarded
with `void runDir;` right before the function returns — it's never read for any purpose. This reads
as leftover code from an earlier draft (a debug log, or a field later removed from the result
object) rather than an intentional no-op.

**Fix:** Delete both the declaration and the `void` statement; `runRootDir` is only needed inside
`ledgerFilePath`, which already computes it independently.

---

_Reviewed: 2026-07-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
