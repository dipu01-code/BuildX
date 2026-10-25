import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CodeEditor from './CodeEditor.jsx';

describe('CodeEditor', () => {
  it('bundles a local editor view and displays the provided document', async () => {
    render(<CodeEditor path="src/main.py" value="print('hello')" onChange={vi.fn()} onSave={vi.fn()} onState={vi.fn()} />);
    expect(await screen.findByLabelText('Python editor')).toBeInTheDocument();
    expect(document.querySelector('.cm-content')?.textContent).toBe("print('hello')");
  });
});
