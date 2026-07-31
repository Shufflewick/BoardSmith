# Track B Findings — Dual-Enumerator + Reconciler Design

Pre-registration (written before any dispatch, unedited since): `trackb/PRE-REGISTRATION.md`.
All work products: `trackb/{orig,work,prompts,out}`.

## Setup integrity

- Originals hashed before and after (`trackb/original-before.sha256` /
  `-after.sha256`): `diff` empty — byte-identical, nothing in the repo was touched.
- No git commits, no repo writes. All work under scratchpad.
- All dispatched enumerator prompts (`trackb/prompts/enum{A,B}-*.txt`) grepped for
  `^Derived|^Named-but-undefined|^> Variant`: **zero matches** — confirmed the stripping
  actually stripped, not just visually.
- No background processes left running (checked `ps aux` after all dispatches completed;
  a `claude -p` process visible mid-run belonged to a different, pre-existing Track A run I
  did not start and did not touch).

## Passage granularity

Per-slice (whole file), 5 files — the "rule slices" excluding `00-visual-survey.md` (itself
pure Derived/visual content, no quotes) and `INDEX.md`:
`seven/01-definitions-and-components.md`, `seven/01-overview-setup-and-play.md`,
`seven/02-solo-variant.md`, `one-two-punch/01-setup-and-round-structure.md`,
`one-two-punch/02-action-cards-and-resolution.md`. Reason: several existing `Derived` lines
synthesize across multiple citation headers within one file (e.g. seven's card-count line
combines the Definitions block with the Distribution-of-Cards block) — per-citation-header
passages would make that synthesis unreachable and manufacture artificial "misses."
**Note as instructed:** per-slice did turn out too coarse in one specific way — see "Structural
limitation" below; it didn't cause false matches, but it didn't rescue multi-hop arithmetic
inferences either.

## Framing variation (disclosed)

Identical stripped text to both. Enumerator A framed as a player building a rules-reference
sheet ("list every fact a player needs to play correctly"). Enumerator B framed as a
fact-extraction auditor ("extract every discrete checkable claim, independent of player
usefulness"). Same output schema. This was **not** tuned after seeing results — prompts are
those in `trackb/prompts/enum{A,B}-template.txt`, unedited post-hoc.

## Dispatch count

10 enumerator dispatches (5 passages × 2) + 5 reconciler dispatches = **15**, vs. the current
design's 28 for the same corpus. Caveat: this doesn't cost the manual cross-reference-against-
`Derived`-lines step, which I did by hand below and which a real implementation would need to
automate (arguably 1 more LLM step per passage — call it 20 total, still cheaper than 28).

---

## Reconciliation results per passage

| Passage | both | a_only | b_only |
|---|---|---|---|
| seven/01-definitions | 11 | 0 | 6 |
| seven/01-overview | 22 | 0 | 0 |
| seven/02-solo | 10 | 0 | 2 |
| otp/01-setup | 35 | 0 | 5 |
| otp/02-action-cards | 55 | 0 | 5 |

`a_only` was empty everywhere — B (the "auditor" framing) consistently enumerated a superset
of A (the "player reference" framing); the divergence showed up entirely as `b_only` items,
mostly peripheral facts A skipped as not player-relevant (designer/playtester credits, page
labels, card-name inventories, copyright text). This confirms the framing variation produced
real, meaningful divergence rather than noise — but it also means, empirically, A never caught
something B missed. With only 2 dispatches per passage that's not statistically strong; I'm
reporting it, not leaning on it.

## Cross-reference against existing `Derived` lines (the 10 wrong-target failures + 8 image lines)

Legend: **COR** = corroborated (a `both` fact matches in substance), **UNC** = uncorroborated
(no `both` fact matches), **UNC+contra** = uncorroborated and the reconciled facts actually
contradict the Derived line.

| Line | Content (abridged) | Image-only? | Result |
|---|---|---|---|
| seven L8 | Set example shown as green5/red5/purple5 card images | yes | UNC — correct self-sort |
| seven L14 | Run example images (1,2,3) contradict printed text (5,6,7) | yes | UNC — correct self-sort. Both enumerators independently corroborate the *printed* "5,6,7," not the image's "1,2,3" — the design doesn't accidentally launder the image claim through text agreement. |
| seven L19 | Distribution diagram: 4 rows × "x4," black "+1" card × "x7" | yes | UNC for the diagram-specific claim, but **borderline** — the underlying numbers (1–7, 4 colors, 4 copies, 7 bonus cards) *are* in `both`, because they're also stated directly in prose. A naive automated matcher keying on shared numbers could misclassify this as corroborated. I did not; flagging as a real ambiguity in the design, not a clean pass. |
| seven L21 | 112 numbered + 7 bonus = full deck (7×4×4 arithmetic) | no | UNC (structural) — the multiplication is `b_only`, not `both`; A never computed it even though the deck-count and color-count and copies-count are each independently corroborated as `both`. |
| seven L36 | draw2/discard1 nets +1/round → 7 rounds from 3→10 cards | no | UNC (structural) — same pattern: every sub-fact is `both`, the multi-hop conclusion is in neither list. |
| seven L38 | Rounds are simultaneous, not turn order | no | **COR** — clean match, both state it directly, citing the "Round (Simultaneous)" header. |
| seven L11 | "final challenge sentence ends ...in no particular order" | no | **UNC+contra** — see below, this is the standout finding. |
| seven L17 | Page 2 layout/typography description | yes | UNC — correct self-sort |
| otp L52 | 8 Action Cards/player (16÷2), 3 Guard Cards | no | UNC (structural) — "16 total" and "3 Guard Cards" are each `both`; the division is in neither list. |
| otp L49 | Small icon per Action Card type | yes | UNC — correct self-sort |
| otp L89 | Publisher logo image + age-icon | yes | UNC — correct self-sort (the *copyright text* nearby is corroborated as a separate, correct `both` fact; the logo/icon claim itself gets nothing) |

**Answering the four target questions directly:**

1. **Usable signal on the 10 wrong-target lines?** Yes, clearly better than noise. Zero false
   "disagreements" (the failure mode that broke the old design). Outcomes: 1 clean
   corroboration (L38), 1 borderline/ambiguous (L19), 3 structural misses that are arithmetic
   syntheses rather than wrong facts (L21, L36, otp L52), 5 correct image self-sorts. Every
   outcome is *defensible* — nothing lands as a confidently-wrong verdict. That is a real
   improvement in kind, not just in raw hit rate.

2. **Do image lines self-sort for free?** Mostly yes — 5 of 6 seven image lines and both otp
   image lines land cleanly uncorroborated with no special handling. But L19 shows the self-sort
   is not airtight: when a diagram redescribes numbers that are *also* stated in prose, the
   underlying numeric facts do get corroborated, and a careless downstream matcher could
   conflate that with corroborating the diagram claim itself. I'm calling this "mostly true,
   one real edge case," not a clean win.

3. **Agreement quality spot-check.** I manually verified ~20 `both` facts across all 5 passages
   against the actual quoted text (numeric claims, multi-clause claims, and worked examples
   preferentially, since those are where compounding errors would show). All ~20 checked out as
   textually supported; I found zero incorrect corroborations. **Important caveat, stated
   plainly per the honesty discipline:** this is a weaker result than it sounds. On this
   corpus, `both`-bucket facts are overwhelmingly near-verbatim restatements of single
   sentences — the enumerators rarely attempt risky multi-sentence synthesis, and when they
   do (deck math, round math), the synthesis fails to double-corroborate rather than
   double-corroborating incorrectly. So the shared-blind-spot risk named in the task (two runs
   of the same model confidently wrong together) was not meaningfully exercised by this small,
   plainly-worded corpus — I did not find a case of it, but I also could not have found one
   here, because the design's failure mode requires exactly the multi-hop synthesis that these
   enumerators mostly avoided. Do not read "0/20 errors" as "the agreement signal is strong";
   read it as "the agreement signal wasn't stress-tested by this corpus."

4. **Real MISSED facts found?** Yes, two, both in `one-two-punch/02-action-cards-and-resolution.md`,
   both in `both` (i.e., independently corroborated), both absent from every existing `Derived`
   line in that file:
   - *"Guard cards have two states: ready and exhausted."* — synthesized from the JAB text
     ("Flip one of your opponent's Guard cards from ready to exhausted... If all their Guard
     cards are already exhausted...") and the PUNCH text ("Break one of your opponent's
     exhausted Guard cards..."). Never stated as one sentence; genuinely useful for
     implementation (defines the enum).
   - *"A boxer occupies one of two positions: their own corner or the center ring."* —
     synthesized from RETREAT ("If you are in the center ring: Move your boxer to your
     corner.") and ADVANCE ("Move your boxer to the center ring."). Same character: a real,
     correct state-machine fact the transcriber never wrote down as an inference, found by
     both enumerators independently, invisible to the current design because the current
     design only ever re-derives a target the transcriber already picked.

## The standout finding: seven L11

`Derived (p.2): "The final challenge sentence ends 'in each game during the match in no
particular order.'"` The stripped text has three challenge sentences: (1) higher total score,
(2) *"attempt to get a multiple of 7 as your final score... Therefore for a perfect solo match
you would have to achieve a score of 1 of each **in no particular order**"*, (3) *"attempt to
get one of each of the 7 scoring hands in each game during the match"* — sentence (3), the
actual final one, does not contain "in no particular order" in the quoted text; that phrase is
attached to sentence (2). Both enumerators independently reconstructed sentence (2) with "in no
particular order" attached correctly, and reconstructed sentence (3) with no such phrase. The
reconciled output therefore doesn't just fail to corroborate L11 — it actively contradicts it.
This looks like a genuine transcription error in the original `Derived` line (misattributing
which sentence the phrase belongs to), caught by a design that was never told what to look for.
This is a better outcome than "sensible non-answer" — it's the kind of result the project owner
said the current design structurally cannot produce.

## Structural limitation this design has (not shared with the old one, but real)

Three of the ten wrong-target lines (L21, L36, otp L52) are multi-hop arithmetic syntheses
across 2–3 separate quoted sentences. In every case, every individual sub-fact the arithmetic
depends on is independently corroborated in `both`, but neither enumerator performs the final
multiplication/division/addition unprompted, so the compound conclusion itself never appears in
either list and gets bucketed as "uncorroborated" — indistinguishable, at the bucket level, from
an actually-wrong inference. This is a real weakness: the design correctly avoids
false-confident wrong answers, but it will systematically under-corroborate a whole class of
legitimate, likely-correct derived facts (anything requiring arithmetic synthesis across quotes)
unless the reconciler or a downstream step is explicitly told to attempt cross-fact arithmetic
matching, not just literal-meaning matching.

---

## Verdict

**This design beats the current one, on the evidence gathered, but not unconditionally.**

Evidence for: on the exact 10 lines that broke the current design, this design produced zero
false disagreements (the specific failure mode named in the task) — every result was either a
correct corroboration, a defensible non-answer, or (in one case) a genuine defect catch. The 8
image-description lines self-sorted correctly in 7/8 cases with no targeting mechanism at all,
confirming the "free filter" hypothesis largely, not fully. It also surfaced two real,
previously-unflagged inference gaps (the MISSED case) that the old design's per-line targeting
could never have found, because that design only ever checks a target the transcriber already
chose.

Evidence against/caveats: (a) it systematically under-corroborates multi-hop arithmetic
inferences — 3 of 10 target lines landed "uncorroborated" for a reason unrelated to
correctness, which is a different kind of noise than the old design's false disagreements but
still noise a human would have to learn to discount; (b) the agreement-quality spot-check came
back clean but on a corpus that didn't exercise the design's stated main risk (shared blind
spots on hard multi-hop inference) — I can't honestly claim the agreement signal is validated
against that risk, only that it wasn't refuted by 20 easy samples; (c) it costs fewer raw
dispatches (15 vs 28) but shifts real work onto a manual (here, human) cross-reference step
against existing `Derived` lines that isn't priced into that number.

**Confidence:** Low-to-moderate. This is a 5-passage, 2-game corpus with 15 dispatches total —
enough to see the qualitative shape of the failure modes clearly (no more false disagreements,
a real arithmetic-synthesis blind spot, a real defect catch), not enough to put a number on hit
rate or to claim the shared-blind-spot risk is resolved. I would not ship this design without
first testing it against at least one passage dense with multi-hop arithmetic and one passage
genuinely ambiguous enough to plausibly fool two independent runs the same way.
