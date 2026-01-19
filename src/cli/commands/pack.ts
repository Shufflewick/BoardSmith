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
 * Detect if we're running in the BoardSmith monorepo or a standalone game project.
 * - Monorepo: Has src/engine/ directory (collapsed structure)
 * - Standalone: Has boardsmith.json but no src/engine/
 */
function getProjectContext(cwd: string): 'monorepo' | 'standalone' {
  const hasSrcEngine = existsSync(join(cwd, 'src', 'engine'));
  const hasBoardsmithJson = existsSync(join(cwd, 'boardsmith.json'));

  // If we're in the monorepo root, it has src/engine
  if (hasSrcEngine) return 'monorepo';

  // Standalone game project
  if (hasBoardsmithJson) return 'standalone';

  // Fallback - treat as standalone (will fail with proper error if neither)
  return 'standalone';
}

/**
 * Check if a package name is a BoardSmith package.
 * Includes the new 'boardsmith' single package name for backwards compatibility.
 */
function isBoardSmithPackage(name: string | undefined): boolean {
  if (!name) return false;
  // New single package name after monorepo collapse
  if (name === 'boardsmith') return true;
  // Legacy @boardsmith/* scoped packages (for backwards compatibility)
  return name.startsWith('@boardsmith/') || name === 'eslint-plugin-boardsmith';
}

/**
 * Discover the single boardsmith package at the monorepo root.
 * After monorepo collapse, there's only one package to pack.
 */
function discoverPackages(monorepoRoot: string): PackageInfo[] {
  const rootPkgJson = join(monorepoRoot, 'package.json');
  const pkgJson = JSON.parse(readFileSync(rootPkgJson, 'utf-8'));

  // Only return the root package
  return [{
    name: pkgJson.name || 'boardsmith',
    path: monorepoRoot,
    version: pkgJson.version || '0.0.1',
  }];
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
function packPackage(
  pkgPath: string,
  outputDir: string,
  timestampVersion: string
): string {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = readFileSync(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(originalContent);

  try {
    // Write modified package.json with timestamp version
    // Note: workspace: deps are left as-is; npm overrides in target handle resolution
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
 * Integrate tarballs into a target consumer project.
 * - Copies tarballs to target's vendor/ directory
 * - Updates target's package.json with file: dependencies
 * - Adds npm overrides for all packages to resolve nested deps from vendor/
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

  // Add overrides for all BoardSmith packages
  // This ensures nested dependencies (workspace:* in tarballs) resolve from vendor/
  if (!targetPkgJson.overrides) {
    targetPkgJson.overrides = {};
  }
  for (const [pkgName, tarball] of tarballMap) {
    targetPkgJson.overrides[pkgName] = `file:./vendor/${tarball}`;
  }
  console.log(chalk.dim(`Added ${tarballMap.size} overrides for nested dependency resolution`));

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
 * Validate that we're running from the BoardSmith repository root.
 * After monorepo collapse, we check for src/engine/ as the indicator.
 */
function validateMonorepoRoot(cwd: string): void {
  const rootPkgJson = join(cwd, 'package.json');

  if (!existsSync(rootPkgJson)) {
    console.error(chalk.red('Error: package.json not found'));
    console.error(chalk.dim('Make sure you are in the BoardSmith repository root'));
    process.exit(1);
  }

  // Check for src/engine/ which indicates BoardSmith repo
  const srcEngine = join(cwd, 'src', 'engine');
  if (!existsSync(srcEngine)) {
    console.error(chalk.red('Error: This command must be run from the BoardSmith repository root'));
    console.error(chalk.dim('Current directory does not contain src/engine/'));
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

  // Check context - pack is only for the BoardSmith library, not game projects
  if (getProjectContext(cwd) === 'standalone') {
    console.error(chalk.red('Error: boardsmith pack is for packaging the BoardSmith library itself'));
    console.error(chalk.dim('You are in a standalone game project.'));
    console.error(chalk.dim('Games depend on boardsmith from npm or a local file: link.'));
    process.exit(1);
  }

  // Validate we're in monorepo root
  validateMonorepoRoot(cwd);

  console.log(chalk.cyan('\nBoardSmith Pack\n'));

  // Discover packages
  const spinner = ora('Discovering packages...').start();
  const packages = discoverPackages(cwd);

  if (packages.length === 0) {
    spinner.fail('No boardsmith package found');
    process.exit(1);
  }

  spinner.succeed(`Found ${packages.length} package to pack`);

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
