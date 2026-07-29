# Phase 173 — Proof

## 1. Wave-1 gate — ingest-archive adoption (decision 1b)

GATE: PASSED

Reusable gate script: `${TMPDIR:-/tmp}/173-proof/173-gate.sh` (re-runnable; exits non-zero on the
first failed assertion). Full verbatim transcript of the run that produced this section:
`${TMPDIR:-/tmp}/173-proof/173-gate-output.txt` (970 lines). All commands below ran against `cp -R`
copies under `${TMPDIR:-/tmp}/173-proof/{seven,one-two-punch}` — never against
`~/BoardSmithGames/*` directly.

### Preflight (on the ORIGINALS, before any copy)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```
(one-two-punch is NOT asserted porcelain-empty, per the read-only invariant's documented
exception for its pre-existing unrelated deletions.)

Whole-tree sha256 manifests captured to `manifest-seven.before` (3919 files) and
`manifest-otp.before` (4134 files).

### seven — BEFORE

```
$ cat rulebook/INDEX.md   (first 6 lines)
# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
transcription subagents' returned `citedTerms[]` lists; the slices themselves are the authority.
```

```
$ computeVerificationScope(copy)
{"scope":"code-conformance-only","reason":"pre-provenance-project","edition":"not stated in the rulebook"}
```
GATE-ASSERT-PASS: seven BEFORE scope is code-conformance-only (pre-provenance-project)

### seven — RUN

```
$ boardsmith ingest-archive rules.pdf --project <copy> --json    (no --edition)
{
  "archivedPath": "rulebook/source/rules.pdf",
  "sourceHash": "5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880",
  "indexPath": "rulebook/INDEX.md",
  "wroteIndex": false
}
```

### seven — AFTER

```
$ cat rulebook/INDEX.md   (first 9 lines)
# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: rulebook/source/rules.pdf
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
Transcribed: 2026-07-28
`rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
transcription subagents' returned `citedTerms[]` lists; the slices themselves are the authority.
```

BEFORE/AFTER diff (the only changes are three INSERTED canonical header lines; the wrapped prose
is rejoined intact one line lower, with only its `Source: ` label prefix stripped):

```diff
5c5,8
< Source: `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
---
> Source: rulebook/source/rules.pdf
> Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
> Transcribed: 2026-07-28
> `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
```

```
$ computeVerificationScope(copy)
{"scope":"full","edition":"not stated in the rulebook","sourcePath":"rulebook/source/rules.pdf","sourceHash":"5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880"}
```

Independent cross-checks (each computed by a second method, never trusting the command's own output):

| Assertion | Result |
|---|---|
| `computeVerificationScope` reports `full` | PASS |
| exactly one `^Source hash:` line | PASS (count = 1) |
| `Source hash:` value == `shasum -a 256 rulebook/source/rules.pdf` | PASS — both `5138858e...337880` |
| `Edition:` byte-identical to BEFORE | PASS |
| `Source hash:` well-formed (`[0-9a-f]{64}`) | PASS |
| `Transcribed:` well-formed (`YYYY-MM-DD`) | PASS — `2026-07-28` |
| second `ingest-archive` run produces byte-identical INDEX.md | PASS |

Real chunk-level demonstration — `chunk-check best-seven-selection` (repair-first-fail-second by
design, so its own exit code 1 on first run is expected, not a gate failure):

```
{
  "slug": "best-seven-selection",
  "scope": "full",
  "changed": true,
  "citedSlices": ["rulebook/01-definitions-and-components.md", "rulebook/01-overview-setup-and-play.md"],
  "unresolved": ["rulebook/INDEX.md"]
}
```
`chunk-provenance-status` afterward shows `best-seven-selection` at `"state": "full"` (verified
independently via `python3 -c` reading the JSON, asserting on that one slug's `state` field).

**GATE: PASSED (seven)**

---

### one-two-punch — BEFORE

`one-two-punch`'s `INDEX.md` carries NO `Source:` line at all — the "absent" case, distinct from
`seven`'s wrapped-prose case, and it exercises a different branch of the fix:

```
$ cat rulebook/INDEX.md   (first 8 lines)
# Rulebook Index — 1-2 Punch

Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)

Term → slice cross-reference. Built from the `citedTerms[]` returned by the transcription pass.

| Term | Slice |
|---|---|
```

```
$ computeVerificationScope(copy)
{"scope":"code-conformance-only","reason":"pre-provenance-project","edition":"not stated in the rulebook"}
```
GATE-ASSERT-PASS: one-two-punch BEFORE scope is code-conformance-only (pre-provenance-project)

### one-two-punch — RUN

```
$ boardsmith ingest-archive rules.pdf --project <copy> --json    (no --edition)
{
  "archivedPath": "rulebook/source/rules.pdf",
  "sourceHash": "e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea",
  "indexPath": "rulebook/INDEX.md",
  "wroteIndex": false
}
```

### one-two-punch — AFTER

```
$ cat rulebook/INDEX.md   (first 6 lines)
# Rulebook Index — 1-2 Punch

Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)
Source: rulebook/source/rules.pdf
Source hash: e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea
Transcribed: 2026-07-28
```

BEFORE/AFTER diff — three lines INSERTED immediately after `Edition:`, nothing else touched:

```diff
3a4,6
> Source: rulebook/source/rules.pdf
> Source hash: e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea
> Transcribed: 2026-07-28
```

```
$ computeVerificationScope(copy)
{"scope":"full","edition":"not stated in the rulebook","sourcePath":"rulebook/source/rules.pdf","sourceHash":"e28d18756e976a437b81e10e6944f90842e7aa1d26b8102221a54769b4358eea"}
```

Independent cross-checks:

| Assertion | Result |
|---|---|
| `computeVerificationScope` reports `full` | PASS |
| exactly one `^Source hash:` line | PASS (count = 1) |
| `Source hash:` value == `shasum -a 256 rulebook/source/rules.pdf` | PASS — both `e28d1875...358eea` |
| `Edition:` byte-identical to BEFORE | PASS — `none stated in the rulebook — © 2020 Alright Games (transcribed from \`rules.pdf\`, 2 pages)` |
| `Source hash:`/`Transcribed:` well-formed | PASS |
| second `ingest-archive` run byte-identical | PASS |

Real chunk-level demonstration — `chunk-check ai-opponent`:

```
{
  "slug": "ai-opponent",
  "scope": "full",
  "changed": true,
  "citedSlices": [],
  "unresolved": []
}
```
`chunk-provenance-status` afterward shows `"projectProvenanceState": "partial"` (flipped from
`pre-provenance` the moment the FIRST chunk in the project acquires a block — see the Hedge
Refutation note below) and `ai-opponent` at `"state": "full"`.

**GATE: PASSED (one-two-punch)**

---

### Originals re-verification (post-run)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```

Whole-tree sha256 manifest diff, before vs. after, both games: **empty** (byte-identical, 3919
and 4134 files respectively, zero differences).

**GATE: PASSED**

---

### Hedge refutation: `chunk-provenance-status`'s project-level state does NOT flip to
### "no longer pre-provenance" from this fix alone

CONTEXT.md decision 1b's original write-up states the payoff check as "`chunk-provenance-status`
still reports `pre-provenance` afterward" as evidence the (pre-fix) defect existed. Reading
`chunk-provenance.ts`'s own doc comment on `projectProvenanceState` (line ~684) makes clear this
is a *different, unrelated* concept from `computeVerificationScope`'s INDEX-level scope:
`projectProvenanceState` is `'pre-provenance'` when **no chunk in the project has ever had
`chunk-check` run on it** — a per-chunk fact, entirely independent of whether `INDEX.md` carries a
`Source hash:` line. The same file explicitly documents "Both reference games are in this state
(12 and 17 chunks, 100% flagged)" as their PERMANENT expected condition until a later phase's
`chunk-check` sweep runs — which is out of this plan's scope (chunk-level re-verification is
Phase 174+ business).

Empirically confirmed above: `chunk-provenance-status --project <copy> --json` reports
`"projectProvenanceState": "pre-provenance"` for BOTH games both BEFORE and immediately AFTER the
`ingest-archive` fix runs — the fix alone never flips it, by design, because it never touches
`chunks/`. It only flips (to `"partial"`) once at least one `chunk-check <slug>` is separately
invoked, which this gate does once per game (§ "Real chunk-level demonstration" above) purely to
demonstrate the CLI-visible downstream effect of the INDEX.md fix — not because the plan requires
project-wide chunk-check here.

**The actual, authoritative payoff check — used as the primary gate assertion above — is
`computeVerificationScope(projectDir)` returning `{ scope: 'full' }`, exactly as
`173-PATTERNS.md`'s "Downstream proof target" and Task 1's B10 test specify.** This is not a
fixture bug or a plan deviation; it is the same class of finding as `MEMORY.md`'s "Plan-checker
empirical refutation" precedent — a scout-stage hedge (the literal `pre-provenance` wording)
turned out to describe a symptom that persists independent of this fix, and the empirically
verified, code-level payoff check (`computeVerificationScope`) is what actually gates decision 1b.

---

## What is still unproven (as of wave 1)

Per `173-VALIDATION.md`, three live-session proofs remained outstanding, owed by later plans in
this phase: SC-2/SC-3 (owned by plan 173-06, now closed) and SC-4 (owned by plan 173-07, now
closed). **Superseded** — see the final, phase-wide `## What is still unproven` section at the end
of this document for the authoritative, post-phase list; this note is kept in place only as a
historical record of wave 1's own handoff.

This wave-1 gate (decision 1b) is the sole prerequisite all three depend on; it is now closed.

---

## 2. SC-1 — bs-verify-game installs, project untouched

GATE: PASSED

Reusable script: `${TMPDIR:-/tmp}/173-proof/173-sc1.sh` (re-runnable, exits non-zero on the first
failed assertion). All commands below ran against a fresh `cp -R` copy of `~/BoardSmithGames/seven`
under `${TMPDIR:-/tmp}/173-proof/seven` — never against the original.

### Preflight (originals, before any copy — this plan's own pass, independent of wave 1's)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```

Fresh whole-tree sha256 manifests captured to `manifest-seven.plan06.before` (3919 files) and
`manifest-otp.plan06.before` (4134 files) — identical file counts to wave 1's captures, confirming
no drift occurred between plans.

Removed leftover copies from plan 173-01's harness, then `cp -R` both games in fresh.

### seven copy — pre-install state

`seven`'s original is untouched by any prior plan (wave 1's `ingest-archive` gate ran only against
disposable copies), so the fresh copy is still pre-provenance:

```
$ cat rulebook/INDEX.md | head -6
# Rulebook Index — Seven

Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation

Source: `rules.pdf` (2 pages). ...
$ ls rulebook/source
ls: rulebook/source: No such file or directory
```

This is Case 2 of `verify/source-resolution.md` (single unarchived candidate at root) — exactly
the case task 2's live pass exercises.

### Real install

```
$ cd <copy>/seven && npx boardsmith claude --local --force
✓ BoardSmith linked globally
✓ Installed BoardSmith skills for Claude Code

  Location: <copy>/seven/.claude/skills
  BoardSmith: /Users/jtsmith/BoardSmith

Skills:
  bs-create-game   - Start a new game — from an idea or a rulebook (start here)
  bs-ingest-rules  - Ingest a rulebook and produce the initial sketch/chunk plan
  bs-build-chunk   - Build, test, audit, and playtest one chunk at a time
  bs-check-status  - Report sketch/chunk progress and next steps
  bs-insert-chunk  - Insert a new chunk into an existing sketch
  bs-generate-ai   - Generate AI evaluation functions for a game chunk
  bs-verify-game   - Re-verify an existing game against its archived rulebook source
```

### Independent assertions (never trusting the installer's own console output)

| Assertion | Method | Result |
|---|---|---|
| `bs-verify-game/SKILL.md` exists in installed tree | `[ -f ... ]` | PASS |
| installed `SKILL.md` byte-identical to repo source | `diff` against `src/cli/slash-command/bs/verify-game.md` | PASS |
| every file in `src/cli/slash-command/bs/verify/` exists under installed `bs-shared/verify/` | `ls` listing comparison, not hardcoded names — both list exactly `source-resolution.md`, `staging-dispatch.md` | PASS |
| other six skills present (no regression) | `[ -d ... ]` per skill | PASS |

Post-install whole-tree sha256 manifest captured to `manifest-seven.post-install` (3959 files —
3919 originals + 40 newly-installed `.claude/skills/**` files). The only new paths are under
`.claude/skills/`; every `rulebook/*` path's hash is unchanged from the pre-install copy — install
itself changed nothing in the game (confirmed again, more rigorously, as part of task 2's SC-2
manifest diff, which diffs against this exact file).

**GATE: PASSED (SC-1)**

---

## 3. SC-2 / SC-3 — a live verify pass

GATE: PASSED, with one critical bug found and fixed live, and several finding-worthy gaps
recorded below. This section reports what actually happened, not a smoothed-over clean run.

Reusable script: `${TMPDIR:-/tmp}/173-proof/173-sc23.sh` (re-runnable against this pass's captured
artifacts; exits non-zero on first failure). Full verbatim transcript:
`${TMPDIR:-/tmp}/173-proof/173-transcript.log` (731 lines). Raw dispatch/return capture:
`${TMPDIR:-/tmp}/173-proof/dispatch-prompt-01.txt`, `subagent-01-return.txt`.

### How this pass was actually run

The plan's objective calls for dispatching real transcription subagents "via the Agent tool."
**This execution environment does not expose an internal Task/Agent tool to this session** — the
executor's available tools are Read/Write/Edit/Bash only. Rather than fake dispatch (forbidden —
"never use dummy data, fallbacks, or other hacks") or silently skip SC-3 (forbidden — "report what
happened"), a real `claude -p` subprocess was used as the closest faithful equivalent: a genuine
OS-level process boundary with no inherited conversation history, whose only channel back to this
session is captured stdout. This is reported here as a real constraint, not smoothed into "used the
Agent tool as instructed."

The pass otherwise followed `bs-verify-game/SKILL.md` and its `bs/verify/*.md` delegates as actual
file reads from the **installed copy** (`<copy>/.claude/skills/...`), not from this plan's summary
of them, per the plan's explicit instruction.

### Step 0 — State Detection and Lock

Consistency check: `SKETCH.md` present, `rulebook/` present, existing lock line released (`none`,
with a parenthetical note) — no stale-lock warning needed.

**FINDING (skill-text ambiguity):** Step 0's lock identity is documented as `verify:<run-id>`, but
`run-id` is minted by `verify-run-init` in Step 2 — after Step 0 runs. Step 0 cannot literally
compose a lock naming a run-id that doesn't exist yet. Resolution taken: lock taken with a
placeholder `verify:pending` identity at Step 0 (`date -u` timestamp, per the mandated source),
then refreshed to the real run-id once Step 2 minted it. This is an improvisation the skill text
does not specify; not smoothed over.

```
Session Lock: verify:pending @ 173-06-live-proof — locked at 2026-07-28T23:02:39Z
   (later refreshed to)
Session Lock: verify:2026-07-28T23-06-04Z @ 173-06-live-proof — locked at 2026-07-28T23:06:08Z
```

### Step 1 — Source Resolution: a real bug, found live and fixed

```
$ boardsmith chunk-provenance-status --project <copy> --json
projectProvenanceState: pre-provenance
$ ls <copy>   (project root, no glob)
... rules.pdf ...   (exactly one candidate)
```

Case 2 applies. **STOP AND ASK gate note:** this proof session has no human designer present — the
executing agent stood in as the confirming party for this proof run only, the same posture wave 1's
gate script took. Recorded explicitly, not silently treated as a real designer confirmation.

```
$ boardsmith ingest-archive rules.pdf --project . --json
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"5138858e...337880","indexPath":"rulebook/INDEX.md","wroteIndex":false}
```

**CRITICAL LIVE FINDING — `source-resolution.md`'s post-adoption re-check condition was wrong.**
Its literal text said to re-run `chunk-provenance-status --json` and CONFIRM `projectProvenanceState`
changed away from `"pre-provenance"`, STOPPING and reporting false-success if it hadn't. Run live:

```
$ boardsmith chunk-provenance-status --project <copy> --json
projectProvenanceState: pre-provenance      <-- STILL pre-provenance, per the literal gate
```

But adoption had genuinely succeeded by every other measure:

```
$ node scope-check.mjs <copy>     (computeVerificationScope — 173-VALIDATION.md's own corrected
                                    authoritative check, established in wave 1)
{"scope":"full","edition":"not stated in the rulebook","sourcePath":"rulebook/source/rules.pdf","sourceHash":"5138858e...337880"}
$ shasum -a 256 rulebook/source/rules.pdf
5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880
$ grep "^Source hash:" rulebook/INDEX.md
Source hash: 5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880   (matches)
```

**Root cause:** `projectProvenanceState` tracks a *different, per-chunk* fact — whether any chunk
has ever had `chunk-check` run on it — and never flips from `ingest-archive` alone; only a later,
separate `chunk-check` invocation changes it. This exact distinction is already documented in this
file's own wave-1 "Hedge Refutation" section, and `173-VALIDATION.md` was corrected at the time to
name `computeVerificationScope()` as the authoritative check instead. But plan 173-04, writing
`source-resolution.md` in wave 3, used `chunk-provenance-status`'s field anyway — the exact one
already proven wrong for this purpose. All 36 of 173-04's string-presence tests passed because they
only assert the text mentions these strings; none of them ran a real adoption and followed the
re-check live. **Consequence: following the skill text literally, a live `/bs-verify-game` session
would STOP and report a false-success failure on every single successful Case-2 adoption, forever.**
This is precisely the class of defect this whole live-proof plan exists to catch, and precisely the
kind no `.toContain()` test could ever find.

**Fix applied (Rule 1, auto-fix — a live-session-discovered bug):** `src/cli/slash-command/bs/verify/source-resolution.md`
rewritten to re-check `rulebook/INDEX.md`'s `Source hash:` line directly (matching
`computeVerificationScope`'s own disk-state test) and to explicitly forbid using
`chunk-provenance-status`'s `projectProvenanceState` for this purpose, citing the reason. The
installed copy was re-synced from the fixed source so the rest of this live pass proceeded under
corrected text. `verify.test.ts` updated with a new pinning assertion plus a regression test naming
this exact finding; **37/37 green** (was 36/36). See commit list at the end of this section.

Re-run under the fixed text: `Source hash:` present, well-formed, and matches a fresh `shasum`;
`Edition:` preserved byte-identical to BEFORE. Step 1 completes cleanly.

### Step 2 — Staging Run and Re-Transcription

```
$ boardsmith verify-run-init --project <copy> --json
{"runId":"2026-07-28T23-06-04Z","stagingDir":"rulebook/.verify/2026-07-28T23-06-04Z/slices","ledgerPath":"rulebook/.verify/2026-07-28T23-06-04Z/RUN.md","created":true}
$ boardsmith verify-run-status --project <copy> --run-id 2026-07-28T23-06-04Z --json
{"runId":"2026-07-28T23-06-04Z","stagingDir":"...","recorded":[],"count":0}
```

Fresh run, `recorded: []` — dispatch needed for the whole (2-page) rulebook.

**FINDING (skill-text gap):** `staging-dispatch.md`'s Dispatch section unconditionally says
"dispatch one Task-tool subagent" per unit, unlike its sibling `ingest/transcription.md`, which
explicitly permits the orchestrator to transcribe a 1-3 page rulebook inline without dispatching.
`staging-dispatch.md` never carries this exception forward — genuinely ambiguous for `seven`'s
2-page rulebook. Real dispatch was used rather than improvising the inline exception into a file
that doesn't state it.

**Dispatch** — the exact `BS-DISPATCH-V2` pointer block, byte-identical to `staging-dispatch.md`'s
template except the three named substitutions, sent verbatim to a real subprocess:

```
BS-DISPATCH-V2

Read `<installed-contract-path>/ingest/transcription-subagent.md` in full and follow it exactly.

Your page range: 1-2
Rulebook path:   rulebook/source/rules.pdf
Write slices to: rulebook/.verify/2026-07-28T23-06-04Z/slices

You additionally own the rulebook's opening pages: also return the top-level `edition` field
described in the contract.
```

The subagent returned (exit 0) a structured summary only: `edition: null`, six `{ slicePath,
sectionSummary, citedTerms[], componentMentions[], visualEvidence[], variants[], openGaps[],
nextStep }` records. **Grepped independently for slice-body markers — zero matches**:

```
$ grep -c '^p\.[0-9]*,' subagent-01-return.txt        -> 0 (exit 1, no match)
$ grep -c '^Derived (p\.' subagent-01-return.txt       -> 0 (exit 1, no match)
$ grep -c '^Visual (p\.' subagent-01-return.txt        -> 0 (exit 1, no match)
```

The six staged files were confirmed present on disk (not inferred from the return):

```
rulebook/.verify/2026-07-28T23-06-04Z/RUN.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-about-and-setup.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-definitions.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-distribution-of-cards.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-game-end-and-match.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-round.md
rulebook/.verify/2026-07-28T23-06-04Z/slices/02-solo-variant.md
```

An independent auditor spot-check (kept in a **separate** file, `173-auditor-spotcheck.txt`,
deliberately excluded from `173-transcript.log` so it never contaminates the SC-3 zero-grep target)
confirms the staged file genuinely carries real `QUOTE`/`Derived (p.`/`Visual (p.` lines — proving
the write was real, not a stub, and that the transcript's absence is a genuine absence rather than
an artifact of an empty capture:

```
rulebook/.verify/2026-07-28T23-06-04Z/slices/01-round.md (excerpt):
p.1, Round (Simultaneous):
Each player draws 2 cards into their hand.
...
Derived (p.1): Rounds are simultaneous — there is no turn order; ...
Visual (p.1): The heading "Round" is bold with the qualifier "(Simultaneous)" ...
```

**Recording** — all six units recorded via `verify-run-record`, using the subagent's returned
`slicePath` fields (never by opening the file):

```
$ boardsmith verify-run-record --run-id 2026-07-28T23-06-04Z --unit 01-round --slice 01-round.md --project <copy> --json
{"runId":"2026-07-28T23-06-04Z","unitId":"01-round","slicePath":"01-round.md","sha256":"f5b98985...8542e20","alreadyRecorded":false}
... (5 more, one per unit) ...
$ boardsmith verify-run-status --project <copy> --run-id 2026-07-28T23-06-04Z --json
{"runId":"2026-07-28T23-06-04Z","recorded":["01-about-and-setup","01-round","01-game-end-and-match","01-definitions","01-distribution-of-cards","02-solo-variant"],"count":6}
```

Staged-slice count cross-checked two ways: `find ... -name "*.md" | wc -l` → 6; `verify-run-status
--json`'s `count` → 6. **Agree.**

### Step 3 — Close

**FINDING (instruction-shaped mechanism, no command backs it):** Step 3's "Record the run's
staging path ... in the provenance block" names no heading, no line format, and no CLI command —
unlike every other write this skill makes. Resolution taken: appended one `Label: value` line to
`rulebook/INDEX.md`'s provenance block (`Last verify run: rulebook/.verify/<run-id>/slices/ (staged
<date>)`), in the same grammar the existing lines already use. This is an improvisation the skill
text does not specify; reported here, not silently absorbed. A later phase's reader of this field
may expect a different format — unproven either way by this plan.

Session lock released to `Session Lock: none`. **Git Protocol was NOT exercised** — this copy is a
disposable scratch harness never pushed or merged anywhere, so committing inside it would add no
evidence value; the mechanism itself (write order, commit message shape) remains unproven by this
plan, recorded as a deliberate scope limitation, not a skipped step in Phase 170's sense.

### SC-2 — non-destructive staging: independent verification

Whole-tree sha256 manifest, `manifest-seven.post-install` (captured in section 2, before any Step
0-3 activity) vs. `manifest-seven.post-verify` (captured after Step 3 closed). 11 changed/added
paths total:

| Path | Category |
|---|---|
| `.claude/skills/bs-shared/verify/source-resolution.md` | installer-tooling sync of this plan's Rule-1 fix |
| `SKETCH.md` | Step 0/3 session lock take + release |
| `rulebook/INDEX.md` | Step 1's documented single adoption write + Step 3's provenance-path record |
| `rulebook/source/rules.pdf` | Step 1's documented single archive write (new file) |
| `rulebook/.verify/2026-07-28T23-06-04Z/RUN.md` + 6 slice files (7 paths) | **staging — the claim under test** |

All 7 staging paths are under `rulebook/.verify/`. The other 4 are the two already-independently-
audited single writes this pipeline documents by design (Step 1's adoption, Step 0/3's lock), not
staging leakage.

All 4 **pre-existing live** `rulebook/*.md` slices (`00-visual-survey.md`,
`01-definitions-and-components.md`, `01-overview-setup-and-play.md`, `02-solo-variant.md`) are
byte-identical, hash-for-hash, before and after — confirmed by direct manifest lookup, not by the
absence of their names in the diff alone.

```
$ git status --porcelain   (inside the copy)
 M SKETCH.md
 M rulebook/INDEX.md
?? .claude/
?? rulebook/.verify/
?? rulebook/source/
```
Cross-check agrees: nothing outside the documented paths.

**GATE: PASSED (SC-2)**

### SC-3 — the orchestrator never reads a slice: independent verification

```
$ grep -c '^p\.[0-9]*,' 173-transcript.log        -> 0 (exit 1)
$ grep -c 'Derived (p\.[0-9]' 173-transcript.log   -> 0 (exit 1)
$ grep -c 'Visual (p\.[0-9]' 173-transcript.log    -> 0 (exit 1)
```

Zero slice-body-shaped lines anywhere across the full 731-line transcript covering all four Steps.
Also confirmed independently on the raw capture files (`dispatch-prompt-01.txt`,
`subagent-01-return.txt`) in isolation — same zero result.

**A correction made mid-pass, recorded for full honesty:** an earlier draft of this transcript
briefly included a "sample of actual staged content" block (a `head -12` of the real staged slice)
appended for human-readability purposes. This was caught and removed before the grep was run —
including it would have produced a false SC-3 failure (self-inflicted, not a real one), and more
importantly would have meant the orchestrator's own working file held slice-body text, which is
exactly what SC-3 exists to prevent. The corrected transcript keeps that content in a clearly
separate, clearly labeled `173-auditor-spotcheck.txt` file instead. This mistake and its correction
are recorded here rather than silently fixed and forgotten, since "did the transcript ever hold
slice content, even briefly, even by the auditor rather than the orchestrator" is exactly the
question this criterion asks.

**GATE: PASSED (SC-3)**, on the observable defined: dispatch prompts and subagent returns captured
in this pass carry zero slice-body-shaped lines.

### Originals re-verification (post-run)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```
Whole-tree sha256 manifest diff, before vs. after this plan's own preflight capture, both games:
**empty** (byte-identical).

**GATE: PASSED**

### What this pass did NOT prove

1. **The Git Protocol mechanism** (write order, commit message shape) at Step 3 close — not
   exercised; the scratch copy was never committed to.
2. **SC-3 under a real internal Task-tool dispatch.** This pass used an OS-process subprocess as
   the closest available equivalent to a genuine fresh-context subagent, because no Task/Agent tool
   was exposed to this executor. The absence proven here (dispatch prompt and subagent return, as
   captured, hold no slice body) is real, but a session with access to Claude Code's native Task
   tool has not been separately confirmed to exhibit the same property — plausible given the
   mechanism (structured-return contract, same transcription-subagent.md file) but not directly
   observed.
3. **Multi-unit / multi-range dispatch and true fan-out concurrency** — `seven`'s rulebook fit in
   one page-range dispatch (1-2), so parallel-dispatch races, cross-unit collision handling, and
   large-rulebook page-range division were not exercised.
4. **Case 1 (already-archived, proceed straight to Step 2), Case 3 (multiple candidates, stop and
   ask), Case 4 (hash mismatch, record and proceed) of source-resolution.md** — only Case 2 was
   live-exercised. `one-two-punch` was preflight-checked and manifest-diffed but not run through a
   live pass in this plan (SC-1/SC-2/SC-3 were all proven against `seven` alone, per the plan's own
   guidance that `seven` is "the sensible one to prove against").
5. **Resume-after-kill (SC-4)** — explicitly out of scope for this plan; owned by 173-07.
6. **A genuine human designer's STOP AND ASK response** at Case 2's gate — this proof session had
   no human present; the executing agent stood in as a proxy, recorded explicitly above.

### Commits produced by this plan

See the final commit list in `173-06-SUMMARY.md`. In addition to `173-PROOF.md`, this plan's live
pass produced a real, necessary fix to `src/cli/slash-command/bs/verify/source-resolution.md` and
`src/cli/slash-command/bs/verify.test.ts` — outside the plan's originally declared
`files_modified: [173-PROOF.md]`, added under deviation Rule 1 (auto-fix bugs) because the defect
was discovered live, is unambiguous, and blocks VERIFY-01 from ever functioning for a real designer
without it.

---

## 4. SC-4 — kill and resume

GATE: PASSED, with two significant live findings the automated ledger tests could not have
surfaced. Reported here in full, not smoothed into a clean-run narrative.

Reusable script: `${TMPDIR:-/tmp}/173-proof/173-sc4.sh` (re-runnable against this pass's captured
artifacts; exits non-zero on first failure — all 12 assertions pass). Driving harness:
`${TMPDIR:-/tmp}/173-proof/173-drive-one-range.sh` (dispatches one page-range via a real `claude -p`
subprocess using the exact `BS-DISPATCH-V2` pointer block, then records every returned unit via
`verify-run-record`). Full combined transcript across all four dispatch events:
`${TMPDIR:-/tmp}/173-proof/173-sc4-kill-transcript.log` (328 lines). Clean-run comparison
transcript: `${TMPDIR:-/tmp}/173-proof/173-sc4-clean-transcript.log`.

### Why `one-two-punch`, and why per-page dispatch

Per the plan's own guidance, `one-two-punch` (a second, independent game from plan 173-06's
`seven`) was used, giving the pipeline a second real-data exercise. Its 2-page rulebook was split
into two separate dispatches — page range `1-1`, then page range `2-2` — specifically so a kill
could land **between** two independent subagent calls rather than truncating a single subagent's
in-flight write, matching the plan's requirement for "at least one recorded, at least one
unrecorded" as an actually-observed intermediate state, not a constructed one.

### Preflight (on the ORIGINALS, before any copy — this plan's own pass)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```
Both pinned commits match `173-VALIDATION.md`'s read-only invariant exactly; `seven` porcelain
confirmed empty; `one-two-punch` not asserted porcelain-empty, per the documented exception.
Whole-tree sha256 manifests captured to `manifest-seven.plan07.before` (124 files) and
`manifest-otp.plan07.before` (159 files).

Two fresh `cp -R` copies of `one-two-punch` were made: `otp-kill` (the interrupted-run target) and
`otp-clean` (a second copy, dispatched once, uninterrupted, for end-state comparison).

### Setup — adoption + run-init on both copies

Both copies were pre-provenance (`projectProvenanceState: "pre-provenance"`, `Source:` line
absent from `INDEX.md`, matching the Case-2 shape wave 1's gate and plan 173-06 already exercised).
`boardsmith ingest-archive rules.pdf --project . --json` on each; `computeVerificationScope`
returned `{"scope":"full", ...}` for both afterward (independently verified via `scope-check.mjs`,
not trusted from the command's own output). `boardsmith verify-run-init --project . --json` on
each minted a fresh run-id:

```
otp-kill:  runId "2026-07-28T23-23-38Z"
otp-clean: runId "2026-07-28T23-23-39Z"
```

### Dispatch 1 (`kill-01`) — page range 1-1, real subprocess

```
$ claude -p "BS-DISPATCH-V2 ... Your page range: 1-1 ... Write slices to: rulebook/.verify/<runId>/slices ..." --allowedTools Read,Write,Bash
```

Completed in ~2 minutes, wrote two real slice files (`01-overview-contents-setup.md`,
`01-starting-a-new-round.md`), both independently confirmed non-empty and containing real
`Derived (p.`/`Visual (p.` content (not stubs). The driving script (`173-drive-one-range.sh`) then
began recording each returned unit via `verify-run-record`.

### The first kill — a genuine process termination mid-record-loop (not simulated)

The recording loop's driving shell process was terminated by the test harness's own command
timeout (SIGTERM, exit 143) **after recording exactly one of the two written units and before
recording the second.** This was not staged for narrative convenience — it is the actual, verified
result of a real process boundary being cut mid-loop, landing at a genuinely arbitrary point
(after `verify-run-record` returned for `01-overview-contents-setup`, before the loop's next
iteration reached `01-starting-a-new-round`). Captured immediately, before touching anything else:

```
$ boardsmith verify-run-status --project otp-kill --run-id 2026-07-28T23-23-38Z --json
{"runId":"2026-07-28T23-23-38Z","stagingDir":"rulebook/.verify/2026-07-28T23-23-38Z/slices","recorded":["01-overview-contents-setup"],"count":1}
```
(saved verbatim to `${TMPDIR:-/tmp}/173-proof/173-sc4-before-resume-status.json` — the "before"
state this whole proof rests on)

Independently confirmed on disk, not inferred from the status command: both slice files existed
(`01-overview-contents-setup.md`, `01-starting-a-new-round.md`), the second genuinely absent from
the ledger despite being fully written (4457 bytes, real `Derived (p.`/`Visual (p.` content,
confirmed by direct read).

### Resume 1 (`resume-01`) — re-invoked against the SAME run-id, letting `verify-run-status` drive it

The resuming pass re-ran `verify-run-status` (never inferred state from the filesystem, per
`staging-dispatch.md`'s explicit instruction), saw `01-overview-contents-setup` already recorded,
and — because the ledger has no mechanism for expressing "half of a dispatched range is already
covered" — re-dispatched the **entire** page-1-1 range via a fresh, independent `claude -p`
subprocess call (a fresh-context subagent with no memory of the first dispatch).

**FINDING 1 (a real, load-bearing gap, not a cosmetic one): re-dispatching an already-partially-
covered range produces non-deterministic re-fragmentation, not idempotent re-coverage.** The second
dispatch of the identical page range (1-1) did **not** reproduce the first dispatch's two-section
breakdown. It wrote three entirely new, differently-named slice files —
`01-overview.md`, `01-round-structure.md`, `01-setup.md` — covering page 1's content again under
different section boundaries, while leaving the two originally-written files
(`01-overview-contents-setup.md`, `01-starting-a-new-round.md`) completely untouched on disk (byte-
identical mtime and sha256, confirmed below). All three new units were recorded normally. **Net
effect: page 1 of a 2-page rulebook now has 5 recorded slice-units covering it, when a single
uninterrupted dispatch of the same page (see the clean-run comparison below) produces exactly one
consolidated unit for that page** (`01-overview-and-setup`, part of the clean run's 4-unit total for
the whole book). This is real content duplication/overlap, not a cosmetic naming difference — the
transcription subagent has no way to know a prior, partial attempt at the same range already
exists, because nothing in this design tells it, and the orchestrator (per the letter of
`staging-dispatch.md`) is correct to re-dispatch rather than trust the filesystem. **The design's
crash-safety guarantee (no already-recorded unit is lost or duplicated) held; a separate,
un-stated efficiency/correctness property (a range, once even partially dispatched, is never
re-covered wastefully or divergently on resume) does not.** This is exactly the kind of finding
`173-VALIDATION.md`'s own instructions ask to be reported rather than silently smoothed over.

Independent verification that the two originally-recorded/staged files were genuinely untouched by
the second dispatch:

```
$ stat -f "%m" .../01-overview-contents-setup.md   ->  1785281131  (unchanged from before-resume)
$ shasum -a 256 .../01-overview-contents-setup.md   ->  0ba362c5...785e5  (unchanged)
$ grep -c '"unitId":"01-overview-contents-setup"' RUN.md   ->  1  (no duplicate ledger record)
```

Status after resume 1:

```
{"recorded":["01-overview-contents-setup","01-overview","01-round-structure","01-setup","01-starting-a-new-round"],"count":5}
```

The unit that was staged-but-unrecorded at kill time (`01-starting-a-new-round`) is now recorded,
its file's mtime/sha256 unchanged from before the resume (`1785281155` /
`83edea85...aa2c`) — proving it was **recorded from the pre-existing write**, not regenerated.

### The second, deliberate `kill -9` — page range 2-2, never dispatched at all before termination

Per the plan's literal instruction ("actually terminate it"), a second dispatch (`kill-02`, page
range 2-2) was launched as a real background OS process and killed with `kill -9` on its actual PID
(confirmed via `ps`), 8 seconds after launch, before any subagent output existed:

```
$ ps aux | grep claude    -> PID 79080 (claude -p, --allowedTools Read,Write,Bash, page range 2-2)
$ date -u +%Y-%m-%dT%H:%M:%SZ   -> 2026-07-28T23:31:58Z
$ kill -9 79080
$ ps -p 79080   -> "79080 gone"
```

Post-kill: staged-slices directory listing unchanged (still exactly the 5 files from range 1-1's
work); `verify-run-status --json` unchanged (`count: 5`, same 5 unit-ids); `subagent-kill-02-
return.txt` is 0 bytes — the subprocess never produced any output before being killed. This is the
cleanest possible negative control: a genuinely undispatched range leaves zero trace.

### Resume 2 (`final-02b`) — page range 2-2, to completion

Re-invoked page range 2-2 (the harness's own first retry attempt, `final-02`, itself hit the test
harness's 2-minute command timeout with a truncated/empty subagent return — recorded honestly as a
second, unintended interruption, not absorbed; its 15-byte return file, `subagent-final-02-
return.txt`, contains only `"Execution error"`). The subsequent retry, `final-02b`, run in the
background with polling instead of a hard timeout, completed cleanly and wrote four new slice
files (`02-action-cards.md`, `02-discard.md`, `02-end-of-game.md`, `02-tips.md`), all recorded.

Final state:

```
$ boardsmith verify-run-status --project otp-kill --run-id 2026-07-28T23-23-38Z --json
{"recorded":["01-overview-contents-setup","01-overview","01-round-structure","01-setup",
"01-starting-a-new-round","02-action-cards","02-discard","02-end-of-game","02-tips"],"count":9}
```

Independent cross-checks:

| Assertion | Method | Result |
|---|---|---|
| The 5 units recorded before the second kill (page 1's work) are byte-identical (mtime+sha256) after page 2's dispatch | direct `stat`/`shasum` diff, captured before and after (`173-sc4-pre-final-resume-manifest.txt` vs. `173-sc4-post-final-resume-manifest.txt`) | PASS — `diff` empty |
| Staged-slice count agrees with ledger count | `find ... \| wc -l` (9) vs. `verify-run-status --json`'s `count` (9) | PASS |
| No unit has more than one ledger record | `grep -o '"unitId":...' \| sort \| uniq -c` — every count is 1 | PASS |
| The resumed transcript (all 4 dispatch events + the harness-timeout retry) carries zero slice-body-shaped lines | `grep -c '^p\.[0-9]*,\|Derived (p\.\|Visual (p\.'` against `173-sc4-kill-transcript.log` | PASS — 0/0/0 |

### Assertions (a)/(b)/(c), stated explicitly

- **(a) Already-recorded units are NOT re-dispatched.** TRUE at the individual-unit level for every
  unit that was ever fully recorded before a kill: `01-overview-contents-setup` (recorded before
  kill 1) and the full 5-unit page-1 set (recorded before kill 2) are byte-identical and
  singly-recorded across every subsequent resume. **Finding 1 above is the honest caveat**: the
  *range* those units belong to CAN be re-dispatched (producing new, additional, overlapping
  content) if the range was only partially covered at kill time — the guarantee is per-unit, not
  per-range, and nothing in the skill text states this distinction.
- **(b) Unrecorded units ARE dispatched (or, if already staged from a killed loop, recorded).**
  TRUE — `01-starting-a-new-round` (staged-but-unrecorded at kill 1) was recorded on resume without
  regeneration; the entire page-2 range (undispatched at kill 2) was fully dispatched and recorded
  on the next resume.
- **(c) The resumed pass reaches a completed state.** TRUE in the narrow sense that
  `verify-run-status`'s `count` (9) matches the staged-file count (9) two independent ways, and
  every unit ever dispatched is recorded — the run is internally complete and consistent. **NOT
  TRUE in the stronger sense** the plan also asks to check: it does not match a clean, single-pass
  run's end state. See the clean-run comparison below.

### Clean-run comparison (a second copy, `otp-clean`, one uninterrupted full-book dispatch)

```
$ boardsmith verify-run-status --project otp-clean --run-id 2026-07-28T23-23-39Z --json
{"recorded":["01-overview-and-setup","01-starting-a-new-round","02-action-cards",
"02-punch-examples-discard-and-end-of-game"],"count":4}
```

A single, uninterrupted dispatch of the whole 2-page rulebook (matching 173-06's approach for
`seven`) produces **4** units for the whole book. The interrupted-and-resumed run produced **9**
units for the same book — more than double — entirely attributable to Finding 1's re-fragmentation
of page 1 on its first resume. **The interrupted run's end state is complete and internally
consistent, but it is measurably NOT the same end state a clean run reaches** — this is reported
as the honest result, not reframed as a pass. Unit-ID-for-unit-ID equality across two independent
LLM-driven transcription passes was never a sound comparison target to begin with (the subagent's
section-boundary choice is not deterministic even between two clean, uninterrupted dispatches of
different page ranges — `seven`'s two live passes across plans 173-01/173-06 already produced
different boundaries for the same source), so this comparison is reported as a content-volume/
coverage check, not an exact-match assertion.

### Torn-ledger-line case, exercised deliberately (not assumed)

Two sub-cases, both against isolated fixture copies of the completed 9-unit ledger, truncating the
final line (`02-tips`'s record) mid-JSON:

**Case A — line torn, `END` fence preserved** (the literal crash mode the design's own comment
describes: "a torn append can only ever damage the final line"):

```
$ boardsmith verify-run-status --project <fixture> --run-id 2026-07-28T23-23-38Z --json
⚠ 1 ledger line(s) in rulebook/.verify/.../RUN.md could not be parsed as a complete record —
  treating as NOT recorded (a crash mid-write torns the final append)
{"recorded":[...8 units, "02-tips" ABSENT...],"count":8}
```
Exit 0. **Confirmed exactly as designed**: the torn unit is demoted to NOT recorded, all other 8
recorded units are unaffected, and the command degrades gracefully rather than throwing.

**Case B — line torn AND the `END` fence itself also missing** (a second, equally plausible crash
mode given `verify-run-record`'s actual implementation, which rewrites the whole ledger text on
each append rather than doing a true O_APPEND write — a process killed mid-rewrite can plausibly
lose the trailing fence along with the torn record, not just the record):

```
$ boardsmith verify-run-status --project <fixture> --run-id 2026-07-28T23-23-38Z --json
rulebook/.verify/2026-07-28T23-23-38Z/RUN.md is missing its machine-owned fences.
Expected <!-- boardsmith:verify-run:begin --> ... <!-- boardsmith:verify-run:end -->.
...
```
Exit 1 (hard throw).

**FINDING 2 (a real edge the documented crash-safety guarantee does not literally cover).** The
design's own comment in `verify-run.ts` promises "an unparseable trailing line reads as NOT
recorded, so resume re-dispatches that unit" without qualification. Case A proves that promise
holds when the crash spares the END fence. Case B — plausible under the append implementation's
own rewrite-based write pattern, and not distinguishable from Case A by anything the design
document says — instead throws a hard, actionable error (never silently corrupts or guesses,
which is itself a reasonable, safe failure mode) that **blocks all resume progress on that run-id
until a human or script manually restores the fences**, rather than gracefully re-dispatching the
one affected unit as the stated guarantee implies for "the final line." This is reported as a real
finding, not fixed under this plan's deviation rules — the throw-not-corrupt behavior is itself
defensible and arguably the safer choice; documenting the gap between the stated guarantee and the
actual (safe, but not seamless) behavior is what this proof owes.

### SC-3 re-confirmed on the resumed transcript

```
$ grep -c '^p\.[0-9]*,' 173-sc4-kill-transcript.log        -> 0
$ grep -c 'Derived (p\.[0-9]' 173-sc4-kill-transcript.log   -> 0
$ grep -c 'Visual (p\.[0-9]' 173-sc4-kill-transcript.log    -> 0
```
Zero slice-body-shaped lines across all four dispatch events (`kill-01`, `resume-01`, `kill-02`,
`final-02`/`final-02b`) and the clean-run comparison transcript.

### verify-run-status vs. filesystem-eyeballing (the plan's item 6)

The driving harness used `verify-run-status --json`'s `recorded[]` array as the sole source of
truth for "what is done" before every dispatch decision, exactly as `staging-dispatch.md` mandates
— never inferring completion from which files existed in the staging directory. One harness
limitation is disclosed honestly: the recording step (unlike a literal orchestrating skill session,
which would record only the `slicePath` fields a subagent's own structured return names) swept the
whole staging directory for `.md` files not yet in `recorded[]` and recorded all of them. This
picked up the pre-existing orphaned `01-starting-a-new-round.md` correctly on resume (the intended
behavior), but it is a harness expedience, not literal compliance with `staging-dispatch.md`'s
"record from the returned field, do not open the file" discipline — recorded here per this plan's
own "do not let the tool grade itself" instruction, not smoothed over.

### Originals re-verification (post-run)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```
Whole-tree sha256 manifest diff, both games, before this plan's own preflight vs. after: **empty**
(byte-identical, 124 and 159 files respectively). No background processes left running (`ps aux`
confirmed no `claude -p` subprocess or driving-script process survives this plan).

**GATE: PASSED (SC-4)** — the resumable-crash-safety CORE guarantee (no recorded unit is ever lost,
duplicated, or silently re-dispatched) holds under two independently real interruption mechanisms
(a harness-timeout SIGTERM mid-loop and a deliberate `kill -9` on a live PID) and under a
deliberately-torn ledger line. Two real, load-bearing findings are reported alongside the pass:
range-level resume re-dispatch is not idempotent (Finding 1), and the torn-ledger crash-safety
guarantee's literal wording does not cover the case where a crash also destroys the trailing fence
(Finding 2).

**RESOLVED by plan 173-08 — see §5 below for the re-proof against the fixed code.** Finding 1 (range
resume determinism) and Finding 2 (the fence-destroying crash shape) are both closed. This section
is left in place, unedited, because the record of what was wrong is the point of this document.

---

## What is still unproven (final, phase-wide)

1. **Range-level resume is not idempotent (Finding 1, this plan).** A page range dispatched once,
   partially recorded, then killed and resumed, is re-dispatched **in full** rather than
   sub-divided — producing additional, differently-bounded, overlapping content for the
   already-covered portion. No plan in this phase fixes this; it is a genuine design gap in
   `staging-dispatch.md`'s "Unit Granularity"/"Resume" sections, worth a follow-up decision (does
   the orchestrator need to persist a page-range→dispatch-plan manifest across a session
   boundary, or is bounded re-transcription of an already-covered range an accepted cost of the
   crash-safety trade-off?). Recorded here for a future phase or human decision, not silently
   resolved.

   **RESOLVED (173-08 Task 2) — see §5.** The dispatch-plan manifest is now persisted at
   `verify-run-init` time and read on resume; range-level completion/reset markers make resume
   dispatch decisions deterministic. Re-proven live against `one-two-punch` below: the
   killed-then-resumed run's final `recorded[]` set is IDENTICAL to a clean run's, where the
   original proof measured 9-vs-4.
2. **The torn-ledger crash-safety guarantee's stated wording does not cover a fence-destroying
   crash (Finding 2, this plan).** The actual behavior (a hard, actionable throw) is safe but not
   what "an unparseable trailing line reads as NOT recorded" implies for every crash shape. Worth a
   documentation fix to `verify-run.ts`'s own comment in a later phase; not fixed here because it is
   a documentation-precision gap, not a behavioral defect (the actual behavior never silently
   corrupts state).

   **RESOLVED (173-08 Task 1, CR-01) — see §5.** The write is now atomic (temp file + `fsync` +
   `rename()`), so the fence-destroying crash shape (Case B) is unreachable from a real crash — a
   crash can only ever leave `RUN.md` byte-identical to its pre-call state or fully updated, never
   torn. Case B is still reachable via HAND-CORRUPTION (a human/script editing `RUN.md` directly,
   which is out of scope for a crash-safety guarantee) and still throws the same actionable error in
   that case — unchanged, correct, defensive behavior. The module's doc comment is corrected to say
   this precisely rather than the disproven "at most the final line" claim.
3. **The Git Protocol mechanism at Step 3 close** (write order, commit message shape) — still
   unexercised. Neither plan 173-06 nor this plan committed inside a scratch copy; both are
   disposable harnesses never pushed or merged, so committing would add no evidence value. Remains
   a deliberate scope limitation across the whole phase.
4. **SC-3 under a real internal Task-tool dispatch.** Every live dispatch across plans 173-06 and
   173-07 used a `claude -p` OS-subprocess as the closest available equivalent to a genuine
   fresh-context Task-tool subagent, because no internal Task/Agent tool was exposed to either
   executor. The structural absence proven (dispatch prompts and subagent returns hold no slice
   body) is real and mechanism-based (the same `transcription-subagent.md` contract, the same
   structured-return shape), but a session with native Task-tool access has not separately
   confirmed the same property holds under that specific dispatch mechanism.
5. **`/bs-build-chunk` Step 0's `ingest-check` call.** Carried forward from Phase 170/171/172; still
   never exercised by a live session in this phase, because this phase's live proofs all entered
   through `/bs-verify-game`, not `/bs-build-chunk`. Out of this phase's scope but the debt is
   real and should stay visible.
6. **Multi-unit / multi-range fan-out concurrency (parallel dispatch).** All live dispatches in this
   phase (plans 173-06 and 173-07) were sequential, one subagent at a time. True parallel-dispatch
   races, cross-unit staging collisions under concurrent writes, and large-rulebook page-range
   division by an orchestrator (rather than this plan's manually-chosen per-page split) remain
   unexercised.
7. **Case 1, Case 3, and Case 4 of `source-resolution.md`** (already-archived proceed-straight,
   multiple-candidates stop-and-ask, hash-mismatch record-and-proceed). Only Case 2 (single
   unarchived root candidate) has ever been live-exercised, across both `seven` (173-06) and
   `one-two-punch` (this plan).
8. **A genuine human designer's STOP AND ASK response** at any of this phase's designer-confirmation
   gates. Every live pass in this phase had no human present; the executing agent stood in as a
   proxy each time, recorded explicitly at each occurrence.
9. **Skill-text-to-command invocations not otherwise named above.** No new gap was found live in
   this plan beyond Findings 1 and 2 above; `staging-dispatch.md`'s Resume/Recording sections were
   followed exactly as written, apart from the harness's directory-sweep recording expedience
   (disclosed in section 4 above).

## 5. 173-08 re-proof — CR-01 and Finding 1 against the fixed code

Re-runs the SC-4 kill-and-resume proof's load-bearing claims against the fixed
`src/cli/commands/verify-run.ts`, through the REAL `boardsmith` CLI (`node bin/boardsmith.js`,
which runs the TypeScript source directly via `tsx` in this dev repo — the exact code path a real
invocation uses, not a mock).

**Scope difference from the original proof, disclosed up front:** the original SC-4 proof
dispatched real `claude -p` LLM subprocesses to transcribe `one-two-punch`'s pages. Re-running that
exact mechanism here — for every kill point, twice, plus a clean-run comparison — was judged not to
add evidence value for what this plan actually changed: CR-01 and Finding 1 are both properties of
the LEDGER/MANIFEST MECHANISM (crash-safety of the write, and range-level dispatch-decision
determinism), not of the LLM's transcription content. The original proof itself already established
that exact section-boundary matching between two live LLM passes is not a sound comparison target
(§4, "Clean-run comparison" section, above). This re-proof instead drives the real CLI commands with
real, non-trivial, deterministic slice content standing in for a subagent's return — isolating the
mechanism's determinism from content non-determinism, which is exactly what Task 2's fix claims to
guarantee. Every kill below is a REAL process termination (`kill -9` on a real PID, confirmed via
`ps`), never a simulated/mocked one — the "prove before fix, prove after" discipline is honored at
the mechanism level, not skipped.

### Preflight (on the ORIGINALS, before any copy)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd
$ git -C ~/BoardSmithGames/seven status --porcelain
(empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9
```
Both pinned commits match the read-only invariant exactly. Two fresh `cp -R` copies of
`one-two-punch` were made under the scratchpad (never under `~/BoardSmithGames/`): `otp-kill` (the
interrupted-run target) and `otp-clean` (a second copy, dispatched once, uninterrupted, for
end-state comparison) — same structure as the original SC-4 proof.

### Setup — adoption + run-init with a persisted manifest on both copies

```
$ node bin/boardsmith.js ingest-archive <otp-kill>/rules.pdf --project <otp-kill> --json
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"e28d18756e...4358eea", ...}
$ node bin/boardsmith.js ingest-archive <otp-clean>/rules.pdf --project <otp-clean> --json
{"archivedPath":"rulebook/source/rules.pdf","sourceHash":"e28d18756e...4358eea", ...}   (same source, same hash)

$ node bin/boardsmith.js verify-run-init --project <otp-kill> --run-id 2026-01-01T00-00-00Z --ranges '["1-1","2-2"]' --json
{"runId":"2026-01-01T00-00-00Z", ..., "ranges":["1-1","2-2"]}
$ node bin/boardsmith.js verify-run-init --project <otp-clean> --run-id 2026-01-02T00-00-00Z --ranges '["1-1","2-2"]' --json
{"runId":"2026-01-02T00-00-00Z", ..., "ranges":["1-1","2-2"]}
```
The manifest (`["1-1","2-2"]`) is now a durable fact in each run's `RUN.md`, in its own fenced
section (`RUN_MANIFEST_BEGIN`/`END`), written once — confirmed by reading `RUN.md` directly (not
trusting the command's own echoed JSON) in the ledger dump below.

### Dispatch 1 (`kill-01`) — page range 1-1, real subprocess, real SIGKILL

A driver script wrote both of range 1-1's slice files, then invoked the real CLI
(`verify-run-record --unit 01-overview-contents-setup ... --range 1-1`) as an `execFileSync` child,
then wrote a ready-sentinel and blocked. The PARENT waited for the sentinel (confirming the FIRST
unit's `verify-run-record` call had already returned — durably recorded), then killed the driver's
PID with `kill -9`:

```
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-07-29T03:42:30Z
$ kill -9 80364
$ ps -p 80364
(no such process)   -> confirmed: a real, killed OS process, not simulated
```

### The kill — one of two units recorded, the second staged but never recorded, exactly like the original proof

```
$ node bin/boardsmith.js verify-run-status --project <otp-kill> --run-id 2026-01-01T00-00-00Z --json
{"runId":"2026-01-01T00-00-00Z","recorded":["01-overview-contents-setup"],"count":1,
 "ranges":["1-1","2-2"],"rangesRecorded":[],"rangesPending":["1-1","2-2"]}
```
Independently confirmed on disk: both `01-overview-contents-setup.md` (101 bytes) and
`01-starting-a-new-round.md` (79 bytes, real content, `Derived (p.1):` prefix) exist in staging;
only the first is in `recorded[]`. `rangesPending` correctly lists BOTH ranges — range 1-1 has a
unit recorded but no `range-complete` marker, so it is NOT treated as done.

### Resume 1 — reset the interrupted range, then redispatch it fresh (the mechanism Finding 1's fix adds)

```
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --reset-range 1-1 --json
{"runId":"2026-01-01T00-00-00Z","rangeId":"1-1","action":"range-reset","alreadyRecorded":false}
$ node bin/boardsmith.js verify-run-status --project <otp-kill> --run-id 2026-01-01T00-00-00Z --json
{"recorded":[],"count":0,"rangesRecorded":[],"rangesPending":["1-1","2-2"]}
```
The reset is a real, appended tombstone line (verified in the raw `RUN.md` dump below) — it does not
rewrite or delete the stale `01-overview-contents-setup` record, it supersedes it. `recorded[]`
correctly drops to `[]` (the one prior unit is now excluded).

Range 1-1 is then redispatched fresh — ONE consolidated unit (`01-overview-and-setup`, deterministic
content for this proof), recorded and completed:

```
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --unit 01-overview-and-setup --slice 01-overview-and-setup.md --range 1-1 --json
{"unitId":"01-overview-and-setup", "sha256":"98ea1bab51d8...6544e8", "alreadyRecorded":false, "rangeId":"1-1"}
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --complete-range 1-1 --json
{"rangeId":"1-1","action":"range-complete","alreadyRecorded":false}
```

### The second, deliberate `kill -9` — page range 2-2, never dispatched at all before termination

```
$ ps aux | grep kill-02-driver    -> PID 82632, real background node process
$ date -u +%Y-%m-%dT%H:%M:%SZ
2026-07-29T03:42:58Z
$ kill -9 82632
$ ps -p 82632
(no such process)   -> confirmed
```
Post-kill: staging directory unchanged (still exactly the 1-1 files); `verify-run-status --json`
unchanged (`count: 1`, `rangesPending: ["2-2"]`). Cleanest possible negative control — zero trace
from a genuinely undispatched range.

### Resume 2 — range 2-2, to completion

```
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --unit 02-action-cards --slice 02-action-cards.md --range 2-2 --json
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --unit 02-punch-examples-discard-and-end-of-game --slice ... --range 2-2 --json
$ node bin/boardsmith.js verify-run-record --project <otp-kill> --run-id 2026-01-01T00-00-00Z --complete-range 2-2 --json

$ node bin/boardsmith.js verify-run-status --project <otp-kill> --run-id 2026-01-01T00-00-00Z --json
{"recorded":["01-overview-and-setup","02-action-cards","02-punch-examples-discard-and-end-of-game"],
 "count":3,"rangesRecorded":["1-1","2-2"],"rangesPending":[]}
```

### Clean-run comparison (`otp-clean`, one uninterrupted dispatch, same deterministic content plan)

```
$ node bin/boardsmith.js verify-run-status --project <otp-clean> --run-id 2026-01-02T00-00-00Z --json
{"recorded":["01-overview-and-setup","02-action-cards","02-punch-examples-discard-and-end-of-game"],
 "count":3,"rangesRecorded":["1-1","2-2"],"rangesPending":[]}
```

**Independent diff (not trusting either command's own equality claim):**

```python
clean recorded  : ['01-overview-and-setup', '02-action-cards', '02-punch-examples-discard-and-end-of-game']
killed recorded : ['01-overview-and-setup', '02-action-cards', '02-punch-examples-discard-and-end-of-game']
MATCH recorded[]: True
MATCH count     : True 3 3
```

**Finding 1 does not reproduce.** The original proof measured 9 recorded units on the killed-then-
resumed run against 4 on the clean run (>2x, from range 1-1 re-fragmenting into 5 overlapping units
across two dispatches). Here, the killed-then-resumed run's final `recorded[]` set is IDENTICAL,
unit-for-unit, to the clean run's — 3 and 3, not 9 and 4.

The raw `RUN.md` (read directly, not through the status command) shows exactly what happened,
including the superseded record surviving in the file (append-only, never deleted) but excluded from
`recorded[]`:

```
{"unitId":"01-overview-contents-setup", ..., "rangeId":"1-1"}          <- stale, from the killed attempt
{"kind":"range-reset","rangeId":"1-1", ...}                            <- tombstone: supersedes the line above
{"unitId":"01-overview-and-setup", ..., "rangeId":"1-1"}               <- the fresh, post-reset redispatch
{"kind":"range-complete","rangeId":"1-1", ...}
{"unitId":"02-action-cards", ..., "rangeId":"2-2"}
{"unitId":"02-punch-examples-discard-and-end-of-game", ..., "rangeId":"2-2"}
{"kind":"range-complete","rangeId":"2-2", ...}
```
`grep -o '"unitId":"[^"]*"' RUN.md | sort | uniq -c` confirms every unitId (including the stale,
superseded one) appears exactly once — no duplicate ledger record was ever written, matching Task
1's crash-safety guarantee.

### Torn-ledger cases, re-run against the fixed code

**Case A — final line torn, END fence preserved (hand-corrupted fixture, not a live crash):**
```
$ node bin/boardsmith.js verify-run-status --project <otp-kill-tornA> --run-id 2026-01-01T00-00-00Z --json
⚠ 1 ledger line(s) ... could not be parsed as a complete record — treating as NOT recorded
{"recorded":["01-overview-and-setup","02-action-cards","02-punch-examples-discard-and-end-of-game"],
 "count":3, "rangesRecorded":["1-1"], "rangesPending":["2-2"]}
```
Exit 0. Unchanged from the original proof's Case A: the torn record (here, the 2-2 `range-complete`
marker) demotes gracefully — `rangesPending` correctly re-lists `2-2` (its completion marker was the
torn line; its two units are still individually recorded and unaffected).

**Case B — final line torn AND the END fence itself also destroyed (still only reachable via
hand-corruption, confirmed below to be unreachable from a real crash):**
```
$ node bin/boardsmith.js verify-run-status --project <otp-kill-tornB> --run-id 2026-01-01T00-00-00Z --json
rulebook/.verify/.../RUN.md is missing its machine-owned fences. ...
$ echo $?
1
```
Unchanged, actionable throw — exactly as before. This is the ONE case this plan's own doc comment
flags as still reachable via hand-tampering (never via a real crash) and states so explicitly.

### Live crash-hammer — 32 real `kill -9`s against real `verify-run-record` invocations, targeted at the write window

A third scratch copy (`crash-hammer`) ran 20 real subprocess kills timed during process startup
(0.5-20ms delay — confirmed to land before any write, 0 recorded, 0 fence loss) plus 12 more timed
in the 700-900ms window bracketing the actual write+rename (calibrated against a measured ~894ms
unkilled call). Every single one of the 32 real kills was asserted against two properties
immediately after the kill:

1. `RUN.md` still contains BOTH fences (`grep -q` for each) — **32/32 PASS**.
2. `verify-run-status --json` exits 0, never throws the "missing machine-owned fences" error (the
   Case B shape) — **32/32 PASS**.

2 of the 12 near-write-window kills landed AFTER the real `rename()` had already completed (the unit
shows up in the final `recorded[]`); the other 10 landed before it (the unit is absent, exactly as if
never dispatched). Zero torn ledgers, zero fence loss, across every real kill — Case B is
unreachable from a genuine crash under the fixed write, matching the corrected doc comment's claim.

### Originals re-verification (post-run)

```
$ git -C ~/BoardSmithGames/seven rev-parse HEAD
a03f38d4792af9dfc7c798be69686fc3230f54dd   (unchanged)
$ git -C ~/BoardSmithGames/seven status --porcelain
(still empty)
$ git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
7e69471bd8980a854f3e351f2f486e1fb6f712b9   (unchanged)
```
No background processes left running (`ps aux` confirmed clean after every kill in this section).

### VERIFY-08 re-assessment (honest, per this plan's own instruction)

VERIFY-08 was marked complete by 173-07 on the strength of a crash-safety guarantee CR-01 showed was
false, and on a resume mechanism Finding 1 showed was non-deterministic at range granularity. Both
are now re-proven, live, against the fixed code, above:

- The ledger write is atomic (temp file + `fsync` + `rename()`); a real crash — 32 live `kill -9`s,
  including several deliberately timed near the write itself — never produced a torn or
  fence-missing `RUN.md`, and already-durable records from earlier calls survive a later crash
  (confirmed both by unit test CR-A/CR-B and live here).
- Range-level resume is now deterministic: a killed-then-resumed run's final recorded-unit set is
  identical to a clean run's (3-and-3, where the pre-fix mechanism measured 9-vs-4 on the same
  source).
- The one remaining gap (Case B, reachable only via direct hand-tampering with `RUN.md`, never via a
  crash) is a documented, intentional, safe failure mode (a hard actionable throw, never silent
  corruption) — not a crash-safety gap.

**VERIFY-08 is CONFIRMED complete**, on the corrected guarantee stated in `verify-run.ts`'s own doc
comment as of 173-08, not the disproven one 173-07 relied on. This is a re-justification against new
evidence, not a rubber stamp of the prior mark — see 173-REVIEW.md's CR-01/WR-01 entries for the
defects this plan closed to earn it.

---

## How to re-run every proof

Four re-runnable scripts, each asserting against this phase's own captured artifacts (none of them
re-runs a live subagent dispatch — each dispatch is a real, non-idempotent `claude -p` subprocess
call; re-running the SCRIPTS re-validates the EVIDENCE, not the live event itself):

- `${TMPDIR:-/tmp}/173-proof/173-gate.sh` — wave-1 gate (decision 1b), both reference games.
- `${TMPDIR:-/tmp}/173-proof/173-sc1.sh` — SC-1 (install).
- `${TMPDIR:-/tmp}/173-proof/173-sc23.sh` — SC-2 (non-destructive staging) + SC-3 (transcript
  absence), against `seven`.
- `${TMPDIR:-/tmp}/173-proof/173-sc4.sh` — SC-4 (kill-and-resume) + the torn-ledger-line cases,
  against `one-two-punch`.

**173-08's re-proof (§5) was run ad hoc against ephemeral scratch-dir copies (never committed as a
reusable script) — the automated regression coverage for both defects lives in
`src/cli/commands/verify-run.test.ts`'s `CR-01` describe block (CR-static/CR-A/CR-B) and `173-08
Task 2` describe block (M1-M9), run via `npx vitest run src/cli/commands/verify-run.test.ts`. §5's
live run is the one-time crash-safety/determinism proof against the real CLI and real reference-game
copies; the vitest suite is what re-verifies both properties on every future change.**

All four exit 0 with a `PASS:` line per assertion, or exit non-zero with the first `FAIL:` line
naming exactly which assertion broke, against the artifacts as they exist right now.

## Both reference-game originals: byte-identical after the entire phase

Confirmed independently by every plan that touched them (173-01, 173-06, 173-07), each via its own
preflight/post-run `git rev-parse` + `git status --porcelain` (for `seven`) + whole-tree sha256
manifest diff. As of this plan's own post-run check: `seven` at `a03f38d4792af9dfc7c798be69686fc3230f54dd`
(porcelain-empty), `one-two-punch` at `7e69471bd8980a854f3e351f2f486e1fb6f712b9` — both unchanged
from the phase's very first preflight capture in `173-01-PLAN.md`'s gate.
