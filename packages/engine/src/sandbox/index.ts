/**
 * Sandbox utilities for secure game execution
 *
 * Provides runtime limits and safety checks for executing game code
 */

/**
 * Execution limits configuration
 */
export interface ExecutionLimits {
  /** Maximum time for a single action in milliseconds (default: 100ms) */
  actionTimeout: number;
  /** Maximum number of operations before timeout (default: 100000) */
  maxOperations: number;
  /** Maximum recursion depth (default: 100) */
  maxRecursionDepth: number;
}

/**
 * Default execution limits
 */
export const DEFAULT_LIMITS: ExecutionLimits = {
  actionTimeout: 100,
  maxOperations: 100000,
  maxRecursionDepth: 100,
};

/**
 * Error thrown when execution limits are exceeded
 */
export class ExecutionLimitError extends Error {
  constructor(
    public readonly limitType: 'timeout' | 'operations' | 'recursion',
    message: string
  ) {
    super(message);
    this.name = 'ExecutionLimitError';
  }
}

/**
 * Execution context for tracking limits
 */
export class ExecutionContext {
  private operationCount = 0;
  private recursionDepth = 0;
  private startTime: number | null = null;
  private limits: ExecutionLimits;

  constructor(limits: Partial<ExecutionLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Start tracking execution
   */
  start(): void {
    this.operationCount = 0;
    this.recursionDepth = 0;
    this.startTime = Date.now();
  }

  /**
   * Stop tracking and reset
   */
  stop(): void {
    this.startTime = null;
    this.operationCount = 0;
    this.recursionDepth = 0;
  }

  /**
   * Record an operation and check limits
   * @throws ExecutionLimitError if limits exceeded
   */
  tick(): void {
    this.operationCount++;

    // Check operation count
    if (this.operationCount > this.limits.maxOperations) {
      throw new ExecutionLimitError(
        'operations',
        `Maximum operation count (${this.limits.maxOperations}) exceeded. ` +
        'This may indicate an infinite loop in your game logic.'
      );
    }

    // Check timeout
    if (this.startTime !== null) {
      const elapsed = Date.now() - this.startTime;
      if (elapsed > this.limits.actionTimeout) {
        throw new ExecutionLimitError(
          'timeout',
          `Action timeout (${this.limits.actionTimeout}ms) exceeded. ` +
          'Game actions must complete quickly.'
        );
      }
    }
  }

  /**
   * Enter a function call (tracks recursion depth)
   * @throws ExecutionLimitError if max recursion exceeded
   */
  enterFunction(): void {
    this.recursionDepth++;
    if (this.recursionDepth > this.limits.maxRecursionDepth) {
      throw new ExecutionLimitError(
        'recursion',
        `Maximum recursion depth (${this.limits.maxRecursionDepth}) exceeded. ` +
        'This may indicate infinite recursion in your game logic.'
      );
    }
  }

  /**
   * Exit a function call
   */
  exitFunction(): void {
    this.recursionDepth = Math.max(0, this.recursionDepth - 1);
  }

  /**
   * Get current execution stats
   */
  getStats(): {
    operations: number;
    recursionDepth: number;
    elapsedMs: number | null;
  } {
    return {
      operations: this.operationCount,
      recursionDepth: this.recursionDepth,
      elapsedMs: this.startTime ? Date.now() - this.startTime : null,
    };
  }
}

/**
 * Execute a function with limits
 * @param fn Function to execute
 * @param limits Optional execution limits
 * @returns Result of the function
 * @throws ExecutionLimitError if limits exceeded
 */
export function withLimits<T>(
  fn: (ctx: ExecutionContext) => T,
  limits?: Partial<ExecutionLimits>
): T {
  const ctx = new ExecutionContext(limits);
  ctx.start();
  try {
    return fn(ctx);
  } finally {
    ctx.stop();
  }
}

/**
 * Async version of withLimits
 */
export async function withLimitsAsync<T>(
  fn: (ctx: ExecutionContext) => Promise<T>,
  limits?: Partial<ExecutionLimits>
): Promise<T> {
  const ctx = new ExecutionContext(limits);
  ctx.start();
  try {
    return await fn(ctx);
  } finally {
    ctx.stop();
  }
}

/**
 * Create a guarded version of a function that respects execution limits
 */
export function guard<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ctx: ExecutionContext
): T {
  return ((...args: Parameters<T>) => {
    ctx.tick();
    ctx.enterFunction();
    try {
      return fn(...args);
    } finally {
      ctx.exitFunction();
    }
  }) as T;
}

/**
 * Validate that code doesn't contain forbidden patterns
 * Used as a secondary check at runtime
 */
export function validateCode(code: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  const forbiddenPatterns = [
    { pattern: /\bfetch\s*\(/, message: 'Network access (fetch) is forbidden' },
    { pattern: /\bXMLHttpRequest\b/, message: 'Network access (XMLHttpRequest) is forbidden' },
    { pattern: /\beval\s*\(/, message: 'Code evaluation (eval) is forbidden' },
    { pattern: /\bnew\s+Function\s*\(/, message: 'Code evaluation (Function) is forbidden' },
    { pattern: /\bsetTimeout\s*\(/, message: 'Timers (setTimeout) are forbidden' },
    { pattern: /\bsetInterval\s*\(/, message: 'Timers (setInterval) are forbidden' },
    { pattern: /\bMath\.random\s*\(/, message: 'Math.random() is forbidden - use game.random instead' },
    { pattern: /\bDate\.now\s*\(/, message: 'Date.now() is forbidden' },
    { pattern: /\brequire\s*\(\s*['"]fs/, message: 'Filesystem access is forbidden' },
    { pattern: /\bimport\s*\(\s*['"]fs/, message: 'Filesystem access is forbidden' },
  ];

  for (const { pattern, message } of forbiddenPatterns) {
    if (pattern.test(code)) {
      issues.push(message);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
