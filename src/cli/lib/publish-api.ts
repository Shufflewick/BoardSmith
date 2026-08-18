export type PlatformTarget = 'dev' | 'test' | 'prod';

const PLATFORM_URLS: Record<PlatformTarget, string> = {
  dev: 'http://localhost:3006',
  test: 'https://test.shufflewick.pub',
  prod: 'https://shufflewick.pub',
};

export function getPlatformUrl(target: PlatformTarget): string {
  return PLATFORM_URLS[target];
}

interface InitiateResponse {
  versionId: string;
  gameId: string;
  uploadUrl: string;
  uploadCode: string;
  publisherId: string;
}

export interface PublishError {
  kind: 'SLUG_TAKEN' | 'VERSION_EXISTS' | 'NO_ACCESS' | 'SCOPE_VIOLATION' | 'NETWORK' | 'SERVER';
  message: string;
  statusCode?: number;
}

/**
 * Extract a human-readable message from an error response body.
 * Platform app endpoints (initiate/complete/check-version) return h3-style
 * { statusMessage, message }; the games worker (upload) returns { error }.
 * `message` carries the actionable detail; h3's `statusMessage` is often just
 * the generic HTTP reason phrase ("Server Error"), so it is the last resort.
 */
function errorMessageFrom(body: Record<string, unknown>, fallback: string): string {
  for (const field of ['message', 'error', 'statusMessage']) {
    const value = body[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
}

/**
 * `fetch`, with a transport failure turned into a NETWORK PublishError whose
 * message `describe` renders. Every call in this module needs this, and each
 * one phrases its own failure ("Upload failed: …", "Complete failed: …").
 */
async function fetchOrNetworkError(
  url: string,
  init: RequestInit | undefined,
  describe: (detail: string) => string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: describe(detail) } satisfies PublishError;
  }
}

/**
 * Coded refusals an endpoint can return, keyed `"<status>:<data.code>"`.
 * Anything not listed degrades to a generic SERVER error, so an endpoint that
 * grows a new code stays safe (it reports the server's own message) until the
 * code is named here.
 */
type CodedRefusals = Record<string, PublishError['kind']>;

/**
 * Turn a non-ok Response into the right PublishError and throw it. Reads the
 * body exactly once — `res.json()` may only be consumed once — so this is the
 * single place allowed to inspect a failed response.
 */
async function throwResponseError(
  res: Response,
  fallbackMessage: string,
  coded: CodedRefusals = {},
): Promise<never> {
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const data = body.data as { code?: string } | undefined;
  const message = errorMessageFrom(body, fallbackMessage);

  const kind = data?.code ? coded[`${res.status}:${data.code}`] : undefined;
  throw { kind: kind ?? 'SERVER', message, statusCode: res.status } satisfies PublishError;
}

/**
 * THE ALLOW-LIST: everything the platform is told about a game at publish time.
 *
 * This is a projection of `dist/manifest.json`, NOT the manifest itself. A key
 * that is not named here never reaches the platform, however well it is
 * declared in `boardsmith.json` and however faithfully `deriveManifest` writes
 * it into `dist/manifest.json` — it is dropped silently, with nothing raised
 * anywhere. `asyncPlay` was lost exactly that way, which is why this is a named
 * function with its own tests rather than an object literal buried in a fetch
 * body: adding a platform-consumed key means adding it HERE.
 *
 * The body this produces becomes ShufflewickPub's `gameVersions.manifestJson`
 * row verbatim (`convex/publish.ts` stringifies whatever it receives), so this
 * function is the whole of what Convex-side readers can ever see. The separate
 * R2 copy the games worker's Durable Object reads travels in the bundle zip and
 * is not affected by this list.
 */
function buildInitiateManifest(
  manifest: Record<string, unknown>,
  gameSlug: string,
): Record<string, unknown> {
  // Optional keys are spread conditionally so an undeclared one stays absent
  // rather than arriving as an explicit undefined/false.
  const optional: Record<string, unknown> = {};
  for (const key of ['gameOptions', 'playerOptions', 'colorPalette']) {
    if (manifest[key]) optional[key] = manifest[key];
  }
  // Platform capability flags. `asyncPlay` is read by ShufflewickPub's
  // convex/games.ts parseAsyncPlayFlag off the row this body becomes.
  for (const key of ['asyncPlay']) {
    if (manifest[key] !== undefined) optional[key] = manifest[key];
  }

  return {
    playerCount: manifest.playerCount,
    displayName: manifest.displayName ?? manifest.name ?? gameSlug,
    description: manifest.description,
    // Taxonomy — audience/tags/playtime/complexity seed the game record
    // on first publish (website-editable after); cooperative and
    // playerCount are structural facts synced on every publish.
    audience: manifest.audience,
    tags: manifest.tags,
    playtime: manifest.playtime,
    cooperative: manifest.cooperative,
    complexity: manifest.complexity,
    ...optional,
  };
}

export async function initiatePublish(
  platformUrl: string,
  apiKey: string,
  gameSlug: string,
  version: string,
  manifest: Record<string, unknown>,
  gameId?: string,
  publisherSlug?: string,
  publisherId?: string,
): Promise<InitiateResponse> {
  const url = `${platformUrl}/api/publish/initiate`;
  const res = await fetchOrNetworkError(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gameId,
        publisherSlug,
        publisherId,
        gameSlug,
        version,
        manifest: buildInitiateManifest(manifest, gameSlug),
      }),
    },
    (detail) => `Failed to connect to ${platformUrl}: ${detail}`,
  );

  if (!res.ok) {
    // 401 is answered without consulting the body: an unauthenticated response
    // carries no useful detail, and "Invalid or revoked API key." is the
    // actionable phrasing.
    if (res.status === 401) {
      throw { kind: 'SERVER', message: 'Invalid or revoked API key.', statusCode: 401 } satisfies PublishError;
    }
    await throwResponseError(res, res.statusText, {
      '409:SLUG_TAKEN': 'SLUG_TAKEN',
      '409:VERSION_EXISTS': 'VERSION_EXISTS',
      '403:NO_ACCESS': 'NO_ACCESS',
      '403:SCOPE_VIOLATION': 'SCOPE_VIOLATION',
    });
  }

  return res.json() as Promise<InitiateResponse>;
}

export async function uploadBundle(
  uploadUrl: string,
  uploadCode: string,
  zip: Uint8Array,
): Promise<void> {
  const res = await fetchOrNetworkError(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadCode}`,
        'Content-Type': 'application/zip',
      },
      body: zip as unknown as BodyInit,
    },
    (detail) => `Upload failed: ${detail}`,
  );

  if (!res.ok) await throwResponseError(res, `Upload returned HTTP ${res.status}`);
}

export async function completePublish(
  platformUrl: string,
  apiKey: string,
  versionId: string,
): Promise<{ gameUrl: string }> {
  const url = `${platformUrl}/api/publish/complete`;
  const res = await fetchOrNetworkError(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ versionId }),
    },
    (detail) => `Complete failed: ${detail}`,
  );

  if (!res.ok) await throwResponseError(res, `Complete returned HTTP ${res.status}`);

  return res.json() as Promise<{ gameUrl: string }>;
}

export async function checkVersionAvailable(
  platformUrl: string,
  apiKey: string,
  gameIdOrSlug: string,
  version: string,
): Promise<void> {
  const url = `${platformUrl}/api/publish/check-version`;
  const res = await fetchOrNetworkError(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameIdOrSlug, version }),
    },
    (detail) => detail,
  );

  // Anything other than VERSION_EXISTS degrades to SERVER, which the caller
  // treats as non-fatal for a preflight.
  if (!res.ok) await throwResponseError(res, res.statusText, { '409:VERSION_EXISTS': 'VERSION_EXISTS' });
}

export interface TaxonomyAudience {
  value: string;
  label: string;
  helperText: string;
  litmus: string;
}

/**
 * Fetch the platform's canonical audience list (public, no auth). The platform
 * is the sole authority on audience VALUES — the CLI only shape-checks — so
 * publish preflights against this before uploading anything.
 */
export async function fetchTaxonomy(platformUrl: string): Promise<{ audiences: TaxonomyAudience[] }> {
  const url = `${platformUrl}/api/taxonomy`;
  const res = await fetchOrNetworkError(
    url,
    undefined,
    (detail) => `Failed to fetch taxonomy from ${url}: ${detail}`,
  );

  if (!res.ok) await throwResponseError(res, `Taxonomy endpoint returned HTTP ${res.status}`);

  const body = await res.json().catch(() => null) as { audiences?: unknown } | null;
  if (!body || !Array.isArray(body.audiences)) {
    throw {
      kind: 'SERVER',
      message: `Taxonomy endpoint at ${url} returned an unexpected response (no "audiences" list). The platform may be misconfigured or the URL may be wrong.`,
      statusCode: res.status,
    } satisfies PublishError;
  }
  return { audiences: body.audiences as TaxonomyAudience[] };
}

export function isPublishError(err: unknown): err is PublishError {
  return typeof err === 'object' && err !== null && 'kind' in err && 'message' in err;
}

/**
 * Best-effort abort of an in-flight publish after a failed upload/finalize,
 * so the platform never keeps a zombie "uploading" version. Failures here
 * are swallowed by the caller — the original error is what the user needs.
 */
export async function abortPublish(
  platformUrl: string,
  apiKey: string,
  versionId: string,
): Promise<void> {
  await fetch(`${platformUrl}/api/publish/abort`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ versionId }),
  });
}
