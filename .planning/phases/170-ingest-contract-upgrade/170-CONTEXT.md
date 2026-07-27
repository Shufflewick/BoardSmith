# Phase 170: Ingest Contract Upgrade - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase upgrades the **ingest contract** of the `bs-` skill family so that a freshly-ingested
game carries the provenance foundation every later v4.9 phase depends on:

1. The source rulebook is archived inside the project with a recorded content hash (INGEST-01).
2. Transcription separates rule-bearing inference (`Derived (p.N):`) from presentation description
   (`Visual (p.N):`) (INGEST-02).
3. `rulebook/INDEX.md` carries a standardized `## Open Rules Gaps` section (INGEST-03) plus a fixed
   edition / source-file / source-hash / transcription-date header block (INGEST-04).
4. The milestone's verify-first discipline is established: every skill-text change is demonstrated
   against a real ingest run and locked by a regression test (PROC-01, PROC-02).

**In scope:** `src/cli/slash-command/bs/ingest-rules.md`, `src/cli/slash-command/bs/ingest/*.md`
(especially `transcription.md` and `scaffold.md`), the INDEX.md contract, and the regression tests
in `src/cli/slash-command/bs/ingest.test.ts`.

**Out of scope:** the verify pipeline itself (Phases 173+), provenance stamping at `close`
(Phase 171), backfilling provenance into existing bs-built games (explicitly out of scope for the
milestone), and any change to sketch/chunk derivation.

</domain>

<decisions>
## Implementation Decisions

### Source Archive & Hashing (INGEST-01)

- **Standard archive path is `rulebook/source/<original-filename>`.** Provenance lives next to the
  slices it produced, so there is exactly one directory to look in.
- **Ingest copies the source file into the project rather than recording an external path.** A path
  outside the project breaks the moment the designer moves or renames the rulebook; a later verify
  pass must be able to re-read the exact bytes it transcribed from.
- **Hash is SHA-256 over the raw file bytes**, recorded as a `Source hash:` line in the
  `rulebook/INDEX.md` header block — designer-readable, and a single source of truth (no separate
  manifest file to drift).
- **Non-destructive for existing root copies.** When the source already sits at the project root
  (as `seven/rules.pdf` does), ingest copies it into `rulebook/source/` and leaves the original
  untouched. Ingest never moves or deletes a designer's file.

### Transcription Split & INDEX Contract (INGEST-02/03/04)

- **The `Derived` vs `Visual` boundary is a stated one-line decision test**, not a category
  enumeration and not left to subagent judgment: `Derived (p.N):` is a **rule-bearing** inference —
  one that affects legality, scoring, or sequencing. `Visual (p.N):` is diagram, art, layout, or
  typography description. `transcription.md` states the test plus two worked examples (one of each).
- **`00-visual-survey.md` survives as a slice.** It is the durable handoff to the first `ui:` chunk
  and must keep existing. The new `Visual (p.N):` prefix is the *inline* marker used inside rule
  slices where a diagram or art note sits mid-rule — the two are complementary, not a replacement.
- **`## Open Rules Gaps` is populated from the existing `Named-but-undefined (p.N):` markers**,
  swept out of the returned slices at scaffold time into INDEX.md. The section is written
  **always** — when there are no gaps it reads `_None._`, so its absence is a defect rather than an
  ambiguity. This makes gap tracking structural rather than improvised per session.
- **INDEX.md header is a fixed prose block, always emitted, never omitted:** `Edition:`, `Source:`
  (the archived `rulebook/source/...` path), `Source hash:`, `Transcribed:` (ISO date). When a value
  is genuinely unknown, the line is still written with an explicit
  `not stated in the rulebook` value. Prose lines rather than YAML frontmatter, matching the
  existing INDEX.md style a designer already reads.

### Proof & Regression Discipline (PROC-01/02)

- **"A real ingest run" means a fresh `/bs-ingest-rules` into a throwaway project directory**, using
  `~/BoardSmithGames/seven/rules.pdf` as the source. Real PDF, real transcription subagents, zero
  mutation of the reference game.
- **Regression tests extend `src/cli/slash-command/bs/ingest.test.ts`** with skill-text contract
  assertions, **plus** a new artifact-shape test asserting the INDEX.md header block and
  `## Open Rules Gaps` structure.
- **CI asserts the skill-text contract and a checked-in golden INDEX.md fixture — not live LLM
  output.** The live PDF ingest run is this phase's manual proof and is recorded in the phase
  SUMMARY. Committing real run output as a CI-diffed fixture would make CI non-deterministic.
- **`seven` is the reference game for this phase** (2-page PDF, fast to re-ingest, already exercises
  the visual survey and 20+ rulings). `one-two-punch` is reserved for later phases so the two
  reference games do not both get burned on the first contract change.

### Claude's Discretion

- Exact wording of the skill-text edits, the two worked examples in `transcription.md`, and the
  internal structure of the new tests.
- Whether the hash is computed by a small helper in the skill flow or by a documented shell
  invocation (`shasum -a 256`) — whichever is more reliably reproducible from the skill text.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/cli/slash-command/bs/ingest-rules.md` — the ingest entry point skill text.
- `src/cli/slash-command/bs/ingest/transcription.md` — owns the slice-line prefix contract; already
  defines `Derived (p.N):` (line ~45) and `Named-but-undefined (p.N):` (line ~49). Both edits for
  INGEST-02 and INGEST-03 land here.
- `src/cli/slash-command/bs/ingest/scaffold.md` — owns project scaffolding; the natural home for
  archiving the source file and writing the INDEX.md header block.
- `src/cli/slash-command/bs/ingest.test.ts` — existing skill-text regression tests for the ingest
  family. Siblings: `build-chunk.test.ts`, `templates.test.ts`, `status-tools.test.ts`.
- `src/cli/commands/install-claude-command.ts` — `SKILL_ENTRY_POINTS` maps
  `bs/ingest-rules.md` → `bs-ingest-rules`; the `bs/ingest/` tree ships under
  `~/.claude/skills/bs-shared/ingest/`. Any new file in that tree must be reachable by the installer.

### Established Patterns

- Skill text is plain Markdown under `src/cli/slash-command/`, installed verbatim to
  `~/.claude/skills/` by `npx boardsmith claude`. Skill behavior is regression-tested by asserting
  on the **skill text** (grep-style contract assertions in vitest), because the runtime behavior is
  an LLM.
- Reference-game artifacts (`~/BoardSmithGames/seven/rulebook/INDEX.md`) show the current INDEX
  shape: an `Edition:` line, a `Source:` line, a `## Slices` table, and a `## Term → Slice` table.
  The new header block extends this existing prose style rather than replacing it.

### Integration Points

- `rulebook/INDEX.md` is read by `/bs-check-status` and by every chunk's term→slice sweep — header
  additions must not disturb the `## Slices` / `## Term → Slice` tables downstream consumers parse.
- The `rulebook/source/` path and `Source hash:` line become the contract Phase 171 (provenance
  recording) and Phase 173 (verify pipeline re-transcription) read. Their exact spelling is load-
  bearing for later phases.

</code_context>

<specifics>
## Specific Ideas

- `~/BoardSmithGames/seven` is the designated proof target for this phase; its `rules.pdf` is the
  source for the throwaway-dir ingest run. The reference game itself must not be mutated.
- The `Named-but-undefined` marker is known to be unreliable as a *completeness* signal (seven has
  4 markers; one-two-punch has 0 despite 26 rulings). It is used here only as the **input to the
  sweep** — the `## Open Rules Gaps` section reports what was marked, and does not claim to be an
  exhaustive gap list. The section's honesty about its own scope matters.

</specifics>

<deferred>
## Deferred Ideas

- Making `Named-but-undefined` marking itself more reliable (a completeness check on gap detection)
  — a real weakness, but it is a transcription-quality problem rather than a contract problem, and
  belongs in its own phase.
- Backfilling `rulebook/source/` and the header block into already-built games — explicitly out of
  scope for v4.9 per REQUIREMENTS.md.

</deferred>
