import type { ConditionDetail } from './types.js';

/**
 * Helper class for detailed condition tracing.
 * Game developers can optionally use this in their condition functions
 * to provide detailed debug information about why a condition passed or failed.
 *
 * @example
 * ```typescript
 * .condition((ctx, tracer) => {
 *   // Basic usage (tracer may be undefined in normal execution)
 *   if (!tracer) return ctx.player.hand.count() > 0;
 *
 *   // Detailed tracing for debug mode
 *   return tracer.check('has cards in hand', ctx.player.hand.count() > 0);
 * })
 * ```
 */
export class ConditionTracer {
  private details: ConditionDetail[] = [];

  /**
   * Check a condition and record the result.
   * @param label Human-readable description of what's being checked
   * @param value The value to check (truthy = passed)
   * @returns The boolean result of the check
   */
  check(label: string, value: unknown): boolean {
    const passed = Boolean(value);
    this.details.push({ label, value, passed });
    return passed;
  }

  /**
   * Create a nested group of checks.
   * @param label Human-readable description of this group
   * @param fn Function that performs nested checks using a child tracer
   * @returns The boolean result of the nested checks
   */
  nested(label: string, fn: (tracer: ConditionTracer) => boolean): boolean {
    const childTracer = new ConditionTracer();
    const result = fn(childTracer);
    this.details.push({
      label,
      value: result,
      passed: result,
      children: childTracer.getDetails(),
    });
    return result;
  }

  /**
   * Get all recorded condition details.
   */
  getDetails(): ConditionDetail[] {
    return this.details;
  }
}
