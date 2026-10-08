/**
 * The weight of one of the game's bot objectives, by id
 */
export interface ObjectiveWeight {
  /** The objective's id: its key in the record the game's objectives function returns */
  id: string;
  /** The weight evolution gives it */
  weight: number;
}

/**
 * Weight evolution progress update
 */
export interface TrainingProgress {
  /** Current generation (1-indexed; 0 while the starting weights are benchmarked) */
  iteration: number;
  /** Total generations */
  totalIterations: number;
  /** How much of the current step is done, in the units `message` names (games or candidates) */
  gamesCompleted: number;
  /** How much the current step has to do, in the same units */
  totalGames: number;
  /** Current best win rate */
  bestWinRate: number;
  /** Number of objectives whose weights are being evolved */
  objectiveCount: number;
  /** Status message */
  message: string;
}
