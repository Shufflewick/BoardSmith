import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  annotationBody,
  EXAMPLE_LINE_RE,
  VISUAL_LINE_RE,
  DERIVE_CHECK_LEDGER_BEGIN,
  DERIVE_CHECK_LEDGER_END,
} from './verify-derive-check.js';
import { DERIVED_LINE_RE } from './derived-line-pattern.js';

/**
 * `example-derivation.ts` — the ONE shared module both the build side (TEST-01, `build/test.md`)
 * and the verify side (CHECK-06, a new `verify-game.md` step) call to turn a worked example into
 * a runnable test. This IS ROADMAP success criterion 3 ("both mechanisms share the same
 * example-to-test derivation logic rather than duplicating it") — no consuming module may
 * re-implement any symbol exported here (plan 178-11's SC-3 proof asserts exactly one export
 * site per symbol under `src/`).
 *
 * Three things this module owns, and why they are here rather than split across build/verify:
 *
 * 1. `WorkedExampleSpec` — a structured record of one worked example, never test code itself
 *    (178-CONTEXT.md decision 5). `createWorkedExampleSpec` is the ONE construction/validation
 *    choke point, mirroring `createDeriveCheckRecord`'s shape in `verify-derive-check.ts`
 *    (fence-marker rejection reused verbatim from that module rather than re-spelled here).
 *
 * 2. Caller-assigned identity (`workedExampleId`) and a fail-closed collision path
 *    (`collectWorkedExampleSpecs`). Phase 177.1's code review (CR-01/CR-02) found three criticals
 *    sharing one root: lookups keyed by MODEL-SUPPLIED free text instead of stable identity, so
 *    two model outputs phrasing themselves identically silently collapsed onto one entry. This
 *    module never keys anything by `sourceText`/`setup`/`expected` — only by `slicePath` +
 *    `lineNumber`, which the CALLER (never the model) supplies. A collision throws; it never
 *    overwrites.
 *
 * 3. TWO dispatch payload builders (178-CONTEXT.md decision 6 — extract, then translate, never
 *    one combined pass): `buildExampleExtractionPayload` turns a rulebook slice into the
 *    extractor's dispatch payload, and `buildExampleTranslationPayload` turns a validated spec
 *    plus a generated project's real API surface (`collectGameApiSurface`) into the translator's
 *    dispatch payload. `buildExampleExtractionPayload` is deliberately NOT `quoteLinesOnly`
 *    (`verify-derive-check.ts`) reused or inverted — WR-07 was resolved as Option B (178-01,
 *    `178-WR07-DECISION.md`): `quoteLinesOnly` keeps excluding `Example (p.N):` lines for its own
 *    CHECK-04 consumers, and this module builds its own separate, positively-defined allow-list
 *    that INCLUDES them, plus the `Visual (p.N):` lines a Derived-only view would miss entirely.
 *    `seven`'s Run-example contradiction (printed "5, 6, 7" vs. card art 1, 2, 3) is recorded
 *    ONLY in a `Visual (p.1):` line — stripping Visual lines would make the `example-inconsistent`
 *    path (178-CONTEXT.md decision 4) structurally undetectable.
 *
 * `collectGameApiSurface` verified (2026-07-31, plan 178-02 Task 3) against the real
 * `~/BoardSmithGames/seven/src/rules/scoring.ts`: `seven` does NOT export free `isSet`/`isRun`
 * functions. It exposes `ScoringPattern.check` members on three exported pattern constants —
 * `RUN_OF_SEVEN_PATTERN`, `COMBO_SETS_AND_RUNS_PATTERN`, `SET_5_PLUS_SET_2_PATTERN` — plus
 * `legalScoringPatterns(scoredCards)` and `numberCardsOf(cards)`, both of which take `SevenCard[]`
 * element objects rather than raw numbers. A `predicate` example therefore translates to
 * constructing real `SevenCard` elements and calling `.check(...)`, never a bare numeric-array
 * predicate call — the translation contract (plan 178-07) must say so.
 */

// -------------------------------------------------------------------------------------------
// Task 1 — WorkedExample spec, caller-assigned identity, fail-closed collision
// -------------------------------------------------------------------------------------------

export const WORKED_EXAMPLE_KINDS = Object.freeze(['transition', 'predicate'] as const);

export type WorkedExampleKind = (typeof WORKED_EXAMPLE_KINDS)[number];

function isWorkedExampleKind(value: string): value is WorkedExampleKind {
  return (WORKED_EXAMPLE_KINDS as readonly string[]).includes(value);
}

export interface WorkedExampleSpec {
  /** Caller-assigned (`workedExampleId`) — NEVER a model-returned field. */
  readonly id: string;
  readonly slicePath: string;
  /** 1-based, matching the slice file's own line numbering. */
  readonly lineNumber: number;
  readonly pageCitation: string;
  readonly kind: WorkedExampleKind;
  /** Verbatim substring of the slice text the example was drawn from. */
  readonly sourceText: string;
  readonly setup: string;
  /** `transition` only — a `predicate` spec never carries this field. */
  readonly action?: string;
  readonly expected: string;
  /**
   * The verbatim slice lines the extractor cited in support — plan 178-04's provenance gate
   * consumes these against the archived source (178-CONTEXT.md decision 12).
   */
  readonly supportingQuoteLines: readonly string[];
}

/**
 * Composes a stable, deterministic id from ONLY caller-known inputs (`slicePath` + `lineNumber`)
 * — it never reads any model-returned field. This is the identity `collectWorkedExampleSpecs`
 * keys its collision check on, and the direct fix for CR-01/CR-02's hazard class: two model
 * outputs that phrase an example identically must never collapse onto one entry just because
 * their TEXT happens to match, and two model outputs describing the SAME slice line must never
 * silently coexist as if they were different examples.
 */
export function workedExampleId(input: { slicePath: string; lineNumber: number }): string {
  return `${input.slicePath}:${input.lineNumber}`;
}

/** A short, non-identifying preview of a colliding example's source text for an error message. */
function sourcePreview(text: string, maxLen = 80): string {
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

/**
 * The ONE construction/validation choke point for a `WorkedExampleSpec` — mirrors
 * `createDeriveCheckRecord`'s shape (`verify-derive-check.ts`) rather than inventing a second
 * validator design. `id` is CALLER-assigned (typically `workedExampleId(returned)`); `returned`
 * is the model's raw, untrusted object. Throws when:
 *
 *   - `returned.kind` is outside `WORKED_EXAMPLE_KINDS`
 *   - any free-prose field (`pageCitation`, `sourceText`, `setup`, `expected`) is empty or
 *     whitespace-only
 *   - any free-prose field (including `action`, when present) contains the ledger's own
 *     begin/end fence marker (reusing `DERIVE_CHECK_LEDGER_BEGIN`/`DERIVE_CHECK_LEDGER_END` from
 *     `verify-derive-check.ts` rather than re-spelling them — this module writes no ledger of its
 *     own yet, but any future one this module feeds must never be corruptible by an unrejected
 *     fence reaching it through a spec built here)
 *   - `returned.sourceText` is not a verbatim substring of `sliceText`
 *   - `returned.kind === 'transition'` and no non-empty `action` is supplied
 *   - `returned.kind === 'predicate'` and a non-empty `action` IS supplied
 */
export function createWorkedExampleSpec(input: {
  id: string;
  sliceText: string;
  returned: {
    slicePath: string;
    lineNumber: number;
    pageCitation: string;
    kind: string;
    sourceText: string;
    setup: string;
    action?: string;
    expected: string;
    supportingQuoteLines?: string[];
  };
}): WorkedExampleSpec {
  const { id, sliceText, returned } = input;
  const location = `${returned.slicePath}:${returned.lineNumber}`;

  if (!isWorkedExampleKind(returned.kind)) {
    throw new Error(
      `Invalid kind "${returned.kind}" for the worked example at ${location}.\n` +
        `Expected one of: ${WORKED_EXAMPLE_KINDS.join(', ')}.`,
    );
  }

  const proseFields: [string, string][] = [
    ['pageCitation', returned.pageCitation],
    ['sourceText', returned.sourceText],
    ['setup', returned.setup],
    ['expected', returned.expected],
  ];
  for (const [field, value] of proseFields) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(
        `The worked example at ${location} has an empty "${field}" field.\n` +
          `Every free-prose field must be non-empty — an empty field is not a valid worked example.`,
      );
    }
  }

  const hasAction = typeof returned.action === 'string' && returned.action.trim().length > 0;

  const fenceCheckFields: [string, string][] = [
    ...proseFields,
    ...(hasAction ? ([['action', returned.action as string]] as [string, string][]) : []),
    ...(returned.supportingQuoteLines ?? []).map(
      (line, i): [string, string] => [`supportingQuoteLines[${i}]`, line],
    ),
  ];
  for (const [field, value] of fenceCheckFields) {
    if (value.includes(DERIVE_CHECK_LEDGER_BEGIN) || value.includes(DERIVE_CHECK_LEDGER_END)) {
      throw new Error(
        `The worked example at ${location}'s "${field}" contains a ledger fence marker.\n` +
          `Re-dispatch the subagent; a worked-example field may never carry the ledger's own ` +
          `delimiters.`,
      );
    }
  }

  if (!sliceText.includes(returned.sourceText)) {
    throw new Error(
      `The worked example at ${location}'s sourceText is not a verbatim substring of the ` +
        `supplied slice text: "${returned.sourceText}".\n` +
        `sourceText must be copied verbatim from the slice — never paraphrased or reconstructed.`,
    );
  }

  if (returned.kind === 'transition' && !hasAction) {
    throw new Error(
      `The worked example at ${location} has kind "transition" but no "action" field.\n` +
        `A transition example must name the action that moves setup to expected.`,
    );
  }
  if (returned.kind === 'predicate' && hasAction) {
    throw new Error(
      `The worked example at ${location} has kind "predicate" but supplies an "action" field.\n` +
        `A predicate example illustrates a definition, not a state-changing action — remove ` +
        `"action" or change kind to "transition".`,
    );
  }

  const spec: WorkedExampleSpec = {
    id,
    slicePath: returned.slicePath,
    lineNumber: returned.lineNumber,
    pageCitation: returned.pageCitation,
    kind: returned.kind,
    sourceText: returned.sourceText,
    setup: returned.setup,
    ...(hasAction ? { action: returned.action } : {}),
    expected: returned.expected,
    supportingQuoteLines: Object.freeze([...(returned.supportingQuoteLines ?? [])]),
  };
  return Object.freeze(spec);
}

/**
 * Builds a `Map<id, WorkedExampleSpec>` and THROWS on a duplicate id rather than overwriting —
 * the direct inheritance of CR-01/CR-02's fix (177.1's code review). Two specs whose
 * model-authored text is byte-identical but whose caller-assigned ids differ (different
 * `slicePath`/`lineNumber`) are both retained; two specs that resolve to the SAME id are a
 * collision, and last-write-wins is precisely the defect class this milestone just removed.
 */
export function collectWorkedExampleSpecs(
  specs: readonly WorkedExampleSpec[],
): Map<string, WorkedExampleSpec> {
  const map = new Map<string, WorkedExampleSpec>();
  for (const spec of specs) {
    const existing = map.get(spec.id);
    if (existing) {
      throw new Error(
        `Two worked examples collided on id "${spec.id}".\n` +
          `Existing: ${sourcePreview(existing.sourceText)}\n` +
          `New:      ${sourcePreview(spec.sourceText)}\n` +
          `Ids are caller-assigned (workedExampleId) and must be unique — collectWorkedExampleSpecs ` +
          `never overwrites a prior entry. If these are genuinely two different examples, assign ` +
          `them distinct ids.`,
      );
    }
    map.set(spec.id, spec);
  }
  return map;
}

// -------------------------------------------------------------------------------------------
// Task 2 — buildExampleExtractionPayload: CHECK-06's own inclusion logic (WR-07 Option B)
// -------------------------------------------------------------------------------------------

/** Handshake token proving a dispatch prompt was copied, not composed from memory. */
export const EXAMPLE_EXTRACTION_TOKEN = 'BS-EXAMPLE-EXTRACT-V1';

/**
 * A directly-quoted sentence, after `annotationBody`'s decoration strip — the printed rulebook
 * prose itself (`"example: 5, 6, 7"`, `"If you are punched..."`).
 */
const QUOTED_PROSE_LINE_RE = /^"/;

/**
 * A bare `p.N, <label>:` (or `p.N (panel -N-), <label>:`) citation header — carries no rule
 * content of its own, but an extractor needs it to know which page/panel a quote comes from.
 * Matches the real forms measured in `<corpus_reality>`: `p.1, Definitions:`,
 * `p.2, Punch Examples (italic):`, `p.1 (panel -7-), DESTROYING A MACHINE PART:`,
 * `p.2 (panel -8-), EXAMPLE:`.
 */
const CITATION_HEADER_RE = /^p\.\d+(?:\s*\([^)]*\))?,\s+[^\n]*:$/;

/**
 * `doom-machine/rulebook/01-destroying-a-machine-part.md:13` —
 * `Worked example content (p.1, panel -7-, verbatim from card art):`. Named as a constant with
 * the real slice path in this comment so a future reader can find the fixture it came from.
 */
const WORKED_EXAMPLE_CONTENT_HEADER_RE = /^Worked example content \(/i;

/**
 * `doom-machine/rulebook/02-machine-phase.md:15` —
 * `Diagram description (p.2, panel -8-, the EXAMPLE image):`. The SOUL HARVESTER example is
 * present in this slice ONLY as this header form (no `Example (p.N):` marker, no `Worked example
 * content (` header), so excluding it would make that fixture unextractable. Named as a constant
 * with the real slice path in this comment so a future reader can find the fixture it came from.
 */
const DIAGRAM_DESCRIPTION_HEADER_RE = /^Diagram description \(/i;

/**
 * The extraction payload's inclusion test — a POSITIVE allow-list (the deliberate INVERSE of
 * `quoteLinesOnly`'s deny-list, per WR-07 Option B): quoted prose lines, `p.N, <label>:` citation
 * headers, `Example (p.N):` lines, `Visual (p.N):` lines, and the two doom-machine header forms.
 * Everything else — including every `Derived (p.N):` line — is excluded. Routes every prefix
 * test through `annotationBody` (`verify-derive-check.ts`), never a second decoration-
 * normalization implementation.
 */
function isExtractionLine(line: string): boolean {
  const body = annotationBody(line);
  return (
    QUOTED_PROSE_LINE_RE.test(body) ||
    CITATION_HEADER_RE.test(body) ||
    EXAMPLE_LINE_RE.test(body) ||
    VISUAL_LINE_RE.test(body) ||
    WORKED_EXAMPLE_CONTENT_HEADER_RE.test(body) ||
    DIAGRAM_DESCRIPTION_HEADER_RE.test(body)
  );
}

export interface ExampleExtractionLine {
  /** 1-based, matching the input text's own line numbering. */
  lineNumber: number;
  /** The line's own verbatim, trimmed text. */
  text: string;
}

export interface ExampleExtractionPayload {
  slicePath: string;
  lines: ExampleExtractionLine[];
  payload: string;
}

/**
 * `DERIVED_LINE_RE` with its `^` anchor stripped — used ONLY by the construction-site backstop
 * below, which deliberately scans for a `Derived (p.N):` reference ANYWHERE inside a retained
 * line's text, not only at that line's own start. A line-start-only check can only ever catch
 * what the inclusion allow-list's own line-start tests already rule out by construction (every
 * allow-list predicate above requires a DIFFERENT literal prefix than `Derived (p.`, so a
 * line-start Derived match can never coexist with any of them — that would make a line-start-only
 * backstop permanently unreachable, the same "backstop that can only catch what the filter's
 * author already anticipated" failure `verify-enumerate.ts`'s own header comment warns against).
 * An UNANCHORED scan instead catches a `Derived (p.N):` reference embedded mid-line — inside a
 * quoted sentence, a citation header's trailing prose, or a Visual/Worked-example-content/Diagram
 * description line's own free text — which the allow-list's line-start tests are structurally
 * blind to.
 */
const DERIVED_REFERENCE_ANYWHERE_RE = new RegExp(
  DERIVED_LINE_RE.source.replace(/^\^/, ''),
  DERIVED_LINE_RE.flags,
);

/**
 * Builds the extraction dispatch payload for ONE slice: every line the allow-list above retains,
 * each carrying its own 1-based line number so the CALLER (never the model) can assign
 * `workedExampleId`s from `{ slicePath, lineNumber }` without the model ever supplying identity.
 *
 * Throws (a construction-site backstop, the same shape `buildEnumeratorPayload`'s in
 * `verify-enumerate.ts` uses) if ANY retained line's text still carries a `Derived (p.N):`
 * reference ANYWHERE within it — independent of which inclusion rule let the line through, and
 * independent of where in the line the reference sits. A `Derived` reference is an ingest-time
 * INFERENCE, never directly-quoted content; letting an extractor read one lets it launder an
 * inference into a "worked example."
 */
export function buildExampleExtractionPayload(slice: {
  path: string;
  text: string;
}): ExampleExtractionPayload {
  const rawLines = slice.text.split('\n');
  const retained: ExampleExtractionLine[] = [];
  rawLines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return;
    if (isExtractionLine(trimmed)) {
      retained.push({ lineNumber: idx + 1, text: trimmed });
    }
  });

  for (const line of retained) {
    if (DERIVED_REFERENCE_ANYWHERE_RE.test(line.text)) {
      throw new Error(
        `buildExampleExtractionPayload assembled a payload for ${slice.path} that includes a ` +
          `Derived (p.N): reference at line ${line.lineNumber}.\n` +
          `A Derived reference is an ingest-time inference, never directly-quoted worked-example ` +
          `content — the payload construction site, not the prompt text, is where this exclusion ` +
          `is upheld. Fix the inclusion rule; never relax this check to let the reference through.`,
      );
    }
  }

  const payload = [
    EXAMPLE_EXTRACTION_TOKEN,
    `Slice: ${slice.path}`,
    '',
    ...retained.map((l) => `${l.lineNumber}: ${l.text}`),
  ].join('\n');

  return { slicePath: slice.path, lines: retained, payload };
}

// -------------------------------------------------------------------------------------------
// Task 3 — buildExampleTranslationPayload + collectGameApiSurface
// -------------------------------------------------------------------------------------------

/** Handshake token proving a dispatch prompt was copied, not composed from memory. */
export const EXAMPLE_TRANSLATION_TOKEN = 'BS-EXAMPLE-TRANSLATE-V1';

export interface GameApiSymbol {
  name: string;
  kind: 'function' | 'const' | 'class';
  /** Path relative to `projectDir`, forward-slash separated, always under `src/`. */
  module: string;
}

export interface GameApiSurface {
  projectDir: string;
  testDir: string;
  exportedSymbols: GameApiSymbol[];
}

/** A top-level `export function|const|class Name` declaration, anchored at line start. */
const TOP_LEVEL_DECLARATION_RE = /^export\s+(function|const|class)\s+(\w+)/gm;

/** A one-level `export * from './module.js'` re-export, anchored at line start. */
const STAR_REEXPORT_RE = /^export\s+\*\s+from\s+['"]\.\/([\w.-]+)\.js['"]/gm;

/** A one-level `export { A, B as C } from './module.js'` named re-export, anchored at line start. */
const NAMED_REEXPORT_RE = /^export\s*\{([^}]+)\}\s*from\s*['"]\.\/([\w.-]+)\.js['"]/gm;

function toProjectRelativeModule(projectDir: string, absolutePath: string): string {
  return relative(projectDir, absolutePath).split(sep).join('/');
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Produces a generated game project's exported rules API surface MECHANICALLY — a listing, not
 * an inference — by scanning `src/rules/index.ts` and following its re-export chain ONE level
 * deep (both `export * from './x.js'` and named `export { a, b } from './x.js'` forms), plus any
 * declaration made directly in `index.ts` itself.
 *
 * Documented limits, so a caller never over-trusts this surface:
 *
 *   - It does NOT resolve `export *` transitively beyond one level. A symbol that `index.ts`
 *     re-exports from a module which itself only re-exports (or merely imports-and-uses, never
 *     re-exports) a THIRD module's symbol is invisible here. Measured live (2026-07-31) against
 *     `one-two-punch`: `punch.ts` exports `exhaustCorneredPuncher`/`resolvePunch`, but `index.ts`
 *     never re-exports `punch.js` (directly or via `game.js`, which only imports from it
 *     internally) — those two symbols are correctly absent from the collected surface, and that
 *     absence is this documented limitation in action, not a bug.
 *   - It does NOT know whether a symbol is pure, side-effecting, or even callable with the shape
 *     a translator might assume — `kind` is a syntactic classification only (`function`/`const`/
 *     `class`), not a semantic guarantee.
 *   - A named re-export's `kind` is resolved by re-scanning its target module for a matching
 *     `export function|const|class Name` declaration; if none is found (e.g. the name is
 *     re-exported from a module this function could not read), it is recorded as `const` — the
 *     least-specific, least-presumptuous default.
 *
 * Reads only under `${projectDir}/src/` — never `testDir`. `buildExampleTranslationPayload`'s
 * "never contains the project's existing test files" guarantee (178-CONTEXT.md decision 6) holds
 * because this function is the ONLY source of project-derived text in that payload, and it never
 * opens a path under `testDir`.
 */
export async function collectGameApiSurface(projectDir: string): Promise<GameApiSurface> {
  const testDir = join(projectDir, 'tests');
  const indexPath = join(projectDir, 'src', 'rules', 'index.ts');
  const indexText = await fs.readFile(indexPath, 'utf-8').catch((err: NodeJS.ErrnoException) => {
    throw new Error(
      `No src/rules/index.ts in ${projectDir} (${err.code ?? 'unknown error'}).\n` +
        `collectGameApiSurface reads the generated game's rules re-export chain; pass the ` +
        `generated project's root directory.`,
    );
  });

  const rulesDir = dirname(indexPath);
  const symbols: GameApiSymbol[] = [];
  const seen = new Set<string>();

  const addSymbol = (name: string, kind: GameApiSymbol['kind'], absoluteModulePath: string) => {
    const key = `${name}:${absoluteModulePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({ name, kind, module: toProjectRelativeModule(projectDir, absoluteModulePath) });
  };

  for (const m of indexText.matchAll(TOP_LEVEL_DECLARATION_RE)) {
    addSymbol(m[2], m[1] as GameApiSymbol['kind'], indexPath);
  }

  for (const m of indexText.matchAll(STAR_REEXPORT_RE)) {
    const targetPath = join(rulesDir, `${m[1]}.ts`);
    const targetText = await readOptional(targetPath);
    if (targetText === undefined) continue;
    for (const dm of targetText.matchAll(TOP_LEVEL_DECLARATION_RE)) {
      addSymbol(dm[2], dm[1] as GameApiSymbol['kind'], targetPath);
    }
  }

  for (const m of indexText.matchAll(NAMED_REEXPORT_RE)) {
    const names = m[1]
      .split(',')
      .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => name.length > 0);
    const targetPath = join(rulesDir, `${m[2]}.ts`);
    const targetText = (await readOptional(targetPath)) ?? '';
    for (const name of names) {
      const isFunction = new RegExp(`^export\\s+function\\s+${name}\\b`, 'm').test(targetText);
      const isClass = new RegExp(`^export\\s+class\\s+${name}\\b`, 'm').test(targetText);
      const kind: GameApiSymbol['kind'] = isFunction ? 'function' : isClass ? 'class' : 'const';
      addSymbol(name, kind, targetPath);
    }
  }

  return { projectDir, testDir, exportedSymbols: symbols };
}

/**
 * Builds the translation dispatch payload for ONE validated `WorkedExampleSpec`: names the
 * project's real exported API surface (`api.exportedSymbols`, produced mechanically by
 * `collectGameApiSurface` — never a second, independently-derived listing), states the
 * kind-appropriate translation target, and NEVER contains any text read from `api.testDir` — a
 * translator that can see an existing test writes agreement with it, not a test of the example
 * (178-CONTEXT.md decision 6). This holds structurally: every string in this payload is either a
 * literal here, a field of `spec` (validated by `createWorkedExampleSpec`, sourced from the
 * rulebook slice), or `api.exportedSymbols` (sourced only from `collectGameApiSurface`, which
 * never reads under `testDir`) — there is no code path in this function that could read
 * `api.testDir`.
 *
 * `unexecutable` is never decided HERE — a payload is built and dispatched even when the supplied
 * surface has no obviously matching symbol; deciding `unexecutable` (with a named reason) is the
 * model's verdict, not a payload-builder shortcut (178-CONTEXT.md decision 7).
 */
export function buildExampleTranslationPayload(
  spec: WorkedExampleSpec,
  api: GameApiSurface,
): string {
  const symbolLines = api.exportedSymbols.map((s) => `- ${s.name} (${s.kind}, ${s.module})`);

  const targetGuidance =
    spec.kind === 'predicate'
      ? 'This is a PREDICATE example. A direct function call against the project\'s exported API ' +
        'surface below is a legitimate translation target — it does not need to route through ' +
        'game.doAction(...). Construct the real element/argument values the predicate expects ' +
        'from Setup, call the matching exported symbol, and assert against Expected.'
      : 'This is a TRANSITION example. Translate it as an action-execution sequence: construct ' +
        'the starting state described in Setup, execute the action target this example names ' +
        '(e.g. game.doAction(...) or the project\'s own action-execution entry point), and assert ' +
        'the resulting state matches Expected.';

  const lines = [
    EXAMPLE_TRANSLATION_TOKEN,
    `Slice: ${spec.slicePath}:${spec.lineNumber} (${spec.pageCitation})`,
    `Kind: ${spec.kind}`,
    '',
    'Worked example (verbatim source text):',
    spec.sourceText,
    '',
    `Setup: ${spec.setup}`,
    ...(spec.kind === 'transition' ? [`Action: ${spec.action}`] : []),
    `Expected: ${spec.expected}`,
    '',
    targetGuidance,
    '',
    `Project exported API surface (src/ only, ${symbolLines.length} symbol(s); this listing is ` +
      `mechanical, not curated for this example — not every symbol below is relevant):`,
    ...symbolLines,
    '',
    'Import paths: every module above is given relative to the project root (e.g. ' +
      '"src/rules/game.ts"). Your `imports` will be hoisted into a generated file that always ' +
      'lives two nested directories below the project root — under the project\'s own test ' +
      'directory, inside its "examples" subdirectory — one level deeper than a hand-written ' +
      'single-directory test file. Write each import relative to THAT depth: a module at ' +
      '"src/rules/game.ts" imports as "../../src/rules/game.js" from the generated file, never ' +
      '"../src/rules/game.js" (the shallower depth a sibling hand-written test would use). ' +
      'Getting this prefix wrong is the single most common way an otherwise-correct translation ' +
      'fails to even load.',
    '',
    'If no viable target exists in the exported surface above for this example, return verdict ' +
      '"unexecutable" with a named reason — never force a mismatched target and never silently ' +
      'drop the example.',
  ];

  return lines.join('\n');
}
