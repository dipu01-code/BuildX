import { languageNameForPath } from './editor-language-name.js';

export async function languageForPath(filePath) {
  const name = filePath.split(/[\\/]/).at(-1)?.toLowerCase() || '';
  const extension = name.includes('.') ? name.split('.').at(-1) : '';
  switch (extension) {
    case 'js': case 'mjs': case 'cjs': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return { name: languageNameForPath(filePath), extension: javascript() };
    }
    case 'jsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return { name: languageNameForPath(filePath), extension: javascript({ jsx: true }) };
    }
    case 'ts': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return { name: languageNameForPath(filePath), extension: javascript({ typescript: true }) };
    }
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return { name: languageNameForPath(filePath), extension: javascript({ typescript: true, jsx: true }) };
    }
    case 'py': {
      const { python } = await import('@codemirror/lang-python');
      return { name: languageNameForPath(filePath), extension: python() };
    }
    case 'json': case 'jsonc': {
      const { json } = await import('@codemirror/lang-json');
      return { name: languageNameForPath(filePath), extension: json() };
    }
    case 'html': case 'htm': case 'xml': case 'svg': {
      const { html } = await import('@codemirror/lang-html');
      return { name: languageNameForPath(filePath), extension: html() };
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css');
      return { name: languageNameForPath(filePath), extension: css() };
    }
    case 'md': case 'markdown': case 'mdx': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return { name: languageNameForPath(filePath), extension: markdown() };
    }
    case 'yaml': case 'yml': {
      const { yaml } = await import('@codemirror/lang-yaml');
      return { name: languageNameForPath(filePath), extension: yaml() };
    }
    case 'toml': {
      const { StreamLanguage } = await import('@codemirror/language');
      const { toml } = await import('@codemirror/legacy-modes/mode/toml');
      return { name: languageNameForPath(filePath), extension: StreamLanguage.define(toml) };
    }
    default:
      return { name: languageNameForPath(filePath), extension: null };
  }
}
