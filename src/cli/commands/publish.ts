import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { getApiKey, saveApiKey } from '../lib/config.js';
import { readDistDir, createZip } from '../lib/zip.js';
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
import { buildCommand } from './build.js';
import { validateCommand } from './validate.js';
import { describeZipSizeViolation } from '../lib/bundle-limits.js';

interface PublishOptions {
  apiKey?: string;
  publisher?: string;
  dev?: boolean;
  test?: boolean;
  dryRun?: boolean;
}

function resolveTarget(options: PublishOptions): PlatformTarget {
  if (options.dev && options.test) {
    console.error(chalk.red('Pass at most one of --dev / --test.'));
    process.exit(1);
  }
  if (options.dev) return 'dev';
  if (options.test) return 'test';
  return 'prod';
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_ATTEMPTS = 10;

export async function publishCommand(options: PublishOptions): Promise<void> {
  const cwd = process.cwd();
  const target = resolveTarget(options);

  // -- Resolve API key (per target: dev/test/prod are separate deployments
  // with separate key stores) --
  let apiKey = options.apiKey;

  if (apiKey) {
    if (!apiKey.startsWith('spk_')) {
      console.error(chalk.red('API key must start with spk_'));
      process.exit(1);
    }
    saveApiKey(target, apiKey);
    console.log(chalk.green(`API key saved for ${target}.`));
  } else {
    apiKey = getApiKey(target);
    if (!apiKey) {
      console.error(chalk.red(`No API key configured for the ${target} platform.`));
      console.error(chalk.dim(`Run: boardsmith publish${target === 'prod' ? '' : ` --${target}`} --api-key spk_YOUR_KEY`));
      process.exit(1);
    }
  }

  // -- Validate project --
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('boardsmith.json not found.'));
    console.error(chalk.dim('Run this command from a BoardSmith game project directory.'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(chalk.red('package.json not found.'));
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const version = pkg.version;
  if (!version) {
    console.error(chalk.red('No version field in package.json.'));
    console.error(chalk.dim('Add a "version" field (e.g., "1.0.0") to your package.json.'));
    process.exit(1);
  }

  const displayName = config.displayName || config.name || 'Unknown';
  const platformUrl = getPlatformUrl(target);

  // -- Resolve game identity early (needed for preflight) --
  // Prefer gameId from boardsmith.json (stable across slug changes).
  // Fall back to slug derivation if no gameId (first publish or deleted).
  const existingGameId: string | undefined = config.gameId;
  const baseSlug = toSlug(config.name || pkg.name || 'game');

  // -- Resolve publisher target --
  // --publisher overrides everything; otherwise reuse the persisted publisherId.
  // A brand-new game (no persisted publisherId, no flag) has no target and must fail.
  const existingPublisherId: string | undefined = config.publisherId;
  const existingPublisherSlug: string | undefined = config.publisher;
  let targetPublisherSlug: string | undefined;
  let targetPublisherId: string | undefined;
  if (options.publisher) {
    targetPublisherSlug = options.publisher;
  } else if (existingPublisherId) {
    targetPublisherId = existingPublisherId;
  } else {
    console.error(chalk.red(`No publisher target for new game "${displayName}".`));
    console.error(chalk.dim('Pass --publisher <slug> to specify which publisher owns this game.'));
    process.exit(1);
  }
  // Slug used when naming the publisher in access/scope error messages.
  const effectiveSlug = options.publisher ?? existingPublisherSlug ?? existingPublisherId ?? '(unknown)';

  console.log(chalk.cyan(`\nPublishing ${displayName} v${version}\n`));
  console.log(chalk.dim(`  Platform:  ${platformUrl}`));
  console.log(chalk.dim(`  API Key:   ${apiKey.slice(0, 12)}...`));
  console.log('');

  // -- Preflight: check version availability before building --
  try {
    await checkVersionAvailable(platformUrl, apiKey, existingGameId ?? baseSlug, version);
  } catch (err: unknown) {
    if (isPublishError(err) && err.kind === 'VERSION_EXISTS') {
      // The platform's message names the latest published version.
      console.error(chalk.red(err.message));
      console.error(chalk.dim('Bump the version in package.json past it and try again.'));
      process.exit(1);
    }
    // Network errors during preflight are non-fatal — continue with build
    // and let the existing initiatePublish catch it later
  }

  // -- Validate (exits process on failure) --
  console.log(chalk.cyan('Running pre-publish validation...\n'));
  await validateCommand();

  // -- Build --
  console.log(chalk.cyan('\nBuilding for production...\n'));
  await buildCommand({ outDir: 'dist' });

  // -- Package --
  const spinner = ora('Packaging build...').start();
  const distDir = join(cwd, 'dist');
  let fileMap: Map<string, Uint8Array>;
  try {
    fileMap = readDistDir(distDir);
  } catch (err: unknown) {
    spinner.fail('Packaging failed');
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const zip = createZip(fileMap);

  // WR-05: gate on the ACTUAL zip size before any upload — the server rejects
  // zips over the limit, so an oversized bundle must fail here with an
  // actionable message instead of round-tripping to the server to fail.
  const sizeViolation = describeZipSizeViolation(zip.length);
  if (sizeViolation) {
    spinner.fail('Packaging failed');
    console.error(chalk.red(sizeViolation));
    process.exit(1);
  }

  spinner.succeed(`Packaged ${fileMap.size} files (${formatBytes(zip.length)})`);

  if (options.dryRun) {
    console.log(chalk.yellow('\nDry run — skipping upload.\n'));
    console.log(chalk.dim('Would publish:'));
    console.log(chalk.dim(`  Game:    ${displayName}`));
    console.log(chalk.dim(`  Version: ${version}`));
    console.log(chalk.dim(`  Files:   ${fileMap.size}`));
    console.log(chalk.dim(`  Size:    ${formatBytes(zip.length)}`));
    console.log('');
    return;
  }

  // -- Read manifest for initiate --
  const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf-8'));

  // -- Preflight: validate audience against the platform's canonical list --
  await preflightAudience(platformUrl, manifest.audience);

  // -- Initiate (with slug disambiguation) --
  spinner.start('Publishing...');

  let initResult;
  let resolvedSlug = baseSlug;

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const candidateSlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;

    try {
      initResult = await initiatePublish(
        platformUrl, apiKey, candidateSlug, version, manifest,
        // Only pass gameId on first attempt (slug derivation).
        // Disambiguation attempts are slug-only since the game doesn't exist yet.
        attempt === 0 ? existingGameId : undefined,
        targetPublisherSlug,
        targetPublisherId,
      );
      resolvedSlug = candidateSlug;
      break;
    } catch (err: unknown) {
      if (isPublishError(err) && err.kind === 'SLUG_TAKEN') {
        // If we had a gameId and still got SLUG_TAKEN, the ID lookup succeeded
        // but the slug changed — this shouldn't happen. Fail clearly.
        if (existingGameId && attempt === 0) {
          spinner.fail('Publish failed');
          console.error(chalk.red('Your gameId no longer matches the slug. The game may have been deleted.'));
          console.error(chalk.dim('Remove the "gameId" field from boardsmith.json and try again.'));
          process.exit(1);
        }
        continue;
      }
      if (isPublishError(err) && err.kind === 'VERSION_EXISTS') {
        spinner.fail('Publish failed');
        console.error(chalk.red(err.message));
        console.error(chalk.dim('Bump the version in package.json past it and try again.'));
        process.exit(1);
      }
      if (isPublishError(err) && err.kind === 'NO_ACCESS') {
        spinner.fail('Publish failed');
        console.error(chalk.red(
          `You don't have develop access to this game under publisher \`${effectiveSlug}\`. `
          + 'Ask an owner or manager to grant you develop access, then try again.',
        ));
        process.exit(1);
      }
      if (isPublishError(err) && err.kind === 'SCOPE_VIOLATION') {
        spinner.fail('Publish failed');
        console.error(chalk.red(
          `This API key is scoped to a different publisher and can't publish to \`${effectiveSlug}\`.`,
        ));
        process.exit(1);
      }
      spinner.fail('Publish failed');
      if (isPublishError(err)) {
        console.error(chalk.red(err.message));
      } else {
        console.error(chalk.red(String(err)));
      }
      process.exit(1);
    }
  }

  if (!initResult) {
    spinner.fail('Publish failed');
    console.error(chalk.red(`Could not find an available slug after ${MAX_SLUG_ATTEMPTS} attempts.`));
    console.error(chalk.dim(`Tried: ${baseSlug}, ${baseSlug}-2, ..., ${baseSlug}-${MAX_SLUG_ATTEMPTS}`));
    process.exit(1);
  }

  // Save gameId + resolved publisher target to boardsmith.json for future publishes
  let configDirty = false;
  if (initResult.gameId !== config.gameId) {
    config.gameId = initResult.gameId;
    configDirty = true;
  }
  if (initResult.publisherId !== config.publisherId) {
    config.publisherId = initResult.publisherId;
    configDirty = true;
  }
  if (options.publisher && options.publisher !== config.publisher) {
    config.publisher = options.publisher;
    configDirty = true;
  }
  if (configDirty) {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  if (resolvedSlug !== baseSlug) {
    spinner.info(`Slug "${baseSlug}" was taken, using "${resolvedSlug}" instead.`);
    spinner.start('Publishing...');
  }

  // -- Upload --
  spinner.text = 'Uploading bundle...';
  try {
    await uploadBundle(initResult.uploadUrl, initResult.uploadCode, zip);
  } catch (err: unknown) {
    spinner.fail('Upload failed');
    await abortInFlightPublish(platformUrl, apiKey, initResult.versionId);
    if (isPublishError(err)) {
      console.error(chalk.red(err.message));
    } else {
      console.error(chalk.red(String(err)));
    }
    process.exit(1);
  }

  // -- Complete --
  spinner.text = 'Finalizing...';
  try {
    const result = await completePublish(platformUrl, apiKey, initResult.versionId);
    spinner.succeed('Published!');
    console.log('');
    console.log(chalk.green(`  ${displayName} v${version}`));
    console.log(chalk.green(`  ${result.gameUrl}`));
    console.log('');
  } catch (err: unknown) {
    spinner.fail('Finalize failed');
    await abortInFlightPublish(platformUrl, apiKey, initResult.versionId);
    if (isPublishError(err)) {
      console.error(chalk.red(err.message));
    } else {
      console.error(chalk.red(String(err)));
    }
    process.exit(1);
  }
}

/**
 * Best-effort cleanup after a failed upload/finalize. The platform only ever
 * deletes a still-"uploading" row, so this can never destroy a completed
 * publish; a cleanup failure is reported dimly but never masks the original
 * error.
 */
async function abortInFlightPublish(
  platformUrl: string,
  apiKey: string,
  versionId: string,
): Promise<void> {
  try {
    await abortPublish(platformUrl, apiKey, versionId);
  } catch {
    console.error(chalk.dim('(Could not clean up the in-flight version; it will be swept automatically.)'));
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
    console.error(chalk.red(isPublishError(err) ? err.message : String(err)));
    console.error(chalk.dim('Could not verify "audience" against the platform taxonomy. Check your connection and try again.'));
    process.exit(1);
  }

  const mismatch = describeAudienceMismatch(audience, audiences);
  if (!mismatch) return;

  console.error(chalk.red(mismatch[0]));
  for (const line of mismatch.slice(1)) {
    console.error(chalk.dim(line));
  }
  process.exit(1);
}

function toSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!SLUG_PATTERN.test(slug)) {
    console.error(chalk.red(`Cannot derive a valid slug from name "${name}".`));
    console.error(chalk.dim('The "name" field in boardsmith.json must produce a valid slug (lowercase alphanumeric with hyphens).'));
    process.exit(1);
  }
  return slug;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
