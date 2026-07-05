# Phase 147: `/bs-check-status` & `/bs-insert-chunk` - Research

**Researched:** 2026-07-04
**Domain:** Markdown-authored agent skill instructions (no runtime code beyond a vitest drift test) — BoardSmith's `bs-` skill family, state-machine-governed game-design pipeline
**Confidence:** HIGH (all claims verified by direct file read of the actual repo files these skills must cite; no external library research needed)

## Summary

Phase 147 authors two new top-level `bs-` skill files — `check-status.md` (STAT-01, read-only) and `insert-chunk.md` (STAT-02, sketch editor) — plus a drift test `status-tools.test.ts`. Both are thin: they cite `state-machine.md` sections rather than restating them, following the exact idiom already established by `ingest-rules.md` and `build-chunk.md`. All state shapes these skills read/write (SKETCH.md, CHUNK.md, ASSETS.md) already exist as shipped templates with byte-exact grammars documented below. `build-chunk.md` already contains two forward-references to this phase (Step 1's "what's left?" probe and reorder-intent probe) that name the exact behaviors these skills must fulfill and can be pointed back at once 147 ships.

**Primary recommendation:** Write both skills as lean routers modeled directly on `ingest-rules.md`'s structure (Context-Economics Hard Rule preamble → numbered steps → "Reference Files" footer with "Installed location" paragraph), citing `state-machine.md`'s exact section headings quoted below, and pin every cited heading + the two byte-exact markers (`stale — re-derive before build`, `verified (user-waived)`) in `status-tools.test.ts` using the same `read()`/named-constant pattern as `ingest.test.ts`/`build-chunk.test.ts`/`templates.test.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Consistency check on entry | Skill instructions (agent-executed, orchestrator reads state files) | `state-machine.md` (shared rule text, cited not restated) | Both skills are entry points; the rule is defined once in state-machine.md and every `bs-` skill cites it identically |
| Status report (7 items) | `check-status.md` orchestrator, reading SKETCH.md/CHUNK.md/ASSETS.md directly | — | No subagents needed — thin skill, orchestrator is explicitly permitted to read state files (not rulebook slices/code) |
| Citation-dependency revalidation | `insert-chunk.md` orchestrator, reading SKETCH.md citations + closed CHUNK.md citations | Possibly an inline subagent dispatch if citation sets are large (Claude's discretion per CONTEXT.md) | Thin skill; likely inline per CONTEXT.md's own discretion note — no rulebook re-reading required, only citation-string comparison across already-written state files |
| Stale-marking + version bump | `insert-chunk.md` writes to CHUNK.md then SKETCH.md | `build-chunk.md` Step 0/2 (consumer, already ships routing logic that stops on `stale — re-derive before build`) | Write-order rule (CHUNK first, SKETCH second) is state-machine.md's, cited not restated |
| Drift protection | `status-tools.test.ts` (vitest, this repo's runtime) | — | Mirrors `ingest.test.ts`/`build-chunk.test.ts`/`templates.test.ts` — these `.md` files are not parsed by any runtime code; the test pins strings so reword drift fails loudly |

## Standard Stack

Not applicable in the conventional sense — this phase adds no new libraries or packages. The only "stack" is the existing repo tooling:

| Tool | Version (verified in repo) | Purpose |
|------|---------|---------|
| vitest | already a devDependency (used by `ingest.test.ts` et al.) | drift-protection test runner for `status-tools.test.ts` |
| Node `fs`/`path`/`url` | built-in | `read()` helper pattern shared across all `bs/*.test.ts` files |

No `npm install` step, no Package Legitimacy Audit required for this phase (no external packages).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Consistency check logic | A new/paraphrased description of the 4-point check | Cite `state-machine.md` § "Consistency Check (every bs- entry point, before proceeding)" verbatim by section name | Every other `bs-` skill (`ingest-rules.md`, `build-chunk.md`) cites this section by name instead of restating it — restating creates a fourth copy to keep in sync |
| Session lock staleness rule | A new 24h-check description | Cite `state-machine.md` § "Session Lock" | Same rule, same citation discipline |
| Status enum / stale marker / write order | Redefining these strings | Cite `state-machine.md` § "Status Enum (exact)" and § "Write Order"; use the exact byte string `stale — re-derive before build` (em-dash) and `verified (user-waived)` | These are the load-bearing byte-exact strings `templates.test.ts`/`build-chunk.test.ts` already pin; re-deriving them risks a hyphen/em-dash mismatch |
| Reading state files via subagents | Dispatching a subagent just to read SKETCH.md/CHUNK.md/ASSETS.md | Orchestrator reads these directly — both skills are "thin" per CONTEXT.md; state-file reads are the sanctioned orchestrator channel (see build-chunk.md's Context-Economics Hard Rule, which explicitly permits orchestrator reads of CHUNK.md state sections) | State files are small, structured, and exactly what the orchestrator is meant to read — dispatching a subagent for this adds latency/cost with no benefit and breaks the "no subagents for thin skills" discretion note in CONTEXT.md |

**Key insight:** Both skills are pure readers/editors of already-shipped state shapes. There is no new state-machine behavior to invent here — the entire job is (1) correctly reading the 5 state-file structures documented below, (2) correctly citing 4 named state-machine.md sections, and (3) correctly performing the write-order/version-bump/stale-mark operations state-machine.md already specifies for `insert-chunk`.

## Architecture Patterns

### Recommended Project Structure
```
src/cli/slash-command/bs/
├── check-status.md          # NEW — top-level skill (STAT-01), no build/ subfolder
├── insert-chunk.md          # NEW — top-level skill (STAT-02), no build/ subfolder
├── status-tools.test.ts     # NEW — drift test, mirrors ingest.test.ts/build-chunk.test.ts
├── state-machine.md         # EXISTING — cited, never restated
├── ingest-rules.md          # EXISTING — closest structural analog to mirror
├── build-chunk.md           # EXISTING — already forward-references Phase 147 twice
└── templates/
    ├── SKETCH.template.md   # EXISTING — check-status reads; insert-chunk edits
    ├── CHUNK.template.md    # EXISTING — check-status reads; insert-chunk marks stale
    └── ASSETS.template.md   # EXISTING — check-status reads (asset debt ledger)
```

### System Architecture Diagram

```
User runs /bs-check-status ──────────────────────────────────────────────┐
                                                                          │
  Step 0: Consistency Check (cite state-machine.md "Consistency Check")  │
    │                                                                    │
    ├─ problems found? ──> report to user, confirm how to proceed        │
    │                                                                    │
    ▼                                                                    │
  Read SKETCH.md (Ordered Chunk List, Session Lock, Ideas Backlog)       │
    │                                                                    │
    ▼                                                                    │
  Read current CHUNK.md (Status line, Step Checklist, Revision Rounds)   │
    │                                                                    │
    ▼                                                                    │
  Read ASSETS.md (Ledger: needed-by-chunk/requested/received/            │
                   placeholder-in-use)                                   │
    │                                                                    │
    ▼                                                                    │
  Synthesize 7-item report (chunks done/remaining, current chunk+step,   │
  outstanding feedback, waived list + batch-playtest proposal,           │
  asset debts, ideas-backlog size, next command)  ── read-only, no write │
    │                                                                    │
    ▼                                                                    │
  Print exact next command                                              │
                                                                          │
User runs /bs-insert-chunk ───────────────────────────────────────────────
    │
  Step 0: Consistency Check (same cite)
    │
    ▼
  Read SKETCH.md's Ordered Chunk List (citations per entry) + each
  CLOSED chunk's chunks/<slug>/CHUNK.md (Interpretation citations,
  Newly Discovered Citations)
    │
    ▼
  (a) Re-validate dependency order: does the new/moved chunk cite
      rules only a LATER (not-yet-built) chunk covers? ──> name concretely,
      propose minimal prerequisite; user's ordering wins otherwise
    │
    ▼
  (b) Diff new/edited chunk's citations against every CLOSED chunk's
      citations ──> overlap found? flag "chunk X implemented Y; your
      insertion also cites it — may need a revise round"
    │
    ▼
  (c) For any already-detailed PENDING (not yet closed) CHUNK.md whose
      content the sketch change invalidates: write
      "Status: stale — re-derive before build" to that CHUNK.md
      (byte-exact marker, CHUNK.md first)
    │
    ▼
  (d) Bump "Sketch Version: N" -> N+1 in SKETCH.md (write order:
      CHUNK.md edits from (c) land first, then this SKETCH.md edit)
    │
    ▼
  Print exact next command (likely /bs-build-chunk, or another
  /bs-insert-chunk if more reshaping is queued)
```

### Pattern 1: Top-level thin-skill idiom (mirror `ingest-rules.md`)
**What:** A skill file opens with a one-paragraph statement that it cites `state-machine.md` and `templates/*.template.md` rather than restating their rules, states its run trigger, then a `## Context-Economics Hard Rule` (or equivalent) stating what the orchestrator is/isn't allowed to read directly, then numbered `## Step N` sections, then a closing `## Reference Files` section with an "Installed location" paragraph explaining relative-path resolution against the skill file's own directory.
**When to use:** Every new top-level `bs-` skill (this phase's two files).
**Example (verbatim opening pattern, from `ingest-rules.md` lines 1-8):**
```markdown
# `/bs-ingest-rules` — Start the Project

Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `state-machine.md` for all of that.
```
Source: `src/cli/slash-command/bs/ingest-rules.md`

### Pattern 2: "Installed location" footer (must be copied verbatim in spirit)
**What:** Every top-level skill ends with a paragraph explaining that its relative reference paths (here: `state-machine.md`, `templates/`) resolve against the directory containing the skill file itself, not the game project or CWD — because the installer copies the whole `bs/` tree as one unit.
**Example, from `ingest-rules.md` lines 207-214:**
```markdown
**Installed location:** every relative path above (the `ingest/` step files, `state-machine.md`,
and `templates/`) resolves against the directory containing THIS skill file — the installer
copies the whole `bs/` tree as one unit, so the shipped layout is identical wherever it is
installed. When Step 7 says to "copy" a template, resolve `templates/<file>` from this file's
own directory, never from the game project or the current working directory. (Installer-phase
dependency: `src/cli/commands/install-claude-command.ts` does not yet install the `bs-` skills;
the phase that teaches it to MUST preserve this skill-file-relative layout ...)
```
Both new skills should carry an equivalent paragraph — note that Phase 148 (installer wiring) is what makes this true; until then this paragraph is still correct to write (it documents intended layout, and `ingest-rules.md`/`build-chunk.md` already carry the identical "Installer-phase dependency" caveat).

### Anti-Patterns to Avoid
- **Restating state-machine.md content inline:** e.g. re-listing the status enum values or re-explaining 24h staleness math instead of citing the section by name. This is explicitly forbidden by the established idiom and by CONTEXT.md's own decision text ("cite (never restate)").
- **Dispatching subagents for state-file reads:** CONTEXT.md decisions state these are thin skills needing no subagents; `check-status` in particular is described as reading SKETCH.md/CHUNK.md/ASSETS.md itself.
- **check-status performing any write:** STAT-01 is read-only per both `bs-skills-plan.md` and CONTEXT.md — no state mutation, not even refreshing a session-lock timestamp (that's `build-chunk.md`'s job on resume, not check-status's).
- **insert-chunk writing SKETCH.md before CHUNK.md:** violates the universal Write Order rule (state-machine.md § "Write Order": CHUNK.md first, always).
- **insert-chunk silently overwriting a stale CHUNK.md's content instead of only flipping its Status line:** state-machine.md's stale marker is a `Status:` value, not a content wipe — the CHUNK.md's existing Interpretation/Findings/etc. content stays; only "re-derive before build" is signaled for the NEXT build-chunk session to act on.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STAT-01 | Designer can run `/bs-check-status` to see chunks done/remaining, current step, outstanding feedback, waived verifications, asset debts, and the exact next command | Mapped 1:1 to bs-skills-plan.md §3 seven-item list; each item's source file/section identified below in "The 7 Check-Status Report Items" |
| STAT-02 | Designer can reshape the sketch via `/bs-insert-chunk`, which diffs citations against closed chunks, marks stale detailed chunks, and bumps the sketch version stamp | Mapped 1:1 to bs-skills-plan.md §4 four-op list + state-machine.md "Write Order"/"Status Enum" (stale marker) / SKETCH.template.md "Sketch Version" line; detailed in "Insert-Chunk's 4 Operations" below |

## Exact State-Machine.md Section Headings to Cite

These must be quoted byte-exact (as markdown `##`/`###` headings) — confirmed by direct read of `state-machine.md`:

- `## Consistency Check (every bs- entry point, before proceeding)` — both skills run this on entry.
- `## Session Lock` — check-status reports lock state as part of its report (arguably not required, but insert-chunk's consistency check runs it too); the 24h staleness criterion and the "same-chunk resume is not stale" nuance live here.
- state-machine.md does **not** have a heading literally named "Sketch Version" — the version stamp is documented under `## Write Order` implicitly and explicitly inside `templates/SKETCH.template.md`'s own `Sketch Version: 1` line and inline comment ("Bumped by /bs-insert-chunk on every structural change to the ordered chunk list below."). **Correction to CONTEXT.md's phrasing:** cite `templates/SKETCH.template.md`'s `Sketch Version:` field directly (not a `state-machine.md` "Sketch Version" section, which does not exist as its own heading) — insert-chunk.md's citation list should read "state-machine.md 'Write Order' + SKETCH.template.md's `Sketch Version:` line," not a nonexistent "Sketch Version" section of state-machine.md. This is a **drift risk**: if the plan authors a citation to a "state-machine.md § Sketch Version" heading verbatim, `status-tools.test.ts` will correctly fail because no such heading exists. Flagging as `[VERIFIED: direct file read]`.
- `## Write Order` — CHUNK.md-first-then-SKETCH.md-second rule; append-only rounds; `Status:` line updated last. Cited by insert-chunk for its (c)/(d) operations.
- `## Status Enum (exact)` — contains both the 5-value enum AND (separately, same section) the CHUNK-level stale marker `stale — re-derive before build` with its own em-dash callout note. Cite this section for the stale marker, not a separate section — there is no standalone "Stale Marker" heading; it lives inside "Status Enum (exact)".
- `## Cold-Resume Parse Contract` — relevant to both skills' consistency-check citation (TMPL-02 rule: stop and ask on parse failure, never guess) and to insert-chunk's SKETCH.md tail-entry-vs-detailed-entry Status-line grammar when it reshapes the list.
- `## Repair Loop Bound` / `## Redteam Escalation` / `## Session Handoff Seams` — not needed by these two skills (build-chunk's territory); do not cite.

## SKETCH.template.md Structure Check-Status Reads

Confirmed exact section headings (in file order) and what each is for:

1. `Sketch Version: 1` — top-of-file field (not a `##` heading), line 12. Comment: "Bumped by /bs-insert-chunk on every structural change to the ordered chunk list below."
2. `Session Lock: <!-- none | "<slug> — locked at <ISO timestamp>" -->` — line 15, checked by the shared consistency check (state-machine.md "Session Lock").
3. `## Player Counts` — min/max, per-count setup differences.
4. `## UI Strategy` — `Strategy:` (custom-from-chunk-1 | autoui-with-cutover), cutover chunk slug. Not part of check-status's 7-item report per the plan, but insert-chunk must not disturb it.
5. `## Ordered Chunk List` — the reshaping target for insert-chunk. Each entry: `### <slug>`, `- What it builds:`, `- Citations:`, `- ui:`, `- Status (derived from chunks/<slug>/CHUNK.md): <enum>` (detailed entries) OR `- Status: proposed (sketch-level — no CHUNK.md yet)` (tail entries, no directory). **Exactly two Status-line grammars are valid** — this is the field check-status reads for "chunks done/remaining" and "current chunk" (first entry whose derived status is neither `verified` nor `verified (user-waived)`), and the field insert-chunk's citation-diff and dependency-revalidation both read (`- Citations:` per entry).
6. `## Variants (deferred)` — out of scope for both skills per bs-skills-plan.md (not in the 7-item report, not touched by insert-chunk's 4 ops — though reordering the chunk list could in principle interact with variants; not called out in CONTEXT.md, so treat as out of scope unless the plan decides otherwise).
7. `## Ideas Backlog` — append-only list; check-status reports **size** (item 6 of the 7), fed by `build-chunk.md`'s revise-step triage category (b).
8. `## Mandated Chunks` — structural requirements (first chunk = core event loop, game-end chunk required, final-acceptance chunk required). insert-chunk's dependency-revalidation must not let a reorder violate these implicitly (e.g., moving the final-acceptance chunk off the tail) — not explicitly called out in CONTEXT.md's decisions; flag as an **open question** below.

**`verified (user-waived)` surfacing:** the value appears exactly as the 5th status-enum value (state-machine.md "Status Enum (exact)") and is written to a chunk's own CHUNK.md `Status:` line, then reflected in SKETCH.md's derived-pointer line for that entry. check-status finds waived chunks by scanning the Ordered Chunk List's derived-status lines for this exact string.

## CHUNK.template.md Detail

- **Stale marker, byte-exact:** `stale — re-derive before build` (em-dash `—`, confirmed at state-machine.md line 19-21's explicit NOTE and CHUNK.template.md line 9's enum-values comment: "proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build"). insert-chunk sets this as the CHUNK.md `Status:` line (line 8 of the template) for any already-detailed pending chunk it invalidates.
- **Waived status grammar:** `verified (user-waived)` — set at the `Verified Checklist` section's own trailing comment: "If the human explicitly chooses to skip playtesting, record that honestly: set `Status: verified (user-waived)` instead of silently marking verified." check-status reports this list; per CONTEXT.md, batched with a proposed batch-playtest.
- **"Current step" derivation:** from `## Step Checklist` — a literal markdown checkbox list (`- [ ] investigate` etc., full/light/final-acceptance variants per the CEREMONY-CONDITIONAL block). "Current step" = the **first unchecked item** in this list, exactly the same "first incomplete step" rule `build-chunk.md` Step 2 already uses for its own resume routing. check-status should reuse this identical derivation (first unchecked `- [ ]` line) rather than inventing a different one.
- **Citations location for insert-chunk's diff:** a chunk's citations live in **two** CHUNK.md sections — `## Interpretation` (each numbered claim ends "— cites <rulebook section / RULINGS.md entry>") and `## Newly Discovered Citations` (append-only, populated during investigate when INDEX.md search surfaces additional sections). insert-chunk's closed-chunk citation diff must scan **both** sections for every closed chunk, not just Interpretation — Newly Discovered Citations is exactly where cross-section rules (the plan's own example: "Monopoly's jail lives between slices") would surface. Also cross-check SKETCH.md's own per-entry `- Citations:` line (item 5 above), which is the sketch-level summary — CHUNK.md is the authoritative/detailed source once a chunk is detailed.
- **`## ui:` restated field** — CHUNK.md carries its own `none|touches|major` copy (redundant-but-safe per the template's own comment) so a CHUNK-only read still knows whether the a11y floor applies; not part of the 7-item report but relevant if check-status's report format wants to note UI chunks.

## ASSETS.template.md Detail (asset-debt ledger check-status reads)

Confirmed exact 5-column table header, in order (PARSE CONTRACT note, lines 23-28):

```
needed-by-chunk | requested | received | placeholder-in-use | file path
```

check-status's item 5 ("outstanding asset debts") = rows where `requested = yes` and `received = no` (i.e., still owed), cross-referenced with `placeholder-in-use = yes` to report which components are currently shipping on a placeholder. The file's own header comment states "A MISSING ASSET NEVER BLOCKS A CHUNK" — check-status should report these as informational debt, not blockers, consistent with that policy.

## The 7 Check-Status Report Items — Source Map

| # | Item (per bs-skills-plan.md §3 + CONTEXT.md) | Source file | Source section/field |
|---|------|--------------|----------------------|
| 1 | Chunks done/remaining | SKETCH.md | `## Ordered Chunk List` — count entries by derived-status value (`verified`/`verified (user-waived)` = done; everything else = remaining, including sketch-level tail entries) |
| 2 | Current chunk + current step | SKETCH.md (which chunk) then that chunk's CHUNK.md | SKETCH.md: first entry whose status is neither `verified` nor `verified (user-waived)`. CHUNK.md: `## Step Checklist` — first unchecked `- [ ]` item |
| 3 | Outstanding playtest feedback | Current CHUNK.md | `## Revision Rounds` — most recent `### Revise N` entry's triaged items not yet dispositioned, or an awaiting-playtest state signaled by the Step Checklist's `playtest` item being unchecked while a feedback round is open |
| 4 | Waived verifications | SKETCH.md (scan) | `## Ordered Chunk List` derived-status lines equal to `verified (user-waived)`, batched per CONTEXT.md with a proposed batch playtest |
| 5 | Outstanding asset debts | ASSETS.md | `## Ledger` table, rows where `requested=yes` and `received=no` |
| 6 | Ideas backlog size | SKETCH.md | `## Ideas Backlog` — count of list items |
| 7 | Exact next command | Derived, not read from a file | If current chunk exists and is mid-ceremony → `/bs-build-chunk`; if sketch reshaping was just discussed → `/bs-insert-chunk`; if nothing started → `/bs-ingest-rules`. Mirrors the "every session ends by printing what to run next" rule already stated in bs-skills-plan.md's "The Four Skills" intro and practiced by `ingest-rules.md` Step 7 and `build-chunk.md`'s handoff messages |

## Insert-Chunk's 4 Operations — Mechanics

| Op | What it does | Mechanism |
|----|--------------|-----------|
| (a) Dependency-order revalidation | A chunk citing rules another chunk hasn't built (i.e., a not-yet-`verified`/`verified (user-waived)` chunk) covers is a violation | Compare the moved/new chunk's `- Citations:` (SKETCH.md) / `## Interpretation` citations (CHUNK.md, if detailed) against the ordered position of chunks that cite the same rulebook section/INDEX.md term. Name the specific dependency concretely; propose the minimal reorder that resolves it. Negotiation posture: user's ordering wins unless a HARD dependency is violated (bs-skills-plan.md's "Negotiation posture," repeated at every gate) |
| (b) Closed-chunk citation-overlap diff | Diff the new/edited chunk's citations against every chunk whose status is `verified` or `verified (user-waived)` ("closed") | For each closed chunk, union its `## Interpretation` + `## Newly Discovered Citations` citation set; intersect against the new/edited chunk's citation set; report each overlapping citation with the closed chunk's slug (plan's own example: "chunk `movement` implemented 05-movement.md; your insertion also cites it — that chunk may need a revise round") |
| (c) Stale-marking | Mark any already-detailed PENDING (has a `chunks/<slug>/` directory, status not yet closed) CHUNK.md invalidated by the sketch change | Write `Status: stale — re-derive before build` to that CHUNK.md (write order: this CHUNK.md edit happens before the SKETCH.md version bump in (d), per the universal CHUNK-first rule) — content of the file is NOT wiped, only the Status line changes; `build-chunk.md`'s Step 2 already documents "A chunk whose Status line reads `stale — re-derive before build` stops routing instead" as the consumer behavior |
| (d) Version-stamp bump | Increment `Sketch Version: N` → `N+1` in SKETCH.md | Per SKETCH.template.md's own inline comment: "Bumped by /bs-insert-chunk on every structural change to the ordered chunk list below." This is the LAST write in the operation (SKETCH.md second, per Write Order) — a build session that read the sketch at version N and resumes after this bump can detect the mismatch and knows to re-read |

**Closed-chunk citations are recorded** in each closed chunk's own `chunks/<slug>/CHUNK.md` (`## Interpretation` + `## Newly Discovered Citations`), NOT centrally in `rulebook/INDEX.md` — INDEX.md maps *term → slice file*, not *slug → citations*. insert-chunk's overlap diff must therefore walk each closed chunk's CHUNK.md directly (there is no single pre-built reverse index of "which chunk cited which slice" — INDEX.md is oriented the other way, slice-content-term-based). This is a real cost consideration for insert-chunk if there are many closed chunks; flagged as an **open question** below re: whether to cache/inline this.

## Common Pitfalls

### Pitfall 1: Restating instead of citing
**What goes wrong:** A skill file paraphrases state-machine.md's consistency-check or stale-marker text instead of citing the section name.
**Why it happens:** It feels more "complete" to inline the rule.
**How to avoid:** Follow `ingest-rules.md`'s own explicit self-description ("It does not explain the status enum, the consistency check, the session lock, or template structure inline — see state-machine.md for all of that") verbatim in spirit for both new files.
**Warning signs:** `status-tools.test.ts` failing a "cites X by name" assertion, or the new skill file growing far longer than `ingest-rules.md`'s ~200 lines for a "thin" skill.

### Pitfall 2: Citing a non-existent "Sketch Version" heading
**What goes wrong:** CONTEXT.md's own phrasing groups "Session Lock, Sketch Version / version stamp, Write Order" as if all three are `state-machine.md` headings. `state-machine.md` has no `## Sketch Version` heading — the version stamp is documented only inside `templates/SKETCH.template.md`.
**Why it happens:** The bs-skills-plan.md domain description doesn't distinguish "cited section" from "cited field."
**How to avoid:** Cite `templates/SKETCH.template.md`'s `Sketch Version:` field directly, and cite `state-machine.md`'s `## Write Order` section for the write-order half of the concurrency mechanism. Do not write a citation string like `state-machine.md "Sketch Version"` — it will fail any grep-based drift test looking for that literal heading, because it doesn't exist.
**Warning signs:** A drift test asserting `state-machine.md` contains the substring `Sketch Version` would currently FAIL (it only appears in SKETCH.template.md and bs-skills-plan.md, not state-machine.md) — verified by direct read.

### Pitfall 3: insert-chunk scope creep into build/ingest territory
**What goes wrong:** insert-chunk starts re-running investigate/redteam logic to validate whether a citation conflict is a "real" problem, instead of just flagging it and deferring the decision to a future revise round or the user.
**Why it happens:** The temptation to be "helpful" by resolving the conflict rather than surfacing it.
**How to avoid:** CONTEXT.md is explicit: insert-chunk *flags* overlaps ("may need a revise round") — it does not itself trigger a revise round, dispatch redteam agents, or re-investigate. It's a thin editor; resolution is `/bs-build-chunk`'s job on a later resume.
**Warning signs:** insert-chunk.md growing subagent-dispatch logic identical to `build/redteam.md` or `build/investigate.md`.

### Pitfall 4: check-status performing any write
**What goes wrong:** check-status "helpfully" refreshes the session lock timestamp, or fixes a detected consistency-check problem itself, instead of only reporting.
**Why it happens:** The consistency check's own spec says "problems are reported to the user, who confirms how to proceed" — but "confirms how to proceed" could be misread as "the skill then acts."
**How to avoid:** CONTEXT.md is explicit: check-status is read-only — "never mutates state (no writes beyond nothing)." Any repair (e.g. fixing a SKETCH.md/CHUNK.md contradiction found by the consistency check) is `build-chunk.md`'s job (which already documents "the session logs and repairs the sketch" as part of its own entry flow), not check-status's.
**Warning signs:** status-tools.test.ts's read-only assertion (CONTEXT.md's own required test: "check-status is read-only ... asserts it states/does not instruct state mutation") failing.

### Pitfall 5: Missing "Mandated Chunks" interaction in insert-chunk
**What goes wrong:** insert-chunk allows a reorder/removal that violates SKETCH.template.md's `## Mandated Chunks` invariants (first chunk = core event loop; must contain game-end chunk; must contain final-acceptance chunk as the tail) without flagging it, because CONTEXT.md's decision text doesn't explicitly list this as a 5th validation.
**Why it happens:** The plan's 4 named operations (dependency revalidation, citation-overlap diff, stale-marking, version bump) don't explicitly mention mandated-chunk-invariant preservation.
**How to avoid:** This is not a hard requirement from CONTEXT.md/STAT-02, but is a reasonable extension of "(a) re-validate dependency order" — the planner should decide explicitly whether to fold this into op (a) or leave it out of scope for 147 (deferring to a later phase or to build-chunk's own final-acceptance detection, which already runs "before the generic tail-entry path" per build-chunk.md's Step 2). Flagging as an open question rather than asserting an answer.
**Warning signs:** A user removes/reorders the final-acceptance chunk via insert-chunk and build-chunk.md's Step 2 special-casing silently no longer finds it at the tail.

## Code Examples

### Consistency-check citation idiom (verbatim pattern to reuse)
```markdown
On entry, before any other work, run the consistency check described in `state-machine.md`
("Consistency Check"). Use literal `ls <file>` checks in the current directory, never
`**/glob` patterns that search subfolders.
```
Source: `src/cli/slash-command/bs/build-chunk.md` (Step 0)

### "Next command" forward-reference idiom already shipped, ready to be reversed once 147 lands
```markdown
Tell the user the fuller status view ships as `/bs-check-status` (Phase 147); until it lands,
this summary IS the status behavior.
```
```markdown
forward reference: the insert/reorder behavior ships as `/bs-insert-chunk` (Phase 147). Until it
lands, tell the user reordering is not wired up yet and stop for their decision — never improvise
a reorder by editing `SKETCH.md`'s ordered chunk list ad hoc.
```
Source: `src/cli/slash-command/bs/build-chunk.md` (Step 1). **Actionable for this phase's plan:** once `check-status.md`/`insert-chunk.md` ship, `build-chunk.md`'s Step 1 text above should be updated to route to the new skills instead of self-answering / stopping — this is a real cross-file edit this phase's plan should include (or explicitly defer), since leaving stale forward-references naming "Phase 147" in shipped `build-chunk.md` text after 147 lands is itself drift.

### Drift-test `read()` helper + named-constant pattern (mirror exactly)
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

const STALE_MARKER = 'stale — re-derive before build';
const WAIVED_STATUS = 'verified (user-waived)';
```
Source: `src/cli/slash-command/bs/templates.test.ts` lines 18-52 (STATUS_ENUM_VALUES / STALE_MARKER / SKETCH_LEVEL_MARKER / DERIVED_POINTER_GRAMMAR constants), mirrored again in `ingest.test.ts` lines 25-56 (`SKETCH_LEVEL_MARKER`, `UI_TAG_REGEX`, `REFERENCED_PATHS` array pattern).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `/design-game` monolithic interview skill (3,072-line single instructions.md) | `bs-` skill family: small state-aware skills, each citing a shared `state-machine.md` | This milestone (v4.6), Phase 141 onward | Phase 147 continues the established pattern — no new pattern to invent, only two more instances of it |
| build-chunk.md self-answering "what's left?"/reorder intents inline (Step 1, current placeholder behavior) | Phase 147 should let build-chunk.md's Step 1 delegate to the new skills instead | This phase | Not explicitly in CONTEXT.md's decisions — flagged as an open question below for the plan to resolve |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Whether this phase's plan should also edit `build-chunk.md`'s Step 1 forward-references (to route to the new skills instead of self-answering) is unresolved by CONTEXT.md — treated here as an open question, not asserted as in/out of scope. | Code Examples / State of the Art | If out of scope, `build-chunk.md` keeps saying "ships as Phase 147... until it lands" even after 147 ships — a real, user-visible staleness that a later phase or this one should fix. If in scope, the plan needs an extra task touching a file outside the two new skill files. |
| A2 | Whether insert-chunk should also validate `## Mandated Chunks` invariants (first-chunk/game-end/final-acceptance) as part of dependency revalidation, or leave that entirely to a later phase/build-chunk's own tail-detection. | Common Pitfalls #5 | If the plan skips this and a user removes/reorders the final-acceptance chunk via insert-chunk, build-chunk.md's special-cased tail-detection could silently stop finding it — a real (if rare) breakage, not fatal since it's user-triggered and self-correctable. |
| A3 | Whether insert-chunk's citation-overlap diff should be performed inline (walking each closed chunk's CHUNK.md sequentially) or via a dispatched subagent for cost/scale reasons on games with many closed chunks — CONTEXT.md leaves this to Claude's discretion ("whether insert-chunk dispatches a citation-diff subagent or does it inline ... it's thin — likely inline"). | Insert-Chunk's 4 Operations | Low risk either way; CONTEXT.md already flags this as discretion, not a locked decision requiring user confirmation. |

**Everything else in this research is [VERIFIED: direct file read]** of the actual repo files (`state-machine.md`, `ingest-rules.md`, `build-chunk.md`, `templates/*.template.md`, `bs-skills-plan.md`, `REQUIREMENTS.md`) — no external library/API claims are made in this phase, so there is minimal room for training-data staleness.

## Open Questions (RESOLVED — OQ1: build-chunk.md forward-refs retired in 147-02 T3; OQ2: Mandated-Chunks guard folded into insert-chunk in 147-02)

1. **Should this phase also update `build-chunk.md`'s two Phase-147 forward-reference paragraphs (Step 1) to route into the new skills?**
   - What we know: `build-chunk.md` currently self-answers "what's left?" and stops on reorder intents, explicitly naming "Phase 147" as the future fix in both cases.
   - What's unclear: CONTEXT.md's decisions section doesn't mention touching `build-chunk.md` at all — the File Structure decision lists only the two new skill files + the new test file.
   - Recommendation: the planner should explicitly decide and record this — either (a) add a small task updating build-chunk.md's Step 1 to reference/route to the new skills (closing the loop the forward-reference was written to signal), or (b) explicitly defer it with a comment/TODO, so it isn't accidentally forgotten. Given the "no stale forward-references" hygiene this codebase already practices carefully, leaning toward (a) as a small in-scope task, but this needs a plan-level decision since CONTEXT.md didn't lock it.

2. **Should insert-chunk validate SKETCH.template.md's `## Mandated Chunks` invariants?**
   - What we know: STAT-02's decision text lists exactly 4 operations (dependency revalidation, citation-overlap diff, stale-marking, version bump); Mandated Chunks isn't named.
   - What's unclear: whether an insert/reorder/remove that breaks a mandated-chunk invariant (e.g. removing the game-end chunk, or reordering the final-acceptance chunk off the tail) should be caught here or left to a later phase / build-chunk's own final-acceptance detection.
   - Recommendation: treat as out of scope for 147 unless the planner wants to fold a lightweight check into operation (a)'s "dependency revalidation" — the existing build-chunk.md final-acceptance detection logic (Step 2, "checked BEFORE the generic tail-entry path") already has some resilience since it looks for the chunk by content/position at resume time, not a fixed slug, but that resilience hasn't been proven against an insert-chunk-caused reorder specifically.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependency beyond the existing repo's vitest setup, which is already installed and used by the three existing `bs/*.test.ts` files.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already configured; used by `ingest.test.ts`, `build-chunk.test.ts`, `templates.test.ts`) |
| Config file | repo-root vitest config (already exists — no new config needed) |
| Quick run command | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts` |
| Full suite command | `npx vitest run src/cli/slash-command/bs/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STAT-01 | check-status.md enumerates all 7 report items by name/phrase; cites the correct state-machine.md sections; is read-only (no write-instruction language) | structural drift (string/regex assertions on markdown content) | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts -t "STAT-01"` | ❌ Wave 0 — status-tools.test.ts does not exist yet |
| STAT-02 | insert-chunk.md documents all 4 ops by name; pins `stale — re-derive before build` byte-exact; documents version-stamp bump; documents closed-chunk citation-overlap diff; cites correct state-machine.md sections | structural drift | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts -t "STAT-02"` | ❌ Wave 0 — same file |
| both | Referenced files (state-machine.md, templates/*.template.md) actually exist — no dangling pointers | structural drift, `existsSync` | same test file | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/slash-command/bs/status-tools.test.ts`
- **Per wave merge:** `npx vitest run src/cli/slash-command/bs/` (full bs/ suite, catches any accidental drift in state-machine.md/templates the new skill files might provoke a plan author to "helpfully" edit)
- **Phase gate:** full `bs/` suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/slash-command/bs/status-tools.test.ts` — does not exist; covers STAT-01/STAT-02 per CONTEXT.md's required assertions (both files exist and are non-thin-pointer full content; STAT-01's 7 items enumerated; STAT-02's 4 ops + citation-dep revalidation + closed-chunk overlap diff + stale-marking byte-exact + version-stamp bump present; both cite correct state-machine.md sections; referenced files exist; check-status read-only assertion)
- [ ] `src/cli/slash-command/bs/check-status.md` — does not exist yet (this phase's own deliverable)
- [ ] `src/cli/slash-command/bs/insert-chunk.md` — does not exist yet (this phase's own deliverable)

*(No test-framework install gap — vitest is already wired for this directory via the 3 existing test files.)*

## Security Domain

Not applicable — this phase authors markdown instruction files and a structural drift test consumed by an LLM agent session and vitest respectively. No authentication, session management, access control, input validation, or cryptography surface is introduced. `security_enforcement` config was not found in `.planning/config.json` (only `mode`, `gates`, `safety`, `workflow`, `granularity` keys present) — treating as N/A given the phase's content-only nature; no ASVS categories apply.

## Project Constraints (from CLAUDE.md)

- **No dummy data/fallbacks:** N/A to this phase's content (no runtime data paths), but the skills' own content must not describe fallback/guessing behavior for state-file parse failures — state-machine.md already mandates "stop and ask, never guess" and both new skills must preserve that posture rather than inventing a silent-repair shortcut.
- **Pit of Success:** both skills should make the correct next command obvious (echoing the "every session ends by printing what to run next" rule already established) — the wrong path (leaving the user unsure what to run, or insert-chunk silently resolving a conflict instead of surfacing it) should be structurally hard, matching this phase's CONTEXT.md decisions.
- **Don't add dependencies without discussing:** honored — no new dependencies needed; vitest is already present.
- **Never leave background processes running:** N/A — this phase involves no dev server or long-running process.
- **BoardSmith CLAUDE.md — No Backward Compatibility / clean implementation:** supports treating `build-chunk.md`'s stale Phase-147 forward-references (Open Question 1) as something to actively fix rather than leave stale, consistent with "no deprecation cycles, remove the bad thing and add the good thing."
- **Testing rules (BoardSmith CLAUDE.md):** "verify behavior by running the application, not just reviewing code structure" — for this markdown-authoring phase, the equivalent is running the actual drift test suite (`npx vitest run`), not just eyeballing the new .md files; "write at least one integration test per cross-layer boundary the change touches" — the cross-file boundary here is skill-file ↔ state-machine.md citation-consistency, which `status-tools.test.ts` is exactly designed to cover.

## Sources

### Primary (HIGH confidence — direct file read, this repo)
- `/Users/jtsmith/BoardSmith/.planning/phases/147-bs-check-status-insert-chunk/147-CONTEXT.md` — locked decisions for this phase
- `/Users/jtsmith/BoardSmith/.planning/bs-skills-plan.md` — canonical spec, §"/bs-check-status", §"/bs-insert-chunk", §"Consistency check" (via state-machine authority rules), §"Session lock" (via Git Protocol section), §"UI, Accessibility..." (not directly relevant but read for context)
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/state-machine.md` — full read; exact headings quoted above
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/ingest-rules.md` — full read; structural idiom to mirror
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/build-chunk.md` — partial read (first 120 lines); contains the two Phase-147 forward-references
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/templates/SKETCH.template.md` — full read
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/templates/CHUNK.template.md` — full read
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/templates/ASSETS.template.md` — full read
- `/Users/jtsmith/BoardSmith/.planning/REQUIREMENTS.md` — STAT-01/STAT-02 exact wording, traceability table
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/ingest.test.ts` — partial read; drift-test pattern
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/build-chunk.test.ts` — describe/it names grepped; drift-test coverage breadth pattern
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/templates.test.ts` — partial read; named-constant pattern
- `/Users/jtsmith/BoardSmith/.planning/config.json` — confirms no `security_enforcement` or `nyquist_validation` key set (workflow section present, so nyquist_validation absent → treated as enabled per protocol)

### Secondary / Tertiary
None used — this phase required no external library research, Context7, or WebSearch; the entire domain is internal repo convention already established by prior phases (141-146) and fully readable from source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new stack, existing vitest confirmed present
- Architecture: HIGH — mirrors an established, already-shipped idiom (ingest-rules.md/build-chunk.md) with byte-exact section headings confirmed by direct read
- Pitfalls: HIGH — Pitfall 2 (non-existent "Sketch Version" heading) is a directly-verified, concrete drift risk in CONTEXT.md's own phrasing, not a speculative concern

**Research date:** 2026-07-04
**Valid until:** Stable — this is internal repo convention, not a third-party API; valid until state-machine.md/templates are next revised (no external staleness clock applies). Recommend re-verifying section headings only if Phase 148 (installer wiring) or any later phase touches `state-machine.md`.
