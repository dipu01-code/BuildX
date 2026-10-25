export function languageNameForPath(filePath) {
  const name = filePath.split(/[\\/]/).at(-1)?.toLowerCase() || '';
  const extension = name.includes('.') ? name.split('.').at(-1) : '';
  if (['js', 'mjs', 'cjs'].includes(extension)) return 'JavaScript';
  if (extension === 'jsx') return 'JavaScript JSX';
  if (extension === 'ts') return 'TypeScript';
  if (extension === 'tsx') return 'TypeScript JSX';
  if (extension === 'py') return 'Python';
  if (['json', 'jsonc'].includes(extension)) return 'JSON';
  if (['html', 'htm', 'xml', 'svg'].includes(extension)) return 'HTML';
  if (extension === 'css') return 'CSS';
  if (['md', 'markdown', 'mdx'].includes(extension)) return 'Markdown';
  if (['yaml', 'yml'].includes(extension)) return 'YAML';
  if (extension === 'toml') return 'TOML';
  if (['ini', 'env', 'conf'].includes(extension) || ['dockerfile', 'makefile'].includes(name)) return 'Configuration';
  return 'Plain text';
}
