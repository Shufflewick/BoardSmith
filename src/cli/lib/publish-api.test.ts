import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadBundle, initiatePublish, completePublish, isPublishError } from './publish-api.js';
import type { PublishError } from './publish-api.js';

function mockFetchResponse(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  ));
}

async function captureError(promise: Promise<unknown>): Promise<PublishError> {
  try {
    await promise;
  } catch (err) {
    if (isPublishError(err)) return err;
    throw err;
  }
  throw new Error('expected the call to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadBundle error reporting', () => {
  const upload = () => uploadBundle('https://games.example/upload', 'code', new Uint8Array([1]));

  it('surfaces the games worker { error } body verbatim', async () => {
    const workerMessage =
      'boardsmith.json is missing engineProtocol -- this bundle predates protocol versioning. '
      + 'Rebuild and republish with the current BoardSmith CLI.';
    mockFetchResponse(400, { error: workerMessage });

    const err = await captureError(upload());
    expect(err.kind).toBe('SERVER');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe(workerMessage);
  });

  it('surfaces h3-style { statusMessage } bodies', async () => {
    mockFetchResponse(413, { statusMessage: 'Bundle exceeds size limit' });

    const err = await captureError(upload());
    expect(err.message).toBe('Bundle exceeds size limit');
  });

  it('prefers statusMessage over message over error', async () => {
    mockFetchResponse(400, { statusMessage: 'first', message: 'second', error: 'third' });

    const err = await captureError(upload());
    expect(err.message).toBe('first');
  });

  it('falls back to the HTTP status when the body has no known message field', async () => {
    mockFetchResponse(500, { detail: 'unrecognized shape' });

    const err = await captureError(upload());
    expect(err.message).toBe('Upload returned HTTP 500');
  });

  it('falls back to the HTTP status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    ));

    const err = await captureError(upload());
    expect(err.message).toBe('Upload returned HTTP 502');
  });

  it('ignores non-string message fields instead of throwing them as messages', async () => {
    mockFetchResponse(400, { error: { code: 'NESTED' } });

    const err = await captureError(upload());
    expect(err.message).toBe('Upload returned HTTP 400');
  });
});

describe('initiatePublish error reporting', () => {
  it('surfaces an { error } body from a non-h3 responder', async () => {
    mockFetchResponse(400, { error: 'manifest rejected' });

    const err = await captureError(
      initiatePublish('https://platform.example', 'key', 'slug', '1.0.0', {}),
    );
    expect(err.kind).toBe('SERVER');
    expect(err.message).toBe('manifest rejected');
  });
});

describe('completePublish error reporting', () => {
  it('surfaces an { error } body from a non-h3 responder', async () => {
    mockFetchResponse(400, { error: 'version not uploaded' });

    const err = await captureError(
      completePublish('https://platform.example', 'key', 'version-id'),
    );
    expect(err.kind).toBe('SERVER');
    expect(err.message).toBe('version not uploaded');
  });
});
