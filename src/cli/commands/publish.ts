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
  isPublishError,
} from '../lib/publish-api.js';
import { buildCommand } from './build.js';
import { validateCommand } from './validate.js';

interface PublishOptions {
  apiKey?: string;
  test?: boolean;
  dryRun?: boolean;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_ATTEMPTS = 10;

export async function publishCommand(options: PublishOptions): Promise<void> {
  const cwd = process.cwd();

  // -- Resolve API key --
  let apiKey = options.apiKey;

  if (apiKey) {
    if (!apiKey.startsWith('spk_')) {
      console.error(chalk.red('API key must start with spk_'));
      process.exit(1);
    }
    saveApiKey(apiKey);
    console.log(chalk.green('API key saved.'));
  } else {
    apiKey = getApiKey();
    if (!apiKey) {
      console.error(chalk.red('No API key configured.'));
      console.error(chalk.dim('Run: boardsmith publish --api-key spk_YOUR_KEY'));
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
  const platformUrl = getPlatformUrl(!!options.test);

  console.log(chalk.cyan(`\nPublishing ${displayName} v${version}\n`));
  console.log(chalk.dim(`  Platform:  ${platformUrl}`));
  console.log(chalk.dim(`  API Key:   ${apiKey.slice(0, 12)}...`));
  console.log('');

  // -- Validate (exits process on failure) --
  console.log(chalk.cyan('Running pre-publish validation...\n'));
  await validateCommand({ fix: false, skipSimulation: false });

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

  // -- Resolve game identity --
  // Prefer gameId from boardsmith.json (stable across slug changes).
  // Fall back to slug derivation if no gameId (first publish or deleted).
  const existingGameId: string | undefined = config.gameId;
  const baseSlug = toSlug(config.name || pkg.name || 'game');

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
        console.error(chalk.red(`Version ${version} already exists for this game.`));
        console.error(chalk.dim('Bump the version in package.json and try again.'));
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

  // Save gameId to boardsmith.json for future publishes
  if (initResult.gameId !== config.gameId) {
    config.gameId = initResult.gameId;
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
    if (isPublishError(err)) {
      console.error(chalk.red(err.message));
    } else {
      console.error(chalk.red(String(err)));
    }
    process.exit(1);
  }
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
