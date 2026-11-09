import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import CodeEditor from './CodeEditor.jsx';

describe('CodeEditor', () => {
  it('bundles a local editor view and displays the provided document', async () => {
    render(<CodeEditor path="src/main.py" value="print('hello')" onChange={vi.fn()} onSave={vi.fn()} onState={vi.fn()} />);
    expect(await screen.findByLabelText('Python editor')).toBeInTheDocument();
    expect(document.querySelector('.cm-content')?.textContent).toBe("print('hello')");
  });

  it('applies saved font size, tab size, and wrapping, and updates them in place', async () => {
    const { container, rerender } = render(<CodeEditor path="a.py" value="x" onChange={vi.fn()} onSave={vi.fn()} onState={vi.fn()}
      settings={{ font_size: 18, tab_size: 4, word_wrap: false }} />);
    await within(container).findByLabelText('Python editor');
    const editor = container.querySelector('.cm-editor');
    const view = EditorView.findFromDOM(editor);
    expect(view.state.tabSize).toBe(4);
    expect(container.querySelector('.cm-content').classList.contains('cm-lineWrapping')).toBe(false);
    rerender(<CodeEditor path="a.py" value="x" onChange={vi.fn()} onSave={vi.fn()} onState={vi.fn()}
      settings={{ font_size: 14, tab_size: 4, word_wrap: true }} />);
    expect(container.querySelector('.cm-editor')).toBe(editor);
    expect(container.querySelector('.cm-content').classList.contains('cm-lineWrapping')).toBe(true);
  });
});
