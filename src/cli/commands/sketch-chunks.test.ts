import { describe, it, expect } from 'vitest';
import { dependencyClosure, parseSketchChunks } from './sketch-chunks.js';

const SKETCH = `# Sketch

Session Lock: none

## Ordered Chunk List

<!-- ### example
- Depends on: nothing-real -->

### core-loop
- What it builds: the turn loop
- Citations: rulebook/01-turns.md
- Depends on: none
- Milestone: core-loop
- Status (derived from chunks/core-loop/CHUNK.md): verified

### trading
- What it builds: trading
- Citations: rulebook/04-trading.md, rulebook/05-market.md
- Depends on: core-loop
- Milestone: none
- Status (derived from chunks/trading/CHUNK.md): approved

### auctions
- What it builds: auctions
- Depends on: \`trading\`, core-loop
- Milestone: none
- Status: proposed (sketch-level — no CHUNK.md yet)

### legacy
- What it builds: something from before Depends on existed
- Milestone: none
- Status: proposed (sketch-level — no CHUNK.md yet)

## Variants (deferred)

### not-a-chunk
`;

describe('parseSketchChunks', () => {
  it('reads every Ordered Chunk List entry in order, and nothing outside the list or in a comment', () => {
    expect(parseSketchChunks(SKETCH).map((c) => c.slug)).toEqual(['core-loop', 'trading', 'auctions', 'legacy']);
  });

  it('reads the fields parallel dispatch decides on', () => {
    const [core, trading, auctions, legacy] = parseSketchChunks(SKETCH);
    expect(core).toMatchObject({ dependsOn: [], milestone: 'core-loop', status: 'verified' });
    expect(trading).toMatchObject({
      citations: 'rulebook/04-trading.md, rulebook/05-market.md',
      dependsOn: ['core-loop'],
      status: 'approved',
    });
    expect(auctions.dependsOn).toEqual(['trading', 'core-loop']);
    expect(auctions.status).toBe('proposed (sketch-level — no CHUNK.md yet)');
    expect(legacy.dependsOn).toBeUndefined();
  });
});

describe('dependencyClosure', () => {
  it('follows Depends on transitively', () => {
    const chunks = parseSketchChunks(SKETCH);
    expect([...dependencyClosure(chunks, 'auctions')].sort()).toEqual(['core-loop', 'trading']);
  });

  it('treats an entry with no Depends on line as depending on every chunk before it', () => {
    const chunks = parseSketchChunks(SKETCH);
    expect([...dependencyClosure(chunks, 'legacy')].sort()).toEqual(['auctions', 'core-loop', 'trading']);
  });
});
