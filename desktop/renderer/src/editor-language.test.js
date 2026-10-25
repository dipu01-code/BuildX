import { describe, expect, it } from 'vitest';
import { languageNameForPath } from './editor-language-name.js';

describe('editor language detection', () => {
  it.each([
    ['src/app.js', 'JavaScript'], ['src/App.jsx', 'JavaScript JSX'], ['src/main.ts', 'TypeScript'],
    ['src/App.tsx', 'TypeScript JSX'], ['api/main.py', 'Python'], ['package.json', 'JSON'],
    ['index.html', 'HTML'], ['styles.css', 'CSS'], ['README.md', 'Markdown'],
    ['config.yaml', 'YAML'], ['config.toml', 'TOML'], ['Dockerfile', 'Configuration'],
    ['data.unknown', 'Plain text'],
  ])('maps %s to %s highlighting', (filePath, expected) => {
    expect(languageNameForPath(filePath)).toBe(expected);
  });
});
