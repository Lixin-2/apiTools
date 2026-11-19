import React from 'react';
import { SendResponse } from '../../shared/types';
import { CopyButton, formatBytes, Icon } from './ui';

interface Props {
  response: SendResponse | null;
  sending: boolean;
}

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJsonLine(line: string, index: number) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(line))) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`t${index}-${lastIndex}`} className="json-punc">
          {line.slice(lastIndex, match.index)}
        </span>,
      );
    }
    const [whole, str, colon, bool, num] = match;
    if (str) {
      nodes.push(
        <span key={`s${index}-${match.index}`} className={colon ? 'json-key' : 'json-string'}>
          {str}
        </span>,
      );
      if (colon) {
        nodes.push(
          <span key={`c${index}-${match.index}`} className="json-punc">
            {colon}
          </span>,
        );
      }
    } else if (bool) {
      nodes.push(
        <span key={`b${index}-${match.index}`} className={bool === 'null' ? 'json-null' : 'json-bool'}>
          {bool}
        </span>,
      );
    } else if (num) {
      nodes.push(
        <span key={`n${index}-${match.index}`} className="json-number">
          {num}
        </span>,
      );
    }
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < line.length) {
    nodes.push(
      <span key={`r${index}`} className="json-punc">
        {line.slice(lastIndex)}
      </span>,
    );
  }
  return nodes;
}

export default function ResponseView({ response, sending }: Props) {
  const [tab, setTab] = React.useState<'body' | 'headers' | 'raw'>('body');
  const [savedPath, setSavedPath] = React.useState('');
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
          <CopyButton value={tab === 'raw' ? response.body : pretty} label="复制响应" />
          <button className="response-tab" onClick={download} title="下载到「下载」文件夹">
            <Icon name="download" size={11} />
            下载
          </button>
        </div>
      </div>

      <div className="response-body">
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

        {tab === 'body' &&
          response.bodyKind !== 'binary' &&
          (response.bodyKind === 'json' ? (
            <pre className="code-block">
              {pretty.split('\n').map((line, index) => (
                <div className="json-line" key={index}>
                  <span className="line-no">{index + 1}</span>
                  <span>{highlightJsonLine(line, index)}</span>
                </div>
              ))}
            </pre>
          ) : (
            <pre className="code-block">{response.body}</pre>
          ))}

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
    </div>
  );
}
