import type { Problem, Submission, User } from './types';
import type { Topic, Difficulty } from './types';

/**
 * Persistence ports. Person 2 implements these for PostgreSQL and SQLite.
 * Do not implement here — this file only defines the contracts.
 */

/** Problems catalogue. */
export interface ProblemRepository {
  findById(id: string): Promise<Problem | null>;
  findAll(): Promise<Problem[]>;
  findByTopicAndDifficulty(topic: Topic, difficulty: Difficulty): Promise<Problem[]>;
  save(problem: Problem): Promise<void>;
}

/** User problem submissions and their execution outcomes. */
export interface SubmissionRepository {
  save(submission: Submission): Promise<void>;
  findByProblem(problemId: string): Promise<Submission[]>;
  findByUser(userId: string): Promise<Submission[]>;
}

/** Application users. */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

/** User progress and recent-activity statistics. */
export interface StatsRepository {
  /**
   * Records that `userId` solved `problemId` (callers pass an accepted
   * submission, this repository derives the stat).
   */
  recordSolved(userId: string, problemId: string): Promise<void>;

  /** Number of distinct problems solved by `userId`. */
  getSolvedCount(userId: string): Promise<number>;

  /**
   * Problem ids `userId` saw most recently, newest first. Used by the
   * selector to avoid repeating the last N problems.
   * At most `limit` ids are returned.
   */
  getRecentProblemIds(userId: string, limit: number): Promise<string[]>;
}
