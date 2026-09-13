/**
 * #232: AN UNRELATED EDIT MUST NOT INVALIDATE AN ACCEPTED CLONE GROUP.
 *
 * `.fallow-dupes-baseline.json` keyed accepted duplication by
 * `file:start-end`, which is an address rather than a property of the debt.
 * Insert a line anywhere above a clone and its entry stops matching -- and
 * nothing notices, because `fallow audit` has nothing in scope on `main`. The
 * bill arrives for whoever next edits one of the named files, in the form of
 * their change being blamed for clone groups that predate it. #230 measured it:
 * a four-line edit to `GameShell.vue` surfaced six baselined groups keyed 22 to
 * 31 lines above where the code sat.
 *
 * The tests below are that fault, stated twice. The first is the one the old
 * key failed: shift a group's lines the way an edit above it does, and the
 * entry must still match. The second is the one a content key must not lose:
 * change the duplicated text, or copy it into one more place, and it must fail.
 */
import { describe, it, expect } from 'vitest';

import {
  acceptedFromScan,
  cloneGroupKey,
  compareAcceptedDupes,
  describeDupesDrift,
  describeReaddressed,
  type CloneGroup,
  type DupesScan,
} from './dupes-baseline.js';

const HELPER = "const seated = async (page) => {\n  await page.waitFor('.seat');\n};";
const OTHER = 'expect(read(path)).toMatch(/keyboard/i);';

const group = (
  fragment: string,
  places: readonly { file: string; start: number }[],
): CloneGroup => ({
  line_count: fragment.split('\n').length,
  instances: places.map(({ file, start }) => ({
    file,
    start_line: start,
    end_line: start + fragment.split('\n').length - 1,
    fragment,
  })),
});

const scan = (...groups: CloneGroup[]): DupesScan => ({ clone_groups: groups });

/** The same duplication, further down both files: the edit-above case. */
const shifted = (from: CloneGroup, by: number): CloneGroup => ({
  ...from,
  instances: from.instances.map((instance) => ({
    ...instance,
    start_line: instance.start_line + by,
    end_line: instance.end_line + by,
  })),
});

describe('#232: the key survives an edit that is not the debt', () => {
  const accepted = group(HELPER, [
    { file: 'src/ui/components/GameShell.vue', start: 120 },
    { file: 'src/ui/components/PlayShell.vue', start: 88 },
  ]);

  it('keys a clone group by its content, not by where it sits', () => {
    // THE ASSERTION THE OLD KEY FAILED. 25 lines added above is #230's own
    // measurement, and it used to mean six entries stopped matching.
    expect(cloneGroupKey(shifted(accepted, 25))).toBe(cloneGroupKey(accepted));
  });

  it('keys it to the value the committed record was written against (#243)', () => {
    // A GOLDEN KEY, and the reason it is pinned rather than derived. The
    // separator between fragments is a NUL, which no source text can hold, and
    // #243 changed only how that character is SPELLED in the module: from the
    // byte itself, which made git call the file binary, to the escape. Every
    // key in `.fallow-dupes-accepted.json` was recorded through the old
    // spelling, so a spelling that built a different string would re-key the
    // whole record at once and forgive whatever no longer matched. This value
    // was measured from the pre-#243 module.
    expect(cloneGroupKey(accepted)).toBe('cd4dcc206806a522');
  });

  it('reports no drift when every address moved and no content did', () => {
    const committed = acceptedFromScan(scan(accepted));
    const tree = acceptedFromScan(scan(shifted(accepted, 25)));
    expect(compareAcceptedDupes(committed, tree)).toEqual([]);
  });

  it('keys it the same after a rename, and after the whole group moves file', () => {
    // Neither is new debt. A group that relocated is the same duplication in a
    // different place, and the record's `files` field follows it on the re-key.
    const renamed = group(HELPER, [
      { file: 'src/ui/components/TableShell.vue', start: 120 },
      { file: 'src/ui/components/PlayShell.vue', start: 88 },
    ]);
    expect(cloneGroupKey(renamed)).toBe(cloneGroupKey(accepted));
  });

  it('keys it the same when two instances swap places in one file', () => {
    // The fragments are sorted by their own text, so the key cannot depend on
    // which instance the scan happened to report first.
    const oneOrder = group(HELPER, [
      { file: 'src/a.ts', start: 10 },
      { file: 'src/a.ts', start: 200 },
    ]);
    const other = group(HELPER, [
      { file: 'src/a.ts', start: 200 },
      { file: 'src/a.ts', start: 10 },
    ]);
    expect(cloneGroupKey(other)).toBe(cloneGroupKey(oneOrder));
  });

  it('records where the debt is and how big it is, for a reader', () => {
    const { accepted: recorded } = acceptedFromScan(scan(accepted));
    expect(recorded).toEqual([
      {
        content: cloneGroupKey(accepted),
        lines: 3,
        files: ['src/ui/components/GameShell.vue', 'src/ui/components/PlayShell.vue'],
      },
    ]);
  });
});

describe('#232: the key still fails on what should fail', () => {
  const accepted = group(HELPER, [
    { file: 'src/a.ts', start: 10 },
    { file: 'src/b.ts', start: 40 },
  ]);
  const committed = acceptedFromScan(scan(accepted));

  it('reports a clone pasted into one more place as new', () => {
    // A third instance makes the group's fragment multiset larger, so the key
    // changes. This is the copy-paste the gate exists for, and it must not be
    // re-keyed away.
    const spread = group(HELPER, [
      { file: 'src/a.ts', start: 10 },
      { file: 'src/b.ts', start: 40 },
      { file: 'src/c.ts', start: 7 },
    ]);
    const drift = compareAcceptedDupes(committed, acceptedFromScan(scan(spread)));
    expect(drift.map((entry) => entry.direction).sort()).toEqual(['gone', 'new']);
  });

  it('reports edited duplication as new rather than moved', () => {
    // docs/fallow-gate.md's own rule: a group whose content changed is new debt
    // wearing an old key. The check is now made on every run.
    const edited = group(`${HELPER}\n// and a line nobody accepted`, [
      { file: 'src/a.ts', start: 10 },
      { file: 'src/b.ts', start: 40 },
    ]);
    const drift = compareAcceptedDupes(committed, acceptedFromScan(scan(edited)));
    expect(drift.filter((entry) => entry.direction === 'new')).toHaveLength(1);
    expect(drift.filter((entry) => entry.direction === 'gone')).toHaveLength(1);
  });

  it('reports brand new duplication as new', () => {
    const extra = group(OTHER, [
      { file: 'docs/one.test.ts', start: 5 },
      { file: 'docs/two.test.ts', start: 9 },
    ]);
    const drift = compareAcceptedDupes(committed, acceptedFromScan(scan(accepted, extra)));
    expect(drift).toEqual([
      { direction: 'new', content: cloneGroupKey(extra), lines: 1, files: ['docs/one.test.ts', 'docs/two.test.ts'] },
    ]);
  });

  it('reports accepted debt that has been paid off', () => {
    const drift = compareAcceptedDupes(committed, acceptedFromScan(scan()));
    expect(drift).toEqual([
      { direction: 'gone', content: cloneGroupKey(accepted), lines: 3, files: ['src/a.ts', 'src/b.ts'] },
    ]);
  });

  it('counts multiplicity, so accepting one identical group does not accept two', () => {
    const twin = group(HELPER, [
      { file: 'src/x.ts', start: 1 },
      { file: 'src/y.ts', start: 1 },
    ]);
    // Same text, different files: two pieces of debt with one content key.
    const drift = compareAcceptedDupes(committed, acceptedFromScan(scan(accepted, twin)));
    expect(drift).toHaveLength(1);
    expect(drift[0].direction).toBe('new');
  });
});

describe('#232: what the reports tell a person to do', () => {
  const newDrift = describeDupesDrift([
    { direction: 'new', content: 'abc123', lines: 12, files: ['src/a.ts', 'src/b.ts'] },
  ]);

  it('never offers a regeneration command for duplication nothing accepted', () => {
    // A full-repository save is exactly what silently forgives new debt, so the
    // message for new duplication must not read as an invitation to run one.
    expect(newDrift).toContain('src/a.ts, src/b.ts');
    expect(newDrift).toContain('Fix the duplication');
    expect(newDrift).not.toMatch(/fallow dupes --save-baseline/);
  });

  // #256: the visible remedy in this text used to be `delete
  // .fallow-dupes-accepted.json && boardsmith audit --rekey-dupes`, which is
  // the one action that widens the record wholesale. Under time pressure that
  // is the thing a person reaches for, so the text must not offer it.
  it('does not offer discarding the RECORD as the ordinary remedy (#256)', () => {
    expect(newDrift).not.toMatch(/delete[^\n]*\.fallow-dupes-accepted\.json/i);
    expect(newDrift).not.toContain('--rekey-dupes');
    expect(newDrift).toContain('NOT the ordinary remedy');
  });

  // #256: a content-matched address move is not a decision, so the report for
  // one is in the PAST tense -- the audit re-addressed them and is saying so,
  // rather than failing and asking a human to run a command.
  it('reports moved addresses as work already done, not as an instruction (#256)', () => {
    const report = describeReaddressed(6);
    expect(report).toContain('Re-addressed 6 accepted clone groups');
    expect(report).toContain('The duplication itself is unchanged');
    expect(report).toContain('no debt was forgiven');
    expect(report).toContain('.fallow-dupes-baseline.json');
    // Nothing for a human to run: that was the manual step #256 removes.
    expect(report).not.toContain('--rekey-dupes');
  });
});
