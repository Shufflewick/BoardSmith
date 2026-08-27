/**
 * Typed-array encoding for serialized game state.
 *
 * A typed array is the natural representation for bulk data in state — a terrain
 * map, a fog-of-war mask, a visited-sector bitmap — so it must survive a snapshot
 * round-trip with both its type and its size intact. Encoded as a tagged shape
 * mirroring the existing `{ __elementRef }` / `{ __map }` conventions:
 *
 * ```json
 * { "__typedArray": "Uint8Array", "data": "AQIDBA==" }
 * ```
 *
 * Two properties this encoding guarantees, both of which the obvious
 * `Array.from(value)` encoding does not:
 *
 * - **Compact.** base64 is 4 characters per 3 bytes. `Array.from` is one JSON
 *   number per *element* (up to ~4 characters per byte for `Uint8Array`), and the
 *   game tree is multiplied by the checkpoint window and by every per-seat view.
 * - **Host-independent.** Multi-byte elements are written explicitly
 *   little-endian rather than copying the raw buffer, whose byte order is the
 *   host's. A snapshot produced by the executor, the dev host and the browser is
 *   byte-identical, so it can be compared, cached and replayed across them.
 *
 * base64 is hand-rolled rather than delegated to `btoa`/`Buffer` because this code
 * is vendored into three different runtimes (Node, browser, Cloudflare Workers)
 * and `String.fromCharCode(...bytes)` — the usual `btoa` bridge — overflows the
 * call stack on exactly the large arrays this encoding exists to support.
 */

/** Element accessors for one typed-array type, always little-endian. */
type TypedArrayCodec = {
  readonly bytesPerElement: number;
  /** Allocate an instance with `length` elements. */
  readonly allocate: (length: number) => ArrayBufferView & { length: number };
  /** Write element `i` of `source` into `view` at `offset`, little-endian. */
  readonly write: (view: DataView, offset: number, source: ArrayBufferView, index: number) => void;
  /** Read a little-endian element from `view` at `offset` into `target[index]`. */
  readonly read: (view: DataView, offset: number, target: ArrayBufferView, index: number) => void;
};

/**
 * The typed-array types we encode, keyed by constructor name — which is exactly
 * what `value.constructor.name` yields, so the tag is self-describing.
 */
const CODECS: Readonly<Record<string, TypedArrayCodec>> = {
  Int8Array: {
    bytesPerElement: 1,
    allocate: (n) => new Int8Array(n),
    write: (v, o, s, i) => v.setInt8(o, (s as Int8Array)[i]),
    read: (v, o, t, i) => { (t as Int8Array)[i] = v.getInt8(o); },
  },
  Uint8Array: {
    bytesPerElement: 1,
    allocate: (n) => new Uint8Array(n),
    write: (v, o, s, i) => v.setUint8(o, (s as Uint8Array)[i]),
    read: (v, o, t, i) => { (t as Uint8Array)[i] = v.getUint8(o); },
  },
  Uint8ClampedArray: {
    bytesPerElement: 1,
    allocate: (n) => new Uint8ClampedArray(n),
    write: (v, o, s, i) => v.setUint8(o, (s as Uint8ClampedArray)[i]),
    read: (v, o, t, i) => { (t as Uint8ClampedArray)[i] = v.getUint8(o); },
  },
  Int16Array: {
    bytesPerElement: 2,
    allocate: (n) => new Int16Array(n),
    write: (v, o, s, i) => v.setInt16(o, (s as Int16Array)[i], true),
    read: (v, o, t, i) => { (t as Int16Array)[i] = v.getInt16(o, true); },
  },
  Uint16Array: {
    bytesPerElement: 2,
    allocate: (n) => new Uint16Array(n),
    write: (v, o, s, i) => v.setUint16(o, (s as Uint16Array)[i], true),
    read: (v, o, t, i) => { (t as Uint16Array)[i] = v.getUint16(o, true); },
  },
  Int32Array: {
    bytesPerElement: 4,
    allocate: (n) => new Int32Array(n),
    write: (v, o, s, i) => v.setInt32(o, (s as Int32Array)[i], true),
    read: (v, o, t, i) => { (t as Int32Array)[i] = v.getInt32(o, true); },
  },
  Uint32Array: {
    bytesPerElement: 4,
    allocate: (n) => new Uint32Array(n),
    write: (v, o, s, i) => v.setUint32(o, (s as Uint32Array)[i], true),
    read: (v, o, t, i) => { (t as Uint32Array)[i] = v.getUint32(o, true); },
  },
  Float32Array: {
    bytesPerElement: 4,
    allocate: (n) => new Float32Array(n),
    write: (v, o, s, i) => v.setFloat32(o, (s as Float32Array)[i], true),
    read: (v, o, t, i) => { (t as Float32Array)[i] = v.getFloat32(o, true); },
  },
  Float64Array: {
    bytesPerElement: 8,
    allocate: (n) => new Float64Array(n),
    write: (v, o, s, i) => v.setFloat64(o, (s as Float64Array)[i], true),
    read: (v, o, t, i) => { (t as Float64Array)[i] = v.getFloat64(o, true); },
  },
  BigInt64Array: {
    bytesPerElement: 8,
    allocate: (n) => new BigInt64Array(n),
    write: (v, o, s, i) => v.setBigInt64(o, (s as BigInt64Array)[i], true),
    read: (v, o, t, i) => { (t as BigInt64Array)[i] = v.getBigInt64(o, true); },
  },
  BigUint64Array: {
    bytesPerElement: 8,
    allocate: (n) => new BigUint64Array(n),
    write: (v, o, s, i) => v.setBigUint64(o, (s as BigUint64Array)[i], true),
    read: (v, o, t, i) => { (t as BigUint64Array)[i] = v.getBigUint64(o, true); },
  },
};

/** The serialized shape a typed array takes in game state. */
export type SerializedTypedArray = {
  __typedArray: string;
  data: string;
};

/** Every typed-array type name this codec can encode, for error messages. */
export const SUPPORTED_TYPED_ARRAYS: readonly string[] = Object.keys(CODECS);

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup for {@link BASE64_ALPHABET}; -1 for any non-alphabet code unit. */
const BASE64_VALUES: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encode bytes as standard (padded) base64. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      BASE64_ALPHABET[(chunk >> 6) & 63] +
      BASE64_ALPHABET[chunk & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const chunk = bytes[i] << 16;
    out += BASE64_ALPHABET[(chunk >> 18) & 63] + BASE64_ALPHABET[(chunk >> 12) & 63] + '==';
  } else if (remaining === 2) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      BASE64_ALPHABET[(chunk >> 18) & 63] +
      BASE64_ALPHABET[(chunk >> 12) & 63] +
      BASE64_ALPHABET[(chunk >> 6) & 63] +
      '=';
  }
  return out;
}

/** Decode standard (padded) base64. Throws on anything malformed. */
function base64ToBytes(text: string, describe: () => string): Uint8Array {
  if (text.length % 4 !== 0) {
    throw new Error(`${describe()}: base64 payload length ${text.length} is not a multiple of 4.`);
  }
  let padding = 0;
  if (text.endsWith('==')) padding = 2;
  else if (text.endsWith('=')) padding = 1;

  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let out = 0;
  for (let i = 0; i < text.length; i += 4) {
    let chunk = 0;
    for (let j = 0; j < 4; j++) {
      const code = text.charCodeAt(i + j);
      const value = code < 128 ? BASE64_VALUES[code] : -1;
      if (value < 0) {
        // The '=' padding only ever occupies the final one or two positions.
        const isPadding = code === 61 && i + 4 === text.length && j >= 4 - padding;
        if (!isPadding) {
          throw new Error(`${describe()}: base64 payload contains an invalid character at index ${i + j}.`);
        }
      }
      chunk = (chunk << 6) | (value < 0 ? 0 : value);
    }
    bytes[out++] = (chunk >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (chunk >> 8) & 255;
    if (out < bytes.length) bytes[out++] = chunk & 255;
  }
  return bytes;
}

/**
 * True for a value this codec can encode. `DataView` is excluded deliberately:
 * it is a cursor over a buffer, not a value, so callers reject it loudly instead.
 */
export function isEncodableTypedArray(value: object): boolean {
  return ArrayBuffer.isView(value) && value.constructor.name in CODECS;
}

/** True for a serialized typed-array shape produced by {@link encodeTypedArray}. */
export function isSerializedTypedArray(value: object): value is SerializedTypedArray {
  return '__typedArray' in value;
}

/**
 * Encode a typed array as a tagged, little-endian, base64 shape.
 *
 * Only the view's own window is encoded — a `subarray` restores as a standalone
 * array of its own length, never as its (possibly much larger) backing buffer.
 */
export function encodeTypedArray(value: ArrayBufferView, path: string): SerializedTypedArray {
  const typeName = value.constructor.name;
  const codec = CODECS[typeName];
  if (!codec) {
    throw new Error(
      `Cannot serialize ${typeName} at property '${path}': it is not one of the supported typed arrays ` +
        `(${SUPPORTED_TYPED_ARRAYS.join(', ')}).`
    );
  }

  // Derived from the view's own byte length rather than read off a `length`
  // property: `ArrayBufferView` declares `byteLength`, not `length`, so this is
  // the same number with the type system left on.
  const length = value.byteLength / codec.bytesPerElement;
  const bytes = new Uint8Array(length * codec.bytesPerElement);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < length; i++) {
    codec.write(view, i * codec.bytesPerElement, value, i);
  }

  return { __typedArray: typeName, data: bytesToBase64(bytes) };
}

/** Rebuild the exact typed-array type {@link encodeTypedArray} recorded. */
export function decodeTypedArray(value: SerializedTypedArray): ArrayBufferView {
  const typeName = value.__typedArray;
  const describe = () => `Cannot deserialize typed array '${typeName}'`;
  const codec = CODECS[typeName];
  if (!codec) {
    throw new Error(
      `${describe()}: unknown typed-array type. The snapshot was written by an engine that supports types this ` +
        `one does not (supported: ${SUPPORTED_TYPED_ARRAYS.join(', ')}).`
    );
  }
  if (typeof value.data !== 'string') {
    throw new Error(`${describe()}: expected a base64 string payload, got ${typeof value.data}.`);
  }

  const bytes = base64ToBytes(value.data, describe);
  if (bytes.length % codec.bytesPerElement !== 0) {
    throw new Error(
      `${describe()}: payload is ${bytes.length} bytes, not a whole number of ${codec.bytesPerElement}-byte elements.`
    );
  }

  const target = codec.allocate(bytes.length / codec.bytesPerElement);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < target.length; i++) {
    codec.read(view, i * codec.bytesPerElement, target, i);
  }
  return target;
}
