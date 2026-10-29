import { describe, expect, it } from 'vitest';
import { parseTestResult, redactTestOutput } from './test-results.js';

describe('test-runner result parsing', () => {
  it('parses pytest pass/fail/skip counts and failed test names', () => {
    const result = parseTestResult({ test_runner: 'pytest', command: 'pytest -q', status: 'failed', exit_code: 1,
      stdout: 'FAILED tests/test_math.py::test_add - assert 2 == 3\n', stderr: '===== 1 failed, 2 passed, 1 skipped in 0.10s =====\n' });
    expect(result).toMatchObject({ runner: 'pytest', outcome: 'failed', summary: { passed: 2, failed: 1, skipped: 1, total: 4 } });
    expect(result.failed_tests).toEqual([{ name: 'tests/test_math.py::test_add', message: 'assert 2 == 3' }]);
  });

  it('parses Vitest and Jest counts while honoring the actual process exit status', () => {
    const vitest = parseTestResult({ test_runner: 'vitest', command: 'npm test', status: 'succeeded', exit_code: 0,
      stdout: 'Tests  1 failed | 1 skipped | 4 passed (6)' });
    expect(vitest).toMatchObject({ outcome: 'failed', summary: { passed: 4, failed: 1, skipped: 1, total: 6 } });
    const jest = parseTestResult({ test_runner: 'jest', command: 'npm run test:unit', status: 'succeeded', exit_code: 0,
      stdout: 'Tests:       2 passed, 2 total' });
    expect(jest).toMatchObject({ outcome: 'passed', summary: { passed: 2, failed: 0, total: 2 } });
  });

  it('does not claim success when a passing summary is absent or incomplete', () => {
    expect(parseTestResult({ test_runner: 'unknown', command: 'custom check', status: 'succeeded', exit_code: 0, stdout: 'done' }).outcome).toBe('unparsed');
    expect(parseTestResult({ test_runner: 'pytest', command: 'pytest', status: 'succeeded', exit_code: 0, stdout: 'no tests ran' }).outcome).toBe('unparsed');
    expect(parseTestResult({ test_runner: 'pytest', command: 'pytest', status: 'failed', exit_code: 2, stdout: 'collection error' }).outcome).toBe('process_failed');
  });

  it('distinguishes launch errors, cancellation, timeouts, and bounded/truncated output', () => {
    expect(parseTestResult({ status: 'failed', termination_reason: 'spawn_error' }).outcome).toBe('infrastructure_error');
    expect(parseTestResult({ status: 'terminated', termination_reason: 'user' }).outcome).toBe('cancelled');
    expect(parseTestResult({ status: 'timed_out', termination_reason: 'timeout' }).outcome).toBe('timed_out');
    const redacted = redactTestOutput('api_key=sk-proj-12345678901234567890 /Users/alice/repo/file.js', 50);
    expect(redacted.text).not.toContain('sk-proj-');
    expect(redacted.text).not.toContain('/Users/alice');
    expect(redactTestOutput('x'.repeat(100), 40).truncated).toBe(true);
  });
});
