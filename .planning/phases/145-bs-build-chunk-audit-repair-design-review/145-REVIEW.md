---
phase: 145-bs-build-chunk-audit-repair-design-review
reviewed: 2026-07-04T23:56:49Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/slash-command/bs/build/audit.md
  - src/cli/slash-command/bs/build/repair.md
  - src/cli/slash-command/bs/build/design-review.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 145: Code Review Report

**Reviewed:** 2026-07-04T23:56:49Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 145 authored the `{audit, repair}` step group and the screenshot-armed design-review
agent for `/bs-build-chunk`. These are LLM-executed instruction files, so "bugs" are contradictions,
wrong API/constant claims, and lifecycle-rule violations that would misdirect a build-chunk session.

I verified every load-bearing external claim against source:

- `diffPlayerViews(testGame, seatA, seatB)` atomic overload — **exists** with that exact signature
  and `{ onlyInA, onlyInB, attributeDiffs, describe() }` return (`src/testing/view-diff.ts:187-245`,
  WR-02 warning at 160-166). Correct.
- `assertNoHiddenInfoLeak(...)` — **exists** (`src/testing/dom-leak.ts:458`). Correct.
- `BREAKPOINTS` values `640 / 1024 / 1440` — **match** `src/ui/theme.ts:20-27` byte-for-byte.
- `npx boardsmith dev --no-open` and the exact ready line `Ready! Press Ctrl+C to stop.` —
  **both real** (`src/cli/cli.ts:40`, `src/cli/commands/dev.ts:788,791`).
- Theme injection via `document.documentElement.dataset.theme` — **correct** mechanism
  (`html[data-theme="light|dark"]` selectors, `src/ui/theme.ts:204-209`).
- All cross-file heading citations resolve (redteam.md "Independence…"/"Persisting the Round"/
  "Vote-Privacy", build.md "Extends, Never Restructures", test.md "Failures Loop Back", scaffold.md
  "Verification Sequence" steps 2-3, state-machine.md "Repair Loop Bound"/"Rulings Outrank Rulebook").
- The auditor-reads-interpretation guard is present in all three lens dispatch prompts.
- Server-kill is an explicit numbered step in design-review.md, and the `networkidle` caveat is present.
- Drift test `build-chunk.test.ts` — **74/74 green** with the new files.

The API/constant/CLI surface is accurate. The defects are conceptual: one breakpoint-capture
correctness bug that would screenshot the wrong responsive tier for 2 of 3 breakpoints, plus four
independence/edge-case/contradiction gaps in the lifecycle prose.

## Critical Issues

### CR-01: design-review captures the WRONG responsive tier for `compact` and `medium`

**File:** `src/cli/slash-command/bs/build/design-review.md:57-80`
**Issue:** The capture loop instructs the agent to set the iframe width to the raw `BREAKPOINTS`
values — `compact: 640`, `medium: 1024`, `wide: 1440` — and screenshot at each ("For each of the 3
breakpoints, capture both themes"; line 76 confirms it drives `iframe.style.width` to "simulate the
compact breakpoint"). But those constants are tier **ceilings/thresholds**, not representative widths
of each tier. `src/ui/theme.ts:18` documents the tiers explicitly: `compact ≤639px · medium
640–1023px · wide ≥1024px`, with `compact: 640` = "Phone ceiling — below this is the compact tier"
and `medium: 1024` = "Tablet ceiling — at/above this is the wide/desktop tier".

Consequence when the agent uses the values as capture widths:
- width `640` → renders the **medium** tier, but the file is saved as `compact-*.png`.
- width `1024` → renders the **wide** tier, but the file is saved as `medium-*.png`.
- width `1440` → renders wide (correct).

So 2 of the 3 screenshots review the wrong layout. The compact tier is **never** actually captured,
which defeats the entire purpose of a per-breakpoint sweep — a broken compact/phone layout would pass
review because it was never rendered. This also contradicts the plan (`bs-skills-plan.md:133`: "the
three Slate breakpoints", i.e. the three *tiers*, not the three threshold numbers). Note `1440` is a
fourth concept entirely (the wide-tier max-width cap, `theme.ts:26`), not the wide-tier *boundary*
(which is 1024).

**Fix:** Capture at widths that fall clearly *inside* each tier, while still citing `BREAKPOINTS` for
provenance. For example:

```
Capture at a representative width INSIDE each tier (BREAKPOINTS are tier boundaries, not target
widths — theme.ts:18: "compact ≤639px · medium 640–1023px · wide ≥1024px"):
- compact  → set iframe width to 375 (≤ 639, below BREAKPOINTS.compact)
- medium   → set iframe width to 800 (between BREAKPOINTS.compact 640 and BREAKPOINTS.medium 1024)
- wide     → set iframe width to 1440 (≥ BREAKPOINTS.medium 1024; also exercises the max-width cap)
```

## Warnings

### WR-01: Visibility lens trusts the investigate-produced Visibility Declaration and never reads the raw slice — investigate-level leak errors are uncatchable

**File:** `src/cli/slash-command/bs/build/audit.md:70-85`
**Issue:** The whole thesis of `audit.md` is that lenses read the RAW source, never a prior agent's
summary, so upstream errors "stay visible to something downstream" (lines 11-27). The fidelity lens
correctly reads the raw slice + `RULINGS.md` and is forbidden the Interpretation. But the **visibility
lens** is handed only `{visibilityDeclarationText}` (the investigate-produced `## Visibility
Declaration`) plus the code, and is told to "Report anything… visible to a seat the Visibility
Declaration says should not see it." It never reads the raw slice or `RULINGS.md`. So if `investigate`
mis-judged what should be hidden (e.g. declared a public value as secret, or missed a rule that a
house-rule in `RULINGS.md` makes public), the visibility lens inherits that exact error and can never
catch it — precisely the failure mode this file's "Temptation" section (11-22) exists to prevent,
applied to the Visibility Declaration instead of the Interpretation. This also violates
`state-machine.md:94-96` "Rulings Outrank Rulebook", which names `audit` as a slice-reading agent that
"also reads `RULINGS.md`" — the visibility lens reads neither.
**Fix:** Have the visibility lens *also* read the raw rulebook slice(s) and `RULINGS.md`, and treat
the Visibility Declaration as a claim to verify against them (mirroring how `redteam` checks the
claims list against raw sources), not as an unchallengeable oracle. Add `{slicePaths}` + a RULINGS
read + the "do not treat the declaration as ground truth" instruction to the visibility dispatch
template.

### WR-02: repair.md "Two Allowed Outcomes, Never a Third" contradicts its own three-value disposition enum

**File:** `src/cli/slash-command/bs/build/repair.md:8-21` vs `52-58` and `60-76`
**Issue:** The heading "Two Allowed Outcomes, Never a Third" and the flat assertion "There is no third
outcome" (line 9) say every finding is either `fixed` or `refuted`. But the same file's "Persisting
Dispositions" section (line 53) lists the disposition enum as **`fixed` | `deferred` | `refuted`**, and
the Round-3 triage (60-76) produces `deferred` as a legitimate user-chosen disposition. This matches
`CHUNK.template.md:110` (`disposition: fixed | deferred | refuted`) and `state-machine.md:125`, so
`deferred` is unambiguously a real third disposition — the "Never a Third" framing is what's wrong. An
LLM reading "There is no third outcome" literally could refuse to record a `deferred` disposition, or
be unsure whether a round-3-deferred finding is validly "handled".
**Fix:** Scope the absolute claim to the *per-round repair action*: "During a repair round, repair
itself does exactly one of two things to a finding — fix it, or refute-it-with-citation. (`deferred`
is not a repair action; it is only a user choice at the round-3 triage below, and is the third
terminal disposition alongside `fixed`/`refuted`.)" Remove the unqualified "There is no third outcome."

### WR-03: The design-review (4th) lens has no dispatch template while the other three do

**File:** `src/cli/slash-command/bs/build/audit.md:45-103` and `src/cli/slash-command/bs/build/design-review.md`
**Issue:** `audit.md` gives the orchestrator ready-to-paste "Dispatch Templates" for fidelity,
visibility, and undo (52-99), each pinning the exact independence framing ("Do NOT read
`## Interpretation`", the fixed return-shape fields). The 4th agent — design-review — has **no dispatch
template** anywhere; `design-review.md` describes the agent's behavior in prose but never provides the
copy-paste prompt the orchestrator must send. Because `build-chunk.md`'s Context-Economics rule bars
the orchestrator from reading code/docs itself, the orchestrator must hand the design-review agent a
fully self-contained prompt — and here it must synthesize one from prose, risking an inconsistent or
framing-leaking dispatch (e.g. omitting the "never `## Interpretation`" guard that `design-review.md:17`
requires, or the fresh-context/no-inherited-conversation constraint). The return-shape fields for a
design-review finding are also unpinned (the other three lenses pin `{ findingId, lens, description,
citation, severity }`; design-review only says findings "use the same stable-ID… shape").
**Fix:** Add a "Dispatch Template" block to `design-review.md` (or `audit.md`) matching the other three
lenses: the exact prompt text including the no-inherited-conversation / no-`## Interpretation` framing,
the serve→capture→kill sequence pointer, and the explicit return shape (`lens: 'design'`).

### WR-04: Cohesion-diff step assumes a previous UI chunk's shots exist — first UI chunk is unhandled

**File:** `src/cli/slash-command/bs/build/design-review.md:98-105`
**Issue:** The cohesion-diff pass tells the agent to "diff the 6 fresh shots against the previous
chunk's stored shots in its own `chunks/<slug>/shots/` directory (a different `<slug>`, the most
recently verified UI chunk)". For the **first** `ui: touches|major` chunk in a game there is no prior
UI chunk and therefore no previous `shots/` directory to diff against. The file gives no guidance for
this case, so the agent is left to look for a nonexistent directory — it may error, hallucinate a
comparison, or silently skip cohesion review with no record. This is the exact edge case a lifecycle
step should name explicitly.
**Fix:** Add a first-UI-chunk branch: "If no previously-verified UI chunk exists (this is the first
`ui: touches|major` chunk), the cohesion-diff pass is a no-op — record 'no prior UI chunk; cohesion
baseline established' and skip the diff. This chunk's `shots/` becomes the baseline for the next UI
chunk."

## Info

### IN-01: Dangling citation to a phase-planning research doc that won't ship with the installed skill

**File:** `src/cli/slash-command/bs/build/audit.md:108`
**Issue:** The visibility-APIs section cites "(per 145-RESEARCH.md 'Don't Hand-Roll')". `145-RESEARCH.md`
is a `.planning/` phase artifact; per `build-chunk.md:281-287` the installer copies the `bs/` tree as a
unit, so an end user who installs the skill will not have `145-RESEARCH.md` — the citation resolves to
nothing for them. The rest of the file cites shipped siblings (`state-machine.md`, `build/*.md`,
`templates/*`) which do travel with the skill.
**Fix:** Drop the `145-RESEARCH.md` citation or inline its one-line rationale ("cite the real functions
by exact name, don't describe the check in prose") without pointing at a non-shipped planning file.

### IN-02: Round N+1 re-run scope is ambiguous for the expensive design-review agent

**File:** `src/cli/slash-command/bs/build/audit.md:133-136`
**Issue:** The only-new-findings rule says "a second or third audit round's **lenses**… report only NEW
findings." It's unstated whether the 4th agent (design-review) re-runs each round. Design-review is
expensive (serve → 6 screenshots → kill) and a round triggered by a non-UI fidelity fix may not need a
re-screenshot — but a round that changed UI code should re-capture to catch new visual regressions.
Leaving this implicit risks either wasted dev-server cycles or a missed regression.
**Fix:** State the trigger explicitly, e.g. "the design-review agent re-runs on round N+1 only if that
round's repair touched UI code (a `ui: touches|major` file); otherwise its prior findings carry
forward unchanged."

### IN-03: build-chunk.md's sanctioned-read enumeration never names `## Findings Ledger`

**File:** `src/cli/slash-command/bs/build-chunk.md:15-30`
**Issue:** The Context-Economics rule enumerates the specific CHUNK.md sections the orchestrator may
read — `## Interpretation`, `## Visibility Declaration`, `## Redteam Rounds` — all group-1/2 sections.
Group 3 (this phase) requires the orchestrator to read *and write* `## Findings Ledger` (audit.md:119,
repair.md:52-58), but that section is not added to the enumeration. It's generically covered by "CHUNK.md
is a state file, and reading state files is exactly the orchestrator's job", so this is not a
correctness break — but the explicit list now lags the lifecycle it governs.
**Fix:** Add `## Findings Ledger` to the "In particular, the orchestrator reads…" list, noting it is
both read (round persistence, cold resume) and written (append `### Audit Round N`, record dispositions)
during the `{audit, repair}` group.

---

_Reviewed: 2026-07-04T23:56:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
