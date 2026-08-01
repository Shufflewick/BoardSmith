# 178-11 REJECTIONS — verbatim record of every malformed/rejected live dispatch return

**`verify-example-record` itself rejected nothing** — all 6 slice-level `verify-example-record`
invocations across the proof (one per slice with at least one extracted example, both runs' worth
of ledger writes) succeeded; every extraction/translation entry fed to it validated cleanly.

**The extraction dispatch itself produced 3 malformed (non-JSON) returns across the two runs**,
all on slices whose extraction payload carries zero content lines (only the
`BS-EXAMPLE-EXTRACT-V1` handshake token + a `Slice: <path>` header, no quoted/citation lines to
extract from). None were hand-repaired — per this plan's explicit instruction ("If a return is
malformed, record that as a result... there is no repair utility on the product side and none is
to be introduced here", 177.1-03's recorded decision reused), each was recorded verbatim and its
slice was treated as having zero extracted examples (the honest, un-inflated fallback — never a
fabricated `{examples: []}` presented as if the model had said so).

## RUN 1 — 1 malformed return

**`doom-machine/rulebook/02-cards-tracker-player-hp-b-side.md`** — the model echoed the payload's
own slice header back verbatim instead of returning the required JSON object:

```
Slice: rulebook/02-cards-tracker-player-hp-b-side.md
```

## RUN 2 — 2 malformed returns

**`doom-machine/rulebook/01-cards-trackers.md`** — the model returned the extraction contract's own
missing-token rejection message, even though the token (`BS-EXAMPLE-EXTRACT-V1`) WAS present as the
first line of the dispatched payload:

```
DISPATCH REJECTED — missing BS-EXAMPLE-EXTRACT-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the never-invent-an-id / never-pick-a-side /
verbatim-sourceText rules intact — the token is proof this block was copied, not recalled, because
it cannot be produced from memory.
```

**`doom-machine/rulebook/03-cards-parts-set-1.md`** — the model correctly identified that the
payload carried no extractable content, but returned free prose explaining why instead of the
required `{examples: []}` JSON object:

```
The dispatch payload only contains a slice filename reference (`Slice:
rulebook/03-cards-parts-set-1.md`) — it does not include the actual extraction payload content
that `buildExampleExtractionPayload` produces (the quoted lines, citation headers, line numbers,
etc.). The contract requires me to extract examples from "the payload's own text," citing
verbatim substrings and the payload's own line numbers. With no payload text present, I have
nothing to extract from and no line numbers to cite.

I cannot fabricate slice content or invent line numbers to produce a plausible-looking result —
that would violate the contract's core rule against inventing anything. This isn't the
missing-token case (the token `BS-EXAMPLE-EXTRACT-V1` is present), so the fixed rejection message
doesn't apply verbatim, but the underlying problem is the same class: the dispatch is incomplete
and cannot be trusted to extract from.

Please re-dispatch with the actual extraction payload (the output of
`buildExampleExtractionPayload` for `rulebook/03-cards-parts-set-1.md`) included in the prompt,
not just the slice path.
```

## Reliability finding (never fixed here — see `178-PROOF.md` §9)

Across the 4 slices whose extraction payload has zero content lines
(`01-cards-parts-set-1.md`, `01-cards-trackers.md`, `02-cards-tracker-player-hp-b-side.md`,
`03-cards-parts-set-1.md`), 8 total dispatches occurred (2 runs × 4 slices); **3 of 8 (37.5%)
returned a malformed, unparseable response instead of the contractually-required `{examples: []}`.**
`extract-example.md` never explicitly addresses the "payload has zero content lines beyond the
token and slice header" case — this is a real, reproducible extraction-contract gap, named here for
future hardening, not repaired in this plan (repairing the contract text is in-scope work for a
future plan touching `extract-example.md`, not a Task 2/3 auto-fix here).

Machine-readable copies of the raw malformed-return objects (including the JSON parse error
message) are at `178-PROOF/REJECTIONS-run1.json` and `178-PROOF/REJECTIONS-run2.json`.
