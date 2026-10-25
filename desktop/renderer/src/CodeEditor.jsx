import React, { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { languageForPath } from './editor-language.js';

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#dce4da', backgroundColor: '#111612', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-gutters': { backgroundColor: '#111612', color: '#69766d', border: 'none' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'rgba(164, 194, 135, .07)' },
  '.cm-cursor': { borderLeftColor: '#c7eb96' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(160, 196, 126, .24)' },
  '&.cm-focused': { outline: 'none' },
});

export default function CodeEditor({ path, value, onChange, onSave, onState, onReady }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const [language, setLanguage] = useState(null);
  const callbacksRef = useRef({ onChange, onSave, onState });
  callbacksRef.current = { onChange, onSave, onState };

  useEffect(() => {
    let active = true;
    setLanguage(null);
    languageForPath(path).then((result) => { if (active) setLanguage(result); });
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    if (!language) return undefined;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          ...(language.extension ? [language.extension] : []),
          EditorView.lineWrapping,
          editorTheme,
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => {
            callbacksRef.current.onSave();
            return true;
          } }]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacksRef.current.onChange(update.state.doc.toString());
            const cursor = update.state.selection.main.head;
            const line = update.state.doc.lineAt(cursor);
            callbacksRef.current.onState({ line: line.number, column: cursor - line.from + 1 });
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    onReady?.({ find: () => openSearchPanel(view), focus: () => view.focus() });
    view.focus();
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    callbacksRef.current.onState({ line: line.number, column: view.state.selection.main.head - line.from + 1 });
    return () => { onReady?.(null); view.destroy(); viewRef.current = null; };
  // The editor instance belongs to one path and is remounted when switching tabs.
  }, [path, language]);

  return <div className="code-editor-host" ref={hostRef} data-language={language?.name || 'Loading'} aria-label={`${language?.name || 'Loading'} editor`} />;
}
