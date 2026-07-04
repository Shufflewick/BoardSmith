# Phase 143: `/bs-build-chunk` — Interpretation & Ask Gate - Research

**Researched:** 2026-07-04
**Domain:** LLM-executed markdown "skill" orchestration (agentic subagent dispatch + state-file protocol), no runtime code beyond a structural drift test
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Skill Growth Across Phases 143-146
- Author the FULL `bs/build-chunk.md` orchestrator in this phase: complete 10-step routing table (state-machine.md already defines all step names/statuses), entry consistency check, conversational-intent routing, session step-group seams and handoff messages, light-path routing
- Steps 4-10 reference files are listed in the orchestrator with an explicit "authored in Phase 144/145/146" marker; the drift test's file-existence check covers only files due by the current phase
- File layout: `src/cli/slash-command/bs/build-chunk.md` + `src/cli/slash-command/bs/build/{investigate,redteam,ask}.md`; the light path lives in the orchestrator (it's routing, not a step)
- New `src/cli/slash-command/bs/build-chunk.test.ts` following the ingest.test.ts pattern

#### Step Semantics
- Resume routing: orchestrator reads SKETCH.md → first non-verified chunk → that CHUNK.md → routes to first incomplete step; awaiting-playtest states re-pose the pending question verbatim as the first move; conversational intents ("what's left?", "do the Chance cards next") route internally to status/insert behavior instead of misbuilding
- Redteam independence: 3 fresh subagents receive raw slice paths + the numbered claims list ONLY — no investigator rationale or framing; 2 refuters prompted "default to refuted if uncertain" + 1 coverage adversary searching the whole rulebook via INDEX for interacting rules the claims omit; max ONE re-investigate round; refuted-twice = ambiguity → escalate to user as a plain-language question with options → ruling recorded in RULINGS.md; vote outcomes never shown raw to the user
- Ask gate fixed 4-part format: (a) rules interpretation in plain game-designer language with citations; (b) ambiguities as concrete questions with options; (c) "what you will NOT see yet" deferred list; (d) zero implementation vocabulary — no engine concepts, no code. House rules/adaptations chosen here go to RULINGS.md. Assets requested here; "I don't have art yet" never blocks (placeholder policy per DESIGN/ASSETS templates); debt recorded in ASSETS.md
- Light path: trivial-tagged chunks run build → test → playtest with the user explicitly told which ceremony is in effect; `approved` is unreachable on the light path (proposed → built, per the Phase 141 state-machine.md fix); playtest performs close's bookkeeping for light chunks (Phase 141 fix)
- Investigate reads: chunk's cited slices + INDEX-discovered slices (search INDEX.md for the chunk's key terms) + RULINGS.md + DECISIONS.md + relevant BoardSmith docs + DESIGN.md for `ui: touches|major` chunks; output is a numbered factual-claims list with citations + explicit visibility declaration ("what is hidden from whom"), newly discovered citations appended to CHUNK.md

#### Verification
- Structural drift test: BUILD-01..04 + BUILD-12 describe blocks, orchestrator↔state-machine.md byte-identical step-name/enum pins, subagent return-shape field-name pins, referenced-file existence limited to current-phase files (pending files asserted to carry the "authored in Phase 14X" marker)
- Behavioral proof deferred to Phase 149's dry-run

### Claude's Discretion
- Exact section ordering, subagent prompt wording, return-shape field names, handoff message copy

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BUILD-01 | Designer can run `/bs-build-chunk` at any time and it resumes at the first incomplete step of the current chunk, including mid-loop and awaiting-playtest states | Architecture Pattern (system diagram, resume routing row of Responsibility Map), Pitfall 5 (session lock 3-way branch), Validation Architecture BUILD-01 row |
| BUILD-02 | Investigate reads cited slices plus INDEX-discovered slices, RULINGS.md, and DECISIONS.md, and produces a claims-list interpretation with a hidden-information visibility declaration | Architecture Patterns 2/3, Don't Hand-Roll (claims-list/visibility-declaration format row), Pitfall 6 (doc-reading list convention), Common Pitfalls Pitfall 7 (append-only claims) |
| BUILD-03 | Redteam runs 3 fresh-context agents (2 refuters + 1 coverage adversary) on the claims list without investigator framing; refuted-twice escalates to the user as a plain-language ruling recorded in RULINGS.md | Architecture Pattern 2 (structured return), Pitfall 1 (framing leakage), Anti-Patterns (fresh-context caveat, vote-mixing), Don't Hand-Roll (redteam escalation + RULINGS.md entry rows), Code Examples (redteam dispatch template) |
| BUILD-04 | The ask gate presents plain game-designer language with citations, ambiguity questions with options, a "what you will NOT see yet" list, and zero implementation vocabulary; assets are requested here with a never-blocking placeholder path | Architecture Pattern 4 (gate-before-write), Pitfall 2 (implementation vocabulary leakage), Don't Hand-Roll (ASSETS.md ledger row), Code Examples (ask gate skeleton) |
| BUILD-12 | Trivial chunks run a light path (build → test → playtest) with the user told which ceremony is in effect | Pitfall 3 (centralize light-path routing in orchestrator, no separate reference file), Recommended Project Structure |
</phase_requirements>

## Summary

Phase 143 authors two things: (1) the **full** `bs/build-chunk.md` orchestrator — all 10 step
names, all session step-group seams, conversational-intent routing, and light-path routing, even
though steps 4-10's *content* is only a forward-reference until Phases 144-146 — and (2) the
first step group's content in `bs/build/{investigate,redteam,ask}.md`. This mirrors exactly the
orchestrator/reference-file split already proven in Phase 142's `ingest-rules.md` +
`ingest/*.md`, and the same drift-test technique in `ingest.test.ts`/`templates.test.ts` extends
to a new `build-chunk.test.ts`. Nothing here is greenfield design — `state-machine.md` (Phase
141, already shipped) is the single source of truth for step names, the status enum, session-lock
protocol, write order, and step-group boundaries; `bs-skills-plan.md` §"/bs-build-chunk" is the
canonical prose spec for what each step does; `CHUNK.template.md` (Phase 141, already shipped) is
the exact file shape investigate/redteam/ask fill. Phase 143's job is almost entirely to **cite**
these, not invent new structure — the same discipline Phase 142 was built and twice review-fixed
to uphold.

The highest-risk area is not the prose — it's context economics and gate-ordering, because Phase
142's review cycles (CR-01/CR-03 in `142-REVIEW-FIX.iter2.md`) found and fixed two class-of-bug
patterns that this phase must not reintroduce: (a) writing gated state (SKETCH.md's real content,
here: CHUNK.md's `Status: approved` line and any RULINGS.md/ASSETS.md entries) before the user has
actually approved, and (b) letting "sectionText"-style full-content fields leak back into the
orchestrator's context when only a subagent's structured summary should flow. Phase 143's
redteam step is exactly this shape: 3 fresh subagents must receive **raw slice paths + the
numbered claims list only** — the orchestrator must not read the slices itself to "double check"
before dispatch, and the investigator's rationale must never travel to the redteamers.

**Primary recommendation:** Follow the ingest-rules.md/ingest/*.md file-layout and prose idiom
byte-for-byte (lean orchestrator that cites reference files; reference files own heavyweight
step prose; every reference path is cited by exact string in the orchestrator so the drift test
can assert cross-file resolution); write `build-chunk.md`'s Steps 4-10 as explicit forward-
reference stubs naming the exact future file path and the phase that authors it; and build
`build-chunk.test.ts` as a structural-content-assertion suite parallel to `ingest.test.ts`,
scoped so BUILD-01..04+12 assertions pass in Phase 143 while BUILD-05..11 assertions either don't
exist yet or assert only the forward-reference stub text.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resume routing / state detection | Orchestrator (`build-chunk.md`) | — | Reads only SKETCH.md + current CHUNK.md's Status line; no subagent needed for routing decisions |
| Conversational-intent routing | Orchestrator (`build-chunk.md`) | — | Must intercept before any step dispatch; a routing concern, not a step |
| Investigate (claims + visibility) | Subagent (`build/investigate.md` dispatch) | Orchestrator records return | Orchestrator never reads rulebook slices/docs itself — same Hard Rule as ingest's transcription |
| Redteam (2 refuters + 1 coverage) | Subagent (`build/redteam.md` dispatch) | Orchestrator records return, escalates to user | Independence requires fresh context with no investigator framing |
| Ask gate | Orchestrator + User | RULINGS.md/ASSETS.md writers | The orchestrator presents; the human is the actual authorizer — a file-state gate, not a conversational one |
| Light-path ceremony notice | Orchestrator (`build-chunk.md`) | — | Routing decision made at proposal time (ingest/insert-chunk), consumed here |
| CHUNK.md / RULINGS.md / ASSETS.md writes | Orchestrator | — | Templates are filled, never restructured; write order and gate timing are orchestrator responsibilities |

## Standard Stack

### Core
No new external packages. This phase is markdown (agent-instruction files) + one new Vitest
test file (`src/cli/slash-command/bs/build-chunk.test.ts`), consuming the already-installed
Vitest toolchain.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 2.x (already configured) | Structural drift-test runner | Repo-wide test framework; `ingest.test.ts`/`templates.test.ts` already use it for this exact markdown-pinning pattern `[VERIFIED: package.json]` |

**Version verification:**
```bash
cat package.json | grep '"vitest"'
```

### Supporting
None — no new runtime dependency, no new devDependency.

### Alternatives Considered
None applicable — this phase authors no code requiring a library choice.

## Package Legitimacy Audit

Not applicable. Phase 143 installs zero external packages (no `npm install` of any kind — it
authors markdown skill files and one `.test.ts` file that imports only `vitest` and Node builtins
already present in the repo, per the established `ingest.test.ts` pattern).

**Packages removed due to slopcheck [SLOP] verdict:** none — no packages evaluated.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
User invokes /bs-build-chunk
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ build-chunk.md (orchestrator, lean — never reads big files)│
│                                                             │
│  1. Consistency check (cite state-machine.md)              │
│  2. Session-lock check + refresh-on-resume                 │
│  3. Conversational-intent probe                             │
│       "what's left?" ──────────────► internal status route │
│       "do X next"    ──────────────► internal insert route │
│       (neither)      ──────────────► continue below        │
│  4. Read SKETCH.md → first non-verified chunk               │
│  5. Read that chunk's CHUNK.md → Status + Step Checklist     │
│  6. Route by Ceremony (full | light) + first incomplete step │
└───────────┬─────────────────────────────────────────────────┘
            │ full ceremony, step ∈ {investigate, redteam, ask}
            ▼
┌────────────────────────┐   claims list    ┌───────────────────────┐
│ build/investigate.md   │ ───────────────► │ build/redteam.md      │
│ subagent(s) read:      │  (no rationale/  │ 3 fresh subagents:    │
│  - cited slices         │   framing)       │  2 refuters + 1       │
│  - INDEX-found slices   │                  │  coverage adversary   │
│  - RULINGS.md          │                  │  read: raw slice(s) +  │
│  - DECISIONS.md        │                  │  claims list ONLY      │
│  - relevant docs/       │                  └──────────┬────────────┘
│  - DESIGN.md (ui≠none)  │                              │
└───────────┬─────────────┘                    refuted-once│  refuted-twice
            │ writes                                       ▼            ▼
            ▼                                    re-investigate    escalate to user
   CHUNK.md ## Interpretation                    (max 1 round)      (RULINGS.md entry)
   CHUNK.md ## Visibility Declaration                    │                │
   CHUNK.md ## Newly Discovered Citations                └────────┬───────┘
                                                                    ▼
                                                        ┌───────────────────┐
                                                        │ build/ask.md      │
                                                        │ presents 4-part   │
                                                        │ format to user;   │
                                                        │ requests assets;  │
                                                        │ user approves     │
                                                        └─────────┬─────────┘
                                                                  │ approved
                                                                  ▼
                                              CHUNK.md Status: approved (write LAST)
                                              RULINGS.md / ASSETS.md appended (if any)
                                              Handoff message printed; session ends
                                              (next session starts step group 2: {build,test})
```

### Recommended Project Structure
```
src/cli/slash-command/bs/
├── build-chunk.md              # orchestrator: full 10-step routing table, entry checks,
│                                # conversational intents, light-path routing, session handoff
├── build/
│   ├── investigate.md          # Step 1 reference file (authored this phase)
│   ├── redteam.md               # Step 2 reference file (authored this phase)
│   ├── ask.md                   # Step 3 reference file (authored this phase)
│   ├── build.md                 # forward-reference stub only — "authored in Phase 144"
│   ├── test.md                   # forward-reference stub only — "authored in Phase 144"
│   ├── audit.md                  # forward-reference stub only — "authored in Phase 145"
│   ├── repair.md                 # forward-reference stub only — "authored in Phase 145"
│   ├── playtest.md               # forward-reference stub only — "authored in Phase 146"
│   ├── revise.md                 # forward-reference stub only — "authored in Phase 146"
│   └── close.md                  # forward-reference stub only — "authored in Phase 146"
└── build-chunk.test.ts          # structural drift test, mirrors ingest.test.ts
```

**Discretion flag:** whether Steps 4-10 get a real (even if empty-bodied) `build/*.md` file this
phase, or are only *named* in the orchestrator's routing table with no file yet, is an open
question the CONTEXT.md leaves partially resolved — it says "Steps 4–10 reference files are
listed in the orchestrator with an explicit 'authored in Phase 144/145/146' marker" and "the
drift test's file-existence check covers only files due by the current phase." Read literally,
this means the orchestrator *names* the future paths (so `build-chunk.test.ts` can assert the
routing table cites them) but the files themselves need not exist yet — mirroring how Phase 142's
`ingest-rules.md` cites `templates/DESIGN.template.md` conceptually before that file existed. The
planner should choose: either (a) no stub files, only forward-reference text in the orchestrator's
routing table (simplest, no risk of drift between a stub and its real future content), or (b)
thin stub files containing only the "authored in Phase 14X" marker, which gives the drift test a
concrete existence assertion to skip cleanly. Given Phase 142's precedent of never creating a
file before it has real content (CR-01/CR-05 both fixed premature-file-creation bugs), **(a) is
recommended**: name future paths as plain text in the routing table, not as files.

### Pattern 1: Lean Orchestrator / Fat Reference File
**What:** The top-level skill file (`build-chunk.md`) is a router: state detection, step-group
sequencing, dispatch decisions, and result recording. Heavyweight step-specific prose (subagent
prompt templates, exact presentation formats, escalation logic) lives in per-step reference files
that the orchestrator delegates to by name.
**When to use:** Every `bs-` skill; already proven in `ingest-rules.md` → `ingest/*.md`.
**Example:**
```
Delegate the entire investigate sequence to `build/investigate.md`: dispatching the
claims-list subagent(s), synthesizing INDEX.md search results into the dispatch, and
appending the returned Interpretation/Visibility Declaration/Newly Discovered Citations
sections to this chunk's CHUNK.md.
```
Source: pattern extracted from `src/cli/slash-command/bs/ingest-rules.md` Step 1/2/3 delegation style.

### Pattern 2: Structured-Summary-Only Subagent Return (never full content)
**What:** Every subagent dispatch returns a small, named, structured object — never the raw
text it read or wrote. The orchestrator only ever consumes the returned fields.
**When to use:** investigate's claims-list dispatch, redteam's 3 agents, and (future phases)
audit/design-review agents.
**Example:**
```
// Source: src/cli/slash-command/bs/ingest/transcription.md ("Fan-Out Dispatch")
Return exactly: one { slicePath, sectionSummary, citedTerms[], componentMentions[],
visualEvidence[], variants[] } per section.
```
For investigate, the analogous return shape (Claude's discretion on exact field names, per
CONTEXT.md) should carry at minimum: the claims list itself (or a pointer if written directly to
CHUNK.md by the subagent — see Pattern 3), the visibility declaration text, and any newly
discovered citations. For redteam, each of the 3 agents returns a verdict per claim (e.g.
`{ claimId, verdict: 'stands' | 'refuted', objection? }`) plus (coverage adversary only) any
newly surfaced interacting rules.

### Pattern 3: Subagent Writes State File Directly, Orchestrator Never Re-Reads
**What:** Per the ingest Hard Rule ("the orchestrator never re-reads a slice file after a
subagent writes it"), the safest design for investigate is: the investigate subagent(s) write the
claims list, visibility declaration, and newly-discovered-citations directly into CHUNK.md's
existing sections (append, per the template's append-only rules), and return only a short
summary/pointer for the orchestrator to relay to the user and to redteam.
**When to use:** Any step whose primary output is prose that a subagent authors and that will be
read again by a later subagent (redteam reads the claims list) — writing it once, at the source,
avoids the orchestrator relaying (and thus holding in context) the full text.
**Anti-pattern this avoids:** CR-03 in `142-REVIEW-FIX.iter2.md` ("`sectionText` defeated context
economics") — a prior draft of ingest had a subagent return full transcribed text through the
orchestrator instead of writing it directly; the fix made the subagent the sole writer. Phase 143
should apply the same discipline: investigate subagents write CHUNK.md sections directly (or, if
the harness makes direct multi-subagent writes to one file risky for interleaving, the
orchestrator writes verbatim from a returned claims-list field with no editorializing) — but
under no framing should the orchestrator "clean up" or "reformat" what a subagent produced, since
that reintroduces exactly the framing risk redteam is designed to strip out.

### Pattern 4: Propose-Before-Write / Gate-Before-Write
**What:** Nothing that requires user authorization is ever written to durable state before the
authorization happens. The gate is a real conversational turn; only after the user's explicit
yes does the write occur, and the write itself happens in Status-line-last order (state-machine.md
"Write Order").
**When to use:** The `ask` step's CHUNK.md `Status: approved` transition, and any RULINGS.md
entry for a house-rule/adaptation chosen at `ask`.
**Anti-pattern this avoids:** CR-01 in `142-REVIEW-FIX.iter2.md` ("SKETCH.md written before the
approval gate, then clobbered by a skeleton copy") — ingest's Step 7 was fixed to write files only
once, after Step 6's approval. Phase 143's `ask` step must not write `Status: approved` (or any
RULINGS.md/ASSETS.md entries stemming from the ask conversation) until the user has actually said
yes to the 4-part presentation. Draft/in-progress claims-list and visibility-declaration content
from investigate, by contrast, IS written before `ask` (it's not gated — it's the input `ask`
presents), consistent with investigate/redteam being machine steps that write progressively per
state-machine.md's "every step writes its results to CHUNK.md before the next step starts."

### Pattern 5: Vote Outcomes Never Shown Raw
**What:** Redteam's per-agent verdicts (2 refuters + 1 coverage adversary) are internal signal.
The user only ever sees a plain-language question with options when escalation is triggered —
never a raw vote tally or an agent transcript.
**When to use:** The redteam→ask handoff and the refuted-twice escalation path.
**Example (escalation framing, Claude's discretion on exact wording):**
```
Two independent reviewers disagreed on how "doubles" interacts with jail (claim 7).
Option A: rolling doubles while in jail immediately releases you and you move that roll.
Option B: rolling doubles while in jail counts as your release attempt for the turn but
you do not move until next turn.
Which matches your rulebook's intent, or is this a house-rule choice?
```
This becomes a `RULINGS.md` "### Ruling N" entry per its template's Decision/Citation/Rationale
shape once the user answers.

### Anti-Patterns to Avoid
- **Orchestrator reading rulebook slices "just to double-check":** Explicitly the single most
  tempting mistake per `ingest/transcription.md`'s own warning — the same warning applies
  verbatim to `build/investigate.md` and `build/redteam.md`. Do not add a "let me verify by
  reading the slice myself" step anywhere in the orchestrator.
- **Redteamers inheriting the investigator's conversation:** Defeats the entire purpose of
  independence (state-machine.md "Redteamers and auditors get independent context, always").
  Each of the 3 redteam agents must be a fresh Task-tool dispatch with no inherited context, given
  only slice paths + the numbered claims list text.
  **Fresh-context caveat:** "fresh context" concretely means each redteam agent is spawned as a
  separate Task-tool invocation whose only prompt content is the slice path(s) and the claims
  list text — it must NOT be handed the orchestrator's running conversation, the investigate
  subagent's prompt, or any prior redteam agent's verdict (peer verdicts stay with the
  orchestrator until all 3 return, per Pattern 5). This is a hard constraint on how the Task
  dispatch prompt is composed, not just a policy statement in prose.
- **Silently mixing votes into "majority wins":** The Hard Rules explicitly say parallel
  same-model agents are correlated — treat votes as advisory, human is tiebreaker. "Refuted
  twice" (both refuters agree, or a refuter + coverage adversary flags the same claim) escalates;
  it is never auto-resolved by a vote-counting rule which claims are used.
- **Writing `Status: approved` speculatively "in case the user says yes":** Violates Pattern 4 and
  the general TMPL-02/write-order discipline; a resumed session must never find state that implies
  an authorization that never happened.
- **Restating state-machine.md's step names/enum in `build-chunk.md` prose:** Cite the file by
  name and path per the citation-not-restatement house style; do not re-list the 10 step names or
  the status enum inline beyond what's needed for a routing table's own logic (a routing table
  literally needs the names to route on, which is different from restating the rule's rationale).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session-lock staleness math | A new "is this lock stale" check per skill | Cite `state-machine.md` "Session Lock" (24h rule, same-chunk-resumes-without-warning rule) | Already fully specified; a second implementation risks drifting from ingest's version |
| Consistency check on entry | A build-chunk-specific consistency check | Cite `state-machine.md` "Consistency Check" (applies to every `bs-` entry point verbatim) | It's explicitly "every bs- entry point" — not per-skill logic |
| Status enum / step-name lists | Re-deriving or re-wording the enum/step names | Cite `state-machine.md` "Status Enum"/"Step Names" | Byte-identical pinning across files is a tested invariant (`templates.test.ts`) |
| Claims-list / visibility-declaration format | A new ad hoc investigate output shape | `CHUNK.template.md`'s existing `## Interpretation`/`## Visibility Declaration`/`## Newly Discovered Citations` sections | The template already defines the exact parse contract; investigate fills it, never redesigns it |
| Redteam escalation wording | Free-form escalation logic | Cite `state-machine.md` "Redteam Escalation" (refuted-once → 1 re-investigate round; refuted-twice → user + RULINGS.md) | Exact bound (max 1 round) is a locked decision already |
| RULINGS.md entry shape | A new ruling-record format for redteam escalations | `RULINGS.template.md`'s `### Ruling N` (Decision / Citation interpreted or overridden / Rationale) | Already the shared shape used by both ask-gate house-rules and redteam escalations |
| Asset-request bookkeeping | A build-chunk-specific asset tracker | `ASSETS.template.md`'s existing 5-column ledger (needed-by-chunk / requested / received / placeholder-in-use / file path) | Ask step appends a row per requested asset; ledger shape is fixed by TMPL-02 parse contract |

**Key insight:** Nearly everything Phase 143 needs already has a canonical shape shipped in
Phase 141/142. The actual design work in this phase is orchestration prose (dispatch templates,
routing logic, presentation copy) — not new data structures.

## Runtime State Inventory

Not applicable — Phase 143 is a greenfield authoring phase (new markdown files + one new test
file), not a rename/refactor/migration. No existing runtime state to inventory.

## Common Pitfalls

### Pitfall 1: Redteam claims list arrives with investigator framing attached
**What goes wrong:** If the orchestrator relays the claims list to redteam agents wrapped in its
own summary ("the investigator found these 7 claims and is fairly confident about most of
them..."), the framing smuggles a conclusion and defeats independence.
**Why it happens:** Natural instinct to add context/reassurance when dispatching a subagent.
**How to avoid:** The redteam dispatch prompt template should be near-verbatim: slice path(s) +
the numbered claims list text, nothing else. No adjectives about confidence, no mention of who
wrote it or how.
**Warning signs:** The dispatch prompt template contains words like "the investigator believes,"
"likely correct," "should mostly hold up."

### Pitfall 2: Ask gate slips implementation vocabulary into the presentation
**What goes wrong:** BUILD-04 requires zero implementation vocabulary in the ask gate; a natural
drafting mistake is to describe claims in terms of "this action," "this flow," "the element
tree" — engine concepts the plain-language format explicitly forbids.
**Why it happens:** The investigate/redteam steps necessarily produce citations tied to rulebook
language, but a careless ask-step author reaches for engine vocabulary when summarizing "what
will be built."
**How to avoid:** The ask.md reference file's presentation template should use only game-designer
language throughout its own example text (rent, turn, hand, board) and explicitly warn against
terms like "action," "flow," "state," "element" appearing in the user-facing message body.
**Warning signs:** Draft copy in `ask.md`'s example presentation contains words from BoardSmith's
own API vocabulary (`docs/core-concepts.md`, `docs/actions-and-flow.md` terminology).

### Pitfall 3: Light-path routing duplicated instead of centralized
**What goes wrong:** CONTEXT.md is explicit that "the light path lives in the orchestrator (it's
routing, not a step)." A tempting mistake is to also give the light path its own `build/light.md`
reference file, duplicating routing logic that belongs in one place.
**Why it happens:** Every other step gets a reference file, so it feels consistent to give the
light path one too.
**How to avoid:** Keep light-path logic (ceremony-tag detection at proposal time, the 3-item
checklist substitution already defined in CHUNK.template.md, the `proposed→built` transition
skipping `approved`) entirely inside `build-chunk.md`'s routing table. No `build/light.md` file.

### Pitfall 4: Forward-reference stubs for Steps 4-10 drift from their eventual real names
**What goes wrong:** If `build-chunk.md`'s routing table names files (e.g. `build/build.md`,
`build/test.md`) before Phase 144 authors them, and Phase 144 chooses different filenames, the
drift test written now would need editing later anyway, and any hardcoded path could silently
become wrong.
**Why it happens:** Naming things early feels helpful, but locks in a decision two phases away
from being executed.
**How to avoid:** Use the exact paths already implied by CONTEXT.md's own File layout decision
(`bs/build/{build,test,audit,repair,playtest,revise,close}.md`) — this is already locked in
CONTEXT.md, not left open. Cite these exact paths in the routing table's forward-reference text,
and mark each with the literal phrase "authored in Phase 144/145/146" so a reader — and the
drift test — can distinguish "not yet built, expected" from "missing, broken."

### Pitfall 5: Session lock not refreshed on legitimate resume
**What goes wrong:** If `build-chunk.md`'s entry logic treats every existing lock as either
"stale (>24h, clear it)" or "live conflict (warn)," a same-chunk same-session resume (the normal
case: a user runs `/bs-build-chunk` again to continue where they left off) gets incorrectly
warned about a "concurrent session."
**Why it happens:** The three-way distinction (stale / same-chunk-resume / different-live-lock)
is easy to collapse into a binary check.
**How to avoid:** Implement all three branches from `state-machine.md` "Session Lock" literally:
a lock naming the same chunk being resumed is refreshed silently (new timestamp, no warning); a
lock <24h old naming *different* work warns; a lock >24h old (any chunk) is reported as stale and
the user confirms clearing it.
**Warning signs:** The routing table's lock-check step has only two outcomes instead of three.

### Pitfall 6: Investigate's doc-reading list re-invents rather than reuses the established convention
**What goes wrong:** BUILD-02 requires investigate to read "relevant BoardSmith docs." The
now-deleted `instructions.md` (old `/design-game` skill) had a "Required Reading" list; Phase 142's
`ingest/scaffold.md` already carries the surviving version of this list forward and explicitly
states: *"this file does not restate the docs' content; `/bs-build-chunk`'s own `investigate` step
owns the full required-reading discipline for chunk work."* A pitfall is either re-deriving a
different doc list from scratch, or failing to cite `docs/*` by exact filename (breaking the
"cite the docs' own names" discipline scaffold.md establishes).
**Why it happens:** The doc list lives in a slightly non-obvious place (a "Required Reading
Pointer" subsection of `ingest/scaffold.md`, not a dedicated file) and its handoff note is easy to
miss without reading that file's tail.
**How to avoid:** `build/investigate.md` should cite the exact same doc set scaffold.md already
names — `docs/core-concepts.md` and `docs/common-pitfalls.md` always; `docs/actions-and-flow.md`
when the chunk involves actions; `docs/custom-ui-guide.md` + `docs/ui-components.md` for
`ui: touches|major` chunks; `docs/dice-and-scoring.md` for dice-mechanic chunks — and add
`DESIGN.md` (per BUILD-02/CONTEXT.md) for `ui: touches|major` chunks specifically, since DESIGN.md
doesn't exist until the first UI chunk's ask and scaffold.md predates that file's existence.
**Verification:** `[VERIFIED: filesystem]` — confirmed all 6 doc filenames exist under `docs/`
(`ls docs/ | grep -E "core-concepts|common-pitfalls|actions-and-flow|custom-ui-guide|ui-components|dice-and-scoring"` — all six present).

### Pitfall 7: CHUNK.md `## Interpretation` claim numbering renumbered instead of appended
**What goes wrong:** The template explicitly says "Append new claims as investigate discovers
them; never renumber existing claims." A redteam-triggered re-investigate round could tempt a
rewrite of the whole numbered list to keep it "clean."
**Why it happens:** Renumbering feels tidier than leaving gaps or re-ordering awkwardly appended
claims.
**How to avoid:** Re-investigate rounds append new claims (or amend a specific claim's text
in-place while keeping its number, if state-machine.md's append-only philosophy is read to allow
correction-in-place for factual accuracy — CONTEXT.md and CHUNK.template.md don't fully
disambiguate "append a new claim" vs. "amend claim N's text"; flagged in Open Questions below) —
they never renumber the list.

## Code Examples

### Redteam dispatch prompt template (structure only — Claude's discretion on exact wording)
```
// Source: adapted from src/cli/slash-command/bs/ingest/transcription.md's Fan-Out Dispatch
// idiom (fresh Task-tool subagent, self-contained prompt, structured return only)

[Refuter agent, ×2 — identical prompt, independent dispatch]
You are reviewing a rules interpretation for {gameName}, chunk "{slug}". Read the following
rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project (rulings outrank the
rulebook — see state-machine.md "Rulings Outrank Rulebook").

Here is a numbered list of factual claims. For each claim, decide: does the cited slice (plus
RULINGS.md) support this claim as written? Default to REFUTED if you are uncertain — do not
give claims the benefit of the doubt.

{numberedClaimsList}

Return exactly: [{ claimNumber, verdict: 'stands' | 'refuted', objection (if refuted) }, ...]

[Coverage adversary — separate prompt, independent dispatch]
You are reviewing a rules interpretation for {gameName}, chunk "{slug}" for COMPLETENESS, not
correctness of what's there. Read rulebook/INDEX.md and search for rules that interact with this
chunk's topic but are NOT cited by any of the claims below. Also read RULINGS.md.

{numberedClaimsList}

Return exactly: { missingInteractions: [{ ruleDescription, citation }, ...] }
```

### Ask gate 4-part presentation skeleton (Claude's discretion on exact copy)
```
// Source: bs-skills-plan.md §"/bs-build-chunk" step 3 (canonical spec, cite don't restate),
// CHUNK.template.md's Interpretation/Visibility Declaration sections as input.

(a) Rules interpretation, plain language + citations:
    "When you land on an owned property, you pay rent equal to the amount shown on its
    card (p.6, 'Rent'). If it's mortgaged, no rent is owed (p.9, 'Mortgages')."

(b) Ambiguities as concrete questions with options:
    "The rulebook doesn't say what happens if you can't afford rent and have no
    mortgageable property. Option A: you go bankrupt immediately. Option B: you may sell
    buildings first. Which do you want?"

(c) What you will NOT see yet:
    "This chunk does not yet include: trading with other players, building houses/hotels,
    or the auction rule for declined purchases."

(d) [zero implementation vocabulary anywhere above — no "action", "flow", "element", "state"]

Assets needed for this chunk: {assetList}. ("Don't have art yet? No problem — a placeholder
that matches the final layout will be used; see ASSETS.md for what's tracked.")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `/design-game`'s single-pass whole-rulebook interview (`instructions.md`, 3,072 lines) | Chunked incremental build with fresh-context investigate/redteam/ask per chunk | This milestone (v4.6), replaces `/design-game` entirely per repo's no-backward-compat rule | Context economics: no single session ever holds a whole rulebook or a whole game's implementation; correctness improves via independent adversarial review before the human ever sees a proposal |
| Ad hoc doc-reading suggestions scattered through `instructions.md`'s 1,000+ lines | A single "Required Reading Pointer" in `ingest/scaffold.md`, explicitly handed off to `/bs-build-chunk`'s investigate step as its permanent home | Phase 142 (2026-07-04) | Phase 143's `build/investigate.md` is the durable owner of doc-reading discipline going forward — `instructions.md` is deleted when bs- skills ship |

**Deprecated/outdated:** `src/cli/slash-command/instructions.md` and
`src/cli/slash-command/design-game.template.md` are slated for removal when the bs- skills ship
(Phase 148, installer wiring) — Phase 143 should not extend or reference them as ongoing
authority, only mine them for reusable prose where `bs-skills-plan.md` already says so (the
doc-reading list, the interview question sequence — already carried forward by Phase 142).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact subagent return-shape field names for investigate/redteam (e.g. `claimVerdicts[]`, `missingInteractions[]`) are inventable this phase — CONTEXT.md explicitly leaves "return-shape field names" to Claude's discretion | Code Examples, Architecture Pattern 2 | Low — CONTEXT.md explicitly delegates this; only risk is inconsistency with Phase 144+'s eventual audit-agent return shape, which should reuse the same naming convention |
| A2 | Whether Steps 4-10 get placeholder files or are only named in the orchestrator's routing table (no file created yet) — recommended (a) no-stub-files based on Phase 142's premature-file-creation review fixes, but CONTEXT.md doesn't fully disambiguate | Recommended Project Structure | Medium — if the planner chooses stub files instead and Phase 144 needs a different structure, a small rework is needed; if no-stub-files is chosen and Phase 144 expects an existing file to extend rather than create, a minor adjustment is needed. Either choice is recoverable at Phase 144's start. |
| A3 | Claim-list "amend claim N in place" vs. "append new claim" ambiguity during a re-investigate round (Pitfall 7) is unresolved by CHUNK.template.md and CONTEXT.md | Common Pitfalls (Pitfall 7) | Low-Medium — affects whether a re-investigate round after one refutation edits existing text or only appends; get user/planner confirmation before locking the exact re-investigate write behavior in `build/redteam.md`/`build/investigate.md` |

## Open Questions (RESOLVED — Q1 in Plan 03: append-with-supersession; Q2 in Plan 02: style-guide examples)

1. **Does a re-investigate round (redteam refuted-once path) amend the existing numbered claim
   or append a new one?**
   - What we know: CHUNK.template.md says "Append new claims as investigate discovers them; never
     renumber existing claims" — this reads as being about *ordering*, not about whether an
     existing claim's *text* can be corrected after refutation.
   - What's unclear: If claim 7 is refuted with a specific objection and re-investigate concludes
     the objection was valid, does the write (a) edit claim 7's text in place (keeping its
     number), (b) append a new claim 8 that supersedes claim 7 with a note, or (c) something else?
   - Recommendation: Treat this as a Claude's-discretion implementation detail the planner should
     resolve explicitly in `build/investigate.md`'s re-investigate-round prose — recommend option
     (b) (append, note supersession) for consistency with the Revision Rounds and Findings Ledger
     sections' explicit append-only philosophy elsewhere in the same template, but flag this as a
     planner decision rather than researched fact.

2. **Exact wording of the "one-line plain-language progress" narration during investigate/redteam
   dispatch** (bs-skills-plan.md: "double-checking my reading of the trading rules").
   - What we know: The style/tone is specified by example; the exact per-step lines are not.
   - What's unclear: Whether `build-chunk.md` should hardcode example progress lines per step, or
     leave them fully improvised at execution time.
   - Recommendation: `build-chunk.md` should give 1-2 example lines per step group (already
     modeled once in bs-skills-plan.md) as a style guide, not a script — consistent with how
     `ingest/transcription.md` gives one example confirmation prompt ("Here's what I read on
     pages...") rather than scripting every possible line.

## Environment Availability

Skip condition applies — this phase has no external tool/service/runtime dependency beyond the
already-configured repo toolchain (Node, TypeScript, Vitest), all of which are already verified
present by Phase 141/142's own environment audits and are unchanged here.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (already configured) `[VERIFIED: package.json]` |
| Config file | `vitest.config.ts` (no changes — `src/**/*.test.ts` glob covers the new file) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BUILD-01 | Resume routing (first incomplete step, awaiting-playtest re-pose, conversational intents) | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-01"` | ❌ Wave 0 |
| BUILD-02 | Investigate reads cited+INDEX slices, RULINGS.md, DECISIONS.md, docs, DESIGN.md (ui≠none); produces claims list + visibility declaration | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-02"` | ❌ Wave 0 |
| BUILD-03 | Redteam: 3 fresh agents (2 refuters + 1 coverage), no framing, refuted-twice → user + RULINGS.md, max 1 re-investigate round | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-03"` | ❌ Wave 0 |
| BUILD-04 | Ask gate 4-part format, zero implementation vocabulary, assets never-blocking | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-04"` | ❌ Wave 0 |
| BUILD-12 | Light path (build→test→playtest) with explicit ceremony notice | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-12"` | ❌ Wave 0 |

Cross-file consistency (mirrors `ingest.test.ts`'s pattern): every path `build-chunk.md` and
`bs/build/{investigate,redteam,ask}.md` reference must exist on disk (state-machine.md,
templates/CHUNK.template.md, templates/RULINGS.template.md, templates/ASSETS.template.md,
aspects/index.md if cited). Byte-identical pins recommended:
- The 10-step full-ceremony list and 3-step light-path list (from state-machine.md), quoted
  verbatim in `build-chunk.md`'s routing table.
- The status enum values, especially `approved` and the light-path unreachability note.
- `SKETCH_LEVEL_MARKER`-style em-dash markers if any are quoted (none expected for this phase
  specifically — that marker belongs to SKETCH.md/ingest).
- Return-shape field names once chosen (investigate's claims-list field name(s), redteam's
  verdict field names) — pinned across `build-chunk.md` (consumer) and `build/*.md` (producer),
  same technique as `RETURN_SHAPE_FIELDS` in `ingest.test.ts`.

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/slash-command/bs/build-chunk.test.ts` — new structural drift test covering
      BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-12 + cross-file consistency (mirrors
      `ingest.test.ts`'s per-requirement `describe` block pattern and its
      `REFERENCED_PATHS`/`RETURN_SHAPE_FIELDS` pinning technique)
- [ ] No new fixtures or framework installs — same vitest + `readFileSync` pattern as
      `ingest.test.ts`/`templates.test.ts`

*(No manual-only verifications beyond the standing note that a full behavioral dry-run of the
skill is deferred to Phase 149, per CONTEXT.md's Verification section and consistent with
142-VALIDATION.md's "Full ingest run... Manual-Only" precedent.)*

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full build-chunk dry run (resume → investigate → redteam → ask → approved) | BUILD-01..04, BUILD-12 | Skill is LLM-executed; no harness runs it in CI | Phase 149 end-to-end dry-run against a reference chunk (per CONTEXT.md: "Behavioral proof deferred to Phase 149's dry-run") |

## Security Domain

Not applicable to this phase's scope — no auth, session, network, or user-input-parsing surface
is introduced. `security_enforcement` config key is absent from `.planning/config.json`
(defaults enabled), but this phase produces LLM-instruction markdown and a structural test only;
no ASVS category applies to authoring agent-instruction prose. (This is a genuine "no applicable
category" case, not a skipped audit — the skill's actual runtime behavior, e.g. redacting hidden
information from the client, is BoardSmith engine territory already covered elsewhere, not this
phase's surface.)

## Sources

### Primary (HIGH confidence)
- `.planning/phases/143-bs-build-chunk-interpretation-ask-gate/143-CONTEXT.md` — locked decisions for this phase
- `.planning/bs-skills-plan.md` §"/bs-build-chunk" (steps 1-3), §Hard Rules, §UI section — canonical spec
- `src/cli/slash-command/bs/state-machine.md` — full file read; status enum, step names, session lock, write order, consistency check, session handoff seams, redteam escalation, rulings-outrank-rulebook
- `src/cli/slash-command/bs/templates/CHUNK.template.md` — full file read; exact sections investigate/redteam/ask fill, parse contract
- `src/cli/slash-command/bs/templates/RULINGS.template.md` — full file read; ruling entry shape
- `src/cli/slash-command/bs/templates/ASSETS.template.md` — full file read; ledger column shape
- `src/cli/slash-command/bs/templates/SKETCH.template.md` — full file read; UI Strategy / Mandated Chunks sections
- `src/cli/slash-command/bs/ingest-rules.md` — full file read; orchestrator idiom, Installed Location paragraph
- `src/cli/slash-command/bs/ingest/transcription.md` — full file read; fan-out dispatch idiom, structured-return discipline, context-economics Hard Rule wording
- `src/cli/slash-command/bs/ingest/scaffold.md` — Required Reading Pointer section (doc-reading list handoff to investigate)
- `src/cli/slash-command/bs/ingest.test.ts` — full file read; drift-test technique inventory (byte-identical markers, REFERENCED_PATHS, RETURN_SHAPE_FIELDS, existence checks, per-describe requirement blocks)
- `src/cli/slash-command/bs/templates.test.ts` — drift-test pattern header/opening
- `.planning/REQUIREMENTS.md` — BUILD-01..13, UIQ-01..04 exact text + phase assignment table
- `.planning/phases/142-bs-ingest-rules/142-VALIDATION.md` — Validation Architecture precedent this phase's section mirrors
- `.planning/phases/142-bs-ingest-rules/142-REVIEW-FIX.md` and `142-REVIEW-FIX.iter2.md` — CR-01/CR-03 pitfalls (gate-before-write, subagent-writes-not-orchestrator) this phase must not reintroduce
- `src/cli/slash-command/instructions.md` (old `/design-game`, deprecated) — source of the "Required Reading" doc list, confirmed still carried forward by `ingest/scaffold.md`
- Filesystem check: `docs/{core-concepts,common-pitfalls,actions-and-flow,custom-ui-guide,ui-components,dice-and-scoring}.md` all exist

### Secondary (MEDIUM confidence)
None used — all findings traced to primary sources above; no WebSearch was needed since this is
an internal-repo convention-following task, not an external-library research task.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; vitest version confirmed present in package.json
- Architecture: HIGH — every pattern is directly extracted from already-shipped, already-tested Phase 141/142 files (state-machine.md, ingest-rules.md, ingest/*.md, templates)
- Pitfalls: HIGH — sourced from Phase 142's own two rounds of adversarial code review (142-REVIEW-FIX.md, 142-REVIEW-FIX.iter2.md), which caught these exact classes of bug in the sibling skill

**Research date:** 2026-07-04
**Valid until:** Stable — this research depends on internal repo conventions (state-machine.md,
templates) that are locked contracts as of Phase 141/142; re-validate only if state-machine.md or
CHUNK.template.md changes before Phase 143 executes.
</content>
