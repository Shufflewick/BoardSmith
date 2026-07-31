# WR-07 Decision — `quoteLinesOnly` deny-list vs. allow-list

**Dated:** 2026-07-31 (Phase 178, Plan 01, Task 2)
**Status:** RESOLVED

## Background

WR-07 asks whether `quoteLinesOnly` (`src/cli/commands/verify-derive-check.ts`) should keep its
current deny-list posture (exclude the named annotation-family line-start forms, keep everything
else) or invert to an allow-list (name what counts as quotable content, exclude everything that
doesn't match). It was deliberately deferred twice — first in Phase 177 (out of scope), then again
by 177.1-02 (the port carried the deny-list posture forward unchanged) — and routed to Phase 178
because adding a fourth annotation kind (`Example`) forces the question: an `Example (p.N):` line
is arguably quote-bearing content (it usually quotes or closely paraphrases a worked example's
printed numbers/text) rather than an annotation in the same sense `Derived`/`Visual`/
`Named-but-undefined` are.

## Real consumers of `quoteLinesOnly` (obtained by grep, reproduced verbatim)

```
$ grep -n "quoteLinesOnly" src/cli/commands/*.ts
src/cli/commands/verify-enumerate.ts:5:import { quoteLinesOnly } from './verify-derive-check.js';
src/cli/commands/verify-enumerate.ts:114: * `quoteLinesOnly`'s filter recognizes — and catches a decoration variant it might still miss
src/cli/commands/verify-enumerate.ts:122: * under its own locally-declared convention. They passed `quoteLinesOnly` untouched AND passed a
src/cli/commands/verify-enumerate.ts:137: * `quoteLinesOnly` (`verify-derive-check.ts`) — the SAME decoration-tolerant, backstop-proofed
src/cli/commands/verify-enumerate.ts:145: * if the assembled payload still matches an annotation family after `quoteLinesOnly` — a
src/cli/commands/verify-enumerate.ts:150:  const quotes = quoteLinesOnly(slice.text);
src/cli/commands/verify-enumerate.ts:1334:   * `quoteLinesOnly()` is applied internally before scanning — matching exactly what the real
src/cli/commands/verify-enumerate.ts:1438:      // Scan the REAL quote lines an enumerator actually saw (quoteLinesOnly), never the raw slice
src/cli/commands/verify-enumerate.ts:1442:      const quoteText = quoteLinesOnly(passage).join('\n').toLowerCase();
src/cli/commands/verify-derive-check.ts:79:// readLiveSlices / annotationBody / quoteLinesOnly / enumerateDerivedLines — MOVED wholesale from
src/cli/commands/verify-derive-check.ts:150: * ordered-list markers), returning the annotation-testable body. `quoteLinesOnly` and
src/cli/commands/verify-derive-check.ts:204:export function quoteLinesOnly(sliceText: string): string[] {
src/cli/commands/verify-derive-check.ts:239: * this fix, because its own real `buildEnumeratorPayload`/`quoteLinesOnly` pipeline happened never
src/cli/commands/verify-derive-check.ts:252: * `buildEnumeratorPayload`/`quoteLinesOnly` pipeline already treats it (it is never a quote line
```

Two REAL (non-test, non-definition-site) call sites consume `quoteLinesOnly`'s output:

1. **`verify-enumerate.ts:150`**, inside `buildEnumeratorPayload` — assembles the dual-enumerator
   dispatch payload for CHECK-04. This is the payload that must stay byte-composition-stable per
   this plan's `must_haves`.
2. **`verify-enumerate.ts:1442`**, inside the absence-claim scan — checks whether a claimed-absent
   term appears anywhere in "the REAL quote lines an enumerator actually saw," deliberately
   excluding annotation lines for the reason stated at that call site (an annotation's own text
   would trivially self-contradict an absence claim about the same term).

Both consumers are CHECK-04 machinery. Neither is CHECK-06 (worked-example replay) or TEST-01
(build-side test generation) — those are later plans' new machinery, not existing consumers of
this function.

## The two options

**Option A — invert `quoteLinesOnly` to an allow-list.** Replace "exclude the three (now four)
named annotation-family forms, keep everything else" with "name what IS quotable content, exclude
everything that doesn't match." Closes WR-07 by inversion.

**Option B — keep the deny-list, add `Example` to it, and give CHECK-06 its own separate
allow-list-shaped payload builder.** `quoteLinesOnly` keeps its current shape and gains a fourth
excluded form (`EXAMPLE_LINE_RE`, matching `Example (p.N):` and its multi-page-citation variant).
CHECK-06 (plan 178-02+), which specifically NEEDS the `Example (p.N):` lines it just excluded,
builds its own extraction payload directly rather than reusing `quoteLinesOnly`. Closes WR-07 by
recorded rejection of the inversion.

## Evidence from Task 1 (`178-01-MEASUREMENT/RESULTS.md`)

- **Zero** citation-keyed `Example (p.` lines exist in any of the three reference games today
  (`seven`, `one-two-punch`, `doom-machine` — see `RESULTS.md`'s per-game table, all zero).
  Adding `Example` to the deny-list (Option B) is therefore **measured zero-behavior-change** on
  every line `quoteLinesOnly` currently processes across the entire live corpus: the new
  `EXAMPLE_LINE_RE` predicate has nothing to match today, so `quoteLinesOnly`'s output is
  byte-identical on every existing slice the moment the fourth exclusion is added — this is a
  provable, not assumed, property, and Task 3's behavior spec makes it an explicit test
  assertion (`quoteLinesOnly` output byte-identical on Example-free slices).
- The measured hazard (2 vocabulary-keyed new matches on `seven`'s real quote lines,
  `"example: 5, 5, 5"` / `"example: 5, 6, 7"`) is about the VOCABULARY-keyed regex, not the
  deny-list itself — it is resolved by keeping `Example` out of `VOCABULARY_KEYED_FAMILIES`
  entirely (Task 3's split), independent of which WR-07 option is chosen. It does not favor
  either option directly, but it demonstrates that this corpus already contains real prose that
  superficially resembles the word "example" — exactly the kind of prose an allow-list's
  "what counts as quotable" enumeration would have to get right on the first try, with no
  existing regression corpus to check it against (CHECK-04's 32-line corpus was measured for the
  deny-list's current shape across 177/177.1, never for an allow-list's).
- Task 1 measured `buildEnumeratorPayload` throwing on **zero** slices in either configuration —
  the naive widening's real failure mode is a **silent composition change** (a real quote line
  stripped with no error), not a throw (see `RESULTS.md`'s "Correction" section). This raises the
  cost of getting an allow-list's coverage wrong: a missed "quotable" pattern under Option A
  would silently drop real quoted prose from CHECK-04's payload with no error signal, exactly the
  failure class Task 1 just measured being possible and dangerous. A deny-list addition (Option B)
  has a narrower, independently-testable blast radius: one new named exclusion, checked against
  the full corpus and found to change nothing.

## Chosen: Option B — keep the deny-list, add `Example` to it, and give CHECK-06 its own separate payload builder.

Reasons, on the evidence above rather than by default:

1. **Zero-behavior-change is measured, not assumed, for Option B.** Every one of the three
   reference games has zero `Example (p.` lines today, so adding the exclusion changes nothing
   `quoteLinesOnly` currently emits. Task 3's behavior spec turns this into an explicit test
   (byte-identical output on Example-free slices), so this guarantee is enforced going forward,
   not just true today.
2. **Option A re-opens a question that was already closed and expensively measured.** CHECK-04's
   deny-list-driven payload composition was the subject of 177/177.1's multi-run measurement
   campaign (177-17 through 177.1-05, closed 2026-07-31, `.planning/REQUIREMENTS.md` CHECK-04
   delivery note). An allow-list inversion changes what "quotable" means for EVERY line in EVERY
   slice, not just `Example` lines — the entire 32-line-class corpus that campaign measured would
   need to be re-verified against the new inclusion criteria, for a phase (178) whose actual
   objective (worked-example identification and replay) does not need that inversion to succeed.
3. **CHECK-06 does not need `quoteLinesOnly` to keep `Example` lines in scope.** CHECK-06's
   extraction payload (plan 178-02+) is new machinery being built in this same phase; giving it
   its own payload builder that explicitly INCLUDES `Example (p.N):` lines (the allow-list
   CHECK-06 actually needs) is strictly cheaper and safer than inverting the shared function every
   other CHECK-04 consumer already depends on.
4. **Task 1's measured failure mode (silent strip, not throw) makes an under-specified allow-list
   strictly more dangerous than an under-specified deny-list addition.** A deny-list addition that
   misses nothing simply changes nothing (measured above); an allow-list that misses a quotable
   pattern silently drops it with no error — the exact class of defect Task 1 just proved possible
   in this same payload-construction path.

Task 1's numbers support this reasoning directly rather than contradicting it — the recommendation
in `178-01-PLAN.md` is adopted.
