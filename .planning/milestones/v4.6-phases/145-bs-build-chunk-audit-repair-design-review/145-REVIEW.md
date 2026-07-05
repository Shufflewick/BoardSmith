---
phase: 145-bs-build-chunk-audit-repair-design-review
reviewed: 2026-07-04T19:05:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/slash-command/bs/build/audit.md
  - src/cli/slash-command/bs/build/repair.md
  - src/cli/slash-command/bs/build/design-review.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 145: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04T19:05:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Re-review of iteration 2 (commits `ff9fe279..5e813f2b`) confirming the fixes for CR-01 and
WR-01..04 from iteration 1, and scanning for new defects the fixes introduced.

**CR-01 width fix — VERIFIED CORRECT.** Cross-checked `design-review.md`'s capture table
(lines 106–110) against `src/ui/theme.ts:18` tier boundaries (`compact ≤639px · medium
640–1023px · wide ≥1024px`) and the `BREAKPOINTS` constant (compact:640, medium:1024,
wide:1440):

| Tier | Range | Capture width | Lands correctly? |
| --- | --- | --- | --- |
| compact | ≤639 | **375** | 375 < 640 → compact ✓ |
| medium | 640–1023 | **800** | 640 ≤ 800 ≤ 1023 → medium ✓ |
| wide | ≥1024 | **1440** | 1440 ≥ 1024 → wide ✓ |

All three representative widths land squarely inside their intended tiers, and the
tier-name → filename mapping (`compact-*` / `medium-*` / `wide-*`) matches the tier that
actually renders at each width. The original defect (raw `BREAKPOINTS` values rendering the
tier *above* the intended one, e.g. 640 → medium) is fully resolved. The explanatory prose at
lines 96–104 ("ceilings of the tier below") is also consistent with `theme.ts`'s own
`BREAKPOINTS.compact` / `BREAKPOINTS.medium` doc comments.

**Other fixes confirmed:**
- WR-01 (visibility lens): `audit.md:70–90` now instructs the lens to read the raw slice +
  `RULINGS.md` as ground truth and treat the Visibility Declaration as a *claim to verify*, not
  an oracle — a disagreement is itself a finding. Correct.
- WR-02 (three dispositions): `repair.md:9–33` cleanly separates two *repair actions* (fix,
  refute-with-citation) from three *terminal dispositions* (`fixed | deferred | refuted`), and
  the enum matches `templates/CHUNK.template.md:110`. The "WR-02 atomic overload" citation in
  `audit.md:86,120` is accurate — `diffPlayerViews(testGame, seatA, seatB)` is a real overload
  in `src/testing/view-diff.ts:187` and the WR-02 label is baked into that source (line 177),
  so the citation is grep-verifiable, not a phantom reference.
- WR-03 (design-review parity): `design-review.md:33–53` returns the same flat
  `{ findingId, lens: 'design', description, citation, severity }` shape and stable-ID
  convention (F1, F2, …) as `audit.md`'s three lens templates.
- WR-04 (first-UI-chunk baseline): `design-review.md:155–162` records "no prior UI chunk;
  cohesion baseline established" and skips the diff without hallucinating a directory. Correct.

All 74 drift-protection tests in `build-chunk.test.ts` pass. The cited APIs
(`diffPlayerViews`, `assertNoHiddenInfoLeak`) exist and are exported via `boardsmith/testing`.

No new blockers. One warning and two info items below.

## Warnings

### WR-01: Theme-injection instruction leads with the wrong DOM (outer page vs. iframe)

**File:** `src/cli/slash-command/bs/build/design-review.md:119-122`
**Issue:** The theme-injection step tells the design-review agent to "Set the theme by
injecting `document.documentElement.dataset.theme` (or the GameShell iframe's own
`contentDocument` …)". The screenshots this agent captures are of the **GameShell iframe's**
seat view (platform mode) — `applyTheme()` injects the token `<style>` and reads
`html[data-theme]` inside the *iframe's* document (`theme.ts:204,209`). Setting
`dataset.theme` on the **outer page's** `document.documentElement` is a no-op for the iframe
content that is actually screenshotted, so an agent taking the path-of-least-resistance
reading (the first, unparenthesized option) would capture 6 shots that are all in the *same*
(default) theme while believing it toggled light/dark — a broken dark-theme layout would pass
review unseen. The correct target (iframe `contentDocument`) is buried as a parenthetical
alternative rather than being the required path. This is the same class of "the easy path is
the wrong path" footgun the CR-01 fix just eliminated for widths, applied to themes; it
violates the repo's Pit-of-Success rule (`CLAUDE.md`).
**Fix:** Make the iframe `contentDocument` the primary, non-optional target and demote the
outer-page form to an explicit "does NOT work" warning, mirroring how the iframe-resize caveat
(lines 124–128) and `--no-open` (lines 64–71) are written as required-not-optional:
```
Set the theme by injecting the tier's theme onto the **GameShell iframe's own document**:
`iframe.contentDocument.documentElement.dataset.theme = 'dark'` (the iframe renders the seat
view in platform mode, so its own document — NOT the outer page's `document.documentElement` —
is where `applyTheme` reads `html[data-theme]`). Setting `data-theme` on the outer page does
NOT re-theme the iframe content and silently yields same-theme screenshots.
```

## Info

### IN-01: "3 Breakpoints" header labels tiers, contradicting the section's own thesis

**File:** `src/cli/slash-command/bs/build/design-review.md:87` (heading + line 79)
**Issue:** The capture section is titled "3 Breakpoints × 2 Themes = 6 Screenshots" and refers
to "3 Breakpoints", yet the section's whole point (lines 96–104) is that the three
`BREAKPOINTS` *values* are tier boundaries, NOT capture widths, and that you must capture at
representative widths *inside* each tier. Calling the three captures "breakpoints" reintroduces
exactly the conflation the section warns against; they are tiers (compact/medium/wide).
**Fix:** Rename to "3 Tiers × 2 Themes = 6 Screenshots" and use "tier" over "breakpoint" for
the three captures, reserving "breakpoint" for the `BREAKPOINTS` boundary constants.

### IN-02: Wide capture at exactly 1440 leaves the uncapped-wide range (1024–1439) unscreenshotted

**File:** `src/cli/slash-command/bs/build/design-review.md:110`
**Issue:** The wide capture width is 1440, which equals `BREAKPOINTS.wide` — the width at which
"the board gains a centered max-width cap" (`theme.ts:25`). Capturing exactly at the cap
boundary means the wide tier's *uncapped* sub-range (1024–1439, the common laptop range) is
never screenshotted. Unlike the CR-01 defect this does NOT land in the wrong tier (1440 is
correctly ≥1024 → wide), so it is a coverage nuance, not a tier error — but a layout bug that
manifests only in uncapped wide would pass review unseen, the same failure mode CR-01 fixed one
level down. The doc reasons about the choice explicitly ("also exercising the max-width cap"),
so this is a documented tradeoff, not an oversight.
**Fix:** Optional — either keep 1440 (accepting the tradeoff, as documented) or choose a
representative uncapped-wide width (e.g. 1200) and note the cap is exercised separately. No
action required if the cap-active layout is the priority.

---

_Reviewed: 2026-07-04T19:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
