import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { scanSandboxViolations } from '../lib/sandbox-scan.js';
import { findUnknownKeys } from '../lib/config-schema.js';
import { MAX_BUNDLE_SIZE, describeZipSizeViolation } from '../lib/bundle-limits.js';
import { readDistDir, createZip } from '../lib/zip.js';

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}

export async function validateCommand(): Promise<void> {
  const cwd = process.cwd();

  // Validate project exists
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  console.log(chalk.cyan('\nValidating game...\n'));

  const results: ValidationResult[] = [];

  // 1. Check metadata completeness
  results.push(await validateMetadata(cwd));

  // 2. TypeScript compilation
  results.push(await validateTypeScript(cwd));

  // 3. Security checks (forbidden APIs)
  results.push(await validateSecurity(cwd));

  // 4. Asset path check (absolute paths break on platform)
  results.push(await validateAssetPaths(cwd));

  // 5. Bundle size check
  results.push(await validateBundleSize(cwd));

  // 6. Required files check
  results.push(await validateRequiredFiles(cwd));

  if (!printResults(results)) {
    console.log(chalk.red('Validation failed. Please fix the issues above.\n'));
    process.exit(1);
  }

  printSuccessGuidance();
}

/** Prints every check's verdict and its failure detail. Returns whether all passed. */
function printResults(results: ValidationResult[]): boolean {
  console.log(chalk.cyan('\nValidation Results:\n'));

  for (const result of results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(`  ${icon} ${result.name}: ${status}`);
    if (result.passed) continue;

    console.log(chalk.dim(`    ${result.message}`));
    for (const detail of result.details ?? []) {
      console.log(chalk.dim(`      - ${detail}`));
    }
  }

  console.log('');
  return results.every((result) => result.passed);
}

function printSuccessGuidance(): void {
  console.log(chalk.green('All validation checks passed!\n'));
  console.log(chalk.cyan('Next steps:'));
  console.log(chalk.dim('  boardsmith dev      - Test gameplay and check for runtime warnings'));
  console.log(chalk.dim('  boardsmith build    - Build for production'));
  console.log(chalk.dim('  boardsmith publish  - Publish to boardsmith.io\n'));
  console.log(chalk.yellow('Tip:') + chalk.dim(' Run `boardsmith dev` and play through your game.'));
  console.log(chalk.dim('     The engine will warn about issues like:'));
  console.log(chalk.dim('     - Flow steps referencing non-existent actions'));
  console.log(chalk.dim('     - Element reference comparisons instead of ID comparisons\n'));
}

/**
 * Pure metadata-issue checker (T-135-09/T-135-10/T-135-11). Extracted from
 * validateMetadata so it can be unit-tested directly against a parsed config
 * object, mirroring build.ts's exported `deriveManifest` pattern.
 *
 * player count is NOT validated here (CLIX-01): gameDefinition (compiled
 * rules) is the sole source of truth for player count. A leftover
 * `playerCount` key in boardsmith.json is flagged as an unknown/removed key
 * with a pointed migration message, not required or shape-checked.
 */
export function checkMetadataIssues(config: Record<string, unknown>): string[] {
  const issues: string[] = [];

  // Required fields. audience/tags/playtime/cooperative seed the platform's
  // game record on first publish, so a manifest without them can't publish.
  const required = ['name', 'displayName', 'description', 'audience', 'tags', 'playtime', 'cooperative'];
  for (const field of required) {
    if (config[field] === undefined || config[field] === null || config[field] === '') {
      issues.push(`Missing required field: ${field}`);
    }
  }

  issues.push(...checkTaxonomyShape(config));

  // Unknown top-level keys — did-you-mean suggestions from the shared
  // allowed-key set (CLIX-02). Removed/renamed keys get pointed migration
  // messages instead of a generic did-you-mean (CLIX-01).
  for (const { key, suggestion } of findUnknownKeys(config)) {
    if (key === 'ui') {
      issues.push(
        "Unknown key 'ui' — a game's UIs are declared in src/ui/uis.ts (defineGameUIs), "
        + 'which is the single source of truth for which boards exist and which one ships. '
        + 'Remove this key from boardsmith.json.',
      );
    } else if (key === 'playerCount') {
      issues.push(
        "Unknown key 'playerCount' — player count is now derived from your gameDefinition (compiled rules), remove this key from boardsmith.json.",
      );
    } else if (key === 'categories') {
      issues.push(
        "Unknown key 'categories' — replaced by 'audience' (a single string: who the game is for). Genre/theme/mechanism labels belong in 'tags'.",
      );
    } else if (key === 'estimatedDuration') {
      issues.push(
        "Unknown key 'estimatedDuration' — replaced by 'playtime': { \"min\": <minutes>, \"max\": <minutes> }.",
      );
    } else if (suggestion) {
      issues.push(`Unknown key '${key}' — did you mean '${suggestion}'?`);
    } else {
      issues.push(`Unknown key '${key}' — not a recognized boardsmith.json field.`);
    }
  }


  return issues;
}

/**
 * Shape checks for the taxonomy fields (audience/tags/playtime/cooperative).
 * SHAPE only — deliberately offline. The canonical audience VALUE list is
 * platform curation (GET /api/taxonomy); `boardsmith publish` preflight
 * validates the value, and the server is the final authority.
 * Missing fields are reported by the required-field loop, not here.
 */
export function checkTaxonomyShape(config: Record<string, unknown>): string[] {
  const issues: string[] = [];

  if (config.audience !== undefined && (typeof config.audience !== 'string' || config.audience.length === 0)) {
    issues.push('"audience" must be a non-empty string (e.g. "casual") — who the game is for.');
  }

  if (config.tags !== undefined) {
    const tags = config.tags;
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string' || t.length === 0)) {
      issues.push('"tags" must be an array of non-empty strings (e.g. ["abstract", "classic"]).');
    }
  }

  if (config.playtime !== undefined) {
    issues.push(...checkPlaytimeShape(config.playtime));
  }

  if (config.cooperative !== undefined && typeof config.cooperative !== 'boolean') {
    issues.push('"cooperative" must be a boolean — true when players win or lose together.');
  }

  if (config.colorPalette !== undefined) {
    issues.push(...checkColorPaletteShape(config.colorPalette));
  }

  return issues;
}

/**
 * The platform requires a stable `id` on every palette color — lobby sessions
 * store the chosen `colorId`, so a label-only palette breaks color selection.
 * Enforced here so the mismatch fails at authoring time, not at upload.
 */
function checkColorPaletteShape(palette: unknown): string[] {
  const example = 'each "colorPalette" entry must be { "id", "hex", "label" } non-empty strings (e.g. { "id": "red", "hex": "#e74c3c", "label": "Red" })';
  if (!Array.isArray(palette)) return [`"colorPalette" must be an array; ${example}.`];
  const issues: string[] = [];
  palette.forEach((entry, i) => {
    const bad = ['id', 'hex', 'label'].filter(
      (key) => typeof (entry as Record<string, unknown>)?.[key] !== 'string' || !(entry as Record<string, unknown>)[key],
    );
    if (bad.length > 0) {
      issues.push(`colorPalette[${i}] is missing/invalid ${bad.map((b) => `"${b}"`).join(', ')} — ${example}.`);
    }
  });
  return issues;
}

function checkPlaytimeShape(playtime: unknown): string[] {
  const example = '"playtime" must be { "min": <minutes>, "max": <minutes> } (e.g. { "min": 15, "max": 30 })';

  if (typeof playtime !== 'object' || playtime === null || Array.isArray(playtime)) {
    return [`${example}.`];
  }

  const { min, max } = playtime as { min?: unknown; max?: unknown };
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    return [`${example} — min and max must be integers (minutes).`];
  }
  if ((min as number) < 1) {
    return ['"playtime.min" must be at least 1 minute.'];
  }
  if ((min as number) > (max as number)) {
    return [`"playtime.min" (${min}) must be <= "playtime.max" (${max}).`];
  }
  return [];
}

async function validateMetadata(cwd: string): Promise<ValidationResult> {
  const configPath = join(cwd, 'boardsmith.json');

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const issues = checkMetadataIssues(config);

    return {
      name: 'Metadata',
      passed: issues.length === 0,
      message: issues.length > 0 ? 'Missing or invalid metadata' : '',
      details: issues,
    };
  } catch (error) {
    return {
      name: 'Metadata',
      passed: false,
      message: `Failed to parse boardsmith.json: ${(error as Error).message}`,
    };
  }
}

/**
 * Type-check the project with `vue-tsc`, not plain `tsc`.
 *
 * `tsc` cannot read `.vue` files at all, which used to be papered over by an
 * ambient `declare module '*.vue'` shim in BoardSmith. That shim typed every
 * SFC everywhere as `DefineComponent<object, object, unknown>` — erasing all
 * prop checking — and bound those types to BOARDSMITH's copy of vue, so a game
 * whose own vue had drifted failed with TS2321/TS2345 the moment the two
 * versions stopped being structurally identical.
 *
 * `vue-tsc` compiles SFCs for real: props are checked, and each file's `vue`
 * resolves from its own location, so a game can upgrade vue whenever it likes.
 */
async function validateTypeScript(cwd: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vue-tsc', '--noEmit'], {
      cwd,
      shell: true,
      stdio: 'pipe',
    });

    let output = '';
    child.stdout?.on('data', (data) => { output += data; });
    child.stderr?.on('data', (data) => { output += data; });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          name: 'TypeScript',
          passed: true,
          message: '',
        });
      } else {
        const allErrors = output.split('\n').filter(line =>
          line.includes('error TS')
        );
        const maxShown = 20;
        const shown = allErrors.slice(0, maxShown);
        const remaining = allErrors.length - shown.length;
        if (remaining > 0) {
          shown.push(`... and ${remaining} more error${remaining === 1 ? '' : 's'}. Run \`npx vue-tsc --noEmit\` for full output.`);
        }

        resolve({
          name: 'TypeScript',
          passed: false,
          message: 'TypeScript compilation failed',
          details: shown.length > 0 ? shown : ['Run `npx vue-tsc --noEmit` for details'],
        });
      }
    });

    child.on('error', () => {
      resolve({
        name: 'TypeScript',
        passed: false,
        message: 'Failed to run TypeScript compiler',
      });
    });
  });
}

async function validateSecurity(cwd: string): Promise<ValidationResult> {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) {
    return {
      name: 'Security',
      passed: false,
      message: 'src directory not found',
    };
  }

  // Delegate to the AST-based boardsmith ESLint plugin (single source of truth).
  // Scans ALL of src/ — rules, UI components (.vue), and shared helpers — because
  // a determinism violation anywhere reachable from game state breaks replays,
  // undo, AI cloning, and multiplayer sync.
  const violations = scanSandboxViolations(cwd);
  const details = violations.map((v) => `${v.file}:${v.line}:${v.column} - ${v.message}`);

  return {
    name: 'Security',
    passed: violations.length === 0,
    message: violations.length > 0
      ? 'Forbidden APIs detected (non-deterministic / network / filesystem / timers / eval)'
      : '',
    details: details.slice(0, 10),
  };
}

export async function validateBundleSize(cwd: string): Promise<ValidationResult> {
  // Limits match server-side enforcement:
  //   rules.js: 1MB (executor MAX_BUNDLE_SIZE)
  //   total bundle zip: 50MB (games worker MAX_BUNDLE_SIZE, see bundle-limits.ts)
  const maxRulesJs = 1 * 1024 * 1024; // 1MB - executor limit

  const distDir = join(cwd, 'dist');
  const rulesJsPath = join(distDir, 'rules', 'rules.js');

  // If no build exists, skip — publish will build automatically
  if (!existsSync(distDir) || !existsSync(rulesJsPath)) {
    return {
      name: 'Bundle Size',
      passed: true,
      message: '',
      details: ['No build found — sizes will be checked after build during publish'],
    };
  }

  const rulesJsSize = statSync(rulesJsPath).size;
  const issues: string[] = [];

  if (rulesJsSize > maxRulesJs) {
    issues.push(`rules.js (${formatBytes(rulesJsSize)}) exceeds executor limit (${formatBytes(maxRulesJs)})`);
  }

  // WR-05: the server enforces the 50MB limit on the uploaded ZIP, so measure
  // the exact zip `boardsmith publish` would upload — comparing the raw
  // (uncompressed) dist size against a compressed-size limit falsely rejects
  // compressible bundles.
  let zipDetail: string;
  try {
    const zip = createZip(readDistDir(distDir));
    const violation = describeZipSizeViolation(zip.length);
    if (violation) {
      issues.push(violation);
    }
    zipDetail = `Compressed bundle (publish zip): ${formatBytes(zip.length)} / ${formatBytes(MAX_BUNDLE_SIZE)}`;
  } catch (error) {
    // dist/ is incomplete (e.g. missing manifest.json) so the real publish zip
    // cannot be assembled — publish rebuilds and gates the zip itself.
    const reason = (error as Error).message.split('\n')[0];
    zipDetail = `Compressed bundle: not measurable (${reason}) — checked again during publish`;
  }

  return {
    name: 'Bundle Size',
    passed: issues.length === 0,
    message: issues.length > 0 ? 'Bundle size limits exceeded' : '',
    details: issues.length > 0 ? issues : [
      `rules.js: ${formatBytes(rulesJsSize)} / ${formatBytes(maxRulesJs)}`,
      zipDetail,
    ],
  };
}

/** Files in `dir` with the given extension, or none if `dir` does not exist. */
function listFilesWithExtension(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(extension))
    .map((entry) => join(dir, entry));
}

/**
 * One issue per offending file: the first `"/<publicDir>/"` reference it
 * contains is enough to tell the author the path style is wrong.
 */
function findAbsolutePathIssues(cwd: string, files: string[], publicDirs: string[]): string[] {
  const issues: string[] = [];
  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    const offending = publicDirs.find((dir) => new RegExp(`["'\`]\\/${dir}\\/`).test(content));
    if (offending) {
      issues.push(`${filePath.replace(cwd + '/', '')}: absolute path "/${offending}/..." found`);
    }
  }
  return issues;
}

async function validateAssetPaths(cwd: string): Promise<ValidationResult> {
  const publicDir = join(cwd, 'public');
  if (!existsSync(publicDir)) {
    return { name: 'Asset Paths', passed: true, message: '', details: ['No public/ directory'] };
  }

  // Get top-level directory names in public/
  const publicDirs = readdirSync(publicDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (publicDirs.length === 0) {
    return { name: 'Asset Paths', passed: true, message: '' };
  }

  // Built UI JS, plus source data files (JSON carrying image paths).
  const filesToScan = [
    ...listFilesWithExtension(join(cwd, 'dist', 'ui', 'assets'), '.js'),
    ...listFilesWithExtension(join(cwd, 'data'), '.json'),
  ];

  const issues = findAbsolutePathIssues(cwd, filesToScan, publicDirs);

  if (issues.length === 0) {
    return { name: 'Asset Paths', passed: true, message: '' };
  }

  return {
    name: 'Asset Paths',
    passed: false,
    message: 'Absolute asset paths will break on the publishing platform',
    details: [
      ...issues.slice(0, 5),
      '',
      'Use relative paths (e.g., "sectors/image.jpg" not "/sectors/image.jpg")',
      'Absolute paths starting with "/" resolve to the domain root,',
      'which doesn\'t match the game\'s asset path on the platform.',
    ],
  };
}

async function validateRequiredFiles(cwd: string): Promise<ValidationResult> {
  const required = [
    'boardsmith.json',
    'package.json',
    'src/rules/index.ts',
    'src/rules/game.ts',
    'src/ui/App.vue',
    // The UI registry — without it a game has no board to render.
    'src/ui/uis.ts',
  ];

  const missing: string[] = [];

  for (const file of required) {
    if (!existsSync(join(cwd, file))) {
      missing.push(file);
    }
  }

  return {
    name: 'Required Files',
    passed: missing.length === 0,
    message: missing.length > 0 ? 'Missing required files' : '',
    details: missing,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
