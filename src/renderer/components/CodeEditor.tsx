import React from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, placeholder as placeholderExt } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { json } from '@codemirror/lang-json';
import { foldAll, HighlightStyle, syntaxHighlighting, unfoldAll } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

function buildTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        color: 'var(--text)',
        fontSize: '12px',
      },
      '.cm-scroller': {
        fontFamily: 'var(--mono)',
        lineHeight: '1.7',
        overflow: 'auto',
      },
      '.cm-content': { padding: '10px 0', caretColor: 'var(--text)' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-faint)',
        border: 'none',
        paddingRight: '4px',
      },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px', opacity: 0.65 },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-dim)',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--bg-elev-3)',
        border: '1px solid var(--border)',
        color: 'var(--text-dim)',
        borderRadius: '4px',
        padding: '0 5px',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent) !important',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
      '.cm-panels': {
        backgroundColor: 'var(--bg-elev-2)',
        color: 'var(--text)',
        borderTop: '1px solid var(--border)',
      },
      '.cm-panel.cm-search': { padding: '6px 8px', fontSize: '12px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
        fontSize: '12px',
      },
      '.cm-panel.cm-search input': {
        backgroundColor: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: '5px',
        padding: '2px 6px',
        color: 'var(--text)',
      },
      '.cm-panel.cm-search button': {
        backgroundColor: 'var(--bg-elev-3)',
        border: '1px solid var(--border)',
        borderRadius: '5px',
        padding: '2px 8px',
        color: 'var(--text)',
        cursor: 'pointer',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warning) 40%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
      },
      '.cm-placeholder': { color: 'var(--text-faint)' },
    },
    { dark },
  );
}

const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--json-key)' },
  { tag: t.string, color: 'var(--json-string)' },
  { tag: t.number, color: 'var(--json-number)' },
  { tag: t.bool, color: 'var(--json-bool)' },
  { tag: t.null, color: 'var(--json-null)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--text-faint)' },
]);

export interface EditorActions {
  foldAll: () => void;
  unfoldAll: () => void;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  language?: 'json' | 'text';
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  actionsRef?: React.MutableRefObject<EditorActions | null>;
}

/** 基于 CodeMirror 6 的编辑器：折叠、⌘F 搜索、语法高亮、视口渲染（大文件不卡） */
export default function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  placeholder,
  className = '',
  actionsRef,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const langCompartment = React.useRef(new Compartment()).current;
  const themeCompartment = React.useRef(new Compartment()).current;
  const editableCompartment = React.useRef(new Compartment()).current;

  // 只创建一次编辑器实例
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          langCompartment.of(language === 'json' ? json() : []),
          themeCompartment.of(buildTheme(isDark())),
          syntaxHighlighting(highlightStyle),
          editableCompartment.of([EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly)]),
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (actionsRef) {
      actionsRef.current = {
        foldAll: () => foldAll(view),
        unfoldAll: () => unfoldAll(view),
      };
    }
    return () => {
      if (actionsRef) actionsRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部内容变化（切换标签、格式化、加载）时同步进编辑器
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // 语言 / 只读切换
  React.useEffect(() => {
    viewRef.current?.dispatch({
      effects: langCompartment.reconfigure(language === 'json' ? json() : []),
    });
  }, [language, langCompartment]);

  React.useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure([
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
      ]),
    });
  }, [readOnly, editableCompartment]);

  // 跟随应用主题
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      viewRef.current?.dispatch({
        effects: themeCompartment.reconfigure(buildTheme(isDark())),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [themeCompartment]);

  return <div className={`code-editor ${className}`} ref={hostRef} />;
}
