import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { styleText } from 'node:util';
import ora from 'ora';
import { getProjectContext } from '../lib/project-context.js';
import { buildCli, CLI_OUTFILE } from '../lib/build-cli.js';
import { resolveUserPath } from '../lib/user-path.js';
import { withCleanupAfter } from '../lib/command-build-dir.js';
import { takeOsLock } from '../lib/os-lock.js';
import { gitOutput } from '../lib/git-output.js';
import { filesContentHash } from '../lib/hash.js';
import { npmPackedFiles } from '../lib/npm-packed-files.js';

interface PackOptions {
  outDir?: string;
  /**
   * Repeatable. Every target is integrated from ONE pack, so each receives the
   * same tarball file.
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

/** The boardsmith package at the repository root. */
function readPackage(root: string): PackageInfo {
  const pkgJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  return {
    name: pkgJson.name || 'boardsmith',
    path: root,
    version: pkgJson.version || '0.0.1',
    revision: readContractRevision(root),
  };
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

/** The sha256 of every file `npm pack` would put in the tarball, first 12 hex characters. */
function packedContentHash(pkgPath: string): string {
  return filesContentHash(pkgPath, npmPackedFiles(pkgPath)).slice(0, 12);
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
 * ShufflewickPub's `vendor:boardsmith` cold (#239). The same goes for the
 * rewritten `package.json`, on a SIGINT or SIGTERM too (#744).
 */
async function packPackage(
  pkgPath: string,
  outputDir: string,
  version: string
): Promise<string> {
  const pkgJsonPath = join(pkgPath, 'package.json');
  const originalContent = readFileSync(pkgJsonPath, 'utf-8');
  const pkgJson = JSON.parse(originalContent);
  // Tarballs that were already here are the caller's, not ours to move or
  // remove. Only what this pack produced is in scope either way.
  const preexisting = new Set(tarballsIn(pkgPath));
  let npm: ChildProcess | undefined;

  const restore = (): void => {
    writeFileSync(pkgJsonPath, originalContent);
    for (const file of tarballsIn(pkgPath)) {
      if (!preexisting.has(file)) rmSync(join(pkgPath, file), { force: true });
    }
  };
  // 'exit', not 'close': a prepack script's own children can hold npm's output open.
  const stopNpm = async (): Promise<void> => {
    if (!npm || npm.exitCode !== null || npm.signalCode !== null) return;
    const exited = once(npm, 'exit');
    npm.kill();
    await exited;
  };

  return withCleanupAfter(restore, async () => {
    // Note: workspace: deps are left as-is; npm overrides in target handle resolution
    pkgJson.version = version;
    writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');

    // Asynchronous, so a SIGINT or SIGTERM reaches the restore while npm runs.
    npm = spawn('npm', ['pack'], { cwd: pkgPath, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    npm.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const [code, signal] = await once(npm, 'close');
    if (code !== 0) throw new Error(`npm pack exited with ${code ?? signal}: ${stderr.trim()}`);

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
  }, stopNpm);
}

/**
 * The lock file, in the checkout's own git directory, that keeps a second pack
 * from reading the first one's rewritten `package.json` as the original (#744).
 */
async function packLockFile(pkgPath: string): Promise<string> {
  try {
    const gitDir = await gitOutput(pkgPath, ['rev-parse', '--absolute-git-dir']);
    return join(gitDir.trim(), 'boardsmith-pack.flock');
  } catch {
    throw new Error(`${pkgPath} is not a git checkout. Run boardsmith pack from the BoardSmith repository root.`);
  }
}

/**
 * Pack the package into `outputPath`, leaving nothing behind if it fails.
 *
 * The output directory is created here rather than by the caller because
 * creating it is part of what has to be undone: a pack that fails must not
 * leave a half-filled directory tree that only exists because it was tried.
 * Only the part of the tree this call had to create is ever removed -- a
 * directory the user already had is theirs.
 */
export async function packInto(pkg: PackageInfo, outputPath: string): Promise<PackResult> {
  // `recursive` returns the topmost directory it had to create, or undefined
  // when the whole path already existed.
  const createdRoot = mkdirSync(outputPath, { recursive: true });

  try {
    const lock = await takeOsLock(await packLockFile(pkg.path), 'boardsmith pack', `boardsmith pack of ${pkg.name}`);
    if (typeof lock === 'string') throw new Error(lock);
    try {
      const version = packVersion(pkg);
      const tarball = await packPackage(pkg.path, outputPath, version);
      return { name: pkg.name, tarball, packVersion: version };
    } catch (error) {
      throw new Error(
        `npm pack failed for ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await lock.release();
    }
  } catch (error) {
    if (createdRoot !== undefined) {
      rmSync(createdRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Remove tarballs from a previous vendoring of the same package.
 *
 * Without this, `vendor/` accumulates every engine ever vendored — each one a
 * couple of megabytes of committed binary — and the directory listing stops
 * telling you which tarball is live.
 *
 * Scoped deliberately: only files matching the package we are packing right now,
 * and never the one we just wrote.
 */
export function pruneStaleTarballs(vendorDir: string, keep: string, packageName: string): string[] {
  if (!existsSync(vendorDir)) return [];

  // Match `<name>-<version>.tgz` and require the version to start with a
  // digit. A bare `startsWith('boardsmith-')` would also match
  // `boardsmith-extras-1.0.0.tgz` — a DIFFERENT package — and delete it.
  const tarballName = packageName.replace('@', '').replace('/', '-');
  const escaped = tarballName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}-\\d[^/]*\\.tgz$`);
  const removed: string[] = [];

  for (const file of readdirSync(vendorDir)) {
    if (!file.endsWith('.tgz') || file === keep) continue;
    if (!pattern.test(file)) continue;
    rmSync(join(vendorDir, file));
    removed.push(file);
  }

  return removed;
}

/**
 * Integrate the tarball into a target consumer project.
 * - Copies the tarball to target's vendor/ directory
 * - Removes tarballs left by a previous vendoring
 * - Updates target's package.json with a file: dependency
 * - Adds an npm override so nested deps resolve from vendor/
 * - Runs npm install in target
 */
async function integrateWithTarget(
  targetPath: string,
  sourceDir: string,
  result: PackResult
): Promise<void> {
  const absoluteTarget = resolveUserPath(process.cwd(), targetPath);
  const targetPkgJsonPath = join(absoluteTarget, 'package.json');

  // Validate target has package.json
  if (!existsSync(targetPkgJsonPath)) {
    console.error(styleText('red', `Error: No package.json found at ${absoluteTarget}`));
    console.error(styleText('dim', 'Make sure the target path is a valid npm project'));
    process.exit(1);
  }

  console.log(styleText('cyan', '\nIntegrating with target project...\n'));

  // Create vendor directory if missing
  const vendorDir = join(absoluteTarget, 'vendor');
  if (!existsSync(vendorDir)) {
    mkdirSync(vendorDir, { recursive: true });
    console.log(styleText('dim', `Created ${vendorDir}`));
  }

  const copySpinner = ora('Copying the tarball to vendor/').start();
  copyFileSync(join(sourceDir, result.tarball), join(vendorDir, result.tarball));
  copySpinner.succeed(`Copied ${result.tarball} to vendor/`);

  const pruned = pruneStaleTarballs(vendorDir, result.tarball, result.name);
  if (pruned.length > 0) {
    console.log(styleText('dim', `Removed ${pruned.length} stale tarball(s): ${pruned.join(', ')}`));
  }

  const targetPkgJson = JSON.parse(readFileSync(targetPkgJsonPath, 'utf-8'));
  const spec = `file:./vendor/${result.tarball}`;
  const updatedDeps: string[] = [];
  for (const field of ['dependencies', 'devDependencies'] as const) {
    if (targetPkgJson[field]?.[result.name] !== undefined) {
      targetPkgJson[field][result.name] = spec;
      updatedDeps.push(`${field}.${result.name}`);
    }
  }

  if (updatedDeps.length === 0) {
    console.log(styleText('yellow', `No ${result.name} dependency found in target package.json`));
    console.log(styleText('dim', 'Tarball copied but no dependencies updated'));
    return;
  }

  // The override makes a nested dependency on the package resolve from vendor/ too.
  targetPkgJson.overrides = { ...targetPkgJson.overrides, [result.name]: spec };
  console.log(styleText('dim', 'Added an override for nested dependency resolution'));

  // Write updated package.json
  writeFileSync(targetPkgJsonPath, JSON.stringify(targetPkgJson, null, 2) + '\n');
  console.log(styleText('dim', `Updated ${updatedDeps.length} dependencies in package.json`));

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
    console.error(styleText('red', `  ${errorMessage}`));
    process.exit(1);
  }

  // Print summary
  console.log(styleText('green', '\nTarget integration complete!\n'));
  console.log(styleText('dim', 'Updated dependencies:'));
  for (const dep of updatedDeps) {
    console.log(styleText('dim', `  ${dep}`));
  }
  console.log('');
}

/**
 * Validate that we're running from the BoardSmith repository root.
 * src/engine/ is the indicator.
 */
function validateRepoRoot(cwd: string): void {
  const rootPkgJson = join(cwd, 'package.json');

  if (!existsSync(rootPkgJson)) {
    console.error(styleText('red', 'Error: package.json not found'));
    console.error(styleText('dim', 'Make sure you are in the BoardSmith repository root'));
    process.exit(1);
  }

  // Check for src/engine/ which indicates BoardSmith repo
  const srcEngine = join(cwd, 'src', 'engine');
  if (!existsSync(srcEngine)) {
    console.error(styleText('red', 'Error: This command must be run from the BoardSmith repository root'));
    console.error(styleText('dim', 'Current directory does not contain src/engine/'));
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
 * Main pack command: pack the package with a content-derived version into the
 * output directory, and vendor it into each target.
 */
export async function packCommand(options: PackOptions): Promise<void> {
  const cwd = process.cwd();
  const outputPath = packOutputDir(cwd, options.outDir);

  // Check context - pack is only for the BoardSmith library, not game projects
  if (getProjectContext(cwd) === 'standalone') {
    console.error(styleText('red', 'Error: boardsmith pack is for packaging the BoardSmith library itself'));
    console.error(styleText('dim', 'You are in a standalone game project.'));
    console.error(styleText('dim', 'Games depend on boardsmith from npm or a local file: link.'));
    process.exit(1);
  }

  validateRepoRoot(cwd);

  console.log(styleText('cyan', '\nBoardSmith Pack\n'));

  // The tarball ships `dist/` — an installed BoardSmith runs the bundled CLI,
  // never the TypeScript sources. Rebuild it here, explicitly, so a tarball can
  // never carry a `dist/cli.js` older than the source it was packed from.
  const cliSpinner = ora('Building CLI bundle...').start();
  try {
    await buildCli(cwd);
    cliSpinner.succeed(`CLI bundle built (${CLI_OUTFILE})`);
  } catch (error) {
    cliSpinner.fail('CLI bundle build failed');
    console.error(styleText('red', error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  const pkg = readPackage(cwd);
  const packSpinner = ora(`Packing ${pkg.name}...`).start();
  let result: PackResult;
  try {
    result = await packInto(pkg, outputPath);
  } catch (error) {
    packSpinner.fail('Pack failed');
    // Rethrown rather than exited: cli.ts reports a thrown Error as one clean
    // line, and packInto has already put everything it touched back.
    throw error;
  }
  packSpinner.succeed(`Packed ${pkg.name}`);

  console.log(styleText('green', '\nPack complete!\n'));
  console.log(styleText('dim', `Output: ${outputPath}/`));
  console.log(styleText('dim', `Tarball: ${result.tarball}`));

  // If targets specified, integrate the SAME tarball with each of them.
  const targets = options.target ?? [];
  if (targets.length > 0) {
    for (const target of targets) {
      await integrateWithTarget(target, outputPath, result);
    }
  } else {
    console.log(styleText('cyan', '\nNext steps:'));
    console.log(styleText('dim', '  In your consumer project:'));
    console.log(styleText('dim', `  npm install ${outputPath}/${result.tarball}`));
    console.log('');
  }
}
