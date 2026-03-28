import { deflateRawSync } from 'node:zlib';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

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

  const uiIndexPath = join(distDir, 'ui', 'index.html');
  if (!existsSync(uiIndexPath)) {
    throw new Error('ui/index.html not found in dist directory. Run `boardsmith build` first.');
  }

  const manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (!manifestData.playerCount?.min || !manifestData.playerCount?.max) {
    throw new Error(
      `manifest.json must contain playerCount with min and max fields. Got: ${JSON.stringify(manifestData.playerCount)}`
    );
  }

  const fileMap = new Map<string, Uint8Array>();

  // manifest.json -> boardsmith.json
  fileMap.set('boardsmith.json', readFileSync(manifestPath));

  // rules/rules.js -> rules.js (at zip root)
  fileMap.set('rules.js', readFileSync(rulesPath));

  // Other files under rules/ (e.g., static assets)
  collectFiles(join(distDir, 'rules'), fileMap, 'rules.js');

  // All files under ui/ -> strip ui/ prefix
  collectFiles(join(distDir, 'ui'), fileMap);

  // Public assets at dist root (equipment/, dictators/, etc.)
  // Skip known build subdirectories and manifest.json
  const skipRootEntries = new Set(['rules', 'ui', 'manifest.json']);
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (skipRootEntries.has(entry.name)) continue;
    const fullPath = join(distDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, fileMap, undefined, entry.name);
    } else if (!fileMap.has(entry.name)) {
      fileMap.set(entry.name, readFileSync(fullPath));
    }
  }

  return fileMap;
}

function collectFiles(
  dir: string,
  fileMap: Map<string, Uint8Array>,
  skipRelPath?: string,
  prefix?: string,
): void {
  if (!existsSync(dir)) return;

  for (const absPath of readdirRecursive(dir)) {
    const relPath = relative(dir, absPath);
    if (relPath === skipRelPath) continue;
    const zipPath = prefix ? `${prefix}/${relPath}` : relPath;
    if (!fileMap.has(zipPath)) {
      fileMap.set(zipPath, readFileSync(absPath));
    }
  }
}

function readdirRecursive(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else results.push(fullPath);
    }
  }
  walk(dir);
  return results;
}

// -- Minimal zip builder (binary-safe) --

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

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
    const nameBytes = encoder.encode(filename);
    const compressed = deflateRawSync(content);
    const crc = crc32(content);

    // Local file header (30 bytes + name + compressed data)
    const header = new ArrayBuffer(30);
    const hv = new DataView(header);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0, true);
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
    cv.setUint16(8, 0, true);
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
