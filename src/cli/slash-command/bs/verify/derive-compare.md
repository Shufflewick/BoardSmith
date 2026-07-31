# Derivation Comparison — CHECK-04's Second Judgment Contract

This is `verify/derive-recheck.md`'s companion — CHECK-04's second dispatch. By the time this file
runs, `verify/derive-recheck.md` has already produced a blind re-derivation for one `Derived
(p.N):` line, with no visibility into the original. This contract's job is narrower and comes
strictly after: given the original reading AND the already-produced blind re-derivation, judge
whether the two readings agree. This is a SEPARATE file with its own distinct handshake token
(`BS-DERIVE-COMPARE-V1`, distinct from the blind-derivation contract's own token) for exactly one
reason: a single shared token, or a shared context block, would risk one contract accidentally
serving both roles — deriving a value
and judging your own agreement with the original in the same pass invites post-hoc rationalization,
the model reconciling toward whatever it just saw. Two genuinely separate dispatches, with
non-overlapping inputs and distinct tokens, is what makes the second opinion an actual second
opinion rather than a rubber stamp.

This contract lives in its own file for the same reason
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-recheck.md` does: a paraphrase composed from memory
silently drops the part that matters most. Here that part is the never-collapse rule for
`underivable`/`not-rule-bearing` below. Read this file in full before comparing anything.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading either input, check that the prompt you
were dispatched with contains the exact token `BS-DERIVE-COMPARE-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-DERIVE-COMPARE-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the pass-through discipline for underivable and
not-rule-bearing intact — the token is proof this block was copied, not recalled, because it
cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and compare anyway.

---

## Your inputs

The dispatching prompt gives you exactly TWO things:

- **The original `Derived (p.N):` line**, verbatim, as recorded in the live slice.
- **The blind-derivation subagent's already-recorded `rederivedValue`** (plus its `sourceQuotes`,
  if any) — the structured return `verify/derive-recheck.md` already produced, in a separate,
  earlier dispatch that never saw this original line.

This contract compares two ALREADY-PRODUCED readings. **You re-derive nothing yourself, and you
never open the live slice to check either reading against a third source.** Your job is
adjudication between two existing answers, not a third attempt at the underlying question — if you
find yourself trying to work out the correct value independently, you have stepped outside this
contract's scope.

---

## The four verdicts

Return exactly one of:

- **`agrees`** — the original reading and the blind re-derivation state the same fact in
  substance. Wording may differ; the underlying fact does not.
- **`disagrees`** — the original reading and the blind re-derivation state incompatible facts.
- **`underivable`** — the blind-derivation subagent itself returned `underivable`. **This verdict
  is passed through unchanged, never re-adjudicated.** You do not attempt to judge whether the
  original reading was "right" in this case — there is nothing on the other side of the comparison
  to compare it against, because the blind subagent had nothing to derive from.
- **`not-rule-bearing`** — the blind-derivation subagent itself returned `not-rule-bearing`.
  **Passed through unchanged**, for the identical reason: there is no derived value to compare
  the original reading against.

**`underivable` and `not-rule-bearing` must never be collapsed into `agrees` or `disagrees` to
avoid an "incomplete"-looking answer.** Collapsing either into `agrees` reports false confirmation
— you would be claiming the two readings match when one of them was never produced at all.
Collapsing either into `disagrees` manufactures a false finding — you would be reporting a
disagreement where no comparison was ever possible. This is the same first-class-blindness
principle this milestone has now applied repeatedly (`still-needed`/`resolved-by-source`/
`contradicted`/`undetermined` in `verify/ruling-recheck.md`, `cosmetic`/`sharper`/`contradictory`
plus the omitted-label path in `verify/classification-subagent.md`) — cite that precedent rather
than re-arguing it here.

---

## RETURN a structured object only

Return exactly one object:

```
{
  verdict: 'agrees' | 'disagrees' | 'underivable' | 'not-rule-bearing',
  reasoning: string,
  originalReading: string,
  rederivedReading: string,
  factAlignment: 'same-fact' | 'different-fact'
}
```

- `verdict` is exactly one member of the four-value set above — never a sentence, never a hedge,
  never more than one label.
- `reasoning` is the only free-prose field — put your judgment there.
- **`originalReading` and `rederivedReading` are REQUIRED and must be byte-for-byte verbatim for a
  `disagrees` verdict** — copy the exact original-line text and the exact `rederivedValue` text,
  do not paraphrase either one. This mirrors `verify/classification-subagent.md`'s
  `quotedPass1`/`quotedPass2` requirement, and for the identical downstream-attribution reason: the
  recording CLI (`createDeriveVerdictRecord`, `verify-derive-recheck.ts`) rejects a `disagrees`
  record missing either field, because a designer adjudicating a disagreement needs to see exactly
  what each side said, not a summary of the difference.
- **`factAlignment` is REQUIRED for `agrees` and `disagrees`** (the recording CLI rejects either
  verdict without it). It answers exactly one question, separate from `verdict` itself: did the
  blind re-derivation actually address the SAME fact the original line asserts? `same-fact` when it
  did — the two readings are about the same underlying claim, whether or not they agree.
  `different-fact` when the blind stage's reading is about something else entirely — a targeting
  outcome about THIS CHECK's own dispatch mechanism, not a defect in the original transcription, so
  there is no reason to avoid returning it. Two worked examples, both drawn from measured real
  runs: `one-two-punch:52` (the original states a flat 8 Action Cards per player; the blind
  re-derivation tracked the discard-adjusted round-1 hand of 6 — both readings are about the SAME
  Action-Card-count fact, so `factAlignment: 'same-fact'` even though the verdict is `disagrees`)
  versus `seven:8` (the original describes the Set example's card-image illustration; a blind
  re-derivation that instead produced deck-composition arithmetic addressed a DIFFERENT fact
  entirely, so `factAlignment: 'different-fact'` regardless of whether that arithmetic is itself
  correct). Judge this from what each reading is actually ABOUT, not from a keyword or trigger-word
  list — the same absence-phrase-list discipline this contract already holds for the four verdicts.

---

## Scope limit

This subagent never re-derives anything itself, never decides `underivable`/`not-rule-bearing`
independently of what the blind-derivation dispatch already returned, never writes a ledger record,
and never opens the live slice to check either reading against a third source. Whatever downstream
consequence follows from the verdict you return is computed in code, from the verdict and the
readings you return — a claim about that consequence in this return would be ignored by the
recording step regardless of what it says.

**Context-Economics carve-out:** this prompt legitimately carries the original `Derived (p.` line,
and your return legitimately quotes it (and the re-derivation) back for a `disagrees` verdict. That
exception belongs to this subagent's dispatch prompt and structured return — never to the
orchestrator's own transcript, which still never opens a slice itself. This is the identical
exception `174-PROOF.md` §3 documented for `quotedPass1`/`quotedPass2`: the subagent's structured
return is the one legitimate place a quoted line lives; the orchestrator dispatching it and
recording the result never reads or re-emits slice content on its own.
