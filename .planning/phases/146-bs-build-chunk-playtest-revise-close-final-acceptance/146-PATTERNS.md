# Phase 146: `/bs-build-chunk` — Playtest, Revise, Close & Final Acceptance - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 6 (4 new markdown reference files, 1 edited orchestrator, 1 extended test file)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/slash-command/bs/build/playtest.md` | reference-file (human-gate, no subagent) | request-response (orchestrator ↔ human, state-file write) | `build/ask.md` | exact — CONTEXT.md and RESEARCH.md both name this explicitly ("no subagent — human-facing", same shape as `ask.md`) |
| `src/cli/slash-command/bs/build/revise.md` | reference-file (triage/disposition loop) | event-driven (per-feedback-item classify → route) | `build/repair.md` | exact — same "N outcomes per item, durable disposition, round-bounded, append-only ledger" shape (repair's fix/refute/deferred vs. revise's a/b/c/d) |
| `src/cli/slash-command/bs/build/close.md` | reference-file (bookkeeping + delta gate) | CRUD (state-file writes) + request-response (delta-approval gate) | `build/ask.md` (gate half) + `build/repair.md` (round-3 triage half) | role-match — no existing file does a "delta re-derivation" gate; composite of `ask.md`'s gate-before-write shape + state-machine.md's Git Protocol mechanics |
| `src/cli/slash-command/bs/build/final-acceptance.md` | reference-file (fresh-context adversarial dispatch + human-driven checks) | streaming/file-I/O (screenshot capture) + request-response (human SR playthrough) | `build/design-review.md` | exact — CONTEXT.md and RESEARCH.md both name this as the direct precedent (dev-host serve→capture→kill, breakpoint/theme matrix, Findings Ledger destination) |
| `src/cli/slash-command/bs/build-chunk.md` (edit) | orchestrator/router | request-response (dispatch table edit) | itself (pre-145 state) — editing dispatch rows 127-129, Reference Files list 264-268, light-path note ~152 | exact — same file, incremental edit following the existing dispatch-row/Reference-Files-list conventions already used for `build/build.md`…`build/repair.md` |
| `src/cli/slash-command/bs/build-chunk.test.ts` (extend) | test | structural/drift-pin (string/regex assertions against markdown) | itself, `BUILD-08 — repair` / `UIQ-04 — design-review` describe blocks (lines 385-439) | exact — mirror the exact describe-block-per-requirement pattern already used 8 times in this file |

## Pattern Assignments

### `build/playtest.md` (reference-file, human-gate, no subagent)

**Analog:** `build/ask.md` (full file read, 159 lines)

**Header/framing pattern** (ask.md lines 1-8):
```
# Ask — The Human-Approval Gate (BUILD-04)

Referenced by `build-chunk.md` Step 3 (`ask`, third and last of the `{investigate, redteam,
ask}` session step group — see `state-machine.md` "Session Handoff Seams"). This is the
human-approval boundary: the point where a plain-language design is authorized before a single
line of code is written. Mirrors `ingest-rules.md` Step 6 (Approval Gate) + Step 7 (Write
Files) — same negotiate-then-gate posture, same single-point-of-write discipline...
```
Copy this shape for `playtest.md`'s opening: "Referenced by `build-chunk.md` Step 8 (`playtest`,
first of the `{playtest, one revise round, close}` session step group — see `state-machine.md`
"Session Handoff Seams")." State explicitly, per Pitfall 3 in RESEARCH.md, that this step has
**no subagent** — model the "Inputs" section on ask.md's, not on a Dispatch Template.

**No-subagent inputs pattern** (ask.md lines 26-33):
```
The settled interpretation that clears `build/redteam.md` with no unresolved refuted-twice
escalations: CHUNK.md's `## Interpretation` and `## Visibility Declaration` sections (written by
`build/investigate.md`), plus CHUNK.md's `## Redteam Rounds` section (written by the
orchestrator at the end of each redteam round — see `build/redteam.md` "Persisting the
Round"). The ask step has no subagent — the orchestrator reads these three CHUNK.md sections
itself, the sanctioned state-file read defined in `build-chunk.md`'s Context-Economics Hard
Rule, and restates them below; it never opens the rulebook slices or docs behind the claims.
```
`playtest.md`'s Inputs section should read `CHUNK.md`'s `## Build Manifest` (which files were
built) and the prior chunk's `## Revision Rounds` (any still-open regression items) the same way
— orchestrator-read, no dispatch.

**Fixed-format presentation pattern** (ask.md lines 44-76 — "never reorder, never merge parts,
never add a fifth part"): reuse this exact rigidity instruction for the numbered click-by-click
script. `CHUNK.template.md`'s `## Playtest Test Script` section (lines 135-152, already shipped)
is the fixed shape to fill — cite it, don't redefine it:
```
Build stamp: <!-- commit hash or "not yet built" -->

1. <!-- seat 1 step --> — expect: <!-- observable outcome -->
2. ...

Regression check: <!-- one line -->
Taste check: does anything look off?
Second-seat leak check (if hidden info): <!-- steps, or "n/a — no hidden info in this chunk" -->
```

**Gate-before-write pattern** (ask.md lines 117-145 — the exact write-order sequence to mirror,
substituting `verified` / `verified (user-waived)` for `approved`):
```
Present all four parts, then negotiate... Do **not** write anything durable — not `Status:
approved`... until the user has given explicit approval. Presenting is not approving; only an
explicit yes authorizes the write.

Only after that explicit yes:
...
3. Check off `ask` on CHUNK.md's Step Checklist...
4. Write `Status: approved` to CHUNK.md **last**, after every other write for this gate has
   landed (cite `state-machine.md` "Write Order"...).
5. Then update this chunk's derived-status pointer in SKETCH.md to match...
```
`playtest.md` mirrors this precisely: each `## Verified Checklist` item confirmed one at a time
(never a vibe), and only after every item is confirmed (or explicitly waived) does `Status:
verified` / `verified (user-waived)` get written — CHUNK.md first, then SKETCH.md, per
`state-machine.md` "Write Order". CONTEXT.md's own wording ("Verified is an explicit item-by-item
checklist... confirmed one at a time, not a vibe") is the playtest-specific instantiation of this
same gate discipline.

**Downstream-shape citation pattern** (ask.md lines 155-159 — end-of-file citation, never
restatement):
```
## Downstream Shape (cite, never restate)

Once `Status: approved` lands, the settled, user-approved interpretation from `build/redteam.md`
is the upstream authority for `build/build.md` — the next session picks up the step group
`{build, test}`. This file does not restate that step group's structure.
```
`playtest.md` should end the same way, pointing to `revise.md` (if issues) or `close.md` (if
clean) without restating either.

---

### `build/revise.md` (reference-file, triage/disposition loop)

**Analog:** `build/repair.md` (full file read, 95 lines)

**Header/framing pattern** (repair.md lines 1-6):
```
# Repair — Fix-or-Refute Loop, Bounded (BUILD-08)

Referenced by `build-chunk.md` Step 3 (`repair`, second of the `{audit, repair}` session step
group — see `state-machine.md` "Session Handoff Seams"). Repair processes each finding
`build/audit.md` recorded in this round's `## Findings Ledger` entry: every finding gets exactly
one of two outcomes.
```
Mirror for `revise.md`: "Referenced by `build-chunk.md` Step 9 (`revise`, second of the
`{playtest, one revise round, close}` session step group...). Revise processes each feedback item
the user reported during `playtest`: every item gets exactly one of four dispositions."

**Two-actions-vs-terminal-dispositions pattern** (repair.md lines 8-33 — distinguishing the
*action* from the *disposition*, the exact shape to reuse for revise's 4 categories):
```
Keep two things distinct. A *repair action* is what repair does to a finding during a round; a
*disposition* is a finding's final recorded outcome.

During a repair round, repair itself does exactly one of two things to a finding: **FIX** the
code, or **refute-it-with-citation**. Those are the only two repair actions...

- **Fix**: change the code so the finding no longer holds. Record the finding's disposition as
  `fixed`...
- **Refute-with-citation**: the finding does not hold — record the disposition as `refuted`
  together with the rulings/rulebook citation...
```
Reuse this exact two-tier structure for revise's CONTEXT.md-specified 4 categories: (a)
this-chunk defect → new `### Revise N` entry in CHUNK.md's `## Revision Rounds` (already-shipped
template section, lines 113-124 of `CHUNK.template.md`); (b) future scope → `SKETCH.md`'s `##
Ideas Backlog` (already-shipped, lines 87-91 of `SKETCH.template.md`) or `/bs-insert-chunk`
(forward reference, Phase 147); (c) not-built-yet → expectation reset, no write; (d) rules change
→ new `RULINGS.md` entry (cite `templates/RULINGS.template.md`'s shape, same as `ask.md`'s
"House-Rule / Adaptation Choices" section).

**Round-bound + persistence citation pattern** (repair.md lines 35-70 — cite, never restate; and
the write-before-next-round discipline):
```
## Repair Loop Bound (cite, never restate)

Cite `state-machine.md` "Repair Loop Bound" for the governing rule — this file does not
re-derive it in its own words, it applies it...

## Persisting Dispositions — Write Before the Next Audit Round Starts

Write each round's dispositions ... into the `## Findings Ledger` entry BEFORE the next audit
round is dispatched...
```
`revise.md` should mirror this for the `## Revision Rounds` append-only ledger: write each round's
triage dispositions before looping back to `playtest` for the targeted re-test, and cite
(never restate) the CONTEXT.md-specified "rounds appended (revise-1, revise-2, …)" numbering,
which is the same append-only, never-renumber discipline `## Redteam Rounds` and `## Findings
Ledger` already use.

**Round-N triage-to-user pattern** (repair.md lines 72-88 — the disposition-report precedent,
directly reusable for revise's re-entry requirement):
```
## Round-3 User Triage — Plain Language, Never Raw

After round 3, any finding still lacking a disposition is triaged with the user directly. Cite
`build/redteam.md`'s "Vote-Privacy" discipline by name rather than re-deriving it: never show the
user a raw finding text, an agent transcript, or a severity score. Present exactly three
plain-language options in designer register, one per finding:
- **Real blocker** ...
- **Defer to a later chunk** ...
- **Auditor was wrong (refuted)** ...
```
CONTEXT.md's "on re-entry after a revise round, user gets a feedback disposition report — each
item they reported, what changed, and a TARGETED re-test script — never a blind full re-test" is
the playtest/revise composite of this same plain-language-report shape: reuse the "never show a
raw X, an agent transcript" framing, applied to feedback items instead of findings, and describe
the TARGETED re-test script as a distinct, smaller instantiation of `## Playtest Test Script`
(only the items affected by this round's fixes, not the full numbered script again).

**Downstream-shape citation pattern** (repair.md lines 90-94 — same end-of-file citation shape,
note it explicitly forward-references THIS phase):
```
## Downstream Shape (cite, never restate)

Once every finding across all rounds has a disposition (`fixed`, `deferred`, or `refuted`) and no
audit round remains open, this chunk moves to the `{playtest, one revise round, close}` session
group — authored in Phase 146. This file does not restate that group's structure.
```
This is the exact sentence to REMOVE the "authored in Phase 146" marker from once `revise.md`
exists — see cross-file consistency notes below; `repair.md` itself is not edited this phase, but
note its citation target (`{playtest, one revise round, close}`) is now a live, existing group.

---

### `build/close.md` (reference-file, bookkeeping + delta gate)

**Analog (gate half):** `build/ask.md` gate-before-write shape (lines 117-146, same excerpt as
above) — reuse for the sketch-tail delta approval.

**Analog (bookkeeping half):** `state-machine.md` "Git Protocol" (lines 114-119) — cite, never
restate:
```
## Git Protocol

- Commit at every step completion. Message convention: `chunk-<slug>/step-<name>` (e.g. `chunk-movement/step-build`).
- Revise rounds use `chunk-<slug>/revise-2` (etc.) as the commit message convention.
- Commit **before** `build` starts, so work-in-progress is always distinguishable from the last verified baseline.
- `close` records the verified commit hash in CHUNK.md — this is the bisect anchor for any later regression and the diff base for "what changed since the human last said yes."
```
`close.md`'s bookkeeping sequence must cite this exact section by name rather than restating the
`chunk-<slug>/step-<name>` format or the bisect-anchor rationale — Pitfall 1 in RESEARCH.md is
precisely this restatement risk.

**Verified Commit Hash template target** (`CHUNK.template.md` lines 166-172, already shipped):
```
## Verified Commit Hash
<!-- Recorded at close. This is the bisect anchor for any later regression and the diff base
     for "what changed since the human last said yes." Commit BEFORE build starts too, so
     work-in-progress is always distinguishable from the last verified baseline
     (state-machine.md "Git Protocol"). -->

<!-- <commit-hash> -->
```
`close.md` should instruct: run `git rev-parse HEAD` and write the literal hash into this
already-shipped field — no new tracking file, per RESEARCH.md's "Don't Hand-Roll" table.

**Write-order pattern** (ask.md's steps 3-5, same excerpt as above): close writes `Status:
verified` to CHUNK.md first (already done by playtest, per CONTEXT.md's semantics — close's own
duty starts AFTER playtest's Status write lands), then the derived-status pointer to SKETCH.md
second, per `state-machine.md` "Write Order" — cite this exact ordering, do not restate the
rationale in new words.

**Delta-presentation pattern (genuinely new — no direct analog exists):** RESEARCH.md's Pattern 3
(lines 225-251) is the authored precedent to reuse verbatim as the shape for this section:
```
Re-derive the sketch tail (the next 2-3 sketch-level entries) against the rulebook now that
this chunk is closed and its citations are settled. Present ONLY the delta — entries that
changed, split, merged, or were newly detailed — never a full silent rewrite of SKETCH.md's
Ordered Chunk List:

  "Chunk 'auction' split into 'auction-basic' and 'auction-improvements' because the rulebook's
  auction rules (p.14) turned out to need two separate playtest gates..."

Gate this the same way `ask.md` gates the design: present, then require explicit approval before
writing SKETCH.md's Ordered Chunk List.
```
Model this on `ask.md`'s "Fixed 4-Part Presentation Format" rigidity instruction ("This shape is
fixed — never reorder it, never merge parts, never add a fifth part") — give the delta
presentation its own fixed, named structure (e.g. "before / after / why") so a future drift test
can pin it, per RESEARCH.md Open Question 2's recommendation.

**Light-path reconciliation target:** `build-chunk.md` lines 146-153 (existing Phase-143 note,
to be reconciled not restated):
```
Light-path status transitions (cite `state-machine.md` "Step Names (exact, light path)" — do not
restate the transition rule beyond this pointer): the light path has no `ask` step, so
`approved` is **unreachable** for light chunks — a light chunk moves `proposed → built` directly
when the user accepts the proposal and `build` + `test` complete. Because the light path has no
`close` step, `playtest` performs `close`'s bookkeeping for light chunks (bisect-anchor commit
hash, Status line update CHUNK.md-then-SKETCH.md, decision rollup, and detailing the next 2-3
sketch-level tail entries — `close`'s duty, authored in Phase 146; Step 2's lazy tail-entry
detailing above covers any entry this bookkeeping misses).
```
This note's "authored in Phase 146" marker is removed at this phase, and `close.md`'s bookkeeping
sequence must be written so this existing sentence ("`playtest` performs `close`'s bookkeeping for
light chunks") remains true and citable by name (e.g. "see `close.md`'s 'Bookkeeping Sequence'") —
per CONTEXT.md: "close.md is the full version playtest's light-path bookkeeping pointed forward
to."

---

### `build/final-acceptance.md` (reference-file, fresh-context dispatch + human-driven checks)

**Analog:** `build/design-review.md` (full file read, 177 lines) — direct precedent named by both
CONTEXT.md and RESEARCH.md.

**Header/framing pattern** (design-review.md lines 1-10):
```
# Design Review — Screenshot-Armed Adversarial UI Audit (UIQ-04)

Referenced by `build/audit.md`'s "Three Lenses" section as a 4th lens, dispatched only for
chunks whose `## ui:` tag is `touches` or `major`... `build/test.md`'s a11y floor already proves
the UI is operable... none of that catches whether the UI actually *looks right*...
```
Mirror for `final-acceptance.md`: frame it as "the sketch's mandated final-acceptance chunk...
this same `{playtest, revise, close}` group applies to it too, but its own content dispatches to
this file for the coverage check + 6-point design-QA pass" — per CONTEXT.md: "final-acceptance.md
is a distinct reference file (the final-acceptance chunk is a special sketch chunk, not a
per-chunk step)."

**Fresh-context dispatch discipline** (design-review.md lines 12-24 — byte-identical reuse per
RESEARCH.md's "Don't Hand-Roll" table):
```
## Single Fresh-Context Adversarial Dispatch

Same independence discipline as `build/redteam.md`'s "Independence: Fresh-Context, No-Framing
Dispatch", scaled to one dispatch instead of three: this is a SEPARATE Task-tool dispatch with
no inherited conversation — never the orchestrator's running conversation, never
`build/investigate.md`'s or `build/ask.md`'s framing, and never CHUNK.md's `## Interpretation`.
```
Reuse this exact independence framing for the automatable-checks agent `final-acceptance.md`
dispatches — per RESEARCH.md's Anti-Pattern: "any dispatched agent in `final-acceptance.md` must
be fresh-context, never inheriting the interpretation or prior framing... don't relax it because
it's the 'final' pass."

**Dispatch Template pattern** (design-review.md lines 26-53 — the exact copy-paste-prompt shape
to reuse, substituting the 6-point UIQ-05 checklist for design-review's 2-pass token/cohesion
review):
```
You are the DESIGN-REVIEW lens auditing the built UI for {gameName}, chunk "{slug}". This is a
SEPARATE dispatch with NO inherited conversation...

Serve → capture → kill: follow this file's "Dev-Host Lifecycle" sequence exactly...

Review passes: (1) token/craft against DESIGN.md; (2) cohesion diff against the prior UI chunk's
shots/...

Return exactly: a list of { findingId, lens: 'design', description, citation, severity }...
```
`final-acceptance.md`'s dispatch template covers the 4 automatable checks (200% zoom, compact
touch targets, both Slate themes, mobile via iframe-shrink) with `lens: 'final-acceptance'`
(or similar) in the same flat return shape; the SR playthrough and colorblind pass are
human-narrated sections outside this dispatch template (per RESEARCH.md's split recommendation).

**Dev-Host Lifecycle pattern** (design-review.md lines 55-86 — byte-identical reuse, cite the
exact ready-string and `--no-open` requirement):
```
1. **Serve** — `cd` into the generated game project and start the dev host in non-interactive
   mode: `npx boardsmith dev --no-open`
2. **Wait for ready, never `networkidle`** — wait for the exact ready-state line
   `Ready! Press Ctrl+C to stop.`...
3. **Capture** — run the tier × theme capture loop (below).
4. **Kill** — an explicit, numbered step in this SAME sequence... kill the dev server process
   started in step 1 before this agent returns.
```
Reuse verbatim — this is the exact "Serve → Capture → Kill" mechanism RESEARCH.md's "Don't
Hand-Roll" table flags as required byte-identical reuse (avoids the `networkidle`-hangs-forever
footgun and the seat-1-stolen-by-real-browser footgun already solved in Phase 145).

**Breakpoint/capture-width table** (design-review.md lines 87-111 — cite exact values, never
re-derive):
```
| Tier (name) | Tier range (theme.ts:18) | Capture width | Why this width lands in-tier |
| --- | --- | --- | --- |
| `compact` | ≤639px | **375** | below `BREAKPOINTS.compact` (640) — real phone layout |
| `medium`  | 640–1023px | **800** | between `BREAKPOINTS.compact` (640) and `BREAKPOINTS.medium` (1024) — tablet layout |
| `wide`    | ≥1024px | **1440** | ≥ `BREAKPOINTS.medium` (1024); equals `BREAKPOINTS.wide` (1440), also exercising the max-width cap |
```
`final-acceptance.md`'s 200%-zoom and mobile-layout checks should cite `src/ui/theme.ts`'s
`BREAKPOINTS` (640/1024/1440) by these same names/values, per RESEARCH.md Pattern 2 — do not
re-derive new capture widths.

**Theme-injection mechanism** (design-review.md lines 119-126 — no toggle UI exists, must inject
onto the iframe's own document):
```
**Theme injection — no toggle UI exists.** There is no button to click. Set the theme by
injecting it onto the **GameShell iframe's own document**, not by clicking anything:
`iframe.contentDocument.documentElement.dataset.theme = 'dark'` (or `'light'`).
```
Reuse for final-acceptance's "both Slate themes" check.

**Findings destination pattern** (design-review.md lines 168-177 — same ledger, same repair
loop):
```
## Findings Destination

Every finding this agent surfaces — token violation, craft defect, or unexplained cohesion drift
— is appended to CHUNK.md's `## Findings Ledger`... This is not a separate ledger and not a
separate repair track — `build/repair.md`'s fix-or-refute-with-citation loop and round-bound
enforcement apply identically to a design-review finding.
```
Decide (Claude's Discretion per CONTEXT.md) whether final-acceptance findings land in the same
`## Findings Ledger` or in a final-acceptance-specific section of CHUNK.md; if reusing the
Findings Ledger, cite this exact passage as precedent for routing through `build/repair.md`'s
loop rather than inventing a new triage mechanism.

**useAnnouncer() API shape** (src/ui/composables/useAnnouncer.ts, verified):
```typescript
// line 69
function announce(message: string, announceOptions?: { assertive?: boolean }): void
// line 98
export function useAnnouncer(): UseAnnouncerReturn
```
`final-acceptance.md`'s SR playthrough step should name this composable and its `announce()` /
`{ assertive }` signature as "the floor this step exercises" — cite the file path and function
name, do not re-describe ARIA live-region mechanics from scratch.

---

### `src/cli/slash-command/bs/build-chunk.md` (edit — 7 forward-ref markers + registration)

**Exact lines to edit (pre-145 state, verified this session):**

Dispatch table rows (lines 127-129):
```
| playtest | `build/playtest.md` — authored in Phase 146 |
| revise | `build/revise.md` — authored in Phase 146 |
| close | `build/close.md` — authored in Phase 146 |
```
→ drop the `— authored in Phase 146` suffix from all three rows (matching the shape of the
`build`/`test`/`audit`/`repair` rows immediately above them, which carry no such suffix).

Explanatory paragraph (lines 131-136):
```
Steps 8–10 (`playtest`/`revise`/`close`) are named here as forward references only — this router
does not implement their prose, and the drift test that pins this file does not require
`build/{playtest,revise,close}.md` to exist yet, only that this table names each path and its
phase marker. ... When Phase 146 lands, each remaining reference file is authored and this table's
forward references become live dispatches with no change to this router's routing logic.
```
→ replace with a plain statement that all 10 steps now have live dispatch targets (mirror the
existing sentence style already used for the `build.md`/`test.md`/`audit.md`/`repair.md` steps
one paragraph earlier — no special "Phase 146 lands" framing needed once it has).

Light-path note (line ~152, inside lines 146-153):
```
... `close`'s duty, authored in Phase 146; Step 2's lazy tail-entry
detailing above covers any entry this bookkeeping misses).
```
→ drop `, authored in Phase 146` — the rest of the sentence ("`close`'s duty... Step 2's lazy
tail-entry detailing above covers any entry this bookkeeping misses") stays, now citing a live
file.

Reference Files list (lines 264-268):
```
And, forward-referenced only (not yet authored):

- `build/playtest.md` — authored in Phase 146
- `build/revise.md` — authored in Phase 146
- `build/close.md` — authored in Phase 146
```
→ delete this whole sub-list-with-header and fold the four new files (playtest, revise, close,
final-acceptance) into the main bulleted list above it (lines 248-262), matching the exact
one-line-description style already used for `build/repair.md`:
```
- `build/repair.md` — fix-or-refute-with-citation loop, round-bound enforcement, round-3 user
  triage
```

**Step Groups 2-4 forward-reference section** (lines 206-213) — this whole `## Step Groups 2–4
(forward reference)` heading and its body currently reads:
```
Group 2 `{build, test}`, group 3 `{audit, repair}`, and group 4 `{playtest, one revise round,
close}` are dispatched identically in shape once their reference files exist — this router's
Step 3 dispatch table above already names each target file and its owning phase. Every group ends
the same way group 1 does: print the exact next command to run and confirm the game folder is
saved.
```
Per the file's own existing convention (compare `## Step Group 1 Dispatch` header, which is fully
authored prose, not a forward-reference stub), this section name/shape should be reconciled now
that ALL groups are live — either author full "Step Group 4 Dispatch" prose here (mirroring Group
1's shape: per-step dispatch delegation + persistence discipline + end-of-group print statement)
or explicitly confirm groups 2-3 already have this treatment elsewhere (`build/build.md`,
`test.md`, `audit.md`, `repair.md` dispatch sections) and only Group 4 needs authoring here. This
is squarely in-scope for BUILD-13's "git protocol...surfaced in the orchestrator's own sections."

---

## Shared Patterns

### Citation-not-restatement (dominant cross-cutting discipline this phase)
**Source:** `src/cli/slash-command/bs/state-machine.md` "Git Protocol" (lines 114-119), "Session
Lock" (lines 102-112), "Session Handoff Seams" (lines 133-148)
**Apply to:** all 4 new files + the build-chunk.md edit
**Pattern:** Every mention of the `chunk-<slug>/step-<name>` commit format, 24-hour lock
staleness, or the four session-handoff-seam group names must be a citation ("cite
`state-machine.md` 'Git Protocol'"), never a restatement — this is BUILD-13's core requirement
and RESEARCH.md's Pitfall 1. `repair.md` lines 35-46 ("Repair Loop Bound (cite, never restate)")
and `ask.md` line 155 ("Downstream Shape (cite, never restate)") are the two exact section-header
conventions already established for this — reuse the `(cite, never restate)` heading suffix
verbatim as a section-naming convention in the new files.

### Write Order: CHUNK.md then SKETCH.md
**Source:** `state-machine.md` "Write Order" (line 56-62, not directly quoted above but referenced
throughout `ask.md` steps 4-5 and `build-chunk.md`'s Step-Group-1 closing paragraph)
**Apply to:** `playtest.md` (Status write), `close.md` (Status write + sketch-tail delta write)
**Pattern:** CHUNK.md's own field is always written first, its SKETCH.md derived-status mirror
second, never the reverse and never one without the other.

### Gate-Before-Write
**Source:** `build/ask.md` "Gate-Before-Write" (lines 117-146)
**Apply to:** `playtest.md` (Verified Checklist gate), `close.md` (sketch-tail delta gate)
**Pattern:** Present in full, negotiate, and only write durable state after an explicit yes —
"presenting is not approving."

### Fresh-Context Adversarial Dispatch
**Source:** `build/design-review.md` "Single Fresh-Context Adversarial Dispatch" (lines 12-24),
itself citing `build/redteam.md`'s "Independence: Fresh-Context, No-Framing Dispatch"
**Apply to:** `final-acceptance.md`'s automatable-checks agent dispatch
**Pattern:** Separate Task-tool dispatch, no inherited conversation, no CHUNK.md `##
Interpretation`, agent reads fresh and returns findings independently.

### Server Discipline (never leave one running)
**Source:** `build/design-review.md` "Dev-Host Lifecycle: Serve → Capture → Kill" step 4 (lines
81-86), citing repo-wide `CLAUDE.md` hard rule
**Apply to:** `final-acceptance.md`'s dispatched agent; explicitly NOT `playtest.md` (the user
owns their own server — CONTEXT.md is explicit the skill never starts/kills it)
**Pattern:** Serve → wait-for-ready-string (never `networkidle`) → capture → kill, as one
unbroken numbered sequence, never a footnote.

### Findings Ledger as single destination
**Source:** `build/design-review.md` "Findings Destination" (lines 168-177), `build/repair.md`
throughout
**Apply to:** `final-acceptance.md` (if its automated findings route through the same ledger —
Claude's Discretion per CONTEXT.md, document the choice either way)
**Pattern:** One flat `{ findingId, lens, description, citation, severity }` shape, stable IDs
never reused, routed through the existing fix-or-refute-with-citation loop rather than a new
parallel triage track.

## No Analog Found

None. All 6 files/edits have at least a role-match analog; `close.md`'s delta-presentation
mechanic is genuinely new (no prior file implements a diff-style gate) but is fully specified by
RESEARCH.md's authored Pattern 3 prose, itself modeled on `ask.md`'s gate rigidity — treat that
prose as the analog excerpt for this one new mechanic.

## Metadata

**Analog search scope:** `src/cli/slash-command/bs/` (build-chunk.md, build/*.md, templates/*.md,
state-machine.md, build-chunk.test.ts), `src/ui/composables/useAnnouncer.ts`, `src/cli/cli.ts`,
`src/cli/commands/dev.ts` (all already grepped/verified by 146-RESEARCH.md; reused here rather
than re-read)
**Files scanned:** `build/ask.md` (159 lines, full), `build/design-review.md` (177 lines, full),
`build/repair.md` (95 lines, full), `build-chunk.md` (287 lines, full), `templates/CHUNK.template.md`
(173 lines, full), `templates/SKETCH.template.md` (101 lines, full), `state-machine.md` (lines
100-149), `build-chunk.test.ts` (lines 85-215, 385-560)
**Pattern extraction date:** 2026-07-04
