/** Image files just long enough for a header reader: the headers are real, the pixel data is not. */

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return u32be(value).reverse();
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/** `bytes` padded with zeros to `size`, when one is given. */
function sized(bytes: number[], size?: number): Uint8Array {
  const out = new Uint8Array(Math.max(size ?? 0, bytes.length));
  out.set(bytes);
  return out;
}

/** A PNG chunk; the reader never checks the CRC, so it is zero. */
function chunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

const COLOUR_TYPE = { 'grey-alpha': 4, rgba: 6, rgb: 2, 'palette-trns': 3 } as const;

export function pngBytes(width: number, height: number, kind: keyof typeof COLOUR_TYPE, size?: number): Uint8Array {
  return sized(
    [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', [...u32be(width), ...u32be(height), 8, COLOUR_TYPE[kind], 0, 0, 0]),
      ...(kind === 'palette-trns' ? [...chunk('PLTE', [0, 0, 0]), ...chunk('tRNS', [0])] : []),
      ...chunk('IDAT', [0]),
      ...chunk('IEND', []),
    ],
    size,
  );
}

/** A JPEG with an APP0 segment before its baseline frame header, as most encoders write it. */
export function jpegBytes(width: number, height: number, size?: number): Uint8Array {
  return sized(
    [
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
      0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
      0xff, 0xd9,
    ],
    size,
  );
}

export function webpBytes(width: number, height: number, kind: 'VP8 ' | 'VP8L' | 'VP8X', size?: number): Uint8Array {
  let data: number[];
  if (kind === 'VP8 ') {
    data = [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8];
  } else if (kind === 'VP8L') {
    const bits = (width - 1) | ((height - 1) << 14);
    data = [0x2f, ...u32le(bits >>> 0)];
  } else {
    data = [0x10, 0, 0, 0, ...u32le(width - 1).slice(0, 3), ...u32le(height - 1).slice(0, 3)];
  }
  const body = [...ascii('WEBP'), ...ascii(kind), ...u32le(data.length), ...data];
  return sized([...ascii('RIFF'), ...u32le(body.length), ...body], size);
}
