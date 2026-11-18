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
import {
  EnvDialog,
  ExportDialog,
  FolderVarsDialog,
  ImportDialog,
  McpDialog,
  Modal,
} from './components/Dialogs';
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
  const [folderSettings, setFolderSettings] = React.useState<{ collection: Collection; folder: string } | null>(
    null,
  );
  const [toast, setToast] = React.useState('');
  const [promptState, setPromptState] = React.useState<{
    title: string;
    value: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  } | null>(null);

  const [theme, setTheme] = React.useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('apitools-theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('apitools-theme', theme);
  }, [theme]);

  const [sidebarWidth, setSidebarWidth] = React.useState<number>(() => {
    const saved = Number(localStorage.getItem('apitools-sidebar-width'));
    return Number.isFinite(saved) && saved >= 220 ? saved : 272;
  });
  const [editorHeight, setEditorHeight] = React.useState<number>(() => {
    const saved = Number(localStorage.getItem('apitools-editor-height'));
    return Number.isFinite(saved) && saved >= 180 ? saved : 360;
  });
  const mainRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    localStorage.setItem('apitools-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);
  React.useEffect(() => {
    localStorage.setItem('apitools-editor-height', String(editorHeight));
  }, [editorHeight]);

  const startResize = (kind: 'sidebar' | 'editor') => (event: React.MouseEvent) => {
    event.preventDefault();
    const onMove = (moveEvent: MouseEvent) => {
      if (kind === 'sidebar') {
        setSidebarWidth(Math.min(480, Math.max(220, moveEvent.clientX)));
      } else {
        const rect = mainRef.current?.getBoundingClientRect();
        if (!rect) return;
        setEditorHeight(Math.min(rect.height - 180, Math.max(190, moveEvent.clientY - rect.top)));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-col', 'resizing-row');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add(kind === 'sidebar' ? 'resizing-col' : 'resizing-row');
  };

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
  const currentCollection = workspace?.collections.find((c) => c.id === draft?.collectionId);
  const currentFolderConfig = currentCollection?.folderVars?.find((f) => f.name === draft?.folder);

  // 变量优先级：目录变量 > 环境变量
  const variables = React.useMemo(() => {
    const map = new Map<string, KeyValue>();
    for (const variable of activeEnv?.variables ?? []) {
      if (variable.key) map.set(variable.key, variable);
    }
    for (const variable of currentFolderConfig?.variables ?? []) {
      if (variable.key) map.set(variable.key, { ...variable, id: `folder_${variable.id}` });
    }
    return [...map.values()];
  }, [activeEnv, currentFolderConfig]);

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

  const createRequestIn = async (collectionId: string, folder = '') => {
    const created = await window.api.saveRequest(
      createRequest({
        collectionId,
        folder,
        name: '新建请求',
        url: 'https://',
        method: 'GET',
      }),
    );
    await reload();
    openRequest(created);
  };

  const createFolderIn = (collection: Collection) =>
    prompt(
      '新建目录',
      '',
      async (value) => {
        const name = value.trim();
        if (!name) return;
        try {
          await window.api.createFolder(collection.id, name);
          await reload();
          showToast(`目录「${name}」已创建`);
        } catch (error: any) {
          showToast(error?.message ?? String(error));
        }
      },
      '目录名称，例如「用户中心」',
    );

  const renameFolderIn = (collection: Collection, folder: string) =>
    prompt(
      '重命名目录',
      folder,
      async (value) => {
        const name = value.trim();
        if (!name || name === folder) return;
        try {
          await window.api.renameFolder(collection.id, folder, name);
          await reload();
          if (draft?.collectionId === collection.id && draft.folder === folder) {
            setDraft({ ...draft, folder: name });
          }
          showToast('目录已重命名');
        } catch (error: any) {
          showToast(error?.message ?? String(error));
        }
      },
      '新的目录名称',
    );

  const switchProject = async (id: string) => {
    if (!id || workspace?.activeProjectId === id) return;
    await window.api.setActiveProject(id);
    const ws = await reload();
    const first = ws.requests[0] ?? null;
    setDraft(first);
    setSavedSnapshot(first ? JSON.stringify(first) : '');
    setResponse(null);
    showToast(`已切换到项目「${ws.projects.find((p) => p.id === id)?.name ?? ''}」`);
  };

  const createProjectPrompt = () =>
    prompt(
      '新建项目',
      '',
      async (value) => {
        const name = value.trim();
        if (!name) return;
        await window.api.createProject(name);
        const ws = await reload();
        const first = ws.requests[0] ?? null;
        setDraft(first);
        setSavedSnapshot(first ? JSON.stringify(first) : '');
        setResponse(null);
        showToast(`项目「${name}」已创建`);
      },
      '项目名称，例如「电商后台」',
    );

  const renameProjectPrompt = (id: string) => {
    const current = workspace?.projects.find((p) => p.id === id);
    prompt(
      '重命名项目',
      current?.name ?? '',
      async (value) => {
        const name = value.trim();
        if (!name) return;
        await window.api.renameProject(id, name);
        await reload();
        showToast('项目已重命名');
      },
      '新的项目名称',
    );
  };

  const deleteProjectConfirm = async () => {
    const id = workspace?.activeProjectId;
    if (!id) return;
    if (!window.confirm('删除当前项目及其下所有集合、接口？此操作不可撤销。')) return;
    try {
      await window.api.deleteProject(id);
      const ws = await reload();
      const first = ws.requests[0] ?? null;
      setDraft(first);
      setSavedSnapshot(first ? JSON.stringify(first) : '');
      setResponse(null);
      showToast('项目已删除');
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    }
  };

  const deleteFolderIn = async (collection: Collection, folder: string) => {
    if (!window.confirm(`删除目录「${folder}」？目录内的接口会移到集合根级，不会被删除。`)) return;
    await window.api.deleteFolder(collection.id, folder);
    await reload();
    if (draft?.collectionId === collection.id && draft.folder === folder) {
      setDraft({ ...draft, folder: '' });
    }
    showToast('目录已删除');
  };

  const send = async () => {
    if (!draft || sending) return;
    setSending(true);
    setResponse(null);
    try {
      const vars: Record<string, string> = {};
      for (const variable of variables) {
        if (variable.enabled && variable.key) vars[variable.key] = variable.value;
      }
      let url = substituteVars(draft.url, vars);
      const params: KeyValue[] = draft.params.map((p) => ({
        ...p,
        key: substituteVars(p.key, vars),
        value: substituteVars(p.value, vars),
      }));
      url = applyParams(url, params);

      const headers: Record<string, string> = {};
      // 目录级公共请求头（请求内同名 Header 会覆盖）
      for (const header of currentFolderConfig?.headers ?? []) {
        if (!header.enabled || !header.key) continue;
        headers[substituteVars(header.key, vars)] = substituteVars(header.value, vars);
      }
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
            className="chip-button ghost theme-toggle"
            title={theme === 'dark' ? '切换到浅色模式' : '切换到夜间模式'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
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
        <div className="sidebar-wrap" style={{ width: sidebarWidth }}>
          <Sidebar
          workspace={workspace}
          selectedId={draft?.id ?? null}
          port={info?.port ?? 4731}
          onSelect={openRequest}
          onSelectProject={switchProject}
          onCreateProject={createProjectPrompt}
          onRenameProject={renameProjectPrompt}
          onDeleteProject={deleteProjectConfirm}
          onFolderSettings={(collection, folder) => setFolderSettings({ collection, folder })}
          onCreateRequest={createRequestIn}
          onCreateCollection={() =>
            prompt('新建集合', '', async (value) => {
              if (!value.trim()) return;
              await window.api.createCollection(value.trim());
              await reload();
              showToast(`集合「${value.trim()}」已创建`);
            }, '集合名称，比如「订单服务 v1」')
          }
          onCreateFolder={createFolderIn}
          onRenameFolder={renameFolderIn}
          onDeleteFolder={deleteFolderIn}
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
        </div>

        <div
          className="resizer-v"
          onMouseDown={startResize('sidebar')}
          title="拖动调整侧栏宽度"
        />

        <main className="main" ref={mainRef}>
          {draft ? (
            <>
              <div className="editor-pane" style={{ height: editorHeight }}>
              <RequestEditor
                draft={draft}
                dirty={dirty}
                sending={sending}
                variables={variables}
                folders={
                  workspace?.collections.find((c) => c.id === draft.collectionId)?.folders ?? []
                }
                onChange={updateDraft}
                onSend={send}
                onSave={() => saveDraft()}
              />
              </div>
              <div
                className="resizer-h"
                onMouseDown={startResize('editor')}
                title="拖动调整请求/响应高度"
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

      {folderSettings && (
        <FolderVarsDialog
          collectionName={folderSettings.collection.name}
          folder={folderSettings.folder}
          config={folderSettings.collection.folderVars?.find((f) => f.name === folderSettings.folder)}
          requestCount={
            workspace?.requests.filter(
              (r) => r.collectionId === folderSettings.collection.id && r.folder === folderSettings.folder,
            ).length ?? 0
          }
          onClose={() => setFolderSettings(null)}
          onSave={async (vars, headers) => {
            await window.api.setFolderConfig(
              folderSettings.collection.id,
              folderSettings.folder,
              vars,
              headers,
            );
            await reload();
            setFolderSettings(null);
            showToast('目录配置已保存');
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
