import React from 'react';
import { SendResponse } from '../../shared/types';
import { CopyButton, formatBytes, Icon } from './ui';
import CodeEditor, { EditorActions } from './CodeEditor';
import { useContextMenu } from './ContextMenu';

interface Props {
  response: SendResponse | null;
  sending: boolean;
}

function ResponseView({ response, sending }: Props) {
  const [tab, setTab] = React.useState<'body' | 'headers' | 'raw'>('body');
  const [savedPath, setSavedPath] = React.useState('');
  const editorActions = React.useRef<EditorActions | null>(null);
  const menu = useContextMenu();
  const [saveError, setSaveError] = React.useState('');

  const pretty = React.useMemo(() => {
    if (!response) return '';
    if (response.bodyKind !== 'json') return response.body;
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response]);

  React.useEffect(() => {
    setSavedPath('');
    setSaveError('');
  }, [response]);

  if (sending) {
    return (
      <div className="response">
        <div className="response-head">
          <span className="metric">正在发送请求…</span>
        </div>
        <div className="response-placeholder">
          <span className="spinner" style={{ borderColor: 'rgba(124,92,255,.3)', borderTopColor: '#7c5cff' }} />
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="response">
        <div className="response-head">
          <span className="metric">响应</span>
          <span className="metric">准备就绪</span>
        </div>
        <div className="response-placeholder">
          <div>点击「发送」或按 ⌘ + Enter 执行请求</div>
          <div style={{ fontSize: 11.5 }}>响应结果会显示在这里</div>
        </div>
      </div>
    );
  }

  const statusClass = response.error
    ? 'status-err'
    : response.status >= 200 && response.status < 300
      ? 'status-ok'
      : response.status >= 400
        ? 'status-err'
        : 'status-warn';

  const defaultFileName = response.fileName
    ? response.fileName
    : `response-${response.status || 'body'}.${response.bodyKind === 'json' ? 'json' : 'txt'}`;

  const savePayload = () => {
    if (response.bodyKind === 'binary' && !response.filePath) {
      throw new Error('响应文件未落盘，请重新发送请求');
    }
    return {
      sourcePath: response.filePath,
      content: response.filePath ? undefined : response.bodyKind === 'json' ? pretty : response.body,
      fileName: defaultFileName,
    };
  };

  const download = async () => {
    try {
      setSaveError('');
      const target = await window.api.downloadResponseFile(savePayload());
      setSavedPath(target);
    } catch (error: any) {
      setSaveError(error?.message ?? String(error));
    }
  };

  const saveAs = async () => {
    try {
      setSaveError('');
      const target = await window.api.saveResponseFile(savePayload());
      if (target) setSavedPath(target);
    } catch (error: any) {
      setSaveError(error?.message ?? String(error));
    }
  };

  return (
    <div className="response">
      <div className="response-head">
        {response.error ? (
          <span className="status-badge status-err">ERROR</span>
        ) : (
          <span className={`status-badge ${statusClass}`}>
            {response.status} {response.statusText}
          </span>
        )}
        <span className="metric">
          时间 <b>{response.timeMs} ms</b>
        </span>
        <span className="metric">
          大小 <b>{formatBytes(response.size)}</b>
        </span>
        {response.headers['content-type'] && (
          <span className="metric" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {response.headers['content-type']}
          </span>
        )}
        <div className="response-tabs">
          {(
            [
              ['body', '响应体'],
              ['headers', `响应头 (${Object.keys(response.headers).length})`],
              ['raw', '原始'],
            ] as ['body' | 'headers' | 'raw', string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`response-tab ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          {tab === 'body' && response.bodyKind !== 'binary' && (
            <button
              className="response-tab"
              onClick={() => editorActions.current?.openSearch()}
              title="搜索响应内容（⌘F）"
            >
              <Icon name="search" size={11} />
              搜索
            </button>
          )}
          {response.bodyKind === 'json' && tab === 'body' && (
            <>
              <button className="response-tab" onClick={() => editorActions.current?.foldAll()}>
                折叠
              </button>
              <button className="response-tab" onClick={() => editorActions.current?.unfoldAll()}>
                展开
              </button>
            </>
          )}
          <CopyButton value={tab === 'raw' ? response.body : pretty} label="复制响应" />
          <button className="response-tab" onClick={download} title="下载到「下载」文件夹">
            <Icon name="download" size={11} />
            下载
          </button>
        </div>
      </div>

      <div
        className={`response-body ${
          tab === 'body' && response.bodyKind !== 'binary' ? 'json-mode' : ''
        }`}
        onContextMenu={(event) => {
          if (tab !== 'body' || response.bodyKind === 'binary') return;
          menu.open(event, [
            {
              label: '复制响应内容',
              icon: 'copy',
              onClick: () =>
                navigator.clipboard.writeText(
                  response.bodyKind === 'json' ? pretty : response.body,
                ),
            },
            {
              label: '搜索',
              icon: 'search',
              shortcut: '⌘F',
              onClick: () => editorActions.current?.openSearch(),
            },
            { separator: true },
            {
              label: '折叠全部',
              icon: 'chevron',
              onClick: () => editorActions.current?.foldAll(),
            },
            {
              label: '展开全部',
              icon: 'chevron',
              onClick: () => editorActions.current?.unfoldAll(),
            },
            { separator: true },
            { label: '下载响应', icon: 'download', onClick: download },
            { label: '保存到…', icon: 'file', onClick: saveAs },
          ]);
        }}
      >
        {response.error && (
          <div className="result-box" style={{ marginBottom: 12, color: '#f87171' }}>
            {response.error}
          </div>
        )}

        {savedPath && (
          <div className="result-box" style={{ marginBottom: 12, color: 'var(--green)' }}>
            已保存到 {savedPath}
          </div>
        )}
        {saveError && (
          <div className="result-box" style={{ marginBottom: 12, color: 'var(--danger)' }}>
            {saveError}
          </div>
        )}

        {tab === 'body' && response.bodyKind === 'binary' && (
          <div className="file-result">
            {response.preview ? (
              <img
                className="file-preview"
                src={response.preview}
                alt={response.fileName ?? '响应预览'}
              />
            ) : (
              <div className="file-badge">
                <Icon name="file" size={20} />
              </div>
            )}
            <div className="file-meta">
              <div className="file-name">{response.fileName || '响应文件'}</div>
              <div className="help">
                {response.mime || '未知类型'} · {formatBytes(response.size)}
              </div>
            </div>
            <div className="file-actions">
              <button className="chip-button primary" onClick={download}>
                <Icon name="download" size={12} />
                下载
              </button>
              <button className="chip-button" onClick={saveAs}>
                保存到…
              </button>
              {response.filePath && (
                <button
                  className="chip-button ghost"
                  onClick={() => window.api.revealPath(response.filePath!)}
                >
                  <Icon name="folder" size={12} />
                  在访达中显示
                </button>
              )}
            </div>
          </div>
        )}

        {tab === 'body' && response.bodyKind !== 'binary' && (
          <CodeEditor
            value={response.bodyKind === 'json' ? pretty : response.body}
            language={response.bodyKind === 'json' ? 'json' : 'text'}
            readOnly
            actionsRef={editorActions}
          />
        )}

        {tab === 'headers' && (
          <table className="kv-table">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Header</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(response.headers).map(([key, value]) => (
                <tr key={key}>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: '#93c5fd' }}>
                    {key}
                  </td>
                  <td style={{ padding: '7px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'raw' && (
          <pre className="code-block">
            {response.bodyKind === 'binary'
              ? `二进制响应（${response.mime || '未知类型'}，${formatBytes(response.size)}）\n临时文件：${response.filePath ?? '未落盘'}`
              : response.body || '（空响应体）'}
          </pre>
        )}
      </div>
      {menu.node}
    </div>
  );
}

export default React.memo(ResponseView);
