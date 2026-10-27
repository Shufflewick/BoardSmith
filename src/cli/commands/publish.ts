import { writeFileSync } from 'node:fs';
import { styleText } from 'node:util';
import ora from 'ora';
import { getApiKey, saveApiKey } from '../lib/config.js';
import { createZip, formatBytes } from '../lib/zip.js';
import {
  getPlatformUrl,
  initiatePublish,
  uploadBundle,
  completePublish,
  checkVersionAvailable,
  abortPublish,
  fetchTaxonomy,
  isPublishError,
  type TaxonomyAudience,
  type PlatformTarget,
} from '../lib/publish-api.js';
import { topLevelIdMessage } from './validate.js';
import {
  requireGameProjectManifests,
  requireTableUi,
  type GameProjectConfig,
  type PlatformIds,
} from '../lib/game-project.js';
import { publishGate } from '../lib/publish-gate.js';

/**
 * END A FAILED PUBLISH.
 *
 * The platform states its own reason when it has one, and that reason is
 * always more useful than the exception's `toString`; anything else is
 * reported verbatim rather than swallowed. Three stages -- init, upload and
 * finalize -- each ended this way, and never returns, so the caller cannot
 * carry on with a half-published version.
 */
function reportPublishFailure(err: unknown): never {
  console.error(styleText('red', isPublishError(err) ? err.message : String(err)));
  process.exit(1);
}

interface PublishOptions {
  apiKey?: string;
  publisher?: string;
  dev?: boolean;
  prod?: boolean;
  dryRun?: boolean;
}

/** A publish that does not name exactly one platform. */
export class PublishTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublishTargetError';
  }
}

/**
 * Work out which platform a publish is aimed at.
 *
 * There is deliberately NO default (#36). `boardsmith publish` used to mean
 * "ship to production", so the most dangerous target was the zero-effort one
 * and the safe target was the one you had to type — the Pit of Success
 * exactly inverted. One forgotten flag while iterating against dev put a
 * work-in-progress build in front of players, with no confirmation anywhere in
 * the flow to catch it.
 *
 * Naming the target is one word, and it is the word that makes the difference
 * between a dev deploy and a live one.
 */
export function resolveTarget(options: PublishOptions): PlatformTarget {
  const named: PlatformTarget[] = [];
  if (options.dev) named.push('dev');
  if (options.prod) named.push('prod');

  if (named.length > 1) {
    throw new PublishTargetError(
      `A publish goes to one platform, but ${named.map((t) => `--${t}`).join(' and ')} were both passed. ` +
      `Pick one.`
    );
  }
  if (named.length === 0) {
    throw new PublishTargetError(
      'Name the platform to publish to. There is no default, because the default used to be production.\n' +
      '  --dev    the local dev platform (http://localhost:3006)\n' +
      '  --prod   the LIVE platform, where players will see this build'
    );
  }
  return named[0];
}

/**
 * The ids saved for `target`, and only for it: dev and prod are separate
 * deployments, so one platform's ids mean nothing on the other (#704).
 *
 * The old top-level `gameId`/`publisherId` are refused rather than read,
 * because nothing says which platform they came from.
 */
export function savedPlatformIds(config: GameProjectConfig, target: PlatformTarget): PlatformIds {
  const retired = (['gameId', 'publisherId'] as const).filter((key) => config[key] !== undefined);
  if (retired.length > 0) throw new Error(retired.map(topLevelIdMessage).join('\n'));
  return { ...config.platforms?.[target] };
}

/** Save what `target` answered under its own block; returns whether boardsmith.json needs writing. */
export function recordPlatformIds(
  config: GameProjectConfig,
  target: PlatformTarget,
  ids: Required<PlatformIds>,
): boolean {
  const saved = config.platforms?.[target];
  if (saved?.gameId === ids.gameId && saved?.publisherId === ids.publisherId) return false;
  config.platforms = { ...config.platforms, [target]: ids };
  return true;
}

/** What to do when `target` may no longer know the ids saved for it, after a platform reset. */
export function staleIdsHint(target: PlatformTarget): string {
  return (
    `If the ${target} platform was reset since your last publish to it, the ids saved ` +
    `under "platforms.${target}" in boardsmith.json no longer exist on it. Delete "platforms.${target}" and run: ` +
    `boardsmith publish --${target} --publisher <slug>`
  );
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function publishCommand(options: PublishOptions): Promise<void> {
  const cwd = process.cwd();
  let target: PlatformTarget;
  try {
    target = resolveTarget(options);
  } catch (error) {
    if (!(error instanceof PublishTargetError)) throw error;
    console.error(styleText('red', error.message));
    process.exit(1);
  }

  // -- Validate project, before any key or network: a project with no UI has nothing to publish --
  const { configPath, config, pkg } = requireGameProjectManifests(cwd);
  const saved = savedPlatformIds(config, target);
  requireTableUi(cwd, config);
  const verified = await publishGate(cwd);
  if ('problem' in verified) {
    console.error(styleText('red', verified.problem));
    process.exit(1);
  }

  // -- Resolve API key (per target: dev and prod are separate deployments
  // with separate key stores) --
  let apiKey = options.apiKey;

  if (apiKey) {
    if (!apiKey.startsWith('spk_')) {
      console.error(styleText('red', 'API key must start with spk_'));
      process.exit(1);
    }
    saveApiKey(target, apiKey);
    console.log(styleText('green', `API key saved for ${target}.`));
  } else {
    apiKey = getApiKey(target);
    if (!apiKey) {
      console.error(styleText('red', `No API key configured for the ${target} platform.`));
      console.error(styleText('dim', `Run: boardsmith publish --${target} --api-key spk_YOUR_KEY`));
      process.exit(1);
    }
  }

  const version = pkg.version;
  if (!version) {
    console.error(styleText('red', 'No version field in package.json.'));
    console.error(styleText('dim', 'Add a "version" field (e.g., "1.0.0") to your package.json.'));
    process.exit(1);
  }

  const displayName = config.displayName || config.name || 'Unknown';
  const platformUrl = getPlatformUrl(target);

  // -- Resolve game identity early (needed for preflight) --
  // Prefer this platform's saved gameId (stable across slug changes).
  // Fall back to slug derivation if none (first publish here, or deleted).
  const existingGameId = saved.gameId;
  const baseSlug = toSlug(config.name || pkg.name || 'game');

  // -- Resolve publisher target --
  // --publisher overrides everything; otherwise reuse this platform's persisted publisherId.
  // A brand-new game (no persisted publisherId, no flag) has no target and must fail.
  const existingPublisherId = saved.publisherId;
  const existingPublisherSlug = config.publisher;
  let targetPublisherSlug: string | undefined;
  let targetPublisherId: string | undefined;
  if (options.publisher) {
    targetPublisherSlug = options.publisher;
  } else if (existingPublisherId) {
    targetPublisherId = existingPublisherId;
  } else {
    console.error(styleText('red', `No publisher target for new game "${displayName}".`));
    console.error(styleText('dim', 'Pass --publisher <slug> to specify which publisher owns this game.'));
    process.exit(1);
  }
  // Slug used when naming the publisher in access/scope error messages.
  const effectiveSlug = options.publisher ?? existingPublisherSlug ?? existingPublisherId ?? '(unknown)';

  console.log(styleText('cyan', `\nPublishing ${displayName} v${version}\n`));
  console.log(styleText('dim', `  Platform:  ${platformUrl}`));
  console.log(styleText('dim', `  API Key:   ${apiKey.slice(0, 12)}...`));
  console.log('');

  // -- Preflight: check version availability before packaging --
  try {
    await checkVersionAvailable(platformUrl, apiKey, existingGameId ?? baseSlug, version);
  } catch (err: unknown) {
    if (isPublishError(err) && err.kind === 'VERSION_EXISTS') {
      // The platform's message names the latest published version.
      console.error(styleText('red', err.message));
      console.error(styleText('dim', 'Bump the version in package.json past it and try again.'));
      process.exit(1);
    }
    // Network errors during preflight are non-fatal — continue
    // and let the existing initiatePublish catch it later
  }

  // -- Package the bundle verify built, validated and measured for this commit (#1495) --
  const spinner = ora('Packaging build...').start();
  const fileMap = verified.files;
  const zip = createZip(fileMap);
  spinner.succeed(`Packaged ${fileMap.size} files (${formatBytes(zip.length)})`);

  if (options.dryRun) {
    console.log(styleText('yellow', '\nDry run — skipping upload.\n'));
    console.log(styleText('dim', 'Would publish:'));
    console.log(styleText('dim', `  Game:    ${displayName}`));
    console.log(styleText('dim', `  Version: ${version}`));
    console.log(styleText('dim', `  Files:   ${fileMap.size}`));
    console.log(styleText('dim', `  Size:    ${formatBytes(zip.length)}`));
    console.log('');
    return;
  }

  // -- Read manifest for initiate --
  const manifest = JSON.parse(new TextDecoder().decode(fileMap.get('boardsmith.json')));

  // -- Preflight: validate audience against the platform's canonical list --
  await preflightAudience(platformUrl, manifest.audience);

  // -- Initiate --
  spinner.start('Publishing...');

  let initResult;
  try {
    initResult = await initiatePublish(
      platformUrl, apiKey, baseSlug, version, manifest,
      existingGameId,
      targetPublisherSlug,
      targetPublisherId,
    );
  } catch (err: unknown) {
    if (isPublishError(err) && err.kind === 'VERSION_EXISTS') {
      spinner.fail('Publish failed');
      console.error(styleText('red', err.message));
      console.error(styleText('dim', 'Bump the version in package.json past it and try again.'));
      process.exit(1);
    }
    if (isPublishError(err) && err.kind === 'NO_ACCESS') {
      spinner.fail('Publish failed');
      console.error(styleText('red',
        `You don't have develop access to this game under publisher \`${effectiveSlug}\`. `
        + 'Ask an owner or manager to grant you develop access, then try again.',
      ));
      if (targetPublisherId) console.error(styleText('dim', staleIdsHint(target)));
      process.exit(1);
    }
    if (isPublishError(err) && err.kind === 'SCOPE_VIOLATION') {
      spinner.fail('Publish failed');
      console.error(styleText('red',
        `This API key is scoped to a different publisher and can't publish to \`${effectiveSlug}\`.`,
      ));
      process.exit(1);
    }
    spinner.fail('Publish failed');
    reportPublishFailure(err);
  }

  // Save this platform's ids + resolved publisher target to boardsmith.json for future publishes
  let configDirty = recordPlatformIds(config, target, {
    gameId: initResult.gameId,
    publisherId: initResult.publisherId,
  });
  if (options.publisher && options.publisher !== config.publisher) {
    config.publisher = options.publisher;
    configDirty = true;
  }
  if (configDirty) {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  // -- Upload --
  spinner.text = 'Uploading bundle...';
  try {
    await uploadBundle(initResult.uploadUrl, initResult.uploadCode, zip);
  } catch (err: unknown) {
    spinner.fail('Upload failed');
    await abortInFlightPublish(platformUrl, apiKey, initResult.versionId);
    reportPublishFailure(err);
  }

  // -- Complete --
  spinner.text = 'Finalizing...';
  try {
    const result = await completePublish(platformUrl, apiKey, initResult.versionId);
    spinner.succeed('Published!');
    console.log('');
    console.log(styleText('green', `  ${displayName} v${version}`));
    console.log(styleText('green', `  ${result.gameUrl}`));
    console.log('');
  } catch (err: unknown) {
    spinner.fail('Finalize failed');
    await abortInFlightPublish(platformUrl, apiKey, initResult.versionId);
    reportPublishFailure(err);
  }
}

/**
 * Best-effort cleanup after a failed upload/finalize. The platform only ever
 * deletes a still-"uploading" row, so this can never destroy a completed
 * publish; a cleanup failure is reported dimly but never masks the original
 * error.
 */
export async function abortInFlightPublish(
  platformUrl: string,
  apiKey: string,
  versionId: string,
): Promise<void> {
  try {
    await abortPublish(platformUrl, apiKey, versionId);
  } catch {
    console.error(styleText('dim', '(Could not clean up the in-flight version; it will be swept automatically.)'));
  }
}

/**
 * Pure mismatch check for the preflight — returns the actionable error lines
 * when `audience` is not one of the platform's audiences, or null when valid.
 * Exported for tests; the network fetch lives in preflightAudience.
 */
export function describeAudienceMismatch(
  audience: unknown,
  audiences: TaxonomyAudience[],
): string[] | null {
  if (typeof audience === 'string' && audiences.some((a) => a.value === audience)) {
    return null;
  }

  const found = typeof audience === 'string' ? `"${audience}"` : 'missing';
  return [
    `Invalid "audience" in boardsmith.json: ${found}.`,
    'Valid audiences:',
    ...audiences.map((a) => `  ${a.value} — ${a.helperText}`),
  ];
}

/**
 * Fetch the platform's canonical audience list and abort publish (exit 1)
 * when the manifest's audience is not on it. The platform is the value
 * authority; `boardsmith validate` only shape-checks. Network failure is
 * fatal — publish requires network anyway, and skipping the check would just
 * defer the same rejection to the server.
 */
async function preflightAudience(platformUrl: string, audience: unknown): Promise<void> {
  let audiences: TaxonomyAudience[];
  try {
    ({ audiences } = await fetchTaxonomy(platformUrl));
  } catch (err: unknown) {
    console.error(styleText('red', isPublishError(err) ? err.message : String(err)));
    console.error(styleText('dim', 'Could not verify "audience" against the platform taxonomy. Check your connection and try again.'));
    process.exit(1);
  }

  const mismatch = describeAudienceMismatch(audience, audiences);
  if (!mismatch) return;

  console.error(styleText('red', mismatch[0]));
  for (const line of mismatch.slice(1)) {
    console.error(styleText('dim', line));
  }
  process.exit(1);
}

function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!SLUG_PATTERN.test(slug)) {
    console.error(styleText('red', `Cannot derive a valid slug from name "${name}".`));
    console.error(styleText('dim', 'The "name" field in boardsmith.json must produce a valid slug (lowercase alphanumeric with hyphens).'));
    process.exit(1);
  }
  return slug;
}
