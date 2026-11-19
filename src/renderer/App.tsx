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
  ImportDialog,
  McpDialog,
  Modal,
} from './components/Dialogs';
import { AppMark, Icon, METHOD_COLORS, Select } from './components/ui';

type DialogKey = 'import' | 'mcp' | 'env' | null;
type ThemeMode = 'light' | 'dark' | 'system';

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

interface RequestTab {
  id: string;
  draft: ApiRequest;
  saved: string;
  response: SendResponse | null;
  sending: boolean;
}

const TABS_KEY = 'apitools-tabs';
const MAX_TABS = 12;
const TABS_VERSION = 2;

function isTabDirty(tab: RequestTab): boolean {
  try {
    return stableStringify(tab.draft) !== stableStringify(JSON.parse(tab.saved));
  } catch {
    return true;
  }
}

/** 稳定序列化：忽略对象键顺序，用于判断「是否有未保存修改」 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function loadTabs(): RequestTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      version?: number;
      tabs?: { id: string; draft: ApiRequest; saved?: string }[];
    };
    // 旧版没有版本号，saved 与 draft 的序列化方式不同，直接视为已保存
    const trusted = (parsed.version ?? 1) >= TABS_VERSION;
    return (parsed.tabs ?? [])
      .filter((tab) => tab?.id && tab?.draft)
      .map((tab) => ({
        id: tab.id,
        draft: tab.draft,
        saved: trusted && tab.saved ? tab.saved : stableStringify(tab.draft),
        response: null,
        sending: false,
      }));
  } catch {
    return [];
  }
}

function loadActiveTabId(): string | null {
  try {
    return (JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}') as { activeTabId?: string })
      .activeTabId ?? null;
  } catch {
    return null;
  }
}

function TabBar({
  tabs,
  activeId,
  onActivate,
  onClose,
}: {
  tabs: RequestTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (!tabs.length) return null;
  return (
    <div className="req-tabs">
      <div className="req-tabs-scroll">
        {tabs.map((tab) => {
          const tabDirty = isTabDirty(tab);
          return (
            <div
              key={tab.id}
              className={`req-tab ${tab.id === activeId ? 'active' : ''}`}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.id);
              }}
              title={`${tab.draft.method} ${tab.draft.url || tab.draft.name}`}
            >
              <span
                className="req-tab-method"
                style={{ color: METHOD_COLORS[tab.draft.method] ?? 'var(--text-dim)' }}
              >
                {tab.draft.method}
              </span>
              <span className="req-tab-name">{tab.draft.name || '未命名'}</span>
              {tabDirty && <span className="req-tab-dirty" title="有未保存修改" />}
              <button
                className="req-tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                title="关闭标签"
              >
                <Icon name="close" size={10} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [info, setInfo] = React.useState<AppInfo | null>(null);
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [tabs, setTabs] = React.useState<RequestTab[]>(loadTabs);
  const [activeTabId, setActiveTabId] = React.useState<string | null>(loadActiveTabId);
  const [dialog, setDialog] = React.useState<DialogKey>(null);
  const [exportTarget, setExportTarget] = React.useState<Collection | null>(null);

  const [toast, setToast] = React.useState('');
  const [promptState, setPromptState] = React.useState<{
    title: string;
    value: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  } | null>(null);

  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    const saved = localStorage.getItem('apitools-theme-mode');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return localStorage.getItem('apitools-theme') === 'dark' ? 'dark' : 'light';
  });

  const [systemDark, setSystemDark] = React.useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  );

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;

  React.useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem('apitools-theme-mode', themeMode);
    window.api.setDockIcon?.(resolvedTheme === 'dark');
  }, [resolvedTheme, themeMode]);

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
      // 只保留属于当前项目、且仍然存在的标签
      setTabs((prev) => {
        const valid = prev.filter(
          (tab) =>
            ws.requests.some((request) => request.id === tab.id) &&
            ws.collections.some((collection) => collection.id === tab.draft.collectionId),
        );
        if (valid.length) {
          setActiveTabId((current) =>
            current && valid.some((tab) => tab.id === current)
              ? current
              : valid[valid.length - 1].id,
          );
          return valid;
        }
        const first = ws.requests[0];
        if (!first) return [];
        setActiveTabId(first.id);
        return [{ id: first.id, draft: first, saved: stableStringify(first), response: null, sending: false }];
      });
    });
    const off = window.api.onWorkspaceChanged(() => {
      reload().then((ws) => {
        setTabs((prev) =>
          prev.map((tab) => {
            const fresh = ws.requests.find((request) => request.id === tab.id);
            if (!fresh) return tab;
            // 有未保存修改的标签不被外部数据覆盖
            if (isTabDirty(tab)) return tab;
            return { ...tab, draft: fresh, saved: stableStringify(fresh) };
          }),
        );
      });
    });
    return off;
  }, [reload]);

  // 标签草稿持久化（响应体太大，不落盘）
  React.useEffect(() => {
    try {
      localStorage.setItem(
        TABS_KEY,
        JSON.stringify({
          version: TABS_VERSION,
          activeTabId,
          tabs: tabs.map((tab) => ({
            id: tab.id,
            draft: tab.draft,
            saved: stableStringify(tab.draft),
          })),
        }),
      );
    } catch {
      /* 忽略配额错误 */
    }
  }, [tabs, activeTabId]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const draft = activeTab?.draft ?? null;
  const response = activeTab?.response ?? null;
  const sending = activeTab?.sending ?? false;
  const dirty = activeTab ? isTabDirty(activeTab) : false;

  const activeEnv = workspace?.environments.find((e) => e.id === workspace.activeEnvironmentId);
  const envBaseUrl = (activeEnv?.baseUrl ?? '').trim();
  const variables: KeyValue[] = [];
  const previewUrl = React.useMemo(() => {
    const url = (draft?.url ?? '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (!envBaseUrl) return url;
    return `${envBaseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }, [draft?.url, envBaseUrl]);

  const patchTab = (id: string | null, patch: Partial<RequestTab>) => {
    if (!id) return;
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  };

  const openRequest = (req: ApiRequest) => {
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === req.id);
      if (existing) {
        const tabDirty = isTabDirty(existing);
        return prev.map((tab) =>
          tab.id === req.id
            ? {
                ...tab,
                draft: tabDirty ? tab.draft : req,
                saved: tabDirty ? tab.saved : JSON.stringify(req),
              }
            : tab,
        );
      }
      const next = [
        ...prev,
        { id: req.id, draft: req, saved: stableStringify(req), response: null, sending: false },
      ];
      return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next;
    });
    setActiveTabId(req.id);
  };

  const closeTab = async (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    // 有未保存修改时先落盘，避免误关标签丢内容
    if (tab && isTabDirty(tab)) {
      try {
        await window.api.saveRequest(tab.draft);
        await reload();
        showToast(`已保存「${tab.draft.name || '未命名'}」并关闭标签`);
      } catch (error: any) {
        showToast(`保存失败，未关闭：${error?.message ?? error}`);
        return;
      }
    }
    const index = tabs.findIndex((item) => item.id === id);
    const next = tabs.filter((item) => item.id !== id);
    setTabs(next);
    if (activeTabId === id) {
      setActiveTabId(next[Math.min(index, next.length - 1)]?.id ?? null);
    }
  };

  const resetTabs = (first: ApiRequest | null) => {
    setTabs(
      first
        ? [{ id: first.id, draft: first, saved: stableStringify(first), response: null, sending: false }]
        : [],
    );
    setActiveTabId(first?.id ?? null);
  };

  const updateDraft = (patch: Partial<ApiRequest>) => {
    if (!activeTabId) return;
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, draft: { ...tab.draft, ...patch } } : tab,
      ),
    );
  };

  const saveDraft = async (silent = false) => {
    if (!draft) return;
    const saved = await window.api.saveRequest(draft);
    patchTab(draft.id, { draft: saved, saved: stableStringify(saved) });
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

  const createFolderIn = (collection: Collection, parentPath?: string) =>
    prompt(
      parentPath ? `在「${parentPath}」下新建子目录` : '新建目录',
      '',
      async (value) => {
        const name = value.trim();
        if (!name) return;
        const path = parentPath ? `${parentPath}/${name}` : name;
        try {
          await window.api.createFolder(collection.id, path);
          await reload();
          showToast(`目录「${path}」已创建`);
        } catch (error: any) {
          showToast(error?.message ?? String(error));
        }
      },
      '目录名称，例如「用户中心」',
    );

  const renameFolderIn = (collection: Collection, folder: string) => {
    const segments = folder.split('/');
    const current = segments[segments.length - 1];
    prompt(
      '重命名目录',
      current,
      async (value) => {
        const name = value.trim();
        if (!name || name === current) return;
        const parent = segments.slice(0, -1).join('/');
        const nextPath = parent ? `${parent}/${name}` : name;
        try {
          await window.api.renameFolder(collection.id, folder, nextPath);
          await reload();
          setTabs((prev) =>
            prev.map((tab) => {
              if (tab.draft.collectionId !== collection.id) return tab;
              if (tab.draft.folder === folder) {
                return { ...tab, draft: { ...tab.draft, folder: nextPath } };
              }
              if (tab.draft.folder.startsWith(`${folder}/`)) {
                return {
                  ...tab,
                  draft: {
                    ...tab.draft,
                    folder: `${nextPath}/${tab.draft.folder.slice(folder.length + 1)}`,
                  },
                };
              }
              return tab;
            }),
          );
          showToast('目录已重命名');
        } catch (error: any) {
          showToast(error?.message ?? String(error));
        }
      },
      '新的目录名称',
    );
  };

  const switchProject = async (id: string) => {
    if (!id || workspace?.activeProjectId === id) return;
    await window.api.setActiveProject(id);
    const ws = await reload();
    resetTabs(ws.requests[0] ?? null);
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
        resetTabs(ws.requests[0] ?? null);
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
      resetTabs(ws.requests[0] ?? null);
      showToast('项目已删除');
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    }
  };

  const deleteFolderIn = async (collection: Collection, folder: string) => {
    if (!window.confirm(`删除目录「${folder}」及其子目录？目录内的接口会移到集合根级，不会被删除。`)) return;
    await window.api.deleteFolder(collection.id, folder);
    await reload();
    setTabs((prev) =>
      prev.map((tab) =>
        tab.draft.collectionId === collection.id &&
        (tab.draft.folder === folder || tab.draft.folder.startsWith(`${folder}/`))
          ? { ...tab, draft: { ...tab.draft, folder: '' } }
          : tab,
      ),
    );
    showToast('目录已删除');
  };

  const send = async () => {
    if (!draft || sending) return;
    const tabId = activeTabId;
    patchTab(tabId, { sending: true, response: null });
    try {
      const vars: Record<string, string> = {};
      let url = draft.url.trim();
      // 环境统一 URL 前缀：接口写相对路径时自动拼接
      if (!/^https?:\/\//i.test(url) && envBaseUrl) {
        url = `${envBaseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
      }
      const params: KeyValue[] = draft.params.map((p) => ({
        ...p,
        key: substituteVars(p.key, vars),
        value: substituteVars(p.value, vars),
      }));
      url = applyParams(url, params);

      const headers: Record<string, string> = {};
      // 环境统一请求头（请求内同名 Header 会覆盖）
      for (const header of activeEnv?.headers ?? []) {
        if (!header.enabled || !header.key) continue;
        headers[header.key] = header.value;
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

      let body = substituteVars(draft.body, vars);
      if (draft.bodyType === 'urlencoded') {
        body = (draft.formFields ?? [])
          .filter((field) => field.enabled && field.key)
          .map((field) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value ?? '')}`)
          .join('&');
      }

      if (draft.bodyType !== 'none' && draft.bodyType !== 'form') {
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
        body: draft.bodyType === 'none' || draft.bodyType === 'form' ? '' : body,
        formFields: draft.bodyType === 'form' ? draft.formFields ?? [] : undefined,
      });
      patchTab(tabId, { response: result });
    } catch (error: any) {
      patchTab(tabId, {
        response: {
          ok: false,
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          bodyKind: 'text',
          size: 0,
          timeMs: 0,
          error: error?.message ?? String(error),
        },
      });
    } finally {
      patchTab(tabId, { sending: false });
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w' && activeTabId) {
        e.preventDefault();
        closeTab(activeTabId);
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
          <AppMark size={22} />
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
          <Select
            value={themeMode}
            onChange={(value) => setThemeMode(value as ThemeMode)}
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ]}
            size="sm"
            icon={
              <Icon
                name={
                  themeMode === 'system' ? 'monitor' : resolvedTheme === 'dark' ? 'moon' : 'sun'
                }
                size={13}
              />
            }
            className="theme-select"
            style={{ width: 136 }}
            menuWidth={150}
          />
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
            await reload();
            closeTab(id);
            showToast('接口已删除');
          }}
          onDeleteCollection={async (id) => {
            if (!window.confirm('删除集合会同时删除其中所有接口，确定继续吗？')) return;
            await window.api.deleteCollection(id);
            await reload();
            const remaining = tabs.filter((tab) => tab.draft.collectionId !== id);
            setTabs(remaining);
            if (!remaining.some((tab) => tab.id === activeTabId)) {
              setActiveTabId(remaining[remaining.length - 1]?.id ?? null);
            }
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
              <TabBar
                tabs={tabs}
                activeId={activeTabId}
                onActivate={setActiveTabId}
                onClose={closeTab}
              />
              <div className="editor-pane" style={{ height: editorHeight }}>
              <RequestEditor
                draft={draft}
                dirty={dirty}
                sending={sending}
                variables={variables}
                previewUrl={previewUrl}
                baseUrl={envBaseUrl}
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
                <div className="welcome-mark">
                  <AppMark size={68} />
                </div>
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
