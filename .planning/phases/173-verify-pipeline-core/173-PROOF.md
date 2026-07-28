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

## What is still unproven

Per `173-VALIDATION.md`, three live-session proofs remain outstanding, owed by later plans in this
phase:

1. **SC-2 — non-destructive staging.** A live verify pass must leave every existing `rulebook/*.md`
   slice byte-identical before/after, with all writes confined to `rulebook/.verify/<run-id>/`.
   Owned by plan 173-06.
2. **SC-3 — the orchestrator never reads a slice (an absence).** Only provable by grepping a real
   captured session transcript for slice-body-shaped lines and finding none. Owned by plan 173-06.
3. **SC-4 — resumable kill-and-resume.** A real interrupted run: kill mid-pass with some units
   recorded and some not, re-invoke, and confirm recorded units are not re-dispatched while
   unrecorded ones are. Owned by plan 173-07.

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
