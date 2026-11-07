import type { Problem, Topic, Difficulty } from './types';

export interface SelectOptions {
  topic?: Topic;
  difficulty?: Difficulty;
  /**
   * Problem ids the user already saw recently (e.g. the last N). Excluded
   * from selection so the user isn't served repeats.
   */
  exclude?: string[];
  seed?: number;
}

const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;
const MODULUS = 2 ** 32;

/**
 * Creates a deterministic pseudo-random number generator from a seed.
 * Returns numbers in [0, 1).
 */
export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) % MODULUS || 1;
  return () => {
    state = (state * MULTIPLIER + INCREMENT) % MODULUS;
    return state / MODULUS;
  };
}

/**
 * Selects one problem matching `topic` and/or `difficulty`, excluding any
 * ids in `options.exclude`. Returns null when no eligible problem exists.
 * Without a seed, Math.random is used.
 */
export class ProblemSelector {
  constructor(private readonly rng: () => number = Math.random) {}

  select(problems: Problem[], options: SelectOptions = {}): Problem | null {
    let pool = problems.filter((problem) => {
      if (options.topic !== undefined && problem.topic !== options.topic) return false;
      if (options.difficulty !== undefined && problem.difficulty !== options.difficulty) return false;
      if (options.exclude?.includes(problem.id)) return false;
      return true;
    });

    if (pool.length === 0) return null;

    const rng = options.seed !== undefined ? createSeededRng(options.seed) : this.rng;
    const index = Math.floor(rng() * pool.length);
    return pool[index] ?? null;
  }
}
