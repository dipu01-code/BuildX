#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import {
  ProblemLoader,
  ProblemSelector,
  HintService,
  SolutionService,
  type Problem,
  type Topic,
  type Difficulty,
} from '@buildx/core';

const PROBLEMS_DIR = join(__dirname, '..', '..', 'core', 'problems');
const SEEN_FILE = join(homedir(), '.buildx-cli-seen.json');
const SEEN_WINDOW = 10;

function usage(): string {
  return [
    'Usage: buildx <command> [options]',
    '',
    'Commands:',
    '  list [topic] [difficulty]   List problems, optionally filtered by topic/difficulty.',
    '  pick [topic] [difficulty]   Select a random problem, excluding recently seen ones.',
    '  show <id>                   Print a problem and its test cases.',
    '  hint <id> [level]           Print a progressive hint (level 1..n, default 1).',
    '  solution <id>               Print the reference solution.',
    '',
    'Topics: arrays, strings, linked-lists, stacks-queues, trees, graphs,',
    '        sorting, searching, dynamic-programming, bit-manipulation, mathematics.',
    'Difficulties: easy, medium, hard.',
    '',
    'Examples:',
    '  buildx list arrays easy',
    '  buildx pick --exclude two-sum,valid-palindrome',
    '  buildx hint two-sum 2',
  ].join('\n');
}

function filterProblems(
  problems: Problem[],
  topic?: string,
  difficulty?: string,
): Problem[] {
  return problems.filter((problem) => {
    if (topic !== undefined && problem.topic !== topic) return false;
    if (difficulty !== undefined && problem.difficulty !== difficulty) return false;
    return true;
  });
}

async function loadSeen(): Promise<string[]> {
  try {
    const raw = await readFile(SEEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === 'string');
    return [];
  } catch {
    return [];
  }
}

async function saveSeen(ids: string[]): Promise<void> {
  const trimmed = ids.slice(-SEEN_WINDOW);
  await writeFile(SEEN_FILE, JSON.stringify(trimmed, null, 2) + '\n', 'utf8');
}

function printProblem(problem: Problem, verbose: boolean): void {
  const line = [
    problem.id,
    `[${problem.topic}/${problem.difficulty}]`,
    problem.title,
  ].join(' ');
  console.log(verbose ? `${line}\n  ${problem.description}` : line);
  if (verbose) {
    console.log(`  test cases: ${problem.testCases.length}, hints: ${problem.hints.length}`);
  }
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === 'help' || command === '--help') {
    console.log(usage());
    return;
  }

  const loader = new ProblemLoader();
  const selector = new ProblemSelector();
  const hints = new HintService();
  const solutions = new SolutionService();

  let problems: Problem[];
  try {
    problems = await loader.load(PROBLEMS_DIR);
  } catch (error) {
    console.error(`Failed to load problems: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const excludeFlag = rest.findIndex((a) => a.startsWith('--exclude='));
  const exclude: string[] = excludeFlag >= 0 ? rest[excludeFlag].split('=')[1].split(',').filter(Boolean) : [];
  const args = rest.filter((a) => !a.startsWith('--exclude='));

  switch (command) {
    case 'list': {
      const [topic, difficulty] = args;
      const filtered = filterProblems(problems, topic, difficulty);
      if (filtered.length === 0) {
        console.log('No matching problems.');
        return;
      }
      for (const problem of filtered) printProblem(problem, false);
      break;
    }

    case 'pick': {
      const [topic, difficulty] = args;
      const seen = await loadSeen();
      const picked = selector.select(problems, {
        topic: topic as Topic | undefined,
        difficulty: difficulty as Difficulty | undefined,
        exclude: [...seen, ...exclude],
      });
      if (!picked) {
        console.log('No eligible problems left (all matching problems were seen recently).');
        return;
      }
      await saveSeen([...seen, picked.id]);
      printProblem(picked, true);
      break;
    }

    case 'show': {
      const [id] = args;
      if (!id) {
        console.error('show requires a problem id.');
        process.exitCode = 1;
        return;
      }
      const problem = problems.find((p) => p.id === id);
      if (!problem) {
        console.error(`Problem not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printProblem(problem, true);
      console.log('test cases:');
      for (const tc of problem.testCases) {
        const label = tc.description ?? '(unnamed)';
        console.log(`  - ${label} input=${JSON.stringify(tc.input)} expected=${JSON.stringify(tc.expected)}`);
      }
      break;
    }

    case 'hint': {
      const [id, levelText] = args;
      if (!id) {
        console.error('hint requires a problem id.');
        process.exitCode = 1;
        return;
      }
      const problem = problems.find((p) => p.id === id);
      if (!problem) {
        console.error(`Problem not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const level = levelText ? Number(levelText) : 1;
      if (!Number.isInteger(level) || level < 1) {
        console.error('Hint level must be a positive integer.');
        process.exitCode = 1;
        return;
      }
      const hint = hints.getHint(problem, level);
      if (!hint) {
        console.log(`No hint at level ${level} (this problem has ${hints.maxLevel(problem)} hint(s)).`);
        return;
      }
      console.log(`Hint ${hint.level}: ${hint.text}`);
      break;
    }

    case 'solution': {
      const [id] = args;
      if (!id) {
        console.error('solution requires a problem id.');
        process.exitCode = 1;
        return;
      }
      const problem = problems.find((p) => p.id === id);
      if (!problem) {
        console.error(`Problem not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const solution = solutions.getSolution(problem);
      console.log(`// ${problem.title} — ${solution.language}`);
      console.log(`// ${solution.explanation ?? ''}`);
      console.log(solution.code);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.log(usage());
      process.exitCode = 1;
    }
  }
}

run().catch((error) => {
  console.error((error as Error).message ?? String(error));
  process.exitCode = 1;
});
