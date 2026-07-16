const PROD_URL = 'https://shufflewick.pub';
const TEST_URL = 'https://test.shufflewick.pub';

export function getPlatformUrl(test: boolean): string {
  return test ? TEST_URL : PROD_URL;
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
 */
function errorMessageFrom(body: Record<string, unknown>, fallback: string): string {
  for (const field of ['statusMessage', 'message', 'error']) {
    const value = body[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
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
  let res: Response;
  try {
    res = await fetch(url, {
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
        manifest: {
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
          // Lobby option declarations — platform uses these for lobby UI
          ...(manifest.gameOptions ? { gameOptions: manifest.gameOptions } : {}),
          ...(manifest.playerOptions ? { playerOptions: manifest.playerOptions } : {}),
          ...(manifest.colorPalette ? { colorPalette: manifest.colorPalette } : {}),
        },
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: `Failed to connect to ${platformUrl}: ${msg}` } satisfies PublishError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const data = body.data as { code?: string } | undefined;
    const message = errorMessageFrom(body, res.statusText);

    if (res.status === 409 && data?.code === 'SLUG_TAKEN') {
      throw { kind: 'SLUG_TAKEN', message, statusCode: 409 } satisfies PublishError;
    }
    if (res.status === 409 && data?.code === 'VERSION_EXISTS') {
      throw { kind: 'VERSION_EXISTS', message, statusCode: 409 } satisfies PublishError;
    }
    if (res.status === 403 && data?.code === 'NO_ACCESS') {
      throw { kind: 'NO_ACCESS', message, statusCode: 403 } satisfies PublishError;
    }
    if (res.status === 403 && data?.code === 'SCOPE_VIOLATION') {
      throw { kind: 'SCOPE_VIOLATION', message, statusCode: 403 } satisfies PublishError;
    }
    if (res.status === 401) {
      throw { kind: 'SERVER', message: 'Invalid or revoked API key.', statusCode: 401 } satisfies PublishError;
    }
    throw { kind: 'SERVER', message, statusCode: res.status } satisfies PublishError;
  }

  return res.json() as Promise<InitiateResponse>;
}

export async function uploadBundle(
  uploadUrl: string,
  uploadCode: string,
  zip: Uint8Array,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadCode}`,
        'Content-Type': 'application/zip',
      },
      body: zip as unknown as BodyInit,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: `Upload failed: ${msg}` } satisfies PublishError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw {
      kind: 'SERVER',
      message: errorMessageFrom(body, `Upload returned HTTP ${res.status}`),
      statusCode: res.status,
    } satisfies PublishError;
  }
}

export async function completePublish(
  platformUrl: string,
  apiKey: string,
  versionId: string,
): Promise<{ gameUrl: string }> {
  const url = `${platformUrl}/api/publish/complete`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ versionId }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: `Complete failed: ${msg}` } satisfies PublishError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw {
      kind: 'SERVER',
      message: errorMessageFrom(body, `Complete returned HTTP ${res.status}`),
      statusCode: res.status,
    } satisfies PublishError;
  }

  return res.json() as Promise<{ gameUrl: string }>;
}

export async function checkVersionAvailable(
  platformUrl: string,
  apiKey: string,
  gameIdOrSlug: string,
  version: string,
): Promise<void> {
  const url = `${platformUrl}/api/publish/check-version`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameIdOrSlug, version }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: msg } satisfies PublishError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const data = body.data as { code?: string } | undefined;
    const message = errorMessageFrom(body, res.statusText);

    if (res.status === 409 && data?.code === 'VERSION_EXISTS') {
      throw { kind: 'VERSION_EXISTS', message, statusCode: 409 } satisfies PublishError;
    }
    // Other errors are non-fatal for preflight
    throw { kind: 'SERVER', message, statusCode: res.status } satisfies PublishError;
  }
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
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw { kind: 'NETWORK', message: `Failed to fetch taxonomy from ${url}: ${msg}` } satisfies PublishError;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw {
      kind: 'SERVER',
      message: errorMessageFrom(body, `Taxonomy endpoint returned HTTP ${res.status}`),
      statusCode: res.status,
    } satisfies PublishError;
  }

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
