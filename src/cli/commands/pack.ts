import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import { getProjectContext } from '../lib/project-context.js';
import { buildCli, CLI_OUTFILE } from '../lib/build-cli.js';
import { resolveUserPath } from '../lib/user-path.js';

interface PackOptions {
  outDir?: string;
  /**
   * Repeatable. Multiple targets are integrated from ONE pack, so every target
   * receives the same tarball file.
   *
   * ShufflewickPub vendors into both `games/` and `executor/` — one validates
   * uploads, the other runs them — and a split between those two lets the
   * platform accept a bundle it cannot run. One pack rules the split out even
   * if the tree changes between two separate runs.
   */
  target?: string[];
}

interface PackageInfo {
  name: string;
  path: string;
  version: string;
  /** The engine contract revision the packed tree records. */
  revision: number;
}

interface PackResult {
  name: string;
  tarball: string;
  /** The version written into the packed `package.json`; see `packVersion`. */
  packVersion: string;
}

/**
 * Check if a package name is a BoardSmith package.
 */
function isBoardSmithPackage(name: string | undefined): boolean {
  if (!name) return false;
  return name === 'boardsmith' || name === 'eslint-plugin-boardsmith';
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
    revision: readContractRevision(monorepoRoot),
  }];
}

/**
 * The engine contract revision recorded in the tree at `root`.
 *
 * Read from the file on disk, not from the `ENGINE_REVISION` this CLI was
 * built with: the running CLI can be older than the tree it is packing.
 */
export function readContractRevision(root: string): number {
  const contractPath = join(root, 'src', 'contract', 'engine-contract.json');
  if (!existsSync(contractPath)) {
    throw new Error(
      `No engine contract at ${contractPath}. Run boardsmith pack from the BoardSmith repository root.`,
    );
  }
  const revision: unknown = JSON.parse(readFileSync(contractPath, 'utf-8')).revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new Error(
      `${contractPath} has no valid revision (found ${JSON.stringify(revision)}). ` +
        'Restore it from git before packing.',
    );
  }
  return revision;
}

/**
 * The sha256 of every file `npm pack` would put in the tarball, first 12 hex
 * characters.
 *
 * The file list is npm's own (`npm pack --dry-run`), so the `files` globs in
 * `package.json` are applied by the program that applies them for real.
 * Paths are sorted, and each path and length is hashed beside its bytes so
 * moving content between files cannot collide.
 */
function packedContentHash(pkgPath: string): string {
  const [report] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: pkgPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as [{ files: { path: string }[] }];
  const paths = report.files.map((file) => file.path).sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    const content = readFileSync(join(pkgPath, path));
    hash.update(`${path}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * The version a pack writes into `package.json`:
 * `<version>-r<contract revision>-<content hash>`, e.g. `0.0.1-r115-3fa9c2d41b7e`.
 *
 * Derived from the tree and nothing else, so packing the same tree twice gives
 * the same tarball name and, because `npm pack` fixes mtimes and ownership,
 * the same bytes. A consumer that re-vendors unchanged sources sees no change
 * (#434). The revision and hash are one prerelease identifier, joined by `-`
 * rather than `.`: a hash that happened to be all digits with a leading zero
 * would be an invalid semver identifier on its own.
 */
function packVersion(pkg: PackageInfo): string {
  return `${pkg.version}-r${pkg.revision}-${packedContentHash(pkg.path)}`;
}

/** The `.tgz` filenames currently sitting in a directory. */
function tarballsIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.tgz'));
}

/**
 * Pack a single package with its pack version.
 * Returns the tarball filename.
 *
 * `npm pack` writes into the package directory, so this owns getting the
 * tarball back out of the source tree on every path including the failing one:
 * `*.tgz` is not gitignored, and a stray one is a dirty checkout that stops
 * ShufflewickPub's `vendor:boardsmith` cold (#239).
 */
function packPackage(
  pkgPath: string,
  outputDir: string,
  version: string
): string {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = readFileSync(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(originalContent);
  // Tarballs that were already here are the caller's, not ours to move or
  // remove. Only what this pack produced is in scope either way.
  const preexisting = new Set(tarballsIn(pkgPath));

  try {
    // Write modified package.json with the pack version
    // Note: workspace: deps are left as-is; npm overrides in target handle resolution
    pkgJson.version = version;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

    // Run npm pack in the package directory
    execSync('npm pack', {
      cwd: pkgPath,
      stdio: 'pipe',
    });

    // Find the generated tarball (npm pack creates it in the package dir)
    const tarballName = `${pkgJson.name.replace('@', '').replace('/', '-')}-${version}.tgz`;
    const generatedTarball = join(pkgPath, tarballName);

    // Move tarball to output directory
    const destTarball = join(outputDir, tarballName);
    if (existsSync(generatedTarball)) {
      renameSync(generatedTarball, destTarball);
    } else {
      // npm pack might use a different naming scheme, find the .tgz file
      const files = tarballsIn(pkgPath).filter((f) => !preexisting.has(f));
      if (files.length === 1) {
        renameSync(join(pkgPath, files[0]), destTarball);
      } else {
        throw new Error(`Could not find generated tarball in ${pkgPath}`);
      }
    }

    return basename(destTarball);
  } catch (error) {
    // A failure after `npm pack` ran leaves its tarball in the package
    // directory. Take it back out before reporting.
    for (const file of tarballsIn(pkgPath)) {
      if (!preexisting.has(file)) rmSync(join(pkgPath, file), { force: true });
    }
    throw error;
  } finally {
    // Always restore original package.json
    writeFileSync(pkgJsonPath, originalContent);
  }
}

/**
 * Pack every package into `outputPath`, leaving nothing behind if any of them
 * fails.
 *
 * The output directory is created here rather than by the caller because
 * creating it is part of what has to be undone: a pack that fails must not
 * leave a half-filled directory tree that only exists because it was tried.
 * Only the part of the tree this call had to create is ever removed -- a
 * directory the user already had is theirs.
 */
export function packAll(
  packages: PackageInfo[],
  outputPath: string,
): PackResult[] {
  // `recursive` returns the topmost directory it had to create, or undefined
  // when the whole path already existed.
  const createdRoot = mkdirSync(outputPath, { recursive: true });
  const results: PackResult[] = [];

  try {
    for (const pkg of packages) {
      let version: string;
      let tarball: string;
      try {
        version = packVersion(pkg);
        tarball = packPackage(pkg.path, outputPath, version);
      } catch (error) {
        throw new Error(
          `npm pack failed for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      results.push({ name: pkg.name, tarball, packVersion: version });
    }
    return results;
  } catch (error) {
    if (createdRoot !== undefined) {
      rmSync(createdRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Remove tarballs from a previous vendoring of the same packages.
 *
 * Without this, `vendor/` accumulates every engine ever vendored — each one a
 * couple of megabytes of committed binary — and the directory listing stops
 * telling you which tarball is live.
 *
 * Scoped deliberately: only files matching a package we are packing right now,
 * and never the one we just wrote.
 */
export function pruneStaleTarballs(vendorDir: string, keep: Set<string>, packageNames: string[]): string[] {
  if (!existsSync(vendorDir)) return [];

  // Match `<name>-<version>.tgz` and require the version to start with a
  // digit. A bare `startsWith('boardsmith-')` would also match
  // `boardsmith-extras-1.0.0.tgz` — a DIFFERENT package — and delete it.
  const patterns = packageNames.map((name) => {
    const tarballName = name.replace('@', '').replace('/', '-');
    const escaped = tarballName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-\\d[^/]*\\.tgz$`);
  });
  const removed: string[] = [];

  for (const file of readdirSync(vendorDir)) {
    if (!file.endsWith('.tgz') || keep.has(file)) continue;
    if (!patterns.some((pattern) => pattern.test(file))) continue;
    rmSync(join(vendorDir, file));
    removed.push(file);
  }

  return removed;
}

/**
 * Integrate tarballs into a target consumer project.
 * - Copies tarballs to target's vendor/ directory
 * - Removes tarballs left by a previous vendoring
 * - Updates target's package.json with file: dependencies
 * - Adds npm overrides for all packages to resolve nested deps from vendor/
 * - Runs npm install in target
 */
async function integrateWithTarget(
  targetPath: string,
  sourceDir: string,
  results: PackResult[]
): Promise<void> {
  const absoluteTarget = resolveUserPath(process.cwd(), targetPath);
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

  const pruned = pruneStaleTarballs(
    vendorDir,
    new Set(results.map((r) => r.tarball)),
    results.map((r) => r.name),
  );
  if (pruned.length > 0) {
    console.log(chalk.dim(`Removed ${pruned.length} stale tarball(s): ${pruned.join(', ')}`));
  }

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

/** Where tarballs go when `--out-dir` is not given. */
const DEFAULT_OUT_DIR = '.boardsmith/tarballs';

/**
 * Where `--out-dir` points, absolute.
 *
 * ONE value, used for the tarballs and for every path printed in the summary,
 * so the "Output:" and "Next steps" lines can never name a directory the file
 * is not in (#239).
 */
export function packOutputDir(cwd: string, outDir: string | undefined): string {
  return resolveUserPath(cwd, outDir ?? DEFAULT_OUT_DIR);
}

/**
 * Main pack command: discover packages, pack them with content-derived versions,
 * and collect tarballs in output directory.
 */
export async function packCommand(options: PackOptions): Promise<void> {
  const cwd = process.cwd();
  const outputPath = packOutputDir(cwd, options.outDir);

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

  // The tarball ships `dist/` — an installed BoardSmith runs the bundled CLI,
  // never the TypeScript sources. Rebuild it here, explicitly, so a tarball can
  // never carry a `dist/cli.js` older than the source it was packed from.
  const cliSpinner = ora('Building CLI bundle...').start();
  try {
    await buildCli(cwd);
    cliSpinner.succeed(`CLI bundle built (${CLI_OUTFILE})`);
  } catch (error) {
    cliSpinner.fail('CLI bundle build failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  // Discover packages
  const spinner = ora('Discovering packages...').start();
  let packages: PackageInfo[];
  try {
    packages = discoverPackages(cwd);
  } catch (error) {
    spinner.fail('Could not read the package to pack');
    throw error;
  }

  if (packages.length === 0) {
    spinner.fail('No boardsmith package found');
    process.exit(1);
  }

  spinner.succeed(`Found ${packages.length} package to pack`);

  const packSpinner = ora(`Packing ${packages.map((p) => p.name).join(', ')}...`).start();
  let results: PackResult[];
  try {
    results = packAll(packages, outputPath);
  } catch (error) {
    packSpinner.fail('Pack failed');
    // Rethrown rather than exited: cli.ts reports a thrown Error as one clean
    // line, and packAll has already put everything it touched back.
    throw error;
  }
  packSpinner.succeed(`Packed ${results.map((r) => r.name).join(', ')}`);

  // Print summary
  console.log(chalk.green('\nPack complete!\n'));
  console.log(chalk.dim(`Output: ${outputPath}/`));
  console.log(chalk.dim('Tarballs:'));
  for (const result of results) {
    console.log(chalk.dim(`  ${result.tarball}`));
  }

  // If targets specified, integrate the SAME tarballs with each of them.
  const targets = options.target ?? [];
  if (targets.length > 0) {
    for (const target of targets) {
      await integrateWithTarget(target, outputPath, results);
    }
  } else {
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.dim('  In your consumer project:'));
    console.log(chalk.dim(`  npm install ${outputPath}/<package>.tgz`));
    console.log('');
  }
}
