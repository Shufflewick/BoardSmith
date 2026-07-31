# Fact Reconciliation — CHECK-04's Replacement Second Judgment Contract

This is `verify/enumerate-facts.md`'s companion — CHECK-04's second dispatch under the
dual-enumeration design. By the time this file runs, TWO independent dispatches of
`verify/enumerate-facts.md` (on genuinely different model families, never two framings of one
model) have already each produced a `facts` list for the same passage, neither having seen the
other's output or any `Derived`/`Visual`/`Named-but-undefined` line. This contract's job is
narrower and comes strictly after: given both completed lists (and, separately, the slice's actual
`Derived` lines), match them and report.

This is a SEPARATE file with its own distinct handshake token, different from the enumeration
contract's own token, for the same reason `verify/derive-compare.md`'s token is distinct from
`verify/derive-recheck.md`'s: enumerating a fact and judging whether two enumerations agree are
different jobs, and collapsing them into one dispatch risks one contract accidentally serving both
roles.

**Read this file in full before reconciling anything. Two rules below are the entire reason for
this contract's existence, measured twice as real fabrication failures in the experiments that
produced this design (`177-EXPERIMENTS/README.md` Finding 3 / `TRACK-B-FINDINGS.md`). A paraphrase
composed from memory is exactly the failure mode that silently drops them.**

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading anything, check that the prompt you were
dispatched with contains the exact token `BS-RECONCILE-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-RECONCILE-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the matching-only / verbatim-quote-per-side / no-
arithmetic rules intact — the token is proof this block was copied, not recalled, because it
cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and reconcile anyway.

---

## Your inputs

The dispatching prompt gives you exactly three things:

- **Enumerator A's `facts` list** — the completed, structured return from one
  `verify/enumerate-facts.md` dispatch.
- **Enumerator B's `facts` list** — the completed, structured return from an independent
  `verify/enumerate-facts.md` dispatch, on a genuinely different model family, of the SAME passage.
- **This slice's `Derived (p.N):` lines**, verbatim, one per line, each with its page/line
  reference — these are given to YOU (never to either enumerator) so you can propose which lines
  each reconciled fact bears on.

You never see the raw passage text yourself, and you never re-derive anything — your job is
matching two already-produced lists against each other and against the `Derived` lines, not a
third attempt at reading the source.

---

## Rule 1 — MATCHING ONLY. Never compute a value. Never introduce a value neither list stated.

You are a matcher, not a calculator and not a third enumerator. Bucket each fact from each list
into exactly one of: **found by both** (A and B independently state the same underlying claim, in
substance, regardless of wording), **found by A only**, or **found by B only**.

**You may never state a numeric value, a composed quantity, or any claim that is not literally
present, verbatim or in close paraphrase, in at least one of the two source lists.** This rule
exists because it was violated twice, measured, by exactly this design during development:

- A reconciler credited **"5 cards each"** to BOTH enumerators' lists when only one of them had
  actually stated it — inventing the second list's agreement rather than checking it.
- When a prior version of this contract instructed the reconciler to "attempt cross-fact
  arithmetic," it instead **invented operand grounding on an unrelated pairing** — composing two
  quantities that happened to both be numbers, not two quantities the passage actually related to
  each other.

Both failures share one shape: treating "plausible" as a substitute for "stated." If a value did
not come from A's list or B's list, it does not go in your output, full stop — not even a value you
are confident is correct, not even a value that would make a "found by both" bucket look cleaner.
**Arithmetic composition is CODE's job** (`composeArithmeticClaim`, `verify-enumerate.ts`) — your
job stops at handing code the ingredient facts it needs and flagging which `Derived` line states a
composed claim worth checking (see "Flag arithmetic claims for code" below). You never evaluate the
arithmetic yourself, and you never report a computed result as if it were something either
enumerator said.

## Rule 2 — Every "found by both" claim MUST carry a verbatim quote attributed to EACH list

For every fact you place in the "found by both" bucket, you must supply `quotedFromA` and
`quotedFromB` — the exact text (statement or source sentence) from A's list and from B's list that
you are treating as matching. **This is not a formatting requirement you can satisfy loosely.**
`validateGrounding` (`verify-enumerate.ts`) mechanically checks that `quotedFromA` genuinely
appears in list A and `quotedFromB` genuinely appears in list B — a string check, not a judgment
call. **State this plainly to yourself before you finish: the check exists, and it runs on every
claim you make.** A claim whose quote does not actually match either list is REJECTED and
REPORTED by that code — not silently dropped, not passed through — so there is no advantage to
guessing or rounding a quote to make a "both" bucket look larger. Fabricating a "both" claim will
be caught and surfaced as a fabrication finding, which is a worse outcome for the credibility of
your reconciliation than an honest "found by A only" would have been.

Concretely: copy `sourceSentence` or `statement` text from the list you were actually given,
character-for-character or as a genuine substring, into `quotedFromA`/`quotedFromB`. Do not
paraphrase, summarize, or "clean up" the wording — an approximate quote that only roughly resembles
what the enumerator said is exactly the shape of claim the grounding check exists to reject.

---

## Proposing coverage of `Derived` lines

For each `Derived (p.N):` line you were given, propose which reconciled "found by both" fact(s), if
any, cover its claim, and one of:

- **`corroborated`** — cite the grounded fact id(s)/statements that, together, state the same claim
  the `Derived` line asserts.
- **`corroborated-by-composition`** — the `Derived` line states an arithmetic relationship (a sum,
  product, difference, or quotient of two or more numbers), and every operand of that relationship
  is independently a "found by both" fact. **Flag this line for CODE to verify the arithmetic —
  never compute or confirm the arithmetic yourself.** Name which "found by both" facts you believe
  are the operands; `composeArithmeticClaim` performs and checks the actual composition.

  Some `Derived` lines state a genuine COMPOUND relationship — more than one arithmetic step,
  where a later step's operand is an earlier step's own result (e.g. `seven` L36: "draw 2 /
  discard 1 nets +1 card per round; starting at 3 and ending at 10 means 7 rounds" is really three
  steps — a net-per-round subtraction, a span subtraction, then a division of the two). You do not
  need to decompose the steps yourself or decide their order — that is `composeArithmeticChain`'s
  job (`verify-enumerate.ts`), bounded at a small, explicitly-stated depth. Naming ALL the "found
  by both" facts you believe are ingredients anywhere in the compound relationship, via
  `arithmeticNote`, is enough; still propose `corroborated-by-composition` and still never compute
  or confirm any part of the arithmetic yourself.

  **Also supply `arithmeticSpec`** — a machine-readable pointer, ADDITIVE to (never a replacement
  for) `arithmeticNote` above. `arithmeticNote` is free prose for a human reader; `arithmeticSpec`
  is the same pointer in a shape code can actually consume, because free prose cannot drive
  `composeArithmeticClaim`/`composeArithmeticChain`. Populate it for every `corroborated-by-
  composition` proposal:

  - `arithmeticSpec.kind` — `'single'` for one arithmetic operation, `'chain'` for a genuine
    compound relationship (more than one step, a later step consuming an earlier step's result).
  - **`'single'` only:** `arithmeticSpec.operation` — one of `'add' | 'subtract' | 'multiply' |
    'divide'` — and `arithmeticSpec.operandStatements` — an array of the verbatim `statement` text
    of the "found by both" entries you are naming as operands, IN OPERAND ORDER (the same facts
    `citedBothStatements` already names; this just gives code an ordered, structured pointer to
    them instead of asking it to guess the order from prose).
  - **`'chain'` only:** `arithmeticSpec.steps` — an ordered list of
    `{ operation, operandRefs: [{kind:'fact', statement} | {kind:'stepResult', index}] }`, one
    entry per step, at most `MAX_ARITHMETIC_CHAIN_DEPTH` (3, `verify-enumerate.ts`) steps. Each
    `operandRefs` entry is either `{kind:'fact', statement}` (a "found by both" statement, verbatim)
    or `{kind:'stepResult', index}` (an EARLIER step's own computed result, referenced by that
    step's 0-based position in `steps`).
  - `arithmeticSpec.claimedResult` — `{ magnitude, unit, approximate }`, READ OFF the `Derived`
    line's OWN literal text (the number it already states), never computed by you.

  **This does not loosen Rule 1.** You are still naming WHICH facts and WHICH operation the
  `Derived` line itself asserts — never performing or confirming the arithmetic. CODE performs the
  computation from the operands you named and REJECTS the composition outright if the computed
  result does not equal your `claimedResult` — a wrong `claimedResult` is caught, never trusted,
  exactly like a fabricated quote is caught by `validateGrounding`. The magnitude you write into
  `claimedResult` is never computed by you; it is copied from the `Derived` line's own text.
- **`uncorroborated`** — no "found by both" fact covers this claim, and nothing found by both
  contradicts it either. This is the honest default when the passage plausibly supports the line
  but neither enumerator happened to state it as its own fact (this is common and expected for
  multi-hop arithmetic and for pure image/layout observations — it is not automatically a defect).
- **`contradicted`** — one or more "found by both" facts state something that cannot both be true
  alongside the `Derived` line's claim (not merely "different wording" — an actual conflict of
  substance, e.g., a different number, a reversed order, an opposite outcome).
- **`absence`** — the `Derived` line asserts that something is NOT present ("No edition or printing
  number is stated anywhere on this page", "This section marks no rules as variants..."). Dual
  enumeration structurally cannot corroborate this the normal way: neither enumerator will ever
  list a fact that is not there. Propose `absence` and, ONLY when the claim maps cleanly onto one
  or a small number of specific literal words or short phrases that would definitely appear in the
  passage if the claimed-absent thing were actually present, name them verbatim in
  `absenceTargets` (e.g. `["edition", "printing"]` for the edition/printing-number example above —
  code will mechanically check whether either literal term appears anywhere in this passage's own
  quote lines).

  **Leave `absenceTargets` empty when no safe literal target exists.** A claim spanning several
  loosely related concepts — "no rules marked as variants, optional modules, or advanced/expert
  rules" — has no single word or short phrase that reliably stands in for all three; guessing one
  (e.g. searching for "variant") risks a false negative (a variant rule described in different
  words) or an unrelated match, producing false confidence rather than a real check. When you are
  not confident a literal target is safe, leave `absenceTargets` empty — code reports the claim
  honestly as `absence-unverifiable` rather than trusting a shaky keyword guess. Naming a target
  you are not genuinely confident in is worse than naming none.

**You decide the semantic label** (`corroborated`/`uncorroborated`/`contradicted`/
`corroborated-by-composition`/`absence`); the citation you attach to it is what code re-checks. Do
not treat your own label as self-certifying — cite specific fact ids/statements for every proposal,
because `classifyDerivedLines` (`verify-enumerate.ts`) validates every citation against the
grounding-validated evidence and downgrades any citation to a nonexistent or ungrounded fact,
regardless of what label you proposed.

**You are not the final word on `uncorroborated`/`contradicted`.** Code additionally gates any
`uncorroborated`/`contradicted` proposal on whether this project's rulebook quotes have themselves
been verified against the archived source (`QuoteVerifiedProvenance`) — without that, your proposal
is downgraded to `quote-unverified` regardless of how confident you are, because a `Derived` line
judged against an unverified quote cannot be told apart from a `Derived` line that was correct all
along but sat above a broken quote (`177-EXPERIMENTS/README.md` CORRECTION, `seven:11`: a
`Derived` line was reported "contradicted" when the actual defect was a truncated quote line above
it, not the inference itself). You do not need to check quote-verification status yourself — code
enforces it unconditionally — but you should not treat your own `contradicted` label as a finished
verdict; it is a proposal code may downgrade.

---

## RETURN a structured object only

Return exactly one object:

```
{
  both: [
    { statement: string, quotedFromA: string, quotedFromB: string }
  ],
  aOnly: [ { statement: string, sourceSentence: string } ],
  bOnly: [ { statement: string, sourceSentence: string } ],
  derivedLineProposals: [
    {
      lineNumber: number,
      derivedLineText: string,
      proposedClassification: 'corroborated' | 'corroborated-by-composition' | 'uncorroborated' | 'contradicted' | 'absence',
      citedBothStatements: string[],
      arithmeticNote?: string,
      arithmeticSpec?: {
        kind: 'single' | 'chain',
        operation?: 'add' | 'subtract' | 'multiply' | 'divide',        // 'single' only
        operandStatements?: string[],                                   // 'single' only
        steps?: Array<{                                                 // 'chain' only
          operation: 'add' | 'subtract' | 'multiply' | 'divide',
          operandRefs: Array<
            { kind: 'fact', statement: string } | { kind: 'stepResult', index: number }
          >
        }>,
        claimedResult: { magnitude: number, unit: string, approximate: boolean }
      },
      absenceTargets?: string[]
    }
  ]
}
```

- `both` entries populate `validateGrounding`'s input shape directly — `quotedFromA`/`quotedFromB`
  are REQUIRED on every entry, never optional, per Rule 2 above.
- `aOnly`/`bOnly` entries are informational (they answer "what did the design find that the
  existing transcription never wrote down as a `Derived` line" — the design's measured advantage,
  the `missed`-fact signal) — quote the enumerator's own `sourceSentence`, do not paraphrase.
- `derivedLineProposals.citedBothStatements` names which `both`-bucket entries (by their
  `statement` text) support the proposal — leave it empty only for `uncorroborated`/`absence` when
  nothing applies.
- `arithmeticNote` is free prose naming which operands you believe compose the claim, for
  `corroborated-by-composition` only (including the compound/multi-step case — see above) — it is
  a POINTER for code to check, never a computed result you are asserting yourself. Leave it unset
  for every other classification.
- `arithmeticSpec` is the SAME pointer as `arithmeticNote`, in the machine-readable shape above —
  populate it for every `corroborated-by-composition` proposal, alongside `arithmeticNote`, never
  instead of it. `claimedResult.magnitude` is read off the `Derived` line's own text, never
  computed by you. Leave it unset for every other classification.
- `absenceTargets` is for `'absence'` only — literal, verbatim search term(s), never a paraphrase,
  never invented by you beyond what the passage's own claim already names. Leave it unset (or an
  empty array) when no safe literal target exists, per the guidance above — never populate it with
  a low-confidence guess.
- **Never return either enumerator's full list back.** Cite only the specific statements each
  bucket/proposal actually turns on.

---

## Scope limit

This subagent never computes a numeric value, never introduces a claim absent from both input
lists, never re-reads the original passage, never decides whether this project's quotes are
verified against source (that gate is enforced in code, unconditionally, regardless of what this
subagent asserts), and never writes a ledger record. Whatever downstream consequence follows from
`both`/`derivedLineProposals` is computed by `validateGrounding`, `composeArithmeticClaim`, and
`classifyDerivedLines` (`verify-enumerate.ts`) — a claim about that consequence in this return would
be ignored regardless of what it says.

**Context-Economics carve-out:** the two enumerator lists in THIS prompt are dispatch payloads the
orchestrator assembled for you specifically, not the orchestrator's own transcript — the
orchestrator itself still never opens the original slice to read it. Receiving both completed
enumerations as a subagent's dispatch input is not the same thing as the orchestrating session
reading a slice into its own context, exactly as `state-machine.md`'s Context Economics guidance
already distinguishes for every other judgment-subagent dispatch in this repo.
