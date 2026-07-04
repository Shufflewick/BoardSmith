# Repair — Fix-or-Refute Loop, Bounded (BUILD-08)

Referenced by `build-chunk.md` Step 3 (`repair`, second of the `{audit, repair}` session step
group — see `state-machine.md` "Session Handoff Seams"). Repair processes each finding
`build/audit.md` recorded in this round's `## Findings Ledger` entry: every finding gets exactly
one of two outcomes.

## Two Allowed Outcomes, Never a Third

For each finding: **FIX** the code, or **refute-with-citation**. There is no third outcome — a
finding is never silently marked "handled" without one of these two, and code is never changed
in order to refute a finding (refuting is a citation, not a code change). This mirrors
`build/build.md`'s "Extends, Never Restructures" shape — name the non-default path explicitly and
record it durably, rather than leaving it implicit:

- **Fix**: change the code so the finding no longer holds. Record the finding's disposition as
  `fixed` in its `## Findings Ledger` entry.
- **Refute-with-citation**: the finding does not hold — record the disposition as `refuted`
  together with the rulings/rulebook citation that supports the refutation, written directly
  into the Findings Ledger entry's disposition. A refutation with no citation attached is not a
  valid refutation; it is an unaddressed finding.

## Repair Loop Bound (cite, never restate)

Cite `state-machine.md` "Repair Loop Bound" for the governing rule — this file does not
re-derive it in its own words, it applies it:

- Maximum 3 audit rounds per chunk.
- Round N+1 auditors see this ledger and report only NEW findings — repair never re-litigates a
  finding already recorded in a prior round's entry.
- After round 3, any remaining findings are triaged with the user (see "Round-3 User Triage"
  below).

## Same-Group Loop-Back to Audit (cite, never restate)

Repair and audit are in the SAME session group (`{audit, repair}` per `state-machine.md`
"Session Handoff Seams"). A repair round that produces one or more fixes loops back to `audit`
for the next round WITHOUT a session handoff — this mirrors `build/test.md`'s "Failures Loop
Back to `build`":

> A failure at any step in the ordered sequence above ... routes this chunk back to `build`
> (still session group 2, `{build, test}`); it does not advance to `audit`. `test` and `build`
> stay in the same group specifically so a failing test can be fixed without a session handoff
> in between.

Applied here: `repair` and `audit` stay in the same group specifically so a repair round that
fixes findings can be re-checked by a fresh audit round without a session handoff in between —
unless the round bound above has been reached, in which case repair routes to the round-3 user
triage instead of dispatching another audit round.

## Persisting Dispositions — Write Before the Next Audit Round Starts

Write each round's dispositions (`fixed` | `deferred` | `refuted`, per finding) into the
`## Findings Ledger` entry BEFORE the next audit round is dispatched — this is the same
write-before-next-step discipline `build/audit.md` and `build/redteam.md`'s "Persisting the
Round" both establish. **Cold-resume rule:** a crashed repair round resumes by reading the
ledger — any finding still missing a disposition is unfinished repair work; a finding with a
recorded disposition is done and is not redone or clobbered by a resuming session.

## Round-3 User Triage — Plain Language, Never Raw

After round 3, any finding still lacking a disposition is triaged with the user directly. Cite
`build/redteam.md`'s "Vote-Privacy" discipline by name rather than re-deriving it: never show the
user a raw finding text, an agent transcript, or a severity score. Present exactly three
plain-language options in designer register, one per finding:

- **Real blocker** — this chunk cannot ship with this finding unresolved; keep working it.
- **Defer to a later chunk** — the finding is legitimate but out of scope for this chunk; record
  it for a future chunk instead of blocking this one.
- **Auditor was wrong (refuted)** — the finding does not actually hold; the user confirms the
  refutation in the same designer register `build/redteam.md`'s escalation example uses (a
  concrete plain-language question with concrete options), never engine or agent vocabulary.

Whatever the user chooses becomes that finding's final disposition in the `## Findings Ledger`
entry — `deferred` findings that the user routes to a later chunk are also noted in `SKETCH.md`'s
Ideas Backlog, the same destination `build/build.md`'s category-(b) future-scope items use.

## Downstream Shape (cite, never restate)

Once every finding across all rounds has a disposition (`fixed`, `deferred`, or `refuted`) and no
audit round remains open, this chunk moves to the `{playtest, one revise round, close}` session
group — authored in Phase 146. This file does not restate that group's structure.
