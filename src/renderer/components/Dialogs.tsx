import React from 'react';
import {
  Collection,
  Environment,
  ExportFormat,
  ImportFormat,
  KeyValue,
  createKeyValue,
} from '../../shared/types';
import type { AppInfo, AppSettings, ImportOutcome } from '../global';
import { CopyButton, Icon, Select, Switch } from './ui';

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
            {subtitle && (
              <div className="help" style={{ marginTop: 3 }}>
                {subtitle}
              </div>
            )}
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
  { value: 'auto', label: '自动识别格式' },
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
  onImport: (payload: {
    content: string;
    format?: ImportFormat;
    collectionName?: string;
    mode?: 'merge' | 'replace';
  }) => Promise<ImportOutcome>;
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
      subtitle="支持 OpenAPI / Swagger、Postman、HAR、cURL，也可以让 agent 通过 MCP 导入"
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
          <div className="form-row">
            <Select
              value={format}
              onChange={(value) => setFormat(value as ImportFormat | 'auto')}
              options={FORMAT_OPTIONS}
              style={{ width: 190 }}
            />
            <input
              className="text-input"
              style={{ flex: 1, minWidth: 180, fontFamily: 'inherit' }}
              placeholder="集合名称（可选，默认取文档标题）"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
            />
            <Select
              value={mergeMode}
              onChange={(value) => setMergeMode(value as 'merge' | 'replace')}
              options={[
                { value: 'merge', label: '追加并去重' },
                { value: 'replace', label: '替换同集合' },
              ]}
              style={{ width: 150 }}
              align="right"
            />
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
        <div className="result-box" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="result-box">
          已导入到集合 <b>{result.collection.name}</b>：新增 <b>{result.imported}</b> 个接口
          {result.skipped > 0 && `，跳过 ${result.skipped} 个重复接口`}
          {result.warnings.length > 0 && (
            <div style={{ marginTop: 6, color: 'var(--warning)' }}>{result.warnings.join('；')}</div>
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
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [port, setPort] = React.useState('4732');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [mode, setMode] = React.useState<'http' | 'stdio'>('http');

  React.useEffect(() => {
    window.api.getSettings().then((next) => {
      setSettings(next);
      setEnabled(next.mcpEnabled);
      setPort(String(next.mcpPort));
    });
  }, []);

  if (!info) return null;

  const serverPath = info.mcpServerPath || info.mcpCommand.replace(/^node\s+"?/, '').replace(/"$/, '');
  const httpUrl = settings?.mcpHttpUrl ?? `http://127.0.0.1:${port}/mcp`;
  const running = settings?.mcpRunning ?? false;

  const httpConfig = JSON.stringify({ mcpServers: { apitools: { url: httpUrl } } }, null, 2);
  const stdioConfig = JSON.stringify({ mcpServers: { apitools: { command: serverPath, args: [] } } }, null, 2);

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const parsed = Number(port);
      if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
        throw new Error('端口需在 1024 - 65535 之间');
      }
      const next = await window.api.updateMcpSettings({ enabled, port: parsed });
      setSettings(next);
      setEnabled(next.mcpEnabled);
      setPort(String(next.mcpPort));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="MCP 接入"
      subtitle="内置 MCP 服务可开关、可自定义端口；也支持让客户端直接拉起 stdio 版本"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="help">{running ? `运行中 · ${httpUrl}` : 'MCP HTTP 服务未启动'}</span>
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
      <div className="mcp-status">
        <div className="mcp-status-left">
          <span className={`status-dot ${running ? '' : 'off'}`} />
          <div>
            <div className="mcp-status-title">
              {running ? 'HTTP MCP 服务运行中' : 'HTTP MCP 服务已关闭'}
            </div>
            <div className="help">
              {running ? httpUrl : '开启后，支持 HTTP 的客户端可直接通过 URL 连接'}
            </div>
          </div>
        </div>
        <Switch checked={enabled} onChange={setEnabled} />
      </div>

      <div className="form-row">
        <span className="field-label" style={{ width: 36 }}>
          端口
        </span>
        <input
          className="text-input"
          style={{ width: 110 }}
          value={port}
          placeholder="4732"
          onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
        />
        <button className="chip-button primary" onClick={apply} disabled={busy}>
          {busy ? '应用中…' : '保存并应用'}
        </button>
        <span className="help">默认 4732，端口被占用时会提示更换</span>
      </div>

      {error && (
        <div className="result-box" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mini-tabs">
        <button className={mode === 'http' ? 'active' : ''} onClick={() => setMode('http')}>
          HTTP（推荐）
        </button>
        <button className={mode === 'stdio' ? 'active' : ''} onClick={() => setMode('stdio')}>
          stdio 本地进程
        </button>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          客户端配置（Claude Desktop / CodeBuddy / Cursor）
        </div>
        <pre className="import-textarea" style={{ minHeight: 120, margin: 0, overflow: 'auto' }}>
          {mode === 'http' ? httpConfig : stdioConfig}
        </pre>
        <div className="form-row" style={{ marginTop: 8 }}>
          <button
            className="chip-button"
            onClick={() => navigator.clipboard.writeText(mode === 'http' ? httpConfig : stdioConfig)}
          >
            <Icon name="copy" size={12} />
            复制配置
          </button>
          {mode === 'stdio' && (
            <button className="chip-button" onClick={() => navigator.clipboard.writeText(serverPath)}>
              <Icon name="terminal" size={12} />
              复制可执行文件路径
            </button>
          )}
        </div>
      </div>

      <div className="info-row">
        <span className="label">REST API</span>
        <div className="copy-field">
          <span>http://127.0.0.1:{info.port}</span>
          <CopyButton value={`http://127.0.0.1:${info.port}`} />
        </div>
      </div>
      <div className="info-row">
        <span className="label">REST Token</span>
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

      <div className="result-box">
        <b>可用工具（18 个）</b>
        <div className="result-list">
          <div>get_project_tree — 项目 / 集合 / 多级目录 / 接口结构</div>
          <div>list_projects / switch_project / create_project — 项目管理</div>
          <div>list_collections / create_collection / delete_collection — 集合管理</div>
          <div>create_folder — 新建多级目录（用户中心/登录）</div>
          <div>list_requests / get_request / save_request / delete_request — 接口维护</div>
          <div>import_api_document / import_api_from_url — 文档导入</div>
          <div>export_collection — 导出 Postman / OpenAPI / apiTools</div>
          <div>list_environments / save_environment — 环境（URL 前缀 + 统一请求头）</div>
          <div>send_request — 发请求验证，可套用环境</div>
        </div>
      </div>
    </Modal>
  );
}

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
  const [name, setName] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [headers, setHeaders] = React.useState<KeyValue[]>([]);

  React.useEffect(() => {
    setName(current?.name ?? '');
    setBaseUrl(current?.baseUrl ?? '');
    setHeaders(current?.headers ?? []);
  }, [selectedId, environments.length]);

  const save = async () => {
    await onSave({ id: current?.id, name: name || '新环境', baseUrl: baseUrl.trim(), headers });
  };

  return (
    <Modal
      title="环境设置"
      subtitle="统一 URL 前缀与请求头，发送时自动应用，不用在每个接口里重复填"
      onClose={onClose}
      wide
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
      <div className="result-box guide">
        <b>怎么用</b>
        <ol className="guide-list">
          <li>
            填一次「URL 前缀」，接口里只写路径（例如 <code>/users</code>），发送时自动拼成完整地址
          </li>
          <li>
            「统一请求头」会自动加到每个请求上（如 <code>Authorization</code>），接口里写了同名 Header 时以接口为准
          </li>
          <li>
            请求地址本身以 <code>http(s)://</code> 开头时不会拼接前缀，方便单独调外部接口
          </li>
        </ol>
      </div>

      <div className="form-row">
        <Select
          value={selectedId ?? ''}
          onChange={(value) => setSelectedId(value || null)}
          options={[
            ...(selectedId ? [] : [{ value: '', label: '（新环境）' }]),
            ...environments.map((env) => ({ value: env.id, label: env.name })),
          ]}
          style={{ width: 200 }}
        />
        <input
          className="text-input"
          style={{ flex: 1, minWidth: 180, fontFamily: 'inherit' }}
          placeholder="环境名称，例如「测试环境」"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className={`chip-button ${activeId === current?.id && current ? 'primary' : ''}`}
          onClick={() => current && onActivate(activeId === current.id ? null : current.id)}
          disabled={!current}
        >
          {activeId === current?.id ? '已启用 · 点击停用' : '启用此环境'}
        </button>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          统一 URL 前缀
        </div>
        <input
          className="text-input"
          style={{ height: 36 }}
          placeholder="https://api.example.com/v1"
          value={baseUrl}
          spellCheck={false}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <p className="help">留空则不拼接；接口里填完整地址时以接口为准。</p>
      </div>

      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          统一请求头
        </div>
        <SimpleKVTable
          items={headers}
          onChange={setHeaders}
          keyPlaceholder="Header，例如 Authorization"
          valuePlaceholder="值，例如 Bearer eyJhbGciOi..."
        />
        <p className="help">取消勾选可临时停用；接口内同名 Header 会覆盖这里的值。</p>
      </div>
    </Modal>
  );
}

/* ------------------------------- folder vars ------------------------------- */

function SimpleKVTable({
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const rows = [...items, createKeyValue('', '')];
  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index >= items.length) {
      onChange([...items, { ...createKeyValue('', ''), ...patch }]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <table className="kv-table">
      <thead>
        <tr>
          <th style={{ width: 34 }} />
          <th style={{ width: '34%' }}>{keyPlaceholder}</th>
          <th>{valuePlaceholder}</th>
          <th style={{ width: 32 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const isNew = index >= items.length;
          return (
            <tr key={row.id} className={isNew ? 'virtual-row' : ''}>
              <td className="check">
                <input
                  type="checkbox"
                  checked={isNew ? false : row.enabled}
                  disabled={isNew}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.key}
                  placeholder={isNew ? keyPlaceholder : ''}
                  onChange={(e) => update(index, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.value}
                  placeholder={isNew ? valuePlaceholder : ''}
                  onChange={(e) => update(index, { value: e.target.value })}
                />
              </td>
              <td className="del">
                {!isNew && (
                  <button className="icon-btn danger" onClick={() => onChange(items.filter((_, i) => i !== index))}>
                    <Icon name="close" size={11} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}