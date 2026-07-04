# Audit — Fresh Adversarial Review of Built Code (BUILD-07)

Referenced by `build-chunk.md` Step 3 (`audit`, first of the `{audit, repair}` session step
group — see `state-machine.md` "Session Handoff Seams"). `build/test.md`'s automated sequence
already proved this chunk compiles, lints clean, passes its own and the accumulated suite, and
survives a random-sim playthrough — none of that catches a rulebook-fidelity defect (the code
runs, but implements the wrong rule) or a hidden-information leak (the code runs, but a seat sees
something it should not) because neither is a type error or a crash. `audit` is the first point
in the pipeline where a lifecycle agent can fail a chunk for exactly those two classes of defect.

## The Temptation: Reading `## Interpretation` Instead of the Raw Rulebook Slice

The specific shortcut every audit dispatch must be built to resist: silently reading this
chunk's already-settled CHUNK.md `## Interpretation` instead of the raw rulebook slice(s) it
was built from. Reading the interpretation is faster — it is already digested, already
plain-language, already agreed — and that is exactly why it is wrong here. If `investigate` or
`redteam` upstream made an interpretation error, that error is baked into `## Interpretation`;
an audit agent that reads the interpretation instead of the raw slice inherits the same error
and can never catch it. Audit's own no-framing rule: **audit agents read the raw rulebook
slice(s), `RULINGS.md`, and the code — never `## Interpretation`.** Interpretation-level errors
from `investigate`/`redteam` must stay visible to something downstream, and audit is that
something.

This is `state-machine.md` "Rulings Outrank Rulebook" applied, not restated: audit agents read
`RULINGS.md` alongside the raw slice so they do not "fix" a deliberate house rule or adaptation
back to the printed rule — the rulebook plus `RULINGS.md` together form the composite source of
truth for every rules-fidelity check.

## Three Lenses, Each a Separate Fresh-Context Dispatch

Audit runs 3 independent fresh-context agents, one per lens, plus a 4th for `ui: touches|major`
chunks. Each lens is a SEPARATE Task-tool dispatch — fresh context, no inherited conversation,
never the orchestrator's running conversation, never a peer lens's findings, and never
`## Interpretation` (per the rule above). This is `build/redteam.md`'s "Independence:
Fresh-Context, No-Framing Dispatch" applied one step further down the pipeline: framing from any
upstream step is exactly what would defeat an independent audit.

1. **Fidelity** — does the built code actually implement what the raw rulebook slice(s) (plus
   `RULINGS.md`) say, not what `## Interpretation` says they say?
2. **Visibility** — a two-seat diff: does any hidden information leak to a seat that should not
   see it?
3. **Undo** — does undo (where applicable) restore state cleanly, with no residual leak or
   desync?

For `ui: touches|major` chunks, a 4th agent is dispatched via `build/design-review.md`
(forward-reference — authored in this phase's Plan 02): a screenshot-armed review against
`DESIGN.md` and frontend-design craft criteria. Its findings land in the same `## Findings
Ledger` as the three lenses above, through the orchestrator, never a separate track.

### Dispatch Templates

**Fidelity lens:**

```
You are auditing built code for {gameName}, chunk "{slug}", for RULES FIDELITY. Read the
following rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project — rulings
outrank the rulebook (state-machine.md "Rulings Outrank Rulebook"); the rulebook plus
RULINGS.md together form the composite source of truth. Do NOT read this chunk's CHUNK.md
"## Interpretation" section — you are checking the CODE against the RAW SOURCE, not against a
prior agent's summary of it.

Then read the built code at: {codeFilePaths}.

Return exactly: a list of { findingId, lens: 'fidelity', description, citation, severity } —
one entry per defect found (empty array if none).
```

**Visibility lens:**

```
You are auditing built code for {gameName}, chunk "{slug}", for HIDDEN-INFORMATION LEAKS. Read
this chunk's Visibility Declaration (provided below) and the built code at: {codeFilePaths}.
Do NOT read CHUNK.md "## Interpretation".

{visibilityDeclarationText}

Using the generated project's own test harness, run a two-seat diff via
`diffPlayerViews(testGame, seatA, seatB)` (the atomic overload — avoids the WR-02
different-instants footgun) from `boardsmith/testing`, and check the rendered UI output with
`assertNoHiddenInfoLeak(...)` from the same package. Report anything either check surfaces as
visible to a seat the Visibility Declaration says should not see it.

Return exactly: a list of { findingId, lens: 'visibility', description, citation, severity } —
one entry per leak found (empty array if none).
```

**Undo lens:**

```
You are auditing built code for {gameName}, chunk "{slug}", for UNDO SANITY. Read the built
code at: {codeFilePaths}. Do NOT read CHUNK.md "## Interpretation".

Confirm any undoable action in this chunk restores prior state cleanly — no residual visible
state, no desync between engine state and what either seat's view reports, no orphaned hidden
information exposed by the undo path itself.

Return exactly: a list of { findingId, lens: 'undo', description, citation, severity } — one
entry per defect found (empty array if none).
```

Field names follow `build/redteam.md`'s precedent (`claimNumber`/`verdict`/`objection` /
`missingInteractions`) — flat and grep-able, not a new ledger structure: `findingId`, `lens`,
`description`, `citation`, `severity`.

## Visibility Lens — Real APIs, Cited by Exact Name

The visibility lens must cite the real functions, not describe the check in prose alone
(per 145-RESEARCH.md "Don't Hand-Roll"):

- `diffPlayerViews(testGame, seatA, seatB)` (`src/testing/view-diff.ts`) — the atomic overload,
  which avoids the WR-02 footgun of diffing two views captured at different game-state instants.
  Returns `{ onlyInA, onlyInB, attributeDiffs, describe() }`.
- `assertNoHiddenInfoLeak(...)` (`src/testing/dom-leak.ts`) — a DOM-rendered leak assertion,
  catching UI-smuggled hidden values (e.g. a placeholder `aria-label` that echoes a hidden
  card's identity) that a pure JSON-view diff would miss.

## Persisting the Round — Write to the Findings Ledger BEFORE Repair Starts

The orchestrator appends a `### Audit Round N` entry to CHUNK.md's `## Findings Ledger`
(`templates/CHUNK.template.md` — cite the section by name, never restructure it) as soon as all
of this round's lens agents (and the design-review agent, if dispatched) have returned — this
write happens **before** `repair` starts, mirroring `build/redteam.md`'s "Persisting the Round"
write-before-next-step discipline. Each new finding gets a stable ID (e.g. `F1`, `F2`, ...) that
never changes or is reused across rounds.

**Cold-resume rule:** a session resuming at `audit` (unchecked on the Step Checklist) with a
partial or missing current-round entry in `## Findings Ledger` re-dispatches this round's lenses
from scratch — the round is not considered complete, and no partial finding list is trusted,
until the full `### Audit Round N` entry lands. A session resuming at `repair` finds the prior
round's entry already persisted and reads it directly; it never re-runs `audit` to reconstruct
findings that are already on disk.

**Only-new-findings on round N+1:** per `state-machine.md` "Repair Loop Bound" (cite, do not
restate the bound itself here — see `build/repair.md` for the round-count enforcement), a
second or third audit round's lenses read the existing `## Findings Ledger` first and report
only NEW findings — they do not re-litigate a finding already recorded there.

## Downstream Shape (cite, never restate)

Once this round's findings land in `## Findings Ledger`, the next step in this same session
group is `build/repair.md` — fix each finding or refute it with a citation, then loop back to
`audit` for the next round, bounded by `state-machine.md` "Repair Loop Bound". This file does not
restate that step's structure.
