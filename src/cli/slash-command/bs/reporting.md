# BS Skills — Talking to the Designer

Every `bs-` skill cites this file rather than restating its rules. It governs **everything the
designer reads**: step-completion narration, gate presentations, questions, status reports,
close-out lines, banners, and stop/error messages.

The audience is a game designer, not a programmer. They did not read this skill tree, they do not
know its step names, its ledgers, or its internal ids, and they should never need to. Whatever the
pipeline needs to record about itself, it records in files — not in the designer's face.

`build/ask.md`'s "Prohibited Vocabulary" is the same rule applied to one presentation. This file
generalises it to every message.

## The One Rule

A message to the designer contains exactly two things:

1. **What they need to do** — if anything.
2. **What changed that they can see** — in the game, not in the pipeline.

Anything else is cut. If you write a sentence the designer cannot act on and did not ask for,
delete it.

## Lead With the Ask

The first line answers the question the designer is actually holding: *is there something you want
me to do?* Either name the one concrete action, or say plainly that there isn't one:

> Yes — one thing. Play the game and tell me if it looks right.

> Nothing needed. I'll keep going.

Never make them read to the bottom to find out. Never end on an ambiguity about whose turn it is
to act.

## Never in the Body

Unless the designer asked for it, or must type it themselves:

- **Internal ids** — requirement/check tags (`CHECK-01`, `VERIFY-04`, `BUILD-11`, `SKILLAUTO-02`),
  finding ids, pair ids, ruling numbers, run ids, commit hashes, phase numbers.
- **File and directory paths**, ledger names, template names, section names.
- **CLI commands**, except the ONE command you are asking the designer to run.
- **Pipeline machinery** — step names, subagent/dispatch/handshake/model names, context budgets,
  locks, gates, contracts, "formatted not computed", staging, provenance.
- **Verdict and status spellings.** Say what they mean:
  - `still-needed` → "the rulebook doesn't answer this — your call still stands"
  - `resolved-by-source` → "the rulebook answers this after all"
  - `contradicted` → "the rulebook says the opposite"
  - `undetermined` → "couldn't tell either way"
  - `rules-stale` → "needs re-testing, because the rules underneath it changed"
  - `verified (user-waived)` → "you chose to skip testing this one"
- **Engine vocabulary** — `action`, `flow`, `state`, `element` and their kin, per `build/ask.md`
  "Prohibited Vocabulary". Describe what a player does and sees.

Naming a file the designer supplied (their rulebook, their artwork) is fine. Naming a file the
pipeline keeps for itself is not.

## Numbers and Tables

A number earns its place only when it changes what the designer does, or is the thing they asked
for. Counts of internal records — units recorded, pairs classified, verdicts pending — change
nothing for them.

**No ledger tables in ordinary narration.** A grid of internal counts reads as "here is proof I did
work," which is not information the designer requested. `/bs-check-status` is the one skill whose
job IS the report; structure is welcome there, in plain words.

## Bookkeeping Is Invisible

Recording, ledgers, provenance, commits, lock release, status writes — the designer never needs a
play-by-play. At most, one line at the end:

> Everything else was bookkeeping — written down so it isn't lost. None of it needs anything
> from you.

## Optional and Incidental Items

Something worth knowing but not worth doing: one line each, with your recommendation, mentioned
once. Then drop it unless the designer raises it. Never a standing section of caveats.

> One check never ran — replaying the rulebook's worked examples against the code. Low value here;
> I'd skip it.

## Don't Defend the Work

No explaining why a result is "the expected shape." No meta-commentary about a check working
correctly, a contract holding, or a record being real. Report the outcome. If a number would
genuinely surprise the designer, one plain sentence on why — not a paragraph.

## Length

- Ordinary step completion: **one to three sentences.**
- A gate that needs an answer: the question and its named options, and nothing else.
- A report skill (`/bs-check-status`) or a fixed ceremony (`build/ask.md`'s 4 parts,
  `build/final-acceptance.md`'s banner + card, `build/close.md`'s tail delta): the shape its own
  file defines — written in this voice.

## Worked Example

**Wrong** — pipeline-facing, unaskable, defends itself:

> CHECK-01 is complete. Recorded 26/26, 0 pending; still-needed 26; resolved-by-source /
> contradicted / undetermined 0 / 0 / 0. The ledger is real: `rulebook/.verify/<run>/
> RULING-VERDICTS.md`, 26 records, 20KB. 26-for-26 surviving is the expected shape, not a null
> result — the absence-of-source trap governs most of them.

**Right** — same run, designer-facing:

> Yes — one thing. Play the game and tell me if it looks right.
>
> Two things changed that you can see: the cards are now the real artwork from your PDF, and each
> player's deck was wrong (two Jabs and one Advance; it should be one Jab and two Advances) — fixed.
> Because of those, all 12 pieces of the game need re-testing, and only you can clear that.
>
> Want me to start it up? Everything else was bookkeeping.

## Reference

`build/ask.md` "Prohibited Vocabulary" and "The Fixed 4-Part Presentation Format";
`build/repair.md` "Round-3 User Triage — Plain Language, Never Raw"; `build/redteam.md`
"Vote-Privacy". This file is the general rule those three already follow locally; it adds no new
authority over what gets built, only over how it is said.
