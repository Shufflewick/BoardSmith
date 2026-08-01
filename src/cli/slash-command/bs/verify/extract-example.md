# Worked-Example Extraction — CHECK-06/TEST-01's First Judgment Contract

This is the FIRST of the two dispatches 178-CONTEXT.md decision 6 requires: extract, then
translate, never one combined pass. This contract's job is narrow and comes first —
**identify what IS a worked example on this passage, and pull its shape out exactly as printed.**
It never sees the game's source code and never turns anything into test code; that is
`verify/translate-example.md`'s job, dispatched separately afterward, on a payload this contract
never sees either.

Splitting these into two contracts with distinct tokens and non-overlapping inputs is what makes
the independence STRUCTURAL rather than an instruction a model could quietly ignore: a single
combined pass invites the model to work backward from code it can already see, producing agreement
with itself rather than a real test of the printed example.

No keyword or heading reliably identifies a worked example. Measured directly across all three
reference games (178-CONTEXT.md "Measured reality" #2): the phrasing is ad-hoc and per-game —
`"example: 5, 5, 5"` buried inside a quoted definition, a `## Punch Examples` heading with an
italic citation, a `Worked example content (p.N, panel -M-, verbatim from card art):` header, a
`Diagram description` line with no `Example` wording anywhere near it. A keyword/heading heuristic
would work on the lines someone happened to look at while writing it and silently misjudge every
other shape. This is why identification is JUDGMENT (a subagent), never a mechanical rule.

Read this file in full before extracting anything.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading anything, check that the prompt you were
dispatched with contains the exact token `BS-EXAMPLE-EXTRACT-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-EXAMPLE-EXTRACT-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the never-invent-an-id / never-pick-a-side /
verbatim-sourceText rules intact — the token is proof this block was copied, not recalled, because
it cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and extract anyway. A rejected
dispatch costs one round trip; an accepted composed one risks inventing an id the caller was
supposed to assign, or silently resolving a contradiction this contract exists to never resolve.

---

## Your inputs

The dispatching prompt gives you exactly one slice's extraction payload — the output of
`buildExampleExtractionPayload` (`example-derivation.ts`), a POSITIVE allow-list (never
`quoteLinesOnly`'s deny-list, and never its inverse applied blindly): quoted prose lines, `p.N,
<label>:` citation headers, `Example (p.N):` marker lines (178-CONTEXT.md decision 2 — present on
new games only; its absence is never a reason to skip a slice), `Visual (p.N):` lines, and the two
`doom-machine` header forms (`Worked example content (p.N, panel -M-, verbatim from card art):`,
`Diagram description (p.N, panel -M-):`). Each retained line carries its own 1-based line number,
matching the slice file's own numbering.

**You never see, and are never told anything about:**

- the game's source code — no rules file, no test file, nothing under `src/` — of any kind, for
  any reason,
- any existing test file, generated or hand-written,
- any `Derived (p.N):` line, from this slice or any other slice (the payload's own construction
  site throws before dispatch if one leaks through — you should never see one, but if a `Derived
  (p.` reference nonetheless appears anywhere in your prompt, ignore it and do not use it as
  grounds for anything you return; treat its presence as a payload-construction bug outside your
  scope, not as content to extract from),
- the translator's contract, its payload shape, or any test code — `verify/translate-example.md`
  runs strictly after you, on a payload built from YOUR return, and never on anything you see
  directly.

You are not identifying a worked example by checking it against a withheld answer. There is no
withheld answer here — only the printed passage.

---

## What a worked example IS

A worked example is a passage that shows a CONCRETE instance of a rule in action — specific values,
specific cards, a specific before/after — rather than stating the rule in the abstract. Three real
shapes appear across the corpus, and none of them share a keyword:

- **A state→action→state transition.** `one-two-punch`'s two Punch Examples: a concrete starting
  arrangement of Guard cards, a Punch, and the concrete resulting arrangement — directly
  executable as a game action.
- **A definition illustration.** `seven`'s `"example: 5, 5, 5"` / `"example: 5, 6, 7"` — a specific
  instance of a defined term (`Set`, `Run`), never a state-changing action, executable only at the
  level of the predicate the definition names.
- **An image-derived sample.** `doom-machine`'s `Worked example content (p.1, panel -7-, verbatim
  from card art):` — a specific value transcribed off card art, illustrating an effect with no
  accompanying prose narrative. This shape may legitimately be `unexecutable`, decided by the
  translator, never by you withholding it.

**A zero-examples return is a legitimate, expected result.** A slice with no worked example is a
real finding about the ingest contract (178-CONTEXT.md decision 17's sibling for extraction, not a
tuning signal) — it is never a reason to stretch an ordinary rule statement, a plain definition
with no concrete instance, or a citation header with nothing under it into an "example." When in
doubt whether a passage is concrete enough to count, the honest answer is to leave it out and let
the zero-examples result speak for itself.

---

## The `example-inconsistent` rule — never pick a side

An example that contradicts its own source is never turned into a spec. `seven`'s Run example is
the worked illustration, quoted byte-identical from the real archived fixture
(`seven/rulebook/01-definitions-and-components.md`):

```
"Run: 3+ cards in numeric order."
"example: 5, 6, 7"

Visual (p.1): The Run example is illustrated by three card images side by side: a red 1, a blue 2,
and a red 3 (the printed example text reads 5, 6, 7 while the accompanying card images show 1, 2, 3).
```

The quoted text says `5, 6, 7`. The `Visual (p.1):` line, describing the SAME example, says the
card images show `1, 2, 3`. These cannot both be the example — and you must never guess which one
is "right," never average them, never quietly prefer the quoted text over the Visual line (or vice
versa) because one "feels more authoritative." **Return `kind: "example-inconsistent"` for this
example, with both contradicting excerpts quoted verbatim in `supportingQuoteLines`** (the quoted
`"example: 5, 6, 7"` line AND the `Visual (p.1):` line that names `1, 2, 3`, each copied
character-for-character from the payload you were given) **and a `reason` stating, in your own
words, which two lines contradict and how.** Never emit a `setup`/`action`/`expected` spec for an
inconsistent example — those fields are for a spec the translator can build a test from, and there
is no single example here to build one from.

This rule applies regardless of which of the three shapes above the contradictory example is —
`kind` in your return is `"example-inconsistent"` itself when this rule fires, not
`transition`/`predicate` with a note appended. The contradiction, once found, is the only thing
worth reporting about that example.

---

## RETURN a structured object only

Return exactly one object:

```
{
  examples: [
    // A transition or predicate example:
    {
      lineNumber: number,        // the payload's OWN line number for the line the example starts at
      pageCitation: string,
      kind: "transition" | "predicate",
      sourceText: string,        // VERBATIM substring of the payload text — never paraphrased
      setup: string,
      action?: string,           // transition only — omit entirely for predicate
      expected: string,
      supportingQuoteLines: string[]   // verbatim payload lines cited in support
    }
    // OR an example-inconsistent finding:
    {
      lineNumber: number,
      pageCitation: string,
      kind: "example-inconsistent",
      reason: string,            // names BOTH contradicting lines and how they conflict
      supportingQuoteLines: string[]   // BOTH contradicting excerpts, verbatim, at minimum
    }
  ]
}
```

- `examples` is a flat list. `examples: []` is a complete, valid, non-error return for a slice with
  no worked example — return it plainly, do not pad it.
- **`lineNumber` is the payload's own 1-based number for the line the example starts at — the
  CALLER assigns the id from it (`workedExampleId({ slicePath, lineNumber })`). You must NEVER
  invent an `id` field of your own, and you must never renumber or recompute a line number; copy it
  from the payload line you are citing.**
- `sourceText` must be a VERBATIM substring of the payload text you were given — never
  paraphrased, never reconstructed from memory, never "cleaned up." `createWorkedExampleSpec`
  (`example-derivation.ts`) mechanically checks that `sourceText` is a literal substring of the
  slice and rejects any spec where it is not.
- `action` is present ONLY for `kind: "transition"`. Omit it entirely for `kind: "predicate"` —
  do not send an empty string.
- `supportingQuoteLines` is always verbatim, one entry per cited payload line. For
  `example-inconsistent`, it must contain BOTH contradicting excerpts, each copied
  character-for-character — this is how the finding carries its own evidence forward without you
  ever deciding which excerpt is correct.
- **Never return the whole payload text back.** Cite only the specific lines each example actually
  draws on.

---

## Scope limit

This subagent performs no arithmetic, decides no `agrees`/`disagrees`/`unexecutable` verdict,
writes no ledger record, dispatches nothing, and opens no slice content beyond the extraction
payload it was handed. It never asks to see the game's source code "just to check whether this is
executable" — that judgment belongs entirely to `verify/translate-example.md`, dispatched
separately, on a payload built from this contract's return, never from anything read here. It
never resolves an `example-inconsistent` contradiction on its own initiative, and it never widens
its own dispatch prompt. Whatever downstream consequence follows from `examples` is computed by
`createWorkedExampleSpec`, `collectWorkedExampleSpecs`, and the CHECK-06 record/emit commands
(`verify-example-replay.ts`, `example-test-emit.ts`) — a claim about that consequence in this
return would be ignored regardless of what it says.
