---
phase: 147-bs-check-status-insert-chunk
reviewed: 2026-07-05T02:13:59Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/slash-command/bs/check-status.md
  - src/cli/slash-command/bs/insert-chunk.md
  - src/cli/slash-command/bs/status-tools.test.ts
  - src/cli/slash-command/bs/build-chunk.md
findings:
  critical: 0
  warning: 4
  info: 1
  total: 5
status: issues_found
---

# Phase 147: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-05T02:13:59Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Re-review after the iteration-1 fix commits (e2762248..d33ee5b8). I verified each claimed
fix against `.planning/bs-skills-plan.md` (§/bs-check-status, §/bs-insert-chunk),
`bs/state-machine.md` (Session Lock, Write Order, Consistency Check), and
`templates/SKETCH.template.md` (## Mandated Chunks). I also walked insert-chunk's five
operations (a)-(e) and the mandated-chunk deletion guard end-to-end.

**All seven prior findings are genuinely resolved:**
- **CR-01** — the Mandated-Chunks guard (insert-chunk.md:47-63) now rejects `remove` of a
  mandated chunk, not just reorders, and requires an explicit same-role replacement ("never
  as a silent drop"). Coherent with the template's three mandated invariants.
- **WR-01** — the Ordered Chunk List edit is now enumerated as operation (e) with explicit
  write-order placement (rewrite list first, version line last, single SKETCH.md write).
- **WR-05** — insert-chunk.md:20-30 adds the live (non-stale) lock check mirroring build-chunk
  Step 0 outcome 2.
- **WR-02** — no `Phase 147` string remains anywhere in build-chunk.md (grep-confirmed); the
  regex at status-tools.test.ts:303 now forbids it in any form.
- **WR-03 / WR-04** — check-status Item 7 covers detailed-but-unstarted and undetailed-tail;
  Item 3 guards the not-yet-detailed case before reading Revision Rounds.

The full `status-tools.test.ts` suite (37 tests) passes.

Remaining findings below are (1) an under-scoped live-lock guard that contradicts the very
section it cites, (2) an ordering-presentation footgun in the operations list, (3) a
dangling intra-file "the heading below" reference, and (4) a pre-existing stale-chunk gap in
check-status Item 2. None are blockers — these are markdown agent-instruction files (no
executable code but the test, which passes), and the SKETCH.md derived-pointer clobber in
WR-01 below is backstopped by the version stamp + CHUNK.md-wins authority rule.

## Warnings

### WR-01: insert-chunk live-lock guard is narrower than the ## Session Lock rule it cites

**File:** `src/cli/slash-command/bs/insert-chunk.md:24-29`
**Issue:** The WR-05 fix warns only when the lock "names a chunk this reshape will stale-mark
or reorder." But this skill ALWAYS rewrites the *entire* `## Ordered Chunk List` and bumps the
version stamp (operations d + e), so its write footprint is the whole `SKETCH.md`, not just the
reshaped entries. `state-machine.md` "## Session Lock" is unconditional: "Any other lock (less
than 24 hours old, naming different work) is treated as a live concurrent session and triggers
the warning." build-chunk.md Step 0 outcome 2 (which this fix claims to mirror) likewise fires
on a lock that "names different work than this session is about to touch." Concrete miss: a live
build session holds the lock on chunk `Z`; the user asks to `add` an unrelated chunk `W`.
insert-chunk's narrowed condition does not warn, proceeds, and rewrites the full ordered list
(including `Z`'s line) + version bump — silently overlapping the build session's in-flight
SKETCH.md derived-pointer write for `Z`. Either the narrowing is a real gap or the citation to
"## Session Lock" / build-chunk outcome 2 is misleading.
**Fix:** Warn on ANY live (non-stale) lock naming work other than the reshape, since the full
list rewrite touches every entry:
```
if the `Session Lock:` note names ANY chunk and the lock is NOT stale — because this reshape
rewrites the whole `## Ordered Chunk List` and bumps the version stamp, it can overlap any live
build session's SKETCH.md write — warn the user and STOP, exactly as build-chunk.md Step 0
outcome 2 does for a lock naming different work. (state-machine.md "## Session Lock": any live
lock naming different work triggers the warning.)
```
(Severity WARNING, not BLOCKER: the version-stamp bump lets the build session detect the change,
and the "CHUNK.md wins, SKETCH.md repaired to match" authority rule self-heals a clobbered
derived pointer on the next consistency check.)

### WR-02: Operations listed "in order" put version-bump (d) before list-edit (e), but the write order requires (e) first

**File:** `src/cli/slash-command/bs/insert-chunk.md:34, 83-95`
**Issue:** Line 34 states "Every reshape ... runs all of the following, in order," then lists
(d) version-stamp bump *before* (e) Ordered Chunk List edit. The actual required physical write
sequence is the reverse: within the single SKETCH.md write, rewrite the list FIRST, then the
`Sketch Version:` line LAST (state-machine.md "## Write Order": Status/version line written
last). An agent that reads "(d) then (e), in order" literally will write the version line before
the list — the exact inversion the Write Order rule forbids. This cuts against the Pit-of-Success
mantra (the easy path — follow the numbered order — becomes the wrong path). It is mitigated by
three clarifying restatements (op d line 86-87, op e line 92-94, Write Order 97-104), so it is a
robustness/clarity issue rather than a guaranteed bug.
**Fix:** Reorder the enumeration so (e) precedes the version bump, or relabel: e.g. "(a)-(c)
run in order; the SKETCH.md write then rewrites the list (e) and stamps the new version (d)
LAST." Make the numbered order match the write order so "follow the list top-to-bottom" is
correct by construction.

### WR-03: "remove is a first-class operation (see the heading below)" points to a heading that does not exist

**File:** `src/cli/slash-command/bs/insert-chunk.md:58`
**Issue:** The CR-01 guard text says "`remove` is a first-class operation (see the heading
below)." There is no `remove` heading anywhere in the file — the headings under "## The
Operations" are (a) dependency-order, (b) citation-overlap, (c) stale-marking, (d) version bump,
and (e) Ordered Chunk List edit. `remove` is a reshape *type* (add/reorder/split/remove) folded
into operation (e), not a standalone operation with its own heading. The cross-reference dangles.
This is precisely the class of intra-file pointer drift the STAT-02 test guards for cross-file
pointers, but the test does not cover intra-file headings, so it slips through green.
**Fix:** Repoint to op (e) explicitly: "`remove` is one of the four reshape types operation (e)
performs, so a 'remove the final-acceptance chunk' request is a reachable delete path this guard
must block." Drop "see the heading below."

### WR-04: check-status Item 2 has no handling for a `stale — re-derive before build` current chunk

**File:** `src/cli/slash-command/bs/check-status.md:42-50`
**Issue:** Item 2 derives the current chunk as the first entry whose derived status is neither
`verified` nor `verified (user-waived)` — which includes a chunk whose Status reads
`stale — re-derive before build`. For a stale chunk, Item 2 then instructs "read that chunk's
`## Step Checklist` and report the current step as the first unchecked `- [ ]` item." But
build-chunk.md Step 2 (line 78-79) and "Status Enum and Stale Marker" (line 344-350) say a stale
chunk "stops routing instead" — its checklist is invalid pending re-derivation, so reporting a
"current step" off it is misleading. Item 2 cites build-chunk Step 2 as its authority but omits
the stale carve-out that authority defines. (Pre-existing; not introduced by the iteration-1
fixes, but surfaced by the Item-2/Item-7 walk this review was asked to perform.)
**Fix:** Add a stale guard to Item 2 parallel to the not-yet-detailed guard: "If the current
chunk's Status reads `stale — re-derive before build` (state-machine.md "Status Enum (exact)"),
report it as 'stale — awaiting re-derivation' and do NOT report a step off its checklist; the
checklist is invalid until `/bs-insert-chunk`'s re-derivation runs (build-chunk.md 'Status Enum
and Stale Marker')."

## Info

### IN-01: check-status Item 7 third bullet is unreachable given Step 0's early exit

**File:** `src/cli/slash-command/bs/check-status.md:87-88`
**Issue:** Item 7's third bullet ("If nothing has started yet (no `SKETCH.md`, caught at Step 0
above), the next command is `/bs-ingest-rules`") can never fire: Step 0 (line 26-27) already
stops and returns "no project has been ingested yet" when `SKETCH.md` is absent, so the
seven-item synthesis — and therefore Item 7 — is never reached in that case. The bullet even
acknowledges this ("caught at Step 0 above"), so it is documentation-for-completeness rather
than a live path. Harmless, but a dead branch.
**Fix:** Either drop the bullet or reframe it as a note ("the no-SKETCH.md case is terminal at
Step 0 and never reaches this item; documented here only so the next-command mapping is
complete").

---

_Reviewed: 2026-07-05T02:13:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
