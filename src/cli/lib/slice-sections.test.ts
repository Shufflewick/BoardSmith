import { describe, it, expect } from 'vitest';
import { sectionsNamed, sliceSections } from './slice-sections.js';

/**
 * #415: the unit two chunks can conflict over is a SECTION of a rulebook slice, not the whole
 * slice. A section starts at a Markdown heading, or at a transcription citation prefix
 * (`p.2, Designer Decisions > Battlefield:`) whose name differs from the section in force.
 */

const DECISIONS = [
  '# Designer Decisions (p.2)', //                      1
  '', //                                                2
  'Source: rulebook/source/REQUIREMENTS.md', //         3
  '', //                                                4
  'p.2, Designer Decisions > Battlefield:', //          5
  '- The board is 60 by 30 spaces.', //                 6
  '', //                                                7
  'Derived (p.2): No player deploys in the strip.', //  8
  '', //                                                9
  'p.2, Designer Decisions > Economy:', //             10
  '- Income goes up by 200 each round.', //            11
  '', //                                               12
  '## Unit Schedules', //                              13
  '', //                                               14
  '### Crawler', //                                    15
  '| 263 | 79 |', //                                   16
].join('\n');

describe('sliceSections', () => {
  it('divides a slice at headings and at each change of citation prefix', () => {
    expect(sliceSections(DECISIONS).map((s) => [s.name, s.from, s.to])).toEqual([
      ['Designer Decisions (p.2)', 1, 4],
      ['Designer Decisions > Battlefield', 5, 9],
      ['Designer Decisions > Economy', 10, 12],
      ['Unit Schedules', 13, 14],
      ['Crawler', 15, 16],
    ]);
  });

  it('keeps a run of inline-prefixed quote lines under one name as one section', () => {
    const text = [
      '# Units (p.8)',
      'p.8, Units > Crawler: Role: fastest ground swarm.',
      'p.8, Units > Crawler: Stats: 100 cost.',
      'p.8, Units > Fang: Role: cheap ranged chaff.',
      'p.1, Match End: Best of 7 Games:',
    ].join('\n');
    expect(sliceSections(text).map((s) => [s.name, s.from, s.to])).toEqual([
      ['Units (p.8)', 1, 1],
      ['Units > Crawler', 2, 3],
      ['Units > Fang', 4, 4],
      ['Match End: Best of 7 Games', 5, 5],
    ]);
  });

  it('starts a new section at a prefix after a heading even when it repeats an earlier prefix', () => {
    const text = ['# Battlefield (p.5)', 'p.5, Battlefield:', 'intro', '## Towers', 'p.5, Battlefield:', 'two towers'].join('\n');
    expect(sliceSections(text).map((s) => [s.name, s.from, s.to])).toEqual([
      ['Battlefield (p.5)', 1, 1],
      ['Battlefield', 2, 3],
      ['Towers', 4, 4],
      ['Battlefield', 5, 6],
    ]);
  });

  it('gives lines above the first heading or prefix a section of their own', () => {
    expect(sliceSections('loose text\n# Title\n').map((s) => [s.name, s.from, s.to])).toEqual([
      ['', 1, 1],
      ['Title', 2, 2],
    ]);
  });
});

describe('sectionsNamed', () => {
  const sections = sliceSections(DECISIONS);

  it('names a prefix section by its prefix, without the page', () => {
    expect(sectionsNamed(sections, 'Designer Decisions > Economy').map((s) => s.from)).toEqual([10]);
  });

  it('names a heading section together with every section under that heading', () => {
    expect(sectionsNamed(sections, 'Unit Schedules').map((s) => s.name)).toEqual(['Unit Schedules', 'Crawler']);
    expect(sectionsNamed(sections, 'Designer Decisions (p.2)')).toHaveLength(5);
  });

  it('names nothing for a name that is no section', () => {
    expect(sectionsNamed(sections, 'Economy')).toEqual([]);
  });
});
