const path = require('node:path');
const { fileURLToPath } = require('node:url');

function normalizeDevServerUrl(value) {
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('BUILDX_DEV_SERVER_URL must be a valid URL.');
  }

  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '5173' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('BUILDX_DEV_SERVER_URL must use the expected local Vite origin.');
  }

  return parsed;
}

function rendererFilePath(moduleDirectory) {
  return path.resolve(moduleDirectory, '../renderer/dist/index.html');
}

function isTrustedRendererUrl(value, { devServerUrl, rendererPath }) {
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    return false;
  }

  const expectedDevUrl = normalizeDevServerUrl(devServerUrl);
  if (expectedDevUrl) {
    return (
      candidate.origin === expectedDevUrl.origin &&
      candidate.pathname === '/' &&
      candidate.username === '' &&
      candidate.password === ''
    );
  }

  return (
    candidate.protocol === 'file:' &&
    candidate.host === '' &&
    candidate.search === '' &&
    path.resolve(fileURLToPath(candidate)) === path.resolve(rendererPath)
  );
}

function isSafeExternalUrl(value) {
  try {
    const candidate = new URL(value);
    return candidate.protocol === 'https:' && !candidate.username && !candidate.password;
  } catch {
    return false;
  }
}

function createContentSecurityPolicy(isDevelopment) {
  const connectSources = isDevelopment
    ? "'self' ws://127.0.0.1:5173"
    : "'self'";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = {
  createContentSecurityPolicy,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeDevServerUrl,
  rendererFilePath,
};
