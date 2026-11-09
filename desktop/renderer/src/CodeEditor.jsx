import React, { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { languageForPath } from './editor-language.js';

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: '#dce4da', backgroundColor: '#111612' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-gutters': { backgroundColor: '#111612', color: '#69766d', border: 'none' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: 'rgba(164, 194, 135, .07)' },
  '.cm-cursor': { borderLeftColor: '#c7eb96' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(160, 196, 126, .24)' },
  '&.cm-focused': { outline: 'none' },
});

// Without saved settings the editor keeps its original look: 13px text, wrapping on, CodeMirror's default tabs.
function preferenceExtensions(settings) {
  const extensions = [EditorView.theme({ '&': { fontSize: `${settings?.font_size ?? 13}px` } })];
  if (settings?.word_wrap ?? true) extensions.push(EditorView.lineWrapping);
  if (settings?.tab_size) {
    extensions.push(EditorState.tabSize.of(settings.tab_size), indentUnit.of(' '.repeat(settings.tab_size)));
  }
  return extensions;
}

export default function CodeEditor({ path, value, onChange, onSave, onState, onReady, initialLine = 1, settings = null }) {
  const preferencesRef = useRef(new Compartment());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const initialLineRef = useRef(initialLine);
  initialLineRef.current = initialLine;
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
          preferencesRef.current.of(preferenceExtensions(settingsRef.current)),
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
    function goToLine(number) {
      const target = Math.min(Math.max(1, Number.isInteger(number) ? number : 1), view.state.doc.lines);
      const line = view.state.doc.line(target);
      if (target === 1) return;
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    }
    onReady?.({ find: () => openSearchPanel(view), focus: () => view.focus(), goToLine });
    goToLine(initialLineRef.current);
    view.focus();
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    callbacksRef.current.onState({ line: line.number, column: view.state.selection.main.head - line.from + 1 });
    return () => { onReady?.(null); view.destroy(); viewRef.current = null; };
  // The editor instance belongs to one path and is remounted when switching tabs.
  }, [path, language]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: preferencesRef.current.reconfigure(preferenceExtensions(settings)) });
  }, [settings?.font_size, settings?.tab_size, settings?.word_wrap]);

  return <div className="code-editor-host" ref={hostRef} data-language={language?.name || 'Loading'} aria-label={`${language?.name || 'Loading'} editor`} />;
}
