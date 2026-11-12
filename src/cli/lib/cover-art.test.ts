import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { pngBytes, jpegBytes, webpBytes } from './cover-art.test-helper.js';
import { COVER_ART, coverArtBundlePath, coverArtPaths, coverArtProblems, readImageHeader } from './cover-art.js';
import schema from './boardsmith.schema.json';

describe('readImageHeader', () => {
  it('reads a PNG\'s size, and its alpha from the colour type', () => {
    expect(readImageHeader(pngBytes(1500, 1500, 'rgba'))).toEqual({ format: 'png', width: 1500, height: 1500, alpha: true });
    expect(readImageHeader(pngBytes(16, 9, 'grey-alpha'))).toEqual({ format: 'png', width: 16, height: 9, alpha: true });
    expect(readImageHeader(pngBytes(280, 280, 'rgb'))).toEqual({ format: 'png', width: 280, height: 280, alpha: false });
  });

  it('counts a PNG\'s tRNS chunk as alpha, as an optimised palette PNG carries it', () => {
    expect(readImageHeader(pngBytes(280, 280, 'palette-trns'))?.alpha).toBe(true);
  });

  it('reads a JPEG\'s size from its frame header, past the segments before it', () => {
    expect(readImageHeader(jpegBytes(1500, 500))).toEqual({ format: 'jpeg', width: 1500, height: 500, alpha: false });
  });

  it('reads each kind of WebP', () => {
    for (const kind of ['VP8 ', 'VP8L', 'VP8X'] as const) {
      expect(readImageHeader(webpBytes(1500, 500, kind))).toMatchObject({ format: 'webp', width: 1500, height: 500 });
    }
  });

  it('answers undefined for bytes that are none of the three, whatever the file is called', () => {
    expect(readImageHeader(new TextEncoder().encode('GIF89a not an image we take'))).toBeUndefined();
    expect(readImageHeader(new Uint8Array(0))).toBeUndefined();
    expect(readImageHeader(pngBytes(1, 1, 'rgba').subarray(0, 20))).toBeUndefined();
  });
});

describe('coverArtBundlePath', () => {
  it('normalises a path relative to the project, which is where the bundle carries it', () => {
    expect(coverArtBundlePath('logo', './art/../art/logo.png')).toBe('art/logo.png');
  });

  it('refuses a path the bundle could not carry at the same place, saying what to do', () => {
    for (const declared of ['/abs/logo.png', '../logo.png', 'art/../../logo.png', 'ui/logo.png', 'rules/logo.png', '', '.', 7]) {
      expect(() => coverArtBundlePath('logo', declared)).toThrow(/boardsmith\.json "logo"/);
    }
  });

  it('collects every declared field, and none for a game that declares no art', () => {
    expect(coverArtPaths({ name: 'x', backdrop: './art/b.jpg', box: 'art/box.png' })).toEqual({
      backdrop: 'art/b.jpg',
      box: 'art/box.png',
    });
    expect(coverArtPaths({ name: 'x' })).toEqual({});
  });
});

describe('the schema', () => {
  it('declares each cover-art field as an asset path the Convex sink does not read', () => {
    for (const key of Object.keys(COVER_ART)) {
      expect(schema.properties).toHaveProperty(key);
      const property = (schema.properties as Record<string, Record<string, unknown>>)[key];
      expect(property['x-asset-path']).toBe(true);
      expect(property['x-convex-sink']).toBe(false);
    }
    expect(Object.keys(COVER_ART).sort()).toEqual(['backdrop', 'box', 'logo']);
  });
});

describe('coverArtProblems', () => {
  function project(files: Record<string, Uint8Array>): string {
    const dir = tempTree('boardsmith-cover-art-');
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), bytes);
    }
    return dir;
  }

  const good = {
    'art/backdrop.webp': webpBytes(1500, 500, 'VP8 '),
    'art/logo.png': pngBytes(1500, 1500, 'rgba'),
    'art/box.png': pngBytes(280, 280, 'palette-trns'),
  };
  const declared = { backdrop: 'art/backdrop.webp', logo: 'art/logo.png', box: 'art/box.png' };

  it('passes art within the spec, and a game that declares none', () => {
    expect(coverArtProblems(project(good), declared)).toEqual([]);
    expect(coverArtProblems(project({}), { name: 'x' })).toEqual([]);
  });

  it('leaves a missing file to the Asset Paths check, which already names it', () => {
    expect(coverArtProblems(project({}), declared)).toEqual([]);
  });

  it('refuses a wrong size, naming the size it has and the one it needs', () => {
    const [problem] = coverArtProblems(project({ 'logo.png': pngBytes(1400, 1500, 'rgba') }), { logo: 'logo.png' });
    expect(problem).toContain('1400 x 1500');
    expect(problem).toContain('exactly 1500 x 1500');
  });

  it('refuses a wrong format read from the header, not the extension', () => {
    const [problem] = coverArtProblems(project({ 'backdrop.jpg': pngBytes(1500, 500, 'rgb') }), { backdrop: 'backdrop.jpg' });
    expect(problem).toContain('is a PNG');
    expect(problem).toContain('JPEG or WebP');
  });

  it('refuses a file that is no image at all', () => {
    const [problem] = coverArtProblems(project({ 'box.png': new TextEncoder().encode('hello') }), { box: 'box.png' });
    expect(problem).toContain('not a PNG, JPEG or WebP image');
  });

  it('refuses a logo or box with no transparency', () => {
    const [problem] = coverArtProblems(project({ 'box.png': pngBytes(280, 280, 'rgb') }), { box: 'box.png' });
    expect(problem).toContain('transparen');
  });

  it('refuses a file over its byte budget, in the units the budget is stated in', () => {
    const big = webpBytes(1500, 500, 'VP8X', 400 * 1024 + 1);
    const [problem] = coverArtProblems(project({ 'b.webp': big }), { backdrop: 'b.webp' });
    expect(problem).toContain('at most 400 KB (409,600 bytes)');
    expect(coverArtProblems(project({ 'b.webp': webpBytes(1500, 500, 'VP8X', 400 * 1024) }), { backdrop: 'b.webp' })).toEqual([]);
  });

  it('refuses a path the bundle cannot carry', () => {
    const [problem] = coverArtProblems(project({}), { logo: '../logo.png' });
    expect(problem).toContain('boardsmith.json "logo"');
  });
});
