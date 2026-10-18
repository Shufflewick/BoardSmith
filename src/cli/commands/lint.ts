import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { styleText } from 'node:util';
import { ESLint } from 'eslint';
import { scanSandboxViolations } from '../lib/sandbox-scan.js';
import { SOURCE_EXTENSIONS, collectSourceFiles } from '../lib/source-files.js';
import { requireBoardsmithWorkspace } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { selectChecks } from '../lib/select-checks.js';

export interface LintOptions {
  /** Auto-fix what the underlying tool can fix. */
  fix?: boolean;
  /** Selector flags — when any is set, only the selected checks run. */
  eslint?: boolean;
  css?: boolean;
  pitfalls?: boolean;
}

interface LintIssue {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  suggestion?: string;
}

interface LintResult {
  issues: LintIssue[];
  filesChecked: number;
  errorCount: number;
  warningCount: number;
}

/**
 * Patterns that indicate potential bugs in BoardSmith games
 */
const LINT_RULES = {
  // Element comparison issues
  'element-includes': {
    // Match .includes( preceded by element-like contexts
    pattern: /\.includes\s*\(/g,
    severity: 'warning' as const,
    message: 'Avoid .includes() for element comparison - use .some(e => e.id === element.id) or .contains()',
    suggestion: 'Replace with .some(e => e.id === target.id) or use collection.contains(element)',
    // Context patterns that suggest this is element-related
    contextPatterns: [
      /\.all\s*\([^)]*\)\s*\.\s*includes/,
      /hand\s*\.\s*includes/,
      /board\s*\.\s*includes/,
      /deck\s*\.\s*includes/,
      /cards?\s*\.\s*includes/,
      /pieces?\s*\.\s*includes/,
      /elements?\s*\.\s*includes/,
    ],
  },

  // Direct element equality is DELIBERATELY not checked here (#34).
  //
  // The check used to be `/===\s*(?:card|piece|element|merc|squad|sector)/gi`,
  // a raw-text match for a domain word anywhere to the right of `===`. It
  // therefore fired on `m.id === merc.id`, `c.id === card.id` and
  // `s.sectorId === sectorId` — the exact `.id` comparison its own message
  // recommends — producing 111 warnings on a clean codebase and burying every
  // real one. No amount of tightening fixes it: text cannot tell `a === b` on
  // two elements from `a === b` on two numbers.
  //
  // The AST rule that can already exists and is already in the recommended
  // config: `no-element-identity-comparison` in the ESLint plugin, which
  // `boardsmith validate` runs. See docs/api/eslint-plugin.md.

  // indexOf on element arrays. The trailing `\b(?!\w*[Ii]d\b)` keeps
  // `ids.indexOf(cardId)` out of it — comparing ids IS the recommended form.
  'element-indexof': {
    pattern: /\.indexOf\s*\(\s*(?:card|piece|element|merc|squad|sector)\w*\b(?<![Ii]d)\s*\)/gi,
    severity: 'warning' as const,
    message: 'indexOf() on elements may fail - use .findIndex(e => e.id === target.id)',
    suggestion: 'Replace with .findIndex(e => e.id === target.id)',
  },

  // Missing undefined check in filters
  'filter-undefined': {
    pattern: /filter:\s*\([^)]*\)\s*=>\s*\{[^}]*ctx\.args\.[a-zA-Z]+\.[a-zA-Z]/g,
    severity: 'warning' as const,
    message: 'Accessing ctx.args properties without undefined check - filters run during availability check when previous selections are undefined',
    suggestion: 'Add null check: const value = ctx.args?.propertyName; if (!value) return true;',
  },

  // Potential infinite loop without maxIterations
  'loop-no-max': {
    pattern: /loop\s*\(\s*\{[^}]*while\s*:/g,
    severity: 'info' as const,
    message: 'Loop with while condition - consider adding maxIterations for safety',
    suggestion: 'Add maxIterations: 1000 to prevent infinite loops during development',
    // Check that maxIterations is NOT present
    negativePattern: /maxIterations/,
  },

  // Cost in onEach callback
  'cost-in-oneach': {
    pattern: /onEach\s*:\s*[^,}]*(?:useAction|spendAction|payAction|deductAction)/g,
    severity: 'warning' as const,
    message: 'Action cost in onEach callback - cost will be charged per item selected',
    suggestion: 'Move action costs to the execute() block to charge once per action',
  },

  // Element reference on player
  'player-element-ref': {
    pattern: /class\s+\w+Player[^{]*\{[^}]*:\s*(?:Card|Piece|Element|Squad|Merc|Sector)(?:\s*\||\s*;|\s*=)/g,
    severity: 'info' as const,
    message: 'Storing element reference on Player class - may not survive serialization',
    suggestion: 'Store element ID instead: selectedCardId: number, then use game.getElementById()',
  },

  // Missing registerElements
  'missing-register': {
    pattern: /class\s+\w+\s+extends\s+Game\s*\{/g,
    severity: 'info' as const,
    message: 'Game class found - ensure custom element classes are registered',
    suggestion: 'Call this.registerElements([MyCard, MyPiece, ...]) in constructor',
    // Only warn if registerElements is not found nearby
    negativePattern: /registerElements/,
  },
};

/**
 * Lint a single file for BoardSmith-specific issues
 */
export function lintFile(filePath: string, content: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = content.split('\n');

  for (const [ruleName, rule] of Object.entries(LINT_RULES)) {
    // Reset regex state
    rule.pattern.lastIndex = 0;

    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      const lineStart = beforeMatch.lastIndexOf('\n') + 1;
      const column = match.index - lineStart + 1;

      // Check for context patterns if specified
      if ('contextPatterns' in rule && rule.contextPatterns) {
        const lineContent = lines[lineNumber - 1] || '';
        const hasContext = rule.contextPatterns.some(p => p.test(lineContent));
        if (!hasContext) continue;
      }

      // Check negative pattern (issue only if NOT present)
      if ('negativePattern' in rule && rule.negativePattern) {
        // Look in surrounding context (100 chars before and after)
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(content.length, match.index + match[0].length + 100);
        const context = content.slice(contextStart, contextEnd);
        if (rule.negativePattern.test(context)) continue;
      }

      issues.push({
        file: filePath,
        line: lineNumber,
        column,
        severity: rule.severity,
        rule: ruleName,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }

  return issues;
}

/**
 * Check for missing element class registrations
 */
function checkElementRegistration(filePath: string, content: string): LintIssue[] {
  const issues: LintIssue[] = [];

  // Find all custom element classes (extends GameElement, Card, Piece, etc.)
  const elementClassPattern = /class\s+(\w+)\s+extends\s+(?:GameElement|Card|Piece|Space|Deck|Hand|Die|Grid|GridCell)/g;
  const customClasses: string[] = [];

  let match;
  while ((match = elementClassPattern.exec(content)) !== null) {
    customClasses.push(match[1]);
  }

  if (customClasses.length === 0) return issues;

  // Check if there's a Game class that should register them
  const gameClassMatch = /class\s+(\w+)\s+extends\s+Game\s*\{/g.exec(content);
  if (!gameClassMatch) return issues;

  // Check if registerElements is called
  if (!content.includes('registerElements')) {
    const lineNumber = content.slice(0, gameClassMatch.index).split('\n').length;
    issues.push({
      file: filePath,
      line: lineNumber,
      severity: 'warning',
      rule: 'unregistered-elements',
      message: `Found ${customClasses.length} custom element class(es) but no registerElements() call`,
      suggestion: `Add: this.registerElements([${customClasses.join(', ')}])`,
    });
  }

  return issues;
}

/**
 * Check for unused actions
 */
function checkUnusedActions(filePath: string, content: string, allFiles: Map<string, string>): LintIssue[] {
  const issues: LintIssue[] = [];

  // Find action definitions
  const actionPattern = /Action\.create\s*\(\s*['"](\w+)['"]/g;
  const definedActions: Array<{ name: string; line: number }> = [];

  let match;
  while ((match = actionPattern.exec(content)) !== null) {
    const lineNumber = content.slice(0, match.index).split('\n').length;
    definedActions.push({ name: match[1], line: lineNumber });
  }

  if (definedActions.length === 0) return issues;

  // Check if actions are referenced in flow
  const allContent = Array.from(allFiles.values()).join('\n');

  for (const action of definedActions) {
    // Look for action name in flow definitions
    const actionRefPattern = new RegExp(`['"]${action.name}['"]`, 'g');
    const inActionsArray = new RegExp(`actions\\s*:\\s*\\[[^\\]]*['"]${action.name}['"]`, 'g');

    if (!inActionsArray.test(allContent)) {
      issues.push({
        file: filePath,
        line: action.line,
        severity: 'info',
        rule: 'unused-action',
        message: `Action '${action.name}' may be unused - not found in any flow actions array`,
        suggestion: 'Ensure this action is included in an actionStep or playerActions flow node',
      });
    }
  }

  return issues;
}

/**
 * BoardSmith's own pitfall checks: pattern rules, element registration, unused
 * actions, and the AST sandbox guardrails. Game projects only — the rules are
 * about game code, not library code.
 *
 * Returns a process exit code (non-zero when errors were found) rather than
 * exiting, so `lintCommand` can run every configured check before deciding the
 * overall verdict.
 */
async function runPitfallLint(cwd: string): Promise<number> {
  console.log(styleText('cyan', '\nChecking for BoardSmith pitfalls...\n'));

  // The hints are text patterns over script code, so .vue files are left to the sandbox scan.
  const files = collectSourceFiles(join(cwd, 'src'), SOURCE_EXTENSIONS.filter((ext) => ext !== 'vue'));

  if (files.length === 0) {
    console.log(styleText('yellow', 'No game source files found in src/'));
    return 0;
  }

  // Load all file contents
  const fileContents = new Map<string, string>();
  for (const file of files) {
    fileContents.set(file, readFileSync(file, 'utf-8'));
  }

  // Run linting
  const result: LintResult = {
    issues: [],
    filesChecked: files.length,
    errorCount: 0,
    warningCount: 0,
  };

  for (const [filePath, content] of fileContents) {
    // Run pattern-based rules
    const fileIssues = lintFile(filePath, content);
    result.issues.push(...fileIssues);

    // Run element registration check
    const regIssues = checkElementRegistration(filePath, content);
    result.issues.push(...regIssues);

    // Run unused action check
    const unusedIssues = checkUnusedActions(filePath, content, fileContents);
    result.issues.push(...unusedIssues);
  }

  // Sandbox guardrails (determinism / network / filesystem / timers / eval) come
  // from the AST-based boardsmith ESLint plugin — the single source of truth,
  // shared with `boardsmith validate`. These are hard errors: they silently break
  // replays, MCTS cloning, and multiplayer sync.
  for (const v of scanSandboxViolations(cwd)) {
    result.issues.push({
      file: join(cwd, v.file),
      line: v.line,
      column: v.column,
      severity: 'error',
      rule: v.ruleId,
      message: v.message,
    });
  }

  // Count by severity
  for (const issue of result.issues) {
    if (issue.severity === 'error') result.errorCount++;
    if (issue.severity === 'warning') result.warningCount++;
  }

  // Print results grouped by file
  const issuesByFile = new Map<string, LintIssue[]>();
  for (const issue of result.issues) {
    const existing = issuesByFile.get(issue.file) || [];
    existing.push(issue);
    issuesByFile.set(issue.file, existing);
  }

  for (const [filePath, issues] of issuesByFile) {
    const relPath = relative(cwd, filePath);
    console.log(styleText('underline', relPath));

    // Sort by line number
    issues.sort((a, b) => a.line - b.line);

    for (const issue of issues) {
      const icon = issue.severity === 'error' ? styleText('red', '✗')
        : issue.severity === 'warning' ? styleText('yellow', '⚠')
        : styleText('blue', 'ℹ');

      const location = styleText('dim', `${issue.line}:${issue.column || 0}`);
      const rule = styleText('dim', `(${issue.rule})`);

      console.log(`  ${location}  ${icon} ${issue.message} ${rule}`);

      if (issue.suggestion) {
        console.log(styleText('dim', `         └─ ${issue.suggestion}`));
      }
    }
    console.log('');
  }

  // Summary
  console.log(styleText('dim', '─'.repeat(50)));
  console.log(`Checked ${styleText('cyan', String(result.filesChecked))} files`);

  if (result.issues.length === 0) {
    console.log(styleText('green', '✓ No issues found'));
  } else {
    const parts: string[] = [];
    if (result.errorCount > 0) parts.push(styleText('red', `${result.errorCount} error(s)`));
    if (result.warningCount > 0) parts.push(styleText('yellow', `${result.warningCount} warning(s)`));
    const infoCount = result.issues.length - result.errorCount - result.warningCount;
    if (infoCount > 0) parts.push(styleText('blue', `${infoCount} info`));
    console.log(`Found ${parts.join(', ')}`);
  }

  return result.errorCount > 0 ? 1 : 0;
}

/** A lint check that is available in this workspace. */
interface LintCheck {
  name: string;
  run: () => Promise<number>;
}

/*
 * Only configured tools run, so `boardsmith lint` never fails a game project
 * for lacking a linter it never set up. Each check below finds a config
 * exactly where its linter would, so lint never calls a configured project
 * unconfigured, or the reverse (#1094).
 */

// ESLint no longer reads .eslintrc files. They count here on purpose, so an
// author who has one gets ESLint's own message on how to migrate instead of a
// silently skipped check (#624).
const LEGACY_ESLINT_CONFIGS = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json'];

/**
 * Asks boardsmith's own ESLint, the copy lint runs, whether it finds a config
 * from this project, or from any source file under src/, upward.
 */
async function hasEslintConfig(cwd: string): Promise<boolean> {
  if (LEGACY_ESLINT_CONFIGS.some((name) => existsSync(join(cwd, name)))) return true;
  const eslint = new ESLint({ cwd });
  if ((await eslint.findConfigFile()) !== undefined) return true;
  for (const file of collectSourceFiles(join(cwd, 'src'))) {
    if ((await eslint.findConfigFile(file)) !== undefined) return true;
  }
  return false;
}

// Stylelint 17 searches with cosmiconfig 9's 'global' strategy. These are
// that search's file names; Stylelint's own resolveConfig() cannot be asked,
// as it throws instead of returning undefined when there is no config, and
// it lives in the game's install, which may not have it.
// shortcut: a cosmiconfig meta config (a "cosmiconfig" key or .config/config.json) is not read; read it if a game uses one.
const RC_EXTENSIONS = ['', '.json', '.yaml', '.yml', '.js', '.ts', '.cjs', '.mjs'];
const STYLELINT_CONFIGS = [
  ...RC_EXTENSIONS.flatMap((ext) => [`.stylelintrc${ext}`, `.config/stylelintrc${ext}`]),
  ...['js', 'ts', 'cjs', 'mjs'].map((ext) => `stylelint.config.${ext}`),
];
const STYLELINT_GLOBAL_CONFIGS = RC_EXTENSIONS.map((ext) => `config${ext}`);

/** `start` and each parent, stopping after the home folder (or at the root, outside it). */
function stylelintSearchDirs(start: string): string[] {
  const home = homedir();
  const dirs = [start];
  for (let dir = start; dir !== home && dirname(dir) !== dir; dir = dirname(dir)) dirs.push(dirname(dir));
  return dirs;
}

/** Stylelint's global config folder, as cosmiconfig's env-paths names it. */
function stylelintGlobalDir(): string {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Preferences', 'stylelint');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'stylelint', 'Config');
  return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'stylelint');
}

/** Stylelint skips an empty config file and keeps searching. */
function isNonEmptyFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile() && readFileSync(path, 'utf-8').trim() !== '';
}

function hasStylelintKey(pkgPath: string): boolean {
  if (!isNonEmptyFile(pkgPath)) return false;
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    pkg = undefined;
  }
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    throw new Error(
      `${pkgPath} is not a valid JSON object. boardsmith lint reads it to find a Stylelint config ` +
        `(a "stylelint" key). Fix the JSON in that file and run lint again.`,
    );
  }
  return (pkg as Record<string, unknown>).stylelint != null;
}

/** The search above is Stylelint 17's, so another installed major is refused rather than guessed at. */
function requireStylelint17(cwd: string): void {
  const manifest = join(cwd, 'node_modules', 'stylelint', 'package.json');
  if (!existsSync(manifest)) return;
  const { version } = JSON.parse(readFileSync(manifest, 'utf-8')) as { version: string };
  if (version.split('.')[0] === '17') return;
  throw new Error(
    `This project has Stylelint ${version} installed. boardsmith lint's Stylelint config detection is written ` +
      `for Stylelint 17, so it cannot tell whether Stylelint ${version} would find a config. ` +
      'Install Stylelint 17 with: npm install -D stylelint@17',
  );
}

/** Searches from the project and from each folder holding a .vue file lint passes Stylelint, as Stylelint does. */
function hasStylelintConfig(cwd: string): boolean {
  requireStylelint17(cwd);
  const starts = new Set([cwd, ...collectSourceFiles(join(cwd, 'src'), ['vue']).map((file) => dirname(file))]);
  const dirs = new Set([...starts].flatMap(stylelintSearchDirs));
  const found = [...dirs].some((dir) =>
    hasStylelintKey(join(dir, 'package.json')) || STYLELINT_CONFIGS.some((name) => isNonEmptyFile(join(dir, name))));
  return found || STYLELINT_GLOBAL_CONFIGS.some((name) => isNonEmptyFile(join(stylelintGlobalDir(), name)));
}

/**
 * Run every lint check this workspace has configured.
 *
 * One command covers all of them — ESLint, Stylelint, and BoardSmith's own
 * pitfall rules — so nobody has to remember which linters a given repo wired
 * up. Pass a selector flag to run just one; with no selectors, everything
 * applicable runs and the command fails if any check fails.
 */
export async function lintCommand(options: LintOptions): Promise<void> {
  const cwd = process.cwd();

  requireBoardsmithWorkspace(cwd);

  const wants = selectChecks({
    eslint: options.eslint,
    css: options.css,
    pitfalls: options.pitfalls,
  });

  const checks: LintCheck[] = [];
  const hasEslint = wants('eslint') && await hasEslintConfig(cwd);
  const hasCssConfig = wants('css') && hasStylelintConfig(cwd);

  if (options.eslint && !hasEslint) {
    console.error(styleText('red', '\nlint --eslint: this project has no ESLint config, so ESLint cannot run.'));
    console.error(styleText('dim', 'Add an eslint.config.mjs to the project root that uses boardsmith/eslint-plugin, or drop --eslint.'));
    console.error(styleText('dim', 'How: https://github.com/Shufflewick/BoardSmith/blob/main/docs/api/eslint-plugin.md\n'));
    process.exit(1);
  }

  if (options.css && !hasCssConfig) {
    console.error(styleText('red', '\nlint --css: this project has no Stylelint config, so Stylelint cannot run.'));
    console.error(styleText('dim', "Add a .stylelintrc.cjs to the project root with customSyntax: 'postcss-html' (so it reads the <style> blocks in .vue files), or drop --css."));
    console.error(styleText('dim', 'The game also needs both packages installed: npm install -D stylelint postcss-html\n'));
    process.exit(1);
  }

  if (hasEslint) {
    const args = ['src/'];
    if (options.fix) args.push('--fix');
    checks.push({ name: 'ESLint', run: () => runTool('eslint', args, { cwd }) });
  }

  if (hasCssConfig) {
    const args = ['src/**/*.vue'];
    if (options.fix) args.push('--fix');
    checks.push({ name: 'Stylelint', run: () => runTool('stylelint', args, { cwd }) });
  }

  if (wants('pitfalls') && existsSync(join(cwd, 'boardsmith.json'))) {
    checks.push({ name: 'BoardSmith pitfalls', run: () => runPitfallLint(cwd) });
  }

  if (checks.length === 0) {
    console.log(styleText('yellow', '\nNo lint checks apply here.'));
    console.log(styleText('dim', 'Add an eslint.config.mjs or .stylelintrc.cjs, or run this in a game project.\n'));
    return;
  }

  const failed: string[] = [];
  for (const check of checks) {
    const code = await check.run();
    if (code !== 0) failed.push(check.name);
  }

  if (failed.length > 0) {
    console.error(styleText('red', `\nLint failed: ${failed.join(', ')}\n`));
    process.exit(1);
  }

  console.log(styleText('green', `\nLint passed (${checks.map((c) => c.name).join(', ')})\n`));
}
