import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadBundle, initiatePublish, completePublish, fetchTaxonomy, isPublishError } from './publish-api.js';
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

  it('maps a 403 NO_ACCESS body to the NO_ACCESS kind with the server message', async () => {
    mockFetchResponse(403, {
      statusMessage: 'No develop access',
      data: { code: 'NO_ACCESS' },
    });

    const err = await captureError(
      initiatePublish('https://platform.example', 'key', 'slug', '1.0.0', {}),
    );
    expect(err.kind).toBe('NO_ACCESS');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('No develop access');
  });

  it('maps a 403 SCOPE_VIOLATION body to the SCOPE_VIOLATION kind', async () => {
    mockFetchResponse(403, {
      statusMessage: 'Key scoped elsewhere',
      data: { code: 'SCOPE_VIOLATION' },
    });

    const err = await captureError(
      initiatePublish('https://platform.example', 'key', 'slug', '1.0.0', {}),
    );
    expect(err.kind).toBe('SCOPE_VIOLATION');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Key scoped elsewhere');
  });

  it('maps a 401 to the fixed invalid-key message regardless of body', async () => {
    mockFetchResponse(401, { statusMessage: 'whatever' });

    const err = await captureError(
      initiatePublish('https://platform.example', 'key', 'slug', '1.0.0', {}),
    );
    expect(err.kind).toBe('SERVER');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid or revoked API key.');
  });

  it('threads publisherSlug and publisherId into the request body and returns resolved publisherId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          versionId: 'v1',
          gameId: 'g1',
          uploadUrl: 'https://up',
          uploadCode: 'code',
          publisherId: 'pub-resolved',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await initiatePublish(
      'https://platform.example', 'key', 'slug', '1.0.0', {},
      'game-id', 'my-publisher', 'pub-id',
    );

    expect(result.publisherId).toBe('pub-resolved');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.publisherSlug).toBe('my-publisher');
    expect(body.publisherId).toBe('pub-id');
    expect(body.gameId).toBe('game-id');
  });
});

describe('initiatePublish manifest payload', () => {
  it('threads the taxonomy fields into the manifest body (seed/sync contract)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          versionId: 'v1', gameId: 'g1', uploadUrl: 'https://up', uploadCode: 'code', publisherId: 'p1',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await initiatePublish('https://platform.example', 'key', 'slug', '1.0.0', {
      playerCount: { min: 2, max: 4 },
      displayName: 'Fixture',
      description: 'desc',
      audience: 'casual',
      tags: ['abstract'],
      playtime: { min: 15, max: 30 },
      cooperative: false,
      complexity: 2,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.manifest.audience).toBe('casual');
    expect(body.manifest.tags).toEqual(['abstract']);
    expect(body.manifest.playtime).toEqual({ min: 15, max: 30 });
    expect(body.manifest.cooperative).toBe(false);
    expect(body.manifest.complexity).toBe(2);
    expect(body.manifest.playerCount).toEqual({ min: 2, max: 4 });
  });
});

describe('fetchTaxonomy', () => {
  it('GETs {platformUrl}/api/taxonomy and returns the audience list', async () => {
    const audiences = [
      { value: 'casual', label: 'Casual', helperText: 'h', litmus: 'l' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ audiences }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTaxonomy('https://platform.example');

    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.example/api/taxonomy');
    expect(result.audiences).toEqual(audiences);
  });

  it('throws a NETWORK error naming the URL when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const err = await captureError(fetchTaxonomy('https://platform.example'));
    expect(err.kind).toBe('NETWORK');
    expect(err.message).toContain('https://platform.example/api/taxonomy');
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('throws a SERVER error with the status when the endpoint responds non-OK', async () => {
    mockFetchResponse(500, { statusMessage: 'boom' });

    const err = await captureError(fetchTaxonomy('https://platform.example'));
    expect(err.kind).toBe('SERVER');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('boom');
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
