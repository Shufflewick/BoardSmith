# Interview Fallback — No-Rulebook Structured Interview (INGEST-03)

This is the no-rulebook input path: the orchestrator (`ingest-rules.md` Step 1) delegates here
when the designer has no written rulebook (unpublished prototype, rules in the designer's head).
The question sequence below is extracted verbatim in shape from the old `/design-game` skill's
Phase 2 (`instructions.md` lines 121-223) — same six questions, same one-at-a-time cadence,
same Clarification Protocol. The one required adaptation (see "Output Re-Target" below) is that
this path produces the SAME `rulebook/NN-topic.md` + `rulebook/INDEX.md` files the transcription
path (`ingest/transcription.md`) produces — not PROJECT.md prose. INGEST-03 depends on this
identity: every downstream ingest step (synthesis, sketch derivation, scaffold) is unaffected by
which input path was taken.

## Outputs

- `rulebook/NN-topic.md` — one slice per answered question (or logical group of related
  questions), each a cited transcript of the designer's own words.
- `rulebook/INDEX.md` — the same term → slice-file cross-reference table the transcription path
  builds, fed from this path's own accumulated terms.

Ask ONE question at a time, wait for the response, then continue.

### Question 1: Open Vision

Start with an open question to capture the designer's vision:

> "Tell me about [Game Name] in a sentence or two! What's the theme and what do players do?"

Listen for:
- Theme and setting
- Core excitement (what makes it fun)
- Basic player interaction

### Question 2: Components

Ask about each component type one at a time:

> "Will your game use **cards**? If so, describe them briefly."

> "Will your game use a **board**? If so, describe it briefly."

> "Will your game use **dice**? If so, what kind?"

> "Will your game use **tokens or pieces**? If so, describe them."

For each component mentioned, note only the essentials:
- What categories/types exist (e.g., "Red, Blue, Green suits" for cards)
- Basic purpose (e.g., "deck to draw from, hand to hold")

**Keep it light, but clarify ambiguity:**
- Do NOT ask about detailed card effects, scoring formulas, or edge cases
- If the designer mentions a mechanic that sounds unclear, ask ONE follow-up to capture the core rule
- Example: "Roll dice and guess" - Ask: "Do you guess before or after rolling?"

### Question 3: Turn Structure

> "How do turns work? Options:"
> - **Sequential:** One player completes their entire turn, then the next player goes
> - **Simultaneous:** All players act at the same time
> - **Phased:** All players do phase 1 together, then all do phase 2, etc.

### Question 4: Round Completion

> "How does a round end? Options:"
> - All players take one turn
> - Someone passes or chooses to end
> - A trigger condition happens (describe it)
> - No rounds - continuous play until game ends

### Question 5: Game End

> "How does the game end? Options:"
> - Someone reaches a goal (points, collection, connection)
> - A deck or resource runs out
> - Fixed number of rounds
> - Last player standing (elimination)
> - Other (describe)

### Question 6: Summary and Confirmation

After gathering responses, present a summary:

```
## Summary of Your Game

**Name:** [from opening discussion]
**Theme:** [one sentence]
**Core Loop:** [what players do on their turn]

**Components:**
- Cards: [description or "None"]
- Board: [description or "None"]
- Dice: [description or "None"]
- Tokens: [description or "None"]

**Turn Structure:** [Sequential/Simultaneous/Phased]
**Round End:** [trigger]
**Game End:** [condition]
**Win Condition:** [how someone wins]
```

Then ask:

> "Any changes before we create your game?"

If the designer confirms, proceed to the Clarification Protocol.

### Clarification Protocol

Before proceeding to file writing, confirm your understanding of the core mechanic:

> "Just to confirm: [restate the core mechanic in your own words]. Is that right?"

This one question can prevent multiple iterations of fixes. Examples:
- "Just to confirm: players pick a number 1-6, then roll, and win if they match. Is that right?"
- "Just to confirm: you draw 2 cards and play 1 each turn. Is that right?"

Wait for confirmation before proceeding to output writing.

## Output Re-Target (the one required adaptation)

The old skill's Phase 2 fed straight into its own Phase 4 PROJECT.md template. This path does
NOT do that. Each answer, once confirmed, becomes a cited slice written to
`rulebook/NN-topic.md` — grouped by topic (e.g. Q1's vision answer → `rulebook/01-vision.md`,
Q2's components answer → `rulebook/02-components.md`, and so on) — with citation format:

```
designer statement, ingest session, Q{n}
```

exactly parallel to the transcription path's `p.{N}, {section}` page citations. Terms
referenced in each answer (component names, mechanic vocabulary) are collected into the same
`citedTerms[]` shape the transcription path's subagents return, and fed into `rulebook/INDEX.md`
identically — the orchestrator's Step 2 synthesis does not need to know which input path
produced the terms it's indexing.

## Aspect Detection (cite, do not recopy)

After the interview is confirmed, detect which aspects apply using the keyword table in
`aspects/index.md` — do not recopy that table here. Scan the Question 2 component answers for
the keywords `aspects/index.md` lists (Dice, PlayingCards, HexGrid, SquareGrid), case-insensitive,
allowing multiple aspects and keyword-absent inference exactly as `aspects/index.md` describes.
Detected aspects feed the component inventory the same way a rulebook's stated components would
in the transcription path — they are not a separate PROJECT.md field, they seed `ASSETS.md`
alongside whatever else Step 2 synthesis records.
