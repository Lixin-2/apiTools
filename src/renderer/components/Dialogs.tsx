import React from 'react';
import { Collection, Environment, ExportFormat, ImportFormat, KeyValue, createKeyValue } from '../../shared/types';
import type { AppInfo, ImportOutcome } from '../global';
import { CopyButton, Icon } from './ui';

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`}>
        <div className="dialog-head">
          <div>
            <div className="dialog-title">{title}</div>
            {subtitle && <div className="help" style={{ marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- import ---------------------------------- */

const FORMAT_OPTIONS: { value: ImportFormat | 'auto'; label: string }[] = [
  { value: 'auto', label: '自动识别' },
  { value: 'openapi', label: 'OpenAPI / Swagger' },
  { value: 'postman', label: 'Postman Collection' },
  { value: 'har', label: 'HAR' },
  { value: 'curl', label: 'cURL' },
  { value: 'apitools', label: 'apiTools JSON' },
];

export function ImportDialog({
  onClose,
  onImport,
  onImportFile,
}: {
  onClose: () => void;
  onImport: (payload: { content: string; format?: ImportFormat; collectionName?: string; mode?: 'merge' | 'replace' }) => Promise<ImportOutcome>;
  onImportFile: () => Promise<ImportOutcome | null>;
}) {
  const [mode, setMode] = React.useState<'paste' | 'file'>('paste');
  const [content, setContent] = React.useState('');
  const [format, setFormat] = React.useState<ImportFormat | 'auto'>('auto');
  const [collectionName, setCollectionName] = React.useState('');
  const [mergeMode, setMergeMode] = React.useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ImportOutcome | null>(null);
  const [error, setError] = React.useState('');
  const [dragging, setDragging] = React.useState(false);

  const run = async () => {
    if (!content.trim()) {
      setError('请先粘贴接口文档内容，或选择文件');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const outcome = await onImport({
        content,
        format: format === 'auto' ? undefined : format,
        collectionName: collectionName.trim() || undefined,
        mode: mergeMode,
      });
      setResult(outcome);
      setContent('');
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async () => {
    setBusy(true);
    setError('');
    try {
      const outcome = await onImportFile();
      if (outcome) setResult(outcome);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="导入接口"
      subtitle="支持 OpenAPI / Swagger、Postman、HAR、cURL，也可以直接用 MCP 让 agent 导入"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="help">
            MCP 工具：<code>import_api_document</code> · <code>import_api_from_url</code>
          </span>
          <span className="spacer" />
          {mode === 'paste' ? (
            <>
              <button className="chip-button" onClick={onClose}>
                取消
              </button>
              <button className="chip-button primary" onClick={run} disabled={busy}>
                {busy ? '导入中…' : '开始导入'}
              </button>
            </>
          ) : (
            <>
              <button className="chip-button" onClick={onClose}>
                关闭
              </button>
              <button className="chip-button primary" onClick={pickFile} disabled={busy}>
                {busy ? '导入中…' : '选择文件'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="mini-tabs">
        <button className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}>
          粘贴文本
        </button>
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
          选择 / 拖入文件
        </button>
      </div>

      {mode === 'paste' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="select-input"
              value={format}
              onChange={(e) => setFormat(e.target.value as ImportFormat | 'auto')}
              style={{ width: 190 }}
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              style={{ flex: 1, minWidth: 180, fontFamily: 'inherit' }}
              placeholder="集合名称（可选，默认取文档标题）"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
            />
            <select
              className="select-input"
              value={mergeMode}
              onChange={(e) => setMergeMode(e.target.value as 'merge' | 'replace')}
              style={{ width: 150 }}
            >
              <option value="merge">追加并去重</option>
              <option value="replace">替换同集合</option>
            </select>
          </div>
          <textarea
            className="import-textarea"
            placeholder={'粘贴 OpenAPI JSON / Swagger / Postman Collection / HAR，或一段 curl 命令…'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
        </>
      ) : (
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (!file) return;
            const text = await file.text();
            setContent(text);
            setMode('paste');
          }}
        >
          把 <b>.json / .har / .yaml</b> 文件拖到这里
          <br />
          或点击下方「选择文件」按钮
        </div>
      )}

      {error && (
        <div className="result-box" style={{ color: '#f87171' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="result-box">
          已导入到集合 <b>{result.collection.name}</b>：新增 <b>{result.imported}</b> 个接口
          {result.skipped > 0 && `，跳过 ${result.skipped} 个重复接口`}
          {result.warnings.length > 0 && (
            <div style={{ marginTop: 6, color: '#fbbf24' }}>{result.warnings.join('；')}</div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------- export ---------------------------------- */

export function ExportDialog({
  collection,
  count,
  onClose,
  onLoad,
  onSave,
}: {
  collection: Collection;
  count: number;
  onClose: () => void;
  onLoad: (format: ExportFormat) => Promise<{ filename: string; content: string }>;
  onSave: (format: ExportFormat) => Promise<unknown>;
}) {
  const [format, setFormat] = React.useState<ExportFormat>('postman');
  const [payload, setPayload] = React.useState<{ filename: string; content: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setBusy(true);
    onLoad(format)
      .then((data) => alive && setPayload(data))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [format]);

  return (
    <Modal
      title="导出集合"
      subtitle={`${collection.name} · ${count} 个接口`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="help">{payload?.filename}</span>
          <span className="spacer" />
          <button className="chip-button" onClick={onClose}>
            关闭
          </button>
          <button
            className="chip-button"
            onClick={() => payload && navigator.clipboard.writeText(payload.content)}
            disabled={!payload}
          >
            <Icon name="copy" size={12} />
            复制
          </button>
          <button className="chip-button primary" onClick={() => onSave(format)}>
            <Icon name="download" size={12} />
            保存为文件
          </button>
        </>
      }
    >
      <div className="mini-tabs">
        <button className={format === 'postman' ? 'active' : ''} onClick={() => setFormat('postman')}>
          Postman v2.1
        </button>
        <button className={format === 'openapi' ? 'active' : ''} onClick={() => setFormat('openapi')}>
          OpenAPI 3.0
        </button>
        <button className={format === 'apitools' ? 'active' : ''} onClick={() => setFormat('apitools')}>
          apiTools JSON
        </button>
      </div>
      <pre className="import-textarea" style={{ overflow: 'auto', maxHeight: 340, minHeight: 260, margin: 0 }}>
        {busy ? '生成中…' : payload?.content ?? ''}
      </pre>
    </Modal>
  );
}

/* ----------------------------------- MCP ----------------------------------- */

export function McpDialog({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  if (!info) return null;
  const serverPath = info.mcpServerPath || info.mcpCommand.replace(/^node\s+"?/, '').replace(/"$/, '');
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        apitools: {
          command: 'node',
          args: [serverPath],
        },
      },
    },
    null,
    2,
  );
  const curlExample = `curl -X POST http://127.0.0.1:${info.port}/import \\
  -H "content-type: application/json" \\
  -H "x-apitools-token: ${info.token}" \\
  -d '{"format":"openapi","content":"{...}"}'`;

  return (
    <Modal
      title="MCP 与 REST 接入"
      subtitle="让 AI agent 直接把接口导入 apiTools，无需手工复制"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="help">MCP 服务随应用一起分发，无需额外安装依赖</span>
          <span className="spacer" />
          <button className="chip-button" onClick={() => window.api.openDataDir()}>
            打开数据目录
          </button>
          <button className="chip-button primary" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      <div className="info-row">
        <span className="label">本地 REST API</span>
        <div className="copy-field">
          <span>http://127.0.0.1:{info.port}</span>
          <CopyButton value={`http://127.0.0.1:${info.port}`} />
        </div>
      </div>
      <div className="info-row">
        <span className="label">访问 Token</span>
        <div className="copy-field">
          <span>{info.token}</span>
          <CopyButton value={info.token} />
        </div>
      </div>
      <div className="info-row">
        <span className="label">数据目录</span>
        <div className="copy-field">
          <span>{info.dataDir}</span>
          <CopyButton value={info.dataDir} />
        </div>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          1. 在支持 MCP 的客户端配置（Claude Desktop / CodeBuddy / Cursor）
        </div>
        <pre className="import-textarea" style={{ minHeight: 130, margin: 0, overflow: 'auto' }}>
          {mcpConfig}
        </pre>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="chip-button" onClick={() => navigator.clipboard.writeText(mcpConfig)}>
            <Icon name="copy" size={12} />
            复制 MCP 配置
          </button>
          <button
            className="chip-button"
            onClick={() => navigator.clipboard.writeText(`node "${serverPath}"`)}
          >
            <Icon name="terminal" size={12} />
            复制启动命令
          </button>
        </div>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          2. 直接调用 REST API（导入 / 导出 / 发送请求）
        </div>
        <pre className="import-textarea" style={{ minHeight: 110, margin: 0, overflow: 'auto' }}>
          {curlExample}
        </pre>
      </div>

      <div className="result-box">
        <b>MCP 工具一览</b>
        <div className="result-list">
          <div>import_api_document — 粘贴/传入 OpenAPI、Postman、HAR、cURL 文本并入库</div>
          <div>import_api_from_url — 从远程 URL 拉取接口文档并导入</div>
          <div>list_collections / list_requests / get_request — 浏览已有接口</div>
          <div>save_request / delete_request — 维护单个接口</div>
          <div>export_collection — 导出为 Postman / OpenAPI / apiTools</div>
          <div>send_request — 让 agent 直接验证接口</div>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- environment ------------------------------ */

export function EnvDialog({
  environments,
  activeId,
  onClose,
  onSave,
  onDelete,
  onActivate,
}: {
  environments: Environment[];
  activeId: string | null;
  onClose: () => void;
  onSave: (env: Partial<Environment>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onActivate: (id: string | null) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    activeId ?? environments[0]?.id ?? null,
  );
  const current = environments.find((e) => e.id === selectedId) ?? null;
  const [name, setName] = React.useState(current?.name ?? '');
  const [rows, setRows] = React.useState<KeyValue[]>(current?.variables ?? []);

  React.useEffect(() => {
    setName(current?.name ?? '');
    setRows(current?.variables ?? []);
  }, [selectedId, environments.length]);

  const save = async () => {
    await onSave({ id: current?.id, name: name || '新环境', variables: rows });
  };

  return (
    <Modal
      title="环境变量"
      subtitle="用 {{变量名}} 在 URL、请求头、请求体中引用"
      onClose={onClose}
      footer={
        <>
          <button className="chip-button" onClick={() => setSelectedId(null)}>
            <Icon name="plus" size={12} />
            新建环境
          </button>
          <span className="spacer" />
          <button
            className="chip-button"
            onClick={async () => {
              if (current) await onDelete(current.id);
              setSelectedId(environments.find((e) => e.id !== current?.id)?.id ?? null);
            }}
            disabled={!current}
          >
            删除
          </button>
          <button className="chip-button primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          className="select-input"
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          style={{ width: 200 }}
        >
          <option value="">（新环境）</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
        <input
          className="text-input"
          style={{ flex: 1, fontFamily: 'inherit' }}
          placeholder="环境名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="chip-button"
          onClick={() => current && onActivate(activeId === current.id ? null : current.id)}
          disabled={!current}
        >
          {activeId === current?.id ? '取消启用' : '启用'}
        </button>
      </div>

      <table className="kv-table">
        <thead>
          <tr>
            <th style={{ width: 34 }} />
            <th style={{ width: '35%' }}>变量名</th>
            <th>值</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {[...rows, createKeyValue('', '')].map((row, index) => {
            const isNew = index >= rows.length;
            return (
              <tr key={row.id}>
                <td className="check">
                  <input
                    type="checkbox"
                    checked={isNew ? false : row.enabled}
                    disabled={isNew}
                    onChange={(e) =>
                      setRows(rows.map((r, i) => (i === index ? { ...r, enabled: e.target.checked } : r)))
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={row.key}
                    placeholder={isNew ? 'baseUrl' : ''}
                    onChange={(e) => {
                      if (isNew) setRows([...rows, { ...createKeyValue(), key: e.target.value }]);
                      else setRows(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)));
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={row.value}
                    placeholder={isNew ? 'https://api.example.com' : ''}
                    onChange={(e) => {
                      if (isNew) setRows([...rows, { ...createKeyValue(), value: e.target.value }]);
                      else setRows(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)));
                    }}
                  />
                </td>
                <td className="del">
                  {!isNew && (
                    <button
                      className="icon-btn danger"
                      onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
