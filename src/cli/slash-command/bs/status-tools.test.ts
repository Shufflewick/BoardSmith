/**
 * Structural drift-protection test for the `/bs-check-status` skill (STAT-01) and
 * (in a later plan) `/bs-insert-chunk` (STAT-02).
 *
 * `bs/check-status.md` and `bs/insert-chunk.md` are plain markdown consumed by an agent
 * session, NOT parsed by any runtime code in this repo. This test pins the exact strings,
 * citations, and cross-file pointers those files depend on so a future reword/reorg fails
 * loudly here instead of being discovered only when a downstream status/insert session
 * misbehaves.
 *
 * Authored FIRST (Wave 0 gap), before Task 2 of this plan authors check-status.md. The
 * STAT-01 describe block below is RED (or ERRORs, since check-status.md doesn't exist yet)
 * until Task 2 lands — this is the intended Wave-0-first state.
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a
 * missing file fails only that one assertion instead of aborting the whole suite's
 * collection phase — required because check-status.md/insert-chunk.md are authored
 * progressively across this plan and Plan 02.
 *
 * Mirrors `src/cli/slash-command/bs/ingest.test.ts` (Phase 142) and
 * `src/cli/slash-command/bs/templates.test.ts` (Phase 141): same `__dirname`/`read()`
 * helper, same named byte-identical-marker-constant technique, one `describe` per
 * requirement ID.
 *
 * NOTE: this file's shared constants (STALE_MARKER, WAIVED_STATUS, REFERENCED_PATHS,
 * REFERENCED_SECTIONS) are declared here for reuse by Plan 02's STAT-02 block — do NOT
 * duplicate them in a second file.
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

/** CHUNK-level stale marker (em-dash, not hyphen) — set by /bs-insert-chunk. */
const STALE_MARKER = 'stale — re-derive before build';

/** The waived-verification status enum value, byte-exact. */
const WAIVED_STATUS = 'verified (user-waived)';

/**
 * Every path check-status.md (and, in Plan 02, insert-chunk.md) must cite by exact path
 * — no dangling pointers (cross-file consistency, STAT-*).
 */
const REFERENCED_PATHS = [
  'state-machine.md',
  'templates/SKETCH.template.md',
  'templates/CHUNK.template.md',
  'templates/ASSETS.template.md',
] as const;

/**
 * The exact state-machine.md headings check-status.md must cite (never restate) — and
 * which must actually exist in state-machine.md, guarding against a cited heading that
 * doesn't exist (Pitfall 2).
 */
const REFERENCED_SECTIONS = [
  '## Consistency Check (every bs- entry point, before proceeding)',
  '## Status Enum (exact)',
  '## Session Lock',
] as const;

/**
 * The exact state-machine.md headings insert-chunk.md must cite (never restate) — and which
 * must actually exist in state-machine.md, guarding against a cited heading that doesn't exist
 * (Pitfall 2).
 */
const REFERENCED_SECTIONS_INSERT = [
  '## Write Order',
  '## Consistency Check (every bs- entry point, before proceeding)',
  '## Status Enum (exact)',
  '## Session Lock',
] as const;

describe('STAT-01 — check-status.md read-only status reader', () => {
  it('check-status.md exists and is full, non-thin-pointer content', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus.length).toBeGreaterThan(2500);
  });

  it('enumerates report item 1: chunks done/remaining', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/done|remaining/i);
    expect(checkStatus).toMatch(/chunks? (done|remaining)/i);
  });

  it('enumerates report item 2: current chunk + step', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/current chunk/i);
    expect(checkStatus).toMatch(/current step|first unchecked/i);
  });

  it('item 2 carves out a stale current chunk, reporting re-derivation not a step (WR-04)', () => {
    const checkStatus = read('check-status.md');
    // A chunk whose Status reads the stale marker has an invalid checklist —
    // build-chunk.md Step 2 stops routing on it. Item 2 must NOT report a
    // "current step" off it; it reports the re-derivation carve-out instead.
    // Pins the WR-04 fix so the stale case cannot silently fall back to
    // reading an invalid checklist.
    expect(checkStatus).toContain(STALE_MARKER);
    expect(checkStatus).toContain('stale — needs re-derivation');
    expect(checkStatus).toMatch(/do NOT report a step/i);
  });

  it('enumerates report item 3: outstanding playtest feedback', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/outstanding.*(playtest|feedback)/i);
    expect(checkStatus).toMatch(/Revision Rounds/);
  });

  it('enumerates report item 4: waived verifications + proposed batch playtest', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toContain(WAIVED_STATUS);
    expect(checkStatus).toMatch(/batch playtest/i);
  });

  it('enumerates report item 5: asset debts referencing ASSETS.md', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/asset debts?/i);
    expect(checkStatus).toMatch(/ASSETS\.md/);
  });

  it('enumerates report item 6: ideas backlog size', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/ideas backlog/i);
  });

  it('enumerates report item 7: the exact next command', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/next command/i);
    expect(checkStatus).toMatch(/\/bs-build-chunk|\/bs-insert-chunk|\/bs-ingest-rules/);
  });

  it('is read-only — never instructs or performs any state mutation', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).not.toMatch(/write .*SKETCH|edit .*CHUNK|mutate|bump .*version/i);
    expect(checkStatus).toMatch(/read-only|no writes|never (mutate|write)/i);
  });

  it('cites each REFERENCED_SECTIONS heading by exact string', () => {
    const checkStatus = read('check-status.md');
    for (const heading of REFERENCED_SECTIONS) {
      const bareHeading = heading.replace(/^##\s*/, '');
      expect(checkStatus).toContain(bareHeading);
    }
  });

  it('every cited REFERENCED_SECTIONS heading actually exists in state-machine.md', () => {
    const stateMachine = read('state-machine.md');
    for (const heading of REFERENCED_SECTIONS) {
      expect(stateMachine).toContain(heading);
    }
  });

  it('references each REFERENCED_PATHS entry and every path exists (no dangling pointers)', () => {
    const checkStatus = read('check-status.md');
    for (const path of REFERENCED_PATHS) {
      expect(checkStatus).toContain(path);
      expect(existsSync(join(__dirname, path))).toBe(true);
    }
  });

  it('check-status.md itself exists on disk (drift-guard for the existence checks above)', () => {
    expect(existsSync(join(__dirname, 'check-status.md'))).toBe(true);
  });
});

describe('STAT-02 — insert-chunk.md sketch editor', () => {
  it('insert-chunk.md exists and is full, non-thin-pointer content', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk.length).toBeGreaterThan(2500);
  });

  it('enumerates op (a): dependency-order re-validation', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toMatch(/dependency-order re-validation|dependency order/i);
  });

  it('enumerates op (b): closed-chunk citation-overlap diff', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toMatch(/citation-overlap diff|citation overlap/i);
  });

  it('enumerates op (c): stale-marking', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toMatch(/stale-marking|stale.marking/i);
  });

  it('enumerates op (d): version-stamp bump', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toMatch(/version-stamp bump|version stamp/i);
  });

  it('pins STALE_MARKER byte-exact as the CHUNK.md Status value it sets', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toContain(STALE_MARKER);
  });

  it('documents the version-stamp bump citing SKETCH.template.md\'s field AND ## Write Order', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toContain('Sketch Version:');
    expect(insertChunk).toContain('## Write Order');
  });

  it('does NOT cite a nonexistent state-machine "Sketch Version" heading', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).not.toMatch(/state-machine\.md[^\n]*"?Sketch Version"?/);
  });

  it('op (b) scans BOTH ## Interpretation and ## Newly Discovered Citations', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toContain('## Interpretation');
    expect(insertChunk).toContain('## Newly Discovered Citations');
  });

  it('enumerates op (e): the ## Ordered Chunk List edit, folded into the SKETCH.md write (WR-01)', () => {
    const insertChunk = read('insert-chunk.md');
    // The core reshape mutation must be a NAMED operation, not left implicit,
    // and its write-order placement must be pinned (rewrite list, then version
    // line, in the same SKETCH.md write). Pins the WR-01 fix.
    expect(insertChunk).toMatch(/\(e\)\s+Ordered Chunk List edit/i);
    expect(insertChunk).toContain('## Ordered Chunk List');
    expect(insertChunk).toMatch(/same\s+`?SKETCH\.md`?\s+write/i);
  });

  it('presents the list edit (e) before the version bump (d), matching write order (WR-02)', () => {
    const insertChunk = read('insert-chunk.md');
    // Write Order requires the ## Ordered Chunk List rewrite FIRST and the
    // Sketch Version: line LAST. The enumeration must therefore present op (e)
    // before op (d) so "follow the list top-to-bottom" is correct by
    // construction — pins the WR-02 reorder against regressing to (d)-then-(e),
    // which would instruct writing the version line before the list.
    const listEditIdx = insertChunk.indexOf('(e) Ordered Chunk List edit');
    const versionBumpIdx = insertChunk.indexOf('(d) Version-stamp bump');
    expect(listEditIdx).toBeGreaterThan(-1);
    expect(versionBumpIdx).toBeGreaterThan(-1);
    expect(listEditIdx).toBeLessThan(versionBumpIdx);
  });

  it('remove is described as a reshape type of op (e), with no dangling heading ref (WR-03)', () => {
    const insertChunk = read('insert-chunk.md');
    // The CR-01 guard once said "`remove` is a first-class operation (see the
    // heading below)" — a dangling intra-file pointer to a nonexistent `remove`
    // heading. Pin that the reference now points at op (e)'s reshape types and
    // the dangling "see the heading below" phrasing is gone.
    expect(insertChunk).not.toMatch(/see the heading below/i);
    expect(insertChunk).toMatch(/`remove` is one of the four reshape types operation \(e\) performs/);
  });

  it('documents write order CHUNK.md-first-then-SKETCH.md', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toMatch(/CHUNK\.md/);
    expect(insertChunk).toMatch(/SKETCH\.md/);
    expect(insertChunk).toContain('## Write Order');
  });

  it('guards the ## Mandated Chunks invariants surviving a reshape (OQ2)', () => {
    const insertChunk = read('insert-chunk.md');
    expect(insertChunk).toContain('## Mandated Chunks');
    expect(insertChunk).toMatch(/first.chunk|core event loop/i);
    expect(insertChunk).toMatch(/game.end/i);
    expect(insertChunk).toMatch(/final.acceptance/i);
  });

  it('mandated-chunks guard blocks DELETION, not just reordering (CR-01)', () => {
    const insertChunk = read('insert-chunk.md');
    // The guard must reject a `remove` targeting a mandated chunk, and must
    // state that removal is only allowed with an explicit user replacement —
    // never a silent drop. Pins the CR-01 fix so it cannot regress to the
    // reorder-only wording that let a delete slip through.
    expect(insertChunk).toMatch(/reject\s+any\s+remove\s+targeting\s+it/i);
    expect(insertChunk).toMatch(/must\s+remain\s+present/i);
    expect(insertChunk).toMatch(/explicitly\s+replaces\s+it/i);
    expect(insertChunk).toMatch(/never\s+(as\s+)?a\s+silent\s+drop/i);
  });

  it('Step 0 resolves a LIVE (non-stale) session lock, not just a stale one (WR-05)', () => {
    const insertChunk = read('insert-chunk.md');
    // insert-chunk writes state, so it must warn-instead-of-clobber on a live
    // lock, same as build-chunk.md Step 0 outcome 2. Pins the WR-05 fix so it
    // cannot regress to only checking for a stale (>24h) lock.
    expect(insertChunk).toMatch(/live[\s(-]*(non-?stale)?[\s)]*lock/i);
    expect(insertChunk).toMatch(/warn/i);
    expect(insertChunk).toMatch(/clobber/i);
    expect(insertChunk).toContain('## Session Lock');
  });

  it('live-lock guard fires on ANY live lock, not only one naming a reshaped chunk (WR-01)', () => {
    const insertChunk = read('insert-chunk.md');
    // Because the reshape rewrites the ENTIRE ## Ordered Chunk List + version
    // stamp, its write footprint is the whole SKETCH.md — so the guard must
    // warn on ANY live lock naming in-flight work, NOT only one naming a chunk
    // this reshape will stale-mark or reorder. Pins the WR-01 broadening so it
    // cannot regress to the narrower footprint-scoped condition.
    expect(insertChunk).toMatch(/names ANY chunk/);
    expect(insertChunk).toMatch(/NOT limited to/i);
    expect(insertChunk).toMatch(/(entire|whole)[^\n]*Ordered Chunk List/i);
  });

  it('cites each REFERENCED_SECTIONS_INSERT heading by exact string', () => {
    const insertChunk = read('insert-chunk.md');
    for (const heading of REFERENCED_SECTIONS_INSERT) {
      const bareHeading = heading.replace(/^##\s*/, '');
      expect(insertChunk).toContain(bareHeading);
    }
  });

  it('every cited REFERENCED_SECTIONS_INSERT heading actually exists in state-machine.md', () => {
    const stateMachine = read('state-machine.md');
    for (const heading of REFERENCED_SECTIONS_INSERT) {
      expect(stateMachine).toContain(heading);
    }
  });

  it('references each REFERENCED_PATHS entry and every path exists (no dangling pointers)', () => {
    const insertChunk = read('insert-chunk.md');
    for (const path of REFERENCED_PATHS) {
      expect(insertChunk).toContain(path);
      expect(existsSync(join(__dirname, path))).toBe(true);
    }
  });
});

describe('STAT-02 — build-chunk.md forward-ref retirement', () => {
  it('no longer contains the stale check-status forward-ref phrasing', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).not.toMatch(/ships as\s+`?\/bs-check-status`?\s*\(Phase 147\)/);
  });

  it('no longer contains the stale insert-chunk forward-ref phrasing', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).not.toMatch(/ships as\s+`?\/bs-insert-chunk`?\s*\(Phase 147\)/);
  });

  it('no longer contains "until it lands" stopgap phrasing', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).not.toMatch(/until it lands/);
  });

  it('leaks no internal planning-phase reference (any dangling "Phase 147") (WR-02)', () => {
    const buildChunk = read('build-chunk.md');
    // The earlier regexes only caught the `ships as ... (Phase 147)` shape; a
    // bare `, Phase 147)` leftover slipped through. Forbid the phase number in
    // any form so future drift fails loudly.
    expect(buildChunk).not.toMatch(/Phase 147/);
  });

  it('routes both intents to the now-live skills', () => {
    const buildChunk = read('build-chunk.md');
    expect(buildChunk).toContain('/bs-check-status');
    expect(buildChunk).toContain('/bs-insert-chunk');
  });
});

describe('STAT-02 — both skills exist', () => {
  it('check-status.md exists on disk', () => {
    expect(existsSync(join(__dirname, 'check-status.md'))).toBe(true);
  });

  it('insert-chunk.md exists on disk', () => {
    expect(existsSync(join(__dirname, 'insert-chunk.md'))).toBe(true);
  });
});
