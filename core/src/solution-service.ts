import type { Problem, Solution } from './types';

/**
 * Exposes a problem's reference solution. Kept as a service so the CLI,
 * server and desktop app all surface solutions the same way and can later
 * add formatting, redaction, or per-language selection here.
 */
export class SolutionService {
  /**
   * The reference solution for `problem`. Throws when the problem has none
   * (a valid problem always carries one per the Problem schema).
   */
  getSolution(problem: Problem): Solution {
    if (!problem.solution || !problem.solution.code) {
      throw new Error(`Problem ${problem.id} has no reference solution.`);
    }
    return problem.solution;
  }

  /** True when the problem carries a reference solution. */
  hasSolution(problem: Problem): boolean {
    return Boolean(problem.solution && problem.solution.code);
  }
}
