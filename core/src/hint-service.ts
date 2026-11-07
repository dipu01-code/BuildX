import type { Problem, Hint } from './types';

/**
 * Progressive hints: a problem ships with hints ordered by level (1..n).
 * Callers request one level at a time, e.g. level 1 after the first failed
 * attempt, level 2 after the second, and so on.
 */
export class HintService {
  /**
   * The hint at `level`, or null when the problem has no hint for that
   * level (e.g. level 0, or beyond the last hint).
   */
  getHint(problem: Problem, level: number): Hint | null {
    if (!Number.isInteger(level) || level < 1) return null;
    return (problem.hints.find((hint) => hint.level === level) ?? null);
  }

  /** Highest hint level available for this problem (0 when none). */
  maxLevel(problem: Problem): number {
    let max = 0;
    for (const hint of problem.hints) {
      if (hint.level > max) max = hint.level;
    }
    return max;
  }

  /** The next hint after `currentLevel`, or null when none remain. */
  getNextHint(problem: Problem, currentLevel: number): Hint | null {
    return this.getHint(problem, currentLevel + 1);
  }

  /** Whether a hint exists at a level greater than `currentLevel`. */
  hasNext(problem: Problem, currentLevel: number): boolean {
    return this.maxLevel(problem) > currentLevel;
  }

  /** All hints up to and including `level` (progressive reveal prefix). */
  getHintsUpTo(problem: Problem, level: number): Hint[] {
    if (!Number.isInteger(level) || level < 1) return [];
    return problem.hints.filter((hint) => hint.level >= 1 && hint.level <= level);
  }
}

export { type HintService as HintServiceType };
