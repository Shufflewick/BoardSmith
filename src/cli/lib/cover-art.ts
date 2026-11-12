/**
 * A game's cover art: the `backdrop`, `logo` and `box` fields of `boardsmith.json` (#1630).
 *
 * Each names one file, by a path relative to the project, that `boardsmith build` copies into the
 * bundle at that same path, so the manifest's value is also where the bundle carries it. The spec
 * below mirrors ShufflewickPub's game art spec (GAME-ART.md there), which it checks again on upload.
 * The platform makes every smaller size itself, so nothing here resizes.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, posix, resolve } from 'node:path';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface ImageHeader {
  format: ImageFormat;
  width: number;
  height: number;
  alpha: boolean;
}

interface ArtSpec {
  width: number;
  height: number;
  formats: readonly ImageFormat[];
  /** Whether the image must carry transparency. */
  alpha: boolean;
  maxBytes: number;
}

const KB = 1024;

export const COVER_ART: Readonly<Record<'backdrop' | 'logo' | 'box', ArtSpec>> = {
  backdrop: { width: 1500, height: 500, formats: ['jpeg', 'webp'], alpha: false, maxBytes: 400 * KB },
  logo: { width: 1500, height: 1500, formats: ['png'], alpha: true, maxBytes: 1024 * KB },
  box: { width: 280, height: 280, formats: ['png'], alpha: true, maxBytes: 1024 * KB },
};

const FORMAT_NAME: Record<ImageFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function readPng(bytes: Uint8Array, view: DataView): ImageHeader | undefined {
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return undefined;
  if (ascii(bytes, 12, 4) !== 'IHDR') return undefined;
  const colourType = bytes[25];
  let alpha = colourType === 4 || colourType === 6;
  // A tRNS chunk, which comes before the first IDAT, gives a grey, RGB or palette PNG its transparency.
  for (let at = 33; !alpha && at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
    const type = ascii(bytes, at + 4, 4);
    if (type === 'IDAT') break;
    alpha = type === 'tRNS';
  }
  return { format: 'png', width: view.getUint32(16), height: view.getUint32(20), alpha };
}

/** Whether a JPEG marker starts a frame header (SOF0-SOF15), which carries the image size. */
function isFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(bytes: Uint8Array, view: DataView): ImageHeader | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let at = 2; at + 9 <= bytes.length; at += 2 + view.getUint16(at + 2)) {
    if (bytes[at] !== 0xff) return undefined;
    if (isFrameMarker(bytes[at + 1])) {
      return { format: 'jpeg', width: view.getUint16(at + 7), height: view.getUint16(at + 5), alpha: false };
    }
  }
  return undefined;
}

function readWebp(bytes: Uint8Array, view: DataView): ImageHeader | undefined {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined;
  const kind = ascii(bytes, 12, 4);
  if (kind === 'VP8 ' && bytes.length >= 30) {
    return { format: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, alpha: false };
  }
  if (kind === 'VP8L' && bytes.length >= 25) {
    const bits = view.getUint32(21, true);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 };
  }
  if (kind === 'VP8X' && bytes.length >= 30) {
    const width = (view.getUint32(24, true) & 0xffffff) + 1;
    const height = (view.getUint32(26, true) >>> 8) + 1;
    return { format: 'webp', width, height, alpha: (bytes[20] & 0x10) !== 0 };
  }
  return undefined;
}

/** The format, size and transparency an image's header states, or undefined for anything not a PNG, JPEG or WebP. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return readPng(bytes, view) ?? readJpeg(bytes, view) ?? readWebp(bytes, view);
}

/** The packer moves ui/ to the bundle root and rules/ beside rules.js, and build empties dist/ first. */
const REPLACED_FOLDERS = new Set(['ui', 'rules', 'dist']);

/** Why the bundle could not carry `declared` at its own path, or undefined when it can. */
function bundlePathRefusal(declared: unknown): string | undefined {
  if (typeof declared !== 'string' || declared === '') return 'is not a path';
  if (declared.includes('\\')) return 'has a backslash; separate folders with "/"';
  if (isAbsolute(declared)) return 'is an absolute path';
  const path = posix.normalize(declared);
  if (path === '.' || path === '..' || path.startsWith('../')) return 'is not inside the project';
  // Lower-cased because a case-insensitive disk opens UI/ as ui/.
  const top = path.split('/')[0].toLowerCase();
  return REPLACED_FOLDERS.has(top) ? `is under ${top}/, which the build replaces` : undefined;
}

/**
 * Where the bundle carries a declared art file: its path relative to the project, normalised.
 * Throws for a path the bundle could not carry at that same place.
 */
export function coverArtBundlePath(key: string, declared: unknown): string {
  const refusal = bundlePathRefusal(declared);
  if (refusal !== undefined) {
    throw new Error(
      `boardsmith.json "${key}": ${JSON.stringify(declared)} ${refusal}. Name a file inside the project, such as "art/${key}.png".`,
    );
  }
  return posix.normalize(declared as string);
}

/** The bundle path of each cover-art field `config` declares. */
export function coverArtPaths(config: Record<string, unknown>): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const key of Object.keys(COVER_ART)) {
    if (config[key] !== undefined) paths[key] = coverArtBundlePath(key, config[key]);
  }
  return paths;
}

function bytesLabel(bytes: number): string {
  return `${Math.ceil(bytes / KB).toLocaleString('en-US')} KB (${bytes.toLocaleString('en-US')} bytes)`;
}

function describeFormats(formats: readonly ImageFormat[]): string {
  return formats.map((format) => FORMAT_NAME[format]).join(' or ');
}

function artFileProblems(key: string, spec: ArtSpec, path: string, bytes: Uint8Array): string[] {
  const where = `boardsmith.json "${key}": ${path}`;
  const header = readImageHeader(bytes);
  if (header === undefined) {
    return [`${where} is not a PNG, JPEG or WebP image. A ${key} must be a ${describeFormats(spec.formats)} file; export it as one.`];
  }
  const problems: string[] = [];
  if (!spec.formats.includes(header.format)) {
    problems.push(`${where} is a ${FORMAT_NAME[header.format]}. A ${key} must be a ${describeFormats(spec.formats)} file; export it as one.`);
  } else if (spec.alpha && !header.alpha) {
    problems.push(`${where} has no transparency. A ${key} must be a PNG with an alpha channel; export it with a transparent background.`);
  }
  if (header.width !== spec.width || header.height !== spec.height) {
    problems.push(
      `${where} is ${header.width} x ${header.height}. A ${key} must be exactly ${spec.width} x ${spec.height}; ` +
        'export it at that size, and the platform makes every smaller size itself.',
    );
  }
  if (bytes.length > spec.maxBytes) {
    problems.push(`${where} is ${bytesLabel(bytes.length)}. A ${key} may be at most ${bytesLabel(spec.maxBytes)}; compress it.`);
  }
  return problems;
}

/**
 * Every way the cover art `config` declares is outside the spec. A file that does not exist is left
 * to the Asset Paths check, which names every declared asset path that resolves to nothing.
 */
export function coverArtProblems(cwd: string, config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(COVER_ART)) {
    if (config[key] === undefined) continue;
    let path: string;
    try {
      path = coverArtBundlePath(key, config[key]);
    } catch (error) {
      problems.push((error as Error).message);
      continue;
    }
    const file = resolve(cwd, path);
    if (!existsSync(file)) continue;
    if (!statSync(file).isFile()) {
      problems.push(`boardsmith.json "${key}": ${path} is a folder, not a file. Name the image file itself.`);
      continue;
    }
    problems.push(...artFileProblems(key, spec, path, readFileSync(file)));
  }
  return problems;
}
