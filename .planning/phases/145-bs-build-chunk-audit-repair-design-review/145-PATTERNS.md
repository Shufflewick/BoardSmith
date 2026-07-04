# Phase 145: `/bs-build-chunk` — Audit & Repair with Design Review - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 5 (3 new reference files + 2 modified: `build-chunk.md`, `build-chunk.test.ts`)
**Analogs found:** 5 / 5

This is a pure markdown-authoring phase (no runtime code). "Role" below maps to the bs- skill
idiom: **reference file** (dispatched step prose), **orchestrator** (router), **test** (drift
pin). "Data flow" maps to: **fan-out/dispatch** (Task-tool subagents), **state-persistence**
(CHUNK.md writes), **process-lifecycle** (server start/serve-check/kill).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `src/cli/slash-command/bs/build/audit.md` | reference file (step prose) | fan-out/dispatch + state-persistence | `src/cli/slash-command/bs/build/redteam.md` | exact (adversarial fresh-context dispatch + round-record persistence) |
| `src/cli/slash-command/bs/build/repair.md` | reference file (step prose) | state-persistence + loop-control | `src/cli/slash-command/bs/build/redteam.md` (escalation logic) + `state-machine.md` "Repair Loop Bound" | exact (the bound/only-new-findings rule already lives in state-machine.md; repair.md applies it exactly as redteam.md applies "Redteam Escalation") |
| `src/cli/slash-command/bs/build/design-review.md` | reference file (step prose) | process-lifecycle (server) + fan-out/dispatch | `src/cli/slash-command/bs/ingest/scaffold.md` (server serve-check-kill sequence) + `src/cli/slash-command/bs/build/redteam.md` (single adversarial dispatch shape) | role-match (server-lifecycle is exact; the "adversarial agent that can fail a chunk" framing borrows redteam's independence idiom, scaled to 1 agent) |
| `src/cli/slash-command/bs/build-chunk.md` (edit: replace 2 forward-ref rows, register 3 files) | orchestrator (router) | routing table edit | itself, prior state (Phase 144 version) | exact (same file, incremental edit — same idiom as the `build`/`test` rows already turned live in Phase 144) |
| `src/cli/slash-command/bs/build-chunk.test.ts` (edit: new describe blocks + REFERENCED_PATHS/FORWARD_REFERENCE_MARKERS updates) | test (drift pin) | content-assertion | itself, prior state — `describe('BUILD-06 — test step', ...)` block is the template for the 3 new blocks | exact (same file, same idiom: `read()` helper inside each `it()`, named field-name constants asserted with `toContain`) |

## Pattern Assignments

### `src/cli/slash-command/bs/build/audit.md` (reference file, fan-out/dispatch)

**Analog:** `src/cli/slash-command/bs/build/redteam.md`

**Header/framing pattern** (redteam.md lines 1-9):
```markdown
# Redteam — Independent Adversarial Review (BUILD-03)

Referenced by `build-chunk.md` Step 3 (`redteam`, second of the `{investigate, redteam, ask}`
session step group — see `state-machine.md` "Session Handoff Seams"). ...
```
Copy this shape for audit.md's header: name the requirement ID (BUILD-07), name the step group
(`{audit, repair}`), cite `state-machine.md` "Session Handoff Seams", and one sentence on what
this step catches that the prior step (`test`) cannot.

**Context-Economics restatement** (redteam.md lines 11-21): redteam.md restates the
Context-Economics Hard Rule "because this is where the temptation is strongest" (re-reading
slices after subagents return). audit.md needs the SAME restatement but for a different
temptation: an audit agent silently reading `## Interpretation` (the settled design) instead of
the raw rulebook slice — this is the "Rulings Outrank Rulebook" / interpretation-blindness rule
from CONTEXT.md, not the same rule redteam.md restates, so do not copy the paragraph verbatim —
copy the *shape* (a callout naming the specific temptation this step faces) and write the
audit-specific content.

**Fresh-context adversarial dispatch pattern** (redteam.md lines 23-39, "Independence:
Fresh-Context, No-Framing Dispatch"):
```markdown
Each of the 3 agents is a SEPARATE Task-tool dispatch. The dispatch prompt for every agent
contains ONLY the raw slice path(s) and the numbered claims list text ... never the
orchestrator's running conversation, never the investigate subagent's own prompt or rationale,
and never a peer agent's verdict.

Concretely: prohibit confidence adjectives in the dispatch prompt. Never write "the investigator
believes this is correct" ...
```
Apply verbatim-in-shape to audit's 3 lenses (+ design-review for ui chunks): each lens is a
SEPARATE Task-tool dispatch; dispatch prompt = raw slice paths + RULINGS.md path + code file
paths (audit.md's specific exclusion: **never** the `## Interpretation` text — this is audit's
own no-framing rule, stronger than redteam's, since even the *investigator's conclusion*, not
just their rationale, must stay out of the dispatch prompt).

**Dispatch Template pattern** (redteam.md lines 41-72, "Three Dispatch Templates" — refuter ×2
+ coverage adversary, each as a fenced prompt block with an explicit "Return exactly: { ... }"
line): copy this exact template shape for audit's 3 lenses. Per Open Question 2 in RESEARCH.md,
follow redteam's field-naming precedent (`claimNumber`, `verdict`, `objection` /
`missingInteractions`) — use flat, grep-able field names: e.g. `findingId` (or let the
orchestrator assign it), `lens`, `description`, `citation`, `severity`.

**Escalation/citation-not-restatement pattern** (redteam.md lines 84-96, "Escalation Logic (cite,
never restate)"):
```markdown
See `state-machine.md` "Redteam Escalation" and "Repair Loop Bound" for the governing rules —
this file does not restate the max-1-round bound or the refuted-twice rule, it applies them
```
audit.md should cite `state-machine.md` "Rulings Outrank Rulebook" the same way (never restate
that rulings outrank the rulebook — apply it: audit agents read RULINGS.md alongside the raw
slice).

**Round persistence pattern** (redteam.md lines 108-134, "Persisting the Round"): the exact
crash-resume discipline audit needs — write at the end of EACH round, before the next step
starts, append-only, with a documented **Resume rule** for what a cold-resume session does when
it finds a partial round. Copy this write-before-next-step + resume-rule shape for audit's
`## Findings Ledger` writes (CHUNK.template.md section, see below) — substituting "Findings
Ledger" wherever redteam.md says "Redteam Rounds."

**Vote-privacy / plain-language triage pattern** (redteam.md lines 136-149, "Vote-Privacy" —
including the concrete example question):
```markdown
Never show the user a raw vote tally or an agent transcript ... When escalation triggers, the
orchestrator distills the disagreement into a single plain-language question with concrete
options, in the register a designer would use, never engine or agent vocabulary:

> "The rulebook doesn't say whether a player who draws a card they can't use has to reveal it.
> Option A: keep it hidden... Option B: reveal it immediately... Or is this a house-rule choice..."
```
This is the exact pattern CONTEXT.md's repair triage requires ("plain-language options, never
raw") — reuse for repair.md's round-3 user triage (see repair.md section below), citing this
same vote-privacy discipline by name rather than re-deriving it.

**Visibility/leak lens — real API to cite** (RESEARCH.md "Code Examples" + `src/testing/view-diff.ts`):
```typescript
import { diffPlayerViews } from 'boardsmith/testing';

const result = diffPlayerViews(testGame, seatA, seatB); // atomic overload — avoids WR-02
// result.onlyInA / result.onlyInB: readable paths visible to exactly one seat
// result.attributeDiffs: attribute-level differences for elements BOTH seats see
// result.describe(): human-readable multi-line summary
```
Complement with `assertNoHiddenInfoLeak()` (`src/testing/dom-leak.ts`, VIS-03) for UI-rendered
leaks. Cite both by exact function name — do not describe the check in prose only (per
RESEARCH.md "Don't Hand-Roll").

---

### `src/cli/slash-command/bs/build/repair.md` (reference file, state-persistence + loop-control)

**Analog:** `src/cli/slash-command/bs/build/redteam.md`'s "Escalation Logic" section +
`state-machine.md` "Repair Loop Bound" (the governing rule repair.md applies, never restates).

**Repair Loop Bound — cite, never restate** (`state-machine.md` lines 121-125):
```markdown
## Repair Loop Bound

- Maximum **3 audit rounds** per chunk.
- Round N+1 auditors see the existing findings ledger (stable IDs) and report **only NEW
  findings** — they do not re-litigate findings already recorded.
- After round 3, any remaining findings are triaged with the user: real blocker, defer to a
  later chunk, or auditor was wrong (refuted).
```
repair.md must cite this section by name (as redteam.md cites "Redteam Escalation") rather than
re-deriving the bound in its own words — same discipline as redteam.md lines 84-96 above.

**Fix-or-refute-with-citation pattern**: no exact prior analog exists for "refute with citation
instead of changing code" (redteam.md's escalation is a *user* dispute-resolution path, not a
refute-in-place-of-fix path) — this is genuinely new prose. Model its shape on `build/build.md`'s
"Extends, Never Restructures" section (a rule that names two allowed outcomes and requires an
explicit record for the non-default one):
```markdown
// Source: src/cli/slash-command/bs/build/build.md, "Extends, Never Restructures"
Restructuring verified code requires a user gate — stop, name the concrete restructuring needed
and why the chunk cannot proceed without it, and get explicit approval before making the change.
```
Apply the same "name it explicitly, record it durably" shape to repair's refute path: a finding
that is refuted-not-fixed must record the citation (rulings/rulebook) directly in the Findings
Ledger entry's disposition, never silently mark it "handled."

**Loop-back-to-audit + session-group boundary** (mirrors `build/test.md` lines 139-144,
"Failures Loop Back to `build`"):
```markdown
## Failures Loop Back to `build`

A failure at any step in the ordered sequence above ... routes this chunk back to `build` (still
session group 2, `{build, test}`); it does not advance to `audit`. `test` and `build` stay in
the same group specifically so a failing test can be fixed without a session handoff in between.
```
Copy this shape exactly for repair→audit: repair and audit are in the SAME session group
(`{audit, repair}` per `state-machine.md` "Session Handoff Seams"), so a repair round that
produces fixes loops back to audit without a session handoff — cite the group boundary the same
way test.md cites its own group.

**Cold-resume rule for a crashed repair round** (mirrors redteam.md's "Resume rule" at lines
125-134): "each round's results persist to CHUNK.md before the next starts" (CONTEXT.md) — write
the round's dispositions into the Findings Ledger BEFORE dispatching the next audit round, per
the exact write-before-next-step discipline redteam.md's "Persisting the Round" section
establishes.

---

### `src/cli/slash-command/bs/build/design-review.md` (reference file, process-lifecycle + fan-out/dispatch)

**Analog (server lifecycle):** `src/cli/slash-command/bs/ingest/scaffold.md` — NOT `build/test.md`
(test.md never starts a server). scaffold.md's numbered serve-check-kill sequence (lines 70-124)
is the exact precedent:

```markdown
// Source: src/cli/slash-command/bs/ingest/scaffold.md, "Verification Sequence" steps 2-3
2. **Serve-check** — start the dev server in non-interactive mode and confirm it actually serves:

   \`\`\`bash
   npx boardsmith dev --no-open
   \`\`\`

   `--no-open` suppresses the browser auto-launch ... Wait for the exact ready-state line before
   considering the server up:

   \`\`\`
   Ready! Press Ctrl+C to stop.
   \`\`\`

   (Emitted by `src/cli/commands/dev.ts`; the drift test pins this string against the source, so
   trust it verbatim.) As an additional confirmation, curl the resolved dev-server URL and
   confirm a non-error response. If the ready-state line never appears (or the curl fails), treat
   this as a scaffold failure — stop and report the actual server output ...

3. **Kill the process** — this is an explicit, numbered step in the SAME sequence as steps 1-2,
   never a footnote or an afterthought left for later. Kill the dev server process you started in
   step 2 ... before this skill proceeds to any further step. Leaving a dev server running after
   the check is a repo-wide hard rule violation (`CLAUDE.md`: "Don't leave a dev server running
   that you start.")
```
Copy this exact 3-step shape (serve → confirm-ready-line-plus-curl → explicit numbered kill) for
design-review.md's dev-host lifecycle. Always use `--no-open` (Pitfall 4 in RESEARCH.md — without
it the machine's real browser steals seat 1).

**Never-networkidle caveat** — pin this exact instruction into design-review.md, sourced from the
user's global CLAUDE.md rule (already summarized in RESEARCH.md Pitfall 3): wait on
`domcontentloaded`, the `load` event, or a specific selector — never `networkidle`, since the
dev-host holds an open WebSocket and never reaches idle.

**Single adversarial agent, same independence discipline as redteam/audit** (borrow shape from
redteam.md lines 23-39, scaled to 1 dispatch instead of 3): the design-review agent is a fresh
Task-tool dispatch with no inherited conversation, no build/investigate framing — it reads
DESIGN.md + the chunk's own code fresh, takes its own screenshots, and returns findings
independently; findings land in the SAME Findings Ledger the audit lenses write to (per
CONTEXT.md), via the orchestrator, never a separate track.

**Breakpoints and iframe-resize caveat** (RESEARCH.md Pitfall 2, sourced from project memory
`custom-ui-responsive-sizing`): after `iframe.style.width` is set for the compact breakpoint,
`iframe.contentWindow.location.reload()` must be called so the board remeasures — ResizeObserver
does not fire on programmatic iframe resize. Cite `src/ui/theme.ts`'s `BREAKPOINTS` constant
(compact:640, medium:1024, wide:1440) by exact name.

**Theme-toggle mechanism** (RESEARCH.md Pitfall 1): no UI button exists; set
`document.documentElement.dataset.theme` (or the GameShell iframe's own `contentDocument`,
per the pitfall's document-scoping note) via script injection, not a click.

**Findings destination** — cite `CHUNK.template.md`'s `## Findings Ledger` (see next section)
by name; design-review.md does not restate the ledger's stable-ID/round-aware structure, only
states that its findings land there through the orchestrator.

---

### `bs/templates/CHUNK.template.md` `## Findings Ledger` section (existing — audit/repair fill it)

**Analog:** the section already exists (CHUNK.template.md lines 102-111) — no new template
section is created; audit.md and repair.md must cite it exactly as written, never restructure:

```markdown
## Findings Ledger
<!-- Populated by audit. Each finding gets a stable ID (e.g. F1, F2, ...) that never changes or
     gets reused. Round N+1 auditors read this ledger and report ONLY NEW findings — they do not
     re-litigate findings already recorded here. Max 3 audit rounds total (see
     state-machine.md "Repair Loop Bound"); after round 3, remaining findings are triaged with
     the user: real blocker, defer to a later chunk, or auditor was wrong (refuted). -->

<!-- ### Audit Round 1
- F1: <!-- finding --> — disposition: <!-- fixed | deferred | refuted -->
-->
```
This is the "## Redteam Rounds" precedent applied to audit — same stable-ID + append-only +
disposition-column shape (compare to CHUNK.template.md lines 86-100, `## Redteam Rounds`, which
audit.md/repair.md should reference as the sibling precedent when explaining the ledger's shape
to a reader unfamiliar with it, without altering either section).

---

### `src/cli/slash-command/bs/build-chunk.md` (edit: routing table + Reference Files list)

**Analog:** itself, prior state (the `build`/`test` rows already went from forward-reference to
live dispatch in Phase 144 — the exact precedent for this phase's audit/repair rows).

**Forward-reference row → live dispatch pattern** (build-chunk.md lines 116-136, current dispatch
table + surrounding prose):
```markdown
| audit | `build/audit.md` — authored in Phase 145 |
| repair | `build/repair.md` — authored in Phase 145 |
```
becomes (mirroring how `build`/`test` rows read now, lines 123-124):
```markdown
| audit | `build/audit.md` |
| repair | `build/repair.md` |
```
And the surrounding sentence ("Steps 6–10 are named here as forward references only...") must be
edited to drop audit/repair from the forward-reference set while retaining playtest/revise/close
— follow the exact edit shape the Phase 144 diff already applied when `build.md`/`test.md`
graduated (visible in the current file's own prose: "`build/build.md` and `build/test.md` are now
live dispatches").

**Reference Files list registration** (build-chunk.md lines 244-265): add
`build/audit.md`, `build/repair.md`, `build/design-review.md` bullets in the same one-line
descriptive style as the existing entries (e.g. `` `build/test.md` — the test-step command
sequence, sandbox-rule gate, a11y floor for UI chunks``), and remove them from the "forward-
referenced only" list at the bottom (lines 258-264), keeping only
`build/playtest.md`/`build/revise.md`/`build/close.md` there.

---

### `src/cli/slash-command/bs/build-chunk.test.ts` (edit: 3 new describe blocks + list updates)

**Analog:** itself, prior state — the `describe('BUILD-06 — test step', ...)` block (lines
337-356) and `describe('UIQ-03 — a11y floor', ...)` block (lines 392-403) are the direct template
for the 3 new blocks (`BUILD-07`, `BUILD-08`, `UIQ-04`):

```typescript
// Source: src/cli/slash-command/bs/build-chunk.test.ts, lines 337-356
describe('BUILD-06 — test step', () => {
  it('names the exact command tokens', () => {
    const test = read('build/test.md');
    expect(test).toContain('tsc --noEmit');
    expect(test).toContain('boardsmith lint');
    expect(test).toMatch(/full.{0,20}(accumulated )?suite|regression/i);
    expect(test).toContain('simulateRandomGames');
  });
  ...
});
```
Copy this exact shape: `read()` called INSIDE each `it()` (never at describe-level, per the file's
own header comment lines 22-23), asserting concrete phrase/string pins, not vague `toMatch`-only
checks. Per CONTEXT.md's pin list, `describe('BUILD-07 — audit', ...)` must assert: the 3 lens
names, the never-reads-interpretation rule, `diffPlayerViews`/`assertNoHiddenInfoLeak` cited by
exact name. `describe('BUILD-08 — repair', ...)` must assert: max-3-round + only-new-findings
phrase, refute-with-citation phrase, citation of "Repair Loop Bound". `describe('UIQ-04 —
design-review', ...)` must assert: `chunks/<slug>/shots/` path string, the server-kill
instruction, the 3×2 breakpoint/theme grid (6 shots), `--no-open`.

**`REFERENCED_PATHS` update** (lines 95-106): add the 3 new paths, following the existing array
literal shape exactly.

**Exclusion-list update** (lines 472-483, `'REFERENCED_PATHS does NOT include any Phase 145-146
step file'`): remove `'build/audit.md'` and `'build/repair.md'` from the `excluded` array,
keeping only `'build/playtest.md'`, `'build/revise.md'`, `'build/close.md'` — this test's own
`it()` title should also be edited (it currently says "Phase 145-146"; after this phase it
should read "Phase 146" only, matching the file's own header-comment convention of naming which
phase each block belongs to, lines 16-20).

**`FORWARD_REFERENCE_MARKERS` becomes phase-146-only, or split** (lines 108-112,
434-439 test): per RESEARCH.md Wave 0 Gaps, the "carries the three forward-reference markers"
test (currently pinning both `'authored in Phase 145'` and `'authored in Phase 146'`) must
become a single-marker assertion (`'authored in Phase 146'` only) once the audit/repair rows in
`build-chunk.md` drop their "authored in Phase 145" text — follow the same file's existing
`STATUS_ENUM_VALUES`/`STALE_MARKER`-style single-purpose constant pattern when narrowing this.

## Shared Patterns

### Fresh-Context Adversarial Dispatch (no framing, no peer-verdict leakage)
**Source:** `src/cli/slash-command/bs/build/redteam.md`, "Independence: Fresh-Context, No-Framing
Dispatch" (lines 23-39) + "Three Dispatch Templates" (lines 41-72)
**Apply to:** `audit.md`'s 3 lenses, `design-review.md`'s single dispatch
```markdown
Each ... is a SEPARATE Task-tool dispatch. The dispatch prompt for every agent contains ONLY the
raw slice path(s) [+ RULINGS.md + code paths for audit] — never the orchestrator's running
conversation, never [a peer's/the investigator's] framing or rationale.
```

### Server Serve-Check-Kill Sequence
**Source:** `src/cli/slash-command/bs/ingest/scaffold.md`, "Verification Sequence" steps 2-3
(lines 92-119)
**Apply to:** `design-review.md`'s dev-host lifecycle
```bash
npx boardsmith dev --no-open
# wait for: "Ready! Press Ctrl+C to stop."   (drift-test-pinned string, src/cli/commands/dev.ts)
# curl the resolved URL as additional confirmation
# ... drive the browser tool ...
kill %1   # explicit numbered step, never a footnote
```

### Cite-Governing-Rule-Never-Restate (state-machine.md as single source of truth)
**Source:** `src/cli/slash-command/bs/build/redteam.md`, "Escalation Logic (cite, never
restate)" (lines 84-96); `src/cli/slash-command/bs/build/build.md`'s "Git Protocol (cite, never
restate)" (lines 66-74) is a second instance of the same idiom.
**Apply to:** `audit.md` citing "Rulings Outrank Rulebook"; `repair.md` citing "Repair Loop
Bound"; both citing `state-machine.md` "Session Handoff Seams" for the `{audit, repair}` group
boundary.

### Round Persistence: Write-Before-Next-Step + Explicit Cold-Resume Rule
**Source:** `src/cli/slash-command/bs/build/redteam.md`, "Persisting the Round" (lines 108-134)
**Apply to:** `audit.md` writing `### Audit Round N` to `## Findings Ledger` before repair
starts; `repair.md` writing each round's dispositions before the next audit round is dispatched.

### Plain-Language Triage / Vote-Privacy (never raw agent output to the user)
**Source:** `src/cli/slash-command/bs/build/redteam.md`, "Vote-Privacy" (lines 136-149,
including the concrete example question format)
**Apply to:** `repair.md`'s round-3 user triage (real blocker / defer / auditor wrong) —
presented as plain-language options in designer register, never raw findings text or agent
verdicts.

### Never `networkidle` on the Dev-Host
**Source:** user's global `~/CLAUDE.md` ("Real-time SPAs... NEVER reach 'network idle'") — no
in-repo file states this yet; this phase is the first to encode it into a `bs-` skill file.
**Apply to:** `design-review.md` exclusively (the only new file that drives a browser against a
live dev-host).

## No Analog Found

None — every file in this phase's scope has at least a role-match analog (see table above). The
one genuinely novel piece of prose (repair's fix-or-refute-with-citation branch) has no exact
prior analog but is modeled on `build/build.md`'s "Extends, Never Restructures" shape (name the
non-default path explicitly, require a durable record) rather than left unguided.

## Metadata

**Analog search scope:** `src/cli/slash-command/bs/` (build/, ingest/, templates/,
state-machine.md, build-chunk.md, build-chunk.test.ts) — the entire `bs-` skills tree; no other
directory in the repo contains a comparable idiom.
**Files scanned:** 8 (redteam.md, test.md, scaffold.md, build.md, CHUNK.template.md,
build-chunk.md, build-chunk.test.ts, state-machine.md)
**Pattern extraction date:** 2026-07-04
