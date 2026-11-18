import React from 'react';
import {
  ApiRequest,
  BodyType,
  HTTP_METHODS,
  HttpMethod,
  KeyValue,
  createKeyValue,
} from '../../shared/types';
import { splitUrlToParams, substituteVars } from '../../shared/url';
import { Icon, METHOD_COLORS, MethodTag, Select } from './ui';
import VarInput from './VarInput';

interface Props {
  draft: ApiRequest;
  dirty: boolean;
  sending: boolean;
  variables: KeyValue[];
  folders: string[];
  onChange: (patch: Partial<ApiRequest>) => void;
  onSend: () => void;
  onSave: () => void;
}

type TabKey = 'params' | 'body' | 'headers' | 'auth' | 'docs';

const BODY_TYPES: { key: BodyType; label: string }[] = [
  { key: 'none', label: '无' },
  { key: 'json', label: 'JSON' },
  { key: 'text', label: 'Text' },
  { key: 'form', label: 'Form' },
  { key: 'urlencoded', label: 'URL Encoded' },
];

function KeyValueEditor({
  items,
  onChange,
  variables,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}: {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  variables: KeyValue[];
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
                  <VarInput
                    value={row.key}
                    variables={variables}
                    placeholder={index === items.length ? keyPlaceholder : ''}
                    onChange={(value) => update(index, { key: value })}
                  />
                </td>
                <td>
                  <VarInput
                    value={row.value}
                    variables={variables}
                    placeholder={index === items.length ? valuePlaceholder : ''}
                    onChange={(value) => update(index, { value })}
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
        <button className="chip-button ghost" onClick={() => onChange([...items, createKeyValue('', '')])}>
          <Icon name="plus" size={12} />
          添加一行
        </button>
      </div>
    </>
  );
}

export default function RequestEditor({
  draft,
  dirty,
  sending,
  variables,
  folders,
  onChange,
  onSend,
  onSave,
}: Props) {
  const [tab, setTab] = React.useState<TabKey>('params');
  const [showVars, setShowVars] = React.useState(false);

  const activeParams = draft.params.filter((p) => p.enabled && p.key).length;
  const activeHeaders = draft.headers.filter((h) => h.enabled && h.key).length;
  const methodColor = METHOD_COLORS[draft.method] ?? 'var(--text-dim)';

  const varMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const variable of variables) {
      if (variable.enabled && variable.key) map[variable.key] = variable.value;
    }
    return map;
  }, [variables]);

  const usedVars = React.useMemo(() => {
    const found = [...draft.url.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]);
    return [...new Set(found)];
  }, [draft.url]);

  const missingVars = usedVars.filter((name) => !(name in varMap));
  const resolvedUrl = substituteVars(draft.url, varMap);

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
    <div className="editor-shell">
      <div className="request-bar">
        <Select
          value={draft.method}
          onChange={(value) => onChange({ method: value as HttpMethod })}
          options={HTTP_METHODS.map((m) => ({ value: m, label: m, color: METHOD_COLORS[m] }))}
          color={methodColor}
          className="method-picker"
          menuWidth={132}
        />
        <div className="url-input-wrap">
          <VarInput
            value={draft.url}
            onChange={onUrlChange}
            variables={variables}
            placeholder="https://api.example.com/v1/users 或 {{baseUrl}}/users"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend();
            }}
          />
          <button
            className={`var-trigger ${usedVars.length ? 'has-vars' : ''}`}
            title="查看环境变量"
            onClick={() => setShowVars((v) => !v)}
          >
            <Icon name="key" size={12} />
            {usedVars.length > 0 && <span>{usedVars.length}</span>}
          </button>
        </div>
        <button className="send-btn" onClick={onSend} disabled={sending || !draft.url}>
          {sending ? <span className="spinner" /> : <Icon name="send" size={13} />}
          {sending ? '发送中' : '发送'}
        </button>
        <button className={`save-btn ${dirty ? 'dirty' : ''}`} onClick={onSave} title="保存（⌘S）">
          <Icon name="check" size={13} />
        </button>
      </div>

      {usedVars.length > 0 && (
        <div className={`url-hint ${missingVars.length ? 'warn' : ''}`}>
          <Icon name={missingVars.length ? 'info' : 'check'} size={12} />
          {missingVars.length ? (
            <span>
              变量未定义：{missingVars.map((name) => `{{${name}}}`).join('、')} —— 请到右上角「环境」里添加
            </span>
          ) : (
            <span>
              发送时解析为 <code>{resolvedUrl}</code>
            </span>
          )}
        </div>
      )}

      {showVars && (
        <div className="var-popover">
          <div className="var-popover-head">
            <span>环境变量</span>
            <span className="help">点击复制 {'{{变量}}'}</span>
          </div>
          {variables.filter((v) => v.enabled && v.key).length ? (
            variables
              .filter((v) => v.enabled && v.key)
              .map((variable) => (
                <button
                  key={variable.id}
                  className="var-item"
                  onClick={() => navigator.clipboard.writeText(`{{${variable.key}}}`)}
                >
                  <code>{`{{${variable.key}}}`}</code>
                  <span>{variable.value || '（空）'}</span>
                  <Icon name="copy" size={11} />
                </button>
              ))
          ) : (
            <div className="var-empty">尚未配置环境变量，点击右上角「环境」添加</div>
          )}
        </div>
      )}

      <div className="request-meta">
        <input
          className="name-input"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="请求名称"
          spellCheck={false}
        />
        <MethodTag method={draft.method} />
        {dirty && <span className="meta-dirty">未保存</span>}
        <span style={{ flex: 1 }} />
        <span className="meta-label">目录</span>
        <Select
          value={draft.folder}
          onChange={(value) => onChange({ folder: value })}
          options={[
            { value: '', label: '集合根级' },
            ...folders.map((folder) => ({ value: folder, label: folder })),
            ...(draft.folder && !folders.includes(draft.folder)
              ? [{ value: draft.folder, label: `${draft.folder}（自定义）` }]
              : []),
          ]}
          size="sm"
          style={{ width: 170 }}
          menuWidth={190}
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
            variables={variables}
            onChange={(params) => onChange({ params })}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
          />
        )}

        {tab === 'headers' && (
          <>
            <KeyValueEditor
              items={draft.headers}
              variables={variables}
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
              <VarInput
                multiline
                className="code-area"
                value={draft.body}
                variables={variables}
                onChange={(body) => onChange({ body })}
                placeholder={
                  draft.bodyType === 'json'
                    ? '{\n  "name": "value"\n}'
                    : draft.bodyType === 'form' || draft.bodyType === 'urlencoded'
                      ? 'key1=value1&key2=value2'
                      : '请求体内容'
                }
              />
            )}
          </div>
        )}

        {tab === 'auth' && (
          <div className="auth-grid">
            <span className="field-label">类型</span>
            <Select
              value={draft.auth.type}
              onChange={(value) => onChange({ auth: { ...draft.auth, type: value as any } })}
              options={[
                { value: 'none', label: '无' },
                { value: 'bearer', label: 'Bearer Token' },
                { value: 'basic', label: 'Basic Auth' },
                { value: 'apikey', label: 'API Key' },
              ]}
              style={{ width: 220 }}
            />

            {draft.auth.type === 'bearer' && (
              <>
                <span className="field-label">Token</span>
                <VarInput
                  className="text-input"
                  value={draft.auth.token ?? ''}
                  variables={variables}
                  onChange={(token) => onChange({ auth: { ...draft.auth, token } })}
                  placeholder="{{token}} 或直接填入 token"
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
                  placeholder="用户名"
                  spellCheck={false}
                />
                <span className="field-label">密码</span>
                <input
                  className="text-input"
                  type="password"
                  value={draft.auth.password ?? ''}
                  onChange={(e) => onChange({ auth: { ...draft.auth, password: e.target.value } })}
                  placeholder="密码"
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
                  placeholder="例如 X-API-Key"
                  spellCheck={false}
                />
                <span className="field-label">Value</span>
                <VarInput
                  className="text-input"
                  value={draft.auth.value ?? ''}
                  variables={variables}
                  onChange={(value) => onChange({ auth: { ...draft.auth, value } })}
                  placeholder="值或 {{变量}}"
                />
                <span className="field-label">添加到</span>
                <Select
                  value={draft.auth.addTo ?? 'header'}
                  onChange={(value) => onChange({ auth: { ...draft.auth, addTo: value as any } })}
                  options={[
                    { value: 'header', label: '请求头' },
                    { value: 'query', label: '查询参数' },
                  ]}
                  style={{ width: 180 }}
                />
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
