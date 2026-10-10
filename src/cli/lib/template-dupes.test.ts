import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { templateScan, type JscpdReport } from './template-dupes.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * #596: jscpd reports clone PAIRS with line ranges into `.vue` blocks. The
 * gate keys them by the text of both instances, read from the source, and
 * leaves script blocks to fallow, which already scans them.
 */
describe('templateScan', () => {
  function tree(): string {
    const dir = tempTree('bs-template-scan-');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'A.vue'), ['<template>', '  <p>one</p>', '  <p>two</p>', '</template>'].join('\n'));
    writeFileSync(join(dir, 'src', 'B.vue'), ['<template>', '  <i/>', '  <p>one</p>', '  <p>two</p>', '</template>'].join('\n'));
    return dir;
  }

  const clone = (format: string): JscpdReport['duplicates'][number] => ({
    format,
    lines: 2,
    firstFile: { name: `A.vue:${format}`, start: 2, end: 3 },
    secondFile: { name: `B.vue:${format}`, start: 3, end: 4 },
  });

  it('turns a template clone into a group of both instances, read from the source', () => {
    const scan = templateScan({ duplicates: [clone('html')] }, tree());
    expect(scan.clone_groups).toEqual([
      {
        line_count: 2,
        instances: [
          { file: 'src/A.vue', start_line: 2, end_line: 3, fragment: '  <p>one</p>\n  <p>two</p>' },
          { file: 'src/B.vue', start_line: 3, end_line: 4, fragment: '  <p>one</p>\n  <p>two</p>' },
        ],
      },
    ]);
  });

  it('keeps style clones and drops script-block clones, which fallow already gates', () => {
    const scan = templateScan(
      { duplicates: [clone('css'), clone('typescript'), clone('javascript'), clone('tsx'), clone('jsx')] },
      tree(),
    );
    expect(scan.clone_groups).toHaveLength(1);
  });
});
