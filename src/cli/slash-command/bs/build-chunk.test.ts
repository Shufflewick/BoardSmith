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
 * BUILD-05..11 (build/test/audit/repair/playtest/revise/close) are NOT asserted here at all —
 * those steps are authored in Phases 144-146. Steps 4-10 are asserted only as forward-reference
 * stub text in build-chunk.md's routing table (the "authored in Phase 14X" marker), never as
 * file-existence checks, per 143-CONTEXT.md's "existence check covers only files due by the
 * current phase."
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a missing
 * file fails only that one assertion instead of aborting the whole suite's collection phase.
 *
 * Mirrors `src/cli/slash-command/bs/ingest.test.ts` (Phase 142): same `__dirname`/`read()`
 * helper, same named byte-identical-marker-constant technique, one `describe` per requirement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
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
 * The 10-step full-ceremony pipeline, byte-identical to state-machine.md "Step Names (exact,
 * full ceremony)".
 */
const FULL_CEREMONY_STEPS = 'investigate, redteam, ask, build, test, audit, repair, playtest, revise, close';

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
  'build/build.md',
  'build/test.md',
  'build/design-ask.md',
  'state-machine.md',
  'templates/CHUNK.template.md',
  'templates/RULINGS.template.md',
  'templates/ASSETS.template.md',
] as const;

/** Phase 145-146 forward-reference stub markers build-chunk.md's routing table must carry. */
const FORWARD_REFERENCE_MARKERS = [
  'authored in Phase 145',
  'authored in Phase 146',
] as const;

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

describe('cross-file consistency — Steps 4-10 forward-reference stubs (no file-existence check)', () => {
  it('build-chunk.md names each of build/{build,test,audit,repair,playtest,revise,close}.md as plain text', () => {
    const buildChunk = read('build-chunk.md');
    for (const step of ['build', 'test', 'audit', 'repair', 'playtest', 'revise', 'close']) {
      expect(buildChunk, `build-chunk.md must name build/${step}.md`).toContain(`build/${step}.md`);
    }
  });

  it('carries the three "authored in Phase 14X" forward-reference markers', () => {
    const buildChunk = read('build-chunk.md');
    for (const marker of FORWARD_REFERENCE_MARKERS) {
      expect(buildChunk, `build-chunk.md must contain "${marker}"`).toContain(marker);
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

  it('REFERENCED_PATHS does NOT include any Phase 145-146 step file', () => {
    const excluded = [
      'build/audit.md',
      'build/repair.md',
      'build/playtest.md',
      'build/revise.md',
      'build/close.md',
    ];
    for (const path of excluded) {
      expect((REFERENCED_PATHS as readonly string[]).includes(path)).toBe(false);
    }
  });
});
