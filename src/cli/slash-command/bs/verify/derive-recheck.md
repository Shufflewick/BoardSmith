# Blind Derivation — CHECK-04's First Judgment Contract

This is `verify-game.md`'s (or a later Phase 179 source-free mode's) first delegate for CHECK-04:
one `Derived (p.N):` line, re-derived from scratch, with the original line itself withheld from
you entirely. This contract produces a derivation. It does NOT decide whether that derivation
agrees with the original — that is a separate dispatch, `verify/derive-compare.md`, with its own
distinct token. Same architectural split as `verify/classification-subagent.md` and
`verify/ruling-recheck.md` (`state-machine.md` "Session Handoff Seams" is not touched by this
file; cite it, do not restate it): **the CLI enumerates and records; a fresh-context subagent
judges.**

This contract lives in its own file for the same reason
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md` does: the part that matters most here
— the blind-independence rule below — is exactly the part a paraphrase from memory silently drops.
A composed prompt cannot be trusted to carry that rule intact across a round trip through an
orchestrator's own words; only a copied block can. Read this file in full before deriving anything.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading anything, check that the prompt you were
dispatched with contains the exact token `BS-DERIVE-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-DERIVE-V1 token.

You composed this dispatch prompt instead of copying the pointer block from the orchestrator that
should have dispatched you. Re-read that orchestrator's dispatch section and send the pointer
block verbatim, including the token.

A composed prompt cannot be trusted to carry the blind-independence rule intact — the token is
proof this block was copied, not recalled, because it cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and derive anyway. A rejected
dispatch costs one round trip; an accepted composed one risks silently reintroducing the original
line into a prompt that is supposed to never contain it.

---

## Your inputs

The dispatching prompt gives you exactly ONE thing: this slice's quote lines — every directly-
quoted rulebook sentence and its citation header, with every `Derived (p.` line and every
`Visual (p.` line already stripped out by the orchestrator before this prompt ever existed.

State this plainly, because it is the crux of the whole contract: **you are NEVER given**

- the `Derived` line you are re-deriving,
- any OTHER `Derived` line from this slice or any other slice, or
- any `Visual` line at all.

You must not ask for or assume access to the live `rulebook/` files. If you believe you can infer
what the original derivation said from context, you cannot — the original was never included in
this prompt, and no amount of reasoning about the quote lines recovers text that was never sent to
you. Deriving a value and being shown the very thing you are re-deriving is not independent
verification, it is confirmation — and a subagent shown the original would agree with it almost
every time regardless of whether the original derivation was actually sound. That is the failure
mode this contract exists to prevent, and it is prevented structurally: the quote-line payload you
receive is built by a function (`buildBlindDerivePayload`, `verify-derive-recheck.ts`) that never
reads the target line's own text, not by an instruction telling you to look away from something
that was sent anyway.

---

## Two non-value outcomes

Not every rule-bearing–looking line survives contact with a blind re-derivation attempt. There are
two distinct ways a derivation can fail to produce a value, and confusing them manufactures a false
finding either way. Neither is taught here by a keyword or trigger-phrase list — a phrase list is
the same defect class as an absence-phrase list (`verify/ruling-recheck.md`'s own absence-of-source
trap exists for the identical reason) and would work only on the lines someone happened to look at
while silently misjudging the rest. Judge each line on what the quote lines actually do or do not
support, not on whether it matches a pattern.

### `not-rule-bearing`

The line under test does not encode a game rule at all — it describes the page, not the game.

**Worked example, quoted byte-identical from the real archived fixture**
(`174-FIXTURES/seven/live/02-solo-variant.md`):

```
Derived (p.2): Page 2 is a wide landscape panel with a solid purple background, white bold sans-serif heading and white body text in a single left-hand column. The right side is empty except for the word "SEVEN" set in white bold italic sans-serif, rotated diagonally (reading upward at roughly 45 degrees). No diagrams or component images appear on this page.
```

A wrong answer that looks plausible on a quick read: attempt to "derive" a rule anyway by treating
the page's visual layout as somehow meaningful to play — for instance claiming the single-column
layout implies a turn order, or that the empty right side implies something is optional. Nothing in
the quote lines you were given supports reading page geometry as a rule statement, because page
geometry is not a rule statement. The correct answer is `not-rule-bearing`: this line describes
what the page looks like, not what a player may or must do.

### `underivable`

The line under test IS rule-bearing, but the fact it depends on was never captured as a directly-
quoted line — it was captured only as another `Derived` line (a diagram description or similar
inference), which is itself excluded from your payload. You have nothing left to derive from.

**Worked example, quoted byte-identical from the real archived fixture**
(`174-FIXTURES/seven/live/01-definitions-and-components.md`):

```
Derived (p.1): The full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.
```

This is a rule-bearing fact — the total deck composition matters to play. But its only supporting
material in the live slice is itself a `Derived` line — a diagram description of the "Distribution
of Cards" illustration — which is stripped from your payload exactly like every other `Derived`
line, including the one under test. There is no directly-quoted sentence anywhere in your quote
lines that states the deck total or its factors.

A wrong answer that looks plausible: derive SOME number anyway, by guessing at a plausible deck
composition from genre convention, or by declining to answer at all with no verdict. Both are
wrong. Guessing a number you cannot actually support from the quote lines you were given
manufactures a false `agrees`/`disagrees` outcome downstream that looks like a real second opinion
but is not one. The correct answer is `underivable`, naming plainly in your reasoning that the only
supporting material for this fact was itself a stripped `Derived` line — you were never sent
anything to derive it from.

**The general rule these examples prove:** if nothing in your quote lines supports a fact, that is
not license to guess, and it is not the same failure as the fact simply not being a rule. Tell them
apart honestly, one line at a time.

---

## RETURN a structured object only

Return exactly one object:

```
{
  rederivedValue: string | 'not-rule-bearing' | 'underivable',
  sourceQuotes: string[]
}
```

- `rederivedValue` is either your derived value stated as a string, or exactly one of the two
  literals `not-rule-bearing` / `underivable` above — never a sentence explaining a value alongside
  one of the literals, never a hedge, never both a value and a literal at once.
- There is NO verdict field here. You are not asked whether your derivation agrees with anything,
  because you were never shown anything to agree or disagree with. Deciding agreement is
  `verify/derive-compare.md`'s job, dispatched separately, after your answer is already recorded.
- `sourceQuotes` names the specific quote lines your derivation actually drew on — the exact lines
  from the payload you were given, not a paraphrase of them. Leave it empty when
  `rederivedValue` is `not-rule-bearing` (there is nothing to cite for a page-layout judgment).
- **Never return the full quote-lines payload back.** Cite only what your answer actually turned
  on.

---

## Scope limit

This subagent writes no file, decides no `agrees`/`disagrees` verdict, and opens no slice beyond
the quote lines it was handed. It never asks for the live `rulebook/` tree, never asks for the
original `Derived` line "just to check," and never widens its own dispatch prompt. Whatever
downstream consequence follows from your `rederivedValue` is computed by the separate comparison
dispatch and the recording CLI — a claim about that consequence in this return would be ignored
regardless of what it says.

**Context-Economics carve-out:** the quote lines in THIS prompt are a dispatch payload the
orchestrator constructed for you specifically, not the orchestrator's own transcript — the
orchestrator itself still never opens a slice to read it. Receiving quote lines as a subagent's
dispatch input is not the same thing as the orchestrating session reading a slice into its own
context, exactly as `state-machine.md`'s Context Economics guidance already distinguishes for
every other judgment-subagent dispatch in this repo.
