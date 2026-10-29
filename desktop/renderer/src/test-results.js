const OUTPUT_LIMIT = 6000;

export function redactTestOutput(value, maximum = OUTPUT_LIMIT) {
  const text = String(value ?? '')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{20,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bAIza[0-9a-z_-]{30,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bgh[pousr]_[a-z0-9]{20,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bglpat-[a-z0-9_-]{12,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bxox[baprs]-[a-z0-9-]{12,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bnpm_[a-z0-9]{30,}\b/gi, '[REDACTED TOKEN]')
    .replace(/\bBearer\s+[a-z0-9._~+/=-]{16,}/gi, 'Bearer [REDACTED TOKEN]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s,"']+/gi, '[REDACTED CREDENTIAL]')
    .replace(/(^|\s)(?:\/(?:Users|home|private|tmp|etc|var|opt|root|Volumes|Applications|System|Library|mnt)\/[^\s,;]*|[A-Za-z]:\\[^\s,;]*)/gm, '$1[LOCAL PATH]');
  if (text.length <= maximum) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, maximum - 32))}\n[output excerpt truncated]`, truncated: true };
}

export function parseTestResult({ command = '', test_runner: testRunner = '', stdout = '', stderr = '', status = 'running', exit_code: exitCode = null, termination_reason: terminationReason = null, output_truncated: outputTruncated = false } = {}) {
  const rawOutput = `${stdout || ''}${stderr ? `${stdout ? '\n' : ''}${stderr}` : ''}`;
  const parseClipped = rawOutput.length > 100_000;
  const output = rawOutput.slice(-100_000);
  const runner = ['pytest', 'vitest', 'jest'].includes(testRunner) ? testRunner
    : /pytest/i.test(command) ? 'pytest' : /vitest/i.test(command) ? 'vitest' : /jest/i.test(command) ? 'jest' : 'unknown';
  let summary = null;
  let failedTests = [];
  let partial = false;
  if (runner === 'pytest') {
    const line = [...output.matchAll(/^=+\s*(.*?)\s+in\s+[\d.]+s\s*=+\s*$/gm)].at(-1)?.[1]
      || [...output.matchAll(/^([\d,]+\s+(?:(?:passed|failed|skipped|error|errors|xfailed|xpassed)\s*)+)(?:in\s+[\d.]+s)?\s*$/gm)].at(-1)?.[1];
    if (line) {
      const value = { passed: 0, failed: 0, skipped: 0, errored: 0 };
      for (const item of line.matchAll(/([\d,]+)\s+(passed|failed|skipped|errors?|xfailed|xpassed)/gi)) {
        const number = Number(item[1].replaceAll(',', ''));
        const state = item[2].toLowerCase();
        if (state === 'passed' || state === 'xpassed') value.passed += number;
        else if (state === 'failed') value.failed += number;
        else if (state === 'skipped' || state === 'xfailed') value.skipped += number;
        else value.errored += number;
      }
      value.total = value.passed + value.failed + value.skipped + value.errored;
      summary = value.total ? value : null;
    }
    failedTests = [...output.matchAll(/^FAILED\s+(.+?)(?:\s+-\s+(.+))?$/gm)].slice(-50)
      .map((item) => ({ name: item[1].trim(), message: (item[2] || '').trim() }));
  } else if (runner === 'vitest') {
    const line = [...output.matchAll(/^\s*Tests\s+(.+?)\s*\((\d+)\)\s*$/gm)].at(-1);
    if (line) {
      const value = { passed: 0, failed: 0, skipped: 0, errored: 0 };
      for (const item of line[1].matchAll(/([\d,]+)\s+(passed|failed|skipped|todo|pending|error|errors)/gi)) {
        const number = Number(item[1].replaceAll(',', ''));
        const state = item[2].toLowerCase();
        if (state === 'passed') value.passed += number;
        else if (state === 'failed') value.failed += number;
        else if (state === 'skipped' || state === 'todo' || state === 'pending') value.skipped += number;
        else value.errored += number;
      }
      value.total = Number(line[2]);
      summary = value.total ? value : null;
    }
  } else if (runner === 'jest') {
    const line = [...output.matchAll(/^\s*Tests:\s*(.*?)\s*$/gm)].at(-1);
    if (line) {
      const value = { passed: 0, failed: 0, skipped: 0, errored: 0 };
      for (const item of line[1].matchAll(/([\d,]+)\s+(passed|failed|skipped|pending|todo|total)/gi)) {
        const number = Number(item[1].replaceAll(',', ''));
        const state = item[2].toLowerCase();
        if (state === 'passed') value.passed = number;
        else if (state === 'failed') value.failed = number;
        else if (state === 'skipped' || state === 'pending' || state === 'todo') value.skipped = number;
        else value.total = number;
      }
      value.total ??= value.passed + value.failed + value.skipped + value.errored;
      summary = value.total ? value : null;
    }
  }
  if (summary && summary.failed + summary.errored + summary.passed + summary.skipped !== summary.total) partial = true;
  if (outputTruncated) partial = true;
  if (parseClipped || (summary && (['running', 'timed_out', 'terminated'].includes(status) || terminationReason === 'signal'))) partial = true;
  let outcome = 'running';
  if (terminationReason === 'spawn_error') outcome = 'infrastructure_error';
  else if (status === 'timed_out') outcome = 'timed_out';
  else if (status === 'terminated') outcome = 'cancelled';
  else if (status === 'failed') outcome = summary && (summary.failed > 0 || summary.errored > 0) ? 'failed' : 'process_failed';
  else if (status === 'succeeded') {
    outcome = summary && summary.total > 0 && summary.failed === 0 && summary.errored === 0 && exitCode === 0
      ? 'passed' : summary && (summary.failed > 0 || summary.errored > 0) ? 'failed' : 'unparsed';
  }
  return { runner, outcome, summary, failed_tests: failedTests, partial, exit_code: exitCode,
    termination_reason: terminationReason, output_truncated: Boolean(outputTruncated) };
}

export { OUTPUT_LIMIT };
