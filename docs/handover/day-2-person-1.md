# Day 2 hand-over — core engine (Person 1 → Persons 2 and 3)

## What was built

`/core` is a pure TypeScript library with no HTTP and no database dependency. It can be reused by the CLI, the server, and the desktop app. It lives at `/Users/dipu/Developer/Projects/BUILDX/core` and is compiled to `/core/dist` with `tsc`.

Package: `@buildx/core` (private)
- `main`: `dist/index.js` (CommonJS, Node)
- `types`: `dist/index.d.ts`
- `exports`: `.` → `dist/index.js` (require + import)
- Runtime dependency: `zod` only
- Scripts: `npm run build` (tsc), `npm test` (jest)

From the repo root:
- `npm run test:core` — Jest tests for `/core` (config: `core/jest.config.js`)
- `npm run build:core` — compile `/core`
- `npm run build:cli` — compile `/cli` (runs after `build:core`)
- `npm run cli` — run the CLI entry point

Existing tooling was left untouched: `npm test` (vitest), `npm run lint`, `npm run build` (vite) still work exactly as before.

## Exported API (`core/src/index.ts`)

Shared types (all validated with zod schemas, also exported):

- `Topic` / `TopicSchema` — `arrays | strings | linked-lists | stacks-queues | trees | graphs | sorting | searching | dynamic-programming | bit-manipulation | mathematics`
- `Difficulty` / `DifficultySchema` — `easy | medium | hard`
- `Problem` / `ProblemSchema` — id, title, description, topic, difficulty, testCases[], hints[], solution
- `TestCase` / `TestCaseSchema` — input, expected, description?
- `Hint` / `HintSchema` — level (1..n), text
- `Solution` / `SolutionSchema` — language, code, explanation?, complexity?
- `Submission` / `SubmissionSchema` — id, problemId, userId, status, executedAt, testCasesPassed, totalTestCases
- `SubmissionStatus` — `accepted | wrong-answer | runtime-error | time-limit-exceeded | compilation-error`
- `ExecutionResult` / `ExecutionResultSchema` — ok, passed, total, durationMs, failures[]
- `ExecutionFailure` / `ExecutionFailureSchema`
- `User` / `UserSchema`

Services:

- `ProblemLoader` — `load(dir): Promise<Problem[]>`, `loadFile(path)`, `loadById(dir, id)`. Reads JSON problem files and validates each with `ProblemSchema.parse`. Throws `ProblemLoadError` listing every invalid file (not just the first).
- `ProblemSelector` — `select(problems, options): Problem | null`. Options: `topic`, `difficulty`, `exclude` (ids the user already saw, e.g. last N), `seed` (deterministic pseudo-random via `createSeededRng`). Returns `null` when no eligible problem exists. Never mutates the input array.
- `HintService` — `getHint(problem, level)` returns the hint at progressive level 1..n or `null`; `maxLevel(problem)`, `getNextHint(problem, currentLevel)`, `hasNext(problem, currentLevel)`, `getHintsUpTo(problem, level)`.
- `SolutionService` — `getSolution(problem): Solution`, `hasSolution(problem)`.

Repository interfaces (`core/src/repositories.ts`) — **not implemented here**. Person 2 implements these for PostgreSQL and SQLite:

```ts
export interface ProblemRepository {
  findById(id: string): Promise<Problem | null>;
  findAll(): Promise<Problem[]>;
  findByTopicAndDifficulty(topic: Topic, difficulty: Difficulty): Promise<Problem[]>;
  save(problem: Problem): Promise<void>;
}

export interface SubmissionRepository {
  save(submission: Submission): Promise<void>;
  findByProblem(problemId: string): Promise<Submission[]>;
  findByUser(userId: string): Promise<Submission[]>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface StatsRepository {
  recordSolved(userId: string, problemId: string): Promise<void>;
  getSolvedCount(userId: string): Promise<number>;
  getRecentProblemIds(userId: string, limit: number): Promise<string[]>; // newest first
}
```

`StatsRepository.getRecentProblemIds` feeds the selector's `exclude` list so users don't repeat the last N problems.

## Problem files

JSON problem files live in `/core/problems/` (6 samples: two-sum, valid-palindrome, binary-search, max-subarray, invert-binary-tree, course-schedule). Each file matches `ProblemSchema` and carries test cases, 3 progressive hints, and a reference solution. The loader reads any directory, so the server/desktop can point it at their own problem bundles.

## CLI entry point (`/cli`)

Package `buildx-cli`, depends on `@buildx/core` (`file:../core`). Commands:

```
buildx list [topic] [difficulty]
buildx pick [topic] [difficulty] [--exclude=id,id]
buildx show <id>
buildx hint <id> [level]
buildx solution <id>
```

`pick` excludes recently seen problems (persisted in `~/.buildx-cli-seen.json`, last 10) and appends the chosen id. Run `npm run build:core && npm run build:cli && npm run cli` from the repo root, or `node cli/dist/index.js <command>`.

## Tests

Jest + ts-jest, 26 tests, all passing. Coverage on `/core/src` (barrel `index.ts` excluded as it re-exports only):

| Metric | Result | Threshold |
|--------|--------|-----------|
| Statements | 100% | 80% |
| Functions | 100% | 80% |
| Lines | 100% | 80% |
| Branches | 89.58% | 80% |

## What Persons 2 and 3 need to do

1. Implement the four repository interfaces for PostgreSQL and SQLite (classes, not in `/core` — keep `/core` dependency-free).
2. Wire the repositories into the selector flow: `StatsRepository.getRecentProblemIds(userId, N)` → `exclude` → `ProblemSelector.select`.
3. Persist `Submission`s via `SubmissionRepository`; derive stats via `StatsRepository.recordSolved`.
4. Keep `/core` free of HTTP, database clients, and framework code — only `zod` and Node stdlib.

## Verification

```
npm run test:core   # jest with 80% coverage gate on /core
npx tsc -p core/tsconfig.json
npx tsc -p cli/tsconfig.json
node cli/dist/index.js list
```
