import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createContentSecurityPolicy,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeDevServerUrl,
  rendererFilePath,
} = require('./security.cjs');

describe('renderer boundary helpers', () => {
  it('allows only the expected development renderer origin', () => {
    const config = { devServerUrl: 'http://127.0.0.1:5173', rendererPath: '/unused/index.html' };
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', config)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/', config)).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173.attacker.example/', config)).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/child', config)).toBe(false);
  });

  it('allows only the exact built renderer file in production', () => {
    const rendererPath = path.resolve('/application/desktop/renderer/dist/index.html');
    const config = { devServerUrl: '', rendererPath };
    expect(isTrustedRendererUrl(pathToFileURL(rendererPath).href, config)).toBe(true);
    expect(isTrustedRendererUrl(`${pathToFileURL(rendererPath).href}#main`, config)).toBe(true);
    expect(isTrustedRendererUrl(`${pathToFileURL(rendererPath).href}?unexpected=1`, config)).toBe(false);
    expect(isTrustedRendererUrl('file:///application/other.html', config)).toBe(false);
  });

  it('rejects malformed or unexpected development origins', () => {
    expect(() => normalizeDevServerUrl('https://127.0.0.1:5173')).toThrow();
    expect(() => normalizeDevServerUrl('http://localhost:5173')).toThrow();
    expect(() => normalizeDevServerUrl('http://127.0.0.1:5173/other')).toThrow();
  });

  it('opens only credential-free HTTPS external links', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('https://user:pass@example.com')).toBe(false);
  });

  it('uses a packaged renderer path independent of the current working directory', () => {
    expect(rendererFilePath('/application/desktop/electron')).toBe(
      '/application/desktop/renderer/dist/index.html',
    );
  });

  it('keeps development-only websocket access out of the production policy', () => {
    expect(createContentSecurityPolicy(true)).toContain('ws://127.0.0.1:5173');
    expect(createContentSecurityPolicy(false)).not.toContain('ws://');
  });
});
