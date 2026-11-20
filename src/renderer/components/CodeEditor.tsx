import React from 'react';
import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { json } from '@codemirror/lang-json';
import { SearchQuery } from '@codemirror/search';
import {
  ensureSyntaxTree,
  foldAll,
  HighlightStyle,
  syntaxHighlighting,
  unfoldAll,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { Icon } from './ui';

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

/* ------------------------------- 搜索高亮 ------------------------------- */

const matchMark = Decoration.mark({ class: 'cm-find-match' });
const currentMatchMark = Decoration.mark({ class: 'cm-find-current' });

const setMatches = StateEffect.define<{ from: number; to: number; current: boolean }[]>();

const matchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMatches)) {
        next = Decoration.set(
          effect.value.map((item) =>
            (item.current ? currentMatchMark : matchMark).range(item.from, item.to),
          ),
          true,
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface EditorActions {
  foldAll: () => void;
  unfoldAll: () => void;
  openSearch: () => void;
  selectAll: () => void;
  copySelection: () => void;
  paste: () => Promise<void>;
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

/** 基于 CodeMirror 6 的编辑器：折叠、自绘搜索条、语法高亮、视口渲染 */
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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const matchesRef = React.useRef<{ from: number; to: number }[]>([]);

  const langCompartment = React.useRef(new Compartment()).current;
  const themeCompartment = React.useRef(new Compartment()).current;
  const editableCompartment = React.useRef(new Compartment()).current;

  const openSearch = React.useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  /** 执行搜索并跳到第 index 个匹配 */
  const runSearch = React.useCallback((raw: string, index: number) => {
    const view = viewRef.current;
    if (!view) return;
    const found: { from: number; to: number }[] = [];
    if (raw.trim()) {
      const searchQuery = new SearchQuery({ search: raw });
      const cursor = searchQuery.getCursor(view.state.doc);
      for (let next = cursor.next(); !next.done; next = cursor.next()) {
        found.push({ from: next.value.from, to: next.value.to });
        if (found.length >= 3000) break;
      }
    }
    matchesRef.current = found;
    if (!found.length) {
      setActive(-1);
      view.dispatch({ effects: setMatches.of([]) });
      return;
    }
    const current = ((index % found.length) + found.length) % found.length;
    setActive(current);
    const target = found[current];
    view.dispatch({
      effects: [
        setMatches.of(found.map((item, i) => ({ ...item, current: i === current }))),
        EditorView.scrollIntoView(target.from, { y: 'center' }),
      ],
      selection: { anchor: target.from, head: target.to },
    });
  }, []);

  const closeSearch = React.useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    matchesRef.current = [];
    setActive(-1);
    viewRef.current?.dispatch({ effects: setMatches.of([]) });
  }, []);

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
          // 用自绘搜索条替换 CodeMirror 默认面板
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-f',
                run: () => {
                  openSearch();
                  return true;
                },
              },
            ]),
          ),
          matchField,
          langCompartment.of(language === 'json' ? json() : []),
          themeCompartment.of(buildTheme(isDark())),
          syntaxHighlighting(highlightStyle),
          editableCompartment.of([
            EditorView.editable.of(!readOnly),
            EditorState.readOnly.of(readOnly),
          ]),
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
        openSearch,
        selectAll: () =>
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
        copySelection: () => {
          const { from, to } = view.state.selection.main;
          if (from !== to) {
            void navigator.clipboard.writeText(view.state.sliceDoc(from, to));
          }
        },
        paste: async () => {
          const text = await navigator.clipboard.readText().catch(() => '');
          if (!text) return;
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            scrollIntoView: true,
          });
          view.focus();
        },
      };
    }

    // 首次挂载时容器高度可能还是 0，且语法树尚未解析完，
    // 会导致折叠栏按钮不出现。这里主动解析并重新测量。
    const settle = () => {
      ensureSyntaxTreeSafe(view);
      view.requestMeasure();
    };
    const raf = requestAnimationFrame(settle);
    const timer = window.setTimeout(settle, 120);
    const observer = new ResizeObserver(() => view.requestMeasure());
    observer.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer.disconnect();
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
      ensureSyntaxTreeSafe(view);
      view.requestMeasure();
      if (searchOpen && query) runSearch(query, 0);
    }
  }, [value, searchOpen, query, runSearch]);

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

  const count = matchesRef.current.length;

  return (
    <div className={`code-editor ${className}`} ref={hostRef}>
      {searchOpen && (
        <div className="cm-search-bar">
          <Icon name="search" size={12} />
          <input
            ref={inputRef}
            value={query}
            placeholder="在当前内容中搜索"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              runSearch(event.target.value, 0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                runSearch(query, active + (event.shiftKey ? -1 : 1));
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              }
            }}
          />
          <span className="cm-search-count">
            {query ? (count ? `${active + 1}/${count}` : '0/0') : ''}
          </span>
          <button
            className="cm-search-btn"
            title="上一处"
            onClick={() => runSearch(query, active - 1)}
            disabled={!count}
          >
            <Icon name="chevron" size={10} style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <button
            className="cm-search-btn"
            title="下一处"
            onClick={() => runSearch(query, active + 1)}
            disabled={!count}
          >
            <Icon name="chevron" size={10} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button className="cm-search-btn" title="关闭" onClick={closeSearch}>
            <Icon name="close" size={10} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 首次挂载后强制解析语法树，保证折叠按钮立刻可用 */
function ensureSyntaxTreeSafe(view: EditorView) {
  ensureSyntaxTree(view.state, view.state.doc.length, 1500);
}
