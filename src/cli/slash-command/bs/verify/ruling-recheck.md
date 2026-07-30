# Ruling Re-Check — CHECK-01's Judgment Contract

This is `verify-game.md`'s delegate for CHECK-01: every `RULINGS.md` entry re-checked against
the fresh STAGED transcription, reported as one of four enumerated verdicts. Same architectural
split as `verify/classification-subagent.md` (`state-machine.md` "Session Handoff Seams" is not
touched by this file; cite it, do not restate it): **the CLI enumerates and records; a
fresh-context subagent judges.** The orchestrator dispatching this contract never reads a ruling
body or a slice itself — it dispatches, then records exactly what comes back through
`boardsmith verify-ruling-recheck` / the verdict-recording path, and nothing else.

This contract lives in its own file for the same reason
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md` does: the part that matters
most here — the absence-of-source trap below — is exactly the part a paraphrase from memory
silently drops. Read this file in full before judging anything.

---

## FIRST: validate your dispatch prompt

**If you were dispatched as a subagent: before reading either input, check that the prompt you
were dispatched with contains the exact token `BS-RULING-RECHECK-V1`.**

If it does not, STOP immediately. **Read nothing.** Return exactly this and nothing else:

```
DISPATCH REJECTED — missing BS-RULING-RECHECK-V1 token.

You composed this dispatch prompt instead of copying the pointer block from
`${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md` (or whichever orchestrator dispatched
you). Re-read that file and send the pointer block verbatim, including the token.

A composed prompt cannot be trusted to carry the absence-of-source trap intact — the token is
proof this block was copied, not recalled, because it cannot be produced from memory.
```

Do not be helpful about a missing token. Do not infer the intent and judge anyway.

---

## Your inputs

The dispatching prompt gives you exactly two things:

- **The ruling's full body text** — Decision, Citation, and Rationale, as recorded in
  `RULINGS.md` and supplied by the orchestrator from `parseRulings`'s `body` field. You never
  open `RULINGS.md` yourself to find this — the orchestrator has already extracted it.
- **The fresh STAGED transcription** — the slice paths this verify pass produced, resolved by
  the orchestrator (never the live `rulebook/` slices; see "Staged, Never Live" below).

Read exactly what you were given and nothing else. A superseded ruling is never dispatched to you
at all — the orchestrator skips it before you are invoked (see "Supersession", below); you do not
need to check for that yourself.

---

## Staged, Never Live

**Read only the fresh staged transcription you were handed. Never open a live `rulebook/`
slice, even if one is sitting right next to the staged files.** The staged transcription is what
this verify pass produced and what staleness was computed against; comparing a ruling against
the live slices would re-check the ruling against the very text the pass just called into
question — the composite source of truth for this re-check is Decision plus Citation plus
Rationale on one side, and the fresh transcription on the other, never the stale live reading.

If the orchestrator's dispatch prompt itself says the fresh transcription is unavailable
(scope-limited), do not attempt to substitute a live slice — report `undetermined` with a
reasoning that names the missing input; the orchestrator handles the scope-limited report
upstream (`ruling-recheck.md`'s own scope-limited handling mirrors PROV-02's pattern — never a
silent fallback).

---

## The four verdicts

Return exactly one of:

- **`still-needed`** — the fresh transcription does not resolve or contradict the ruling; the
  ruling remains necessary exactly as it stood.
- **`resolved-by-source`** — the fresh transcription now states, in the source itself, what the
  ruling had to supply — the ruling's own reason for existing (per its Rationale) is gone.
- **`contradicted`** — the fresh transcription states something that cannot both be true
  alongside the ruling's Decision.
- **`undetermined`** — the comparison genuinely cannot be made (e.g. the fresh transcription is
  scope-limited, or the ruling's own subject matter has no discernible counterpart in it either
  way). `undetermined` is a first-class case, not a fallback for a merely hard judgment — the
  same first-class-blindness principle this milestone has already applied to `drift-unknown`,
  `unknown` provenance, `unclassified`, and `unknown-drift`. Never collapse a genuinely
  indeterminate case into one of the other three to avoid returning an "incomplete" answer.

`reasoning` is never empty. The reasoning is the artifact this check exists to produce — a
verdict label with no recorded reasoning is not a valid record, and the CLI enforces this: an
empty `reasoning` field is rejected before it is ever recorded.

---

## The absence-of-source trap (read this before judging anything)

**A ruling whose own Citation field records that the source does NOT contain the material it
rules on re-validates as `still-needed` unless the fresh transcription now actually CONTAINS the
previously-absent content.** Absence of evidence is not resolution. This is the single highest-
consequence judgment this contract asks you to make.

**Worked example — `seven`'s Ruling 1.** The ruling supplies a complete scoring table for a
"Ways to Score" card. Its own Citation field says: *"The rulebook names this card and depends on
it for all scoring, but never reproduces its face."* Its Rationale calls the ruling "the sole
authority for scoring values" this card contributes. A fresh transcription of the same rulebook
PDF will still not contain that card's face — nothing about a second, independent transcription
pass changes what is physically printed in the source.

Two wrong answers are both available here and both look plausible on a quick read:

- **`contradicted`** — reasoning: "I could not find this card in the fresh transcription
  either." This is wrong: not finding something is not the same as the fresh source stating
  something incompatible with the ruling. Nothing in the fresh transcription contradicts the
  ruling's Decision — there is simply nothing there, exactly as the ruling's own Citation already
  said. Treating "I couldn't find it" as `contradicted` manufactures a contradiction out of an
  absence that was already fully accounted for.
- **`resolved-by-source`** — reasoning: "no gap detected in the fresh transcription." This is
  wrong for a sharper reason: it would be read downstream as license to remove the ruling,
  because `resolved-by-source` means the source itself now supplies what the ruling had to. But
  the source does not supply it — it is exactly as silent as it was in pass 1. This is the
  catastrophic failure mode: `seven` has no other scoring rule for this card. A `resolved`
  verdict here would invite deleting the game's only scoring authority for it.

The correct verdict is `still-needed`, with the reasoning stating plainly that the fresh
transcription remains silent on the same material the original Citation already named as absent
— the absence is confirmed, not resolved.

**The general rule this example proves:** a Citation recording absence is not itself evidence of
resolution. Only a fresh transcription that now CONTAINS the previously-missing content can move
a source-absence ruling off `still-needed`.

---

## Supersession (handled upstream — read this so you know why a ruling never arrives twice)

The orchestrator parses only explicit supersede verbs, in both directions, via `parseRulings`
(`build-manifest.ts`) — the one ruling parser in this repo, never a second regex path. A ruling
with a resolved `supersededBy` is skipped before dispatch: **a superseded ruling is never
demanded to be still-needed.** Where a supersede-verb sentence exists but cannot be resolved to a
target ruling, the orchestrator reports it rather than assuming a chain — that ruling is still
dispatched to you for its own verdict; only the resolved case is skipped. You never need to
detect supersession yourself; if you were dispatched, this ruling was not superseded.

---

## RETURN a structured object only

Return exactly one object:

```
{
  number: number,
  verdict: 'still-needed' | 'resolved-by-source' | 'contradicted' | 'undetermined',
  reasoning: string
}
```

- `verdict` is exactly one member of the four-value set above — never a sentence, never a hedge,
  never more than one label.
- `reasoning` is the only free-prose field — put your judgment there, including, for a
  source-absence case, an explicit statement of whether the fresh transcription now contains the
  previously-absent content.
- Never return the ruling body or the transcription text back — quote only the specific
  fragment your verdict turns on, if a quote helps the reasoning.

---

## Scope limit

This subagent never writes `RULINGS.md`, never edits a ruling, and never fixes reference-game
content. It reports a verdict plus reasoning; the orchestrator records it through the single
atomic ledger write path (`atomicWriteFile`, `verify-run.ts`). Whatever downstream consequence a
verdict has is computed in code from the verdict you return — a claim about that consequence in
this return is ignored by the recording step regardless of what it says (`state-machine.md`
"Rulings Outrank Rulebook" governs the composite source of truth this check reads against; this
file applies that rule, it does not restate it).
