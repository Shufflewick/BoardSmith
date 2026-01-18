import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

interface PackOptions {
  outDir?: string;
}

interface PackageInfo {
  name: string;
  path: string;
  version: string;
}

interface PackResult {
  name: string;
  tarball: string;
  timestampVersion: string;
}

/**
 * Discover all public @boardsmith/* packages in the monorepo.
 * Scans packages/* and packages/games/* directories.
 */
function discoverPackages(monorepoRoot: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const packagesDir = join(monorepoRoot, 'packages');

  // Scan packages/* (depth 1)
  const topLevelDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'games');

  for (const dir of topLevelDirs) {
    const pkgJsonPath = join(packagesDir, dir.name, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      // Skip private packages
      if (pkgJson.private === true) {
        continue;
      }

      // Only include @boardsmith/* packages
      if (!pkgJson.name?.startsWith('@boardsmith/')) {
        continue;
      }

      packages.push({
        name: pkgJson.name,
        path: join(packagesDir, dir.name),
        version: pkgJson.version || '0.0.1',
      });
    }
  }

  // Scan packages/games/* (depth 2)
  const gamesDir = join(packagesDir, 'games');
  if (existsSync(gamesDir)) {
    const gameDirs = readdirSync(gamesDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of gameDirs) {
      const pkgJsonPath = join(gamesDir, dir.name, 'package.json');
      if (existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

        // Skip private packages
        if (pkgJson.private === true) {
          continue;
        }

        // Only include @boardsmith/* packages
        if (!pkgJson.name?.startsWith('@boardsmith/')) {
          continue;
        }

        packages.push({
          name: pkgJson.name,
          path: join(gamesDir, dir.name),
          version: pkgJson.version || '0.0.1',
        });
      }
    }
  }

  return packages;
}

/**
 * Generate a timestamp-based version string.
 * Format: baseVersion-YYYYMMDDHHMMSS (e.g., 1.0.0-20260118123456)
 */
function generateTimestampVersion(baseVersion: string): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .slice(0, 14); // YYYYMMDDHHMMSS
  return `${baseVersion}-${timestamp}`;
}

/**
 * Pack a single package with a timestamp version.
 * Returns the tarball filename.
 */
function packPackage(pkgPath: string, outputDir: string, timestampVersion: string): string {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = readFileSync(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(originalContent);
  const originalVersion = pkgJson.version;

  try {
    // Write modified package.json with timestamp version
    pkgJson.version = timestampVersion;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

    // Run npm pack in the package directory
    execSync('npm pack', {
      cwd: pkgPath,
      stdio: 'pipe',
    });

    // Find the generated tarball (npm pack creates it in the package dir)
    const tarballName = `${pkgJson.name.replace('@', '').replace('/', '-')}-${timestampVersion}.tgz`;
    const generatedTarball = join(pkgPath, tarballName);

    // Move tarball to output directory
    const destTarball = join(outputDir, tarballName);
    if (existsSync(generatedTarball)) {
      renameSync(generatedTarball, destTarball);
    } else {
      // npm pack might use a different naming scheme, find the .tgz file
      const files = readdirSync(pkgPath).filter(f => f.endsWith('.tgz'));
      if (files.length === 1) {
        renameSync(join(pkgPath, files[0]), destTarball);
      } else {
        throw new Error(`Could not find generated tarball in ${pkgPath}`);
      }
    }

    return basename(destTarball);
  } finally {
    // Always restore original package.json
    writeFileSync(pkgJsonPath, originalContent);
  }
}

/**
 * Validate that we're running from a monorepo root.
 */
function validateMonorepoRoot(cwd: string): void {
  const rootPkgJson = join(cwd, 'package.json');

  if (!existsSync(rootPkgJson)) {
    console.error(chalk.red('Error: package.json not found'));
    console.error(chalk.dim('Make sure you are in the BoardSmith monorepo root'));
    process.exit(1);
  }

  const pkgJson = JSON.parse(readFileSync(rootPkgJson, 'utf-8'));

  if (pkgJson.private !== true) {
    console.error(chalk.red('Error: Root package.json must have "private": true'));
    console.error(chalk.dim('Make sure you are in the BoardSmith monorepo root'));
    process.exit(1);
  }

  if (!pkgJson.workspaces || !Array.isArray(pkgJson.workspaces)) {
    console.error(chalk.red('Error: Root package.json must have "workspaces" array'));
    console.error(chalk.dim('Make sure you are in the BoardSmith monorepo root'));
    process.exit(1);
  }
}

/**
 * Main pack command: discover packages, pack them with timestamp versions,
 * and collect tarballs in output directory.
 */
export async function packCommand(options: PackOptions): Promise<void> {
  const cwd = process.cwd();
  const outDir = options.outDir || '.boardsmith/tarballs';
  const outputPath = join(cwd, outDir);

  // Validate we're in monorepo root
  validateMonorepoRoot(cwd);

  console.log(chalk.cyan('\nBoardSmith Pack\n'));

  // Discover packages
  const spinner = ora('Discovering packages...').start();
  const packages = discoverPackages(cwd);

  if (packages.length === 0) {
    spinner.fail('No public @boardsmith/* packages found');
    process.exit(1);
  }

  spinner.succeed(`Found ${packages.length} public packages`);

  // Create output directory
  mkdirSync(outputPath, { recursive: true });

  // Generate single timestamp for all packages (consistent snapshot)
  const timestamp = generateTimestampVersion('0.0.0').split('-')[1]; // Just get the timestamp part
  const results: PackResult[] = [];

  // Pack each package
  for (const pkg of packages) {
    const pkgSpinner = ora(`Packing ${pkg.name}...`).start();

    try {
      const timestampVersion = `${pkg.version}-${timestamp}`;
      const tarball = packPackage(pkg.path, outputPath, timestampVersion);
      results.push({
        name: pkg.name,
        tarball,
        timestampVersion,
      });
      pkgSpinner.succeed(`Packed ${pkg.name}`);
    } catch (error) {
      pkgSpinner.fail(`Failed to pack ${pkg.name}`);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`  npm pack failed for ${pkg.name}: ${errorMessage}`));
      process.exit(1);
    }
  }

  // Print summary
  console.log(chalk.green('\nPack complete!\n'));
  console.log(chalk.dim(`Output: ${outDir}/`));
  console.log(chalk.dim('Tarballs:'));
  for (const result of results) {
    console.log(chalk.dim(`  ${result.tarball}`));
  }

  console.log(chalk.cyan('\nNext steps:'));
  console.log(chalk.dim('  In your consumer project:'));
  console.log(chalk.dim(`  npm install ${outputPath}/<package>.tgz`));
  console.log('');
}
