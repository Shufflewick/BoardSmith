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

## Four Lenses, Each a Separate Fresh-Context Dispatch

Audit runs 4 independent fresh-context agents, one per lens, plus a 5th for `ui: touches|major`
chunks. Every lens (and the design-review agent) is dispatched in one message, so they run at the
same time (`build-chunk.md` "Concurrency Within a Chunk"). Each lens is a SEPARATE dispatch of its
role's agent (`routing.md`: the fidelity lens is the `judgement` role, the other three and the
design review the `review` role; `npx boardsmith agent <role>` names the agent type): fresh context, no inherited conversation,
never the orchestrator's running conversation, never a peer lens's findings, and never
`## Interpretation` (per the rule above). This is `build/redteam.md`'s "Independence:
Fresh-Context, No-Framing Dispatch" applied one step further down the pipeline: framing from any
upstream step is exactly what would defeat an independent audit.

1. **Fidelity** — does the built code actually implement what the raw rulebook slice(s) (plus
   `RULINGS.md`) say, not what `## Interpretation` says they say? It re-opens every source
   location the chunk's claims quote, and every finding it reports quotes the source too.
   Before dispatching it, the orchestrator runs `boardsmith claim-quote-check <slug>`; a
   non-zero exit means the claims were never properly quoted, so the chunk goes back to
   `investigate` rather than into an audit built on them. The one exception is a quote of code
   this chunk itself replaced: build changed that line on purpose, so the orchestrator re-points
   the claim's `Source:` at the code as it was in a commit of the chunk, `<path>@<commit>:<lines>`
   (the check's refusal names that location when one exists; `build/investigate.md`), reruns the
   check, and continues to audit without re-investigating. A quote that no commit of the chunk
   has at its lines was never properly quoted, and goes back. A chunk verified before claims carried
   quotes passes once the gate transition has recorded its claims, and a re-audit of it owes
   quotes only for the claims it adds or changes (`build/investigate.md` "Chunks Verified Before
   Claims Carried Quotes"); if the check names `boardsmith chunk-gate-transition` instead, that is
   the designer's one-time step, not a reason to re-investigate. A claim the check reports as
   `preGate` has no quote in `{quotedSourcesJson}`: the lens checks the code against the slices
   it was given, as it would for any rule the quotes do not cover.
2. **Visibility** — a two-seat diff: does any hidden information leak to a seat that should not
   see it?
3. **Undo** — does undo (where applicable) restore state cleanly, with no residual leak or
   desync?
4. **Constraints** — does the chunk hold the project's own hard constraints (the project
   `CLAUDE.md`'s "Hard constraints" section, recorded in `design/CONSTRAINTS.md`), and is every
   structure it adds to persistent state that grows with players or with time capped? This lens
   reads `CLAUDE.md`, `design/CONSTRAINTS.md`, `RULINGS.md` and the code, never the rulebook, so
   it works the same whether the project was built from a rulebook or from existing code. See
   "The Constraints Lens" below for what the orchestrator does with its report.

For `ui: touches|major` chunks, a 5th agent is dispatched via `build/design-review.md`
(forward-reference — authored in this phase's Plan 02): a screenshot-armed review against
`DESIGN.md` and frontend-design craft criteria. Its findings land in the same `## Findings
Ledger` as the four lenses above, through the orchestrator, never a separate track.

## Gate Before Dispatch: No Review Until Verify Passes

No audit round starts until `boardsmith verify` has passed for the commit under review
(`routing.md` "No Review Before Verify"). Before each round, the orchestrator commits what is
uncommitted (the Step Checklist check-off included), runs `npx boardsmith verify --chunk <slug>`,
then:

```bash
npx boardsmith review-gate <slug>                                   # round 1
npx boardsmith review-gate <slug> --since <commit round N-1 reviewed>  # every later round
```

adding `--work-role mechanical --since <commit before it>` when the work under review was a
mechanical change. A refusal means no lens is dispatched: a failing verify goes back to the step
that made the change, one role up, with verify's own output, never to a reviewer. Open, the
command prints the review level and the brief that fills `{verifyResult}` in every template
below:

- `full`: every lens (and the design review, for a `ui: touches|major` chunk), as below.
- `light`: one agent of the `review` role, given the brief and all four lenses' judgement checks,
  reviewing only the change the brief names.
- `none`: no round. Verify is the whole gate for that change; record nothing and move on.

The round is recorded as a `### Review Round N` entry (`Step: audit`, `Reviewed: Dispatch M` for
the `build` or `repair` whose work it reviews, the level, `Verify: <commit> passed` as the brief
names it, the agents) in the chunk's run log before the lenses are dispatched.

### Dispatch Templates

**Fidelity lens:**

```
Work package: {slug}

You are auditing built code for {gameName}, chunk "{slug}", for RULES FIDELITY. The mechanical
checks are done. This is what `boardsmith verify` found for the commit under review:

{verifyResult}

Read the following rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project; rulings
outrank the rulebook (state-machine.md "Rulings Outrank Rulebook"); the rulebook plus
RULINGS.md together form the composite source of truth. Do NOT read this chunk's CHUNK.md
"## Interpretation" section — you are checking the CODE against the RAW SOURCE, not against a
prior agent's summary of it.

Then read the built code at: {codeFilePaths}.

These are the source passages this chunk was built on, as
`boardsmith claim-quote-check {slug} --json` reports them: each quote and the location it came
from, without any agent's reading of it. RE-OPEN every location yourself, read the passage in its surrounding context, and check the
code against what the source says there, not against the quote alone. A location pinned to a
commit, `<path>@<commit>:<lines>`, is code this chunk replaced, as it was in that commit: read it
with `git show <commit>:<path from the project root>`, and check the built code for what replaced it:

{quotedSourcesJson}

Judgement checks (the only ones you make):
  - Does the code do what the source says there, in every case the source covers?
  - Is each rule the source states tested for the behaviour it describes (not whether the tests
    pass: verify did that)?

Every finding quotes the exact source text it rests on and its location (rulebook section, or
file and line when the source is code). If you believe the code is wrong but no source passage
says what it should do instead, do not invent the rule: report it as a question for the
designer, listing every location you searched. Never say the source is missing without that
list.

Return exactly: a list of { findingId, lens: 'fidelity', kind: 'defect' | 'question',
description, quote, citation, severity } — one entry per defect or question (empty array if
none). A 'defect' needs a quote found at its citation; a 'question' has an empty quote and a
citation listing where you looked.
```

A fidelity `question` is never repaired by guessing. The orchestrator records it in the
`## Findings Ledger` like any finding and puts it to the designer the way `build/ask.md` puts an
open question: a `QUESTIONS.md` entry with `Answer: pending` (the batched-question queue in
`state-machine.md`), in designer language. The answer becomes a `RULINGS.md` ruling, and only
then does `repair` act on it.

**Visibility lens:**

```
Work package: {slug}

You are auditing built code for {gameName}, chunk "{slug}", for HIDDEN-INFORMATION LEAKS. The
mechanical checks are done. This is what `boardsmith verify` found for the commit under review:

{verifyResult}

Read the RAW rulebook slice(s): {slicePaths}, and read RULINGS.md in this project; rulings outrank
the rulebook (state-machine.md "Rulings Outrank Rulebook"), and a house rule in RULINGS.md can
make something public that the printed rulebook hides, or vice versa. These raw sources, NOT the
Visibility Declaration, are the ground truth for what each seat should and should not see. Then
read the built code at: {codeFilePaths}. Do NOT read CHUNK.md "## Interpretation".

The chunk's investigate-produced Visibility Declaration is provided below as a CLAIM to verify
against the raw sources — treat it the way redteam checks a claims list, not as an unchallengeable
oracle. If it disagrees with the raw slice + RULINGS.md (e.g. it declared a public value secret,
or missed a ruling that makes a value public), that disagreement is itself a finding.

{visibilityDeclarationText}

Judgement checks (the only ones you make):
  - What may each seat see, per the raw slice(s) + RULINGS.md, and does the Visibility
    Declaration agree?
  - Does anything reach a seat that should not see it?

To probe the second, using the generated project's own test harness, make a two-seat diff via
`diffPlayerViews(testGame, seatA, seatB)` (the atomic overload — avoids the WR-02
different-instants footgun) from `boardsmith/testing`, and check the rendered UI output with
`assertNoHiddenInfoLeak(...)` from the same package. Report anything either check surfaces as
visible to a seat that — per the raw slice(s) + RULINGS.md — should not see it, including cases
where the Visibility Declaration itself is wrong about what should be hidden.

Return exactly: a list of { findingId, lens: 'visibility', description, citation, severity } —
one entry per leak found (empty array if none).
```

**Undo lens:**

```
Work package: {slug}

You are auditing built code for {gameName}, chunk "{slug}", for UNDO SANITY. The mechanical
checks are done. This is what `boardsmith verify` found for the commit under review:

{verifyResult}

Read the built code at: {codeFilePaths}. Do NOT read CHUNK.md "## Interpretation".

Judgement checks (the only ones you make):
  - Does every undoable action in this chunk restore prior state cleanly, with no residual visible
    state, no desync between engine state and what either seat's view reports, no orphaned
    hidden information exposed by the undo path itself?

Return exactly: a list of { findingId, lens: 'undo', description, citation, severity } — one
entry per defect found (empty array if none).
```

**Constraints lens:**

```
Work package: {slug}

You are auditing built code for {gameName}, chunk "{slug}", against THE PROJECT'S OWN HARD
CONSTRAINTS. The mechanical checks are done. This is what `boardsmith verify` found for the
commit under review:

{verifyResult}

Read the project's CLAUDE.md (its "Hard constraints" or "Hard Rules" section, if it
has one), design/CONSTRAINTS.md, and RULINGS.md. Then read the built code at: {codeFilePaths},
which is every file this chunk wrote or changed. Do NOT read CHUNK.md
"## Interpretation" or the rulebook: this lens checks the code against the project's
constraints, not against the rules.

Judgement checks (the only ones you make):

1. For EVERY hard constraint in design/CONSTRAINTS.md (C1, C2, ...), give a verdict: held,
   violated, or not applicable, with a citation (file and line, or the test that proves it).
   A constraint in CLAUDE.md that the ledger does not list is itself a finding.
2. Find every list, map, queue or counter this chunk adds to persistent state that grows with
   the number of players or with time. Each one needs a cap the code enforces, or a designer
   ruling in RULINGS.md that lets it grow. A structure with no cap is a finding by default.
3. Where a constraint is measurable (a size budget, a count), it must be proven by a test, not
   by your judgement. For a size budget the test fills every growing structure to the cap the
   code enforces, at the declared maximum population, with every per-seat list full, and
   checks the budget. A test that measures an expected population or a count it picked itself
   is a finding.
4. A try/catch that swallows a platform refusal (for example `undeclared-partition`) is a
   finding: the command must not reach what it did not declare.

Return exactly: a list of { findingId, lens: 'constraints', constraint, verdict, description,
citation, severity } — one entry per hard constraint (constraint: 'C1', verdict: 'held' |
'violated' | 'not applicable') and one per growing structure this chunk adds (constraint:
'growth', verdict: 'held' when capped or ruled, 'violated' when not; description names the
structure, what it grows with, and its cap or ruling).
```

Field names follow `build/redteam.md`'s precedent (`claimNumber`/`verdict`/`objection` /
`missingInteractions`) — flat and grep-able, not a new ledger structure: `findingId`, `lens`,
`description`, `citation`, `severity`, plus the fidelity lens's `kind` and `quote` and the
constraints lens's `constraint` and `verdict`.

## The Constraints Lens — Its Report Lands in Code-Checked Files

The lens judges; `boardsmith constraint-check` decides. When the constraints lens returns, the
orchestrator, before `repair` starts:

1. If `design/CONSTRAINTS.md` does not exist yet, copies it from
   `${CLAUDE_SKILL_DIR}/../bs-shared/templates/CONSTRAINTS.template.md`. It adds a `### C<n>`
   entry for any CLAUDE.md hard constraint the lens found missing, and a `### G<n>` entry for
   every growing structure the lens reported, with the cap or ruling it has (or neither).
2. Writes this chunk's `## Constraints Review` in CHUNK.md: one line per constraint,
   `- C1: held. <citation>` (or `not applicable` or `violated`), exactly as the lens gave it.
3. Runs `boardsmith constraint-check {slug}`. It refuses a growing structure with no cap
   enforced in code and no RULINGS.md ruling, a cap whose measurement test never uses it, a
   hard constraint the ledger leaves out, a missing or `violated` verdict, and a failing
   measurement test. Every refusal, and every `violated` lens entry, becomes a finding in this
   round's `### Audit Round N` entry with `lens: 'constraints'`.

`repair` fixes a constraints finding by adding the cap in code (and the test that fills it to
that cap at the declared maximum population), or, when the designer may want the growth, by
putting it to the designer the way `build/ask.md` puts an open question. Their answer becomes a
`RULINGS.md` ruling, and the structure's `- Ruling: Ruling <n>` line cites it. Nothing else lets a
growing structure through: `boardsmith chunk-signoff` runs the same check and refuses to sign
the chunk off while it fails, so an uncapped structure cannot reach `verified`.

The rules are the same for a project built from a rulebook or from existing code: the check
reads CLAUDE.md, the ledger and the code, never the rulebook. With no slug,
`boardsmith constraint-check` checks the whole tree and runs every measurement test, which is
what a merge re-runs on the combined result when chunks were built on separate branches
(`boardsmith chunk-merge` does exactly that).

## The Cross-Chunk Lens — After a Merge of Chunks Built at the Same Time

Chunks built side by side (`orchestrate/chunk-dispatch.md` "Parallel Dispatch") never saw each
other's code. When `boardsmith chunk-merge` lands one, it lists in `design/CROSS-CHUNK.md`, as a
`### Merge N` entry with `- Verdict: pending`, every source file both it and the chunks merged
while it was being built changed, and every name (an id, a declared constant, a key, a quoted
string) both sides touched and one side defines. It cannot tell whether they conflict; this lens
can. `boardsmith ledger-check` fails while any verdict is pending, so no chunk closes and no
further merge lands until this lens has ruled.

It is a review like any other, so it waits for verify: in the main checkout, run
`npx boardsmith verify --chunk <slug>` for the chunk just merged, then `npx boardsmith review-gate
<slug>`, and record the round (`Step: cross-chunk`, `Reviewed: Dispatch M` for the chunk's
dispatch that closed) in that chunk's run log. The orchestrator then
dispatches it as its own fresh-context agent of the `judgement` role, against the main checkout,
with only the gate's brief and the entry's text (its chunk, the chunks built alongside, the shared
files and names):

```
Work package: {slug}

Chunks {slug} and {alongside} of {gameName} were built at the same time without seeing each other,
and have just been merged. The mechanical checks are done. This is what `boardsmith verify` found
for the merged commit:

{verifyResult}

Here is every place their changes meet: {sharedFilesAndNames}.

Judgement checks (the only ones you make):
  - For each place, read the combined code at both sides and decide whether the two chunks still
    agree: one side must not remove, rename, or change the meaning of something the other relies
    on (a venue one destroys while the other still sends players there, a counter both
    increment, an id both define).

Do not report style. Return exactly: { verdict: 'no conflict' | 'conflict', reason, reopen?: slug,
evidence: [file:line, ...] }.
```

It records the result by replacing that entry's `pending` line, and nothing else:

- `- Verdict: no conflict: <reason, citing file:line>`, or
- on a conflict, first `boardsmith chunk-reopen <slug> --reason "<what breaks>"` for the chunk that
  must change (normally the one merged last), then `- Verdict: conflict: <slug> reopened, <what
  breaks>`. The reopened chunk goes back through repair and its own gates, like any other finding.

Commit that line before dispatching anything else. `boardsmith ledger-check` accepts only those
two shapes, and a conflict must name a chunk that exists.

## Visibility Lens — Real APIs, Cited by Exact Name

The visibility lens must cite the real functions, not describe the check in prose alone
(per 145-RESEARCH.md "Don't Hand-Roll"):

- `diffPlayerViews(testGame, seatA, seatB)` (`src/testing/view-diff.ts`) — the atomic overload,
  which avoids the WR-02 footgun of diffing two views captured at different game-state instants.
  Returns `{ onlyInA, onlyInB, attributeDiffs, describe() }`.
- `assertNoHiddenInfoLeak(testGame, seat, options?)` (`src/testing/dom-leak.ts`) — a DOM-rendered
  leak assertion, catching UI-smuggled hidden values (e.g. a placeholder `aria-label` that echoes
  a hidden card's identity) that a pure JSON-view diff would miss. **For any chunk whose game has
  a custom board, pass `{ component: <the game's root UI component> }`** — the default renders
  AutoUI, so without it the check scans markup the players never see and a green result does not
  cover the game's own board. Put `await preloadSeatRenderer()` (same package) at the top of the
  test file, so the one-time Vue module load does not land inside the first test's timeout.

## Persisting the Round — Write to the Findings Ledger BEFORE Repair Starts

The orchestrator appends a `### Audit Round N` entry to CHUNK.md's `## Findings Ledger`
(`templates/CHUNK.template.md`; cite the section by name, never restructure it), and fills the
run log's `### Review Round N` Outcome (`clean`, or `changes requested`), as soon as all
of this round's lens agents (and the design-review agent, if dispatched) have returned — this
write happens **before** `repair` starts, mirroring `build/redteam.md`'s "Persisting the Round"
write-before-next-step discipline. Each new finding gets a stable ID (e.g. `F1`, `F2`, ...) that
never changes or is reused across rounds.

**Cold-resume rule:** a session resuming at `audit` (unchecked on the Step Checklist) with a
partial or missing current-round entry in `## Findings Ledger` re-dispatches this round's lenses
from scratch, each at its own role as above (the fidelity lens at the `judgement` role, the others
at the `review` role) — the round is not considered complete, and no partial finding list is trusted,
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
