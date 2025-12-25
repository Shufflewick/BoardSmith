/**
 * Design Command
 *
 * Interactive game design tool that gathers requirements and generates
 * a complete BoardSmith game project.
 */

import { runDesign } from '../design/index.js';

interface DesignCommandOptions {
  from?: string;
  output?: string;
  model?: string;
  resume?: string | boolean;
  listSessions?: boolean;
  skipValidation?: boolean;
}

/**
 * Design command handler
 */
export async function designCommand(options: DesignCommandOptions): Promise<void> {
  await runDesign(options);
}
