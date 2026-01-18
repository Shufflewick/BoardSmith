import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import chalk from 'chalk';

interface AnalyzeOptions {
  json?: boolean;
  verbose?: boolean;
}

interface GameAnalysis {
  name: string;
  elements: ElementAnalysis;
  actions: ActionAnalysis;
  flow: FlowAnalysis;
  complexity: ComplexityScore;
  summary: string[];
}

interface ElementAnalysis {
  totalClasses: number;
  byType: Record<string, number>;
  customClasses: string[];
  maxDepth: number;
}

interface ActionAnalysis {
  totalActions: number;
  actions: ActionDetail[];
  averageSelections: number;
  hasConditionalActions: boolean;
  hasRepeatingSelections: boolean;
}

interface ActionDetail {
  name: string;
  selections: number;
  hasCondition: boolean;
  hasRepeat: boolean;
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

interface FlowAnalysis {
  totalNodes: number;
  maxDepth: number;
  nodeTypes: Record<string, number>;
  hasPhases: boolean;
  hasLoops: boolean;
  hasSimultaneous: boolean;
  estimatedTurnsPerGame: string;
}

interface ComplexityScore {
  overall: number;  // 1-10 scale
  category: 'light' | 'medium' | 'heavy' | 'complex';
  factors: ComplexityFactor[];
}

interface ComplexityFactor {
  name: string;
  score: number;
  description: string;
}

/**
 * Find all TypeScript files in a directory recursively
 */
function findTypeScriptFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
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
 * Analyze element classes in the game
 */
function analyzeElements(content: string): ElementAnalysis {
  const byType: Record<string, number> = {};
  const customClasses: string[] = [];

  // Find all element class definitions
  const patterns: Array<{ type: string; pattern: RegExp }> = [
    { type: 'Card', pattern: /class\s+(\w+)\s+extends\s+Card\b/g },
    { type: 'Piece', pattern: /class\s+(\w+)\s+extends\s+Piece\b/g },
    { type: 'Space', pattern: /class\s+(\w+)\s+extends\s+Space\b/g },
    { type: 'Deck', pattern: /class\s+(\w+)\s+extends\s+Deck\b/g },
    { type: 'Hand', pattern: /class\s+(\w+)\s+extends\s+Hand\b/g },
    { type: 'Die', pattern: /class\s+(\w+)\s+extends\s+Die\b/g },
    { type: 'Grid', pattern: /class\s+(\w+)\s+extends\s+(?:Grid|HexGrid)\b/g },
    { type: 'GridCell', pattern: /class\s+(\w+)\s+extends\s+(?:GridCell|HexCell)\b/g },
    { type: 'Game', pattern: /class\s+(\w+)\s+extends\s+Game\b/g },
    { type: 'Player', pattern: /class\s+(\w+)\s+extends\s+Player\b/g },
    { type: 'GameElement', pattern: /class\s+(\w+)\s+extends\s+GameElement\b/g },
  ];

  for (const { type, pattern } of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      byType[type] = (byType[type] || 0) + 1;
      if (type !== 'Game' && type !== 'Player') {
        customClasses.push(match[1]);
      }
    }
  }

  // Estimate element tree depth from create() calls
  const createCalls = (content.match(/\.create\s*\(/g) || []).length;
  const maxDepth = Math.min(5, Math.ceil(createCalls / 3));

  return {
    totalClasses: customClasses.length,
    byType,
    customClasses,
    maxDepth,
  };
}

/**
 * Analyze actions in the game
 */
function analyzeActions(content: string): ActionAnalysis {
  const actions: ActionDetail[] = [];

  // Find Action.create definitions
  const actionPattern = /Action\.create\s*\(\s*['"](\w+)['"]\s*\)/g;
  let match;

  while ((match = actionPattern.exec(content)) !== null) {
    const actionName = match[1];
    const startIndex = match.index;

    // Find the end of this action chain (look for .execute or next Action.create)
    const restOfContent = content.slice(startIndex);
    const executeMatch = restOfContent.match(/\.execute\s*\(/);
    const endIndex = executeMatch
      ? startIndex + (executeMatch.index || 500)
      : startIndex + 500;

    const actionContent = content.slice(startIndex, endIndex);

    // Count selections
    const chooseElement = (actionContent.match(/\.chooseElement/g) || []).length;
    const chooseFrom = (actionContent.match(/\.chooseFrom/g) || []).length;
    const chooseNumber = (actionContent.match(/\.chooseNumber/g) || []).length;
    const selections = chooseElement + chooseFrom + chooseNumber;

    // Check for condition
    const hasCondition = /\.condition\s*\(/.test(actionContent) || /condition\s*:/.test(actionContent);

    // Check for repeat
    const hasRepeat = /repeat\s*:/.test(actionContent);

    // Estimate complexity
    let estimatedComplexity: 'simple' | 'medium' | 'complex' = 'simple';
    if (selections >= 3 || (hasCondition && hasRepeat)) {
      estimatedComplexity = 'complex';
    } else if (selections >= 2 || hasCondition || hasRepeat) {
      estimatedComplexity = 'medium';
    }

    actions.push({
      name: actionName,
      selections,
      hasCondition,
      hasRepeat,
      estimatedComplexity,
    });
  }

  const totalSelections = actions.reduce((sum, a) => sum + a.selections, 0);
  const averageSelections = actions.length > 0 ? totalSelections / actions.length : 0;

  return {
    totalActions: actions.length,
    actions,
    averageSelections,
    hasConditionalActions: actions.some(a => a.hasCondition),
    hasRepeatingSelections: actions.some(a => a.hasRepeat),
  };
}

/**
 * Analyze flow structure
 */
function analyzeFlow(content: string): FlowAnalysis {
  const nodeTypes: Record<string, number> = {};

  // Count flow node types
  const flowPatterns: Array<{ type: string; pattern: RegExp }> = [
    { type: 'sequence', pattern: /\bsequence\s*\(/g },
    { type: 'phase', pattern: /\bphase\s*\(/g },
    { type: 'loop', pattern: /\bloop\s*\(/g },
    { type: 'repeat', pattern: /\brepeat\s*\(/g },
    { type: 'eachPlayer', pattern: /\beachPlayer\s*\(/g },
    { type: 'forEach', pattern: /\bforEach\s*\(/g },
    { type: 'actionStep', pattern: /\bactionStep\s*\(/g },
    { type: 'simultaneousActionStep', pattern: /\bsimultaneousActionStep\s*\(/g },
    { type: 'playerActions', pattern: /\bplayerActions\s*\(/g },
    { type: 'switchOn', pattern: /\bswitchOn\s*\(/g },
    { type: 'ifThen', pattern: /\bifThen\s*\(/g },
    { type: 'execute', pattern: /\bexecute\s*\(/g },
  ];

  let totalNodes = 0;
  for (const { type, pattern } of flowPatterns) {
    const matches = (content.match(pattern) || []).length;
    if (matches > 0) {
      nodeTypes[type] = matches;
      totalNodes += matches;
    }
  }

  // Estimate max depth from nesting
  const flowMatch = content.match(/defineFlow\s*\([^]*?\)\s*;/);
  let maxDepth = 1;
  if (flowMatch) {
    const flowContent = flowMatch[0];
    let depth = 0;
    let currentMax = 0;
    for (const char of flowContent) {
      if (char === '(') {
        depth++;
        currentMax = Math.max(currentMax, depth);
      } else if (char === ')') {
        depth--;
      }
    }
    maxDepth = Math.min(10, Math.ceil(currentMax / 2));
  }

  // Estimate turns per game
  let turnsEstimate = 'unknown';
  const hasLoop = (nodeTypes['loop'] || 0) > 0;
  const hasEachPlayer = (nodeTypes['eachPlayer'] || 0) > 0;

  if (hasLoop && hasEachPlayer) {
    turnsEstimate = 'variable (loop-based)';
  } else if (hasEachPlayer) {
    const eachPlayerCount = nodeTypes['eachPlayer'] || 0;
    turnsEstimate = `~${eachPlayerCount * 5}-${eachPlayerCount * 20} turns`;
  } else {
    turnsEstimate = 'fixed sequence';
  }

  return {
    totalNodes,
    maxDepth,
    nodeTypes,
    hasPhases: (nodeTypes['phase'] || 0) > 0,
    hasLoops: (nodeTypes['loop'] || 0) > 0 || (nodeTypes['repeat'] || 0) > 0,
    hasSimultaneous: (nodeTypes['simultaneousActionStep'] || 0) > 0,
    estimatedTurnsPerGame: turnsEstimate,
  };
}

/**
 * Calculate overall complexity score
 */
function calculateComplexity(
  elements: ElementAnalysis,
  actions: ActionAnalysis,
  flow: FlowAnalysis
): ComplexityScore {
  const factors: ComplexityFactor[] = [];

  // Element complexity (1-3 points)
  let elementScore = 1;
  if (elements.totalClasses >= 5) elementScore = 3;
  else if (elements.totalClasses >= 3) elementScore = 2;
  factors.push({
    name: 'Elements',
    score: elementScore,
    description: `${elements.totalClasses} custom element types`,
  });

  // Action complexity (1-3 points)
  let actionScore = 1;
  if (actions.totalActions >= 10 || actions.averageSelections >= 2.5) actionScore = 3;
  else if (actions.totalActions >= 5 || actions.averageSelections >= 1.5) actionScore = 2;
  factors.push({
    name: 'Actions',
    score: actionScore,
    description: `${actions.totalActions} actions, avg ${actions.averageSelections.toFixed(1)} selections`,
  });

  // Flow complexity (1-3 points)
  let flowScore = 1;
  if (flow.maxDepth >= 5 || flow.totalNodes >= 15) flowScore = 3;
  else if (flow.maxDepth >= 3 || flow.totalNodes >= 8) flowScore = 2;
  factors.push({
    name: 'Flow',
    score: flowScore,
    description: `${flow.totalNodes} nodes, depth ${flow.maxDepth}`,
  });

  // Special mechanics (+1 each)
  let specialScore = 0;
  if (flow.hasSimultaneous) {
    specialScore++;
    factors.push({ name: 'Simultaneous', score: 1, description: 'Has simultaneous actions' });
  }
  if (actions.hasRepeatingSelections) {
    specialScore++;
    factors.push({ name: 'Repeating', score: 1, description: 'Has repeating selections' });
  }
  if (flow.hasPhases) {
    factors.push({ name: 'Phases', score: 0, description: 'Uses game phases' });
  }

  // Calculate overall (1-10 scale)
  const rawScore = elementScore + actionScore + flowScore + specialScore;
  const overall = Math.min(10, Math.max(1, rawScore));

  // Determine category
  let category: 'light' | 'medium' | 'heavy' | 'complex';
  if (overall <= 3) category = 'light';
  else if (overall <= 5) category = 'medium';
  else if (overall <= 7) category = 'heavy';
  else category = 'complex';

  return { overall, category, factors };
}

/**
 * Generate summary insights
 */
function generateSummary(
  elements: ElementAnalysis,
  actions: ActionAnalysis,
  flow: FlowAnalysis,
  complexity: ComplexityScore
): string[] {
  const summary: string[] = [];

  // Complexity category
  summary.push(`This is a ${complexity.category}-weight game (complexity: ${complexity.overall}/10)`);

  // Element insights
  if (elements.totalClasses === 0) {
    summary.push('No custom element classes defined - consider creating specific types for your game pieces');
  } else if (elements.totalClasses >= 5) {
    summary.push(`Rich element hierarchy with ${elements.totalClasses} custom types`);
  }

  // Action insights
  if (actions.totalActions === 0) {
    summary.push('No actions defined yet');
  } else if (actions.averageSelections >= 2) {
    summary.push('Actions have multiple selections - good for strategic depth');
  }
  if (actions.hasConditionalActions) {
    summary.push('Uses conditional actions for context-sensitive gameplay');
  }

  // Flow insights
  if (flow.hasPhases) {
    const phaseCount = flow.nodeTypes['phase'] || 0;
    summary.push(`Game has ${phaseCount} distinct phase(s)`);
  }
  if (flow.hasSimultaneous) {
    summary.push('Includes simultaneous player actions');
  }
  if (flow.hasLoops) {
    summary.push('Uses loops for dynamic game length');
  }

  return summary;
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'boardsmith.json');

  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const gameName = config.displayName || config.name || 'Unknown Game';

  console.log(chalk.cyan(`\nAnalyzing ${gameName}...\n`));

  // Find and read all TypeScript files
  const srcDir = join(cwd, 'src');
  const files = findTypeScriptFiles(srcDir);

  if (files.length === 0) {
    console.log(chalk.yellow('No TypeScript files found in src/'));
    return;
  }

  // Combine all content for analysis
  const allContent = files.map(f => readFileSync(f, 'utf-8')).join('\n');

  // Run analysis
  const elements = analyzeElements(allContent);
  const actions = analyzeActions(allContent);
  const flow = analyzeFlow(allContent);
  const complexity = calculateComplexity(elements, actions, flow);
  const summary = generateSummary(elements, actions, flow, complexity);

  const analysis: GameAnalysis = {
    name: gameName,
    elements,
    actions,
    flow,
    complexity,
    summary,
  };

  if (options.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  // Print formatted output
  console.log(chalk.bold('Element Analysis'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  Total custom classes: ${chalk.cyan(elements.totalClasses)}`);
  if (elements.customClasses.length > 0) {
    console.log(`  Classes: ${chalk.dim(elements.customClasses.join(', '))}`);
  }
  for (const [type, count] of Object.entries(elements.byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  console.log(chalk.bold('Action Analysis'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  Total actions: ${chalk.cyan(actions.totalActions)}`);
  console.log(`  Average selections per action: ${chalk.cyan(actions.averageSelections.toFixed(1))}`);
  if (options.verbose && actions.actions.length > 0) {
    console.log('  Actions:');
    for (const action of actions.actions) {
      const tags: string[] = [];
      if (action.hasCondition) tags.push('conditional');
      if (action.hasRepeat) tags.push('repeating');
      const tagStr = tags.length > 0 ? chalk.dim(` (${tags.join(', ')})`) : '';
      console.log(`    - ${action.name}: ${action.selections} selection(s)${tagStr}`);
    }
  }
  console.log('');

  console.log(chalk.bold('Flow Analysis'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  Total nodes: ${chalk.cyan(flow.totalNodes)}`);
  console.log(`  Max depth: ${chalk.cyan(flow.maxDepth)}`);
  console.log(`  Estimated turns: ${chalk.cyan(flow.estimatedTurnsPerGame)}`);
  if (Object.keys(flow.nodeTypes).length > 0) {
    console.log('  Node types:');
    for (const [type, count] of Object.entries(flow.nodeTypes)) {
      console.log(`    ${type}: ${count}`);
    }
  }
  console.log('');

  console.log(chalk.bold('Complexity Score'));
  console.log(chalk.dim('─'.repeat(40)));

  const categoryColors: Record<string, (s: string) => string> = {
    light: chalk.green,
    medium: chalk.yellow,
    heavy: chalk.hex('#FFA500'),
    complex: chalk.red,
  };
  const categoryColor = categoryColors[complexity.category] || chalk.white;

  console.log(`  Overall: ${categoryColor(complexity.overall + '/10')} (${categoryColor(complexity.category)})`);
  console.log('  Factors:');
  for (const factor of complexity.factors) {
    const bar = '█'.repeat(factor.score) + '░'.repeat(3 - factor.score);
    console.log(`    ${factor.name}: ${bar} ${chalk.dim(factor.description)}`);
  }
  console.log('');

  console.log(chalk.bold('Summary'));
  console.log(chalk.dim('─'.repeat(40)));
  for (const line of summary) {
    console.log(`  • ${line}`);
  }
  console.log('');
}
