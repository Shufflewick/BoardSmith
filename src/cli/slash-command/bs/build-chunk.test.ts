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

/** SKILLDEF-03: the only sanctioned per-action dock-hiding mechanism. */
const SUPPRESS_FROM_DOCK = 'suppressFromDock';

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
    // close.md must state the light path reuses ONLY the four-item Bookkeeping Sequence
    // (SKILLDEF-01 added the terminal lock-release step as item 4).
    const close = read('build/close.md');
    expect(close).toMatch(/light path reuses \*\*only\*\* this four-item sequence/i);
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

  it('build.md names .suppressFromDock() as the only sanctioned per-action dock-hiding mechanism', () => {
    const build = read('build/build.md');
    expect(build).toContain(SUPPRESS_FROM_DOCK);
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
