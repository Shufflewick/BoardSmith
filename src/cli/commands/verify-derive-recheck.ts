import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { isPresentationLine } from './verify-classify.js';
import { atomicWriteFile } from './verify-run.js';
import { DERIVED_LINE_RE } from './derived-line-pattern.js';

/**
 * `verify-derive-recheck.ts` — CHECK-04's mechanical core (177-CONTEXT.md decision 2/5): the
 * frozen four-verdict enum, the single verdict-construction choke point, the live-slice
 * enumeration, and the quote-lines-only payload filter that makes the check's "independent
 * second opinion" guarantee STRUCTURAL rather than a prompt instruction.
 *
 * This module contains NO rule-bearingness keyword or phrase list anywhere. Recognizing whether a
 * surviving `Derived` line is actually rule-bearing (versus a page-layout/art description with no
 * qualifier, per 177-RESEARCH.md's measured `seven`-side examples) is subagent judgment, never a
 * string match here — the same defect class 176-RESEARCH.md Pitfall 4 named for an absence-phrase
 * list.
 *
 * This module's `buildBlindDerivePayload` is the ONE construction site for the blind-derivation
 * dispatch prompt, and it is structurally incapable of emitting the `Derived (p.` line under test:
 * `quoteLinesOnly` strips every `Derived`/`Visual`/`Named-but-undefined` line from a slice before
 * any payload is assembled, and `buildBlindDerivePayload` never touches an entry's own text. A
 * re-derivation that has seen the original is not a second opinion — it is a confirmation, and it
 * would report high agreement whether or not the original derivation was sound. Independence must
 * be structural: the original line is not in the dispatch payload at all.
 *
 * INDEPENDENCE IS DECORATION-INDEPENDENT AND BACKSTOPPED (177-08, closing GAP 2/CR-01): the
 * `^`-anchored trimmed-line matching this module originally used only stripped a `Derived`/
 * `Visual`/`Named-but-undefined` line when it was line-initial after trimming — an ordinary
 * blockquote (`> Derived (p.1): ...`) or list decoration (`- Derived (p.1): ...`) defeated it,
 * leaking the line into the blind payload AND silently dropping it from enumeration. `annotationBody`
 * is now the single decoration-normalization site both `quoteLinesOnly` and `enumerateDerivedLines`
 * route through before every prefix test, so the two can never diverge on what counts as decoration.
 * That alone is still a (wider) deny-list, so `buildBlindDerivePayload` additionally backstops at
 * the construction site: it throws on any assembled string matching an annotation family,
 * independent of which prefix regex missed it. A decoration form nobody anticipated fails loudly
 * instead of leaking — that is what makes the guarantee structural rather than incidental.
 *
 * This module reads the LIVE `rulebook/*.md` tree directly, never a staged `.verify/<runId>/`
 * tree (177-CONTEXT.md decision 12; 177-RESEARCH.md Pitfall 3) — `resolveFreshTranscription`
 * (`verify-ruling-recheck.ts`) resolves the STAGED transcription for a different question (Phase
 * 176's ruling re-check) and must not be reused here.
 *
 * SOURCE-FREE BY CONSTRUCTION, not by flag (177-CONTEXT.md decision 4, mirroring `trace-check.ts`'s
 * CHECK-03 posture): this module has no code path that opens the archived source rulebook
 * (`rulebook/source/*`) at all — `readLiveSlices` reads only `rulebook/*.md`, and no function in
 * this file ever joins `projectDir` with `rulebook/source`. Source-freeness is structural, never a
 * `--source-free` mode toggle a caller could forget to pass.
 *
 * The ledger this module writes (`recordDeriveVerdicts`/`readDeriveVerdicts`) is PROJECT-LEVEL —
 * `rulebook/.derive-recheck/DERIVE-VERDICTS.md`, no `.verify/<runId>/` segment, no `runId`
 * parameter anywhere in either function's signature (177-CONTEXT.md decision 14). CHECK-04 has
 * nothing to scope to a run: it is source-free by construction and independent of any verify run's
 * staleness verdicts, exactly like CHECK-03 (`trace-check.ts`) and CHECK-05 (`drift-check.ts`).
 * Every durable write in this module goes through `atomicWriteFile` (`verify-run.ts`) — the ONE
 * atomic write path in the repo (`173-REVIEW.md` CR-01's defect class) — never a second
 * `fs.writeFile`/`writeFileSync` call.
 */

// -------------------------------------------------------------------------------------------
// DERIVE_VERDICTS — the frozen four-member enum (177-CONTEXT.md decision 6)
// -------------------------------------------------------------------------------------------

/**
 * The verdict set is FOUR, not two or three. `underivable` is first-class and load-bearing: the
 * original transcription had the source PDF (component images, tables, card faces) while
 * re-derivation has only the quote lines a slice captured. A derivation that legitimately drew on
 * something the quote lines never recorded simply CANNOT be re-derived — neither agreement nor
 * disagreement. Collapsing it into `agrees` would report false confirmation; collapsing it into
 * `disagrees` would manufacture a false finding. `not-rule-bearing` is likewise first-class: the
 * mechanical presentation filter (`isPresentationLine`, reused verbatim from `verify-classify.ts`)
 * does not catch every presentation-shaped line (177-RESEARCH.md measured at least 3 unqualified
 * `seven`-side lines it misses entirely), so the surviving candidate set genuinely includes lines
 * that are not rule-bearing at all. Never collapse either into `agrees`/`disagrees` — the same
 * first-class-blindness principle this milestone has already applied to `drift-unknown`, `unknown`
 * provenance, `unclassified`, `unknown-drift`, and `undetermined`.
 */
export const DERIVE_VERDICTS = Object.freeze([
  'agrees',
  'disagrees',
  'underivable',
  'not-rule-bearing',
] as const);

export type DeriveVerdict = (typeof DERIVE_VERDICTS)[number];

function isDeriveVerdict(value: string): value is DeriveVerdict {
  return (DERIVE_VERDICTS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------
// DeriveVerdictRecord — the CLI-validated, subagent-supplied verdict record
// -------------------------------------------------------------------------------------------

export interface DeriveVerdictRecord {
  slicePath: string;
  lineNumber: number;
  /** The original `Derived (p.N): ...` line, verbatim — never mutated. */
  originalLine: string;
  verdict: DeriveVerdict;
  /** The reasoning IS the artifact, mirroring `verify-ruling-recheck.ts`'s decision 4 rule. */
  reasoning: string;
  /**
   * For a `disagrees` verdict, the original derivation quoted verbatim (177-CONTEXT.md decision
   * 8 — SC-2 requires findings that cite BOTH derivations, not a summary of the difference).
   * Optional for every other verdict.
   */
  originalReading?: string;
  /**
   * For a `disagrees` verdict, the blind re-derivation's own reading quoted verbatim. Optional
   * for every other verdict (an `underivable`/`not-rule-bearing` verdict has no second reading to
   * cite; an `agrees` verdict may still carry one for the report, but it is not required here).
   */
  rederivedReading?: string;
  /** The quote lines the blind-derivation dispatch actually cited in support of its answer. */
  sourceQuotes: string[];
  /**
   * The blind-derivation dispatch's own `rederivedValue`, verbatim (177-09, closing WR-04): either
   * the literal sentinel `underivable`/`not-rule-bearing`, or the blind stage's actual derived
   * reading text. Persisted so the pass-through rule (decision below) is auditable in the ledger,
   * not merely enforced in memory at construction time.
   */
  rederivedValue: string;
}

/**
 * Validates and constructs a `DeriveVerdictRecord` from a subagent's returned verdict. This is
 * the ONLY place a verdict string is checked against `DERIVE_VERDICTS`; every recording path AND
 * the read path (`readDeriveVerdicts`, 177-09 closing CR-02) route through it. Throws when:
 *
 *   - the verdict is outside `DERIVE_VERDICTS` (message names all four legal verdicts)
 *   - `reasoning` is empty or whitespace-only
 *   - the verdict is `disagrees` and `originalReading` is empty/missing (decision 8 — a
 *     disagreement without the original derivation quoted verbatim loses exactly the material a
 *     designer needs to adjudicate)
 *   - the verdict is `disagrees` and `rederivedReading` is empty/missing (same reason, the other
 *     side)
 *   - `reasoning`, `originalReading`, or `rederivedReading` contains the ledger's own begin/end
 *     fence marker (177-09, closing CR-04 — `reasoning` is model-controlled free prose and
 *     `JSON.stringify` does not escape `<`, so an unrejected fence permanently corrupts the ledger)
 *   - the verdict is `agrees`/`disagrees` and `sourceQuotes` has no non-empty entry (177-09,
 *     closing WR-05 — a confirmation or disagreement citing no material is not a valid record)
 *   - `rederivedValue` is `underivable`/`not-rule-bearing` and `verdict` differs from it (177-09,
 *     closing WR-04 — the blind stage's two terminal outcomes are passed through unchanged by the
 *     comparison stage, never re-adjudicated)
 *
 * Modeled as additional `if` blocks inside this same function — never a second validator
 * elsewhere in the module.
 */
export function createDeriveVerdictRecord(input: {
  slicePath: string;
  lineNumber: number;
  originalLine: string;
  verdict: string;
  reasoning: string;
  rederivedValue: string;
  originalReading?: string;
  rederivedReading?: string;
  sourceQuotes?: string[];
}): DeriveVerdictRecord {
  const location = `${input.slicePath}:${input.lineNumber}`;

  if (!isDeriveVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for ${location}.\n` +
        `Expected one of: ${DERIVE_VERDICTS.join(', ')}.`,
    );
  }
  if (input.reasoning.trim().length === 0) {
    throw new Error(
      `${location}'s verdict has no recorded reasoning.\n` +
        `The reasoning is the artifact this check exists to produce — a verdict label with no ` +
        `reasoning is not a valid record.`,
    );
  }
  if (input.verdict === 'disagrees') {
    if (!input.originalReading || input.originalReading.trim().length === 0) {
      throw new Error(
        `${location}'s "disagrees" verdict has no originalReading quoted verbatim.\n` +
          `SC-2 requires a finding citing BOTH derivations verbatim — a designer adjudicating a ` +
          `disagreement needs to see exactly what the original line said, not a summary.`,
      );
    }
    if (!input.rederivedReading || input.rederivedReading.trim().length === 0) {
      throw new Error(
        `${location}'s "disagrees" verdict has no rederivedReading quoted verbatim.\n` +
          `SC-2 requires a finding citing BOTH derivations verbatim — a designer adjudicating a ` +
          `disagreement needs to see exactly what the blind re-derivation produced, not a summary.`,
      );
    }
  }

  // 177-09 (closing CR-04): reject any field carrying the ledger's own fence marker at the one
  // construction site — the read path (`readDeriveVerdicts`) re-enters this same choke point, so
  // a fence can never reach a ledger, written by any caller, through any path.
  for (const [field, value] of [
    ['reasoning', input.reasoning],
    ['originalReading', input.originalReading],
    ['rederivedReading', input.rederivedReading],
  ] as const) {
    if (value && (value.includes(DERIVE_LEDGER_BEGIN) || value.includes(DERIVE_LEDGER_END))) {
      throw new Error(
        `${location}'s ${field} contains a ledger fence marker.\n` +
          `Re-dispatch the subagent; a verdict field may never carry the ledger's own delimiters.`,
      );
    }
  }

  // 177-09 (closing WR-05): an agrees/disagrees verdict citing no material is not a valid record.
  if (
    (input.verdict === 'agrees' || input.verdict === 'disagrees') &&
    (!input.sourceQuotes || input.sourceQuotes.every((q) => q.trim().length === 0))
  ) {
    throw new Error(
      `${location}'s "${input.verdict}" verdict has no sourceQuotes cited.\n` +
        `An agrees/disagrees verdict must cite at least one non-empty source quote — a ` +
        `confirmation or disagreement citing no material is not a valid record.`,
    );
  }

  // 177-09 (closing WR-04): the blind stage's two terminal outcomes are passed through unchanged
  // by the comparison stage — a compare subagent may never re-adjudicate an underivable/
  // not-rule-bearing blind return into agrees/disagrees.
  if (
    (input.rederivedValue === 'underivable' || input.rederivedValue === 'not-rule-bearing') &&
    input.verdict !== input.rederivedValue
  ) {
    throw new Error(
      `${location}: the blind derivation returned "${input.rederivedValue}" but the comparison ` +
        `returned "${input.verdict}". That verdict is passed through unchanged, never ` +
        `re-adjudicated.`,
    );
  }

  return {
    slicePath: input.slicePath,
    lineNumber: input.lineNumber,
    originalLine: input.originalLine,
    verdict: input.verdict,
    reasoning: input.reasoning,
    rederivedValue: input.rederivedValue,
    ...(input.originalReading !== undefined ? { originalReading: input.originalReading } : {}),
    ...(input.rederivedReading !== undefined
      ? { rederivedReading: input.rederivedReading }
      : {}),
    sourceQuotes: input.sourceQuotes ?? [],
  };
}

// -------------------------------------------------------------------------------------------
// readLiveSlices — the live `rulebook/*.md` tree (177-CONTEXT.md decision 12)
// -------------------------------------------------------------------------------------------

/**
 * Reads the LIVE `rulebook/*.md` tree directly — the same source `verify-classify.ts`'s
 * `computeRunPairs` already reads (excluding `INDEX.md`, the archive manifest, and
 * `00-visual-survey.md`, `ingest-archive.ts`'s presentation-by-design UI-ask handoff artifact).
 * This is the correct "which files are slices" definition for a source-free, run-less check
 * (177-CONTEXT.md decision 14): CHECK-04 targets live slices with NO staged prerequisite, so it
 * must NOT call `resolveFreshTranscription` (`verify-ruling-recheck.ts`), which resolves the
 * STAGED tree and would falsely report scope-limited on a project that has never staged a run.
 */
export async function readLiveSlices(
  projectDir: string,
): Promise<{ path: string; text: string }[]> {
  const rulebookDir = join(projectDir, 'rulebook');
  let names: string[];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    names = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith('.md') &&
          e.name !== 'INDEX.md' &&
          e.name !== '00-visual-survey.md',
      )
      .map((e) => e.name)
      .sort();
  } catch {
    throw new Error(
      `No rulebook/ directory in ${projectDir}.\n` +
        `CHECK-04 re-derives Derived lines against the live rulebook — nothing to read here.`,
    );
  }
  return Promise.all(
    names.map(async (name) => ({
      path: `rulebook/${name}`,
      text: await fs.readFile(join(rulebookDir, name), 'utf-8'),
    })),
  );
}

// -------------------------------------------------------------------------------------------
// quoteLinesOnly — the genuinely new payload filter (177-RESEARCH.md Question 1)
// -------------------------------------------------------------------------------------------

/**
 * Leading blockquote markers, list bullets, and ordered-list markers, repeatable (a line can be
 * both quoted AND bulleted, e.g. `> - Derived (p.1): ...`) — stripped before every prefix test.
 * This is the ONE decoration-normalization site (`annotationBody`, immediately below); no caller
 * re-derives its own trim/strip logic.
 */
const LINE_DECORATION_RE = /^(?:[>\-*+]\s*|\d+\.\s+)*/;

/**
 * Trims `line` and strips any leading markdown decoration (blockquote markers, list bullets,
 * ordered-list markers), returning the annotation-testable body. `quoteLinesOnly` and
 * `enumerateDerivedLines` both route through this single function before testing any of the three
 * prefix regexes below, so the two can never diverge on what counts as decoration (177-08,
 * closing CR-01). Not applied to anything else — a directly-quoted sentence's own leading `"` is
 * never decoration and must never be stripped.
 */
export function annotationBody(line: string): string {
  return line.trim().replace(LINE_DECORATION_RE, '');
}

/**
 * Citation body widened to `\(p\.[^)]*\)` (WR-01) — matches `ingest-archive.ts`'s relabeller
 * exactly, so a multi-page citation (`Derived (p.1, continues on p.2):`) is recognized identically
 * by both modules. Defined in `derived-line-pattern.ts` (a dependency-free leaf module) and
 * re-exported here so this module's own consumers, and any existing importer of `DERIVED_LINE_RE`
 * from this file, keep working unchanged.
 */
export { DERIVED_LINE_RE };
const VISUAL_LINE_RE = /^Visual \(p\.[^)]*\)/i;
/**
 * A `Named-but-undefined` line is an ingest-time INFERENCE about undefined terminology, not
 * directly-quoted rulebook prose (177-RESEARCH.md's answer to Question 1 names it alongside
 * `Derived`/`Visual` as a line the blind-derivation payload must exclude entirely). Excluding it
 * is not required to satisfy this plan's `Derived (p.`/`Visual (p.` zero-leak assertions, but
 * leaving an inferential line in a payload whose entire purpose is "quote lines only" would
 * silently reintroduce the same anchoring risk decision 5 exists to prevent, one line at a time.
 */
const NAMED_BUT_UNDEFINED_LINE_RE = /^Named-but-undefined \(p\.[^)]*\)/i;

/** All three annotation families, for the payload-level construction-site backstop below. */
const ANY_ANNOTATION_LINE_RE = /Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\./i;

/**
 * Selects ONLY directly-quoted rulebook content and its citation headers from `sliceText` — the
 * deliberate INVERSE of `ruleBearingLines()` (`verify-classify.ts`), which KEEPS unqualified
 * `Derived` lines because they are rule-bearing for classification purposes. CHECK-04 needs the
 * opposite selection: `Derived`/`Visual`/`Named-but-undefined` lines are excluded ENTIRELY here,
 * not merely the presentation-tagged subset `isPresentationLine` excludes, because decision 5
 * forbids the blind-deriving subagent from seeing ANY `Derived` line — not just the one under
 * test.
 *
 * Drops blank lines and markdown headings (`#`) the same way `ruleBearingLines()` does. Bare
 * `p.N, <label>:` citation headers are RETAINED (they carry no rule content of their own, but a
 * blind-derivation subagent needs them to know which page a quote comes from) along with the
 * directly-quoted prose beneath them.
 *
 * This is the single construction site for what counts as a "quote line" in this module — no
 * caller re-derives its own subset of a slice's content.
 */
export function quoteLinesOnly(sliceText: string): string[] {
  return sliceText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0 || line.startsWith('#')) return false;
      const body = annotationBody(line);
      return (
        !DERIVED_LINE_RE.test(body) &&
        !VISUAL_LINE_RE.test(body) &&
        !NAMED_BUT_UNDEFINED_LINE_RE.test(body)
      );
    });
}

// -------------------------------------------------------------------------------------------
// enumerateDerivedLines — enumerate-and-report, never silently drop (177-RESEARCH.md decision 2)
// -------------------------------------------------------------------------------------------

export interface DerivedLineEntry {
  slicePath: string;
  /** 1-based, matching the file's own line numbering. */
  lineNumber: number;
  /** The line's own verbatim, trimmed text. */
  text: string;
}

export interface EnumerateDerivedLinesResult {
  /** Every `Derived (p.` line surviving `isPresentationLine` exclusion — reaches the subagent. */
  candidates: DerivedLineEntry[];
  /** `Derived (p.` lines the mechanical presentation filter excluded, reported not dropped. */
  excluded: DerivedLineEntry[];
}

/**
 * Enumerates every `Derived (p.` line in the live tree, split into the mechanically-excluded
 * presentation subset and the surviving candidates a judgment subagent evaluates. Mirrors
 * `enumerateRulingsForRecheck`'s (`verify-ruling-recheck.ts`) enumerate-and-report-never-
 * silently-drop posture — the excluded set is reported alongside the candidates, not discarded.
 *
 * Does NOT decide rule-bearingness here — that is the subagent's job (177-CONTEXT.md decision 2).
 * `isPresentationLine` only catches the QUALIFIED presentation forms (`— diagram description:`,
 * `— art:`, `Visual (p.N):`); 177-RESEARCH.md measured at least 3 `seven`-side lines that are
 * presentation-shaped with no qualifier at all and therefore reach `candidates` by design,
 * depending entirely on a competent subagent returning `not-rule-bearing` for them.
 */
export function enumerateDerivedLines(
  slices: { path: string; text: string }[],
): EnumerateDerivedLinesResult {
  const candidates: DerivedLineEntry[] = [];
  const excluded: DerivedLineEntry[] = [];

  for (const slice of slices) {
    const rawLines = slice.text.split('\n');
    rawLines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      const body = annotationBody(line);
      if (!DERIVED_LINE_RE.test(body)) return;
      const entry: DerivedLineEntry = {
        slicePath: slice.path,
        lineNumber: index + 1,
        text: line,
      };
      if (isPresentationLine(body)) {
        excluded.push(entry);
      } else {
        candidates.push(entry);
      }
    });
  }

  return { candidates, excluded };
}

// -------------------------------------------------------------------------------------------
// buildBlindDerivePayload — the single construction site (177-CONTEXT.md decision 5)
// -------------------------------------------------------------------------------------------

/** Handshake token proving a dispatch prompt was copied, not composed from memory. */
export const BLIND_DERIVE_TOKEN = 'BS-DERIVE-V1';

/**
 * Builds the blind-derivation dispatch prompt for ONE `Derived` line's slice. This is the SINGLE
 * construction site for that prompt — no caller may append to its output before dispatch. It
 * receives `entry` for identity/ordering ONLY (`entry.slicePath`/`entry.lineNumber` name which
 * line the dispatch is for); `entry.text` — the original `Derived` line itself — is NEVER read
 * or emitted here. The payload's only source material is `quoteLinesOnly(slice.text)`, which has
 * already stripped every `Derived`/`Visual`/`Named-but-undefined` line from the slice.
 *
 * A derivation that has seen the original `Derived` line is not a second opinion, it is a
 * confirmation — it would report high agreement whether or not the original derivation was
 * sound. This function is where that independence guarantee is either upheld or broken; it is
 * upheld here by construction, not by instruction, because `entry.text` is structurally absent
 * from the assembled string.
 *
 * CONSTRUCTION-SITE BACKSTOP (177-08, closing CR-01): after assembly, the payload is tested
 * against `ANY_ANNOTATION_LINE_RE` and THROWS — never silently emits — if it still matches. This
 * check is independent of `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE`/
 * `annotationBody`: it does not care WHY a line leaked, only THAT one did. The prefix regexes can
 * still miss a decoration form nobody anticipated; this backstop is the reason a miss fails loudly
 * at the one construction site rather than leaking into a dispatched prompt.
 */
export function buildBlindDerivePayload(
  slice: { path: string; text: string },
  entry: DerivedLineEntry,
): string {
  const quotes = quoteLinesOnly(slice.text);
  const payload = [
    BLIND_DERIVE_TOKEN,
    `Slice: ${slice.path}`,
    `Target line: ${entry.slicePath}:${entry.lineNumber}`,
    'Quoted rulebook content for this slice — your ONLY source material. No Derived or Visual',
    'line from this slice, or any other slice, is included below or anywhere in this prompt:',
    ...quotes,
  ].join('\n');

  if (ANY_ANNOTATION_LINE_RE.test(payload)) {
    throw new Error(
      `buildBlindDerivePayload assembled a payload for ${entry.slicePath}:${entry.lineNumber} ` +
        `that still matches an annotation family (Derived (p./Visual (p./Named-but-undefined (p.).\n` +
        `The payload construction site, not the prompt text, is where independence is upheld — ` +
        `quoteLinesOnly()/annotationBody() missed a decoration form. Fix the strip filter; never ` +
        `relax this check to let the payload through.`,
    );
  }

  return payload;
}

// -------------------------------------------------------------------------------------------
// recordDeriveVerdicts / readDeriveVerdicts — the PROJECT-LEVEL ledger (decision 14)
// -------------------------------------------------------------------------------------------

const DERIVE_LEDGER_BEGIN = '<!-- boardsmith:derive-verdicts:begin -->';
const DERIVE_LEDGER_END = '<!-- boardsmith:derive-verdicts:end -->';

/**
 * The project-level ledger path — `rulebook/.derive-recheck/DERIVE-VERDICTS.md`. No `.verify/`
 * segment, no `runId` anywhere in this path: CHECK-04 has nothing to scope to a run (decision 14).
 */
function deriveVerdictsLedgerPath(projectDir: string): string {
  return join(projectDir, 'rulebook', '.derive-recheck', 'DERIVE-VERDICTS.md');
}

/**
 * Persists a batch of already-validated `DeriveVerdictRecord`s (every record MUST have already
 * passed through `createDeriveVerdictRecord` — this function accepts validated records and does
 * not re-parse verdict strings) to the project-level ledger, through `atomicWriteFile` — the ONE
 * atomic write path in the repo. Re-recording REPLACES the body atomically: `atomicWriteFile`'s
 * temp-write-then-rename means no partial file is ever observable, matching
 * `recordRulingVerdicts`'s (`verify-ruling-recheck.ts`) begin/end fenced JSON-lines shape exactly,
 * minus the run-scoping this check does not have.
 *
 * Accepts no `runId` parameter (2-arity: `projectDir`, `records`) — the ledger path contains no
 * run-id segment.
 */
export async function recordDeriveVerdicts(
  projectDir: string,
  records: DeriveVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const ledgerPath = deriveVerdictsLedgerPath(projectDir);
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Derive Verdicts (CHECK-04) — project-level, no run-id\n\n` +
    `${DERIVE_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${DERIVE_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}

/**
 * Round-trips exactly what `recordDeriveVerdicts` wrote, including a record whose verdict is
 * `underivable`. Returns an empty array (never throws) when no ledger has been written yet — a
 * project that has never run `verify-derive-recheck`'s recording step has nothing recorded, which
 * is not a tool failure. Accepts no `runId` parameter (1-arity: `projectDir`).
 */
export async function readDeriveVerdicts(projectDir: string): Promise<DeriveVerdictRecord[]> {
  const ledgerPath = deriveVerdictsLedgerPath(projectDir);
  let text: string;
  try {
    text = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return [];
  }
  const beginIdx = text.indexOf(DERIVE_LEDGER_BEGIN);
  const endIdx = text.indexOf(DERIVE_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Malformed derive-verdicts ledger at ${relative(projectDir, ledgerPath)}: missing ` +
        `begin/end fence.`,
    );
  }
  const body = text.slice(beginIdx + DERIVE_LEDGER_BEGIN.length, endIdx);
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DeriveVerdictRecord);
}

// -------------------------------------------------------------------------------------------
// verifyDeriveRecheckCommand — the report command (decisions 8, 15)
// -------------------------------------------------------------------------------------------

export interface DeriveRecheckFinding {
  slicePath: string;
  lineNumber: number;
  /** The original `Derived (p.N): ...` line, verbatim. */
  originalLine: string;
  verdict: DeriveVerdict | 'pending';
  reasoning: string;
  /** Present, verbatim, on every `disagrees` finding (decision 8). */
  originalReading?: string;
  /** Present, verbatim, on every `disagrees` finding (decision 8). */
  rederivedReading?: string;
}

export interface VerifyDeriveRecheckResult {
  project: string;
  /** Every `Derived` line surviving `isPresentationLine` exclusion — the subagent's candidate set. */
  enumeratedCount: number;
  /** `Derived` lines the mechanical presentation filter excluded (reported, not silently dropped). */
  presentationExcludedCount: number;
  verdictCounts: Record<DeriveVerdict, number>;
  findings: DeriveRecheckFinding[];
}

function emptyDeriveVerdictCounts(): Record<DeriveVerdict, number> {
  const counts = {} as Record<DeriveVerdict, number>;
  for (const v of DERIVE_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * `boardsmith verify-derive-recheck` — CHECK-04's report: enumerates every live-tree `Derived`
 * line, joins each surviving candidate to whatever verdict `recordDeriveVerdicts` has already
 * persisted to the project-level ledger, and reports one finding per candidate (verdict `pending`
 * when nothing has been recorded for it yet). `verdictCounts` includes all four `DERIVE_VERDICTS`
 * with zeros written explicitly — never an omitted key for a verdict that happened not to occur.
 *
 * A `disagrees` finding always carries BOTH `originalReading` and `rederivedReading` verbatim
 * (decision 8 — SC-2 requires citing both derivations, and `createDeriveVerdictRecord` already
 * guarantees neither field is empty on a `disagrees` record reaching the ledger).
 *
 * Runs project-wide with no `--run-id` and no staged run present (decision 14) — this is a
 * READ-ONLY report: it never calls `recordDeriveVerdicts` itself. Findings exit 0 (this module
 * never sets `process.exitCode` anywhere — a disagreement is a finding, not a gate, decision 15).
 * Only an unreadable project/rulebook throws, with a single actionable line naming `--project` —
 * no stack frame, no `.ts:` reference.
 */
export async function verifyDeriveRecheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<VerifyDeriveRecheckResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const rulebookDir = join(projectDir, 'rulebook');
  try {
    await fs.access(rulebookDir);
  } catch {
    throw new Error(
      `No rulebook/ directory in ${projectDir}.\n` +
        `Pass --project <dir> to target the bs-project this check should read.`,
    );
  }

  const slices = await readLiveSlices(projectDir);
  const { candidates, excluded } = enumerateDerivedLines(slices);
  const recorded = await readDeriveVerdicts(projectDir);
  const recordedByLocation = new Map(
    recorded.map((r) => [`${r.slicePath}:${r.lineNumber}`, r] as const),
  );

  const verdictCounts = emptyDeriveVerdictCounts();
  const findings: DeriveRecheckFinding[] = candidates.map((entry) => {
    const record = recordedByLocation.get(`${entry.slicePath}:${entry.lineNumber}`);
    if (record) {
      verdictCounts[record.verdict]++;
      return {
        slicePath: entry.slicePath,
        lineNumber: entry.lineNumber,
        originalLine: entry.text,
        verdict: record.verdict,
        reasoning: record.reasoning,
        ...(record.originalReading !== undefined
          ? { originalReading: record.originalReading }
          : {}),
        ...(record.rederivedReading !== undefined
          ? { rederivedReading: record.rederivedReading }
          : {}),
      };
    }
    return {
      slicePath: entry.slicePath,
      lineNumber: entry.lineNumber,
      originalLine: entry.text,
      verdict: 'pending' as const,
      reasoning: '',
    };
  });

  const result: VerifyDeriveRecheckResult = {
    project: projectDir,
    enumeratedCount: candidates.length,
    presentationExcludedCount: excluded.length,
    verdictCounts,
    findings,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Derive re-check — ${candidates.length} rule-bearing candidate(s), ` +
        `${excluded.length} presentation-excluded`,
    ),
  );
  for (const v of DERIVE_VERDICTS) {
    console.log(`  ${v}: ${verdictCounts[v]}`);
  }
  for (const finding of findings) {
    if (finding.verdict === 'disagrees') {
      console.log(chalk.yellow(`  ⚠ DISAGREES — ${finding.slicePath}:${finding.lineNumber}`));
      console.log(`    Original:   ${finding.originalReading}`);
      console.log(`    Rederived:  ${finding.rederivedReading}`);
      console.log(`    Reasoning:  ${finding.reasoning}`);
    }
  }

  return result;
}
