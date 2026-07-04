# Redteam — Independent Adversarial Review (BUILD-03)

Referenced by `build-chunk.md` Step 3 (`redteam`, second of the `{investigate, redteam, ask}`
session step group — see `state-machine.md` "Session Handoff Seams"). This is the
independent-review gate that catches misinterpretations before the human ever sees a proposal:
`build/investigate.md`'s numbered claims list is checked by 3 fresh-context adversarial agents
(2 refuters + 1 coverage adversary) before `build/ask.md` ever presents it to the user. Mirrors
`ingest/transcription.md`'s fan-out dispatch mechanics; escalation authority follows
`state-machine.md`.

## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads the chunk's cited slices or any other rules source itself.** The
numbered claims list text it embeds in each dispatch prompt comes from the one sanctioned
state-file read — CHUNK.md's `## Interpretation` and `## Visibility Declaration`, read after
investigate completes (see `build-chunk.md`'s Context-Economics Hard Rule) — and every fact the
orchestrator needs about this round's outcome comes from the structured verdicts each subagent
returns. Do not add a "let me double-check the claims against the rulebook" pass after the
agents return — re-opening the slices silently reintroduces the exact context-exhaustion failure
mode the fan-out design exists to avoid. If a returned verdict looks wrong, dispatch a narrower
follow-up subagent or escalate to the user — never fall back to reading the sources yourself.

## Independence: Fresh-Context, No-Framing Dispatch

Redteam runs 3 independent fresh-context agents — 2 refuters plus 1 coverage adversary — on the
claims list produced by `build/investigate.md`. Each of the 3 agents is a SEPARATE Task-tool
dispatch. The dispatch prompt for every agent contains ONLY the raw slice path(s) and the
numbered claims list text (the text the orchestrator read from CHUNK.md's `## Interpretation` —
the sanctioned state-file read above) — never the orchestrator's running conversation, never the
investigate subagent's own prompt or rationale, and never a peer agent's verdict. This is
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

**Round-2 dispatch vs superseded claims:** the re-investigate round appends a superseding claim
and leaves the refuted original untouched in place (append-only — see `build/investigate.md`
"Re-Investigate Round Behavior"). When the round-2 agents are dispatched, the claims list
embedded in their prompts marks every superseded claim in place — e.g.
`7. [superseded by claim 12 — do not review] <original text>` — and the prompt instructs the
agents that a claim marked "supersedes claim N" replaces claim N for review purposes:
superseded claims receive **no verdict**, and re-refuting one is not a finding. Without this
marking, fresh-context round-2 agents would correctly re-refute the original (it is still
wrong, by design) and manufacture a spurious refuted-twice escalation on every re-investigate
round.

## Persisting the Round (write at the end of EACH round — never deferred past a re-investigate)

The orchestrator appends a `### Redteam Round N` entry to CHUNK.md's `## Redteam Rounds`
section (`templates/CHUNK.template.md`) at the end of **each** round — per-claim verdicts,
objection text, the coverage adversary's findings, and the round's disposition. Concretely:

- **Round 1, refuted-once path:** append `### Redteam Round 1` with disposition
  `re-investigate dispatched` **before** dispatching the re-investigate subagent — never
  deferred until the re-investigate round completes. A crash mid-re-investigate must not lose
  Round 1's verdicts while the re-investigate subagent's superseding claim (written directly to
  `## Interpretation`) survives.
- **Round 2, or a Round 1 that clears or escalates:** append that round's entry when its 3
  agents have returned and its escalation logic has resolved, with disposition `cleared` or
  `escalation open at ask`, **before** the ask step starts.

This is a state-file write and is what makes every round cold-resumable: a crash or session
handoff at any seam — mid-re-investigate, or between redteam and ask — must not lose an already
resolved round's verdicts. **Resume rule:** a session resuming at redteam (unchecked) that finds
a round entry with disposition `re-investigate dispatched` — or a claim in `## Interpretation`
noting "supersedes claim N" — dispatches a **round-2** review with every superseded claim marked
(see "Round-2 dispatch vs superseded claims" above), never a fresh Round 1; without the round
record, the resume could not know the marking applies, both refuters would re-refute the
superseded original, and a spurious refuted-twice escalation would be manufactured through the
crash seam. Vote-privacy (below) governs what is *shown to the user*, not what is *written to
state* — the recorded entry is internal, and the ask step still distills it into designer
language. After the final round's entry lands, the orchestrator checks off `redteam` on
CHUNK.md's Step Checklist.

## Vote-Privacy

Per-agent verdicts are internal signal the orchestrator holds until all 3 agents have returned,
then records durably in CHUNK.md's `## Redteam Rounds` (see "Persisting the Round" above).
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
