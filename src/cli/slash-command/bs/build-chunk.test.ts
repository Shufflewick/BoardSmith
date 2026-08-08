/**
 * Structural drift-protection test for the `/bs-build-chunk` skill (BUILD-01, BUILD-02,
 * BUILD-03, BUILD-04, BUILD-12).
 *
 * `bs/build-chunk.md` (the lean orchestrator) and its `bs/build/{investigate,redteam,ask}.md`
 * reference files are plain markdown consumed by an agent session, NOT parsed by any runtime
 * code in this repo. This suite pins the exact strings, citations, and cross-file pointers
 * those files depend on so a future reword/reorg fails loudly here instead of being discovered
 * only when a downstream build-chunk session misbehaves.
 *
 * Authored FIRST (Wave 0 scaffold, 143-01-PLAN.md), before Plans 02-05 author
 * `build-chunk.md` and `build/{investigate,redteam,ask}.md`. Every assertion below is RED
 * (or ERROR, since the files don't exist yet) until those files land — this is the intended
 * Wave-0-first state. It turns GREEN plan-by-plan as each file is authored.
 *
 * BUILD-09/10/11/13 and UIQ-05 (playtest/revise/close/final-acceptance + the git-protocol
 * citation discipline) were added by 146-01-PLAN.md as the Wave-0-first RED scaffold for Phase
 * 146 — the four new reference files don't exist yet and build-chunk.md's forward-reference
 * markers haven't been removed yet, so these assertions are intentionally RED until Plans
 * 02-04 author the content and edit build-chunk.md.
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a missing
 * file fails only that one assertion instead of aborting the whole suite's collection phase.
 *
 * Mirrors `src/cli/slash-command/bs/ingest.test.ts` (Phase 142): same `__dirname`/`read()`
 * helper, same named byte-identical-marker-constant technique, one `describe` per requirement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/**
 * Sketch-level tail-entry marker (em-dash, not hyphen). Byte-identical across
 * state-machine.md, SKETCH.template.md, and any bs- reference file that quotes it.
 * Reused verbatim from ingest.test.ts in case build-chunk.md ever needs to distinguish a
 * sketch-level tail entry from a detailed one during resume routing.
 */
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';

/** The `ui:` tag values, exactly as CHUNK.template.md / templates.test.ts pin them. */
const UI_TAG_REGEX = /none *\| *touches *\| *major/;

/**
 * The 11-step full-ceremony pipeline, byte-identical to state-machine.md "Step Names (exact,
 * full ceremony)". `spec` sits between `ask` and `build`: it writes this chunk's tests from the
 * approved interpretation and observes them failing BEFORE any implementation exists (TDD-01).
 */
const FULL_CEREMONY_STEPS =
  'investigate, redteam, ask, spec, build, test, audit, repair, playtest, revise, close';

/**
 * The 3-step light-path pipeline, byte-identical to state-machine.md "Step Names (exact,
 * light path — trivial chunks)".
 */
const LIGHT_PATH_STEPS = 'build, test, playtest';

/**
 * The CHUNK-level stale marker, byte-identical to state-machine.md's "Status Enum" section.
 * NOTE: the dash is an em-dash "—", not a hyphen.
 */
const STALE_MARKER = 'stale — re-derive before build';

/** The full chunk status enum, byte-identical to state-machine.md "Status Enum (exact)". */
const STATUS_ENUM_VALUES = ['proposed', 'approved', 'built', 'verified', 'verified (user-waived)'] as const;

/**
 * The return-shape field names investigate.md defines and build-chunk.md consumes by the same
 * names. Fixed HERE (Claude's discretion, per 143-CONTEXT.md) so Plans 02-05 use them verbatim.
 */
const INVESTIGATE_RETURN_FIELDS = ['claimsList', 'visibilityDeclaration', 'newlyDiscoveredCitations'] as const;

/**
 * The return-shape field names the 2 refuter subagents in redteam.md return, consumed by the
 * same names in build-chunk.md's aggregation logic.
 */
const REDTEAM_REFUTER_FIELDS = ['claimNumber', 'verdict', 'objection'] as const;

/**
 * The return-shape field names the coverage-adversary subagent in redteam.md returns.
 */
const REDTEAM_COVERAGE_FIELDS = ['missingInteractions', 'ruleDescription', 'citation'] as const;

/**
 * Every path `build-chunk.md` must cite by exact path (cross-file consistency, BUILD-*),
 * scoped to CURRENT-PHASE files only per 143-CONTEXT.md. Do NOT add build/{build,test,audit,
 * repair,playtest,revise,close}.md here — those are Phase 144-146 forward references, asserted
 * separately as plain-text stub markers, never as file-existence checks.
 */
const REFERENCED_PATHS = [
  'build/investigate.md',
  'build/redteam.md',
  'build/ask.md',
  'build/spec.md',
  'build/build.md',
  'build/test.md',
  'build/audit.md',
  'build/repair.md',
  'build/design-review.md',
  'build/design-ask.md',
  'build/playtest.md',
  'build/revise.md',
  'build/close.md',
  'build/final-acceptance.md',
  'state-machine.md',
  'templates/CHUNK.template.md',
  'templates/RULINGS.template.md',
  'templates/ASSETS.template.md',
] as const;

/** Phase 146 forward-reference stub marker build-chunk.md's routing table must carry. */
const FORWARD_REFERENCE_MARKERS = ['authored in Phase 146'] as const;

/** SKILLDEF-01: the released/no-lock value a clean close writes as its terminal write. */
const SESSION_LOCK_NONE = 'Session Lock: none';

/** SKILLDEF-01: the exact clock-read command — the only sanctioned lock-timestamp source. */
const LOCK_CLOCK_READ = 'date -u +%Y-%m-%dT%H:%M:%SZ';

/** SKILLDEF-02: the live-symlink read-only-library marker, must appear alongside "read-only". */
const NODE_MODULES_BOARDSMITH = 'node_modules/boardsmith';

/** SKILLDEF-03: the LIBX-01 rename of the retired `suppressActionPanel` fenced escape hatch. */
const ESCAPE_HATCH_PROP = 'platformActionPanelEscapeHatch';

/** SKILLDEF-03: the only sanctioned per-Action Panel-hiding mechanism. */
const SUPPRESS_FROM_ACTION_PANEL = 'suppressFromActionPanel';

/** SKILLDEF-03: the retired name that must appear nowhere in build.md. */
const RETIRED_SUPPRESS_ACTION_PANEL = 'suppressActionPanel';

describe('BUILD-01 — resume routing', () => {
  it('build-chunk.md contains the full-ceremony step list verbatim', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain(FULL_CEREMONY_STEPS);
  });

  it('routes on "first incomplete step"', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/first incomplete step/i);
  });

  it('re-poses the pending question verbatim on an awaiting-playtest resume', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/awaiting[- ]playtest/i);
    expect(buildChunk).toMatch(/re-pose/i);
  });

  it('routes conversational intents ("what\'s left?", insert-intent) internally instead of misbuilding', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/what.?s left/i);
    expect(buildChunk).toMatch(/insert/i);
  });

  it('documents the 3-way session-lock branch: stale / same-chunk resume / different live lock', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/stale/i);
    expect(buildChunk).toMatch(/same[- ]chunk/i);
    expect(buildChunk).toMatch(/different/i);
  });
});

describe('BUILD-02 — investigate', () => {
  it('build/investigate.md names all six required BoardSmith docs', () => {
    const investigate = read('build/investigate.md');
    expect(investigate).toContain('docs/core-concepts.md');
    expect(investigate).toContain('docs/common-pitfalls.md');
    expect(investigate).toContain('docs/actions-and-flow.md');
    expect(investigate).toContain('docs/custom-ui-guide.md');
    expect(investigate).toContain('docs/ui-components.md');
    expect(investigate).toContain('docs/dice-and-scoring.md');
  });

  it('names DESIGN.md for ui: touches|major chunks', () => {
    const investigate = read('build/investigate.md');
    expect(investigate).toContain('DESIGN.md');
  });

  it('reads RULINGS.md and DECISIONS.md', () => {
    const investigate = read('build/investigate.md');
    expect(investigate).toContain('RULINGS.md');
    expect(investigate).toContain('DECISIONS.md');
  });

  it('produces the three CHUNK.md sections: Interpretation, Visibility Declaration, Newly Discovered Citations', () => {
    const investigate = read('build/investigate.md');
    expect(investigate).toContain('## Interpretation');
    expect(investigate).toContain('## Visibility Declaration');
    expect(investigate).toContain('## Newly Discovered Citations');
  });

  it('defines every INVESTIGATE_RETURN_FIELDS field', () => {
    const investigate = read('build/investigate.md');
    for (const field of INVESTIGATE_RETURN_FIELDS) {
      expect(investigate, `build/investigate.md must define "${field}"`).toContain(field);
    }
  });
});

describe('BUILD-03 — redteam', () => {
  it('build/redteam.md documents 3 fresh-context agents (2 refuters + 1 coverage adversary)', () => {
    const redteam = read('build/redteam.md');
    expect(redteam).toMatch(/2 refuters?/i);
    expect(redteam).toMatch(/coverage adversary/i);
    expect(redteam).toMatch(/fresh[- ]context/i);
  });

  it('instructs refuters to "default to refuted" when uncertain', () => {
    const redteam = read('build/redteam.md');
    expect(redteam).toMatch(/default to refuted/i);
  });

  it('cites state-machine.md "Redteam Escalation" for the escalation logic', () => {
    const redteam = read('build/redteam.md');
    expect(redteam).toContain('state-machine.md');
    expect(redteam).toContain('Redteam Escalation');
  });

  it('never shows raw verdicts to the user', () => {
    const redteam = read('build/redteam.md');
    expect(redteam).toMatch(/never show/i);
  });

  it('pins the no-framing independence rule for dispatch prompts', () => {
    const redteam = read('build/redteam.md');
    // The property the plan calls out as what "defeats independent review": dispatch prompts
    // carry only slice paths + the numbered claims list — no investigator framing, no
    // confidence adjectives.
    expect(redteam).toMatch(/investigator'?s framing must never flow/i);
    expect(redteam).toContain('no investigator rationale, no framing');
    expect(redteam).toMatch(/prohibit confidence adjectives/i);
  });

  it('defines every REDTEAM_REFUTER_FIELDS and REDTEAM_COVERAGE_FIELDS field', () => {
    const redteam = read('build/redteam.md');
    for (const field of [...REDTEAM_REFUTER_FIELDS, ...REDTEAM_COVERAGE_FIELDS]) {
      expect(redteam, `build/redteam.md must define "${field}"`).toContain(field);
    }
  });
});

describe('BUILD-03 — Redteam Rounds persistence + check-off discipline (CR-02 fix, pinned)', () => {
  // The durable-round-record heading, byte-identical across redteam.md, build-chunk.md, and
  // CHUNK.template.md — deleting the persistence contract from any of them must fail here.
  const REDTEAM_ROUNDS_HEADING = '## Redteam Rounds';

  it('redteam.md persists each round to ## Redteam Rounds before the ask step starts', () => {
    const redteam = read('build/redteam.md');
    expect(redteam).toContain(REDTEAM_ROUNDS_HEADING);
    expect(redteam).toContain('Persisting the Round');
    expect(redteam).toMatch(/before.*the ask step starts/i);
    // WR-08: round entries land at the end of EACH round — Round 1's entry (disposition
    // `re-investigate dispatched`) is written BEFORE the re-investigate subagent is dispatched,
    // never deferred past it.
    expect(redteam).toContain('re-investigate dispatched');
  });

  it('build-chunk.md pins the per-step persist-before-next-step check-off rule', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain(REDTEAM_ROUNDS_HEADING);
    expect(buildChunk).toContain('Every step persists before the next starts');
  });

  it('CHUNK.template.md carries the ## Redteam Rounds section and the entry grammar', () => {
    const template = read('templates/CHUNK.template.md');
    expect(template).toContain(REDTEAM_ROUNDS_HEADING);
    expect(template).toContain('### Redteam Round 1');
  });

  it('ask.md reads the persisted round record (cold resume at ask consumes the verdicts)', () => {
    const ask = read('build/ask.md');
    expect(ask).toContain(REDTEAM_ROUNDS_HEADING);
    expect(ask).toContain('escalation open at ask');
  });
});

describe('BUILD-04 — ask gate', () => {
  it('build/ask.md documents the 4-part format (a/b/c/d)', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/\(a\)/);
    expect(ask).toMatch(/\(b\)/);
    expect(ask).toMatch(/\(c\)/);
    expect(ask).toMatch(/\(d\)/);
  });

  it('warns against implementation vocabulary, listing the forbidden terms to AVOID', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/implementation vocabulary/i);
    // Assert the backticked list-entry forms the Prohibited Vocabulary section uses — bare
    // `toContain('action')` is vacuous (matches "interaction", "adaptations", "restated"...).
    expect(ask).toContain('- `action`');
    expect(ask).toContain('- `flow`');
    expect(ask).toContain('- `state`');
    expect(ask).toContain('- `element`');
  });

  it('documents the never-blocking placeholder-art path', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/placeholder/i);
    expect(ask).toMatch(/never block/i);
  });

  it('gates write: "Status: approved" written last, after explicit approval', () => {
    const ask = read('build/ask.md');
    expect(ask).toContain('Status: approved');
    expect(ask).toMatch(/explicit(ly)? approv/i);
    // Pin the write-LAST ordering rule itself, not just the strings' presence — a reword that
    // drops "last, after every other write" must fail here.
    expect(ask).toContain('**last**, after every other write');
  });
});

describe('BUILD-12 — light path', () => {
  it('build-chunk.md contains the light-path step list verbatim', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain(LIGHT_PATH_STEPS);
  });

  it('states the user is told which ceremony is in effect', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/told which/i);
  });

  it('notes `approved` is unreachable on the light path (proposed → built)', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/unreachable/i);
    expect(buildChunk).toMatch(/proposed.*built/);
  });
});

describe('TDD-01 — spec step (tests first, observed failing)', () => {
  it('the full-ceremony step list places `spec` between `ask` and `build`', () => {
    // Guards the ORDER, not just the presence of the word — a step list that appended `spec`
    // after `build` would satisfy a bare toContain('spec') and invert the whole point.
    expect(FULL_CEREMONY_STEPS).toContain('ask, spec, build, test');
    for (const file of ['build-chunk.md', 'state-machine.md', 'templates/CHUNK.template.md']) {
      expect(read(file)).toContain(FULL_CEREMONY_STEPS);
    }
  });

  it('build-chunk.md dispatches the `spec` step to build/spec.md', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain('| spec | `${CLAUDE_SKILL_DIR}/../bs-shared/build/spec.md` |');
  });

  it('requires one test per numbered ## Interpretation claim, with the claim number named', () => {
    const spec = read('build/spec.md');
    expect(spec).toContain('## Interpretation');
    expect(spec).toMatch(/one test per numbered claim/i);
    expect(spec).toMatch(/claim with no test is an uncovered claim/i);
  });

  it('requires the tests to be RUN and OBSERVED failing, not merely written', () => {
    const spec = read('build/spec.md');
    expect(spec).toContain('boardsmith test');
    // Whitespace-flexible only: these files hard-wrap at 100 cols and bold the key verb.
    expect(spec).toMatch(/\*\*observing\*\*\s+them\s+fail\s+is/i);
    expect(spec).toMatch(/must be observed failing before this step checks off/i);
    // A passing test at spec time is a STOP, never a bonus — the two diagnoses must both survive.
    expect(spec).toMatch(/PASSES at spec time is a stop condition/i);
    expect(spec).toMatch(/behavior already exists/i);
    expect(spec).toMatch(/vacuous/i);
  });

  it('allows signature-only stubs whose body is exactly one throw, never a return value', () => {
    const spec = read('build/spec.md');
    expect(spec).toMatch(/signature-only stubs/i);
    expect(spec).toContain("throw new Error('not implemented");
    // The anti-false-green rule: a stub that returns can accidentally satisfy an assertion.
    expect(spec).toMatch(/[Nn]ever a `return 0`/);
  });

  it('forbids writing implementation at the spec step', () => {
    const spec = read('build/spec.md');
    expect(spec).toMatch(/\*\*Never writes implementation\.\*\*/);
  });

  it('persists RED evidence in the ## Spec Manifest table', () => {
    const spec = read('build/spec.md');
    expect(spec).toContain('## Spec Manifest');
    expect(spec).toContain('| Test File | Claims Covered | RED Observed |');
    expect(spec).toMatch(/RED Observed.{0,40}pending.{0,10}to.{0,10}`yes`/s);

    const template = read('templates/CHUNK.template.md');
    expect(template).toContain('## Spec Manifest');
    expect(template).toContain('| Test File | Claims Covered | RED Observed |');
    // The parse contract must list it, or a cold resume won't know to require it.
    expect(template).toContain('"## Spec Manifest", "## Build Manifest"');
    // The checklist itself must carry the step.
    expect(template).toContain('- [ ] ask\n- [ ] spec\n- [ ] build\n- [ ] test');
  });

  it('names chunk-<slug>/step-spec as the RED anchor, distinct from step-build', () => {
    const spec = read('build/spec.md');
    expect(spec).toContain('chunk-<slug>/step-spec');
    expect(spec).toMatch(/RED\s+anchor/);
    expect(read('state-machine.md')).toContain('chunk-<slug>/step-spec');
  });

  it('leaves worked-example test generation to the test step, not spec', () => {
    // Guards against the two steps both claiming TEST-01 and double-generating.
    expect(read('build/spec.md')).toMatch(/[Nn]ever generates the worked-example tests/);
  });
});

describe('TDD-01 — red-before-green enforcement across spec/build/test', () => {
  it('build.md forbids editing a spec test to make it pass', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/\*\*Never edit a spec test to make it pass\.\*\*/);
    // Adding NEW tests must stay explicitly allowed, or build sessions over-correct.
    expect(build).toMatch(/[Aa]dding NEW tests here is fine/);
  });

  it('test.md item 3 requires the spec tests green and cross-checks them against the RED commit', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/red-to-green check/i);
    expect(test).toMatch(/NOT authored here/);
    expect(test).toContain('git diff chunk-<slug>/step-spec');
    expect(test).toContain('## Spec Manifest');
  });

  it('build-chunk.md never dispatches build for a chunk whose spec item is unchecked', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/`build` is never dispatched for a chunk\s*\n?whose `spec` item is unchecked/);
  });

  it('the light path is bounded to chunks with no new game behavior', () => {
    // The light path skips `spec`, so the tag must be bounded or TDD has a silent bypass.
    for (const file of ['state-machine.md', 'build-chunk.md']) {
      expect(read(file)).toMatch(/no new game behavior/i);
    }
  });

  it('session step group 2 is {spec, build, test} everywhere it is named', () => {
    for (const file of ['state-machine.md', 'build-chunk.md', 'build/build.md', 'build/test.md',
      'build/repair.md', 'build/ask.md', 'build/spec.md']) {
      expect(read(file)).toContain('{spec, build, test}');
    }
    // The old 2-step group name must be gone, or a session resumes into the wrong group.
    for (const file of ['state-machine.md', 'build-chunk.md', 'build/build.md', 'build/test.md',
      'build/repair.md', 'build/ask.md']) {
      expect(read(file)).not.toContain('{build, test}');
    }
  });
});

describe('BUILD-05 — build step', () => {
  it('reads raw rulebook slices AND the approved interpretation', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/raw rulebook slices/i);
    expect(build).toMatch(/approved interpretation/i);
  });

  it('extends rather than restructures, gating restructuring behind a user gate', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/extends rather than restructures/i);
    expect(build).toMatch(/user gate/i);
  });

  it('appends data-model/naming decisions to DECISIONS.md', () => {
    const build = read('build/build.md');
    expect(build).toContain('DECISIONS.md');
  });

  it('cites the existing ## Build Manifest CHUNK section', () => {
    const build = read('build/build.md');
    expect(build).toContain('## Build Manifest');
  });
});

describe('BUILD-06 — test step', () => {
  it('names the exact command tokens', () => {
    const test = read('build/test.md');
    expect(test).toContain('tsc --noEmit');
    expect(test).toContain('boardsmith lint');
    expect(test).toMatch(/full.{0,20}(accumulated )?suite|regression/i);
    expect(test).toContain('simulateRandomGames');
  });

  it('names all seven sandbox rule names', () => {
    const test = read('build/test.md');
    expect(test).toContain('no-network');
    expect(test).toContain('no-filesystem');
    expect(test).toContain('no-timers');
    expect(test).toContain('no-nondeterministic');
    expect(test).toContain('no-eval');
    expect(test).toContain('no-element-identity-comparison');
    expect(test).toContain('no-element-array-state');
  });

  it('includes a ui-conditional asset-reachability gate citing asset-scan.ts', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/asset-reachability/i);
    expect(test).toMatch(/asset-scan|scanAssetReachability/);
    expect(test).toMatch(/ui: touches\|major|touches.{0,20}major/i);
  });
});

/**
 * TEST-01 (178-08) — the worked-example step build/test.md's ordered sequence gained between
 * the existing chunk-tests item and the full-accumulated-suite item. Pins the step's numbered
 * position by PARSED INDEX (never a raw substring-ordering check — a section could reorder
 * headings while substring order stayed accidentally correct), all four real command names, both
 * handshake tokens, the two-dispatch rule, the build-blocking/asymmetry paragraph, the
 * zero-example exemption sentence, and the "verdict comes from running the test" sentence.
 * Mirrors the numbering-guard discipline this same phase's threat register (T-178-18) requires:
 * a future edit that inserts a step without renumbering the rest must fail loudly here.
 */
describe('BUILD-06 / TEST-01 — worked-example step (178-08)', () => {
  const SEQUENCE_HEADING = '## The Ordered Sequence (non-reorderable, stop-on-failure)';
  const NEXT_HEADING = '## The A11y Floor';

  /**
   * Extracts ONLY the "## The Ordered Sequence" section's own top-level `^N. ` numbered items —
   * never the nested "A11y Floor" subsection's separate 1-5 list, which lives in its own
   * numbering namespace after `NEXT_HEADING`. Scoping by heading boundary keeps the two
   * namespaces from ever colliding in this parse.
   */
  function parseOrderedSequenceNumbers(text: string): number[] {
    const start = text.indexOf(SEQUENCE_HEADING);
    const end = text.indexOf(NEXT_HEADING);
    if (start === -1 || end === -1) {
      throw new Error('build/test.md is missing one of its expected section headings.');
    }
    const section = text.slice(start, end);
    return [...section.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
  }

  /** Same scoping as `parseOrderedSequenceNumbers`, but keeps each item's own title text too. */
  function parseOrderedSequenceItems(text: string): { n: number; title: string }[] {
    const start = text.indexOf(SEQUENCE_HEADING);
    const end = text.indexOf(NEXT_HEADING);
    const section = text.slice(start, end);
    return [...section.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)].map((m) => ({
      n: Number(m[1]),
      title: m[2],
    }));
  }

  it('the ordered sequence is numbered exactly 1..8, with no duplicate or skipped number', () => {
    const numbers = parseOrderedSequenceNumbers(read('build/test.md'));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('the numbering-guard parse helper is a real regression detector: a duplicated item number in a mutated copy is caught, not silently accepted', () => {
    const mutated = read('build/test.md').replace(
      /^5\. \*\*Full accumulated suite/m,
      '4. **Full accumulated suite',
    );
    const numbers = parseOrderedSequenceNumbers(mutated);
    expect(numbers).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numbers.filter((n) => n === 4).length).toBeGreaterThan(1);
  });

  it('the worked-example step is item 4 — parsed index places it directly after the chunk-tests item and directly before the full-suite item, not a raw substring-ordering check', () => {
    const items = parseOrderedSequenceItems(read('build/test.md'));
    const chunkTestsIdx = items.findIndex((i) => /Chunk unit\/integration tests/.test(i.title));
    const workedExampleIdx = items.findIndex((i) => /Worked-example tests/.test(i.title));
    const fullSuiteIdx = items.findIndex((i) => /Full accumulated suite/.test(i.title));
    expect(chunkTestsIdx).toBeGreaterThanOrEqual(0);
    expect(workedExampleIdx).toBe(chunkTestsIdx + 1);
    expect(fullSuiteIdx).toBe(workedExampleIdx + 1);
    expect(items[workedExampleIdx].n).toBe(4);
  });

  it('names all four real commands, including verify-example-translate as the cited producer of the translation dispatch bytes', () => {
    const test = read('build/test.md');
    expect(test).toContain('boardsmith verify-example-replay');
    expect(test).toContain('boardsmith verify-example-translate');
    expect(test).toContain('boardsmith verify-example-record');
    expect(test).toContain('boardsmith verify-example-emit');
    expect(test).toMatch(/verify-example-translate.{0,260}ONLY source of those bytes/s);
  });

  it('names both handshake tokens', () => {
    const test = read('build/test.md');
    expect(test).toContain('BS-EXAMPLE-EXTRACT-V1');
    expect(test).toContain('BS-EXAMPLE-TRANSLATE-V1');
  });

  it('states the two-dispatch rule — two separate dispatches, never one combined pass — with the reason stated inline', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/[Tt]wo separate dispatches.{0,60}never one combined pass/s);
    expect(test).toMatch(/work backward from code it can already see/);
  });

  it('states the build-blocking rule and the verify-side asymmetry reason in the same paragraph', () => {
    const test = read('build/test.md');
    const match = test.match(/\(g\)[\s\S]*?(?=\n\n\s*\(h\))/);
    expect(match).not.toBeNull();
    const paragraph = match![0];
    expect(paragraph).toContain('BUILD-BLOCKING');
    expect(paragraph).toMatch(/asymmetric/);
  });

  it('names the zero-example exemption, explicit in the generated test file\'s own comment, never a silent omission', () => {
    const test = read('build/test.md');
    expect(test).toMatch(
      /zero worked examples SKIPS this step and names the\s+exemption explicitly in the generated test file/,
    );
  });

  it('states the recorded verdict comes from running the emitted test, never from the translator\'s verdictHint', () => {
    const test = read('build/test.md');
    expect(test).toMatch(
      /verdict comes from actually running the emitted test.{0,140}never from the translator's own `verdictHint`/s,
    );
  });
});

describe('BUILD-07 — audit', () => {
  it('names the three lenses by pinned phrase', () => {
    const audit = read('build/audit.md');
    expect(audit).toMatch(/fidelity/i);
    expect(audit).toMatch(/visibility/i);
    expect(audit).toMatch(/undo/i);
  });

  it('forbids reading the interpretation, citing Rulings Outrank Rulebook', () => {
    const audit = read('build/audit.md');
    expect(audit).toMatch(/never.{0,80}interpretation|interpretation.{0,80}never/is);
    expect(audit).toContain('Rulings Outrank Rulebook');
  });

  it('cites diffPlayerViews and assertNoHiddenInfoLeak by exact name', () => {
    const audit = read('build/audit.md');
    expect(audit).toContain('diffPlayerViews');
    expect(audit).toContain('assertNoHiddenInfoLeak');
  });

  it('cites the Findings Ledger and Session Handoff Seams by name', () => {
    const audit = read('build/audit.md');
    expect(audit).toContain('## Findings Ledger');
    expect(audit).toContain('Session Handoff Seams');
  });
});

describe('BUILD-08 — repair', () => {
  it('cites "Repair Loop Bound" by exact name', () => {
    const repair = read('build/repair.md');
    expect(repair).toContain('Repair Loop Bound');
  });

  it('states the max-3-round bound and the only-new-findings rule', () => {
    const repair = read('build/repair.md');
    expect(repair).toMatch(/maximum 3 audit rounds|max(imum)? 3 rounds/i);
    expect(repair).toMatch(/only NEW findings/i);
  });

  it('documents the refute-with-citation concept', () => {
    const repair = read('build/repair.md');
    expect(repair).toMatch(/refute-with-citation/i);
  });

  it('names the three round-3 plain-language triage options', () => {
    const repair = read('build/repair.md');
    expect(repair).toMatch(/real blocker/i);
    expect(repair).toMatch(/defer to a later chunk/i);
    expect(repair).toMatch(/auditor was wrong/i);
  });
});

describe('UIQ-04 — design-review', () => {
  it('captures 6 screenshots into chunks/<slug>/shots/', () => {
    const designReview = read('build/design-review.md');
    expect(designReview).toContain('chunks/<slug>/shots/');
    expect(designReview).toMatch(/6 screenshots/i);
  });

  it('names the 3x2 breakpoint/theme grid by exact value', () => {
    const designReview = read('build/design-review.md');
    expect(designReview).toContain('640');
    expect(designReview).toContain('1024');
    expect(designReview).toContain('1440');
  });

  it('requires --no-open and an explicit server-kill step', () => {
    const designReview = read('build/design-review.md');
    expect(designReview).toContain('--no-open');
    expect(designReview).toMatch(/kill the dev server/i);
  });

  it('never waits on networkidle', () => {
    const designReview = read('build/design-review.md');
    expect(designReview).toMatch(/never.{0,10}`?networkidle/i);
  });

  it('cites the Findings Ledger as the findings destination', () => {
    const designReview = read('build/design-review.md');
    expect(designReview).toContain('## Findings Ledger');
  });
});

describe('UIQ-01 — design ask', () => {
  it('names the three direction names, with Derive as default recommendation', () => {
    const designAsk = read('build/design-ask.md');
    expect(designAsk).toContain('Adopt');
    expect(designAsk).toContain('Derive');
    expect(designAsk).toContain('Original');
    expect(designAsk).toMatch(/Derive.{0,80}default/is);
  });

  it('writes DESIGN.md', () => {
    const designAsk = read('build/design-ask.md');
    expect(designAsk).toContain('DESIGN.md');
  });

  it('build/ask.md carries the first-UI-chunk pre-check hook', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/## ui:/);
    expect(ask).toMatch(/touches.{0,20}major/i);
    expect(ask).toMatch(/DESIGN\.md does not (yet )?exist/i);
  });
});

describe('UIQ-02 — designed placeholders', () => {
  it('cites DESIGN.md\'s ## Placeholder Policy by name, never restating it', () => {
    const build = read('build/build.md');
    expect(build).toContain('## Placeholder Policy');
  });

  it('states asset swap never changes geometry/layout', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/never change[s]? (the )?geometry|zero[- ]layout[- ]diff/i);
  });

  it('prohibits a bare asset <img> and mandates AssetImage.vue', () => {
    const build = read('build/build.md');
    expect(build).toContain('AssetImage');
    expect(build).toMatch(/bare.{0,20}(asset )?<img>|<img>.{0,20}bare/i);
  });
});

describe('UIQ-03 — a11y floor', () => {
  it('pins all five a11y floor items by phrase', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/keyboard-only ActionPanel completion/i);
    expect(test).toContain('axe-core');
    expect(test).toMatch(/no-color-literal grep/i);
    expect(test).toMatch(/game-semantic aria-labels/i);
    expect(test).toContain('aria-hidden');
    expect(test).toMatch(/focus management/i);
    expect(test).toContain('prefers-reduced-motion');
  });
});

describe('BUILD-09 — playtest', () => {
  it('documents the numbered click-by-click script with seat counts and dev-host affordances taught once', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toContain('npx boardsmith dev');
    expect(playtest).toContain('--ai');
    expect(playtest).toMatch(/seat count/i);
    expect(playtest).toMatch(/taught once/i);
  });

  it('includes a build-stamp hard-reload freshness check', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/reload/i);
    expect(playtest).toContain('Build stamp');
  });

  it('includes a one-line regression check and the taste line', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/regression check/i);
    expect(playtest).toMatch(/anything look off/i);
  });

  it('includes a second-seat leak check for hidden-info chunks', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/second-seat leak/i);
  });

  it('presents an item-by-item Verified Checklist, confirmed one at a time (not a vibe)', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toContain('## Verified Checklist');
    expect(playtest).toMatch(/one at a time/i);
    expect(playtest).toMatch(/not a vibe/i);
  });

  it('records "verified (user-waived)" as an honest, recordable skip state', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toContain('verified (user-waived)');
  });
});

describe('BUILD-10 — revise', () => {
  it('names all four triage categories', () => {
    const revise = read('build/revise.md');
    expect(revise).toMatch(/this-chunk defect/i);
    expect(revise).toMatch(/future scope/i);
    expect(revise).toMatch(/not-built-yet/i);
    expect(revise).toContain('RULINGS.md');
  });

  it('appends to the ## Revision Rounds ledger with revise-1/revise-2 numbering', () => {
    const revise = read('build/revise.md');
    expect(revise).toContain('## Revision Rounds');
    expect(revise).toMatch(/revise-1/);
    expect(revise).toMatch(/revise-2/);
  });

  it('requires a feedback disposition report + targeted re-test on re-entry, forbidding a blind full re-test', () => {
    const revise = read('build/revise.md');
    expect(revise).toMatch(/feedback disposition report/i);
    expect(revise).toMatch(/targeted re-test/i);
    expect(revise).toMatch(/never.{0,60}blind full re-test|blind full re-test.{0,60}never/is);
  });
});

describe('BUILD-11 — close', () => {
  it('records the verified commit hash', () => {
    const close = read('build/close.md');
    expect(close).toContain('git rev-parse HEAD');
    expect(close).toContain('## Verified Commit Hash');
  });

  it('presents the sketch-tail re-derivation as a delta gate, never a silent rewrite', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/delta/i);
    expect(close).toMatch(/never a silent rewrite/i);
  });

  it('proposes the next chunk with its ui: tag', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/next chunk/i);
    expect(close).toMatch(/ui:/);
  });

  it('names a "## Bookkeeping Sequence" section (byte-exact heading) for playtest\'s light-path close pointer', () => {
    const close = read('build/close.md');
    expect(close).toContain('## Bookkeeping Sequence');
  });
});

describe('BUILD-13 — git protocol / handoff / lock citation, no restatement', () => {
  const CITE_PHRASE = 'cite `state-machine.md`';

  /**
   * Checks EVERY occurrence of `anchor` in `text` (case-insensitive) and passes if at least one
   * occurrence has `CITE_PHRASE` within 250 chars either before or after it — the citation
   * sentence may name the section before or after the "cite `state-machine.md`" phrase, and a
   * heading occurrence of the same words (e.g. "## Git Protocol") is expected to exist alongside
   * the citing sentence, not instead of it.
   */
  function assertCitedNearby(text: string, anchor: string) {
    const lowerText = text.toLowerCase();
    const lowerAnchor = anchor.toLowerCase();
    const lowerCite = CITE_PHRASE.toLowerCase();
    let searchFrom = 0;
    let found = false;
    let occurrences = 0;
    for (;;) {
      const idx = lowerText.indexOf(lowerAnchor, searchFrom);
      if (idx === -1) break;
      occurrences += 1;
      const nearby = lowerText.slice(Math.max(0, idx - 250), idx + anchor.length + 250);
      if (nearby.includes(lowerCite)) {
        found = true;
        break;
      }
      searchFrom = idx + anchor.length;
    }
    expect(occurrences, `build-chunk.md must mention "${anchor}"`).toBeGreaterThan(0);
    expect(found, `"${anchor}" must be cited via "${CITE_PHRASE}" nearby at least once, not restated`).toBe(true);
  }

  it('cites state-machine.md "Git Protocol" by name, not restated', () => {
    const buildChunk = read('build-chunk.md');
    assertCitedNearby(buildChunk, 'Git Protocol');
  });

  it('cites state-machine.md "Session Lock" by name, not restated', () => {
    const buildChunk = read('build-chunk.md');
    assertCitedNearby(buildChunk, 'Session Lock');
  });

  it('cites state-machine.md "Session Handoff Seams" by name, not restated', () => {
    const buildChunk = read('build-chunk.md');
    assertCitedNearby(buildChunk, 'Session Handoff Seams');
  });

  it('quotes the chunk-<slug>/step-<name> commit convention as a worked example', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain('chunk-<slug>/step-<name>');
  });
});

describe('UIQ-05 — final-acceptance', () => {
  it('documents all seven design-QA checks', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toContain('useAnnouncer');
    expect(fa).toMatch(/VoiceOver/);
    expect(fa).toMatch(/200%\s*zoom/i);
    expect(fa).toMatch(/compact.{0,20}touch target/i);
    expect(fa).toMatch(/colorblind/i);
    expect(fa).toMatch(/both Slate themes/i);
    expect(fa).toMatch(/mobile layout/i);
    expect(fa).toMatch(/iframe-shrink/i);
  });

  it('documents the coverage check (every non-variant slice cited by a closed chunk)', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toMatch(/coverage check/i);
    expect(fa).toMatch(/non-variant/i);
  });

  it('requires --no-open and an explicit server-kill discipline for any dispatched agent', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toContain('--no-open');
    expect(fa).toMatch(/kill/i);
  });

  it('cites the BREAKPOINTS values 640/1024/1440', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toContain('640');
    expect(fa).toContain('1024');
    expect(fa).toContain('1440');
  });

  it('pins the drag-drop keyboard-alternates check and its build/test.md item-1 reuse', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toMatch(/drag-drop|drag and drop/i);
    expect(fa).toMatch(/keyboard alternate/i);
    const dragIndex = fa.search(/drag-drop|drag and drop/i);
    expect(dragIndex).toBeGreaterThan(-1);
    const nearby = fa.slice(Math.max(0, dragIndex - 500), dragIndex + 1000);
    expect(nearby).toContain('build/test.md');
  });
});

describe('UIQ-05 — final-acceptance router coherence (146-REVIEW CR/WR fixes, pinned)', () => {
  it('CR-01: build-chunk.md Step 2 has a Final-acceptance chunk resume-routing rule that dispatches final-acceptance.md', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/Final-acceptance chunk target/i);
    expect(buildChunk).toContain('## Mandated Chunks');
    const idx = buildChunk.search(/Final-acceptance chunk target/i);
    const nearby = buildChunk.slice(idx, idx + 1400);
    // The rule must name the dispatch target and the special leading content step in the checklist.
    expect(nearby).toContain('build/final-acceptance.md');
    expect(nearby).toContain('- [ ] final-acceptance');
    expect(nearby).toMatch(/first incomplete item/i);
    // Group-4 dispatch must also carry a final-acceptance content step.
    expect(buildChunk).toMatch(/\*\*final-acceptance \(the sketch'?s `## Mandated Chunks`/);
  });

  it('CR-02: final-acceptance runs "on top of" / "as the content of" the group — build-chunk.md never says "in place of" that group', () => {
    const buildChunk = read('build-chunk.md');
    const fa = read('build/final-acceptance.md');
    expect(buildChunk).toMatch(/as the content of/i);
    expect(buildChunk).toMatch(/on top of/i);
    // The old contradiction must not return.
    expect(buildChunk).not.toMatch(/in place of a normal chunk'?s `\{playtest, revise/i);
    // final-acceptance.md's on-top-of model must remain the coherent one both files agree on.
    expect(fa).toMatch(/on top of/i);
    expect(fa).toMatch(/still applies/i);
  });

  it('CR-03: light-path close bookkeeping is the 4-item sequence (incl. lock release), with NO false sketch-tail-detailing citation', () => {
    const buildChunk = read('build-chunk.md');
    const playtest = read('build/playtest.md');
    // The false "detail the next 2-3 sketch-tail entries" citation must be gone from both files.
    expect(buildChunk).not.toMatch(/detailing the next 2-3\s+sketch-level tail entries/i);
    expect(playtest).not.toMatch(/next-2-3 sketch-tail detailing/i);
    // Both must route light-path tail handling to Step 2's lazy detailing and cite the delta gate as NOT run.
    expect(buildChunk).toMatch(/lazy tail-entry detailing/i);
    expect(playtest).toContain('## Sketch-Tail Delta Gate');
    // close.md must state the light path reuses ONLY the Bookkeeping Sequence in full
    // (SKILLDEF-01 added the terminal lock-release step; SKILLAUTO-08/167-04 added the
    // ledger-reconciliation step before it; 171-06 added the provenance-record step before
    // that, making the sequence six items).
    const close = read('build/close.md');
    expect(close).toMatch(/light path reuses \*\*only\*\* this six-item sequence/i);
  });

  it('WR-01: build-chunk.md calls final-acceptance a 7-point check, never 6-point', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain('7-point check');
    expect(buildChunk).not.toContain('6-point');
  });

  it('WR-02: CHUNK.template.md Revision-Rounds comment describes all four revise triage categories', () => {
    const template = read('templates/CHUNK.template.md');
    expect(template).toMatch(/category \(a\)/);
    expect(template).toMatch(/category \(b\)/);
    expect(template).toMatch(/category \(c\)/);
    expect(template).toMatch(/category \(d\)/);
    expect(template).toMatch(/not-built-yet/i);
    expect(template).toContain('build/revise.md');
  });

  it('WR-03: the group label is {playtest, revise, close} with no "one revise round" cap in any bs- file', () => {
    for (const rel of [
      'build-chunk.md',
      'state-machine.md',
      'build/playtest.md',
      'build/revise.md',
      'build/close.md',
      'build/repair.md',
    ]) {
      const text = read(rel);
      expect(text, `${rel} must not carry the "one revise round" cap wording`).not.toMatch(/one revise\s+round/i);
      expect(text, `${rel} must use the {playtest, revise, close} group label`).toContain('{playtest, revise, close}');
    }
  });
});

describe('UIQ-05 — final-acceptance coherent-cluster fixes (146-REVIEW iter-2 CR-01/WR-01..04, pinned)', () => {
  it('CR-01: final-acceptance detection runs BEFORE the generic lazy tail-entry detailing in Step 2', () => {
    const buildChunk = read('build-chunk.md');
    // Anchor on the bolded rule HEADINGS, not incidental references to them elsewhere in prose.
    const faIdx = buildChunk.indexOf('**Final-acceptance chunk target');
    const tailIdx = buildChunk.indexOf('**Sketch-level tail-entry target:**');
    expect(faIdx, 'build-chunk.md must have a Final-acceptance chunk target rule').toBeGreaterThan(-1);
    expect(tailIdx, 'build-chunk.md must have a Sketch-level tail-entry target rule').toBeGreaterThan(-1);
    expect(faIdx, 'Final-acceptance detection must precede the generic tail-entry path').toBeLessThan(tailIdx);
    // The tail-entry path must carry the final-acceptance carve-out so it never fills a full/light
    // checklist for the mandated chunk.
    const tailNearby = buildChunk.slice(tailIdx, tailIdx + 700);
    expect(tailNearby).toMatch(/Carve-out/i);
    // Detailing is procedural: it writes the special ceremony + 4-item checklist, not the template's.
    expect(buildChunk).toContain('## Ceremony: final-acceptance');
    expect(buildChunk).toMatch(/final-acceptance \/ playtest \/ revise \/ close/);
  });

  it('CR-01/WR-01: CHUNK.template.md recognizes the final-acceptance ceremony and its 4-item checklist variant', () => {
    const template = read('templates/CHUNK.template.md');
    expect(template).toContain('full | light | final-acceptance');
    expect(template).toMatch(/When Ceremony: final-acceptance/);
    // The 4-item variant is documented in the CEREMONY-CONDITIONAL block.
    expect(template).toContain('- [ ] final-acceptance');
    expect(template).toContain('- [ ] revise');
  });

  it('WR-01: build-chunk.md Step 3 exempts the final-acceptance chunk from full/light ceremony routing', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/exempt from this full\/light ceremony routing/i);
  });

  it('WR-02: close.md states it does NOT create the next chunk\'s CHUNK.md, and build-chunk.md no longer claims a close-gate detailing duty', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/does NOT create the next chunk'?s `chunks\/<slug>\/CHUNK\.md`/i);
    const buildChunk = read('build-chunk.md');
    // The false "detailing is normally the previous chunk's close-gate duty" claim is gone.
    expect(buildChunk).not.toMatch(/normally the previous chunk'?s close-gate duty/i);
    // build-chunk.md states plainly that close never creates the next CHUNK.md (lazy detailing owns it).
    expect(buildChunk).toMatch(/`close` never creates a next chunk'?s CHUNK\.md/i);
  });

  it('WR-03: final-acceptance carries a handoff seam before playtest and per-sub-part resumability', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toContain('Sub-Step Resumability and the Handoff Seam Before `playtest`');
    expect(fa).toMatch(/handoff seam/i);
    const sm = read('state-machine.md');
    expect(sm).toMatch(/Final-acceptance chunk exception/);
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/extra\*?\*? handoff seam/i);
  });

  it('WR-04: the light-path citation names the byte-exact heading (— trivial chunks) in all three citing files', () => {
    const LABEL = 'Step Names (exact, light path — trivial chunks)';
    for (const rel of ['build-chunk.md', 'build/playtest.md', 'build/close.md']) {
      const normalized = read(rel).replace(/\s+/g, ' ');
      expect(normalized, `${rel} must cite the full light-path heading`).toContain(LABEL);
      // The truncated bare citation must be gone.
      expect(normalized, `${rel} must not carry the truncated light-path citation`).not.toMatch(
        /Step Names \(exact, light path\)"/,
      );
    }
    // The label must match state-machine.md's actual heading byte-for-byte.
    expect(read('state-machine.md')).toContain(`## ${LABEL}`);
  });
});

describe('SKILLDEF-01 — close releases the session lock (terminal, append-only)', () => {
  it('close.md contains a terminal "Release the lock" step and sets Session Lock: none', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/release the lock/i);
    expect(close).toContain(SESSION_LOCK_NONE);
  });

  it('close.md states the release is the terminal write and every write in the sequence is append-only', () => {
    const close = read('build/close.md');
    expect(close).toContain('terminal write');
    expect(close).toMatch(/append-only/i);
  });

  it('state-machine.md Write Order documents the append-only-close / terminal-release invariant', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/append-only end-to-end/i);
    expect(stateMachine).toContain('terminal write');
    expect(stateMachine).toContain(SESSION_LOCK_NONE);
  });

  it('build-chunk.md Step 0 recognizes a released/no-lock (Session Lock: none) state and does not warn', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain(SESSION_LOCK_NONE);
    expect(buildChunk).toMatch(/released\/no-lock/i);
    expect(buildChunk).toContain('do NOT warn');
  });

  it('build-chunk.md and state-machine.md both name the clock-read command for lock take/refresh', () => {
    const buildChunk = read('build-chunk.md');
    const stateMachine = read('state-machine.md');
    expect(buildChunk).toContain(LOCK_CLOCK_READ);
    expect(stateMachine).toContain(LOCK_CLOCK_READ);
  });

  it('a same-day resume of a different next chunk after a clean close does not warn (spec text, close→Step0)', () => {
    const stateMachine = read('state-machine.md');
    const buildChunk = read('build-chunk.md');
    expect(stateMachine).toMatch(/same-day session that resumes a\s+DIFFERENT next chunk/i);
    expect(buildChunk).toMatch(/same-day false alarm after a clean close/i);
  });
});

describe('SKILLDEF-02 — game/library boundary', () => {
  it('build.md contains a "## Boundaries" section', () => {
    const build = read('build/build.md');
    expect(build).toContain('## Boundaries');
  });

  it('build.md states node_modules/boardsmith is a read-only live symlink', () => {
    const build = read('build/build.md');
    expect(build).toContain(NODE_MODULES_BOARDSMITH);
    expect(build).toMatch(/read-only/i);
    expect(build).toMatch(/symlink/i);
  });

  it('build.md states a library gap is FILED, never patched', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/\bfile\b/i);
    expect(build).toMatch(/never patch(ed)?/i);
  });

  it('build.md states built-in BoardSmith UI must never be suppressed', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/suppress/i);
    expect(build).toMatch(/built-in/i);
  });

  it('build.md states the agent controls the game board only', () => {
    const build = read('build/build.md');
    expect(build).toMatch(/controls? the game board only/i);
  });

  it('investigate.md Required Reading points at the read-only-library boundary', () => {
    const investigate = read('build/investigate.md');
    expect(investigate).toContain(NODE_MODULES_BOARDSMITH);
    expect(investigate).toMatch(/## Boundaries/i);
  });

  it('final-acceptance.md forbids overriding an explicit client instruction', () => {
    const fa = read('build/final-acceptance.md');
    expect(fa).toMatch(/client/i);
    expect(fa).toMatch(/overrule|override/i);
  });
});

describe('SKILLDEF-03 — fenced escape hatch', () => {
  it('build.md forbids platformActionPanelEscapeHatch without the client', () => {
    const build = read('build/build.md');
    expect(build).toContain(ESCAPE_HATCH_PROP);
    expect(build).toMatch(/without EXPLICIT client direction|without the client/i);
  });

  it('build.md names .suppressFromActionPanel() as the only sanctioned per-Action Panel-hiding mechanism', () => {
    const build = read('build/build.md');
    expect(build).toContain(SUPPRESS_FROM_ACTION_PANEL);
    expect(build).toMatch(/ONLY sanctioned/i);
  });

  it('build.md never references the retired suppressActionPanel name', () => {
    const build = read('build/build.md');
    expect(build).not.toContain(RETIRED_SUPPRESS_ACTION_PANEL);
  });
});

describe('cross-file consistency — status enum + stale marker byte-identical', () => {
  it('build-chunk.md quotes the exact status enum values', () => {
    const buildChunk = read('build-chunk.md');
    for (const value of STATUS_ENUM_VALUES) {
      expect(buildChunk, `build-chunk.md must contain status "${value}"`).toContain(value);
    }
  });

  it('build-chunk.md quotes the stale marker byte-identically (em-dash)', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain(STALE_MARKER);
  });

  it('reuses SKETCH_LEVEL_MARKER / UI_TAG_REGEX conventions if quoted', () => {
    // These constants exist for reuse across the bs/ test suite; no hard assertion required
    // here since build-chunk.md may not need to quote the sketch-level tail marker directly.
    expect(SKETCH_LEVEL_MARKER).toContain('sketch-level');
    expect(UI_TAG_REGEX.test('none | touches | major')).toBe(true);
  });
});

describe('cross-file consistency — Steps 4-10 forward-reference stubs, now retired (skill complete)', () => {
  it('build-chunk.md names each of build/{build,test,audit,repair,playtest,revise,close}.md as plain text', () => {
    const buildChunk = read('build-chunk.md');
    for (const step of ['build', 'test', 'audit', 'repair', 'playtest', 'revise', 'close']) {
      expect(buildChunk, `build-chunk.md must name build/${step}.md`).toContain(`build/${step}.md`);
    }
  });

  it('carries ZERO "authored in Phase 146" forward-reference markers (skill complete)', () => {
    const buildChunk = read('build-chunk.md');
    for (const marker of FORWARD_REFERENCE_MARKERS) {
      expect(buildChunk, `build-chunk.md must NOT contain "${marker}" — the skill is complete`).not.toContain(marker);
    }
  });
});

describe('return-shape field names — pinned across producer + consumer', () => {
  it('build-chunk.md consumes INVESTIGATE_RETURN_FIELDS by the same names', () => {
    const buildChunk = read('build-chunk.md');
    for (const field of INVESTIGATE_RETURN_FIELDS) {
      expect(buildChunk, `build-chunk.md must reference "${field}"`).toContain(field);
    }
  });

  it('build-chunk.md consumes REDTEAM_* fields by the same names', () => {
    const buildChunk = read('build-chunk.md');
    for (const field of [...REDTEAM_REFUTER_FIELDS, ...REDTEAM_COVERAGE_FIELDS]) {
      expect(buildChunk, `build-chunk.md must reference "${field}"`).toContain(field);
    }
  });
});

describe('cross-file consistency — every current-phase referenced path resolves on disk', () => {
  it('build-chunk.md cites every reference path (contains the pointer string)', () => {
    const buildChunk = read('build-chunk.md');
    for (const path of REFERENCED_PATHS) {
      expect(buildChunk, `build-chunk.md must cite "${path}"`).toContain(path);
    }
  });

  for (const path of REFERENCED_PATHS) {
    it(`${path} exists on disk`, () => {
      expect(existsSync(join(__dirname, path)), `${path} must exist`).toBe(true);
    });
  }

  it('REFERENCED_PATHS now includes the four Phase 146 step files', () => {
    const included = ['build/playtest.md', 'build/revise.md', 'build/close.md', 'build/final-acceptance.md'];
    for (const path of included) {
      expect((REFERENCED_PATHS as readonly string[]).includes(path)).toBe(true);
    }
  });
});

describe('SKILLAUTO-01 — milestone playtest gates', () => {
  it('state-machine.md scopes the playtest human-verification gate to milestone chunks, not every chunk', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/playtest.*human-verification gate.*scoped to milestone chunks/i);
    expect(stateMachine).toContain('core-loop');
    expect(stateMachine).toContain('final-acceptance');
  });

  it('state-machine.md still lists a rules-adjudication / open-question escalation as an always-stop regardless of milestone', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/genuine rules adjudication \/ open-question escalation/i);
    expect(stateMachine).toMatch(/always stops the session\s+regardless of milestone/i);
  });

  it('state-machine.md never routes a human playtest for a UI-less chunk', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/never routed to a human playtest/i);
  });

  it('build/playtest.md gates its human stop on milestone flag AND visible ui: presence', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/Milestone\/UI Gate/);
    expect(playtest).toContain('core-loop');
    expect(playtest).toContain('scoring');
    expect(playtest).toContain('final-acceptance');
    expect(playtest).toMatch(/ui:.*is.*touches.*or.*major/i);
  });

  it('build/playtest.md keeps the numbered script and Verified Gate machinery intact for milestone chunks', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toContain('## Verified Checklist');
    expect(playtest).toContain('The Numbered Click-By-Click Test Script');
    expect(playtest).toContain('verified (user-waived)');
  });

  it('build/playtest.md still runs internal verification (test/sim) for non-milestone or UI-less chunks', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/random-sim\/self-playtest/i);
    expect(playtest).toContain('Status: verified');
  });

  it('build-chunk.md Step Group 4 dispatch routes the human playtest only for milestone/UI chunks', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/milestone chunk with visible UI/i);
    expect(buildChunk).toMatch(/skips the\s*\n?\s*human stop entirely/i);
  });
});

describe('SKILLAUTO-02 — ask discipline', () => {
  it('build/ask.md states the ask triple-gate: undetermined AND load-bearing AND no reasonable default, else proceed and record the assumption', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/undetermined/i);
    expect(ask).toMatch(/load-bearing/i);
    expect(ask).toMatch(/reasonable default/i);
    expect(ask).toMatch(/proceed and record the assumption/i);
  });

  it('build/ask.md states already-granted approval is never re-asked', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/never re-ask/i);
    expect(ask).toMatch(/already[- ]granted approval/i);
  });

  it('build/ask.md never routes a UI-less chunk to a human playtest', () => {
    const ask = read('build/ask.md');
    expect(ask).toMatch(/never route a human playtest/i);
    expect(ask).toMatch(/no visible UI/i);
  });
});

describe('SKILLAUTO-03 — batched question queue', () => {
  it('state-machine.md describes an accumulate-into-a-queue model for open questions', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/queue/i);
    expect(stateMachine).toMatch(/batch/i);
  });

  it('state-machine.md states unblocked work continues while questions are queued, surfacing the batch at the next human gate/milestone', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/unblocked work continues/i);
    expect(stateMachine).toMatch(/surfaces?\s+at the next human gate/i);
  });
});

describe('SKILLAUTO-04 — run-while-away', () => {
  it('state-machine.md states the pipeline keeps making progress on reasonable defaults while the human is away', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/run-while-away/i);
    expect(stateMachine).toMatch(/keeps making progress on reasonable defaults/i);
  });

  it('state-machine.md states progress is bounded only by the milestone gates + rules adjudication + context\\/stuck-state', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/bounded\s+only by/i);
    expect(stateMachine).toMatch(/milestone gates/i);
    expect(stateMachine).toMatch(/rules adjudication/i);
  });
});

describe('SKILLAUTO-05 — auto-advance', () => {
  it('build/close.md frames the printed resume command as a cold-resume\\/crash fallback, not the default end-of-close signal', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/crash fallback/i);
    expect(close).toMatch(/never the default end-of-close signal/i);
  });

  it('build-chunk.md frames the printed re-invocation as the crash\\/context-fallback resume, not the default stop', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toMatch(/crash\/context-fallback resume/i);
  });

  it('state-machine.md and build/close.md state the session auto-advances into the next chunk and the next logical step (generate-AI → final-acceptance)', () => {
    const stateMachine = read('state-machine.md');
    const close = read('build/close.md');
    expect(stateMachine).toMatch(/auto-advance/i);
    expect(stateMachine).toMatch(/generate-AI\s*(→|->)\s*final-acceptance/i);
    expect(close).toMatch(/auto-advance/i);
  });

  it('the residual default-stop-and-handoff framing at the chunk boundary is gone from build\\/close.md and build-chunk.md', () => {
    const close = read('build/close.md');
    const buildChunk = read('build-chunk.md');
    expect(close).not.toMatch(/is NOT the end of the session by default/i);
    expect(buildChunk).not.toMatch(/telling the user to re-invoke `\/bs-build-chunk` —\s*\n\s*only when a stop condition fires/i);
  });
});

describe('SKILLAUTO-06 — context floor + offload', () => {
  it('state-machine.md states a >=50% wind-down floor beneath the existing 60% ceiling (both numbers present)', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/50%/);
    expect(stateMachine).toMatch(/60%/);
    expect(stateMachine).toMatch(/never winds? down before/i);
  });

  it('state-machine.md frames stopping before the floor as the same premature bail the ceiling forbids', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/floor/i);
    expect(stateMachine).toMatch(/premature\s+bail/i);
  });

  it('state-machine.md and build-chunk.md name sub-agent offload of research, audits, large reads, and repairs', () => {
    const stateMachine = read('state-machine.md');
    const buildChunk = read('build-chunk.md');
    expect(stateMachine).toMatch(/sub-agent\s+offload/i);
    expect(stateMachine).toMatch(/research/i);
    expect(stateMachine).toMatch(/audits/i);
    expect(stateMachine).toMatch(/large reads/i);
    expect(stateMachine).toMatch(/repairs/i);
    expect(buildChunk).toMatch(/sub-agent\s+offload|dispatched to\s+\n?sub-agents/i);
  });

  it('build-chunk.md still preserves the Context-Economics Hard Rule — orchestrator never reads the big stuff', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain('## Context-Economics Hard Rule');
    expect(buildChunk).toMatch(/orchestrator never reads rulebook slices, BoardSmith docs, or generated code itself/i);
  });

  it('state-machine.md cites the 50% floor as the mechanism that makes long autonomous runs possible', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/main thread.s (own )?context fills slowly/i);
    expect(stateMachine).toMatch(/long autonomous run/i);
  });

  it('resolves floor-vs-harness-warning precedence: a real harness signal below the floor always wins (both files)', () => {
    const stateMachine = read('state-machine.md');
    const buildChunk = read('build-chunk.md');
    // state-machine.md gives explicit precedence for a harness warning firing below the 50% floor.
    expect(stateMachine).toMatch(/harness warning always wins|harness signal.*(beats|overrides).*floor|obey it immediately/i);
    expect(stateMachine).toMatch(/below\W+the 50% floor|below the floor|below 50%/i);
    // build-chunk.md carries the same precedence so the two mirrored sections cannot diverge.
    expect(buildChunk).toMatch(/harness context-low warning always wins|below 50%.*obey it immediately|floor governs only/i);
  });
});

describe('SKILLAUTO-07 — loud completion', () => {
  it('build/final-acceptance.md emits a loud, unambiguous game-completion banner', () => {
    const finalAcceptance = read('build/final-acceptance.md');
    expect(finalAcceptance).toMatch(/GAME COMPLETE/);
    expect(finalAcceptance).toMatch(/loud, unambiguous/i);
  });

  it('build/final-acceptance.md\'s summary card names shipped, test count, and deferred', () => {
    const finalAcceptance = read('build/final-acceptance.md');
    expect(finalAcceptance).toMatch(/summary card/i);
    expect(finalAcceptance).toMatch(/\*\*Shipped\*\*/);
    expect(finalAcceptance).toMatch(/\*\*Test count\*\*/i);
    expect(finalAcceptance).toMatch(/\*\*Deferred\*\*/);
  });

  it('build/final-acceptance.md never buries the game-completion terminus in a wall of text', () => {
    const finalAcceptance = read('build/final-acceptance.md');
    expect(finalAcceptance).toMatch(/never buried in a wall of text|never buried in the routine/i);
  });

  it('build/close.md emits a lighter chunk-level completion line at each chunk close', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/chunk-level completion line/i);
    // The line is designer-facing (reporting.md): it names what the game can now do, and the
    // slug+status form is called out as the shape it must NOT take.
    expect(close).toMatch(/<what the game can now do> — done and tested/);
    expect(close).toMatch(/must not be/i);
  });

  it('build/close.md distinguishes the chunk-level line from the game-level banner and does not stop the session', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/distinct from the loud game-level banner/i);
    expect(close).toMatch(/does not itself stop the session/i);
  });
});

describe('SKILLAUTO-08 — close-time reconciliation + RULINGS re-touch', () => {
  it('build/close.md\'s Bookkeeping Sequence contains a reconciliation step naming all three ledgers', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/reconcil/i);
    expect(close).toMatch(/filings? \/ library-gap ledger|library-gap ledger/i);
    expect(close).toMatch(/asset-debt ledger/i);
    expect(close).toMatch(/waived-chunk ledger/i);
    expect(close).toMatch(/audit\s+the\s+paperwork,\s+not\s+just\s+the\s+code/i);
  });

  it('build/close.md\'s reconciliation step re-touches a filing when a fix lands, and the lock release stays terminal', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/re-touch/i);
    // The reconciliation step must be numbered BEFORE "Release the lock", and the lock
    // release text must still say it is the terminal write of the sequence.
    const reconcileIndex = close.search(/Reconcile the paperwork ledgers/i);
    const releaseIndex = close.search(/Release the lock/i);
    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeLessThan(releaseIndex);
    expect(close).toMatch(/terminal write of the sequence/i);
  });

  it('build/close.md cites check-status.md\'s ledger-surfacing items and build/build.md\'s filings by name (citation, not restatement)', () => {
    const close = read('build/close.md');
    expect(close).toMatch(/check-status\.md/);
    expect(close).toMatch(/build\/build\.md/);
  });

  it('state-machine.md\'s "Rulings Outrank Rulebook" is strengthened with a close-time re-touch obligation', () => {
    const stateMachine = read('state-machine.md');
    const section = stateMachine.slice(stateMachine.indexOf('## Rulings Outrank Rulebook'));
    expect(section).toMatch(/re-touch/i);
    expect(section).toMatch(/SKILLAUTO-08/);
    expect(section).toMatch(/shared,\s*\n?cross-session, per-game store|cross-session,\s*\n?per-game/i);
  });

  it('state-machine.md\'s light-path bookkeeping description names the ledger reconciliation as part of the light path', () => {
    const stateMachine = read('state-machine.md');
    const lightPathSection = stateMachine.slice(
      stateMachine.indexOf('## Step Names (exact, light path — trivial chunks)'),
      stateMachine.indexOf('## Authority'),
    );
    expect(lightPathSection).toMatch(/reconcil/i);
    expect(lightPathSection).toMatch(/SKILLAUTO-08/);
  });
});

describe('SKILLAUTO-08 — fail-loud sims (sim exercised this chunk\'s new actions)', () => {
  it('build/test.md requires an "exercised" assertion for this chunk\'s new actions alongside the four zero-checks', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/EXERCISED/);
    expect(test).toMatch(/silent-coverage failure/i);
    expect(test).toMatch(/SKILLAUTO-08/);
  });

  it('build/test.md frames the exercised-assertion as a required hard gate, not optional advice, with an explicit exemption for zero-new-action chunks', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/hard gate/i);
    expect(test).toMatch(/never\s+optional\s+advice/i);
    expect(test).toMatch(/zero new actions/i);
    expect(test).toMatch(/exempt/i);
  });

  it('build/test.md verifies the assertion against the real SimulationResults shape, never inventing a fake coverage API', () => {
    const test = read('build/test.md');
    expect(test).toMatch(/src\/testing\/random-simulation\.ts/);
    expect(test).toMatch(/do not invent one/i);
  });

  it('build/playtest.md\'s freshness guard is reinforced against a stale/non-exercising human playtest run', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toMatch(/Freshness guard reinforced/i);
    expect(playtest).toMatch(/SKILLAUTO-08/);
    expect(playtest).toMatch(/never exercised its\s*\n?target|never\s+exercised\s+its\s+target/i);
  });
});

describe('PROC-02 — autonomy is how-not-what', () => {
  it('state-machine.md states explicitly that autonomy governs HOW to build, never WHAT the rules are', () => {
    const sm = read('state-machine.md');
    expect(sm).toMatch(/Autonomy Scope: How, Never What/);
    expect(sm).toMatch(/PROC-02/);
    expect(sm).toMatch(/govern[s]?\s+\*{0,2}HOW\*{0,2}/i);
    expect(sm).toMatch(/EVER\s+govern[s]?\s+\*{0,2}WHAT\*{0,2}\s+the\s+rules/i);
  });

  it('state-machine.md states genuine rule ambiguity is surfaced (batched) and never fabricated', () => {
    const sm = read('state-machine.md');
    expect(sm).toMatch(/surfaced/i);
    expect(sm).toMatch(/never\s+fabricated/i);
    expect(sm).toMatch(/batched/i);
  });

  it('state-machine.md ties the how-not-what boundary to the Cold-Resume Parse Contract and Redteam Escalation', () => {
    const sm = read('state-machine.md');
    expect(sm).toMatch(/it never guesses the intended state/i);
    expect(sm).toMatch(/Disputes go to the human, never to more agents/);
  });

  it('build-chunk.md carries a mirrored cross-reference to the how-not-what statement', () => {
    const bc = read('build-chunk.md');
    expect(bc).toMatch(/Autonomy is how, never what \(PROC-02\)/);
    expect(bc).toMatch(/Autonomy Scope: How, Never What/);
  });
});

describe('PROC-02 — Part D survives the autonomy rewrite', () => {
  it('escalate-don\'t-hack / file-don\'t-workaround survives (build/build.md Boundaries + never-fence-panel)', () => {
    const build = read('build/build.md');
    expect(build).toMatch(new RegExp(NODE_MODULES_BOARDSMITH.replace(/\//g, '\\/')));
    expect(build).toMatch(/READ-ONLY and is NEVER patched or edited/);
    expect(build).toMatch(/A shortfall in the library is a library gap, and a library gap is FILED, never patched/);
    expect(build).toMatch(/Never set `platformActionPanelEscapeHatch`[\s\S]{0,120}without EXPLICIT client direction/);
    expect(build).toMatch(new RegExp(ESCAPE_HATCH_PROP));
    // The parity doctrine the section now leads with: a custom board control is
    // IN ADDITION to the Action Panel, never instead of it. Without this, an
    // agent reads the panel's copy of a board control as clutter to remove.
    expect(build).toMatch(/The Action Panel is always on, and it always agrees with the board/);
    expect(build).toMatch(/IN ADDITION to the panel, never instead of it/);
    expect(build).toMatch(/Never CSS-hide the panel/);
  });

  it('reuse-not-rebuild survives (build/test.md hand-rolled sim + build/build.md Extends, Never Restructures)', () => {
    const test = read('build/test.md');
    const build = read('build/build.md');
    expect(test).toMatch(/do not reimplement a hand-rolled\s*\n?\s*random-play loop|do not reimplement a hand-rolled random-play loop/);
    expect(build).toMatch(/Extends, Never Restructures/);
    expect(build).toMatch(/does not restructure verified\s*\n?\s*code|does not restructure verified code/);
  });

  it('honest-derived labeling survives (state-machine.md verified (user-waived) + Cold-Resume Parse Contract)', () => {
    const sm = read('state-machine.md');
    for (const value of STATUS_ENUM_VALUES) {
      expect(sm).toContain(value);
    }
    expect(sm).toMatch(/recorded honestly rather than silently marked `verified`/);
    expect(sm).toMatch(/Cold-Resume Parse Contract/);
  });

  it('surface-don\'t-fabricate survives (state-machine.md STOP-and-ask + build/build.md file-the-gap)', () => {
    const sm = read('state-machine.md');
    const build = read('build/build.md');
    expect(sm).toMatch(/the session STOPS and asks the user\. It never guesses the intended state\./);
    expect(build).toMatch(/design layered on top of the raw slice, never a replacement for/);
    expect(build).toMatch(/the right move \(file the gap\) is always the easy move/);
  });

  it('in-process redteam survives (state-machine.md Redteam Escalation + build/redteam.md adversarial-subagent shape)', () => {
    const sm = read('state-machine.md');
    const redteam = read('build/redteam.md');
    expect(sm).toMatch(/## Redteam Escalation/);
    expect(sm).toMatch(/Disputes go to the human, never to more agents\./);
    expect(redteam).toMatch(/3 fresh-context adversarial agents/);
    expect(redteam).toMatch(/2 refuters \+ 1 coverage adversary/);
  });

  it('build-literally survives (build/build.md Fresh-Context Exception + build/playtest.md numbered outcome-based script)', () => {
    const build = read('build/build.md');
    const playtest = read('build/playtest.md');
    expect(build).toMatch(/## Fresh-Context Exception/);
    expect(build).toMatch(/reads\s*\n?\s*this chunk's cited raw rulebook slices directly/);
    expect(playtest).toMatch(/## The Numbered Click-By-Click Test Script/);
    expect(playtest).toMatch(/observable, outcome-based "expect:" clause/);
  });
});

/**
 * PROV-01/PROV-03 (171-06) — both close paths invoke `boardsmith chunk-check <slug>`.
 *
 * These assertions prove the instruction EXISTS in the installed skill text. Phase 170
 * established across fourteen live runs that a contract test of this shape cannot prove a live
 * session actually follows it — `/bs-build-chunk` Step 0's `ingest-check` call from that phase
 * has still never been exercised by a live session, and this plan adds a second invocation with
 * the identical risk profile. The load-bearing guarantees are NOT these tests — they are (1) the
 * machine-owned `## Verified Against` fence a session declines to hand-author (pinned in
 * templates.test.ts), and (2) `chunk-provenance-status`'s `verifiedWithoutProvenance` flag, which
 * surfaces a skipped invocation after the fact regardless of whether skill text was followed.
 */
describe('PROV-01/PROV-03 — both close paths invoke chunk-check, reused by citation not duplication', () => {
  it('close.md\'s Bookkeeping Sequence invokes `boardsmith chunk-check`', () => {
    const close = read('build/close.md');
    expect(close).toContain('boardsmith chunk-check');
  });

  it('playtest.md\'s Light-Path Bookkeeping cites close.md\'s Bookkeeping Sequence BY NAME and does not duplicate the chunk-check text', () => {
    const playtest = read('build/playtest.md');
    expect(playtest).toContain('## Bookkeeping Sequence');
    // Reuse-by-citation is the contract that keeps the two close paths from drifting apart — a
    // duplicated copy of the chunk-check instruction is exactly how they would diverge.
    expect(playtest).not.toContain('boardsmith chunk-check');
  });
});

/**
 * Ordinal-citation drift guard (171-06, plan-check blocker).
 *
 * `close.md`'s Bookkeeping Sequence is a numbered list. Other files cite specific items by
 * ordinal (`Bookkeeping Sequence ... item N`) rather than by name, and nothing previously pinned
 * those ordinals to the sequence's REAL numbering — inserting or removing an item silently
 * broke every ordinal citation without failing any test (171-06 found exactly this: two
 * citations still named "item 4" after an insertion had shifted that duty to item 5). This test
 * derives close.md's actual numbering by parsing its own numbered list, then validates every
 * ordinal citation anywhere under this directory tree against it, so a future renumber fails the
 * suite instead of depending on someone remembering to grep.
 */
describe('Bookkeeping Sequence ordinal citations resolve to the item they describe', () => {
  const bsDir = __dirname;

  /** Parse close.md's `## Bookkeeping Sequence` into { itemNumber -> full item text }. */
  function parseBookkeepingSequence(): Map<number, string> {
    const close = read('build/close.md');
    const sectionStart = close.indexOf('## Bookkeeping Sequence');
    expect(sectionStart, 'close.md must have a "## Bookkeeping Sequence" heading').toBeGreaterThan(-1);
    const nextHeading = close.indexOf('\n## ', sectionStart + 1);
    const section = nextHeading === -1 ? close.slice(sectionStart) : close.slice(sectionStart, nextHeading);

    const items = new Map<number, string>();
    const itemRe = /^(\d+)\.\s+\*\*/gm;
    const starts: Array<{ n: number; idx: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(section))) {
      starts.push({ n: Number(m[1]), idx: m.index });
    }
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].idx : section.length;
      items.set(starts[i].n, section.slice(starts[i].idx, end));
    }
    return items;
  }

  /** Recursively list every .md file under bsDir. */
  function listMarkdownFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listMarkdownFiles(full));
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
    return out;
  }

  const GENERIC_STOPWORDS = new Set([
    'chunk', 'chunks', 'close', 'record', 'records', 'recorded', 'write', 'writes', 'written',
    'before', 'after', 'these', 'which', 'status', 'sequence', 'bookkeeping', 'itself', 'never',
    'always', 'other', 'above', 'below', 'exact', 'exactly', 'first', 'final', 'terminal', 'every',
    'state-machine', 'build-close', 'session', 'their', 'there', 'about', 'still', 'until', 'again',
    // Structurally overloaded within THIS document — "ledger(s)" names four distinct per-item
    // ledgers across the sequence (a DECISIONS.md ledger in one item, three others reconciled in
    // another), so its presence alone does not distinguish which item a citation describes.
    'ledger', 'ledgers',
  ]);

  /** Significant lowercase words (>=5 chars, alnum/hyphen), generic connective words filtered out. */
  function significantWords(text: string): string[] {
    const words = text.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? [];
    return Array.from(new Set(words)).filter((w) => !GENERIC_STOPWORDS.has(w));
  }

  /** Two words "overlap" if identical, or share their first 6 characters (handles plural/gerund drift). */
  function wordsOverlap(a: string, b: string): boolean {
    if (a === b) return true;
    const prefixLen = 6;
    if (a.length < prefixLen || b.length < prefixLen) return false;
    return a.slice(0, prefixLen) === b.slice(0, prefixLen);
  }

  it('close.md\'s Bookkeeping Sequence parses to a non-empty, contiguously-numbered list', () => {
    const items = parseBookkeepingSequence();
    expect(items.size).toBeGreaterThan(0);
    const numbers = Array.from(items.keys()).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  it('every "Bookkeeping Sequence ... item N" citation under this directory names an N that exists and describes that item\'s actual duty', () => {
    const items = parseBookkeepingSequence();
    const citationRe = /Bookkeeping Sequence[^a-zA-Z0-9]{0,6}item\s+(\d+)/gi;
    const failures: string[] = [];

    for (const file of listMarkdownFiles(bsDir)) {
      const rel = file.slice(bsDir.length + 1);
      // close.md is the source of the numbering, not a citation of it — it never cites itself
      // by ordinal, so there's nothing to cross-check there.
      if (rel === 'build/close.md') continue;

      const text = readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = citationRe.exec(text))) {
        const n = Number(match[1]);
        const item = items.get(n);
        if (!item) {
          failures.push(`${rel}: cites "item ${n}" but close.md's Bookkeeping Sequence has no item ${n} (has ${items.size} items)`);
          continue;
        }
        // Citing sentences in this doc set often enumerate SEVERAL duties in one long sentence
        // before citing an ordinal for only the nearest one (e.g. "...rolls up decisions,
        // reconciles the ledgers... (SKILLAUTO-08, see ... item N)"). A wide fixed-width window
        // would pick up every enumerated duty and defeat the discriminative check entirely — so
        // narrow to the clause immediately preceding the citation: walk back to the nearest
        // enclosing "(" (citations here are always parenthetical), then from there back to the
        // nearest clause boundary (comma/semicolon/period), which is where the SPECIFIC duty
        // description for this ordinal starts.
        const lookback = text.slice(Math.max(0, match.index - 120), match.index);
        const parenOffset = lookback.lastIndexOf('(');
        const parenStart = parenOffset === -1 ? match.index : Math.max(0, match.index - 120) + parenOffset;
        const clauseWindow = text.slice(Math.max(0, parenStart - 200), parenStart);
        const boundary = Math.max(
          clauseWindow.lastIndexOf(','),
          clauseWindow.lastIndexOf(';'),
          clauseWindow.lastIndexOf('.'),
        );
        const clauseStart =
          boundary === -1 ? Math.max(0, parenStart - 150) : Math.max(0, parenStart - 200) + boundary + 1;
        // Trailing buffer is deliberately small: it exists only to close a citation's own
        // parenthesis, not to reach into the following sentence, whose vocabulary belongs to
        // an unrelated clause and would otherwise leak in as a coincidental false match.
        const context = text.slice(clauseStart, match.index + match[0].length + 10);
        const citationWords = significantWords(context);
        const itemWords = significantWords(item);
        const overlaps = citationWords.some((cw) => itemWords.some((iw) => wordsOverlap(cw, iw)));
        if (!overlaps) {
          failures.push(
            `${rel}: cites "item ${n}" but the citing text shares no significant vocabulary with ` +
              `close.md's item ${n} ("${item.slice(0, 80).replace(/\s+/g, ' ')}..."). Either the ` +
              `citation is stale (item ${n} was renumbered) or this test's overlap heuristic needs ` +
              `updating for genuinely new wording.`,
          );
        }
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
