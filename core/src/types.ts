import { z } from 'zod';

export const TopicSchema = z.enum([
  'arrays',
  'strings',
  'linked-lists',
  'stacks-queues',
  'trees',
  'graphs',
  'sorting',
  'searching',
  'dynamic-programming',
  'bit-manipulation',
  'mathematics',
]);
export type Topic = z.infer<typeof TopicSchema>;

export const DifficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const SubmissionStatusSchema = z.enum([
  'accepted',
  'wrong-answer',
  'runtime-error',
  'time-limit-exceeded',
  'compilation-error',
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const TestCaseSchema = z.object({
  input: z.unknown(),
  expected: z.unknown(),
  description: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const HintSchema = z.object({
  level: z.number().int().positive().describe('Progressive hint level, 1..n'),
  text: z.string().min(1).describe('Hint text for this level'),
});
export type Hint = z.infer<typeof HintSchema>;

export const SolutionSchema = z.object({
  language: z.string().min(1).describe('Language of the solution code, e.g. "javascript" or "python"'),
  code: z.string().min(1).describe('Reference solution source code'),
  explanation: z.string().optional(),
  complexity: z
    .object({ time: z.string(), space: z.string() })
    .optional()
    .describe('Big-O time and space complexity'),
});
export type Solution = z.infer<typeof SolutionSchema>;

export const ProblemSchema = z.object({
  id: z.string().min(1).describe('Stable problem identifier'),
  title: z.string().min(1),
  description: z.string().min(1),
  topic: TopicSchema,
  difficulty: DifficultySchema,
  testCases: z.array(TestCaseSchema).min(1).describe('Validate a submission against these cases'),
  hints: z.array(HintSchema).min(1).describe('Progressive hints, ordered by level'),
  solution: SolutionSchema,
});
export type Problem = z.infer<typeof ProblemSchema>;

export const SubmissionSchema = z.object({
  id: z.string().min(1),
  problemId: z.string().min(1),
  userId: z.string().min(1),
  status: SubmissionStatusSchema,
  executedAt: z.string().datetime(),
  testCasesPassed: z.number().int().nonnegative(),
  totalTestCases: z.number().int().positive(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const ExecutionFailureSchema = z.object({
  input: z.unknown(),
  expected: z.unknown(),
  actual: z.unknown(),
  error: z.string().optional(),
});
export type ExecutionFailure = z.infer<typeof ExecutionFailureSchema>;

export const ExecutionResultSchema = z.object({
  ok: z.boolean(),
  passed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  failures: z.array(ExecutionFailureSchema),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;


