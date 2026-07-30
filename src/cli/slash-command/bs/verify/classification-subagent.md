# Classification Subagent Contract

**You are a dispatched classification subagent, or the orchestrator itself reading this file
directly.** Either way this file is your complete instruction set, and it binds you the same.
Follow it exactly.

This contract lives in its own file for the same reason
`${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` does: a paraphrase composed
from memory silently drops the part that matters most. Here that part is the dual-schema
exclusion rule below — omit it and every pre-Phase-170 diagram note on the live side gets read as
a rule change. Do not accept a paraphrase of this file in place of the file.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading either slice, check that the prompt you
were dispatched with contains the exact token `BS-CLASSIFY-V1`.**

If it does not, STOP immediately. **Read no slice.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-CLASSIFY-V1 token.

You composed this dispatch prompt instead of copying the pointer block from
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md`. Re-read that file's
"Dispatch" section and send the pointer block verbatim, including the token.

A composed prompt cannot be trusted to carry the dual-schema exclusion rule or the
consequence-vs-wording decision test intact — the token is proof this block was copied, not
recalled, because it cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and classify anyway. A rejected
dispatch costs one round trip; an accepted composed one silently mis-classifies a pair.

---

## Your inputs

The dispatching prompt gives you exactly three things:

- **Pair id** — the identifier this pair is recorded under.
- **Live slices** — one or more paths, the pass-1 transcription.
- **Staged slices** — one or more paths, the pass-2 re-transcription.

**A pair can be many-to-many.** A live slice's pages may be covered by several staged files and
vice versa, because the two passes chose section boundaries independently — do not expect a 1:1
correspondence, and do not treat an uneven count as an error. Read exactly the files you were
given and nothing else — no other slice, no `INDEX.md`, no adjacent file in the same directory.

---

## What is rule-bearing, and what is excluded

Not every line in a slice carries a rule. Before comparing anything, exclude presentation notes —
on **either schema**:

- `Visual (p.N):` — the post-Phase-170 form.
- `Derived (p.N) — diagram description:` — a pre-Phase-170 form.
- `Derived (p.N) — art:` — the other pre-Phase-170 form.

**Why both schemas are listed, not just the current one:** the two sides of a real pair are
usually written under different contracts. The live side predates the Phase 170 `Derived`/`Visual`
split entirely and writes every diagram or art observation as a qualified `Derived (p.N) —
diagram description:` / `— art:` line, never as `Visual (p.N):`. The staged side, re-transcribed
under the current contract, writes the same kind of observation as `Visual (p.N):`. A filter that
only recognized `Visual (p.N):` would read the live side's diagram notes as rule-bearing content,
compare them against the staged side's `Visual` line (which this filter would correctly exclude),
and manufacture a `sharper` or `contradictory` verdict out of pure schema drift — a difference in
which contract each pass was transcribed under, not a difference in what the rulebook says.

**Worked example, quoted byte-identical from the real archived fixture**
(`174-FIXTURES/one-two-punch/live/01-setup-and-round-structure.md`):

```
Derived (p.1) — diagram description: A layout diagram of the ring showing three dashed-outline areas in a row, labeled left-to-right with downward arrows: "blue corner", "center ring", "red corner". The blue Boxer card sits in the blue corner box; the red Boxer card sits in the center ring box; the red corner box is empty. Around the diagram, face-up card illustrations are scattered representing discards/hand cards — a blue "RETREAT" card at upper right area, blue numbered action cards (showing large numerals) at left and lower-left, and a red "RETREAT" card at lower right. The diagram visually restates setup steps 3 and 5 (blue boxer in blue corner, red boxer in center ring, discarded Retreat/Punch cards).
```

This line is excluded from the rule delta **identically to a `Visual (p.1):` line** — it describes
a diagram, not a rule, and the fact that it happens to sit under a `Derived` prefix (because it was
transcribed before the `Visual` prefix existed) does not make it rule-bearing. If the staged side's
corresponding pass-2 slice describes the same diagram under `Visual (p.1):` with entirely different
wording, that is not a delta at all — both lines are excluded, and there is nothing left to compare
at that point.

**An unqualified `Derived (p.N):` line — no ` — diagram description` or ` — art` qualifier — stays
rule-bearing and IS compared.** Only the qualified forms above, and `Visual (p.N):`, are excluded.

---

## The decision procedure — one test, not a category list

Once presentation notes are excluded on both sides, compare the remaining rule-bearing lines. For
each rule-bearing delta between the live and staged reading, ask exactly one question:

> Would the two readings produce **identical outcomes in every game situation**?

- **Yes** → `cosmetic`.
- **No, and the two are compatible** (pass 2 constrains something pass 1 left vague or absent, but
  nothing pass 1 said is contradicted) → `sharper`.
- **No, and the two cannot both be true** → `contradictory`.

**This is equivalence of CONSEQUENCE, not similarity of WORDING.** Two independently-written
sentences saying the same thing in entirely different words are `cosmetic` no matter how different
they look on the page — that is exactly what two good-faith independent transcriptions of the same
source should produce most of the time. Conversely, two sentences that look almost identical but
change a number, a threshold, or a precedence order are `contradictory` or `sharper` regardless of
how small the textual edit was.

Two worked examples per label:

- **`cosmetic`** — pass 1: `p.3, Setup: Each player draws five cards.` / pass 2: `p.3, Setup: Deal
  five cards to each player at the start of the game.` Different wording, identical outcome in
  every game situation: 5 cards, every player, at setup.
- **`cosmetic`** — pass 1 lists three setup steps in the order "shuffle, deal, reveal"; pass 2 lists
  the same three steps as "shuffle, reveal, deal" but the steps have no dependency on order (revealing
  before or after dealing changes nothing else in the state). Reordering with no consequence is
  `cosmetic`.
- **`sharper`** — pass 1: `Derived (p.4): A player may not end their turn with more than the hand
  limit.` (hand limit left undefined on this page) / pass 2: `p.4, Hand limit: A player may hold at
  most 7 cards; discard down to 7 at the end of your turn.` Pass 2 supplies a bound pass 1 left
  open; nothing pass 1 said is contradicted. `sharper`.
- **`sharper`** — pass 1 is silent on which player breaks a tie; pass 2: `p.6, Scoring: On a tied
  final score, the player with fewer remaining cards wins.` Pass 2 names a tie-break pass 1 omitted
  entirely — compatible, not contradictory. `sharper`.
- **`contradictory`** — pass 1: `p.2, Setup: Deal 6 cards to each player.` / pass 2: `p.2, Setup:
  Deal 5 cards to each player.` Both assert a specific count for the same fact; they cannot both be
  true. `contradictory`.
- **`contradictory`** — pass 1: `Derived (p.5): Attack resolves before Defense in a simultaneous
  reveal.` / pass 2: `Derived (p.5): Defense resolves before Attack in a simultaneous reveal.`
  Reversed precedence over the same two actions — the two readings produce opposite outcomes.
  `contradictory`.

---

## Line-level comparison, MAX-severity rollup

Compare rule-bearing line by rule-bearing line — do not compare whole files holistically. For each
rule-bearing line (or small cluster of directly related lines) where the two sides differ, record a
line-level finding with its own label and the exact lines involved. Roll the pair's overall verdict
up as the **maximum severity present** among its line-level findings, in this order:
`contradictory` > `sharper` > `cosmetic`. A single `sharper` line among a hundred `cosmetic` ones
still makes the pair `sharper`.

Retain the line-level findings in your return — a later phase's impact map needs the line detail to
scope repair to what actually changed, not to the whole page region the pair happens to span.

---

## RETURN a structured object only

Return exactly one object:

```
{
  pairId: string,
  label: 'cosmetic' | 'sharper' | 'contradictory',
  evidence: string,
  quotedPass1: string,
  quotedPass2: string,
  lineFindings: [ { label, quotedPass1, quotedPass2, note } , ... ]
}
```

- **`label`** is exactly one member of `cosmetic` / `sharper` / `contradictory` — never a sentence,
  never a hedge, never more than one label.
- **`evidence`** is the only free-prose field, and nothing downstream parses it — put your reasoning
  there, not in `label`.
- **`sharper` and `contradictory` REQUIRE `quotedPass1` and `quotedPass2` populated with both
  readings quoted VERBATIM** — copy the exact live-side and staged-side text, do not paraphrase
  either one. `quotedPass1` in particular must be an exact, byte-for-byte substring of the live
  slice text you were given: a later step attributes this rule delta back to the specific live
  slice(s) whose own content contains that quote, and a paraphrase there breaks that attribution
  silently — the delta would fail to attach to any chunk and could evaporate from the report
  entirely rather than being flagged.
- **Never return the slice bodies.** Quote only the specific lines the verdict turns on.
- **If the pair genuinely cannot be judged** — the two sides cover different, non-overlapping
  content, or a slice could not be meaningfully compared — say so plainly in `evidence` and **omit
  `label` entirely**. The recording step enumerates a missing/invalid label as `unclassified`,
  which is treated conservatively as needing repair. Do not guess `cosmetic` to avoid returning an
  incomplete answer — a guessed `cosmetic` here is the one failure mode this milestone cannot
  recover from downstream, because nothing else checks your work.

---

## Scope limit

This subagent never computes staleness, never decides provenance, never writes a ledger record,
never writes any file, and never opens a slice it was not given. Whatever downstream consequence
follows from the label is computed in code, from the label you return and the source hashes
recorded elsewhere — a claim about that consequence in this return would be ignored by the
recording step regardless of what it says.
