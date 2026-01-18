import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

interface PackOptions {
  outDir?: string;
  target?: string;
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
 * Check if a package name is a BoardSmith package.
 * Includes @boardsmith/* scoped packages and eslint-plugin-boardsmith.
 */
function isBoardSmithPackage(name: string | undefined): boolean {
  if (!name) return false;
  return name.startsWith('@boardsmith/') || name === 'eslint-plugin-boardsmith';
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

      // Only include BoardSmith packages
      if (!isBoardSmithPackage(pkgJson.name)) {
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
 * Resolve workspace: protocol dependencies to file: protocol.
 * Converts "workspace:*" to "file:./vendor/{tarball}" for external use.
 */
function resolveWorkspaceDeps(
  deps: Record<string, string> | undefined,
  tarballMap: Map<string, string>
): Record<string, string> | undefined {
  if (!deps) return deps;

  const resolved: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith('workspace:')) {
      const tarball = tarballMap.get(name);
      if (tarball) {
        // Use file:./vendor/ path for the tarball
        resolved[name] = `file:./vendor/${tarball}`;
      } else {
        // Keep original if not a packaged BoardSmith package
        resolved[name] = version;
      }
    } else {
      resolved[name] = version;
    }
  }
  return resolved;
}

/**
 * Pack a single package with a timestamp version.
 * Resolves workspace: dependencies to file: protocol for external use.
 * Returns the tarball filename.
 */
function packPackage(
  pkgPath: string,
  outputDir: string,
  timestampVersion: string,
  tarballMap: Map<string, string>
): string {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = readFileSync(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(originalContent);

  try {
    // Write modified package.json with timestamp version and resolved deps
    pkgJson.version = timestampVersion;
    pkgJson.dependencies = resolveWorkspaceDeps(pkgJson.dependencies, tarballMap);
    pkgJson.devDependencies = resolveWorkspaceDeps(pkgJson.devDependencies, tarballMap);
    pkgJson.peerDependencies = resolveWorkspaceDeps(pkgJson.peerDependencies, tarballMap);
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
 * Integrate tarballs into a target consumer project.
 * - Copies tarballs to target's vendor/ directory
 * - Updates target's package.json with file: dependencies
 * - Runs npm install in target
 */
async function integrateWithTarget(
  targetPath: string,
  sourceDir: string,
  results: PackResult[]
): Promise<void> {
  const absoluteTarget = resolve(targetPath);
  const targetPkgJsonPath = join(absoluteTarget, 'package.json');

  // Validate target has package.json
  if (!existsSync(targetPkgJsonPath)) {
    console.error(chalk.red(`Error: No package.json found at ${absoluteTarget}`));
    console.error(chalk.dim('Make sure the target path is a valid npm project'));
    process.exit(1);
  }

  console.log(chalk.cyan('\nIntegrating with target project...\n'));

  // Create vendor directory if missing
  const vendorDir = join(absoluteTarget, 'vendor');
  if (!existsSync(vendorDir)) {
    mkdirSync(vendorDir, { recursive: true });
    console.log(chalk.dim(`Created ${vendorDir}`));
  }

  // Copy tarballs to vendor/
  const copySpinner = ora('Copying tarballs to vendor/').start();
  for (const result of results) {
    const sourceTarball = join(sourceDir, result.tarball);
    const destTarball = join(vendorDir, result.tarball);
    copyFileSync(sourceTarball, destTarball);
  }
  copySpinner.succeed(`Copied ${results.length} tarballs to vendor/`);

  // Read and update target's package.json
  const targetPkgJson = JSON.parse(readFileSync(targetPkgJsonPath, 'utf-8'));
  const updatedDeps: string[] = [];

  // Build a map from package name to tarball filename
  const tarballMap = new Map<string, string>();
  for (const result of results) {
    tarballMap.set(result.name, result.tarball);
  }

  // Update dependencies if they reference BoardSmith packages
  if (targetPkgJson.dependencies) {
    for (const pkgName of Object.keys(targetPkgJson.dependencies)) {
      const tarball = tarballMap.get(pkgName);
      if (tarball) {
        targetPkgJson.dependencies[pkgName] = `file:./vendor/${tarball}`;
        updatedDeps.push(`dependencies.${pkgName}`);
      }
    }
  }

  // Update devDependencies if they reference BoardSmith packages
  if (targetPkgJson.devDependencies) {
    for (const pkgName of Object.keys(targetPkgJson.devDependencies)) {
      const tarball = tarballMap.get(pkgName);
      if (tarball) {
        targetPkgJson.devDependencies[pkgName] = `file:./vendor/${tarball}`;
        updatedDeps.push(`devDependencies.${pkgName}`);
      }
    }
  }

  if (updatedDeps.length === 0) {
    console.log(chalk.yellow('No BoardSmith dependencies found in target package.json'));
    console.log(chalk.dim('Tarballs copied but no dependencies updated'));
    return;
  }

  // Write updated package.json
  writeFileSync(targetPkgJsonPath, JSON.stringify(targetPkgJson, null, 2) + '\n');
  console.log(chalk.dim(`Updated ${updatedDeps.length} dependencies in package.json`));

  // Run npm install in target
  const installSpinner = ora('Running npm install in target...').start();
  try {
    execSync('npm install', {
      cwd: absoluteTarget,
      stdio: 'pipe',
    });
    installSpinner.succeed('npm install completed');
  } catch (error) {
    installSpinner.fail('npm install failed');
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ${errorMessage}`));
    process.exit(1);
  }

  // Print summary
  console.log(chalk.green('\nTarget integration complete!\n'));
  console.log(chalk.dim('Updated dependencies:'));
  for (const dep of updatedDeps) {
    console.log(chalk.dim(`  ${dep}`));
  }
  console.log('');
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

  // Build tarball map upfront so we can resolve workspace: deps to file: deps
  // The tarball name is computed from package name and timestamp version
  const tarballMap = new Map<string, string>();
  for (const pkg of packages) {
    const timestampVersion = `${pkg.version}-${timestamp}`;
    const tarballName = `${pkg.name.replace('@', '').replace('/', '-')}-${timestampVersion}.tgz`;
    tarballMap.set(pkg.name, tarballName);
  }

  // Pack each package
  for (const pkg of packages) {
    const pkgSpinner = ora(`Packing ${pkg.name}...`).start();

    try {
      const timestampVersion = `${pkg.version}-${timestamp}`;
      const tarball = packPackage(pkg.path, outputPath, timestampVersion, tarballMap);
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

  // If target specified, integrate with target project
  if (options.target) {
    await integrateWithTarget(options.target, outputPath, results);
  } else {
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.dim('  In your consumer project:'));
    console.log(chalk.dim(`  npm install ${outputPath}/<package>.tgz`));
    console.log('');
  }
}
