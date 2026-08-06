# Spec — Executable Tests First, Observed Failing (BUILD-04a / TDD-01)

Referenced by `build-chunk.md` Step 4 (`spec`, first of the `{spec, build, test}` session step
group — see `state-machine.md` "Session Handoff Seams"). This is the step that turns the
ask-approved interpretation into **executable, currently-failing tests** — before a single line of
this chunk's implementation exists. `build` (Step 5) then writes the code that makes these tests
pass; `test` (Step 6) runs the full verification sequence on top of them.

The discipline in one line: **RED here, GREEN in `build`.** A test written after the code it tests
can only confirm what the code already does; a test written from the approved interpretation and
observed failing is the only kind that can prove the code does what the *rulebook* said. This step
exists so that guarantee is structural — enforced by a separate commit with no implementation in
it — rather than a habit each build session has to remember.

## Fresh-Context Dual Input (shared with `build`)

`spec` and `build` are the two steps exempt from the Context-Economics Hard Rule
(`build-chunk.md` "Context-Economics Hard Rule"): both read this chunk's cited raw rulebook slices
directly. `spec` reads the same two inputs `build/build.md` "Fresh-Context Exception" names, and
for the same reason — never one alone:

1. **The chunk's cited raw rulebook slices** — the actual `rulebook/NN-topic.md` text this chunk's
   citations point at, read fresh.
2. **The approved interpretation** — CHUNK.md's `## Interpretation` and `## Visibility
   Declaration`, settled and gated by `ask` (`Status: approved` on disk).

The interpretation tells you what the rulebook *means*; the raw slice is what it *says*. A test
written from the interpretation alone inherits any residual gap between the two — and unlike an
implementation bug, that gap survives into a permanently green test that pins the wrong behavior.

## One Test Per Numbered Claim (traceability)

Every numbered claim in CHUNK.md's `## Interpretation` gets at least one executable test, and every
test names the claim number it pins in its own title or a comment directly above it:

```typescript
// Claim 3: a player who cannot follow suit may play any card.
it('claim 3 — allows an off-suit play when the player holds no card of the led suit', () => {
  /* ... */
});
```

That naming is the traceability link the `audit` step and the sketch's final-acceptance coverage
check both read. A claim with no test is an uncovered claim — the chunk is not spec-complete, and
this step does not check off until every numbered claim is either covered or carries an explicitly
named exemption (see "Exemptions" below). Silently covering nine of ten claims is exactly the
failure this per-claim rule exists to make impossible.

Tests belong to the chunk's own test files in the GENERATED game project — never BoardSmith's repo,
and never appended to an earlier chunk's test file. Extending an earlier chunk's file is how a
regression suite becomes unattributable; a chunk's tests live where `close` can point at them.

## Signature-Only Stubs — the RED must be an assertion, not a missing symbol

A TypeScript test that references an export which does not exist yet fails to *compile*. That is
technically red, but it is a weak red: it proves the symbol is absent, not that the assertion is
meaningful. So `spec` may create **signature-only stubs** — and only signature-only stubs — for the
exports its tests reference:

```typescript
export function scoreHand(_hand: Card[]): number {
  throw new Error('not implemented — chunk scoring, spec step');
}
```

The rules on stubs are absolute, because a stub is the one thing this step writes that lives in
implementation files:

1. **A stub's body is exactly one `throw`.** Never a `return 0`, never a `return []`, never a
   `return null`. A stub that returns a value can accidentally satisfy an assertion and turn RED
   into a false GREEN — a `throw` structurally cannot.
2. **The `throw` message names the chunk and this step**, so a stub that survives into `build`'s
   output is immediately identifiable as unfinished work rather than an obscure runtime error.
3. **Stubs are the ONLY implementation-file writes `spec` makes.** No logic, no branches, no
   partial behavior "while I'm in here." Writing real behavior at `spec` time collapses RED and
   GREEN into one commit and destroys the evidence this step exists to produce.
4. Types, interfaces, and enum members the tests reference may be declared in full — a type
   declaration asserts no behavior and cannot make a test pass on its own.

## Run the Tests. Observe the Failure. Record It.

Writing failing tests is not the deliverable — **observing** them fail is. Run this chunk's new
tests with `boardsmith test <pattern>`, naming this chunk's test files. (Generated projects carry
no npm scripts on purpose: `boardsmith test` is the one way to run a game's tests, so `npm test`
will fail with "Missing script".)

Every new test must be observed failing before this step checks off. Record the observation — the
real runner output, not a claim about it — in CHUNK.md's `## Spec Manifest` (see below).

**A test that PASSES at spec time is a stop condition, not a bonus.** There are exactly two
explanations, and both need resolving before `build` starts:

- **The behavior already exists.** This chunk is wholly or partly redundant with an earlier chunk.
  Surface it to the user — a chunk that builds behavior the game already has is a design problem
  the sketch needs to absorb, not something `build` should quietly re-implement.
- **The test is vacuous.** It asserts nothing the implementation controls (`expect(true).toBe(true)`
  in disguise — asserting on a literal, on a mock's own return, on a type rather than a value).
  Rewrite it so it actually pins the claim.

Never "fix" an unexpectedly-passing test by deleting it or by loosening it until it fails. Diagnose
which of the two cases it is and act on that.

## What `spec` Never Does

- **Never writes implementation.** Signature-only stubs, nothing more (above).
- **Never re-litigates the interpretation.** `ask` gated it; if writing the tests exposes a genuine
  rules gap the rulebook and `RULINGS.md` do not settle, it is SURFACED — queued per
  `state-machine.md`'s batched-question model, see `build/ask.md` "Ask Triple-Gate
  (SKILLAUTO-02)" — never quietly decided here. Same "surface, don't unilaterally decide" boundary
  `build/build.md` "Extends, Never Restructures" enforces for code shape.
- **Never restructures verified code.** The user gate in `build/build.md` "Extends, Never
  Restructures" applies verbatim to this step: renaming an existing export or changing an existing
  signature to make a new test convenient is a restructuring change and needs explicit approval.
- **Never patches the platform.** `build/build.md` "## Boundaries" applies in full —
  `node_modules/boardsmith` is READ-ONLY, a library shortfall is FILED not patched, and built-in
  BoardSmith UI is never suppressed. A test that can only pass by editing the library is a library
  gap to file, not a test to work around.
- **Never generates the worked-example tests.** Those are `build/test.md` item 4's, run at the
  `test` step against the finished code. `spec` covers the `## Interpretation` claims; the
  worked-example pass covers the rulebook's own printed examples. Two different sources, two
  different steps — do not duplicate either here.

## Persistence — `## Spec Manifest` (crash/resume)

Fill CHUNK.md's existing `## Spec Manifest` table row-by-row as each test file is written and run —
never invent a new section, never restructure the `| Test File | Claims Covered | RED Observed |`
header. Add a row per test file this chunk introduces, and flip `RED Observed` from `pending` to
`yes` the moment that file's tests have actually been run and seen failing — not in a batch at the
end, and never ahead of the run.

A session that crashes mid-spec resumes by reading this table: a row with `RED Observed: pending`
is unfinished work, a row with `yes` is done and must not be rewritten. This is the file-by-file
resume signal for `spec`, exactly parallel to `## Build Manifest`'s role for `build` — finer-grained
than the step-level Step Checklist, because a single `spec` step can span many files.

The Step Checklist's `spec` item is checked off only when every row reads `yes` and every numbered
claim is covered or exempted. An unchecked step is re-run from scratch on a cold resume, so never
leave a completed `spec` unchecked (`build-chunk.md` "Every step persists before the next starts").

## Exemptions — named, never silent

A chunk that introduces no new game behavior — a pure asset swap, a restyle, a refactor with no
rules change — has no claims to pin and writes no behavioral tests. Name that exemption explicitly
as a row in `## Spec Manifest` with its reason, the same "name the exemption explicitly rather than
silently omitting" discipline `build/test.md` items 4(i) and 6 already use. A chunk trivial enough
to be genuinely exempt is usually a chunk that should have been tagged `light` at proposal time
(`state-machine.md` "Step Names (exact, light path — trivial chunks)").

## Git Protocol (cite, never restate)

Cite `state-machine.md` "Git Protocol" — commit at every step completion
(`chunk-<slug>/step-<name>`). This step's commit is `chunk-<slug>/step-spec`, and it is **the RED
anchor**: it contains this chunk's failing tests and signature-only stubs, and no implementation.
That commit is what makes the TDD claim auditable after the fact — `git show chunk-<slug>/step-spec`
either shows tests-without-implementation or it does not.

Three commits, three distinct states, never conflated: `step-ask` is the verified baseline
(interpretation approved, no code at all), `step-spec` is RED (tests exist and fail), `step-build`
is GREEN (tests pass). A session resuming mid-group tells these apart from git history alone, which
is what the per-file `## Spec Manifest` and `## Build Manifest` tables make explicit inside
CHUNK.md as well.

## Downstream Shape (cite, never restate)

Once every numbered claim is covered or exempted and every `## Spec Manifest` row reads
`RED Observed: yes`, the next step in this same session group is `build/build.md` — which makes
these exact tests pass and may not edit them to do it. This file does not restate that step's
structure.
