# Redteam — Independent Adversarial Review (BUILD-03)

Referenced by `build-chunk.md` Step 3 (`redteam`, second of the `{investigate, redteam, ask}`
session step group — see `state-machine.md` "Session Handoff Seams"). This is the
independent-review gate that catches misinterpretations before the human ever sees a proposal:
`build/investigate.md`'s numbered claims list is checked by 3 fresh-context adversarial agents
(2 refuters + 1 coverage adversary) before `build/ask.md` ever presents it to the user. Mirrors
`ingest/transcription.md`'s fan-out dispatch mechanics; escalation authority follows
`state-machine.md`.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads the chunk's cited slices or the claims list's underlying prose
itself, and it never re-reads CHUNK.md's `## Interpretation` after a redteam agent returns.**
Every fact the orchestrator needs about this round's outcome comes from the structured verdicts
each subagent returns, not from opening any of those files again. Do not add a "let me
double-check by re-reading the claims" pass after the agents return — it silently reintroduces
the exact context-exhaustion failure mode the fan-out design exists to avoid. If a returned
verdict looks wrong, dispatch a narrower follow-up subagent or escalate to the user — never fall
back to reading the sources yourself.

## Independence: Fresh-Context, No-Framing Dispatch

Redteam runs 3 independent fresh-context agents — 2 refuters plus 1 coverage adversary — on the
claims list produced by `build/investigate.md`. Each of the 3 agents is a SEPARATE Task-tool
dispatch. The dispatch prompt for every agent contains ONLY the raw slice path(s) and the
numbered claims list text — never the orchestrator's running conversation, never the investigate
subagent's own prompt or rationale, and never a peer agent's verdict. This is
`transcription.md`'s "the transcribed text never flows back through the orchestrator's context"
discipline applied one hop further: the investigator's framing must never flow to redteam,
because framing is exactly what defeats independent review.

Concretely: prohibit confidence adjectives in the dispatch prompt. Never write "the investigator
believes this is correct," "likely correct," or anything that signals the claims list's author
already thinks it's right. Present the claims as bare numbered assertions with citations, nothing
more — the agent's job is to independently re-derive whether the citation supports the claim, not
to grade the investigator's confidence.

## Three Dispatch Templates

**Refuter × 2 (identical prompt, independent dispatch):**

```
You are reviewing a rules interpretation for {gameName}, chunk "{slug}". Read the following
rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project — rulings outrank the
rulebook (see state-machine.md "Rulings Outrank Rulebook"); the rulebook plus RULINGS.md
together form the composite source of truth.

Here is a numbered list of factual claims. For each claim, decide: does the cited slice (plus
RULINGS.md) support this claim as written? Default to REFUTED if you are uncertain — do not
give the benefit of the doubt.

{numberedClaimsList}

Return exactly: a list of { claimNumber, verdict: 'stands' | 'refuted', objection } — one
entry per claim (objection is required when verdict is 'refuted', empty otherwise).
```

**Coverage adversary (separate prompt, independent dispatch):**

```
You are reviewing a rules interpretation for {gameName}, chunk "{slug}" for COMPLETENESS, not
correctness. Read rulebook/INDEX.md and search it for rules that interact with this chunk's
topic but are cited by no claim in the list below. Also read RULINGS.md.

{numberedClaimsList}

Return exactly: { missingInteractions: [{ ruleDescription, citation }, ...] } — empty array if
none found.
```

This is the concrete pattern to copy: 3 independent Task-tool dispatches, each prompt containing
only slice paths + the numbered claims list — no investigator rationale, no framing.

## Default-to-Refuted

Refuters default to REFUTED when uncertain rather than defaulting to stands. An unclear or
ambiguous match between a claim and its citation is not evidence the claim is correct — it is
evidence the claim needs more scrutiny, so the refuter treats uncertainty as a finding, not as a
pass.

## Escalation Logic (cite, never restate)

See `state-machine.md` "Redteam Escalation" and "Repair Loop Bound" for the governing rules —
this file does not restate the max-1-round bound or the refuted-twice rule, it applies them:

- **Refuted once** (one refuter, or the coverage adversary alone, flags a claim/gap): hand off
  to `build/investigate.md`'s re-investigate behavior with the specific objection(s) attached —
  maximum ONE re-investigate round. Re-investigation appends a superseding claim; it never
  renumbers or edits the original (see `build/investigate.md` "Re-Investigate Round Behavior").
- **Refuted twice** (both refuters agree a claim is refuted, or a refuter and the coverage
  adversary flag the same claim/gap on the re-investigate round): that is by definition an
  ambiguity. Escalate to the user — disputes go to the human, never to more agents.

## Vote-Privacy

Per-agent verdicts are internal signal the orchestrator holds until all 3 agents have returned.
Never show the user a raw vote tally or an agent transcript — not "2 of 2 refuters rejected
claim 7," not the objection text verbatim from an agent. When escalation triggers, the
orchestrator distills the disagreement into a single plain-language question with concrete
options, in the register a designer would use, never engine or agent vocabulary:

> "The rulebook doesn't say whether a player who draws a card they can't use has to reveal it.
> Option A: keep it hidden until played (matches how the rest of hidden info works here).
> Option B: reveal it immediately (matches the printed sequence on p.9). Or is this a house-rule
> choice you want to make either way?"

## Recording the Ruling

The user's answer to a refuted-twice escalation is recorded as a `### Ruling N` entry in
`RULINGS.md` — fill `templates/RULINGS.template.md`'s Decision / Citation interpreted or
overridden / Rationale shape exactly; never restructure the header, and never overwrite or
renumber a prior entry (RULINGS.md is append-only).

## Downstream Shape (cite, never restate)

`build/investigate.md` is the upstream claims producer and the owner of re-investigate behavior
on a refuted-once round (see its "Re-Investigate Round Behavior" section). Once a round of
redteam clears with no unresolved refuted-twice escalations, the settled interpretation flows to
`build/ask.md`, the downstream consumer that presents it to the user for approval. This file
does not restate either file's structure.
