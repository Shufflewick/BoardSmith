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
}

export interface PublishError {
  kind: 'SLUG_TAKEN' | 'VERSION_EXISTS' | 'NETWORK' | 'SERVER';
  message: string;
  statusCode?: number;
}

export async function initiatePublish(
  platformUrl: string,
  apiKey: string,
  gameSlug: string,
  version: string,
  manifest: Record<string, unknown>,
  gameId?: string,
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
        gameSlug,
        version,
        manifest: {
          playerCount: manifest.playerCount,
          displayName: manifest.displayName ?? manifest.name ?? gameSlug,
          description: manifest.description,
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
    const message = (body.statusMessage as string) || (body.message as string) || res.statusText;

    if (res.status === 409 && data?.code === 'SLUG_TAKEN') {
      throw { kind: 'SLUG_TAKEN', message, statusCode: 409 } satisfies PublishError;
    }
    if (res.status === 409 && data?.code === 'VERSION_EXISTS') {
      throw { kind: 'VERSION_EXISTS', message, statusCode: 409 } satisfies PublishError;
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
      message: (body.statusMessage as string) || (body.message as string) || `Upload returned HTTP ${res.status}`,
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
      message: (body.statusMessage as string) || (body.message as string) || `Complete returned HTTP ${res.status}`,
      statusCode: res.status,
    } satisfies PublishError;
  }

  return res.json() as Promise<{ gameUrl: string }>;
}

export function isPublishError(err: unknown): err is PublishError {
  return typeof err === 'object' && err !== null && 'kind' in err && 'message' in err;
}
