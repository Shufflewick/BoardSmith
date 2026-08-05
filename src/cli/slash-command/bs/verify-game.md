---
name: bs-verify-game
description: Re-verify an existing bs-built game's rulebook against its archived source, staging the re-transcription non-destructively for later comparison. Use against a project /bs-ingest-rules already scaffolded, not to build or rebuild a game.
---

# `/bs-verify-game` — Stage a Re-Transcription Pass

Cite `state-machine.md` rather than restating its rules — if you are extending this skill, link
to the relevant section instead of copying rule text. This file is a lean router: it detects
state, resolves the source, dispatches to `verify/source-resolution.md`,
`verify/staging-dispatch.md`, `verify/classification-dispatch.md`, `verify/ruling-recheck.md`,
`verify/repair-dispatch.md`, `verify/enumerate-facts.md`, and `verify/reconcile-facts.md` for their
heavyweight prose, and closes the run. It does not explain
the status enum, the consistency check, or the session lock inline — see
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.

**This skill does NOT run the BUILD pipeline's `investigate`/`redteam`/`ask`/`build` steps to
scaffold a new chunk** — that remains `/bs-build-chunk`'s job, not this skill's. It reads the
archived rulebook, stages a fresh re-transcription into a run-scoped, non-live directory, records
each completed unit through the ledger CLI, classifies each staged/live pair's rule delta, and —
since a `contradictory` verdict demands it — adjudicates and marks affected chunks rules-stale.
Repair (Step 6, below) MAY change an EXISTING stale chunk's already-built code — that is decision
12's explicit seam into the impact map's VERIFY-06 gate — but nothing in this skill ever builds a
brand-new chunk from scratch.

Comparison happens in Step 3, below; no staged slice ever takes a live
one's place, at that step or any other. There is no flag or path anywhere in this skill that writes
staged output into a live location.

## Invocation

```
/bs-verify-game
```

No arguments. It runs against the bs-built project in the current directory.

## How to Talk to the Designer

Everything the designer reads — every step's findings, every question, the close-out — follows
`${CLAUDE_SKILL_DIR}/../bs-shared/reporting.md`. This skill is the most jargon-prone in the family,
because each of its steps produces a ledger, so the rule bites hardest here:

- **Report what it means for their game, not what the check recorded.** "The rulebook doesn't
  answer 26 of the calls you made — they still stand as your decisions" is the finding. "26/26
  recorded, 0 pending, still-needed 26" is not.
- **No ledger tables.** No requirement tags (`CHECK-01`, `VERIFY-04`), run ids, staging paths,
  handshake tokens, model names, or verdict spellings in the body — translate them.
- **A pass with nothing for the designer to do says so in one line**, and does not enumerate the
  checks that found nothing.
- **Findings that need them get named plainly**, with the one action each implies.

An entire verify pass usually deserves a short paragraph plus the questions it needs answered.

## Context-Economics Hard Rule

**The orchestrator never opens a slice — staged or live.** This is enforced structurally, not by
this paragraph alone: the re-transcription subagent it dispatches (the same
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` contract `/bs-ingest-rules`
uses) writes its own output directly to the path it is given and RETURNs a structured summary
only — it never returns transcribed text. The orchestrator has no step anywhere in this skill
that reads a slice file back. The observable a reviewer can check: this skill's own transcript
should never contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line — those
strings exist only inside a written slice, staged or live, and this orchestrator never opens one.

**Context-Economics carve-out for CHECK-04's dispatch prompts (Step 7):** the sentence above
describes the ORCHESTRATOR's own transcript, and that stays true unchanged — this orchestrator
still shows zero quoted-rule lines, zero `Derived (p.` lines, and zero `Visual (p.` lines in its
own transcript. The exception belongs to the SUBAGENT dispatch prompts and returns, not to the
orchestrator: `verify/enumerate-facts.md`'s enumerator prompt legitimately carries quote lines —
that is its entire payload — because it is the `slices[].enumeratorPayload` bytes
`boardsmith verify-derive-check --json` already built, dispatched unchanged. And
`verify/reconcile-facts.md`'s reconciler prompt and return legitimately carry `Derived` line text
and fact statements, because classifying a `Derived` line requires citing it. Those payloads are
constructed by `buildEnumeratorPayload` (`verify-enumerate.ts`) and `verify-derive-check`'s own
`slices[].derivedLines` field, passed through the dispatch, never composed by this orchestrator
reading a slice itself — which is what keeps the orchestrator's own rule true even while the
subagents' payloads legitimately carry exactly the strings the rule forbids from this transcript.
This is the identical exception `174-PROOF.md` §3 already documented for
`quotedPass1`/`quotedPass2` in the classification contract: the subagent's structured return is
the one legitimate place a quoted line lives, never the orchestrator dispatching it.

A reviewer checks TWO separate observables here, never one blanket grep across both: the
enumerator prompt (`BS-ENUMERATE-V1`) must contain ZERO `Derived (p.`, ZERO `Visual (p.`, and ZERO
`Named-but-undefined (p.` lines — no exception applies to it, which is stronger than this rule's
own transcript check — while the reconciler prompt and return (`BS-RECONCILE-V1`) are EXPECTED to
contain `Derived` line text, accounted for by this carve-out.

**Context-Economics carve-out for CHECK-06's dispatch prompts (Step 8):** the same two-observable
discipline applies here, and the observables INVERT relative to CHECK-04's — do not collapse this
into one blanket rule. The extraction dispatch prompt (`BS-EXAMPLE-EXTRACT-V1`, built by
`boardsmith verify-example-replay --json` as `slices[].extractionPayload` and dispatched
unchanged) legitimately carries BOTH quote lines AND `Visual (p.` lines — that is its entire
payload, because a worked example's supporting evidence is exactly those lines, and `seven`'s Run
example (text "5, 6, 7" vs. a `Visual (p.1):` line naming 1, 2, 3) is visible as a contradiction
ONLY through the `Visual (p.` line reaching the extractor. The reviewer's observable for THIS
prompt is the opposite of CHECK-04's enumerator observable: it must contain ZERO `Derived (p.`
lines — no exception applies to it, since a worked example is never itself a `Derived` line. The
translation dispatch prompt (`BS-EXAMPLE-TRANSLATE-V1`, built by
`boardsmith verify-example-translate --json` as `payloads[].translationPayload`) legitimately
carries the extracted `WorkedExample` spec's verbatim source text and the game's exported API
surface (`collectGameApiSurface`, `example-derivation.ts`) — never composed by this orchestrator,
never restated in this file's own prose. Both prompts are constructed entirely by the two named
commands and dispatched unchanged, which is what keeps the orchestrator's own transcript rule true
even while these subagent payloads legitimately carry exactly the strings that rule forbids from
this transcript.

## Step 0: State Detection and Lock (VERIFY-01)

On entry, before any other work, run the consistency check described in
`${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Consistency Check") — cite it, do not
restate its items.

**If this is not a bs-built project** — no `SKETCH.md`, no `rulebook/` — STOP and say so, naming
what was missing. Do not offer to build one; that is `/bs-ingest-rules`'s job, not this skill's.

Then handle the session lock per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Session
Lock"), reusing that EXACT mechanism — the same `SKETCH.md` `Session Lock:` line, the same
`date -u +%Y-%m-%dT%H:%M:%SZ` timestamp source, the same 24-hour staleness rule, the same
resume-refresh path. This is not a second lock; it is the existing one, with a verify-shaped
identity in the slug position: `verify:<run-id>` rather than a chunk slug (a verify pass has no
chunk to name). This position is prose-read — nothing in this repo parses it in code — and its
only job is to make a verify lock distinguishable at a glance from a chunk-build lock, so the two
can never silently overlap: a designer reading `Session Lock: verify:2026-07-28T22-00-00Z @
session-abc — locked at ...` knows immediately this is a verify run, not a chunk in progress, and
vice versa.

A lock naming the run being resumed (the same `run-id`) is refreshed and continued — the normal
resume path. Any other live, non-stale lock warns the user instead of silently proceeding. A lock
older than 24 hours is reported as stale and the user confirms clearing it before this session
takes it. A clean close (Step 9, below) releases the line to exactly `none`.

## Step 1: Source Resolution (VERIFY-01)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md` for the full gated
adoption flow and the stop-and-ask rules governing which archived rulebook this pass verifies
against. In short: an already-archived source proceeds as-is, a single unarchived candidate at
project root is adopted only after the designer confirms, multiple candidates stop the session, and
a hash mismatch against the archive is recorded as a signal and never silently overwritten. A
project with no candidate source anywhere — neither an archive nor a root candidate — continues in
source-free mode via `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-free-mode.md` rather than
stopping the session.

## Step 2: Staging Run and Re-Transcription (VERIFY-02, VERIFY-07, VERIFY-08)

**Steps 2 through 6 do not run in source-free mode** — each consumes a FRESH RE-TRANSCRIPTION of
the archived source, and with no source there is no fresh transcription for any of them to
consume, so they have no input. This does not apply here: Step 1 already resolved a source, or
this pass would already be running `verify/source-free-mode.md` instead.

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/staging-dispatch.md` for the full run
allocation, ledger-driven resume, fan-out dispatch, and per-unit recording sequence. In short: a
`verify-run-init` call allocates (or resumes) a run-scoped staging directory, a
`verify-run-status` call decides exactly which units still need re-transcription, each needed
unit is dispatched to the shared transcription-subagent contract with its output directory set to
the staging path, and each completed unit is recorded via `verify-run-record` — never by trusting
what files exist on disk.

## Step 3: Classification (VERIFY-03, VERIFY-07)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md` for the full pair
enumeration, ledger-driven resume, per-pair subagent dispatch, and verdict recording sequence. In
short: a `verify-classify-pairs` call groups live and staged slices by page-span overlap, a
`verify-classify-status` call decides exactly which pairs still need classifying, each pending pair
is dispatched to the shared classification-subagent contract (the one place either slice is
legitimately read), and each returned verdict is recorded via `verify-classify-record` — never by
the orchestrator opening a slice itself. This step records verdicts only; acting on them — the
adjudication gate and the rules-staleness write — is Step 4's job, below.

## Step 4: Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05, VERIFY-06)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md` for the full
stop-and-ask presentation, the RULINGS.md/UNADJUDICATED write, the rules-staleness marker write,
and the impact-map report. In short: classification of all pairs completes first (Step 3, above),
then every `contradictory` verdict is presented at once and the pass STOPS until the designer
answers — there is no flag, option, or unattended-mode carve-out that skips this. A resolution
appends a `RULINGS.md` entry, or is recorded `UNADJUDICATED` if deferred or aborted; either way,
the rules-staleness marker is then written into each affected chunk's CHUNK.md and SKETCH.md and
the impact map is appended to the run's ledger. Finally the stale fraction and each chunk's
repair-gate disposition are reported — cite `verify-impact.ts`'s `REPAIR_GATE_DISPOSITIONS` for
the full enumerated set rather than restating its members here, since a restated list goes stale
the moment that array gains or loses a value. Cite `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md`
sections by name; restate nothing. This step still only decides WHICH chunks need repair; Step 6,
below, dispatches `verify/repair-dispatch.md` to actually perform it.

## Step 5: Ruling Re-Check (CHECK-01)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` for the full judgment
contract. In short: every `RULINGS.md` entry without a resolved `supersededBy` (parsed once, via
`parseRulings` — the one ruling parser in this repo, never a second regex path) is dispatched, in
turn, to a fresh-context subagent carrying the `BS-RULING-RECHECK-V1` handshake token, together
with that ruling's own full body text (Decision/Citation/Rationale) and the fresh STAGED
transcription only — never the live `rulebook/` slices. Each subagent returns exactly one of
`still-needed`, `resolved-by-source`, `contradicted`, or `undetermined`, with mandatory reasoning.
Record each returned verdict, one call per ruling, with

```
boardsmith verify-ruling-record --run-id <id> --number <n> --verdict <v> --reasoning "<text>"
```

— the ONLY write surface for this check; `boardsmith verify-ruling-recheck` is read-only and
reports what has been recorded so far, so a verdict never recorded stays `pending` forever. This
orchestrator never reads a ruling body or a slice itself; it dispatches, then records exactly what
comes back.

**Reporting this check.** Per `reporting.md`, tell the designer only what changed for the calls
they made. A ruling the fresh read still doesn't answer needs no mention beyond a single count in
plain words — those decisions still stand, and nothing is asked of them. What DOES earn a sentence
each: a ruling the rulebook now answers (they may want to drop their call and follow the book), and
a ruling the rulebook now contradicts (a decision to revisit). Never print the four verdict names,
a per-ruling table, a records-written count, or a ledger path.

## Step 6: Repair Dispatch (CHECK-02)

Dispatch to `${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md` for the full route into
the existing build-pipeline audit/repair loop. In short: only chunks Step 4's impact map marks
`stale === true` are dispatched — never every chunk, and never a chunk this skill re-derives
staleness for on its own. For each, `boardsmith verify-repair`'s helpers resolve the chunk's fresh
STAGED slice paths and route it through `build/audit.md`'s three lenses (plus the 4th
design-review lens for `ui: touches|major` chunks) and `build/repair.md`'s bounded loop — reused
by reference, never forked. Each verify pass opens a fresh 3-round budget per chunk, appended
after that chunk's existing rounds, never renumbering history. Once every finding across the
episode's rounds has a disposition, the repair-gate disposition is re-derived from the freshly
re-checked post-repair code state — never Step 4's pre-repair snapshot — because repair MAY change
an existing chunk's code: a chunk whose code changed during repair re-opens the human playtest
gate, and a chunk that passes the lenses unchanged closes without re-playtesting.

## Step 7: Derived-Line Re-Check (CHECK-04)

In short: this check is independent of staleness and repair — it does not consume Step 4's
staleness verdicts and does not scope to the chunks Step 6 touched. Run
`boardsmith verify-derive-check --json`. Every `Derived` line surviving `isPresentationLine`
exclusion is enumerated PROJECT-WIDE, all of them, never scoped to stale chunks — independent of
Step 4's staleness verdicts and not scoped to the chunks Step 6 touched.

For each slice the command reports as pending, dispatch the SAME `slices[].enumeratorPayload`
bytes TWICE, unchanged, to two independent cross-family subagents carrying
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/enumerate-facts.md`'s `BS-ENUMERATE-V1` handshake —
enumerator A on `claude-opus-5`, enumerator B on `claude-haiku-4-5-20251001`. The model ids come
from the command's own `models` field, so this prose and the code cannot drift. Cross-family
independence is load-bearing: two same-family enumerators would confirm each other's decomposition
rather than independently reproduce the facts.

Dispatch a THIRD subagent on `claude-sonnet-5` carrying
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/reconcile-facts.md`'s `BS-RECONCILE-V1` handshake, the two
enumerator returns, and `slices[].derivedLines`.

Record all three returns through exactly ONE `boardsmith verify-derive-record` invocation per
SLICE — the CLI write surface's atomic upsert-append, never a whole-ledger rewrite, so recording a
later slice never destroys a verdict already recorded for an earlier one. Grounding validation,
arithmetic composition, and classification all happen INSIDE that command, never in this skill.

Report by formatting `boardsmith verify-derive-check --json`'s output —
**formatted, never computed** by this skill, the same discipline Step 9's Close already holds.
Findings are reported and exit 0 — a non-corroboration is worth a human glance, NEVER a verdict,
and this check must not be used as a build gate.

"Formatted, never computed" governs where the numbers come from; `reporting.md` governs what the
designer actually reads. Say what a non-corroborated line means for their game — a statement in
the rulebook notes that the printed rules don't back up, worth their eye — and name the ones that
matter. If every line corroborated, that is one sentence, not a table.

## Step 8: Worked-Example Replay (CHECK-06)

In short: this check is independent of staleness and repair — it does not consume Step 4's
staleness verdicts and is not scoped to the chunks Step 6 touched. Run
`boardsmith verify-example-replay --json` PROJECT-WIDE.

For each slice the command reports pending, dispatch that slice's `slices[].extractionPayload`
UNCHANGED to a subagent carrying
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md`'s `BS-EXAMPLE-EXTRACT-V1` handshake,
and save the returned structured object to a file.

Obtain the SECOND dispatch's bytes from `boardsmith verify-example-translate --slice-path <p>
--extraction <that return file> --json`, and dispatch each returned `payloads[].translationPayload`
UNCHANGED and SEPARATELY to a subagent carrying
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/translate-example.md`'s `BS-EXAMPLE-TRANSLATE-V1`
handshake. Two dispatches, never one combined pass — a combined pass would let the model work
backward from code it can already see, producing agreement with itself rather than a real test of
the printed example. This skill never composes a translation prompt itself: the game's exported
API surface is collected mechanically by `verify-example-translate`, and restating it here would
be the duplication this step exists to avoid. Entries the command reports under `notTranslated[]`
(an `example-inconsistent` extraction) are passed straight through to the record command, never
re-judged here.

Record through exactly ONE `boardsmith verify-example-record --slice-path <p> --extraction <f>
--translation <f>` invocation per SLICE — an atomic upsert-append, never a whole-ledger rewrite.
Provenance gating, spec validation, and verdict classification all happen INSIDE that command,
never in this skill.

Execute each translated test with the project's own test runner; the recorded verdict comes from
actually running it and observing its pass/fail result — never from the translator's own
`verdictHint`, which is a model's guess, not an observation.

Report by formatting `boardsmith verify-example-replay --json`'s output — **formatted, never
computed** by this skill, the same discipline Step 7 and Step 9's Close already hold. Report raw
counts and a per-slice breakdown, never a percentage; at this corpus's size (measured reality: ~5-6
examples across all three reference games) say plainly when the corpus is too small to distinguish
the mechanism working from luck rather than manufacture a score. Report the two mismatch buckets
distinctly, gated on `QuoteVerifiedProvenance` (decision 12): mismatches where the supporting
quote is source-verified, and mismatches where it is NOT — the latter is a question about the
quote, never an accusation against the code.

Say it in the designer's terms, per `reporting.md`: the rulebook's own worked examples were
replayed against the game, and here is where the game and the book disagree — naming the example
by what it shows ("the scoring example on the back page"), never by slice path or id. A mismatch
whose supporting quote isn't source-verified is presented as a question about the transcription,
not as a bug in their game.

A slice or game with ZERO extractable examples is reported as a real finding about the ingest
contract — examples were not transcribed — never as a tuning signal and never a reason to loosen
extraction.

Findings are reported and this check exits 0. It is deliberately asymmetric with
`build/test.md`'s own worked-example step (TEST-01), which is build-blocking: in build, the chunk
was just written to satisfy those exact slices, so a mismatch there is precisely the drift that
step exists to catch; here, on a project-wide sweep independent of staleness, a mismatch is
reported and this check must NEVER be used as a gate on the Close (Step 9, below).

## Step 9: Close (VERIFY-02)

When `verify-run-status` reports every unit recorded and `verify-classify-status` reports every
pair classified, the pass closes:

- Record the run's staging path (`rulebook/.verify/<run-id>/slices/`) in the provenance block —
  staging is KEPT after this pass closes, never deleted; it is the evidence behind every later
  verdict.
- Report the run's classification verdicts to the designer by formatting
  `verify-classify-status --json`'s output — **formatted, never computed** by this skill; every
  number in the report comes from the command's JSON, not from this skill's own arithmetic.
  Per `reporting.md`, that report is prose about their rulebook, not the command's field names:
  which rules read differently on a fresh pass, which parts of the game that touches, and what
  they need to play again. A pass where nothing moved is one sentence.
- Dispatch `boardsmith verify-close-record --project <project> --run <run-id>`, which durably
  records each evaluated chunk's `## Verified Against` block — the scope, its reason when reduced,
  the edition anchor, and the cited-slice hashes. This bullet exists because, until this phase,
  `## Verified Against` was written only by the BUILD pipeline's `chunk-check` — a verify pass, the
  one pipeline whose entire job is verification, recorded nothing. Report the command's
  `recorded[]` and `errors[]` by formatting its `--json`; a non-empty `errors[]` names the chunks
  that could not be recorded and does NOT fail the pass, matching this skill's standing rule that
  advisory results never gate a Close. Place this bullet before the commit bullet below, so the
  write is part of what gets committed.
- Commit per `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` ("Git Protocol").
- Release the session lock: rewrite `Session Lock:` in `SKETCH.md` to exactly `none`, the same
  clean-close release the chunk-build lock already uses.

**In source-free mode**, this Close is reached from `verify/source-free-mode.md`'s own Close
section rather than from Steps 2-6 completing, the recorded scope is `code-conformance-only` with
the reason from `verify-source-free-check --json`, the same `verify-close-record` dispatch runs
WITHOUT `--run` (source-free mode allocates no staging run, so there is no ledger to name), and the
unchecked defect classes are reported formatted from that same command's `uncheckedDefectClasses[]`.

There is no promotion of a staged slice over a live one, at this or any earlier step.

## Reference Files

This skill delegates its heavyweight, step-scoped prose to:

- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-resolution.md` — decision 1's gated adoption
  flow and the stop-and-ask rules
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/source-free-mode.md` — VERIFY-09's reduced sequence for
  a project with no candidate source anywhere: which steps still run, the formatted unchecked-class
  report, and the Close that records `code-conformance-only` scope
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/staging-dispatch.md` — run init, ledger-driven resume,
  fan-out dispatch into staging, per-unit recording, close
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md` — pair enumeration,
  ledger-driven resume, per-pair subagent dispatch, verdict recording
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md` — the one judgment
  contract: the rule-delta decision procedure and the structured RETURN shape
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md` — the hard adjudication gate,
  the rules-staleness write, and the impact-map sequence
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` — CHECK-01's judgment contract: the
  four-verdict set, the absence-of-source trap, and the `BS-RULING-RECHECK-V1` dispatch handshake
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md` — CHECK-02's route into
  `build/audit.md`'s three lenses and `build/repair.md`'s bounded loop, reused by reference
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/enumerate-facts.md` — CHECK-04's enumeration contract:
  the `BS-ENUMERATE-V1` dispatch handshake, the never-sees list, and the no-arithmetic rule
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/extract-example.md` — CHECK-06's extraction contract:
  the `BS-EXAMPLE-EXTRACT-V1` dispatch handshake and the rule that an example contradicting its
  own source is never turned into a test — `example-inconsistent` never picks a side
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/translate-example.md` — CHECK-06's translation
  contract: the `BS-EXAMPLE-TRANSLATE-V1` dispatch handshake and the rule that a spec the game
  cannot yet express is `unexecutable` only with a named reason, never a failing test
- `${CLAUDE_SKILL_DIR}/../bs-shared/verify/reconcile-facts.md` — CHECK-04's reconciliation
  contract: the `BS-RECONCILE-V1` dispatch handshake, the verbatim-quote grounding rule, the
  `arithmeticSpec` pointer, and the `absence` proposal

And to the shared reference files that ship with every `bs-` skill:

- `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` — status enum, consistency check, session
  lock, write order, authority
- `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` — the transcription contract
  this skill reuses UNCHANGED, parameterized by output directory (decision 15); it is never
  forked here

**Installed location:** this file installs as `.claude/skills/bs-verify-game/SKILL.md`. The
shared `verify/`, `ingest/`, and `state-machine.md` referenced above install under the
`bs-shared/` namespace root alongside `bs-verify-game/` — one directory up from this file then
into `bs-shared/`, at `.claude/skills/bs-shared/verify/`, `.claude/skills/bs-shared/ingest/`, and
`.claude/skills/bs-shared/state-machine.md`. `${CLAUDE_SKILL_DIR}` is Claude Code's built-in
substitution for "the directory containing THIS skill file," resolved to an absolute path before
the model ever sees the content — so `${CLAUDE_SKILL_DIR}/../bs-shared/...` resolves correctly no
matter whether this skill is installed at the project (`.claude/skills/`) or personal
(`~/.claude/skills/`) level. The installer (`src/cli/commands/install-claude-command.ts`) MUST
preserve this layout — `verify/`, `ingest/`, and `state-machine.md` under the `bs-shared/` root
beside every `bs-*` skill directory under `.claude/skills/` — or update this paragraph.
