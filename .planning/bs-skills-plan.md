# BS Skills: Rulebook-Driven Incremental Game Building

**Status:** v2 — revised after 4-lens adversarial review (user-confusion, agent-failure, completeness, UI/a11y/design)
**Date:** 2026-07-04
**Replaces:** `/design-game` (`src/cli/slash-command/instructions.md`, 3,072-line monolithic interview skill)

## Problem

The existing `/design-game` skill conducts a from-scratch interview with the game designer and tries to hold the entire process in one context. Feeding a whole rulebook to an LLM in one pass fails for context-economics reasons: every subsystem comes out ~80% right and nothing is trustworthy. The fix is the same one that makes GSD work: **persistent state files + small fresh-context sessions that each read only a slice**, with a structural human-verification gate between increments.

## Core Philosophy

- Build the **smallest possible testable unit** first (the core event loop), then grow in small vetted increments.
- The **rulebook + the designer's rulings are the composite source of truth**, chunked once with citations; each increment re-reads only its cited slice.
- **Every increment ends with human playtesting in the browser.** Nothing advances without a recorded user verification.
- The human always tests the **most polished artifact**: adversarial machine review happens before the human gate, never after. The human's time is the scarcest resource in the loop.
- It is a **collaboration**: the LLM proposes what to build next from the rulebook; the human approves, redirects, or names the piece themselves. For the designer's own game, **the designer is the final authority on rules** — agents escalate disputes to the human, never to more agents.

## Terminology

| Term | Definition | Cardinality |
|------|-----------|-------------|
| **sketch** | The overall architecture of the game in minimal form: an ordered series of chunks | one per game |
| **chunk** | The smallest possible unit that can be developed within the sketch | many per sketch |
| **plan** | The list of steps to accomplish within a chunk | one per chunk |
| **step** | A checkable unit of work within a plan | many per plan |

Naming note: because `plan`/`step` collide with GSD vocabulary, on-disk files use distinct names (below). Chunk identity is a **stable slug**, not an ordinal — SKETCH.md orders by listing slugs, so reordering never breaks directory references.

## Durable Artifacts (the game project's state)

| File | Contents | Written by |
|------|----------|-----------|
| `SKETCH.md` | Ordered chunk list (by slug) with sketch-level detail, deferred-variants list, ideas backlog, sketch version stamp, session lock note | ingest; updated at close/insert |
| `chunks/<slug>/CHUNK.md` | That chunk's step checklist, interpretation, findings ledger, revision rounds, status — **authoritative for its own status** | build-chunk |
| `rulebook/NN-topic.md` | Canonical text slices of the rulebook with page/section citations | ingest |
| `rulebook/INDEX.md` | Cross-reference index: term → slices mentioning it | ingest |
| `RULINGS.md` | Designer decisions: ambiguity resolutions, house rules, deliberate digital adaptations — each with the rulebook citation it interprets or overrides | any `ask`/`playtest` gate |
| `DECISIONS.md` | Implementation decisions ledger: data model choices, naming, invariants ("money is a number on Player; spaces indexed 0–39 from GO") | build/close |
| `DESIGN.md` | Visual identity contract: chosen direction, `--bsg-*` token overrides, typography, component recipes, placeholder policy, do/don't list | first UI chunk's ask |
| `ASSETS.md` | Component/asset ledger: needed-by-chunk, requested, received, placeholder-in-use, file path | ingest + per-chunk ask |

**State-machine authority rules (hard):**
- `CHUNK.md` owns its chunk's status; `SKETCH.md` holds only the ordered list and derived pointers. On contradiction, CHUNK.md wins; the session logs and repairs the sketch.
- Write order is always CHUNK.md first, SKETCH.md second. Every write must leave the file valid for a cold resume (append-only round entries; `Status:` line updated last).
- The skills ship **literal file templates** (canonical skeletons with exact step names and status enum values). Sessions fill templates, never restructure them. On resume, if a state file doesn't parse against its template, stop and ask the user — never guess.
- Every bs- entry point begins with a **consistency check**: every sketch slug has a directory, every directory has a sketch entry, statuses parse, no stale session lock. Problems are reported and confirmed before proceeding.
- **Rulings outrank the rulebook.** Every agent that reads a rulebook slice (investigate, redteam, audit) also reads `RULINGS.md`; the composite is the source of truth. This is what stops audit agents from "fixing" a house rule back to the printed rule forever.

## The Four Skills

All skills are prefixed `bs-`, verb-first, object-second. All four are state-aware: run the "wrong" one and it detects project state and routes you ("this game is already set up — you're mid-chunk-3 awaiting playtest; run `/bs-build-chunk`"). Every session **ends by printing what to run next time**. `/bs-build-chunk` also recognizes conversational intents ("what's left?", "do the Chance cards next") and routes to status/insert behavior internally instead of misbuilding.

### 1. `/bs-ingest-rules` — start the project

Run once per game. Re-running on an existing project requires explicit confirmation (it is destructive to sketch state).

**Input modes:**
- **Written rulebook** (PDF/images/text): transcribed to canonical text **once**, at ingest, by fan-out subagents (one per page range) — never re-OCR'd downstream. Each section's transcription is confirmed with the user ("here's what I read on page 6 — correct?"). Setup diagrams and embedded component images are described in the slice text and captured into the visual identity survey. Downstream steps never touch the original PDF/images.
- **No rulebook** (unpublished prototype, rules in the designer's head): an explicit **interview fallback** that *produces* the same `rulebook/` files, elicited section by section (components, setup, turn structure, actions, end conditions — reusing the old skill's Phase 2 question sequence). Citations then read "designer statement, ingest session" instead of page numbers. Everything downstream is identical.

**Ingest respects its own context economics:** it fans out subagents per page range to write slice files; the orchestrator synthesizes the sketch from their structured summaries plus the INDEX — it never holds the whole rulebook.

**Outputs:**
- `rulebook/` slices + `INDEX.md` (term → slice cross-reference; this is how later chunks discover rules scattered across sections).
- Rulebook **edition** recorded; variant/optional/advanced rules **tagged out-of-scope-by-default** in the slices and listed in SKETCH.md under "Variants (deferred)" — so redteamers don't refute a correct base-game implementation against a variant rule.
- **Component inventory** with citations and **aspect ratios** (cards, tiles, board proportions — needed for layout-stable placeholders). Asset needs recorded in `ASSETS.md`, NOT requested up front.
- **Visual identity survey** (evidence only, no decision): dominant palette candidates, typography feel, iconography, notes on board/card art. See UI section.
- Min/max **player counts** and per-count setup differences, recorded at sketch level.
- **Project scaffold**: derive display/project/class names (old Phase 1B rules), run `npx boardsmith init`, and verify the empty skeleton compiles and serves before any rules work. Chunk 1 starts from a known-good baseline.
- **`SKETCH.md`** — dependency-ordered chunks. Each chunk records: what it builds, cited rulebook sections, a `ui:` tag (`none | touches | major`), and a human test script. Sketch-level test scripts state **outcomes, not gestures** ("move a pawn one space; the board reflects it" — not "drag the pawn"); the chunk's build step rewrites them in actual interaction terms before playtest.
- The **first chunk is always the core event loop**: the smallest slice where a human can take one action in the browser and see the game respond.
- The sketch **must contain** a game-end/scoring/winner chunk and a **final acceptance chunk**: full game played start→finish in the browser, winner declared, every non-variant rulebook slice cited by at least one closed chunk (coverage check), plus the design-QA/a11y audit (UI section). "Done" is defined for the sketch, not just per chunk.
- The **UI strategy decision** (Custom UI from chunk 1 vs AutoUI-with-scheduled-cutover) — see UI section. Made here, with the user.

**Approval gate:** the sketch is proposed, not imposed. The gate presents estimated chunk count and rough per-chunk wall time (expectation-setting), the user edits, the skill revises, the user approves. Only the next 2–3 chunks are detailed; the tail stays sketch-level and is re-derived as the game takes shape — but every later re-derivation is presented as a **delta at the close gate** ("chunk 9 split into 9a/9b because the auction rules have two phases"), never a silent rewrite.

**Negotiation posture (applies at every gate):** the user's ordering wins unless a hard dependency is violated, in which case the skill names the dependency concretely and proposes the minimal prerequisite.

**Old-skill migration:** ingest detects old `/design-game` artifacts (PROJECT.md/STATE.md/HISTORY.md) and offers a one-time conversion — interview data and Deferred Ideas become sketch chunks; completed features are marked verified with a note that they were verified under the old process.

### 2. `/bs-build-chunk` — build the next smallest unit

Run to start or **resume** a chunk; it reads SKETCH.md → first non-verified chunk → that CHUNK.md → routes to the first incomplete step (including "awaiting playtest feedback," where its first move is to re-pose the pending question). The step sequence:

1. **investigate** — subagents read the chunk's cited slices **plus** any slices found by searching `INDEX.md` for the chunk's key terms (cross-section rules like Monopoly's jail live between slices), plus `RULINGS.md`, `DECISIONS.md`, relevant BoardSmith docs, and (for `ui: touches|major`) `DESIGN.md`. Output: a written interpretation as a **numbered list of factual claims** with citations, an explicit **visibility declaration** ("what is hidden from whom in this slice" — hidden information is the largest correctness class in card games), and any newly discovered citations appended to CHUNK.md.
2. **redteam** — 3 fresh-context adversarial agents. They receive the slice(s) + the claims list **without the investigator's rationale or framing** (framing smuggles the conclusion). Two refuters ("default to refuted if uncertain") and one **coverage adversary** charged with searching the whole rulebook via INDEX for interacting rules the claims omit. Refuted once → re-investigate with the specific objections attached. Refuted twice → that is by definition an ambiguity: **escalate to the user**; the ruling lands in `RULINGS.md`. Max one re-investigate round; disputes go to the human, not to more agents. Vote outcomes are never shown raw to the user — they arrive as plain-language questions with options.
3. **ask** — the user authorizes the design. **Presentation format is specified, not improvised:** (a) the rules interpretation in plain game-designer language with citations ("When you land on an owned property, you pay rent equal to…"); (b) ambiguities as concrete questions with options; (c) a "what you will NOT see yet" list of deferred pieces; (d) **zero implementation vocabulary** — no engine concepts, no code. House rules and adaptations chosen here go to `RULINGS.md`. **Assets** the chunk needs are requested here; "I don't have art yet" never blocks — the placeholder policy (UI section) applies and the debt is recorded in `ASSETS.md`.
4. **build** — the executor reads **(1) the raw rulebook slices and (2) the approved interpretation**, treating the interpretation as design decisions layered on the slice, never a replacement for it (summaries are lossy; the slice is ground truth). Extends the existing code; **restructuring verified code requires a user gate**. Appends data-model/naming decisions to `DECISIONS.md`. Rewrites the chunk's test script in actual interaction terms. Records a per-file manifest in CHUNK.md so a mid-build crash resumes file-by-file, not step-by-step.
5. **test** — automated: `tsc --noEmit`, eslint with the boardsmith plugin (no-timers/no-nondeterminism/no-network — violations silently break replay, undo, and AI later), unit + integration tests, the **full accumulated suite** (regression), a **random-simulation playthrough** (TestGame random sim to a terminal state N times — catches flow deadlocks a 5-minute human playtest never reaches), and for UI chunks the a11y floor checks (UI section).
6. **audit** — fresh-context adversarial agents read the **raw slices + RULINGS.md + the code** (never the interpretation — otherwise interpretation errors are invisible here too) and hunt gaps and misimplementations. Lenses: rulebook fidelity, **visibility/leak diff** (compare two seats' broadcast state for leaked hidden attributes), undo sanity, and for UI chunks the screenshot-armed design lens (UI section). Findings go in a **ledger in CHUNK.md with stable IDs**.
7. **repair** — fix findings; repair may **refute** a finding with citations (recorded in the ledger) instead of changing code. Loop test → audit, but: round N+1 auditors see the ledger and must only report NEW findings; **max 3 audit rounds**, after which remaining findings are triaged with the user (real blocker / defer to a later chunk / auditor wrong).
8. **playtest** — the human gate. The skill gives the user one command to run themselves (`npx boardsmith dev`) and a URL — the user owns the server across the multi-session gap; any server the *skill* starts for its own checks is killed before returning (repo hard rule). The test script is **numbered, click-by-click**, states seat count and per-seat steps, teaches the dev host affordances once (seat selector, second-browser-tab-as-player-2, AI-fill, Follow-active-seat), includes a **build stamp** to confirm before testing (stale-tab/Vite-cache protection), a one-line regression check ("also confirm: pawns still move"), the standing taste line ("anything look off, cramped, or unreadable?"), and — for chunks with hidden info — a **second-seat leak check**. **"Verified" is an explicit checklist** ("you saw all 4 of these things happen"), confirmed item-by-item, not a vibe. A `verified (user-waived)` state exists so skipping is recorded honestly; check-status surfaces accumulated waived chunks and proposes a batch playtest.
9. **revise** — feedback is **triaged with the user, item by item**: (a) this-chunk defect → revise round; (b) future scope → SKETCH.md ideas backlog or `/bs-insert-chunk`; (c) not-built-yet (matches the script's "not yet" list) → expectation reset; (d) rules change → `RULINGS.md`. The chunk closes when (a)-items are done, regardless of (b)-items. Rounds are appended (revise-1, revise-2, …). On re-entry after a revise round, the user gets a **feedback disposition report** — each item they reported, what changed, and a targeted re-test script — never a blind full re-test.
10. **close** — mark verified in CHUNK.md then SKETCH.md, tag/record the verified commit hash, roll up decisions, re-derive the sketch tail against the rulebook and present the **delta** for approval, propose the next chunk with its `ui:` tag.

**Scaled ceremony:** the full 10-step pipeline is for rules-bearing chunks. Chunks tagged trivial at proposal time (e.g. "swap in the real card images") run a light path — build → test → playtest — with the user told which path is in effect. A fixed heavyweight ceremony on every chunk kills adoption by chunk 5.

**During machine steps** the orchestrator emits one-line plain-language progress ("double-checking my reading of the trading rules"), never agent transcripts.

There is deliberately **no separate verify command**: verification is a step state inside the chunk. One entry point, routed by state.

### 3. `/bs-check-status` — where are we?

Reads SKETCH.md + the current CHUNK.md. Reports: chunks done/remaining, current chunk and step, outstanding playtest feedback, waived verifications, outstanding asset debts (from ASSETS.md), ideas backlog size, and the exact command to run next.

### 4. `/bs-insert-chunk` — reshape the sketch

Add, reorder, split, or remove chunks. Must: (a) re-validate dependency order against citations; (b) **diff the new chunk's citations against closed chunks'** and flag overlaps ("chunk `movement` implemented 05-movement.md; your insertion also cites it — that chunk may need a revise round"); (c) mark any already-detailed pending CHUNK.md as `stale — re-derive before build`; (d) bump the sketch version stamp so a concurrently resumed build session detects the sketch changed under it.

## UI, Accessibility, and Visual Quality

This replaces former Open Question 1. Structure: **one-time identity decision, a per-chunk mechanical floor, and one pre-ship design-QA chunk.** Rejected alternatives: a full design pass per chunk (burns context on chunks that touch no UI, and re-decorating every increment destroys user trust) and a late "make it pretty" chunk as the *only* design work (a late restyle changes layout, hit targets, and affordances — it invalidates prior playtest verifications).

**UI strategy decision (at ingest, with the user):** (a) **Custom UI from chunk 1** — default; the playtest artifact is always the real product surface — or (b) AutoUI scaffold with a scheduled custom-UI cutover chunk, which **explicitly flips all previously verified chunks from `verified` back to `built`** and re-opens their test scripts. There is no silent "we'll make it custom later." (Hard state rule, general form: any change that re-styles or re-lays-out previously verified surfaces flips those chunks back to `built`.)

**Visual identity — capture at ingest, decide at the first UI chunk's ask:**
- Ingest produces the evidence (visual identity survey). No decision is made cold.
- The first UI chunk's `ask` is the **design ask**, offering three directions: **(A) Adopt** the physical game's identity — requires the user to supply box art/board photos (with a trade-dress caution if the rulebook is someone else's commercial game); **(B) Derive** — original web design in the physical game's palette/mood, no asset dependence (default recommendation); **(C) Original** — invoke the frontend-design skill to generate 2–3 one-page throwaway HTML mood sketches for the user to pick from.
- The decision is recorded in **`DESIGN.md`**: direction + rationale, the game's `--bsg-*`/`applyTheme()` overrides, typography/spacing, component recipes, placeholder policy, do/don't list. Rule: **color literals live only in the theme block; everything else references tokens** (mirrors BoardSmith's own theme.ts rule, and staying inside the WCAG-pinned Slate tokens inherits AA contrast for free). `DESIGN.md` is to UI chunks what the rulebook slice is to rules chunks: the source of truth investigate and audit read. Changing DESIGN.md is itself a chunk, because it re-opens verified chunks.

**Placeholder policy (build step, all chunks):** components awaiting assets render a *designed* placeholder — correct aspect ratio from the component inventory, styled entirely in DESIGN.md tokens, labeled with the component name. Asset arrival replaces the fill, never the geometry, so swaps are zero-layout-diff and don't invalidate playtests. Placeholders are never hardcoded-color divs; off-system styling at the first gate poisons trust.

**Per-chunk accessibility floor (test/audit, `ui: touches|major` chunks):**
1. **ActionPanel parity as an executable test:** the chunk's test script must be completable using only the ActionPanel with keyboard, verified by an automated keyboard-only run. BoardSmith's parity hard rule (useBoardInteraction shared state) makes the ActionPanel a complete accessible input path for every action — this converts "make it accessible" into pass/fail and doubles as the parity regression test.
2. **axe-core scan** on the rendered board + ActionPanel (decided once at the scaffold-template level as a devDependency of generated games — not per game).
3. **Token discipline grep:** no color literals outside the DESIGN.md theme block; new game-local color pairs get a contrast assertion.
4. **Real controls:** clickable board elements are buttons or carry role/tabindex/keydown; `aria-label` carries game semantics ("7 of Hearts", "e4"); decorative glyphs are `aria-hidden`. The AutoUI renderers' `.a11y.test.ts` files are the copyable pattern and are cited in the skill's reference material.
5. **Focus not stranded** after actions complete (asserted in the keyboard-only run); **`prefers-reduced-motion`** honored on any animation added.

Hidden information is largely solved server-side (`visibleAttributes` redaction means hidden state never reaches the client DOM); the audit checks the game didn't smuggle hidden info into labels of face-down placeholders. Direct arrow-key navigation on custom spatial boards is *recommended*, not required — ActionPanel is the required accessible route.

**Design-review agent (audit step, UI chunks):** one adversarial agent starts the dev server, screenshots the chunk's state at the three Slate breakpoints in both themes (dev-host iframe-shrink for compact), reviews against DESIGN.md + frontend-design craft criteria, diffs against the previous chunk's stored screenshots (`chunks/<slug>/shots/`) to catch cohesion drift, feeds findings into the normal repair loop, and kills the server. Without this, no agent in the lifecycle can fail a chunk for bad UI and "invoke a frontend-design pass" is one-shot generation with no verification — the exact pattern this plan exists to avoid.

**Design-QA chunk (near ship, part of final acceptance):** full screen-reader playthrough (VoiceOver), 200% zoom, compact-breakpoint touch targets, colorblind pass on game-added colors, both Slate themes, drag-drop keyboard alternates end-to-end, mobile layout via iframe-shrink.

**Library prerequisite (BoardSmith work item, ships before the skills):** GameShell's live-region announcer covers only shell events; there is no game-facing announce API. Export a `useAnnouncer()` composable from `boardsmith/ui` writing to GameShell's existing live regions, so the skill can *require* "meaningful state changes announced" per chunk. Without it that requirement is unenforceable.

## Hard Rules (written into the skills as requirements, not suggestions)

### Subagent discipline
- **The orchestrator never reads the big stuff.** Its job: read state files, dispatch subagents, record results, talk to the user. Rulebook slices, BoardSmith docs, and generated code are read by subagents that return conclusions. Exception: `build` runs with the full raw slice (main context or a dedicated executor).
- **Redteamers and auditors get independent context, always** — fresh agents, no inherited conversation, no investigator framing (claims list only), reading the raw sources themselves. An agent that inherits the proposer's context confirms; it does not verify. Parallel same-model agents are correlated — treat votes as advisory signal, not arithmetic truth; the human is the tiebreaker.

### Context management
- Every step writes its results to CHUNK.md **before** the next step starts; every write leaves state cold-resumable.
- Self-assessed "remaining context" is not a real capability. Session budgets are **structural**: a single session runs at most one step group — {investigate + redteam + ask}, {build + test}, {audit + repair}, {playtest + one revise round} — and always hands off at those seams. Additionally, hand off after N subagent dispatches (their returned results are the real context cost). If the harness surfaces a context warning, obey it immediately.
- The handoff message is written for a non-programmer: the literal command to run next time, and the reassurance that everything is saved in the game folder.

### Human gates
- Chunk state machine: `proposed → approved → built → verified` (plus `verified (user-waived)`). Transitions are file states, recorded in CHUNK.md (authoritative) and reflected in SKETCH.md. A resumed session cannot skip a gate because the gate is a file state, not a conversational promise.
- Restyle/cutover rule: changes that alter previously verified surfaces flip those chunks back to `built`.

### Git protocol
- Commit at every step completion, message convention `chunk-<slug>/step-<name>` (revise rounds: `chunk-<slug>/revise-2`). Commit before `build` starts so work-in-progress is always distinguishable from the verified baseline.
- `close` records the verified commit hash in CHUNK.md — the bisect anchor for any later regression, and the diff base for "what changed since the human last said yes."
- A lightweight session lock note in SKETCH.md (chunk + timestamp) is checked on entry; a second concurrent session warns instead of silently clobbering.

## AI Opponents

`/generate-ai` ships from the same directory and installer; the plan must not strand it. Disposition: it becomes **`/bs-generate-ai`** (same naming grammar), invoked as a late sketch chunk (after game-end/scoring exists, since MCTS needs terminal states). It also serves solo playtesting earlier: once basic actions exist, the playtest scripts may use `--ai` seat-fill so one human can exercise a 3–4 player game. `install-claude-command.ts` installs all five skills plus shared reference files.

## Reuse from the Existing Skill

Carried over as shared reference files rather than rewritten: doc-reading lists (which BoardSmith docs per game type), `aspects/` files (dice, hex-grid, playing-cards, square-grid), Phase 5/6 code-gen + verification guidance and common-pitfalls emphasis, Phase 2's interview question sequence (now the no-rulebook ingest fallback), Phase 9's feedback triage categories (now the revise-step triage), Phase 1B naming rules (now the scaffold step).

Per the no-backward-compat rule, `/design-game` is removed when the bs- skills ship; ingest offers the one-time conversion for old-skill projects (see ingest section).

## Distribution

`src/cli/commands/install-claude-command.ts` installs: `bs-ingest-rules`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`, `bs-generate-ai`, the shared reference files (aspects/, doc lists, code-gen guidance, file templates), and removes the design-game template. The install changelog states the old-skill migration path.

## Resolved Former Open Questions

1. **UI cohesion/a11y/visual quality** → the UI section above (one-time identity + per-chunk floor + design-QA chunk).
2. **Ambiguous/contradictory rulebooks** → `RULINGS.md`, required from day one; rulings outrank the rulebook and are read by every rulebook-consuming agent; the redteam escalation path (refuted-twice → user ruling) feeds it.
3. **Multi-player and AI testing in playtest** → test scripts state seat count and per-seat steps; dev host affordances (tabs-as-seats, AI-fill, Follow-active-seat) are taught once in the first playtest script; AI seat-fill available once actions exist; hidden-info chunks include a second-seat leak check.

## Deliberately Rejected Review Suggestions

- **Collapsing to one command:** kept four (plus bs-generate-ai) — but all state-detect and route on entry, `/bs-build-chunk` handles conversational intents, and every session ends by printing the next command. That captures the benefit without hiding capabilities.
- **Full design pass per chunk** and **single late polish pass** — see UI section for the middle path.

## Build Order for the Skills Themselves

1. BoardSmith prerequisite: `useAnnouncer()` composable.
2. File templates (SKETCH/CHUNK/RULINGS/DECISIONS/DESIGN/ASSETS skeletons) — everything else consumes these.
3. `/bs-ingest-rules` (largest new thinking: chunking, INDEX, survey, sketch heuristic, fallback interview, scaffold).
4. `/bs-build-chunk` (the step engine + gates + loops).
5. `/bs-check-status`, `/bs-insert-chunk` (thin readers/editors of the same state).
6. `/bs-generate-ai` rename + installer changes.
7. Dry-run the whole pipeline against a real rulebook (a reference game with a known rulebook — e.g. Hex or Go Fish — so output can be compared against a hand-built implementation) before pointing it at a designer.
