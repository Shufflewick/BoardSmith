import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';

interface ValidateOptions {
  fix?: boolean;
  skipSimulation?: boolean;
}

interface ValidationResult {
  name: string;
  passed: boolean;
  message: string;
  details?: string[];
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
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

  // 4. Bundle size check
  results.push(await validateBundleSize(cwd));

  // 5. Required files check
  results.push(await validateRequiredFiles(cwd));

  // Print results
  console.log(chalk.cyan('\nValidation Results:\n'));

  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(`  ${icon} ${result.name}: ${status}`);

    if (!result.passed) {
      allPassed = false;
      console.log(chalk.dim(`    ${result.message}`));
      if (result.details) {
        for (const detail of result.details) {
          console.log(chalk.dim(`      - ${detail}`));
        }
      }
    }
  }

  console.log('');

  if (allPassed) {
    console.log(chalk.green('All validation checks passed!\n'));
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  boardsmith build    - Build for production'));
    console.log(chalk.dim('  boardsmith publish  - Publish to boardsmith.io\n'));
  } else {
    console.log(chalk.red('Validation failed. Please fix the issues above.\n'));
    process.exit(1);
  }
}

async function validateMetadata(cwd: string): Promise<ValidationResult> {
  const configPath = join(cwd, 'boardsmith.json');

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const issues: string[] = [];

    // Required fields
    const required = ['name', 'displayName', 'description', 'playerCount'];
    for (const field of required) {
      if (!config[field]) {
        issues.push(`Missing required field: ${field}`);
      }
    }

    // Player count validation
    if (config.playerCount) {
      if (!config.playerCount.min || !config.playerCount.max) {
        issues.push('playerCount must have min and max');
      }
      if (config.playerCount.min > config.playerCount.max) {
        issues.push('playerCount.min cannot be greater than playerCount.max');
      }
    }

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

async function validateTypeScript(cwd: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsc', '--noEmit'], {
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
        const errors = output.split('\n').filter(line =>
          line.includes('error TS')
        ).slice(0, 5);

        resolve({
          name: 'TypeScript',
          passed: false,
          message: 'TypeScript compilation failed',
          details: errors.length > 0 ? errors : ['Run `npx tsc --noEmit` for details'],
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
  const rulesDir = join(cwd, 'src/rules');
  if (!existsSync(rulesDir)) {
    return {
      name: 'Security',
      passed: false,
      message: 'src/rules directory not found',
    };
  }

  const forbiddenPatterns = [
    { pattern: /\bfetch\s*\(/, description: 'Network requests (fetch)' },
    { pattern: /\bXMLHttpRequest\b/, description: 'Network requests (XMLHttpRequest)' },
    { pattern: /\bimport\s*\(\s*['"]fs['"]/, description: 'Filesystem access' },
    { pattern: /\brequire\s*\(\s*['"]fs['"]/, description: 'Filesystem access' },
    { pattern: /\bsetTimeout\s*\(/, description: 'Timers (setTimeout)' },
    { pattern: /\bsetInterval\s*\(/, description: 'Timers (setInterval)' },
    { pattern: /\bDate\.now\s*\(/, description: 'Non-deterministic (Date.now)' },
    { pattern: /\bMath\.random\s*\(/, description: 'Non-deterministic (Math.random)' },
    { pattern: /\beval\s*\(/, description: 'Code evaluation (eval)' },
    { pattern: /\bFunction\s*\(/, description: 'Code evaluation (Function constructor)' },
  ];

  const issues: string[] = [];

  function scanFile(filePath: string) {
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = filePath.replace(cwd + '/', '');

    for (const { pattern, description } of forbiddenPatterns) {
      if (pattern.test(content)) {
        // Check if it's in a comment (simple heuristic)
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            continue;
          }
          if (pattern.test(line)) {
            issues.push(`${relativePath}:${i + 1} - ${description}`);
            break;
          }
        }
      }
    }
  }

  function scanDir(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
        scanFile(fullPath);
      }
    }
  }

  scanDir(rulesDir);

  return {
    name: 'Security',
    passed: issues.length === 0,
    message: issues.length > 0 ? 'Forbidden APIs detected in rules code' : '',
    details: issues.slice(0, 10),
  };
}

async function validateBundleSize(cwd: string): Promise<ValidationResult> {
  const maxRulesSize = 500 * 1024; // 500KB
  const maxUISize = 2 * 1024 * 1024; // 2MB

  const rulesDir = join(cwd, 'src/rules');
  const uiDir = join(cwd, 'src/ui');

  let rulesSize = 0;
  let uiSize = 0;

  function getDirSize(dir: string): number {
    if (!existsSync(dir)) return 0;

    let size = 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
      } else {
        size += statSync(fullPath).size;
      }
    }
    return size;
  }

  rulesSize = getDirSize(rulesDir);
  uiSize = getDirSize(uiDir);

  const issues: string[] = [];

  if (rulesSize > maxRulesSize) {
    issues.push(`Rules size (${formatBytes(rulesSize)}) exceeds limit (${formatBytes(maxRulesSize)})`);
  }

  if (uiSize > maxUISize) {
    issues.push(`UI size (${formatBytes(uiSize)}) exceeds limit (${formatBytes(maxUISize)})`);
  }

  return {
    name: 'Bundle Size',
    passed: issues.length === 0,
    message: issues.length > 0 ? 'Bundle size limits exceeded' : '',
    details: issues.length > 0 ? issues : [
      `Rules: ${formatBytes(rulesSize)} / ${formatBytes(maxRulesSize)}`,
      `UI: ${formatBytes(uiSize)} / ${formatBytes(maxUISize)}`,
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
