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
