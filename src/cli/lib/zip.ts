import { crc32, deflateRawSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { listFiles } from './source-files.js';

/**
 * Read a boardsmith build dist/ directory and produce a zip-ready file map.
 *
 * Layout remapping:
 *   manifest.json   -> boardsmith.json
 *   rules/rules.js  -> rules.js
 *   rules/**        -> (keep relative to rules/)
 *   ui/**           -> (strip ui/ prefix)
 *   (root dirs)     -> public assets at dist root (equipment/, etc.)
 */

/**
 * WHICH ENTRY AND WHICH SEAT COUNT ARE THE BACKEND'S TO SAY (#188).
 *
 * `readDistDir` was written when every game had a table, so it demanded
 * `ui/index.html` and a `playerCount` of everything. `boardsmith build` emits
 * `ui/world.html` for a world and deliberately omits `playerCount`, which is
 * how a manifest says "this game has no table" -- so the whole world half of
 * the catalogue built and validated cleanly and then died in packaging.
 * `validate.ts` was already backend-aware; this was the one place left that
 * was not.
 */
function assertBackendIsPackageable(distDir: string, manifest: Record<string, unknown>): void {
  const backend = manifest.backend;
  if (backend !== 'table' && backend !== 'world') {
    throw new Error(
      'manifest.json must declare a backend of "table" or "world". ' +
        `Got: ${JSON.stringify(backend)}. Rebuild with \`boardsmith build\`.`,
    );
  }

  const entry = backend === 'world' ? 'world.html' : 'index.html';
  if (!existsSync(join(distDir, 'ui', entry))) {
    throw new Error(`ui/${entry} not found in dist directory. Run \`boardsmith build\` first.`);
  }

  assertSeatCount(backend, manifest);
}

/**
 * A table declares a RANGE it must fill to start; a world declares the one
 * ceiling it never exceeds. A world does not start, so it has no minimum to
 * reach, which is why `world.maxPlayers` is the only number it carries.
 */
function assertSeatCount(backend: 'table' | 'world', manifest: Record<string, unknown>): void {
  if (backend === 'table') {
    const seats = manifest.playerCount as { min?: number; max?: number } | undefined;
    if (seats?.min && seats?.max) return;
    throw new Error(
      `manifest.json must contain playerCount with min and max fields. Got: ${JSON.stringify(seats)}`,
    );
  }

  const world = manifest.world as { maxPlayers?: number } | undefined;
  if (world?.maxPlayers) return;
  throw new Error(
    `manifest.json must contain world.maxPlayers for a world backend. Got: ${JSON.stringify(world)}`,
  );
}

export function readDistDir(distDir: string): Map<string, Uint8Array> {
  if (!existsSync(distDir)) {
    throw new Error(`dist directory not found: ${distDir}\nRun \`boardsmith build\` first.`);
  }

  const manifestPath = join(distDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('manifest.json not found in dist directory. Run `boardsmith build` first.');
  }

  const rulesPath = join(distDir, 'rules', 'rules.js');
  if (!existsSync(rulesPath)) {
    throw new Error('rules/rules.js not found in dist directory. Run `boardsmith build` first.');
  }
  if (readFileSync(rulesPath).length === 0) {
    throw new Error('rules/rules.js is empty. Build may have failed.');
  }

  const manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  assertBackendIsPackageable(distDir, manifestData);

  const fileMap = new Map<string, Uint8Array>();

  // manifest.json -> boardsmith.json
  fileMap.set('boardsmith.json', readFileSync(manifestPath));

  // rules/rules.js -> rules.js (at zip root)
  fileMap.set('rules.js', readFileSync(rulesPath));

  // Other files under rules/ (e.g., static assets)
  collectFiles(join(distDir, 'rules'), fileMap, 'rules.js');

  // All files under ui/ -> strip ui/ prefix
  collectFiles(join(distDir, 'ui'), fileMap);

  // Public assets at dist root (equipment/, dictators/, etc.), keeping their paths;
  // the known build subdirectories and manifest.json were taken above
  for (const absPath of listFiles(distDir, { sourceTree: false })) {
    const relPath = relative(distDir, absPath);
    if (relPath === 'manifest.json' || ['rules', 'ui'].includes(relPath.split(sep)[0]!)) continue;
    if (!fileMap.has(relPath)) fileMap.set(relPath, readFileSync(absPath));
  }

  return fileMap;
}

function collectFiles(
  dir: string,
  fileMap: Map<string, Uint8Array>,
  skipRelPath?: string,
): void {
  for (const absPath of listFiles(dir, { sourceTree: false })) {
    const relPath = relative(dir, absPath);
    if (relPath === skipRelPath) continue;
    if (!fileMap.has(relPath)) {
      fileMap.set(relPath, readFileSync(absPath));
    }
  }
}

// -- Minimal zip builder (binary-safe) --

/** General purpose flag bit 11: entry names are UTF-8, as TextEncoder writes them. */
const UTF8_NAME = 0x0800;

export function createZip(files: Map<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: {
    name: Uint8Array;
    compressed: Uint8Array;
    uncompressedSize: number;
    crc: number;
    offset: number;
  }[] = [];

  let offset = 0;
  const parts: Uint8Array[] = [];

  for (const [filename, content] of files) {
    // The zip format allows only forward slashes, and a Windows build hands us backslash paths.
    const nameBytes = encoder.encode(filename.replaceAll('\\', '/'));
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    // Local file header (30 bytes + name + compressed data)
    const header = new ArrayBuffer(30);
    const hv = new DataView(header);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, UTF8_NAME, true);
    hv.setUint16(8, 8, true); // deflate
    hv.setUint16(10, 0, true);
    hv.setUint16(12, 0, true);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, compressed.length, true);
    hv.setUint32(22, content.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);

    entries.push({ name: nameBytes, compressed, uncompressedSize: content.length, crc, offset });

    const headerBytes = new Uint8Array(header);
    parts.push(headerBytes, nameBytes, compressed);
    offset += headerBytes.length + nameBytes.length + compressed.length;
  }

  // Central directory
  const centralStart = offset;
  for (const entry of entries) {
    const cdh = new ArrayBuffer(46);
    const cv = new DataView(cdh);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, UTF8_NAME, true);
    cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, entry.crc, true);
    cv.setUint32(20, entry.compressed.length, true);
    cv.setUint32(24, entry.uncompressedSize, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, entry.offset, true);

    parts.push(new Uint8Array(cdh), entry.name);
    offset += 46 + entry.name.length;
  }

  const centralSize = offset - centralStart;

  // End of central directory
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

/** A byte count as people read it: `512 B`, `3.4 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
