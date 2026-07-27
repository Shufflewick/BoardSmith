# Phase 170: Ingest Contract Upgrade - Research

**Researched:** 2026-07-27
**Domain:** Agent Skill Markdown authoring (BoardSmith `bs-` skill family) — ingest contract
**Confidence:** HIGH (this is entirely in-repo/in-sibling-repo investigation; no external library research needed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Source Archive & Hashing (INGEST-01)**
- Standard archive path is `rulebook/source/<original-filename>`. Provenance lives next to the
  slices it produced, so there is exactly one directory to look in.
- Ingest copies the source file into the project rather than recording an external path. A path
  outside the project breaks the moment the designer moves or renames the rulebook; a later verify
  pass must be able to re-read the exact bytes it transcribed from.
- Hash is SHA-256 over the raw file bytes, recorded as a `Source hash:` line in the
  `rulebook/INDEX.md` header block — designer-readable, and a single source of truth (no separate
  manifest file to drift).
- Non-destructive for existing root copies. When the source already sits at the project root
  (as `seven/rules.pdf` does), ingest copies it into `rulebook/source/` and leaves the original
  untouched. Ingest never moves or deletes a designer's file.

**Transcription Split & INDEX Contract (INGEST-02/03/04)**
- The `Derived` vs `Visual` boundary is a stated one-line decision test, not a category
  enumeration and not left to subagent judgment: `Derived (p.N):` is a rule-bearing inference —
  one that affects legality, scoring, or sequencing. `Visual (p.N):` is diagram, art, layout, or
  typography description. `transcription.md` states the test plus two worked examples (one of each).
- `00-visual-survey.md` survives as a slice. It is the durable handoff to the first `ui:` chunk
  and must keep existing. The new `Visual (p.N):` prefix is the inline marker used inside rule
  slices where a diagram or art note sits mid-rule — the two are complementary, not a replacement.
- `## Open Rules Gaps` is populated from the existing `Named-but-undefined (p.N):` markers,
  swept out of the returned slices at scaffold time into INDEX.md. The section is written
  always — when there are no gaps it reads `_None._`, so its absence is a defect rather than an
  ambiguity.
- INDEX.md header is a fixed prose block, always emitted, never omitted: `Edition:`, `Source:`
  (the archived `rulebook/source/...` path), `Source hash:`, `Transcribed:` (ISO date). When a value
  is genuinely unknown, the line is still written with an explicit `not stated in the rulebook`
  value. Prose lines rather than YAML frontmatter, matching the existing INDEX.md style a designer
  already reads.

**Proof & Regression Discipline (PROC-01/02)**
- "A real ingest run" means a fresh `/bs-ingest-rules` into a throwaway project directory, using
  `~/BoardSmithGames/seven/rules.pdf` as the source. Real PDF, real transcription subagents, zero
  mutation of the reference game.
- Regression tests extend `src/cli/slash-command/bs/ingest.test.ts` with skill-text contract
  assertions, plus a new artifact-shape test asserting the INDEX.md header block and
  `## Open Rules Gaps` structure.
- CI asserts the skill-text contract and a checked-in golden INDEX.md fixture — not live LLM
  output. The live PDF ingest run is this phase's manual proof and is recorded in the phase
  SUMMARY.
- `seven` is the reference game for this phase (2-page PDF, fast to re-ingest, already exercises
  the visual survey and 20+ rulings). `one-two-punch` is reserved for later phases.

### Claude's Discretion
- Exact wording of the skill-text edits, the two worked examples in `transcription.md`, and the
  internal structure of the new tests.
- Whether the hash is computed by a small helper in the skill flow or by a documented shell
  invocation (`shasum -a 256`) — whichever is more reliably reproducible from the skill text.

### Deferred Ideas (OUT OF SCOPE)
- Making `Named-but-undefined` marking itself more reliable (a completeness check on gap detection)
  — a real weakness, but it is a transcription-quality problem rather than a contract problem, and
  belongs in its own phase.
- Backfilling `rulebook/source/` and the header block into already-built games — explicitly out of
  scope for v4.9 per REQUIREMENTS.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-01 | Every skill change is proven against a real bs-built game (seven or one-two-punch), not only against the skill text | See "Code Examples — Local dev-loop install command" and Validation Architecture; `~/BoardSmithGames/seven/rules.pdf` confirmed present (2,194,346 bytes, PDF v1.3, 2 pages), `npx boardsmith claude --local` confirmed as the non-destructive dev-loop install path |
| PROC-02 | Fix → write tests → adversarially verify → only then close | See Validation Architecture Phase Requirements → Test Map; existing `ingest.test.ts` idiom (grep-style skill-text contract assertions) is the established test-writing pattern to extend |
| INGEST-01 | Ingest archives the source rulebook at a standard path and records its SHA-256 hash | See Architecture Patterns "Ingest Flow Call Map" and Common Pitfalls Pitfall 1 — identifies the correct landing point (`ingest-rules.md` Step 3, not `scaffold.md`) and provides a verified `shasum -a 256` invocation + real hash value for `seven/rules.pdf` |
| INGEST-02 | Transcription emits `Visual (p.N):` distinct from `Derived (p.N):` | See "Ingest Flow Call Map" edit-site table and Common Pitfalls Pitfall 4 — pinpoints the exact current definition site (`transcription.md:43-51`) and empirically verifies the 8/12 one-two-punch overloading claim from REQUIREMENTS.md |
| INGEST-03 | `rulebook/INDEX.md` carries a standardized `## Open Rules Gaps` section | See Common Pitfalls Pitfall 2 (missing `openGaps[]` return-field transport) and Pitfall 3 (no fixed header text exists yet — two live variants found) |
| INGEST-04 | A designer can tell edition/source-file/date from INDEX.md alone | See "Ingest Flow Call Map" edit-site table (extends the existing Edition-line synthesis at `ingest-rules.md:105-108`) |
</phase_requirements>

## Summary

This phase edits **Markdown skill text**, not TypeScript — `src/cli/slash-command/bs/ingest-rules.md`
and its `bs/ingest/*.md` reference files are instructions consumed by an LLM agent, never parsed by
runtime code (except the drift-protection assertions in `ingest.test.ts`, which grep-match exact
strings). All four INGEST edits land in two files: `transcription.md` (the `Derived`/`Visual` split,
INGEST-02) and a combination of `ingest-rules.md` Step 3 + a to-be-decided location for source
archiving/hashing and the INDEX.md header (INGEST-01/03/04). A genuine sequencing subtlety was found
during research (see "Common Pitfalls" — Pitfall 1): `scaffold.md` runs at **Step 1**, before the
designer has even been asked whether a rulebook exists, so it cannot be the place that archives the
source PDF — the rulebook path isn't known until Step 2. The archiving+hashing operation belongs at
Step 2/3 (once `{rulebookPath}` is bound) or as a small new sub-step of `ingest-rules.md`'s own Step
3 Synthesis, not inside `scaffold.md` itself.

A second load-bearing gap was found: the `Named-but-undefined` marker currently has **no
corresponding return-shape field** in the transcription subagent's structured summary
(`slicePath, sectionSummary, citedTerms[], componentMentions[], visualEvidence[], variants[]`).
The orchestrator never re-reads slices (Context-Economics Hard Rule, stated three times across
`ingest-rules.md` and `transcription.md`), so a `## Open Rules Gaps` section built "from the
markers" must be built from a **new returned list** (e.g. `openGaps[]`), not from a sweep of the
slice files themselves — the CONTEXT.md phrase "swept out of the returned slices" needs this
concrete implementation to actually respect the existing Context-Economics rule.

The reference-game empirical check requested by the milestone REQUIREMENTS.md — "8 of 12 Derived
lines in one-two-punch are visual/art, not rule-bearing" — was independently re-verified against the
actual slice files and **confirmed correct**: 12 `Derived (p.N):` lines exist across
`01-setup-and-round-structure.md` and `02-action-cards-and-resolution.md`; 8 are diagram/icon/art
descriptions, 3 are genuine rule-bearing inferences (component counts, an implied rule), and 1 is a
meta "no variants marked" statement. This confirms the overloading problem INGEST-02 exists to fix.

`seven`'s current `INDEX.md` (proof target) already has an informal, hand-evolved `## Open Rules
Gaps`-shaped section titled `## Open Rules Gaps (named-but-undefined in the source)` with 4 numbered
entries — this phase's job is to standardize that shape (fixed header name/format) and make it
**always emitted** (even when empty), plus add the new header prose block
(`Edition:`/`Source:`/`Source hash:`/`Transcribed:`) that doesn't exist yet in either reference
game's `INDEX.md`.

No package installs are needed for this phase (it edits Markdown + extends an existing `.test.ts`
file with no new npm dependencies) — the Package Legitimacy Audit section is therefore N/A.

**Primary recommendation:** Land the `Derived`/`Visual` split and the `Named-but-undefined` →
`openGaps[]` return-field addition in `transcription.md`; add a **new, explicit ingest step** (Step
2.5, "Archive Source & Header," or fold into Step 3 Synthesis) in `ingest-rules.md` that copies the
source file to `rulebook/source/<filename>` and computes its SHA-256 via a documented `shasum -a 256`
invocation — do NOT try to force this into `scaffold.md`, which runs too early in the flow. Extend
`ingest.test.ts` with the same per-requirement-ID `describe` block idiom already used by
INGEST-01..07, plus one artifact-shape test with a checked-in golden `INDEX.md` fixture (per
CONTEXT.md's locked CI-determinism decision). Prove all of it with one real `/bs-ingest-rules` run
against `~/BoardSmithGames/seven/rules.pdf` in a throwaway directory, driven via a **local skill
install** (`npx boardsmith claude --local`) so the global `~/.claude/skills/` tree is never touched
mid-development.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Source archive + SHA-256 hash (INGEST-01) | Skill Markdown (orchestrator step) | CLI filesystem (`cp`, `shasum`) invoked via skill-prescribed shell commands | No runtime code owns this — it's an LLM-followed instruction sequence, but the actual bytes-copy and hash computation are deterministic shell operations, not agent judgment |
| `Derived`/`Visual` line-prefix split (INGEST-02) | Skill Markdown (transcription subagent prompt) | — | Purely a transcription-time textual convention; no code parses slice files at runtime |
| `## Open Rules Gaps` section (INGEST-03) | Skill Markdown (orchestrator Step 3 synthesis) | Transcription subagent return shape (`openGaps[]`, new field) | Orchestrator assembles INDEX.md exclusively from returned summary fields (Context-Economics Hard Rule) — the gap list must arrive as a return field, not via a slice re-read |
| INDEX.md header block (INGEST-04) | Skill Markdown (orchestrator Step 3 synthesis) | — | Same synthesis step that already writes the Edition line; extends the same prose block |
| Regression tests (PROC-02) | Vitest (`ingest.test.ts`) | — | Existing grep-style drift-protection idiom; CI-safe (string assertions only, no LLM invocation) |
| Real ingest proof run (PROC-01) | Manual operator + Claude Code session | Local skill install (`npx boardsmith claude --local`) | Not automatable in CI; recorded in phase SUMMARY per CONTEXT.md |
| Installer reachability | CLI (`install-claude-command.ts`) | — | New files under `bs/ingest/` are picked up automatically by the existing recursive `fs.cp` of the whole `ingest` dir — confirmed, see Pitfall 5 |

## Standard Stack

Not applicable — this phase adds zero new dependencies. All work is Markdown editing plus a Vitest
extension using patterns already present in the repo (`node:fs`, `node:path`, `node:url`, `vitest`,
all already installed).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `shasum -a 256 <file>` shell invocation prescribed in skill text | A Node helper script the skill instructs the agent to run (`node scripts/hash-file.js`) | A shell one-liner needs no new file and matches the existing house style (scaffold.md already prescribes raw `tsc`/`npx boardsmith dev` shell commands for the agent to run) — no other bs- skill ships a bespoke Node helper for a single deterministic operation. `shasum -a 256` is preinstalled on macOS/Linux; `sha256sum` is the Linux-native equivalent name — the skill text should show both or a `command -v shasum \|\| sha256sum` style fallback if cross-platform reliability matters (BoardSmith dev machines are macOS per `env`, but designers may be on Linux/CI). |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File content hashing | A bespoke JS hash function or a hand-rolled checksum in skill prose | The standard `shasum -a 256` / `sha256sum` CLI (already on every dev machine; Node's `crypto.createHash('sha256')` is the code-side equivalent if this were ever wired into `scaffold.ts`, but it isn't — this is agent-followed shell text) | SHA-256 is a well-known, already-available primitive; inventing anything here is pure risk for zero benefit |
| Golden-fixture comparison for INDEX.md shape | A custom markdown-section parser | Plain string/regex assertions matching the existing `ingest.test.ts` / `templates.test.ts` idiom (`toContain`, `toMatch`) | The whole `bs-` test suite deliberately treats skill Markdown as opaque text with pinned substrings — introducing a markdown AST parser here would be the only place in the codebase doing so, adding an unjustified dependency for a benefit (structural parsing) the existing idiom doesn't need |

**Key insight:** Every existing `bs/*.test.ts` file treats Markdown skill text as a string-matching
target, never as parsed structure. This phase's new tests must follow the same idiom exactly — no
new abstraction, no new dependency.

## Architecture Patterns

### Ingest Flow Call Map (file:line anchors)

```
ingest-rules.md (orchestrator)
│
├─ Step 0 (State Detection)                                    [ingest-rules.md:26-68]
│
├─ Step 1 (Scaffold + Verify) ─────────► delegates to scaffold.md [ingest-rules.md:70-81]
│     scaffold.md: name derivation, `npx boardsmith init <name>`,
│     tsc --noEmit, `npx boardsmith dev --no-open` serve-check, kill.
│     ⚠ Runs BEFORE the designer is asked whether a rulebook exists —
│       source file path is NOT yet known here. [scaffold.md:1-136]
│
├─ Step 2 (Route to Transcription or Interview Fallback)        [ingest-rules.md:83-96]
│     Asks "does the designer have a written rulebook?"
│     → dispatches fan-out subagents per transcription.md        [transcription.md:20-77]
│         Each subagent: reads {rulebookPath} + page range {N}-{M},
│         WRITES rulebook/NN-topic.md itself (orchestrator never
│         re-reads it — Context-Economics Hard Rule, restated
│         [transcription.md:9-18] and [ingest-rules.md:18-24]),
│         RETURNS { slicePath, sectionSummary, citedTerms[],
│         componentMentions[], visualEvidence[], variants[] }
│         [transcription.md:56-77].
│     → OR interview-fallback.md (no rulebook) — same rulebook/ shape.
│
├─ Step 3 (Synthesis) — orchestrator-only, writes:                [ingest-rules.md:98-134]
│     1. rulebook/INDEX.md — term→slice table FROM citedTerms[]    [ingest-rules.md:103-104]
│        + Edition header line (from the opening-pages subagent's
│          `edition` field)                                        [ingest-rules.md:105-108]
│          [transcription.md:79-91]
│     2. Variant tagging → SKETCH.md "Variants (deferred)"          [ingest-rules.md:109-113]
│     3. Component inventory + aspect ratios → seeds ASSETS.md       [ingest-rules.md:114-115]
│     4. ASSETS.md written here                                     [ingest-rules.md:116-118]
│     5. rulebook/00-visual-survey.md written here FROM
│        visualEvidence[]                                            [ingest-rules.md:119-131]
│     6. Player counts recorded                                      [ingest-rules.md:132-133]
│     ⚠ THIS is where rulebookPath IS known (Step 2 bound it) and
│       where INDEX.md is actually assembled — the natural landing
│       spot for the source-archive+hash operation (INGEST-01) and
│       the new header block (INGEST-04), NOT scaffold.md.
│
├─ Step 4 (Sketch Derivation) ─────────► delegates to sketch-derivation.md
├─ Step 5 (UI Strategy)
├─ Step 6 (Approval Gate)
└─ Step 7 (Write Files) — SKETCH.md, chunks/*/CHUNK.md, RULINGS.md,
     DECISIONS.md seeded here (ASSETS.md/00-visual-survey.md already
     written at Step 3, not re-written)                              [ingest-rules.md:169-197]
```

**Where each of the 4 INGEST edits lands:**

| Requirement | File | Landing point |
|---|---|---|
| INGEST-01 (archive + hash) | `ingest-rules.md` Step 3 (new sub-item, before or alongside the INDEX.md item) — needs `{rulebookPath}` which is bound in Step 2 | New prose: "Copy the source file to `rulebook/source/<original-filename>`ǃ; compute `shasum -a 256 rulebook/source/<file>`; record both as INDEX.md header lines." |
| INGEST-02 (`Visual`/`Derived` split) | `transcription.md` — the per-section subagent prompt template | Around [transcription.md:43-51], where `Derived (p.14):` is currently defined; add the sibling `Visual (p.14):` prefix + the one-line decision test + 2 worked examples |
| INGEST-03 (`## Open Rules Gaps`) | `transcription.md` (new `openGaps[]` return field, sibling to `variants[]`) + `ingest-rules.md` Step 3 (new synthesis item that always writes the section) | `transcription.md` return-shape list [transcription.md:56-77]; `ingest-rules.md` Step 3 item list [ingest-rules.md:103-134] |
| INGEST-04 (header block) | `ingest-rules.md` Step 3, extending the existing Edition-header prose | [ingest-rules.md:105-108] — extend from "Edition: ..." to the full 4-line block |

### Recommended Project Structure

No new files are required by the locked decisions (archive path `rulebook/source/`, header as prose
in `INDEX.md`, tests extend the existing `ingest.test.ts`). The only new *runtime artifact* (inside a
built game project, not this repo) is the `rulebook/source/` directory. Inside this repo:

```
src/cli/slash-command/bs/
├── ingest-rules.md          # Step 3 gains: archive+hash sub-step, header block, Open Rules Gaps assembly
├── ingest/
│   ├── transcription.md     # gains: Visual prefix + decision test + 2 worked examples; openGaps[] return field
│   └── scaffold.md          # UNCHANGED — do not add archiving here (see Pitfall 1)
└── ingest.test.ts           # gains: INGEST-01/02/03/04 describe blocks + one golden-fixture artifact-shape test
```

### Pattern: Fan-out subagent structured-return extension

**What:** Adding a new field to the subagent return shape (`openGaps[]`) without disturbing the
five existing fields.
**When to use:** Whenever a new orchestrator-consumed fact needs to travel from a transcription
subagent back to the orchestrator without a slice re-read.
**Example (extending the existing template verbatim style):**
```
     (g) openGaps[] — every `Named-but-undefined (p.N): <rule name>` line you wrote in this
         section's slice, verbatim (rule name + page citation), so the orchestrator can build
         `## Open Rules Gaps` without re-reading the slice.
```
Source: pattern extrapolated from the existing `variants[]` field
(`src/cli/slash-command/bs/ingest/transcription.md:70-73`), which already does exactly this for a
different in-slice tag (`> Variant:` notes → `variants[]` return list).

### Anti-Patterns to Avoid

- **Re-reading a slice to "sweep" `Named-but-undefined` markers:** violates the Context-Economics
  Hard Rule stated three times in this skill family. Every fact the orchestrator needs must arrive
  via a subagent return field — add `openGaps[]`, never grep the written slice.
- **Adding source-archiving logic to `scaffold.md`:** `scaffold.md` runs in Step 1, before the
  rulebook path is known (see Pitfall 1 below). Putting the copy+hash there requires either
  reordering the whole flow (out of scope, high risk) or threading the still-unknown path through —
  don't. Land it in Step 3 synthesis (or a small explicit new step), where `{rulebookPath}` already
  exists.
- **Treating `Named-but-undefined` as a completeness signal:** CONTEXT.md and REQUIREMENTS.md both
  explicitly flag this marker is unreliable (seven: 4 markers; one-two-punch: 0 markers despite 26
  rulings). `## Open Rules Gaps` reports what was marked, not an exhaustive gap list — the section
  text itself must say so (a specifics note already anticipates this).

## Common Pitfalls

### Pitfall 1: `scaffold.md` cannot own source archiving — it runs too early
**What goes wrong:** A plan task that says "add archive+hash logic to `scaffold.md`" (as CONTEXT.md's
`code_context` section literally suggests) will either fail during execution (no rulebook path
available yet) or force an out-of-scope reordering of Steps 1/2.
**Why it happens:** `scaffold.md` is delegated from `ingest-rules.md` Step 1, which explicitly runs
*before* Step 2 asks whether a rulebook exists (`ingest-rules.md:70-96`). The rulebook path is a
Step-2 concept (`{rulebookPath}` is filled into the transcription dispatch template,
`transcription.md:29-31`).
**How to avoid:** Land archive+hash logic in `ingest-rules.md` itself (Step 3 Synthesis, where the
INDEX.md write already happens and `{rulebookPath}` is known) — not in `scaffold.md`. Treat
CONTEXT.md's "scaffold.md is the natural home" language as directional (the *scaffold-adjacent
concern of project structure*, i.e. "where does `rulebook/source/` live") rather than literal
("this file's Step-1 sequence performs the copy").
**Warning signs:** A task instruction referencing `{rulebookPath}` inside `scaffold.md` prose, or a
test asserting `scaffold.md` contains `rulebook/source/` — check the actual step ordering before
accepting either.

### Pitfall 2: `Named-but-undefined` markers have no transport mechanism today
**What goes wrong:** Assuming `## Open Rules Gaps` can be "populated from existing markers" without
adding a return field leads to a design that either re-reads slices (Context-Economics violation) or
silently produces an empty section every time (since nothing currently carries the marker back to
the orchestrator).
**Why it happens:** The current return shape (`slicePath, sectionSummary, citedTerms[],
componentMentions[], visualEvidence[], variants[]`) has no field for `Named-but-undefined` lines —
only `variants[]` exists for the parallel `> Variant:` in-slice tag.
**How to avoid:** Add `openGaps[]` as a seventh return field in `transcription.md`, mirroring
`variants[]`'s pattern exactly. Update `ingest-rules.md`'s consumption list to name it (the existing
`ingest.test.ts` "return-shape field names" describe block, `RETURN_SHAPE_FIELDS` array, will need
`openGaps[]` added if the planner extends that same pinning pattern — recommended, since it already
protects the other 6 fields from silent rename).
**Warning signs:** A CHUNK/plan step referencing "sweep the slices for gaps" instead of "read the
subagent's `openGaps[]` return."

### Pitfall 3: The `## Open Rules Gaps` header text isn't fixed today — two live variants exist
**What goes wrong:** Writing a golden INDEX.md fixture (per CONTEXT.md's locked CI-determinism
decision) using the wrong exact header text will make the fixture non-representative or brittle.
**Why it happens:** `seven`'s current `INDEX.md` uses `## Open Rules Gaps (named-but-undefined in
the source)` — a hand-authored heading, not the output of any current skill logic (the current
`transcription.md`/`ingest-rules.md` never generates this section; it was written by a human/agent
outside the pinned flow). CONTEXT.md locks the *new* standardized name as `## Open Rules Gaps` (no
parenthetical). One-two-punch has **no** such section at all (0 `Named-but-undefined` markers).
**How to avoid:** The golden fixture must use the CONTEXT.md-locked exact heading
(`## Open Rules Gaps`), and must demonstrate the "always emitted, `_None._` when empty" rule —
recommend basing the fixture on a **fresh re-ingest of `seven`** (the phase's own proof run) rather
than hand-adapting the existing hand-authored section, so the fixture is provably what the edited
skill text actually produces.
**Warning signs:** A fixture that copies seven's *current* INDEX.md verbatim without re-running
ingest — that file predates this phase's contract and does not have the new header block at all.

### Pitfall 4: `Derived` lines mix genuinely different concerns — the split needs a crisp test, not a list
**What goes wrong:** Enumerating category examples ("diagrams are Visual, counts are Derived") will
under-specify borderline cases like one-two-punch's line 89 (publisher logo/copyright — no rule
content, but not a diagram either) or line 95 ("this section marks no rules as variants" — a meta
statement, neither visual nor a rule inference).
**Why it happens:** Real transcription output doesn't cleanly bucket into "diagram" vs. "rule" —
some `Derived` lines are neither (see Pitfall verification data below).
**How to avoid:** CONTEXT.md already locks the fix: a **one-line decision test** ("does this affect
legality, scoring, or sequencing?") rather than a category enumeration, plus exactly two worked
examples. Verify the worked examples chosen actually exercise a hard case (e.g. line 89's
logo/copyright note is a good *third* example to mention in skill prose even though CONTEXT.md caps
it at two — consider using the copyright-notice line as the "not rule-bearing, also not a diagram"
edge the two canonical examples should be chosen to disambiguate from).
**Warning signs:** Skill text that lists more than 2 worked examples (violates the locked decision)
or that defines Visual by category rather than by the decision test.

**Verification of the milestone's 8/12 claim (empirical, this session):** Re-grepped
`~/BoardSmithGames/one-two-punch/rulebook/*.md` for `Derived (p\.` — found exactly 12 matches.
Classification: 8 are diagram/icon/art descriptions (2 setup diagrams, 1 Plan-phase diagram, 1
Fight-phase diagram, 1 icon-set description, 2 Punch-example diagrams, 1 full-color art
illustration description); 3 are genuine rule-bearing inferences (box contents count, per-player
card count, an implied "2 Rest cards" rule); 1 is a meta statement ("no variants marked in this
section" — a negative variants confirmation, not visual and not itself a rule). REQUIREMENTS.md's
"8 of 12" claim is **confirmed** `[VERIFIED: repo grep, ~/BoardSmithGames/one-two-punch/rulebook/]`.

### Pitfall 5: Installer reachability — confirmed NOT a trap for new files, but IS one for new file*names* outside the pattern
**What goes wrong:** Assuming any change to `bs/ingest/*.md` needs a `SKILL_ENTRY_POINTS` or
`SHARED_DIRS` edit.
**Why it happens:** `install-claude-command.ts`'s `copySkillTree` copies the entire `ingest/`
directory recursively via `fs.cp(srcDir, destDir, { recursive: true, filter: excludeTestFiles })`
(`install-claude-command.ts:146-151`, `SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects']` at
line 50). Any file added under `src/cli/slash-command/bs/ingest/` — new or edited — is picked up
automatically by this recursive copy. **No installer edit is needed** for this phase, since it only
edits existing files (`transcription.md`, `ingest-rules.md`) and does not add a new top-level file
under `bs/ingest/`.
**How to avoid:** Confirm no new *file* is added under `bs/ingest/` (only edits to existing files).
If a plan does introduce a new file there (e.g. a separate `hashing.md` reference), it is still
auto-reachable via the same recursive copy — but `SHARED_LEAF_PROBES`
(`install-claude-command.ts:58-64`) is a *sampling* list used only to detect a partial install, not
an allowlist; a new file needs no entry there either, though adding one is defensible cheap
insurance.
**Warning signs:** None expected for this phase's scope — flagging this mainly to close off a false
lead in Research Question 5, since the plan author might otherwise spend a task "fixing" the
installer.

### Pitfall 6: `ingest.test.ts`'s cross-file consistency test enumerates `REFERENCED_PATHS` — a rename anywhere breaks it
**What goes wrong:** If the planner's task instructions rename any of `transcription.md`,
`scaffold.md`, `state-machine.md`, or the two templates, the existing "every referenced path
resolves on disk" describe block (`ingest.test.ts:307-320`) will fail — this is a *good* thing (it's
exactly the drift protection it's for), but a plan that doesn't account for it will see an
unexpected RED in an unrelated-looking test.
**How to avoid:** This phase's locked scope does not rename any files, so this should stay green
throughout — call it out in the plan's verification steps so a RED here is correctly triaged as "did
I accidentally touch a referenced path string" rather than a new-test authoring bug.

## Code Examples

### Existing `Derived`/`Named-but-undefined` definition (the edit site for INGEST-02/03)
```
Source: src/cli/slash-command/bs/ingest/transcription.md:43-51
       - DERIVED lines: anything you condensed or inferred, prefixed `Derived (p.14):`. A
         derived line must follow from quote lines in this slice alone — never from your own
         knowledge of this game or of any game like it.
     If the source names a rule without defining it (a bare mention or cross-reference), write
     `Named-but-undefined (p.N): <rule name>` and stop there — do not reconstruct the
     definition from the rule's name or from general knowledge; downstream steps surface it
     to the designer instead.
```

### Existing return-shape list (the edit site for the new `openGaps[]` field)
```
Source: src/cli/slash-command/bs/ingest/transcription.md:56-73
  2. RETURN a structured summary only — never the transcribed text itself:
     (a) slicePath — the rulebook/NN-topic.md file you wrote.
     (b) sectionSummary — 2-4 sentences describing what the section covers...
     (c) citedTerms[] — every term this section defines or meaningfully references...
     (d) componentMentions[] — any physical component mentioned or depicted...
     (e) visualEvidence[] — visual identity observations from your assigned pages...
     (f) variants[] — every rule this section marks as a variant, optional module, or
         advanced/expert rule (name + page citation)...
```

### Existing Edition-header synthesis (the edit site for the full header block, INGEST-04)
```
Source: src/cli/slash-command/bs/ingest-rules.md:105-108
   subagent returns (or from the user if the rulebook states none; on the interview path it
   reads "unpublished — designer statement" — see ".../transcription.md" "Edition").
```
```
Source: src/cli/slash-command/bs/ingest/transcription.md:79-91 (Edition section)
Additionally return one top-level `edition` field — the edition/printing stated on the
cover, title page, or colophon (null if the rulebook states none).
...
The orchestrator records it as a header line in `rulebook/INDEX.md` (e.g. `Edition: 2nd edition,
2019 printing`) so every later citation is anchored to the exact text that was transcribed. On
the interview path the line reads `Edition: unpublished — designer statement`.
```

### Existing seven `INDEX.md`'s ad-hoc gap section (the pre-standardization shape to formalize)
```
Source: ~/BoardSmithGames/seven/rulebook/INDEX.md (current, pre-Phase-170 state)
## Open Rules Gaps (named-but-undefined in the source)

These are named by the rulebook but never defined in it. They are NOT to be reconstructed from
inference or outside knowledge — see `RULINGS.md` for their adjudication.

1. **"Ways to Score" card contents** — ...
2. **"The 7 scoring hands"** — ...
3. **Bonus point card ("+1") value** — ...
4. **Run example discrepancy** — ...
```

### Existing `ingest.test.ts` idiom to extend (per-requirement describe block + cross-file existence check)
```
Source: src/cli/slash-command/bs/ingest.test.ts:58-136 (INGEST-01..04 blocks) and :307-320
        (cross-file resolution check) — new INGEST-01/03/04 assertions should follow this exact
        shape: read() the file inside the it() body, assert toContain/toMatch on exact or
        near-exact strings, one describe per requirement ID.
```

### Local dev-loop install command (for PROC-01's real ingest run)
```bash
# From the BoardSmith repo root — installs edited skill text to ./.claude/skills
# (project-local), leaving ~/.claude/skills/ (global) untouched.
npx boardsmith claude --local --force

# Then, in a throwaway directory OUTSIDE any tracked repo:
mkdir -p /private/tmp/claude-.../scratchpad/ingest-proof && cd $_
# Invoke /bs-ingest-rules in a Claude Code session started from this directory,
# pointing transcription at: ~/BoardSmithGames/seven/rules.pdf
# (source: src/cli/cli.ts:122-132 `claude` command; install-claude-command.ts:180-183
#  `options.local` -> `./.claude/skills`)
```

### SHA-256 hashing invocation (for skill text to prescribe — no shasum/sha256 precedent exists yet in this repo's skill text)
```bash
shasum -a 256 rulebook/source/rules.pdf | cut -d' ' -f1
# Verified locally against seven/rules.pdf (2,194,346 bytes, PDF v1.3, 2 pages):
# 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
```
`[VERIFIED: local shell execution against the actual proof-target file]` — this exact hash can be
used as an expected value in the golden-fixture INDEX.md test if the planner chooses to pin the real
`seven` hash rather than a synthetic placeholder (recommended, since CONTEXT.md's proof run uses this
exact file).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `shasum -a 256` is the right cross-platform-safe shell invocation to prescribe in skill text (vs. `sha256sum`, which is the GNU/Linux-native name; macOS ships `shasum`) | Alternatives Considered, Code Examples | Low — both are trivial one-liners; worst case the skill text needs a one-line OS-detection fallback, discoverable immediately the first time a Linux/CI user runs ingest |
| A2 | Landing the archive+hash logic in `ingest-rules.md` Step 3 (rather than a brand-new numbered step) is the right call structurally | Architecture Patterns, Pitfall 1 | Low-Medium — this is a planning-level sequencing decision within Claude's Discretion per CONTEXT.md ("exact wording... internal structure of the new tests" is discretionary); a new explicit Step 2.5 is an equally valid alternative the planner may prefer for clarity |
| A3 | Adding `openGaps[]` as a 7th return-shape field (rather than reusing `citedTerms[]` with a prefix convention) is the right mechanism | Common Pitfalls Pitfall 2 | Medium if wrong — reusing an existing field would avoid a schema change but conflates "defined term" with "named-but-undefined gap," which the existing `citedTerms[]` semantics don't support; a new field is the safer, more explicit choice and mirrors the existing `variants[]` precedent |

**None of the four core INGEST-0X locked decisions from CONTEXT.md are challenged here** — only the
*mechanics* of where code lands, which is exactly what this research was asked to resolve.

## Open Questions

1. **Should the archive+hash step get its own numbered ingest-rules.md step, or fold into Step 3?**
   - What we know: Step 3 already writes INDEX.md and already knows `{rulebookPath}` by then.
   - What's unclear: whether bundling one more file-copy+hash operation into the already-dense
     6-item Step 3 list reduces clarity, vs. giving it a clean standalone step number.
   - Recommendation: Planner's call (Claude's Discretion per CONTEXT.md) — either is structurally
     valid; recommend a **new Step 3a sub-item** (not a new top-level numbered step) since Step 3 is
     already framed as "assembles the following artifacts" and this is one more artifact (the
     archived file itself, plus two new header lines).

2. **Does the interview-fallback path (no rulebook) need an archive+hash step at all?**
   - What we know: `interview-fallback.md` has no source file to archive — the interview path's
     Edition line already reads "unpublished — designer statement."
   - What's unclear: whether `Source:`/`Source hash:` header lines should be omitted entirely on
     the interview path, or written with an explicit "n/a — no source rulebook" value (matching
     CONTEXT.md's "explicit `not stated in the rulebook` value" pattern for genuinely-unknown
     fields).
   - Recommendation: Write explicit `not applicable — no source rulebook (interview path)` rather
     than omitting the lines, consistent with CONTEXT.md's "the line is still written... never
     omitted" rule for the header block generally.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `shasum` (macOS/BSD) | INGEST-01 hash computation (skill-prescribed shell command) | ✓ (confirmed via live invocation this session) | macOS built-in | `sha256sum` on Linux/CI — skill text should name both or check `command -v` |
| `npx boardsmith claude --local` (this repo's own CLI) | PROC-01 dev-loop install | ✓ | current repo HEAD | — |
| `~/BoardSmithGames/seven/rules.pdf` (proof target) | PROC-01 real ingest run | ✓ (confirmed: 2,194,346 bytes, PDF v1.3, 2 pages) | — | — |
| Vitest | Regression tests (PROC-02) | ✓ (already project dependency) | existing repo version | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `shasum` → `sha256sum` on non-macOS environments.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing repo-wide) |
| Config file | repo root `vitest.config.ts` (existing, unchanged) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` |
| Full suite command | `npm test` (repo-wide) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INGEST-01 | `ingest-rules.md`/`transcription.md` prescribe archiving source + computing SHA-256, recorded as `Source hash:` line | skill-text contract (grep/toContain) | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t INGEST-01` | ✅ existing file, new describe block |
| INGEST-01 | A real ingest run against `seven/rules.pdf` produces `rulebook/source/rules.pdf` + correct hash | manual proof (PROC-01), recorded in phase SUMMARY | N/A — human-run `/bs-ingest-rules` session | N/A (not CI-automatable) |
| INGEST-02 | `transcription.md` defines the `Visual (p.N):` prefix, the one-line decision test, and exactly 2 worked examples | skill-text contract | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t INGEST-02` | ✅ existing file, new describe block |
| INGEST-03 | `transcription.md` defines `openGaps[]` return field; `ingest-rules.md` names `## Open Rules Gaps`, states it is always emitted (`_None._` when empty) | skill-text contract | same file, `-t INGEST-03` | ✅ existing file, new describe block |
| INGEST-03/04 | A golden `INDEX.md` fixture (checked into the repo, NOT live LLM output) asserts the exact header block shape + `## Open Rules Gaps` section shape | artifact-shape test against a static fixture | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "artifact shape"` (new describe block name TBD by planner) | ❌ Wave 0 gap — fixture file + test must be authored |
| INGEST-04 | `ingest-rules.md` prescribes `Edition:`/`Source:`/`Source hash:`/`Transcribed:` header lines, always emitted | skill-text contract | same file, `-t INGEST-04` | ✅ existing file, new describe block |
| PROC-01 | Every skill edit demonstrated against a real ingest run, not skill-text review alone | manual proof + phase SUMMARY record | N/A | N/A |
| PROC-02 | Fix → test → adversarial verify → close, applied to this phase's own edits | process discipline, checked via plan-checker/verify-work gates | N/A (process, not a single test) | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/ingest.test.ts`
- **Per wave merge:** `npm test` (full repo suite — cheap, this phase touches only Markdown + one
  test file, no risk of breaking unrelated suites, but the house rule is full-suite-green at wave
  merge regardless)
- **Phase gate:** Full suite green before `/gsd:verify-work`, PLUS the PROC-01 manual proof run
  recorded in the phase SUMMARY (this is the phase's own process discipline, applying to itself
  first)

### Wave 0 Gaps
- [ ] Golden `INDEX.md` fixture file (recommend deriving it from the phase's own real `seven`
      re-ingest run output, not hand-authored, per Pitfall 3)
- [ ] New artifact-shape test in `ingest.test.ts` (or a new sibling `.test.ts` file, planner's
      choice) asserting the fixture's header block + `## Open Rules Gaps` shape
- [ ] `openGaps[]` addition to the existing `RETURN_SHAPE_FIELDS` pinning array in `ingest.test.ts`
      (`ingest.test.ts:195-202`) — extend the existing array rather than creating a parallel one

## Security Domain

Not applicable in the ASVS sense — this phase edits instructional Markdown consumed by an LLM agent
and a local CLI-driven file copy + hash of a designer-supplied file already resident on their own
machine. No network input, no authentication, no session boundary is touched. The one adjacent
consideration — a designer's rulebook file could theoretically be any file type — is already
addressed by the existing "never move or delete" / "copy, don't reference" locked decisions
(CONTEXT.md), which prevent this phase from introducing any new destructive filesystem operation.

## Sources

### Primary (HIGH confidence — direct in-repo/in-sibling-repo inspection this session)
- `src/cli/slash-command/bs/ingest-rules.md` (full read)
- `src/cli/slash-command/bs/ingest/transcription.md` (full read)
- `src/cli/slash-command/bs/ingest/scaffold.md` (full read)
- `src/cli/slash-command/bs/ingest.test.ts` (full read)
- `src/cli/slash-command/bs/templates.test.ts` (idiom check)
- `src/cli/commands/install-claude-command.ts` (full read)
- `src/cli/cli.ts` (grep for `claude`/`--local`/`--force`)
- `~/BoardSmithGames/seven/rulebook/INDEX.md`, `RULINGS.md`, directory listing (full read)
- `~/BoardSmithGames/one-two-punch/rulebook/INDEX.md`, slice files (grep + read, empirical
  `Derived` line count and classification)
- Live shell verification: `shasum -a 256` against `seven/rules.pdf`, `file`/`ls -la` for PDF
  metadata

### Secondary (MEDIUM confidence)
- None used — no WebSearch/Context7 lookups were needed; this phase's domain is entirely
  self-contained within this repo and its two sibling reference-game repos.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: N/A — no new dependencies
- Architecture: HIGH — full read of every file in scope, cross-verified against both reference
  games' actual on-disk artifacts
- Pitfalls: HIGH — Pitfall 1 (scaffold.md timing) and Pitfall 2 (missing `openGaps[]` field) are
  both provable directly from the source files' own step ordering and return-shape definitions,
  not speculation

**Research date:** 2026-07-27
**Valid until:** Effectively indefinite for the historical/architectural findings (this is the
current committed state of the repo and reference games); the "8/12 Derived lines" empirical count
is valid until either reference game's rulebook slices are re-ingested (which Phase 170 itself will
do, for `seven`, as its own proof run — re-verify the count against `one-two-punch` only if that
game is touched by a future phase, since it is explicitly reserved/untouched by this one).
