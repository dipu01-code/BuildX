import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';
import { ProblemSchema, type Problem } from './types';

/**
 * Thrown when one or more problem files fail validation. Collects every
 * failing file so the caller can see all problems at once instead of
 * stopping at the first one.
 */
export class ProblemLoadError extends Error {
  readonly errors: Array<{ file: string; error: unknown }>;

  constructor(errors: Array<{ file: string; error: unknown }>) {
    const list = errors.map((e) => `  - ${e.file}: ${(e.error as Error)?.message ?? String(e.error)}`).join('\n');
    super(`Failed to load ${errors.length} problem file(s):\n${list}`);
    this.name = 'ProblemLoadError';
    this.errors = errors;
  }
}

/**
 * Reads JSON problem files from a directory and validates each one with zod.
 * Pure filesystem + validation layer: no HTTP, no database.
 */
export class ProblemLoader {
  /**
   * Load every *.json problem file in `dir` (sorted by filename for stable
   * ordering). Throws ProblemLoadError if any file is missing, unparseable,
   * or fails zod validation.
   */
  async load(dir: string): Promise<Problem[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      throw new ProblemLoadError([{ file: dir, error }]);
    }

    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));

    const problems: Problem[] = [];
    const errors: Array<{ file: string; error: unknown }> = [];

    for (const entry of jsonFiles) {
      const filePath = join(dir, entry.name);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        const problem = ProblemSchema.parse(parsed);
        problems.push(problem);
      } catch (error) {
        errors.push({ file: entry.name, error });
      }
    }

    if (errors.length > 0) {
      throw new ProblemLoadError(errors);
    }

    return problems;
  }

  /**
   * Load and validate a single problem file.
   */
  async loadFile(filePath: string): Promise<Problem> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      throw new ProblemLoadError([{ file: filePath, error }]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ProblemLoadError([{ file: filePath, error }]);
    }
    return ProblemSchema.parse(parsed);
  }

  /**
   * Load all problems in a directory and return the one matching `id`, or
   * null when no problem has that id.
   */
  async loadById(dir: string, id: string): Promise<Problem | null> {
    const problems = await this.load(dir);
    return problems.find((problem) => problem.id === id) ?? null;
  }
}
