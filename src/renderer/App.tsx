import React from 'react';
import {
  ApiRequest,
  Collection,
  Environment,
  ExportFormat,
  ImportFormat,
  KeyValue,
  SendResponse,
  Workspace,
  createRequest,
} from '../shared/types';
import { applyParams, substituteVars } from '../shared/url';
import type { AppInfo, ImportOutcome } from './global';
import Sidebar from './components/Sidebar';
import RequestEditor from './components/RequestEditor';
import ResponseView from './components/ResponseView';
import { EnvDialog, ExportDialog, ImportDialog, McpDialog, Modal } from './components/Dialogs';
import { Icon } from './components/ui';

type DialogKey = 'import' | 'mcp' | 'env' | null;

function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function envVarsOf(env: Environment | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const v of env?.variables ?? []) {
    if (v.enabled && v.key) vars[v.key] = v.value;
  }
  return vars;
}

export default function App() {
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [draft, setDraft] = React.useState<ApiRequest | null>(null);
  const [savedSnapshot, setSavedSnapshot] = React.useState('');
  const [response, setResponse] = React.useState<SendResponse | null>(null);
  const [sending, setSending] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogKey>(null);
  const [exportTarget, setExportTarget] = React.useState<Collection | null>(null);
  const [toast, setToast] = React.useState('');
  const [promptState, setPromptState] = React.useState<{
    title: string;
    value: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  } | null>(null);

  const toastTimer = React.useRef<NodeJS.Timeout | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  };

  const reload = React.useCallback(async () => {
    const ws = await window.api.readWorkspace();
    setWorkspace(ws);
    return ws;
  }, []);

  const bootstrapped = React.useRef(false);

  React.useEffect(() => {
    window.api.getAppInfo().then(setInfo);
    reload().then((ws) => {
      if (bootstrapped.current) return;
      bootstrapped.current = true;
      const first = ws.requests[0];
      if (first) {
        setDraft(first);
        setSavedSnapshot(JSON.stringify(first));
      }
    });
    const off = window.api.onWorkspaceChanged(() => {
      reload().then((ws) => {
        setDraft((current) => {
          if (!current) return current;
          const fresh = ws.requests.find((r) => r.id === current.id);
          if (!fresh) return current;
          const currentDirty = JSON.stringify(current) !== savedSnapshotRef.current;
          if (currentDirty) return current;
          setSavedSnapshot(JSON.stringify(fresh));
          return fresh;
        });
      });
    });
    return off;
  }, [reload]);

  const savedSnapshotRef = React.useRef('');
  React.useEffect(() => {
    savedSnapshotRef.current = savedSnapshot;
  }, [savedSnapshot]);

  const activeEnv = workspace?.environments.find((e) => e.id === workspace.activeEnvironmentId);
  const variables = activeEnv?.variables ?? [];
  const dirty = draft ? JSON.stringify(draft) !== savedSnapshot : false;

  const openRequest = (req: ApiRequest) => {
    setDraft(req);
    setSavedSnapshot(JSON.stringify(req));
    setResponse(null);
  };

  const updateDraft = (patch: Partial<ApiRequest>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const saveDraft = async (silent = false) => {
    if (!draft) return;
    const saved = await window.api.saveRequest(draft);
    setDraft(saved);
    setSavedSnapshot(JSON.stringify(saved));
    await reload();
    if (!silent) showToast('已保存到本地');
    return saved;
  };

  const createRequestIn = async (collectionId: string) => {
    const created = await window.api.saveRequest(
      createRequest({
        collectionId,
        name: '新建请求',
        url: 'https://',
        method: 'GET',
      }),
    );
    await reload();
    openRequest(created);
  };

  const send = async () => {
    if (!draft || sending) return;
    setSending(true);
    setResponse(null);
    try {
      const vars = envVarsOf(activeEnv);
      let url = substituteVars(draft.url, vars);
      const params: KeyValue[] = draft.params.map((p) => ({
        ...p,
        key: substituteVars(p.key, vars),
        value: substituteVars(p.value, vars),
      }));
      url = applyParams(url, params);

      const headers: Record<string, string> = {};
      for (const h of draft.headers) {
        if (!h.enabled || !h.key) continue;
        headers[substituteVars(h.key, vars)] = substituteVars(h.value, vars);
      }
      const auth = draft.auth;
      if (auth.type === 'bearer' && auth.token) {
        headers['Authorization'] = `Bearer ${substituteVars(auth.token, vars)}`;
      } else if (auth.type === 'basic') {
        const raw = `${substituteVars(auth.username ?? '', vars)}:${substituteVars(auth.password ?? '', vars)}`;
        headers['Authorization'] = `Basic ${utf8ToBase64(raw)}`;
      } else if (auth.type === 'apikey' && auth.key) {
        const key = substituteVars(auth.key, vars);
        const value = substituteVars(auth.value ?? '', vars);
        if (auth.addTo === 'query') {
          url = applyParams(url, [{ id: 'auth', key, value, enabled: true }]);
        } else {
          headers[key] = value;
        }
      }

      const body = substituteVars(draft.body, vars);
      if (body && draft.bodyType !== 'none') {
        const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
        if (!hasContentType) {
          headers['Content-Type'] =
            draft.bodyType === 'json'
              ? 'application/json'
              : draft.bodyType === 'urlencoded'
                ? 'application/x-www-form-urlencoded'
                : 'text/plain';
        }
      }

      const result = await window.api.sendRequest({
        method: draft.method,
        url,
        headers,
        body: draft.bodyType === 'none' ? '' : body,
      });
      setResponse(result);
    } catch (error: any) {
      setResponse({
        ok: false,
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        bodyKind: 'text',
        size: 0,
        timeMs: 0,
        error: error?.message ?? String(error),
      });
    } finally {
      setSending(false);
    }
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDraft();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const prompt = (title: string, value: string, onSubmit: (v: string) => void, placeholder?: string) =>
    setPromptState({ title, value, onSubmit, placeholder });

  const handleImport = async (payload: {
    content: string;
    format?: ImportFormat;
    collectionName?: string;
    mode?: 'merge' | 'replace';
  }): Promise<ImportOutcome> => {
    const outcome = await window.api.importText(payload);
    await reload();
    const fresh = await window.api.readWorkspace();
    const first = fresh.requests.find((r) => r.collectionId === outcome.collection.id);
    if (first) openRequest(first);
    showToast(`导入完成：${outcome.imported} 个接口`);
    return outcome;
  };

  const handleImportFile = async (): Promise<ImportOutcome | null> => {
    const outcome = await window.api.importFile();
    if (!outcome) return null;
    await reload();
    const fresh = await window.api.readWorkspace();
    const first = fresh.requests.find((r) => r.collectionId === outcome.collection.id);
    if (first) openRequest(first);
    showToast(`导入完成：${outcome.imported} 个接口`);
    return outcome;
  };

  const handleExport = async (collection: Collection, format: ExportFormat, toFile = false) => {
    const result = await window.api.exportCollection({ collectionId: collection.id, format, toFile });
    if (result && toFile) showToast(`已导出到 ${result.filePath}`);
    return result;
  };

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <div className="brand-mark">a</div>
          apiTools
          <span className="brand-sub">REST 接口管理 · MCP 就绪</span>
        </div>
        <div className="titlebar-spacer" />
        <div className="top-actions">
          <button className="chip-button" onClick={() => setDialog('import')}>
            <Icon name="upload" size={13} />
            导入
          </button>
          <button
            className="chip-button"
            onClick={() => {
              if (!workspace?.collections.length) {
                showToast('还没有集合可导出');
                return;
              }
              setExportTarget(workspace.collections[0]);
            }}
          >
            <Icon name="download" size={13} />
            导出
          </button>
          <button className="chip-button" onClick={() => setDialog('env')}>
            <Icon name="globe" size={13} />
            {activeEnv ? activeEnv.name : '环境'}
          </button>
          <button className="chip-button" onClick={() => setDialog('mcp')}>
            <Icon name="robot" size={13} />
            MCP
          </button>
          <button
            className="chip-button ghost"
            title="刷新数据"
            onClick={async () => {
              await reload();
              showToast('已刷新');
            }}
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </header>

      <div className="body">
        <Sidebar
          workspace={workspace}
          selectedId={draft?.id ?? null}
          port={info?.port ?? 4731}
          onSelect={openRequest}
          onCreateRequest={createRequestIn}
          onCreateCollection={() =>
            prompt('新建集合', '', async (value) => {
              if (!value.trim()) return;
              await window.api.createCollection(value.trim());
              await reload();
              showToast(`集合「${value.trim()}」已创建`);
            }, '集合名称，比如「订单服务 v1」')
          }
          onDeleteRequest={async (id) => {
            if (!window.confirm('确定删除这个接口吗？此操作不可撤销。')) return;
            await window.api.deleteRequest(id);
            if (draft?.id === id) {
              setDraft(null);
              setSavedSnapshot('');
            }
            await reload();
            showToast('接口已删除');
          }}
          onDeleteCollection={async (id) => {
            if (!window.confirm('删除集合会同时删除其中所有接口，确定继续吗？')) return;
            await window.api.deleteCollection(id);
            if (draft?.collectionId === id) {
              setDraft(null);
              setSavedSnapshot('');
            }
            await reload();
            showToast('集合已删除');
          }}
          onRenameCollection={(collection) =>
            prompt('重命名集合', collection.name, async (value) => {
              if (!value.trim()) return;
              await window.api.updateCollection(collection.id, { name: value.trim() });
              await reload();
            })
          }
          onExport={(collection) => setExportTarget(collection)}
          onOpenMcp={() => setDialog('mcp')}
        />

        <main className="main">
          {draft ? (
            <>
              <RequestEditor
                draft={draft}
                dirty={dirty}
                sending={sending}
                variables={variables}
                onChange={updateDraft}
                onSend={send}
                onSave={() => saveDraft()}
              />
              <ResponseView response={response} sending={sending} />
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-card">
                <div className="glow">a</div>
                <div className="welcome-title">本地优先的 API 调试台</div>
                <div className="welcome-desc">
                  从一个集合开始，或导入现有的 OpenAPI / Postman 文档。
                  <br />
                  数据保存在 ~/Library/Application Support/apiTools，
                  <br />
                  AI agent 可通过 MCP 直接往这里写入接口。
                </div>
                <div className="welcome-actions">
                  <button className="chip-button primary" onClick={() => setDialog('import')}>
                    <Icon name="upload" size={13} />
                    导入接口文档
                  </button>
                  <button
                    className="chip-button"
                    onClick={async () => {
                      const collection = await window.api.createCollection('默认集合');
                      await reload();
                      await createRequestIn(collection.id);
                    }}
                  >
                    <Icon name="plus" size={13} />
                    新建第一个集合
                  </button>
                  <button className="chip-button" onClick={() => setDialog('mcp')}>
                    <Icon name="robot" size={13} />
                    配置 MCP
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {dialog === 'import' && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImport={handleImport}
          onImportFile={handleImportFile}
        />
      )}

      {dialog === 'mcp' && <McpDialog info={info} onClose={() => setDialog(null)} />}

      {dialog === 'env' && workspace && (
        <EnvDialog
          environments={workspace.environments}
          activeId={workspace.activeEnvironmentId}
          onClose={() => setDialog(null)}
          onSave={async (env) => {
            await window.api.saveEnvironment(env);
            await reload();
            showToast('环境已保存');
          }}
          onDelete={async (id) => {
            await window.api.deleteEnvironment(id);
            await reload();
          }}
          onActivate={async (id) => {
            await window.api.setActiveEnvironment(id);
            await reload();
          }}
        />
      )}

      {exportTarget && (
        <ExportDialog
          collection={exportTarget}
          count={workspace?.requests.filter((r) => r.collectionId === exportTarget.id).length ?? 0}
          onClose={() => setExportTarget(null)}
          onLoad={(format) =>
            window.api
              .exportCollection({ collectionId: exportTarget.id, format })
              .then((r) => r ?? { filename: '', content: '' })
          }
          onSave={async (format) => {
            await handleExport(exportTarget, format, true);
          }}
        />
      )}

      {promptState && (
        <Modal
          title={promptState.title}
          onClose={() => setPromptState(null)}
          footer={
            <>
              <span className="spacer" />
              <button className="chip-button" onClick={() => setPromptState(null)}>
                取消
              </button>
              <button
                className="chip-button primary"
                onClick={() => {
                  promptState.onSubmit(promptState.value);
                  setPromptState(null);
                }}
              >
                确定
              </button>
            </>
          }
        >
          <input
            className="text-input"
            autoFocus
            style={{ height: 34, fontFamily: 'inherit' }}
            value={promptState.value}
            placeholder={promptState.placeholder}
            onChange={(e) => setPromptState({ ...promptState, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                promptState.onSubmit(promptState.value);
                setPromptState(null);
              }
            }}
          />
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
