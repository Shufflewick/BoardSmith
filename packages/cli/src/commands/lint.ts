import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';

interface LintOptions {
  fix?: boolean;
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

  // Direct element equality
  'element-equality': {
    pattern: /===\s*(?:card|piece|element|merc|squad|sector)/gi,
    severity: 'warning' as const,
    message: 'Direct element comparison (===) may fail - use element.equals() or compare IDs',
    suggestion: 'Use element1.equals(element2) or element1.id === element2.id',
  },

  // indexOf on element arrays
  'element-indexof': {
    pattern: /\.indexOf\s*\(\s*(?:card|piece|element|merc|squad|sector)/gi,
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
 * Find all TypeScript files in a directory recursively
 */
function findTypeScriptFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);

    // Skip node_modules and hidden directories
    if (entry === 'node_modules' || entry.startsWith('.')) continue;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findTypeScriptFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Lint a single file for BoardSmith-specific issues
 */
function lintFile(filePath: string, content: string): LintIssue[] {
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

export async function lintCommand(options: LintOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'boardsmith.json');

  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  console.log(chalk.cyan('\nLinting BoardSmith game...\n'));

  // Find all TypeScript files
  const srcDir = join(cwd, 'src');
  const files = findTypeScriptFiles(srcDir);

  if (files.length === 0) {
    console.log(chalk.yellow('No TypeScript files found in src/'));
    return;
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
    console.log(chalk.underline(relPath));

    // Sort by line number
    issues.sort((a, b) => a.line - b.line);

    for (const issue of issues) {
      const icon = issue.severity === 'error' ? chalk.red('✗')
        : issue.severity === 'warning' ? chalk.yellow('⚠')
        : chalk.blue('ℹ');

      const location = chalk.dim(`${issue.line}:${issue.column || 0}`);
      const rule = chalk.dim(`(${issue.rule})`);

      console.log(`  ${location}  ${icon} ${issue.message} ${rule}`);

      if (issue.suggestion) {
        console.log(chalk.dim(`         └─ ${issue.suggestion}`));
      }
    }
    console.log('');
  }

  // Summary
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`Checked ${chalk.cyan(result.filesChecked)} files`);

  if (result.issues.length === 0) {
    console.log(chalk.green('✓ No issues found'));
  } else {
    const parts: string[] = [];
    if (result.errorCount > 0) parts.push(chalk.red(`${result.errorCount} error(s)`));
    if (result.warningCount > 0) parts.push(chalk.yellow(`${result.warningCount} warning(s)`));
    const infoCount = result.issues.length - result.errorCount - result.warningCount;
    if (infoCount > 0) parts.push(chalk.blue(`${infoCount} info`));
    console.log(`Found ${parts.join(', ')}`);
  }

  // Exit with error code if errors found
  if (result.errorCount > 0) {
    process.exit(1);
  }
}
