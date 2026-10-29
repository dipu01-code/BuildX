import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createTestCommandDiscovery } = require('./test-command-discovery.cjs');
const projectId = '550e8400-e29b-41d4-a716-446655440000';
let roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-testing-discovery-'));
  const canonical = await fs.realpath(root);
  roots.push(canonical);
  return canonical;
}

function createDiscovery(root, options = {}) {
  return createTestCommandDiscovery({ getProjectRoot: async (id) => {
    expect(id).toBe(projectId);
    return root;
  }, environment: options.environment ?? process.env, platform: options.platform || process.platform });
}

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots = [];
});

describe('test command discovery', () => {
  it('discovers only test-named package scripts and checks configured runner availability without executing scripts', async () => {
    const root = await fixture();
    await fs.mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', '.bin', 'vitest'), 'not executed', { mode: 0o755 });
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^4.0.0' },
      scripts: { test: 'vitest run', 'test:unit': 'vitest run src', build: 'vite build', start: 'node server.js', deploy: 'release' },
    }));
    const result = await createDiscovery(root).discover(projectId);
    expect(result.commands).toHaveLength(2);
    expect(result.commands.map((item) => item.command)).toEqual(['npm test', 'npm run test:unit']);
    expect(result.commands.every((item) => item.runner === 'vitest' && item.available)).toBe(true);
    expect(result.commands[0].source).toBe('package.json scripts.test');
  });

  it('reports unavailable dependencies rather than assuming a config file makes a runner available', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^4.0.0' } }));
    await fs.writeFile(path.join(root, 'vitest.config.ts'), 'export default {}');
    const result = await createDiscovery(root, { environment: { PATH: '' } }).discover(projectId);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({ runner: 'vitest', available: false });
    expect(result.commands[0].unavailable_reason).toMatch(/not installed|not available/i);
  });

  it('discovers configured pytest only when a project or PATH runner exists', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    const unavailable = await createDiscovery(root, { environment: { PATH: '' } }).discover(projectId);
    expect(unavailable.commands[0]).toMatchObject({ runner: 'pytest', available: false, source: 'pyproject.toml' });
    const runnerPath = path.join(root, '.venv', 'bin');
    await fs.mkdir(runnerPath, { recursive: true });
    await fs.writeFile(path.join(runnerPath, 'pytest'), 'not executed', { mode: 0o755 });
    const available = await createDiscovery(root).discover(projectId);
    expect(available.commands[0]).toMatchObject({ runner: 'pytest', command: './.venv/bin/pytest -q', available: true });
  });

  it('reports malformed configuration and offers manual setup when no test commands are recognized', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'package.json'), '{broken');
    const result = await createDiscovery(root).discover(projectId);
    expect(result.commands).toEqual([]);
    expect(result.manual_command_supported).toBe(true);
    expect(result.message).toMatch(/manually/i);
    expect(result.issues).toContainEqual({ source: 'package.json', message: 'The package manifest is malformed JSON.' });
  });

  it('rejects noncanonical project roots and malformed project IDs', async () => {
    const root = await fixture();
    const discovery = createTestCommandDiscovery({ getProjectRoot: async () => `${root}/..` });
    await expect(discovery.discover(projectId)).rejects.toThrow(/confirm this project folder/i);
    await expect(discovery.discover('../project')).rejects.toThrow(/identifier/i);
  });
});
