import React from 'react';
import {
  ApiRequest,
  BodyType,
  HTTP_METHODS,
  HttpMethod,
  KeyValue,
  createKeyValue,
} from '../../shared/types';
import { splitUrlToParams } from '../../shared/url';
import { Icon, METHOD_COLORS, MethodTag } from './ui';

interface Props {
  draft: ApiRequest;
  dirty: boolean;
  sending: boolean;
  variables: KeyValue[];
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  onSave: () => void;
}

type TabKey = 'params' | 'body' | 'headers' | 'auth' | 'docs';

const BODY_TYPES: { key: BodyType; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'json', label: 'JSON' },
  { key: 'text', label: 'Text' },
  { key: 'form', label: 'Form' },
  { key: 'urlencoded', label: 'URL Encoded' },
];

function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const rows = [...items, createKeyValue('', '')];

  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index >= items.length) {
      const created = { ...createKeyValue('', ''), ...patch, id: createKeyValue().id };
      onChange([...items, created]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <>
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
              <tr
                key={row.id}
                className={`${!isNew && !row.enabled ? 'disabled' : ''} ${isNew ? 'virtual-row' : ''}`}
              >
                <td className="check">
                  <input
                    type="checkbox"
                    checked={isNew ? false : row.enabled}
                    onChange={(e) => update(index, { enabled: e.target.checked })}
                    disabled={isNew}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={row.key}
                    placeholder={index === items.length ? keyPlaceholder : ''}
                    spellCheck={false}
                    onChange={(e) => update(index, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={row.value}
                    placeholder={index === items.length ? valuePlaceholder : ''}
                    spellCheck={false}
                    onChange={(e) => update(index, { value: e.target.value })}
                  />
                </td>
                <td className="del">
                  {!isNew && (
                    <button
                      className="icon-btn danger"
                      onClick={() => onChange(items.filter((_, i) => i !== index))}
                      title="删除"
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
      <div className="add-row">
        <button
          className="chip-button ghost"
          onClick={() => onChange([...items, createKeyValue('', '')])}
        >
          <Icon name="plus" size={12} />
          添加一行
        </button>
      </div>
    </>
  );
}

export default function RequestEditor({ draft, dirty, sending, variables, onChange, onSend, onSave }: Props) {
  const [tab, setTab] = React.useState<TabKey>('params');
  const [showVars, setShowVars] = React.useState(false);

  const activeParams = draft.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = draft.headers.filter((h) => h.enabled && h.key).length;
  const methodColor = METHOD_COLORS[draft.method] ?? '#9a9aab';

  const onUrlChange = (value: string) => {
    if (value.includes('?')) {
      const { url, params } = splitUrlToParams(value, draft.params);
      onChange({ url, params });
      return;
    }
    onChange({ url: value });
  };

  const formatBody = () => {
    try {
      onChange({ body: JSON.stringify(JSON.parse(draft.body), null, 2) });
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '0 0 auto' }}>
      <div className="request-bar">
        <div className="method-select" style={{ color: methodColor }}>
          <select
            value={draft.method}
            onChange={(e) => onChange({ method: e.target.value as HttpMethod })}
            style={{ color: methodColor }}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="url-input-wrap">
          <input
            value={draft.url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://api.example.com/v1/users 或 {{baseUrl}}/users"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend();
            }}
          />
          {draft.url.includes('{{') && (
            <button
              className="icon-btn"
              title="查看变量"
              onClick={() => setShowVars((v) => !v)}
            >
              <Icon name="spark" size={13} />
            </button>
          )}
        </div>
        <button className="send-btn" onClick={onSend} disabled={sending || !draft.url}>
          {sending ? <span className="spinner" /> : <Icon name="send" size={13} />}
          {sending ? '发送中' : '发送'}
        </button>
        <button className={`save-btn ${dirty ? 'dirty' : ''}`} onClick={onSave} title="⌘S">
          <Icon name="check" size={13} />
        </button>
      </div>

      {showVars && draft.url.includes('{{') && (
        <div style={{ padding: '0 16px 8px' }}>
          <div className="result-box">
            <b>可用变量</b>（在「环境变量」中维护）
            <div className="result-list">
              {variables.filter((v) => v.enabled && v.key).length ? (
                variables
                  .filter((v) => v.enabled && v.key)
                  .map((v) => (
                    <div key={v.id}>
                      {`{{${v.key}}} = ${v.value}`}
                    </div>
                  ))
              ) : (
                <div style={{ color: 'var(--text-faint)' }}>尚未配置环境变量</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="request-meta">
        <input
          className="name-input"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          spellCheck={false}
        />
        <MethodTag method={draft.method} />
        {dirty && <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>未保存</span>}
        <span style={{ flex: 1 }} />
        <input
          className="text-input"
          style={{ width: 150, height: 26, fontSize: 11.5 }}
          value={draft.folder}
          placeholder="分组 / 文件夹"
          onChange={(e) => onChange({ folder: e.target.value })}
        />
      </div>

      <div className="tabs">
        {(
          [
            ['params', '参数', activeParams],
            ['body', '请求体', draft.bodyType === 'none' ? 0 : 1],
            ['headers', '请求头', activeHeaders],
            ['auth', '授权', draft.auth.type === 'none' ? 0 : 1],
            ['docs', '说明', 0],
          ] as [TabKey, string, number][]
        ).map(([key, label, count]) => (
          <button key={key} className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
            {count > 0 && <span className="tab-badge">{count}</span>}
          </button>
        ))}
      </div>

      <div className="editor">
        {tab === 'params' && (
          <KeyValueEditor
            items={draft.params}
            onChange={(params) => onChange({ params })}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
          />
        )}

        {tab === 'headers' && (
          <>
            <KeyValueEditor
              items={draft.headers}
              onChange={(headers) => onChange({ headers })}
              keyPlaceholder="Header"
              valuePlaceholder="值"
            />
            <p className="help" style={{ marginTop: 10 }}>
              支持 <code>{'{{变量}}'}</code> 占位符，发送前会自动替换为环境变量中的值。
            </p>
          </>
        )}

        {tab === 'body' && (
          <div className="body-editor">
            <div className="body-toolbar">
              <div className="seg">
                {BODY_TYPES.map((item) => (
                  <button
                    key={item.key}
                    className={draft.bodyType === item.key ? 'active' : ''}
                    onClick={() => onChange({ bodyType: item.key })}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {(draft.bodyType === 'json' || draft.bodyType === 'text') && draft.body && (
                <button className="chip-button ghost" onClick={formatBody}>
                  <Icon name="spark" size={12} />
                  格式化
                </button>
              )}
            </div>
            {draft.bodyType === 'none' ? (
              <p className="help">该请求不携带请求体。</p>
            ) : (
              <textarea
                className="code-area"
                value={draft.body}
                onChange={(e) => onChange({ body: e.target.value })}
                placeholder={
                  draft.bodyType === 'json'
                    ? '{\n  "name": "value"\n}'
                    : draft.bodyType === 'form' || draft.bodyType === 'urlencoded'
                      ? 'key1=value1&key2=value2'
                      : '请求体内容'
                }
                spellCheck={false}
              />
            )}
          </div>
        )}

        {tab === 'auth' && (
          <div className="auth-grid">
            <span className="field-label">类型</span>
            <select
              className="select-input"
              value={draft.auth.type}
              onChange={(e) => onChange({ auth: { ...draft.auth, type: e.target.value as any } })}
              style={{ width: 200 }}
            >
              <option value="none">无</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="apikey">API Key</option>
            </select>

            {draft.auth.type === 'bearer' && (
              <>
                <span className="field-label">Token</span>
                <input
                  className="text-input"
                  value={draft.auth.token ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, token: e.target.value } })}
                  placeholder="{{token}}"
                  spellCheck={false}
                />
                <span />
                <span className="help">发送时自动附加 Authorization: Bearer &lt;token&gt;</span>
              </>
            )}

            {draft.auth.type === 'basic' && (
              <>
                <span className="field-label">用户名</span>
                <input
                  className="text-input"
                  value={draft.auth.username ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, username: e.target.value } })}
                  spellCheck={false}
                />
                <span className="field-label">密码</span>
                <input
                  className="text-input"
                  type="password"
                  value={draft.auth.password ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, password: e.target.value } })}
                />
              </>
            )}

            {draft.auth.type === 'apikey' && (
              <>
                <span className="field-label">Key</span>
                <input
                  className="text-input"
                  value={draft.auth.key ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, key: e.target.value } })}
                  spellCheck={false}
                />
                <span className="field-label">Value</span>
                <input
                  className="text-input"
                  value={draft.auth.value ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, value: e.target.value } })}
                  spellCheck={false}
                />
                <span className="field-label">添加到</span>
                <select
                  className="select-input"
                  value={draft.auth.addTo ?? 'header'}
                  onChange={(e) => onChange({ auth: { ...draft.auth, addTo: e.target.value as any } })}
                  style={{ width: 160 }}
                >
                  <option value="header">请求头</option>
                  <option value="query">查询参数</option>
                </select>
              </>
            )}
          </div>
        )}

        {tab === 'docs' && (
          <textarea
            className="code-area"
            style={{ minHeight: 140, fontFamily: 'inherit', fontSize: 12.5 }}
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="补充接口说明、调用注意事项…"
          />
        )}
      </div>
    </div>
  );
}
