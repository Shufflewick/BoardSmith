import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import {
  appendCrossChunkEntry,
  changedSide,
  changedSideBetween,
  checkCrossChunkLedger,
  crossReferences,
} from './cross-chunk.js';

/**
 * #294: chunks built at the same time cannot see each other. In sotf, auctions and quests
 * referenced venues that world evolution could destroy, and the three were built on separate
 * branches at once. After a merge, the references between what the branch changed and what the
 * main line changed while it was away are listed, and the audit must rule on them.
 */

const WORLD_DIFF = `diff --git a/src/world.ts b/src/world.ts
--- a/src/world.ts
+++ b/src/world.ts
@@ -3,1 +3,2 @@
-const VENUES = ['market', 'harbor'];
+export function destroyVenue(venues: string[], id: string) { return venues.filter((v) => v !== id); }
+const VENUES = ['harbor'];
diff --git a/tests/world.test.ts b/tests/world.test.ts
--- a/tests/world.test.ts
+++ b/tests/world.test.ts
@@ -1,0 +1,1 @@
+expect(destroyVenue(['auctionHouse'], 'auctionHouse')).toEqual([]);
diff --git a/design/RULINGS.md b/design/RULINGS.md
--- a/design/RULINGS.md
+++ b/design/RULINGS.md
@@ -1,0 +1,1 @@
+### Ruling 4 about the market
`;

const AUCTION_DIFF = `diff --git a/src/auction.ts b/src/auction.ts
new file mode 100644
--- /dev/null
+++ b/src/auction.ts
@@ -0,0 +1,3 @@
+export const auctionVenue = 'market';
+export function openAuction(state: State) { return state.venues.includes(auctionVenue); }
+const reserve = 10;
diff --git a/src/world.ts b/src/world.ts
--- a/src/world.ts
+++ b/src/world.ts
@@ -9,0 +10,1 @@
+export const auctionHouse = 'auctionHouse';
`;

describe('crossReferences', () => {
  it('lists the files both sides changed and the names one side defines or quotes that the other also touched', () => {
    const refs = crossReferences(changedSide(AUCTION_DIFF), changedSide(WORLD_DIFF));
    expect(refs.sharedFiles).toEqual(['src/world.ts']);
    expect(refs.sharedNames.map((n) => n.name)).toEqual(['market']);
    expect(refs.sharedNames[0]).toMatchObject({ branchFiles: ['src/auction.ts'], mainFiles: ['src/world.ts'] });
  });

  it('ignores tests and design files, and names nobody defines, like keywords and plain locals', () => {
    const refs = crossReferences(changedSide(AUCTION_DIFF), changedSide(WORLD_DIFF));
    const names = refs.sharedNames.map((n) => n.name);
    expect(names).not.toContain('auctionHouse'); // only a test on the other side touched it
    expect(names).not.toContain('export');
    expect(names).not.toContain('venues'); // a parameter and a property read, defined by neither
  });

  it('finds nothing between sides that share nothing', () => {
    const quests = changedSide(`diff --git a/src/quests.ts b/src/quests.ts
--- /dev/null
+++ b/src/quests.ts
@@ -0,0 +1,1 @@
+export const questBoard = 'tavern';
`);
    expect(crossReferences(quests, changedSide(AUCTION_DIFF))).toEqual({ sharedFiles: [], sharedNames: [] });
  });
});

describe('changedSideBetween reads every file name git writes in a diff header (#1712)', () => {
  // Slow one-time setup lives here, where no test timeout applies.
  const repo = tempTree('bs-cross-chunk-quoted-');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
  const QUOTED = ['src/a"b.ts', 'src/c\\d.ts', 'src/e\tf.ts', 'src/g\nh.ts', 'src/i\u0001j.ts', 'src/\u00e9t\u00e9.ts'];
  git('init', '-q');
  // Config that changes how git writes a diff, which changedSideBetween must override.
  for (const [key, value] of [['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true'], ['color.diff', 'always']]) git('config', key, value);
  mkdirSync(join(repo, 'src/x b'), { recursive: true });
  writeFileSync(join(repo, 'src/gone"x.ts'), 'export const goneVenue = 1;\n');
  writeFileSync(join(repo, 'src/venue.ts'), 'export const movedVenue = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'src/plain.ts'), 'export const plainVenue = 1;\n');
  writeFileSync(join(repo, 'src/x b/y.ts'), 'export const spacedVenue = 1;\n');
  QUOTED.forEach((name, i) => writeFileSync(join(repo, name), `export const quotedVenue${i} = 1;\n`));
  rmSync(join(repo, 'src/gone"x.ts'));
  git('mv', 'src/venue.ts', 'src/venues.ts');
  git('add', '-A');
  git('commit', '-q', '-m', 'quoted');

  it('records each file under its own name, a deleted one and both sides of a rename included', async () => {
    const side = await changedSideBetween(repo, 'HEAD~1', 'HEAD');
    const expected = [...QUOTED, 'src/gone"x.ts', 'src/plain.ts', 'src/venue.ts', 'src/venues.ts', 'src/x b/y.ts'];
    expect([...side.files].sort()).toEqual(expected.sort());
    expect([...side.names.get('plainVenue')!]).toEqual(['src/plain.ts']);
    expect([...side.names.get('spacedVenue')!]).toEqual(['src/x b/y.ts']);
    QUOTED.forEach((name, i) => expect([...side.names.get(`quotedVenue${i}`)!]).toEqual([name]));
    expect([...side.names.get('goneVenue')!]).toEqual(['src/gone"x.ts']);
    expect([...side.names.get('movedVenue')!].sort()).toEqual(['src/venue.ts', 'src/venues.ts']);
  });
});

describe('changedSideBetween reads content lines that start with ++ or -- (#1718)', () => {
  // Slow one-time setup lives here, where no test timeout applies.
  const repo = tempTree('bs-cross-chunk-prefix-');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
  git('init', '-q');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/count.ts'), 'export function close() {\n--venueCount;\n}\n');
  writeFileSync(join(repo, 'src/tally.ts'), 'export function open() {\n}\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'src/count.ts'), 'export function close() {\n}\n');
  writeFileSync(join(repo, 'src/tally.ts'), 'export function open() {\n++venueTally;\n}\n');
  writeFileSync(join(repo, 'src/empty.ts'), '');
  git('add', '-A');
  git('commit', '-q', '-m', 'prefixed');
  let side: ReturnType<typeof changedSide>;
  beforeAll(async () => {
    side = await changedSideBetween(repo, 'HEAD~1', 'HEAD');
  });

  it('records a removed --name and an added ++name in their own files, and a file with no hunks', () => {
    expect([...side.files].sort()).toEqual(['src/count.ts', 'src/empty.ts', 'src/tally.ts']);
    expect([...side.names.get('venueCount')!]).toEqual(['src/count.ts']);
    expect([...side.names.get('venueTally')!]).toEqual(['src/tally.ts']);
  });

  it('still reads a later file\'s ---/+++ lines as headers, so their path parts are not names', () => {
    expect(side.names.has('src')).toBe(false);
    expect(side.names.has('tally')).toBe(false);
  });

  it('finds the reference when that removal is the branch\'s only mention of a name main defines', () => {
    const main = changedSide(`diff --git a/src/venues.ts b/src/venues.ts
--- a/src/venues.ts
+++ b/src/venues.ts
@@ -1,0 +1,1 @@
+let venueCount = 0;
`);
    const refs = crossReferences(side, main);
    expect(refs.sharedNames.map((n) => n.name)).toContain('venueCount');
  });
});

describe('the CROSS-CHUNK.md ledger', () => {
  const refs = crossReferences(changedSide(AUCTION_DIFF), changedSide(WORLD_DIFF));

  it('appends a numbered entry the audit must rule on, pending until it does', () => {
    const text = appendCrossChunkEntry(undefined, { chunk: 'auctions', alongside: ['world'], refs });
    expect(text).toMatch(/^# Cross-Chunk References/m);
    expect(text).toMatch(/^### Merge 1$/m);
    expect(text).toContain('- Built alongside: world');
    expect(text).toContain('  - src/world.ts');
    expect(text).toContain('`market`');
    expect(text).toMatch(/^- Verdict: pending$/m);
    expect(appendCrossChunkEntry(text, { chunk: 'quests', alongside: ['world'], refs })).toMatch(/^### Merge 2$/m);
  });

  it('records a merge that shared nothing as reviewed by construction', () => {
    const text = appendCrossChunkEntry(undefined, {
      chunk: 'quests',
      alongside: ['auctions'],
      refs: { sharedFiles: [], sharedNames: [] },
    });
    expect(text).toMatch(/^- Verdict: no conflict: nothing is shared/m);
    expect(checkCrossChunkLedger(text, ['quests', 'auctions'])).toEqual([]);
  });

  it('fails a pending verdict, a verdict with no reason, and a conflict that names no chunk', () => {
    const pending = appendCrossChunkEntry(undefined, { chunk: 'auctions', alongside: ['world'], refs });
    expect(checkCrossChunkLedger(pending, ['auctions', 'world'])).toHaveLength(1);
    expect(checkCrossChunkLedger(pending, ['auctions', 'world'])[0]).toMatchObject({
      entry: 'Merge 1',
      detail: expect.stringMatching(/not been reviewed/),
    });

    const bare = pending.replace('- Verdict: pending', '- Verdict: no conflict:');
    expect(checkCrossChunkLedger(bare, ['auctions', 'world'])[0].detail).toMatch(/not a ruling/);

    const ghost = pending.replace('- Verdict: pending', '- Verdict: conflict: ghost reopened, venues vanish');
    expect(checkCrossChunkLedger(ghost, ['auctions', 'world'])[0].detail).toMatch(/no chunk ghost/);

    const ruled = pending.replace(
      '- Verdict: pending',
      '- Verdict: conflict: auctions reopened, an auction at a destroyed venue never closes',
    );
    expect(checkCrossChunkLedger(ruled, ['auctions', 'world'])).toEqual([]);
  });
});
