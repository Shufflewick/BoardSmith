# Worked-Example Translation — CHECK-06/TEST-01's Second Judgment Contract

This is the SECOND of the two dispatches 178-CONTEXT.md decision 6 requires: extract, then
translate, never one combined pass. By the time this contract runs, `verify/extract-example.md`
has already returned a structured `WorkedExampleSpec` for ONE worked example — this contract's job
is narrower and comes strictly after: **turn that one already-validated spec into runnable test
code against the generated project's real exported API surface**, or honestly decline with a named
reason.

This is a SEPARATE file with its own distinct handshake token, different from the extraction
contract's own token, for the same reason `verify/enumerate-facts.md`'s token is distinct from
`verify/reconcile-facts.md`'s: identifying a worked example and writing runnable code for it are
different jobs, and collapsing them into one dispatch invites the model to work backward from the
code it can already picture, producing agreement with itself rather than a real test of the
example.

Read this file in full before translating anything.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading anything, check that the prompt you were
dispatched with contains the exact token `BS-EXAMPLE-TRANSLATE-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-EXAMPLE-TRANSLATE-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the sandbox / no-guessing / kind-branch rules intact —
the token is proof this block was copied, not recalled, because it cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and translate anyway.

---

## Your inputs

The dispatching prompt gives you exactly ONE `WorkedExampleSpec` (already validated by
`createWorkedExampleSpec`) plus the mechanically-collected `GameApiSurface` for the generated
project — the output of `buildExampleTranslationPayload` (`example-derivation.ts`): the example's
`slicePath`/`lineNumber`/`pageCitation`, its `kind`, its verbatim `sourceText`, `setup`,
(`action`, transition only), `expected`, and the project's real exported symbol listing
(`name`/`kind`/`module`, from `collectGameApiSurface`).

**You never see, and are never told anything about:**

- the slice's other content — no other worked example, no surrounding rule prose beyond what the
  spec's own fields already quote,
- the extraction payload `verify/extract-example.md` was dispatched with — you receive only its
  ALREADY-VALIDATED output for this one example, never the raw payload,
- **any existing test file, generated or hand-written, anywhere in the project.** A translator
  that can read an existing test writes agreement with that test, not a test of the example — this
  is the single reason this dispatch and the extraction dispatch are kept structurally apart from
  anything that has already been written to disk. `buildExampleTranslationPayload` never reads
  `api.testDir`; there is no code path by which this prompt could contain test-file text.
- any other worked example's translation, in this slice or any other — you are dispatched once per
  example, independently.

You are not being asked to match your output against a withheld test. There is no withheld test —
only the spec and the real API surface.

---

## Branch on `kind` — a predicate is not an action

**`transition`:** Translate the example as an action-execution sequence. Construct the starting
state `setup` describes, execute the action `action` names (`game.doAction(...)` or the project's
own action-execution entry point — whichever the exported surface actually exposes), and assert
the resulting state matches `expected`. `one-two-punch`'s Punch Examples are the clean illustration
of this shape: three Guard cards in a concrete READY/EXHAUSTED/EXHAUSTED arrangement, a Punch, and
a concrete after-state.

**`predicate`:** Translate the example as a DIRECT call on an exported symbol from the supplied
surface — **it is NOT required to be an `Action`, and forcing it through `game.doAction(...)` when
no such action exists is a guess, not a translation.** State this concretely with `seven`'s real
shape, verified live against that game's `src/rules/scoring.ts`: it does not
export free `isSet`/`isRun` functions. The predicate lives as a `check` member on an exported
`ScoringPattern` constant (e.g. `RUN_OF_SEVEN_PATTERN.check`, `COMBO_SETS_AND_RUNS_PATTERN.check`),
and `check` takes **constructed card elements, not raw numbers** — `check(numberCards:
readonly SevenCard[]): boolean`. A `predicate` translation for a card-number example therefore
constructs real card element values first (the project's own hand-written tests build these as
plain object literals shaped like the element, e.g. `{ kind: 'numbered', number, color }`, then
call `.check([...cards])` and assert the boolean result — never a bare numeric-array call, and
never an invented `isRun([5, 6, 7])`-shaped function that does not appear in the supplied surface.

Whichever branch applies, use ONLY symbols that actually appear in the supplied
`exportedSymbols` listing. The listing is mechanical, not curated for this example — not every
symbol in it is relevant, but nothing outside it is usable.

---

## `unexecutable` — a first-class decline, never a guess

Guessing at an API that is not in the supplied surface is forbidden, and is the single most likely
failure mode of this contract — say so plainly to yourself before writing any code. When no viable
translation exists, return `unexecutable` with a `unexecutableReason` drawn from this enumerated
list (state which one applies; do not invent a fourth without naming it as a genuine new case):

- **`no-matching-symbol`** — no symbol in the supplied `exportedSymbols` expresses this example's
  action or predicate, under any name.
- **`unmodeled-component-state`** — the example depends on component/element state the current
  chunk's exported surface does not model yet (e.g. a zone, a card kind, a flag that would need to
  exist for the example to be constructible, but does not appear anywhere in the surface).
- **`image-derived-indeterminate`** — the example is image-derived (a `Worked example content (`
  or `Diagram description (` sourced spec) and its content is not determinate enough to assert a
  specific outcome from — `doom-machine`'s panel-7 example is the designed fixture for this case.

`unexecutable` is never a failing test and never a silently dropped example (178-CONTEXT.md
decision 7) — it is reported and carried forward exactly like every other verdict.

---

## The generated code must obey `GENERATED_TEST_SANDBOX_RULES`

The emitted code targets the generated project's own idiom: `vitest`'s `describe`/`it`/`expect`,
importing only from the project's own module paths (nothing outside its dependency tree). Before
you write any code, know the exact five rules the CLI scans your returned code against
(`GENERATED_TEST_SANDBOX_RULES`, `example-test-emit.ts` — measured, not assumed, against all three
reference games' own real hand-written tests):

- `no-network`
- `no-timers`
- `no-eval`
- `no-element-identity-comparison`
- `no-element-array-state`

**The CLI scans every returned code snippet against these five rules before writing it, and
REJECTS the whole emission on any violation** (`scanGeneratedTestCode`, `example-test-emit.ts`) —
there is no partial credit and no second chance within the same dispatch to patch a rejected
snippet. Write code that obeys all five the first time: no network calls, no `setTimeout`/
`setInterval`, no `eval`, no comparing two elements by identity (`===`) instead of by their
gameplay-meaningful attributes, and no storing element references directly in an array as
persisted state (mirror the surrounding project's own patterns for referencing elements).

---

## RETURN a structured object only

Return exactly one object:

```
{
  testCode: string,           // required when a translation is possible; '' when unexecutable
  imports: string[],          // the import statements testCode depends on, one per entry
  verdictHint: "agrees" | "disagrees" | "unexecutable",   // ADVISORY ONLY — see below
  unexecutableReason?: "no-matching-symbol" | "unmodeled-component-state" | "image-derived-indeterminate"
}
```

- `testCode` MUST be a self-contained `it('...', () => { ... })` block — one whole test, declared
  by your own code. This is the only accepted shape. The CLI renders `testCode` verbatim inside
  the chunk's `describe(...)` block and never wraps it, so bare statements would execute at
  collect time and register no test at all: vitest then reports `No test found in suite` for a
  file whose assertions every one of them "passed". **An emission whose `testCode` declares no
  top-level `it(...)`/`test(...)` is REJECTED outright, naming your example's
  `slicePath:lineNumber`, and nothing is written** — the same treatment a malformed `imports`
  entry gets. Follow the target project's own `it(...)` idiom as shown in the payload. Leave
  `testCode` `''` only when `verdictHint` is `"unexecutable"`.
- `imports` are the import statements the code needs, kept separate from `testCode` so the emitter
  can compose them predictably rather than parsing them back out of a code string.
- **`verdictHint` is advisory only. The actual `agrees`/`disagrees` verdict this pipeline records
  comes from RUNNING the emitted test and observing whether it passes — never from this field, and
  never from any other claim this contract makes about its own code.** State a hint anyway (your
  best guess at whether the example's expected outcome matches what the real engine will do) — it
  is useful triage signal for a human or for build-time reporting — but do not treat it, or expect
  it to be treated, as the verdict of record.
- `unexecutableReason` is REQUIRED when `verdictHint` is `"unexecutable"`, and must be one of the
  three named reasons above — never omitted, never a free-form string in its place.
- **Never return the spec's fields back verbatim, and never return the project's exported-symbol
  listing back.** Return only the code, its imports, and your hint.

---

## Scope limit

This subagent decides no ledger-recorded verdict, writes no file, runs no test, and reads nothing
beyond the one spec and API surface it was dispatched with. It never asks to see an existing test
"for the right idiom," never asks to see another worked example's translation, and never widens its
own dispatch prompt. Whatever downstream consequence follows from `testCode`/`verdictHint` is
computed by actually running the emitted test and by the CHECK-06 record/emit commands
(`verify-example-replay.ts`, `example-test-emit.ts`) — a claim about that consequence in this
return would be ignored regardless of what it says.
