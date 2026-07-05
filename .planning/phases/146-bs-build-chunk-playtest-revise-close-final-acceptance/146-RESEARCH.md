# Phase 146: `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance - Research

**Researched:** 2026-07-04
**Domain:** Markdown-authored agent skill instructions (Claude Code slash-command reference files) — no runtime code, no npm packages
**Confidence:** HIGH

## Summary

This phase authors four new markdown reference files (`build/playtest.md`, `build/revise.md`,
`build/close.md`, `build/final-acceptance.md`) and edits `build-chunk.md` to replace its 7
remaining "authored in Phase 146" forward-reference markers with live dispatches. Nothing here
is executable code — it is prose consumed by a future Claude Code agent session, structurally
pinned by a drift test (`build-chunk.test.ts`, currently 561 lines, RED/absent for these four
files). The prior four phases (143-145) established every pattern this phase must follow:
lean-orchestrator/fat-reference-file split, citation-not-restatement, gate-before-write, fresh-
context adversarial dispatch, and byte-identical drift pins. This phase's job is almost entirely
faithful transcription of `.planning/bs-skills-plan.md` steps 8-10 into that established shape,
plus wiring the four new files into `build-chunk.md`'s dispatch table, Reference Files list, and
removing every "authored in Phase 146" string.

The two genuinely new mechanics this phase introduces (not present in 143-145's precedent) are:
(1) a **human-driven, non-code test script** (playtest is the first step with no subagent
dispatch at all — the "agent" here is the orchestrator narrating a script to a human and reading
their answers back into CHUNK.md), and (2) a **delta-presentation gate at close** (re-deriving
the sketch tail and showing what changed, mirroring `ask.md`'s gate-before-write discipline but
over SKETCH.md's tail entries instead of a chunk's own CHUNK.md). final-acceptance.md is
prescribed by CONTEXT.md to be a distinct reference file whose design-QA pass may dispatch an
agent "like 145's design-review" — `design-review.md` is the correct analog to extend from
(same dev-host serve→capture→kill lifecycle, same breakpoint/theme matrix), but its SR-playthrough
and colorblind/zoom/touch-target checks are new content this phase must write, since
`design-review.md`'s existing dispatch template only covers token/craft + cohesion-diff, not the
6-point design-QA checklist UIQ-05 requires.

**Primary recommendation:** Write `playtest.md`, `revise.md`, `close.md`, `final-acceptance.md`
as siblings of the existing `build/*.md` files, each opening with the same "Referenced by
`build-chunk.md` Step N ... session group" framing `ask.md`/`design-review.md` use, citing
`state-machine.md` and `templates/CHUNK.template.md`/`SKETCH.template.md` by section name rather
than restating their content, and reusing `CHUNK.template.md`'s existing `## Playtest Test
Script`, `## Verified Checklist`, `## Verified Commit Hash`, and `## Revision Rounds` sections
verbatim (these sections already exist in the template from Phase 141 — this phase is the first
to actually fill them via live prose, not the first to define their shape).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Playtest script authoring/presentation | Orchestrator (`build-chunk.md` dispatch → `build/playtest.md`) | — | No code changes; pure prose/state-file read-write, same tier as `ask.md` |
| Human's own dev-host session (`npx boardsmith dev`) | User's local machine (outside the skill session) | — | User owns the server across the multi-session gap; the skill never starts or controls it |
| Feedback triage (revise) | Orchestrator | — | Orchestrator reads user's spoken feedback, classifies into 4 categories, writes to CHUNK.md/SKETCH.md/RULINGS.md — no subagent needed |
| Close bookkeeping (verified hash, sketch-tail delta) | Orchestrator | — | State-file read/write only; git commit hash capture is a shell command the orchestrator itself runs (same tier `build-chunk.md`'s Git Protocol section already operates at) |
| final-acceptance design-QA pass | Subagent (Task-tool dispatch, `design-review.md` analog) for the automatable checks (screenshots, axe, breakpoints) | Human (orchestrator-narrated) for SR playthrough, colorblind, touch-target confirmation | Mirrors the existing split: `build/test.md`'s a11y floor is automated, `design-review.md`'s craft/cohesion pass is a dispatched agent, but SR playthrough via VoiceOver requires a literal human operating assistive tech — no BoardSmith or Claude Code tool drives a screen reader |
| CI/build system | N/A | — | Out of scope; this phase touches only markdown reference files under `src/cli/slash-command/bs/` |

## Standard Stack

### Core

No new libraries. This phase is markdown authorship only. `## Package Legitimacy Audit` is
therefore N/A — no packages are installed by this phase. (`slopcheck`/registry-verification
steps are skipped per the protocol's own scope: "whenever this phase installs external
packages" — it does not.)

### Supporting

| Tool | Version | Purpose | Confirmed |
|------|---------|---------|-----------|
| `npx boardsmith dev` | current CLI | The one command the playtest script hands the user to run themselves | [VERIFIED: repo — `src/cli/commands/dev.ts`] |
| `npx boardsmith dev --ai <seats...>` | current CLI | AI seat-fill so a solo human can playtest a 3-4 player chunk once actions exist | [VERIFIED: `src/cli/cli.ts:37` — `.option('--ai <players...>', 'Player positions to be AI (e.g., --ai 1 or --ai 2 4)')`] |
| `npx boardsmith dev --players <count>` | current CLI | States seat count explicitly for the script | [VERIFIED: `src/cli/cli.ts:36`] |
| `npx boardsmith dev --no-open` | current CLI | Used by `design-review.md`'s own agent dispatch (never by the human-facing playtest script — the human wants their browser to open) | [VERIFIED: `src/cli/commands/dev.ts` `shouldOpenBrowser`] |
| VoiceOver (macOS built-in) | — | SR playthrough for final-acceptance's design-QA pass | [ASSUMED — training knowledge; not verified via any tool in this session, and CONTEXT.md names it explicitly so it is a locked decision, not a discretion area] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dispatching a Task-tool agent for the SR playthrough | Orchestrator narrates steps, human runs VoiceOver themselves | No agent/tool in this codebase or Claude Code's toolset can drive VoiceOver; this must be human-driven, matching CONTEXT.md's explicit call-out that final-acceptance mixes agent-dispatched and human-driven checks |

**Installation:** none — no packages to install.

## Package Legitimacy Audit

N/A — this phase installs no external packages. All work is authoring markdown reference files
under `src/cli/slash-command/bs/`.

## Architecture Patterns

### System Architecture Diagram

```
SKETCH.md (ordered chunk list)
      │
      ▼
build-chunk.md (orchestrator, Step 2 resume routing)
      │  reads chunks/<slug>/CHUNK.md Step Checklist → first incomplete step
      │
      ▼
Step Group 4: {playtest, one revise round, close}   (state-machine.md "Session Handoff Seams")
      │
      ├─▶ dispatch build/playtest.md ──────────────────────────────────────┐
      │     • orchestrator reads CHUNK.md's build manifest + prior         │
      │       chunk's regression items (no subagent — human-facing)        │
      │     • presents numbered click-by-click script (seat count,         │
      │       dev-host affordances taught once, build stamp, regression    │
      │       line, taste line, second-seat leak check if hidden info)     │
      │     • USER runs `npx boardsmith dev` themselves, plays, answers    │
      │     • orchestrator checks off ## Verified Checklist items 1-by-1   │
      │     • writes Status: verified | verified (user-waived)             │
      │                                                                     │
      │  (if user reports issues) ──▶ dispatch build/revise.md ◀───────────┘
      │     • triage EACH item into (a) this-chunk defect / (b) future     │
      │       scope / (c) not-built-yet / (d) rules change                 │
      │     • (a) → new "### Revise N" entry in CHUNK.md ## Revision       │
      │       Rounds, code fix happens (re-enters build/test as needed)    │
      │     • (b) → SKETCH.md ## Ideas Backlog or hands off to             │
      │       /bs-insert-chunk (Phase 147, forward reference)              │
      │     • (c) → expectation reset, no write                            │
      │     • (d) → new RULINGS.md entry                                   │
      │     • re-entry after a round → disposition report + TARGETED       │
      │       re-test script (not a full re-test)                         │
      │     • loop back to playtest until all (a)-items done               │
      │                                                                     │
      ▼ (chunk closes when all (a)-items resolved, regardless of (b))
   dispatch build/close.md
      • mark Status: verified in CHUNK.md, then SKETCH.md (write order)
      • record `git rev-parse HEAD` as ## Verified Commit Hash
      • roll up DECISIONS.md entries from this chunk
      • re-derive sketch tail (next 2-3 chunks) against rulebook,
        PRESENT AS DELTA for approval (gate-before-write, mirrors ask.md)
      • propose next chunk + its ui: tag
      • print exact next command (non-programmer handoff)
      │
      ▼
Special case: sketch's mandated final-acceptance chunk reaches this same
{playtest, revise, close} group, but its own content is dispatched to
build/final-acceptance.md instead of (or in addition to) the standard
playtest script:
      • coverage check: every non-variant rulebook slice cited by a closed
        chunk (read SKETCH.md's Ordered Chunk List + each CHUNK.md's
        Interpretation citations)
      • design-QA pass (UIQ-05): SR playthrough (human, VoiceOver),
        200% zoom, compact touch targets, colorblind pass, both Slate
        themes, drag-drop keyboard alternates, mobile via iframe-shrink
      • may dispatch a Task-tool agent (design-review.md analog) for the
        automatable portions (screenshots, zoom/breakpoint capture);
        SR playthrough is human-driven, narrated by the orchestrator
      • same playtest/revise/close semantics apply on top of this content
```

### Recommended Project Structure

```
src/cli/slash-command/bs/
├── build-chunk.md              # EDIT: 7 forward-ref markers → live dispatches
├── build/
│   ├── ask.md                  # existing — presentation-gate analog for playtest
│   ├── design-review.md        # existing — design-QA agent analog for final-acceptance
│   ├── playtest.md             # NEW
│   ├── revise.md               # NEW
│   ├── close.md                # NEW
│   └── final-acceptance.md     # NEW
├── state-machine.md            # cite only, no edits expected
└── templates/
    ├── CHUNK.template.md       # cite only — Revision Rounds / Playtest Test Script /
    │                           #   Verified Checklist / Verified Commit Hash sections
    │                           #   already exist from Phase 141; this phase is first
    │                           #   consumer, not first author
    └── SKETCH.template.md      # cite only — Ideas Backlog / Mandated Chunks sections
                                 #   already exist
```

### Pattern 1: Human-Gate Presentation (playtest, following `ask.md`'s shape)

**What:** `ask.md` establishes the template for a fixed-format, human-facing presentation
followed by "gate-before-write": present everything, then negotiate, then write durable state
only after explicit approval, `Status:` written last.

**When to use:** `playtest.md` must reuse this exact shape — the difference is *what* is
presented (a numbered click-by-click test script instead of 4 parts of design) and that this
step has no subagent at all (the orchestrator itself narrates and records — no Task-tool
dispatch).

**Example (from `ask.md`, to mirror in `playtest.md`):**
```
## Gate-Before-Write

Present all four parts, then negotiate: the user's answer wins on any ambiguity in part (b)
unless a hard dependency is violated... Do **not** write anything durable — not `Status:
approved`... until the user has given explicit approval.

Only after that explicit yes:
...
4. Write `Status: approved` to CHUNK.md **last**...
5. Then update this chunk's derived-status pointer in SKETCH.md to match...
```
`playtest.md` mirrors this: present the script, the human plays and answers item-by-item, and
only after every `## Verified Checklist` item is individually confirmed (or the human explicitly
waives) does `Status: verified` (or `verified (user-waived)`) get written — CHUNK.md first, then
SKETCH.md, per `state-machine.md` "Write Order".

### Pattern 2: Fresh-Context Adversarial Dispatch (final-acceptance's automatable checks)

**What:** `design-review.md`'s "Single Fresh-Context Adversarial Dispatch" + "Dev-Host Lifecycle:
Serve → Capture → Kill" + "Capture Loop: 3 Tiers × 2 Themes" sections are the direct precedent
for any Task-tool agent `final-acceptance.md` dispatches for its automatable checks (200% zoom,
compact touch targets, both themes, mobile via iframe-shrink — all screenshot/measurement-driven,
same dev-host `--no-open` / wait-for-`Ready!` / kill discipline).

**When to use:** For the four of six design-QA checks that are screenshot/measurement-based.
The SR playthrough and (per CONTEXT.md) the "does this look colorblind-safe" pass are the two
checks that likely remain human-judgment-driven even if a screenshot is captured — colorblind
simulation could be automated via a filter (e.g. CSS `filter` simulating protanopia/deuteranopia
on the captured screenshots) but this is Claude's Discretion per CONTEXT.md, not a locked
decision; document the choice, do not assume it is automated.

**Example (from `design-review.md`, cite exact BREAKPOINTS values — do not re-derive):**
```
- `compact: 640` (theme.ts:18 — tier ≤639px, capture at 375)
- `medium: 1024` (tier 640-1023px, capture at 800)
- `wide: 1440` (tier ≥1024px, capture at 1440)
```
`final-acceptance.md`'s 200%-zoom and mobile-layout checks should cite these same constants by
name (`src/ui/theme.ts`'s `BREAKPOINTS`) rather than re-deriving new capture widths.

### Pattern 3: Delta Presentation at a Gate (close's sketch-tail re-derivation)

**What:** No existing file in this codebase implements a "delta" gate yet — this is the one
genuinely new presentation pattern this phase introduces. It should follow the same
gate-before-write shape as `ask.md`/`design-ask.md` but present a **diff**, not a fresh proposal:
"chunk 9 split into 9a/9b because X" rather than silently rewriting SKETCH.md's tail entries.

**When to use:** Every `close` step, after marking the current chunk verified, before proposing
the next chunk.

**Example (prose pattern to author, informed by CONTEXT.md's own wording):**
```
Re-derive the sketch tail (the next 2-3 sketch-level entries) against the rulebook now that
this chunk is closed and its citations are settled. Present ONLY the delta — entries that
changed, split, merged, or were newly detailed — never a full silent rewrite of SKETCH.md's
Ordered Chunk List:

  "Chunk 'auction' split into 'auction-basic' and 'auction-improvements' because the rulebook's
  auction rules (p.14) turned out to need two separate playtest gates — the base auction
  mechanic, then the 'buy it now' variant."

Gate this the same way `ask.md` gates the design: present, then require explicit approval before
writing SKETCH.md's Ordered Chunk List. This is a SKETCH.md write, so it follows `state-machine.md`
"Write Order" the same as any other: CHUNK.md's own Status write (verified) happens first (already
complete before this delta step runs), and this SKETCH.md tail-detailing write is a distinct,
later write in the same close step.
```

### Anti-Patterns to Avoid

- **Silent sketch-tail rewrite:** CONTEXT.md explicitly forbids this ("never a silent rewrite").
  Any implementation that regenerates SKETCH.md's tail without presenting the delta first
  violates BUILD-11.
- **Blind full re-test after a revise round:** CONTEXT.md and `bs-skills-plan.md` step 9 both
  forbid this — re-entry must present a **disposition report** (each item, what changed) plus a
  **targeted** re-test script, never a blind restatement of the original script.
- **Treating `Status: built` alone as "awaiting playtest":** `build-chunk.md`'s existing Step 2
  documentation already warns: "a full-ceremony chunk that has not yet run audit/repair also
  reads Status: built; only the checklist position decides." `playtest.md` must not re-litigate
  this — it should assume Step 2's routing already got it here correctly and simply resume at
  the Playtest Test Script's already-recorded text on a cold resume, per the existing
  "awaiting-playtest ... re-pose the pending question verbatim" rule in `build-chunk.md`.
- **A design-QA agent reading CHUNK.md's `## Interpretation`:** per `design-review.md`'s own
  independence discipline, any dispatched agent in `final-acceptance.md` must be fresh-context,
  never inheriting the interpretation or prior framing — mirror this exactly, don't relax it
  because it's the "final" pass.
- **Leaving a server running:** both the repo-wide `CLAUDE.md` hard rule and `design-review.md`'s
  own "Kill" step apply identically to any server `final-acceptance.md`'s dispatched agent
  starts. The playtest script's server is different — it belongs to the user, and the skill
  never starts or kills it (already the case per 145's design-review server being killed before
  this phase's playtest step begins, per CONTEXT.md).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Breakpoint capture widths | New pixel values for compact/medium/wide | `src/ui/theme.ts`'s `BREAKPOINTS` constant (640/1024/1440), captured at 375/800/1440 per `design-review.md`'s existing table | Re-deriving these risks the exact off-by-tier bug `design-review.md`'s own research already documented (driving `iframe.style.width` to the raw BREAKPOINTS value renders the tier *above* the one intended) |
| Dev-host server lifecycle for any dispatched agent | A new serve/wait/kill sequence | `design-review.md`'s "Dev-Host Lifecycle: Serve → Capture → Kill" (exact bash, exact ready-string, exact `--no-open` rationale) | Byte-identical reuse avoids re-introducing the `networkidle`-hangs-forever footgun and the seat-1-stolen-by-real-browser footgun both already solved in Phase 145 |
| Screen-reader announce API | New ARIA live-region plumbing | `useAnnouncer()` from `boardsmith/ui` (Phase 140, `src/ui/composables/useAnnouncer.ts`) | Already ships and writes through GameShell's existing live regions; final-acceptance's SR playthrough step is exercising this existing floor, not building a new one |
| Git commit hash capture at close | A custom commit-tracking file | `git rev-parse HEAD` (or equivalent) recorded straight into CHUNK.md's `## Verified Commit Hash`, per `state-machine.md`'s "Git Protocol" (`close` records the verified commit hash — bisect anchor) | The mechanism already exists in the plan/spec; this phase's job is prose describing when/how to invoke it, not inventing a new tracking mechanism |

**Key insight:** every mechanism this phase's four new files need already has a canonical shape
established by 143-145's precedent files or by `bs-skills-plan.md`/`state-machine.md`'s existing
prose. The risk in this phase is *inventing new mechanisms* where citation of an existing one
would do — CONTEXT.md's "never restated" instruction for the git protocol/lock/handoff sections
is the sharpest version of this warning.

## Common Pitfalls

### Pitfall 1: Restating instead of citing (the dominant risk this phase)

**What goes wrong:** BUILD-13's git protocol, handoff-at-seams, and session-lock content gets
copy-pasted into `build-chunk.md`'s own new prose (or into the four new reference files) instead
of cited by section name.

**Why it happens:** These four new files are the *last* files being authored in a 5-phase
sequence that has established citation discipline everywhere else; the temptation to write a
"complete" playtest/close file that restates `state-machine.md`'s Git Protocol / Session Lock /
Session Handoff Seams sections inline (so the file reads standalone) is real, especially since
close.md must talk about the verified-commit-hash mechanism state-machine.md already fully
specifies.

**How to avoid:** CONTEXT.md is explicit: "Git protocol ... handoff-at-seams, and the session
lock protocol are surfaced in the orchestrator's own sections CITING state-machine.md (BUILD-13)
— never restated." Every mention of git-commit-message convention, lock staleness (24h), or
handoff seam boundaries in the new files/edits must be a citation ("cite `state-machine.md`
'Git Protocol'"), never a restatement of the rule text.

**Warning signs:** Any sentence in the new files that repeats the exact 24-hour staleness number,
the `chunk-<slug>/step-<name>` commit format, or the four session-handoff-seam group names
without an adjacent "(cite state-machine.md ...)" pointer.

### Pitfall 2: Missing the light-path close-bookkeeping reconciliation

**What goes wrong:** `close.md` is authored as if it only applies to full-ceremony chunks,
leaving `build-chunk.md`'s existing Phase-143 light-path note (lines ~146-153, "Light-path status
transitions ... playtest performs close's bookkeeping for light chunks") pointing at content
`close.md` never actually delivers in a form the light path can reuse.

**Why it happens:** The full ceremony's `close` step and the light path's playtest-does-close's-
bookkeeping are two different entry points into the same underlying bookkeeping (verified commit
hash, Status write CHUNK→SKETCH, decision rollup, next-2-3-tail detailing). CONTEXT.md states
directly: "close.md is the full version playtest's light-path bookkeeping pointed forward to" —
meaning close.md's content must be reusable/citable from `playtest.md`'s own light-path section
just as `build-chunk.md`'s existing note already promises.

**How to avoid:** Write `close.md`'s bookkeeping steps (verified-hash capture, Status write
order, decision rollup, sketch-tail detailing) as a self-contained numbered sequence that
`playtest.md`'s light-path section can cite by name (e.g. "see `close.md`'s 'Bookkeeping
Sequence'") rather than duplicating it inline for the light path.

**Warning signs:** `playtest.md` re-describing the verified-commit-hash capture mechanism in its
own words instead of citing `close.md`.

### Pitfall 3: Playtest script presented as a subagent dispatch

**What goes wrong:** Authoring `playtest.md` with a "Dispatch Template" section (the pattern
`redteam.md`/`audit.md`/`design-review.md` all use for Task-tool agents) when playtest has no
subagent at all — it's the orchestrator itself, talking to the human, in the main session.

**Why it happens:** Every other step file in this skill (investigate, redteam, ask... wait, ask
also has no subagent) dispatches or gates via a fixed prompt template; muscle memory from writing
4 of those files might carry the "Dispatch Template" heading into playtest.md where it doesn't
belong.

**How to avoid:** `ask.md` is explicitly the correct analog (per CONTEXT.md and the task
brief) precisely because it also has no subagent — "The ask step has no subagent — the
orchestrator reads these three CHUNK.md sections itself... and restates them below." Model
`playtest.md`'s "Inputs" section on `ask.md`'s, not on `redteam.md`'s.

### Pitfall 4: No build-stamp UI affordance exists in the dev host

**What goes wrong:** Assuming `boardsmith dev`'s UI displays a visible version/commit indicator
somewhere in the dev-host chrome (seat picker, header) that the playtest script can simply tell
the user to "check."

**Why it happens:** It would be a reasonable design for a dev tool to have; CONTEXT.md's own
research targets ask this question directly ("is there a version/build indicator in the dev
host?").

**How to avoid:** [VERIFIED: repo — `src/cli/dev-host/DevHost.vue`] grep of the entire file for
"version"/"commit"/"build" (outside comments about seat/reload mechanics) returns nothing — there
is no build-stamp UI element. The "Build stamp" field CHUNK.template.md's `## Playtest Test
Script` already has (`Build stamp: <commit hash or "not yet built">`) is a *textual* field the
orchestrator fills with the actual commit hash it just captured (or is about to capture) — the
script's job is to tell the human to confirm freshness via **a hard reload of the browser tab**
(`window.location.reload()`/Cmd+R) before starting, not via any on-screen indicator. The stale-tab
footgun is real: Vite HMR keeps a long-open tab's JS module graph live-patched, but a WebSocket
connection surviving across a restart, or a tab left open from a previous session, is the
documented failure mode (`DevHost.vue`'s own comment: "Force a full reload so the whole page
reflects the running game" — used internally after a host restart). `playtest.md` should
instruct: close any existing `boardsmith dev` tab/tabs and open a fresh one after this chunk's
`build`/`test` steps complete, rather than trusting an existing tab's HMR state.

### Pitfall 5: Second-seat leak check has no dedicated dev-host UI beyond the seat switcher

**What goes wrong:** Assuming there's a purpose-built "leak inspector" panel in the dev host for
hidden-info checks.

**Why it happens:** The engine-side visibility lens (`build/audit.md`'s two-seat diff,
`assertNoHiddenInfoLeak` in `src/testing/dom-leak.ts`) is automated and thorough; it's tempting
to assume an equally rich human-facing tool exists.

**How to avoid:** [VERIFIED: repo — `src/cli/dev-host/DevHost.vue`] The mechanism a human has is
exactly: open a second browser tab/window at the same dev-host URL (`http://localhost:<port>`,
default port surfaced by the CLI at startup — see `Ready! Press Ctrl+C to stop.` line and the
printed URL), use the seat switcher dropdown (`Seat N ▾` / `Following ▾` button, `DevHost.vue`
line ~514) to join or switch to the other seat, and visually confirm nothing hidden (opponent's
face-down cards, hand contents) is rendered. This is a plain visual check, not a DevTools/source
inspection instruction — the playtest script should describe the *outcome* to look for ("you
should NOT see the other player's hand — only its back/count"), consistent with the template's
own instruction: "Outcome-based, not gesture-based: describe what should be observed, not just
what to click."

## Code Examples

Verified patterns from official sources (this repo, since the phase is markdown-only):

### Dev-host invocation for the playtest script

```
// Source: src/cli/cli.ts:36-37 [VERIFIED: repo]
.option('--players <count>', 'Initial number of players', '2')
.option('--ai <players...>', 'Player positions to be AI (e.g., --ai 1 or --ai 2 4)')
```

The playtest script's teach-once dev-host affordances line should therefore state the literal
commands available to the user, e.g.:

```
npx boardsmith dev                    # opens your browser, seats you as seat 1
npx boardsmith dev --players 4        # a 4-seat game — open more tabs to be other seats
npx boardsmith dev --ai 2,3,4         # AI fills seats 2-4 so one human can solo-test
```

(`--ai` takes a comma-separated list per invocation or repeated flags, per
`src/cli/commands/dev.ts`'s `parseAiSeats` — `--ai 1,2` or `--ai 1 --ai 2` both valid
[VERIFIED: repo, `src/cli/commands/dev.ts` `parseAiSeats` docstring].)

### Dev-host ready signal (never wait on networkidle)

```
// Source: src/cli/commands/dev.ts:791 [VERIFIED: repo]
console.log(chalk.green('\n  Ready! Press Ctrl+C to stop.\n'));
```

Any agent-dispatched portion of `final-acceptance.md` that automates a server start must wait on
this exact string (or `domcontentloaded`/a selector), per the CLAUDE.md-derived rule already
codified in `design-review.md`'s "Dev-Host Lifecycle" section: "the dev host holds an open
WebSocket connection for real-time play and never reaches network idle; a `networkidle` wait on
this page hangs forever."

### CHUNK.template.md's existing Playtest/Verified/Revision sections (already shipped, Phase 141 — this phase's job is to fill them via prose, not redefine them)

```
// Source: src/cli/slash-command/bs/templates/CHUNK.template.md [VERIFIED: repo, lines 135-172]
## Playtest Test Script
Build stamp: <!-- commit hash or "not yet built" -->
1. <!-- seat 1 step --> — expect: <!-- observable outcome -->
Regression check: <!-- one line -->
Taste check: does anything look off?
Second-seat leak check (if hidden info): <!-- steps, or "n/a — no hidden info in this chunk" -->

## Verified Checklist
- [ ] <!-- item 1 -->

## Verified Commit Hash
<!-- <commit-hash> -->
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A — this is the first authoring of steps 8-10 | N/A | — | This phase has no predecessor implementation to supersede; it is filling forward-reference stubs left intentionally incomplete by Phases 143-145's own scope boundaries |

**Deprecated/outdated:** None applicable — greenfield authoring within an established pattern
set.

## Runtime State Inventory

Not applicable — this is not a rename/refactor/migration phase. It is greenfield authoring of
four new markdown files plus edits to one existing markdown file (removing forward-reference
stub text). No stored data, live service config, OS-registered state, secrets, or build
artifacts are affected.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | VoiceOver is the SR tool the design-QA pass instructs the user to run | Standard Stack / Architecture Patterns | Low — CONTEXT.md itself names VoiceOver explicitly as a locked decision, so this is really a citation of CONTEXT.md rather than an independent research claim; flagged `[ASSUMED]` only because no tool call in this session verified VoiceOver's current macOS invocation steps (Cmd+F5) |
| A2 | Colorblind-pass automation (CSS filter simulation) vs. pure human judgment is left to Claude's Discretion | Architecture Patterns, Pattern 2 | Low — CONTEXT.md explicitly marks "subagent usage" for final-acceptance as discretionary; if the planner locks in automation, no rework needed since discretion was already flagged |

**If this table is empty:** N/A — see above; both entries are low-risk citations of
already-locked CONTEXT.md decisions, included for completeness per the provenance rule.

## Open Questions (RESOLVED — Q1: drag-drop folded into automated design-QA portion reusing test.md item 1, now in 146-03; Q2: fixed before/after/why delta structure in 146-03)

1. **Should `final-acceptance.md`'s design-QA pass be one combined dispatch (all 6 checks in one
   agent) or split (automated checks dispatched, SR/colorblind human-narrated)?**
   - What we know: CONTEXT.md says final-acceptance "may dispatch a design-QA agent like 145's
     design-review" and separately says the SR playthrough exercises `useAnnouncer()` via a
     human running VoiceOver — these can't both be the same dispatched agent, since no tool in
     this repo or Claude Code's toolset drives VoiceOver.
   - What's unclear: the exact split boundary — is colorblind-pass part of the dispatched
     agent's screenshot review (apply a filter to the 6 captured shots) or a separate
     human-driven step?
   - Recommendation: Plan for a hybrid — one dispatched agent handling the 4
     screenshot/measurement-based checks (200% zoom, touch targets, both themes, mobile via
     iframe-shrink, reusing `design-review.md`'s exact capture-loop mechanics) plus a
     human-narrated section for the two checks (SR playthrough, drag-drop keyboard alternates
     end-to-end — this last one *is* automatable via the existing a11y-floor keyboard test
     pattern from `build/test.md` item 1, so it may belong with the automated agent instead).
     Flag this split explicitly in the plan for discuss-phase/checkpoint confirmation since
     CONTEXT.md marks it Claude's Discretion.

2. **Exact wording/format of the close-step delta presentation.**
   - What we know: CONTEXT.md gives one example ("chunk 9 split into 9a/9b because…") and states
     the general shape (never a silent rewrite).
   - What's unclear: whether the delta is presented as a diff-style before/after table, a
     narrative paragraph, or a structured list — no precedent file in 143-145 implements a delta
     presentation (all prior gates present a fresh proposal, not a diff against prior state).
   - Recommendation: Claude's Discretion per CONTEXT.md; the planner should choose a format
     consistent with `ask.md`'s "4-part fixed format" precedent (a fixed, named structure) rather
     than leaving it freeform, so a future audit/drift-test can pin it.

## Environment Availability

Not applicable — this phase's only external dependency is `git` (already required and used by
every prior phase's Git Protocol section) and the reader's own macOS VoiceOver (locked decision,
not a tool this session needs to probe availability for since it runs on the *user's* machine at
playtest time, not in this authoring session).

## Validation Architecture

`.planning/config.json` does not set `workflow.nyquist_validation` — treated as enabled per the
absent-key rule. However, this phase's actual deliverable is markdown prose, not application
code, so "tests" here means the existing drift-test suite pattern (`build-chunk.test.ts`),
which asserts exact strings/structure in the markdown files rather than runtime behavior.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing repo-wide) [VERIFIED: repo, `vitest.config.ts` / existing `*.test.ts` files] |
| Config file | repo root `vitest.config.ts` (unchanged by this phase) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| Full suite command | `npm test` (repo-wide) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUILD-09 | `build/playtest.md` documents numbered click-by-click script, seat counts, dev-host affordances taught once, build stamp, regression line, item-by-item Verified Checklist, `verified (user-waived)` recordable | structural (string/regex match against markdown) | `npx vitest run -t "BUILD-09" src/cli/slash-command/bs/build-chunk.test.ts` | ❌ Wave 0 — new describe block |
| BUILD-10 | `build/revise.md` documents 4-category triage, re-entry disposition report + targeted re-test script | structural | `npx vitest run -t "BUILD-10" src/cli/slash-command/bs/build-chunk.test.ts` | ❌ Wave 0 |
| BUILD-11 | `build/close.md` documents verified-hash recording, sketch-tail delta re-derivation + gate, next-chunk proposal | structural | `npx vitest run -t "BUILD-11" src/cli/slash-command/bs/build-chunk.test.ts` | ❌ Wave 0 |
| BUILD-13 | `build-chunk.md`/new files cite (never restate) git protocol, handoff seams, session lock | structural (assert citation phrasing + absence of restated numeric/format details outside state-machine.md) | `npx vitest run -t "BUILD-13" src/cli/slash-command/bs/build-chunk.test.ts` | ❌ Wave 0 |
| UIQ-05 | `build/final-acceptance.md` documents the 6-point design-QA pass | structural | `npx vitest run -t "UIQ-05" src/cli/slash-command/bs/build-chunk.test.ts` | ❌ Wave 0 |
| (drift) | ZERO "authored in Phase 146" markers remain in `build-chunk.md`; `REFERENCED_PATHS` gains the 4 new files; `FORWARD_REFERENCE_MARKERS` constant becomes obsolete/removed | structural | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` | ✅ existing file — this phase edits it |

Behavioral proof (an actual playtest/revise/close/final-acceptance run against a real generated
game) is explicitly deferred to Phase 149 per CONTEXT.md — this phase's validation is
structural-only.

### Sampling Rate

- **Per task commit:** `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts`
- **Per wave merge:** `npm test` (repo-wide, catches any accidental drift in sibling `bs/*.test.ts` files like `ingest.test.ts`, `templates.test.ts`)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a manual `grep -rn "authored in Phase 146"` returning zero hits across `src/cli/slash-command/bs/`

### Wave 0 Gaps

- [ ] `build-chunk.test.ts` needs new `describe('BUILD-09 — playtest', ...)`,
  `describe('BUILD-10 — revise', ...)`, `describe('BUILD-11 — close', ...)`,
  `describe('BUILD-13 — git protocol citation, no restatement', ...)`, and
  `describe('UIQ-05 — final-acceptance design-QA', ...)` blocks — mirror the existing
  per-requirement describe-block pattern used for BUILD-01 through BUILD-08/UIQ-01 through
  UIQ-04 in the same file.
- [ ] `REFERENCED_PATHS` (line 95-109) must be extended with `'build/playtest.md'`,
  `'build/revise.md'`, `'build/close.md'`, `'build/final-acceptance.md'`.
- [ ] `FORWARD_REFERENCE_MARKERS` (line 112) and its describe block (`'cross-file consistency —
  Steps 4-10 forward-reference stubs'`, starting ~line 509) must be updated/removed — the
  existing test at line 517 (`'carries the "authored in Phase 146" forward-reference marker'`)
  currently asserts the marker's *presence*; this phase must flip that assertion to assert
  *absence* (zero occurrences of `'authored in Phase 146'` anywhere in `build-chunk.md`), and the
  companion test at line 555 (`'REFERENCED_PATHS does NOT include any Phase 146 step file'`) must
  be inverted to assert it DOES now include them.

## Security Domain

`.planning/config.json` does not set `security_enforcement: false`, so this section is included
per protocol, but this phase has no application attack surface — it is markdown prose consumed
by an agent session, not executable code, and installs no packages, opens no network ports, and
handles no user credentials.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — no auth surface introduced |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | No | N/A — no user input parsing code added |
| V6 Cryptography | No | N/A |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| N/A | — | This phase's only "threat" analog is a documentation-accuracy risk (a playtest script instructing the user to run a command that doesn't exist, or a leak-check that doesn't actually catch a real leak) — mitigated by this research's verification of every cited CLI flag and dev-host mechanism against the actual source (`dev.ts`, `cli.ts`, `DevHost.vue`), not by any ASVS control |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/146-.../146-CONTEXT.md` — locked decisions, full text read
- `.planning/bs-skills-plan.md` §2 (`/bs-build-chunk`, steps 8-10), §Human gates, §Git protocol, §UI design-QA chunk — full text read
- `.planning/REQUIREMENTS.md` — BUILD-09/10/11/13, UIQ-05 exact wording and traceability table
- `src/cli/slash-command/bs/build-chunk.md` — full file read (287 lines), all 7 forward-reference markers located (lines 127-129 dispatch table rows, 131-136 explanatory paragraph, 152 light-path close-duty note, 264-268 Reference Files list)
- `src/cli/slash-command/bs/build/ask.md` — full file read, human-gate presentation analog
- `src/cli/slash-command/bs/build/design-review.md` — full file read, design-QA agent analog
- `src/cli/slash-command/bs/templates/CHUNK.template.md` — full file read, exact Playtest/Verified/Revision Rounds sections
- `src/cli/slash-command/bs/templates/SKETCH.template.md` — full file read, exact tail/Ideas Backlog/Mandated Chunks sections
- `src/cli/slash-command/bs/state-machine.md` — full file read, exact Git Protocol/Session Lock/Session Handoff Seams/Write Order text
- `src/cli/commands/dev.ts` — grepped for port/Ready!/AI-seat parsing (VERIFIED CLI mechanics)
- `src/cli/cli.ts` — grepped for `--players`/`--ai` option definitions
- `src/cli/dev-host/DevHost.vue` — grepped for seat switcher, Follow-active-seat, build-stamp/version indicator (confirmed absent), hard-reload mechanic
- `src/cli/slash-command/bs/build-chunk.test.ts` — read relevant sections (header comment, `REFERENCED_PATHS`, `FORWARD_REFERENCE_MARKERS`, describe-block patterns) to confirm the drift-test technique this phase must extend
- `src/ui/composables/useAnnouncer.ts` — confirmed exported API shape (`announce(message, {assertive})`)
- `src/cli/slash-command/bs/build/audit.md` — grepped for visibility-lens two-seat-diff wording (playtest's second-seat leak check analog)

### Secondary (MEDIUM confidence)
None required — all findings verified directly against repo source in this session.

### Tertiary (LOW confidence)
- VoiceOver invocation specifics (Cmd+F5, Rotor navigation) — training knowledge only, not
  verified via WebSearch/Context7 in this session; flagged in Assumptions Log (A1). Low risk
  since CONTEXT.md itself names VoiceOver as the locked tool — this phase's job is to cite that
  tool name, not independently verify Apple's own product, and any macOS-version-specific
  keystroke detail belongs in the authored script's prose, not in this research's claims.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no libraries involved; every CLI flag/mechanism cited was grepped directly from source in this session
- Architecture: HIGH — every pattern (gate-before-write, fresh-context dispatch, write order, citation discipline) is directly precedented in 4 already-shipped sibling files read in full
- Pitfalls: HIGH — each pitfall is either a direct CONTEXT.md instruction or a verified absence (no build-stamp UI element) found by direct source inspection

**Research date:** 2026-07-04
**Valid until:** 30 days (stable — this is internal repo convention research, not third-party ecosystem research subject to fast drift; re-verify sooner only if `build-chunk.md`, `state-machine.md`, or the CLI's dev-host flags change before this phase is planned)
