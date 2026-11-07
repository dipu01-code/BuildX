import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProblemLoader, ProblemLoadError } from '../problem-loader';
import { ProblemSelector, createSeededRng } from '../selector';
import { HintService } from '../hint-service';
import { SolutionService } from '../solution-service';
import type { Problem } from '../types';

const PROBLEMS_DIR = join(__dirname, '..', '..', 'problems');

function makeProblem(overrides: Partial<Problem> = {}): Problem {
  return {
    id: 'p1',
    title: 'One',
    description: 'desc',
    topic: 'arrays',
    difficulty: 'easy',
    testCases: [{ input: { x: 1 }, expected: 2 }],
    hints: [
      { level: 1, text: 'first hint' },
      { level: 2, text: 'second hint' },
    ],
    solution: { language: 'javascript', code: 'return 1;' },
    ...overrides,
  };
}

describe('ProblemLoader', () => {
  it('loads and validates every JSON problem file from a directory', async () => {
    const loader = new ProblemLoader();
    const problems = await loader.load(PROBLEMS_DIR);
    expect(problems.length).toBeGreaterThanOrEqual(6);
    const ids = problems.map((p) => p.id);
    expect(ids).toContain('two-sum');
    expect(ids).toContain('binary-search');
    expect(ids).toContain('course-schedule');
    for (const problem of problems) {
      expect(typeof problem.id).toBe('string');
      expect(['arrays', 'strings', 'trees', 'graphs', 'dynamic-programming']).toContain(problem.topic);
      expect(['easy', 'medium', 'hard']).toContain(problem.difficulty);
      expect(problem.testCases.length).toBeGreaterThan(0);
      expect(problem.hints.length).toBeGreaterThan(0);
      expect(problem.solution.code.length).toBeGreaterThan(0);
    }
    // Stable ordering: sorted by filename.
    expect(ids[0]).toBe('binary-search');
  });

  it('loadById returns the matching problem or null', async () => {
    const loader = new ProblemLoader();
    const found = await loader.loadById(PROBLEMS_DIR, 'two-sum');
    expect(found?.id).toBe('two-sum');
    expect(found?.title).toBe('Two Sum');
    expect(await loader.loadById(PROBLEMS_DIR, 'does-not-exist')).toBeNull();
  });

  it('loadFile parses and validates a single problem file', async () => {
    const loader = new ProblemLoader();
    const problem = await loader.loadFile(join(PROBLEMS_DIR, 'two-sum.json'));
    expect(problem.id).toBe('two-sum');
    expect(problem.hints[0].level).toBe(1);
  });

  it('loadFile throws ProblemLoadError for a missing file', async () => {
    const loader = new ProblemLoader();
    await expect(loader.loadFile(join(PROBLEMS_DIR, 'does-not-exist.json'))).rejects.toBeInstanceOf(
      ProblemLoadError,
    );
  });

  it('loadFile throws ProblemLoadError for invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildx-core-test-'));
    try {
      await writeFile(join(dir, 'broken.json'), '{ not valid json');
      const loader = new ProblemLoader();
      await expect(loader.loadFile(join(dir, 'broken.json'))).rejects.toBeInstanceOf(ProblemLoadError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws ProblemLoadError for a directory that does not exist', async () => {
    const loader = new ProblemLoader();
    await expect(loader.load(join(tmpdir(), 'buildx-core-no-such-dir'))).rejects.toBeInstanceOf(
      ProblemLoadError,
    );
  });

  it('throws ProblemLoadError listing every invalid file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildx-core-test-'));
    try {
      await writeFile(join(dir, 'bad.json'), '{ not valid json');
      await writeFile(join(dir, 'also-bad.json'), JSON.stringify({ id: 'x' }));
      const loader = new ProblemLoader();
      await expect(loader.load(dir)).rejects.toMatchObject({
        name: 'ProblemLoadError',
      });
      try {
        await loader.load(dir);
      } catch (error) {
        const loadError = error as ProblemLoadError;
        expect(loadError.errors.map((e) => e.file).sort()).toEqual(['also-bad.json', 'bad.json']);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ProblemSelector', () => {
  const problems: Problem[] = [
    makeProblem({ id: 'easy-array-1', topic: 'arrays', difficulty: 'easy' }),
    makeProblem({ id: 'easy-array-2', topic: 'arrays', difficulty: 'easy' }),
    makeProblem({ id: 'medium-string', topic: 'strings', difficulty: 'medium' }),
    makeProblem({ id: 'hard-graph', topic: 'graphs', difficulty: 'hard' }),
  ];

  const selector = new ProblemSelector();

  it('filters by topic', () => {
    const picked = selector.select(problems, { topic: 'strings' });
    expect(picked?.id).toBe('medium-string');
  });

  it('filters by difficulty', () => {
    const picked = selector.select(problems, { difficulty: 'hard' });
    expect(picked?.id).toBe('hard-graph');
  });

  it('filters by topic and difficulty together', () => {
    const picked = selector.select(problems, { topic: 'arrays', difficulty: 'easy' });
    expect(['easy-array-1', 'easy-array-2']).toContain(picked?.id);
  });

  it('excludes problems the user already saw (last N)', () => {
    const picked = selector.select(problems, {
      topic: 'arrays',
      difficulty: 'easy',
      exclude: ['easy-array-1'],
    });
    expect(picked?.id).toBe('easy-array-2');
  });

  it('returns null when every eligible problem is excluded', () => {
    const picked = selector.select(problems, { exclude: ['easy-array-1', 'easy-array-2', 'medium-string', 'hard-graph'] });
    expect(picked).toBeNull();
  });

  it('returns null when filters match nothing', () => {
    const picked = selector.select(problems, { topic: 'stacks-queues' });
    expect(picked).toBeNull();
  });

  it('picks only from the eligible pool', () => {
    for (let i = 0; i < 50; i++) {
      const picked = selector.select(problems, { topic: 'arrays' });
      expect(['easy-array-1', 'easy-array-2']).toContain(picked?.id);
    }
  });

  it('is deterministic when a seed is given', () => {
    const a = selector.select(problems, { seed: 42 });
    const b = selector.select(problems, { seed: 42 });
    expect(a?.id).toBe(b?.id);
    expect(a).not.toBeNull();
  });

  it('different seeds can pick different problems', () => {
    const ids = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const picked = selector.select(problems, { seed });
      if (picked) ids.add(picked.id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it('does not mutate the input problems array', () => {
    const before = problems.map((p) => p.id);
    selector.select(problems, { topic: 'arrays' });
    expect(problems.map((p) => p.id)).toEqual(before);
  });
});

describe('createSeededRng', () => {
  it('returns numbers in [0, 1) and repeats for the same seed', () => {
    const one = createSeededRng(7);
    const two = createSeededRng(7);
    for (let i = 0; i < 10; i++) {
      const a = one();
      const b = two();
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('different seeds produce different sequences', () => {
    const one = createSeededRng(1);
    const two = createSeededRng(2);
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (one() !== two()) different = true;
    }
    expect(different).toBe(true);
  });
});

describe('HintService', () => {
  const problem = makeProblem();

  it('returns the hint for each progressive level 1..n', () => {
    const service = new HintService();
    expect(service.getHint(problem, 1)?.text).toBe('first hint');
    expect(service.getHint(problem, 2)?.text).toBe('second hint');
  });

  it('returns null below level 1 and beyond the last hint', () => {
    const service = new HintService();
    expect(service.getHint(problem, 0)).toBeNull();
    expect(service.getHint(problem, -1)).toBeNull();
    expect(service.getHint(problem, 3)).toBeNull();
    expect(service.getHint(problem, 100)).toBeNull();
  });

  it('reports the max level and whether a next hint exists', () => {
    const service = new HintService();
    expect(service.maxLevel(problem)).toBe(2);
    expect(service.hasNext(problem, 0)).toBe(true);
    expect(service.hasNext(problem, 1)).toBe(true);
    expect(service.hasNext(problem, 2)).toBe(false);
    expect(service.hasNext(problem, 5)).toBe(false);
  });

  it('getNextHint returns the hint after currentLevel', () => {
    const service = new HintService();
    expect(service.getNextHint(problem, 1)?.text).toBe('second hint');
    expect(service.getNextHint(problem, 2)).toBeNull();
  });

  it('getHintsUpTo returns the progressive prefix', () => {
    const service = new HintService();
    expect(service.getHintsUpTo(problem, 1).map((h) => h.level)).toEqual([1]);
    expect(service.getHintsUpTo(problem, 2).map((h) => h.level)).toEqual([1, 2]);
    expect(service.getHintsUpTo(problem, 0)).toEqual([]);
    expect(service.getHintsUpTo(problem, -3)).toEqual([]);
  });
});

describe('SolutionService', () => {
  it('exposes the reference solution', () => {
    const service = new SolutionService();
    const problem = makeProblem();
    const solution = service.getSolution(problem);
    expect(solution.language).toBe('javascript');
    expect(solution.code).toContain('return 1;');
    expect(service.hasSolution(problem)).toBe(true);
  });

  it('getSolution throws when the problem has no solution', () => {
    const service = new SolutionService();
    const problem = makeProblem();
    delete (problem as unknown as Record<string, unknown>).solution;
    expect(() => service.getSolution(problem as Problem)).toThrow();
    expect(service.hasSolution(problem as Problem)).toBe(false);
  });
});
