---
phase: 177-derived-line-re-derivation
reviewed: 2026-07-30T18:20:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/cli/cli.ts
  - src/cli/commands/install-claude-command.ts
  - src/cli/commands/verify-classify.test.ts
  - src/cli/commands/verify-classify.ts
  - src/cli/commands/verify-derive-recheck.test.ts
  - src/cli/commands/verify-derive-recheck.ts
  - src/cli/slash-command/bs/verify-game.md
  - src/cli/slash-command/bs/verify.test.ts
  - src/cli/slash-command/bs/verify/classification-subagent.md
  - src/cli/slash-command/bs/verify/derive-compare.md
  - src/cli/slash-command/bs/verify/derive-recheck.md
findings:
  critical: 7
  warning: 11
  info: 0
  total: 18
status: issues_found
---

# Phase 177: Code Review Report

**Reviewed:** 2026-07-30T18:20:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

CHECK-04's mechanical core is heavily documented as "structural, not by instruction," but four of
its four load-bearing claims fail under direct execution. I ran the module against real temp-dir
projects (probe harness, deleted after use) and empirically confirmed:

1. The blind payload **does** leak `Derived (p.N)` lines verbatim whenever the line is not
   line-initial after trimming — and the live-slice corpus already uses exactly that form
   (`> Variant (p.1): ...` in `174-FIXTURES/seven/live/01-overview-setup-and-play.md`). The same
   lines are also silently missing from the candidate set.
2. `createDeriveVerdictRecord` is **not** the single validation choke point: `readDeriveVerdicts`
   re-enters arbitrary JSON with no revalidation, so an out-of-enum verdict reaches the report and
   corrupts `verdictCounts` with a `NaN` (JSON `null`) key.
3. Verdicts are joined to lines by `slicePath:lineNumber` alone and the recorded `originalLine` is
   never compared — an `agrees` verdict recorded for one line is reported against a completely
   different line after any edit above it. That is the false-confirmation failure the module's own
   header says it exists to prevent.
4. Subagent-authored `reasoning` prose can contain the ledger's END fence, permanently corrupting
   the ledger and making the "read-only report" die with a raw `SyntaxError`.

Separately, the feature has **no write surface at all**: `recordDeriveVerdicts` and
`createDeriveVerdictRecord` have zero non-test callers, and `cli.ts` registers only the read-only
report. CHECK-04 cannot produce a single verdict end-to-end today, which is consistent with the
phase closing CHECK-04 OPEN/PARTIAL, but the exported API is shipped in a shape that guarantees
data loss the moment a caller does exist (`recordDeriveVerdicts` replaces the whole ledger).

**Verified clean (checked explicitly, no finding):** the report command performs no writes; every
durable file write in the module goes through `atomicWriteFile`; no `--force`/`--skip`/env-var
bypass exists on any new CLI surface; the module never joins `projectDir` with `rulebook/source`;
no hardcoded secrets, `eval`, or shell interpolation anywhere in the reviewed files.

## Critical Issues

### CR-01: Blind payload leaks `Derived`/`Visual` lines that are not line-initial

**File:** `src/cli/commands/verify-derive-recheck.ts:227-237, 256-268, 349-362`

**Issue:** `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE` are anchored with `^`
against the *trimmed* line, so only a bare, line-initial prefix is stripped. Any markdown-decorated
form — blockquote (`> Derived (p.1): ...`) or list item (`- Derived (p.1): ...`) — passes straight
through `quoteLinesOnly` into `buildBlindDerivePayload`, directly underneath the payload's own
sentence "No Derived or Visual line from this slice, or any other slice, is included below."

This is not hypothetical: the real committed live corpus already emits blockquote-prefixed
annotation lines of exactly this family —
`.planning/phases/174-verify-classifier/174-FIXTURES/seven/live/01-overview-setup-and-play.md:30`
is `> Variant (p.1): Match Length — ...`, and
`174-FIXTURES/seven/live/02-solo-variant.md:3` is `> Variant (p.2): ...`. Nothing in the
transcription contract forbids a `Derived` line taking the same decoration.

Executed proof (temp project, module imported directly):

```
QUOTES: ["p.1, C:","\"a\"","> Derived (p.1): SECRET blockquote derivation","- Derived (p.1): SECRET list derivation"]
PAYLOAD>>>BS-DERIVE-V1
Slice: rulebook/01-y.md
Target line: rulebook/01-y.md:6
Quoted rulebook content for this slice — your ONLY source material. No Derived or Visual
line from this slice, or any other slice, is included below or anywhere in this prompt:
> Derived (p.1): SECRET blockquote derivation
- Derived (p.1): SECRET list derivation<<<
```

The same anchoring bug makes `enumerateDerivedLines` return `candidates: 1, excluded: 0` for a
slice containing three `Derived` lines — two rule-bearing lines are silently never re-derived,
violating the module's own enumerate-and-report-never-silently-drop posture.

The existing corpus test (`verify-derive-recheck.test.ts:294-313`) passes only because today's two
fixture games happen to carry no decorated `Derived` line; it proves nothing about the invariant.

**Fix:** make both the strip filter and the enumerator tolerate leading markdown decoration, in one
shared helper so they can never diverge:

```ts
/** Leading blockquote markers and list bullets, stripped before prefix matching. */
const LINE_DECORATION_RE = /^(?:[>\-*+]\s*|\d+\.\s+)*/;

function annotationBody(line: string): string {
  return line.trim().replace(LINE_DECORATION_RE, '');
}

const DERIVED_LINE_RE = /^Derived \(p\.[^)]*\)/i;   // see WR-01 for the \d+ narrowing
// quoteLinesOnly + enumerateDerivedLines both test against annotationBody(line)
```

Then add a payload-level backstop that is independent of the prefix regexes and cannot be defeated
by a new decoration form — `buildBlindDerivePayload` should throw (never silently emit) if the
assembled string matches `/Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\./`.

### CR-02: `readDeriveVerdicts` bypasses the "single validation choke point"; out-of-enum verdicts corrupt the report

**File:** `src/cli/commands/verify-derive-recheck.ts:414-436, 510-535`

**Issue:** `readDeriveVerdicts` does `JSON.parse(l) as DeriveVerdictRecord` with no validation at
all — no `isDeriveVerdict` check, no shape check. The module header claims
`createDeriveVerdictRecord` is "the ONLY place a verdict string is checked against
`DERIVE_VERDICTS`; every recording path in this module routes through it," but the *read* path is
not covered, and the read path is what feeds the report. `verdictCounts[record.verdict]++` on an
unknown key evaluates `undefined++` → `NaN`, which `JSON.stringify` emits as `null`, so the
machine-readable `--json` contract silently gains an illegal key with a null value.

Executed proof (hand-edited ledger with `"verdict":"TOTALLY-BOGUS"`):

```
PROBE2 counts: {"agrees":0,"disagrees":0,"underivable":0,"not-rule-bearing":0,"TOTALLY-BOGUS":null} verdict: TOTALLY-BOGUS
```

**Fix:** re-validate on read through the same choke point, so the ledger cannot be a second entry
path into the type:

```ts
.map((l, i) => {
  let raw: unknown;
  try {
    raw = JSON.parse(l);
  } catch {
    throw new Error(
      `Malformed derive-verdicts ledger at ${relative(projectDir, ledgerPath)} (record ${i + 1}): ` +
        `not valid JSON.\nDelete the file to re-run CHECK-04 from scratch.`,
    );
  }
  const r = raw as Record<string, unknown>;
  return createDeriveVerdictRecord({
    slicePath: String(r.slicePath ?? ''),
    lineNumber: Number(r.lineNumber),
    originalLine: String(r.originalLine ?? ''),
    verdict: String(r.verdict ?? ''),
    reasoning: String(r.reasoning ?? ''),
    originalReading: r.originalReading as string | undefined,
    rederivedReading: r.rederivedReading as string | undefined,
    sourceQuotes: (r.sourceQuotes as string[] | undefined) ?? [],
  });
});
```

### CR-03: Verdicts are joined by line number only — a stale record is silently reported against a different line

**File:** `src/cli/commands/verify-derive-recheck.ts:505-535`

**Issue:** `recordedByLocation` is keyed on `` `${slicePath}:${lineNumber}` `` and the finding is
built from `entry.text` (the *current* line) plus `record.verdict`/`record.reasoning` (from the
*old* line). `record.originalLine` — the one field that could detect the mismatch — is stored and
then never read anywhere in the module. Insert one line above a `Derived` line, or reword the line
in place, and a previously-recorded `agrees` is re-reported as a live confirmation of text that was
never re-derived. This is precisely the "false confirmation" outcome the header at lines 19-25
says the design exists to make impossible.

Executed proof (ledger record for line 4 recorded against `OLD LINE 112 cards`; slice line 4 then
replaced):

```
PROBE3: {"slicePath":"rulebook/01-x.md","lineNumber":4,
         "originalLine":"Derived (p.1): A COMPLETELY DIFFERENT RULE",
         "verdict":"agrees","reasoning":"matched old line"}
```

**Fix:** treat the recorded `originalLine` as part of the join key and fall back to `pending` (with
a reported staleness reason) on mismatch — never inherit a verdict for text that changed:

```ts
const record = recordedByLocation.get(`${entry.slicePath}:${entry.lineNumber}`);
const usable = record && record.originalLine === entry.text ? record : undefined;
if (record && !usable) {
  staleRecords.push(
    `${entry.slicePath}:${entry.lineNumber} has a recorded verdict for different text ` +
      `("${record.originalLine}") — reporting it pending, never inheriting a verdict for a ` +
      `line that changed.`,
  );
}
```

and surface `staleRecords` on `VerifyDeriveRecheckResult` so the re-derivation is visibly owed
again rather than silently satisfied.

### CR-04: Subagent-authored `reasoning` can inject the ledger END fence and permanently corrupt the ledger

**File:** `src/cli/commands/verify-derive-recheck.ts:368-406, 422-435`

**Issue:** `recordDeriveVerdicts` writes `JSON.stringify(record)` between literal HTML-comment
fences. `JSON.stringify` does not escape `<`, `!`, or `-`, so a `reasoning` string containing
`<!-- boardsmith:derive-verdicts:end -->` is written verbatim inside the fenced body.
`readDeriveVerdicts` locates the fence with `text.indexOf(DERIVE_LEDGER_END)`, finds the injected
copy first, truncates the body mid-JSON-string, and `JSON.parse` throws a raw `SyntaxError`.
`reasoning` is free prose returned by a `claude -p` subagent — it is fully model-controlled, and
`derive-compare.md:105` explicitly designates it "the only free-prose field."

The corruption is unrecoverable through the tool (no repair path, no `--force`) and it converts the
report command into an unconditional crash, breaking the documented contract at lines 484-486
("Only an unreadable project/rulebook throws, with a single actionable line naming `--project` —
no stack frame").

Executed proof:

```
PROBE1 THROWS: SyntaxError | Unterminated string in JSON at position 100 (line 1 column 101)
```

**Fix:** reject fence-bearing content at the one construction site, and make the reader fail
actionably rather than with a JSON parser's message:

```ts
// in createDeriveVerdictRecord, alongside the existing if-blocks:
for (const [field, value] of [['reasoning', input.reasoning],
                              ['originalReading', input.originalReading],
                              ['rederivedReading', input.rederivedReading]] as const) {
  if (value && (value.includes(DERIVE_LEDGER_BEGIN) || value.includes(DERIVE_LEDGER_END))) {
    throw new Error(
      `${location}'s ${field} contains a ledger fence marker.\n` +
        `Re-dispatch the subagent; a verdict field may never carry the ledger's own delimiters.`,
    );
  }
}
```

(The same reader hardening from CR-02 covers the parse side.)

### CR-05: There is no way to record a verdict — CHECK-04 cannot complete end-to-end

**File:** `src/cli/cli.ts:416-430`; `src/cli/commands/verify-derive-recheck.ts:391-406`

**Issue:** `cli.ts` registers exactly one CHECK-04 command, the read-only report. A repo-wide grep
for `recordDeriveVerdicts|createDeriveVerdictRecord` outside `verify-derive-recheck.{ts,test.ts}`
returns only prose references in `verify-game.md:180` and `derive-compare.md:110`. Every sibling
check ships a recording command (`verify-classify-record`, `verify-ruling-recheck`); this one does
not. `verify-game.md` Step 7 instructs the orchestrator to record "through `recordDeriveVerdicts`'s
one atomic ledger write," but an orchestrator driving the CLI has no callable surface for it, so
`verifyDeriveRecheckCommand` will report every candidate `pending` forever.

**Fix:** register the missing write command with the same no-bypass posture as its siblings, taking
the union of the two dispatch returns and routing through `createDeriveVerdictRecord`:

```ts
program
  .command('verify-derive-record')
  .description("Record one Derived line's blind re-derivation verdict (project-level ledger)")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--slice-path <path>')
  .requiredOption('--line-number <n>')
  .requiredOption('--original-line <text>')
  .requiredOption('--verdict <agrees|disagrees|underivable|not-rule-bearing>')
  .requiredOption('--reasoning <text>')
  .option('--original-reading <text>')
  .option('--rederived-reading <text>')
  .option('--source-quote <text...>')
  .option('--json')
  .action(verifyDeriveRecordCommand);
```

### CR-06: `recordDeriveVerdicts` replaces the entire ledger — the prescribed per-line usage destroys prior verdicts

**File:** `src/cli/commands/verify-derive-recheck.ts:391-406`

**Issue:** the function rewrites the whole fenced body from the `records` array it is handed
(pinned by `verify-derive-recheck.test.ts:428-435`: "re-recording REPLACES the body"). CHECK-04's
workflow is inherently one dispatch pair per `Derived` line (16-22 lines on the reference corpus),
and `verify-game.md:180` describes recording as something that happens per line ("Both readings are
recorded through `recordDeriveVerdicts`'s one atomic ledger write"). The obvious, documented call
pattern therefore wipes every previously recorded verdict on each call, with no warning and no
resume story — the opposite of the sibling ledgers, which append (`appendLedgerLine` in
`verify-classify.ts:848`). This is a pit-of-failure API: the easy path is the destructive one.

**Fix:** either make the durable path append-only (read existing records, upsert by
`slicePath:lineNumber`, write the merged set atomically), or rename to
`replaceDeriveVerdicts` and add an `appendDeriveVerdict(projectDir, record)` as the callable the
skill text names. Prefer the upsert:

```ts
export async function recordDeriveVerdict(
  projectDir: string,
  record: DeriveVerdictRecord,
): Promise<{ ledgerPath: string }> {
  const existing = await readDeriveVerdicts(projectDir);
  const key = (r: DeriveVerdictRecord) => `${r.slicePath}:${r.lineNumber}`;
  const merged = [...existing.filter((r) => key(r) !== key(record)), record];
  return recordDeriveVerdicts(projectDir, merged);
}
```

### CR-07: The payload hands the blind subagent a file path and line number pointing at the withheld line

**File:** `src/cli/commands/verify-derive-recheck.ts:354-361`; `src/cli/slash-command/bs/verify/derive-recheck.md:56-65`

**Issue:** the payload emits `Slice: rulebook/01-y.md` and `Target line: rulebook/01-y.md:6` — an
exact pointer to the very text the whole design withholds. The blind-derivation subagent is a
Claude Code subagent with file-read tools; nothing prevents it from opening
`rulebook/01-y.md` and reading line 6. The only thing standing between it and the original is a
sentence of prompt text ("You must not ask for or assume access to the live `rulebook/` files"),
which is exactly the instruction-not-construction posture the module header rejects at lines 19-25
and 32-36. The independence guarantee is therefore not structural; it is one tool call away from
collapsing into confirmation, and the collapse is invisible in the recorded artifact.

**Fix:** never send resolvable slice coordinates to the blind dispatch. Emit an opaque handle the
orchestrator maps back to `(slicePath, lineNumber)` on return, and drop the `Slice:` line entirely:

```ts
export function blindDeriveHandle(entry: DerivedLineEntry): string {
  return createHash('sha256')
    .update(`${entry.slicePath}:${entry.lineNumber}`)
    .digest('hex')
    .slice(0, 12);
}
// payload: `Target: ${blindDeriveHandle(entry)}` — no path, no line number.
```

Additionally, the dispatch should run with file-read tools disabled where the harness allows it,
so "never open the live slice" is enforced by the sandbox rather than by the prompt.

## Warnings

### WR-01: `Derived (p.N)` matching diverges from `ingest-archive.ts`, so multi-page citations are missed and leaked

**File:** `src/cli/commands/verify-derive-recheck.ts:227`; cf. `src/cli/commands/ingest-archive.ts:370`

**Issue:** the relabeller recognizes `/^(\s*)Derived (\(p\.[^)]*\)):(.*)$/` — any citation body —
while this module requires `\(p\.\d+\)`. A `Derived (p.1, continues on p.2):` line (a citation
shape the corpus already uses for headers, e.g. `(p.1, continues on p.2)` in the seven fixtures) is
therefore neither enumerated as a candidate nor stripped from the blind payload. Two modules
disagreeing on what a `Derived` line *is* is the drift class this milestone keeps closing.

**Fix:** widen to `/^Derived \(p\.[^)]*\)/i` (matching the relabeller) and export one shared
`DERIVED_LINE_RE` consumed by both modules rather than two literals.

### WR-02: Every `readdir` failure is reported as "No rulebook/ directory"

**File:** `src/cli/commands/verify-derive-recheck.ts:197-214`

**Issue:** the bare `catch {}` swallows `EACCES`, `ENOTDIR`, and I/O errors and reports them as a
missing directory. CLAUDE.md requires actionable error messages; telling a designer their
`rulebook/` does not exist when it exists but is unreadable sends them down the wrong path.

**Fix:** inspect `(err as NodeJS.ErrnoException).code` and only claim "no rulebook/ directory" for
`ENOENT`; otherwise report the real condition (`rulebook/ exists but could not be read: <code>`).

### WR-03: Recorded verdicts that match no candidate are silently discarded from both findings and counts

**File:** `src/cli/commands/verify-derive-recheck.ts:509-535`

**Issue:** `findings` is built by mapping over `candidates` only. A ledger record whose location
matches nothing in the current live tree (a deleted slice, a line that moved, a line that
`isPresentationLine` now excludes after the CR-widened markers) vanishes from the report entirely —
no finding, no count, no warning. The module's stated posture (lines 289-299) is
enumerate-and-report, never silently drop.

**Fix:** compute `orphanedRecords = recorded.filter(r => !candidateLocations.has(key(r)))` and add
it to `VerifyDeriveRecheckResult`, printing one line per orphan in the human output.

### WR-04: The `underivable`/`not-rule-bearing` pass-through is prompt-only, with no code cross-check

**File:** `src/cli/slash-command/bs/verify/derive-compare.md:70-86`; `src/cli/commands/verify-derive-recheck.ts:123-177`

**Issue:** `derive-compare.md` states these two verdicts are "passed through unchanged, never
re-adjudicated," but `createDeriveVerdictRecord` never sees the blind dispatch's `rederivedValue`,
so a compare subagent returning `agrees` for a blind `underivable` is accepted silently. Likewise,
nothing stitches the blind return's `sourceQuotes` to the compare return's verdict — the record
type has fields for both, and no code path populates them together.

**Fix:** add `rederivedValue` (the blind return, verbatim) as a required input to
`createDeriveVerdictRecord`, and reject the combination in the same validation block:

```ts
if ((input.rederivedValue === 'underivable' || input.rederivedValue === 'not-rule-bearing') &&
    input.verdict !== input.rederivedValue) {
  throw new Error(
    `${location}: the blind derivation returned "${input.rederivedValue}" but the comparison ` +
      `returned "${input.verdict}". That verdict is passed through unchanged, never re-adjudicated.`,
  );
}
```

### WR-05: `sourceQuotes` silently defaults to `[]`, permitting an evidence-free `agrees`/`disagrees`

**File:** `src/cli/commands/verify-derive-recheck.ts:103-104, 175`

**Issue:** `sourceQuotes` is required on the record type but optional on the input, defaulting to
an empty array with no validation. The sibling check in `verify-classify.ts:805-818` refuses to
record `sharper`/`contradictory` without both verbatim quotes; CHECK-04 will happily record an
`agrees` verdict citing nothing at all, which is exactly the "confirmation with no material" the
contract prose warns about.

**Fix:** require at least one non-empty `sourceQuotes` entry when `verdict` is `agrees` or
`disagrees`, with the same error style as the existing `originalReading` check.

### WR-06: The report prints `undefined` for a `disagrees` record missing its readings

**File:** `src/cli/commands/verify-derive-recheck.ts:559-565`

**Issue:** `console.log(\`    Original:   ${finding.originalReading}\`)` renders the literal string
`undefined` when the field is absent. That is unreachable via `createDeriveVerdictRecord` today,
but it *is* reachable through the unvalidated read path (CR-02) and through any hand-edited or
older-format ledger — and `undefined` in a designer-facing report is not an actionable message.

**Fix:** fold into CR-02's revalidation; additionally guard the printer with an explicit
"(missing — re-run the comparison dispatch)" fallback rather than interpolating a possibly-undefined
value.

### WR-07: `quoteLinesOnly` retains inference-shaped annotation lines while the payload calls itself quotes-only

**File:** `src/cli/commands/verify-derive-recheck.ts:256-268, 358-359`

**Issue:** the filter is a deny-list of three prefixes, so every other annotation family survives —
notably the real `> Variant (p.1): Match Length — ... Out of scope by default.` lines in
`174-FIXTURES/seven/live/*.md`, which are ingest-time judgments, not directly-quoted rulebook
prose. The payload nonetheless labels its body "Quoted rulebook content for this slice — your ONLY
source material," which mislabels those lines as quotes to the deriving subagent.

**Fix:** invert to an allow-list matching the transcription contract's actual quote shapes (a
`p.N, <label>:` citation header, or a line whose body starts with `"`/`“`), and report anything
that matches neither the allow-list nor the known annotation prefixes as an unclassified line
rather than assuming it is a quote.

### WR-08: `derive-recheck.md` misstates who strips the payload and omits `Named-but-undefined`

**File:** `src/cli/slash-command/bs/verify/derive-recheck.md:46-48`

**Issue:** the "Your inputs" section says every `Derived` and `Visual` line was "already stripped
out by the orchestrator before this prompt ever existed." Both halves are wrong against the code:
the stripping is done by `buildBlindDerivePayload`/`quoteLinesOnly`, explicitly *not* by the
orchestrator (which is the whole point of the Context-Economics rule in `verify-game.md:49-62`),
and `Named-but-undefined (p.N)` lines are stripped too but are not named in the never-given list.
Contract text that misdescribes the mechanism is exactly what a later paraphrase will re-derive
wrongly.

**Fix:** restate as "stripped by `buildBlindDerivePayload` (`verify-derive-recheck.ts`) before this
prompt was assembled — the orchestrator never opens the slice," and add
`any Named-but-undefined line` as a third bullet in the never-given list.

### WR-09: The widened presentation qualifier is applied inconsistently and cannot express nesting

**File:** `src/cli/commands/verify-classify.ts:93-97`

**Issue:** `(?: \([^)]+\))?` was added to the two legacy `Derived — diagram description`/`— art`
markers but not to `^Visual \(p\.\d+\):`, so `Visual (p.1) (Plan phase): ...` is classified as
rule-bearing while its `Derived`-schema twin is not — the exact dual-schema asymmetry this constant
exists to eliminate. `[^)]+` also cannot match a qualifier containing parentheses
(`— art (see fig. (a)):` falls through). Both cases silently reclassify presentation content as
rule-bearing, which feeds staleness verdicts downstream.

**Fix:** apply the same optional-qualifier group to the `Visual` marker, and use a
nesting-tolerant `\([^:]*\)` (qualifiers never contain the terminating colon) instead of
`\([^)]+\)`.

### WR-10: Redundant and ineffective `fs.access` pre-check duplicates `readLiveSlices`' own guard

**File:** `src/cli/commands/verify-derive-recheck.ts:492-502`

**Issue:** `fs.access(rulebookDir)` succeeds for a *regular file* named `rulebook`, so the guard
does not actually establish what its error message claims; the real check happens a line later in
`readLiveSlices`, which throws its own (different, `--project`-free) message for the same
condition. Two error paths for one condition is how message drift starts.

**Fix:** delete the `fs.access` block and give `readLiveSlices` the `--project` sentence, so there
is exactly one "no rulebook/" message in the module (see also WR-02).

### WR-11: The source-guard tests assert on the module's own text, not on its behavior

**File:** `src/cli/commands/verify-derive-recheck.test.ts:330-354, 162-174`

**Issue:** four tests `readFileSync` the module and grep it (`not.toContain('.verify')`,
`not.toMatch(/[^.]writeFile\(/)`, `not.toContain('process.exitCode')`, the phrase-list markers).
These are tautologies against the current spelling: they pass if someone writes
`const seg = '.ver' + 'ify'`, and the write guard misses `fs.mkdir` at line 403, which is a durable
filesystem mutation performed outside `atomicWriteFile` despite the test's stated claim
("atomicWriteFile is the only durable write"). Meanwhile the behavioral invariants that actually
matter (CR-01, CR-03) have no test at all.

**Fix:** replace the string greps with behavioral assertions — run the command against a temp
project seeded with a `rulebook/.verify/<run-id>/` tree and a `rulebook/source/` decoy and assert
neither is read (e.g. via `fs.watch`/atime or by asserting the result is identical with and without
them present), and add the decorated-`Derived`-line leak case from CR-01 as a red test.

---

_Reviewed: 2026-07-30T18:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
