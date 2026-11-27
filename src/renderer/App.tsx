import React from 'react';
import {
  ApiRequest,
  Collection,
  Environment,
  ExportFormat,
  ImportFormat,
  KeyValue,
  LoadTestConfig,
  SendResponse,
  Workspace,
  createRequest,
} from '../shared/types';
import { applyParams, substituteVars } from '../shared/url';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
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
import LoadTestDialog, { LoadTestLive } from './components/LoadTestDialog';
import UpdateCenter, { UpdateState } from './components/UpdateCenter';
import { useContextMenu } from './components/ContextMenu';

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
  onCloseOthers,
  onCloseAll,
  onSave,
}: {
  tabs: RequestTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onSave: () => void;
}) {
  const menu = useContextMenu();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = React.useState(false);

  // 标签总宽度超过容器时显示左右切换按钮
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const check = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tabs.length]);

  // 鼠标滚轮横向滚动
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth + 1) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        element.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // 激活标签自动滚到可见区域
  React.useEffect(() => {
    const active = scrollRef.current?.querySelector('.req-tab.active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeId, tabs.length]);

  if (!tabs.length) return null;

  const scrollBy = (delta: number) =>
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  return (
    <div className="req-tabs">
      {overflow && (
        <button
          className="tab-scroll-btn"
          title="向左滚动标签"
          onClick={() => scrollBy(-180)}
        >
          <Icon name="chevron" size={11} style={{ transform: 'rotate(180deg)' }} />
        </button>
      )}
      <div className="req-tabs-scroll" ref={scrollRef}>
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
              onContextMenu={(event) =>
                menu.open(event, [
                  { label: '关闭标签', icon: 'close', shortcut: '⌘W', onClick: () => onClose(tab.id) },
                  { label: '关闭其他标签', icon: 'close', onClick: () => onCloseOthers(tab.id) },
                  { label: '关闭全部标签', icon: 'close', onClick: onCloseAll },
                  { separator: true },
                  { label: '保存修改', icon: 'check', shortcut: '⌘S', onClick: onSave },
                ])
              }
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
      {overflow && (
        <button className="tab-scroll-btn" title="向右滚动标签" onClick={() => scrollBy(180)}>
          <Icon name="chevron" size={11} />
        </button>
      )}
      {menu.node}
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
  const [loadTestOpen, setLoadTestOpen] = React.useState(false);
  // 压测状态放在 App 层：面板关闭后压测继续，重新打开仍能看到曲线
  // 更新中心：面板开关 + 检查状态，定时复查也放在这里
  const [updateOpen, setUpdateOpen] = React.useState(false);
  const [updateState, setUpdateState] = React.useState<UpdateState>({ status: 'checking' });
  const pendingUpdate = React.useRef<any>(null);
  // 后台探测到的新版本号，用于顶栏红点
  const [updateReady, setUpdateReady] = React.useState<string | null>(null);
  const currentVersion = info?.version ?? '';

  React.useEffect(() => {
    let cancelled = false;
    const silentCheck = async () => {
      try {
        const update = await Promise.race([
          check(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 15000),
          ),
        ]);
        if (cancelled || !update) return;
        pendingUpdate.current = update;
        setUpdateReady(update.version);
      } catch {
        /* 后台检查失败不打扰用户 */
      }
    };
    const first = setTimeout(silentCheck, 5000);
    // 每 6 小时复查一次
    const interval = setInterval(silentCheck, 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  const runUpdateCheck = async () => {
    setUpdateState({ status: 'checking' });
    try {
      // 更新清单在 GitHub 上，国内网络可能较慢，加超时避免一直转圈
      const update = await Promise.race([
        check(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('请求更新服务器超时（15 秒）')), 15000),
        ),
      ]);
      if (!update) {
        setUpdateReady(null);
        setUpdateState({ status: 'latest', current: currentVersion });
        return;
      }
      pendingUpdate.current = update;
      setUpdateReady(update.version);
      setUpdateState({
        status: 'available',
        version: update.version,
        current: update.currentVersion,
        notes: update.body ?? '',
      });
    } catch (err: any) {
      const raw = String(err?.message ?? err);
      setUpdateState({
        status: 'error',
        message: /valid release JSON|404|not found/i.test(raw)
          ? '还没有可用的更新包：最新版本未附带更新清单（latest.json），或当前版本早于首个支持自动更新的版本。'
          : /timed out|dns|network|failed to fetch|error send/i.test(raw)
            ? '无法连接更新服务器，请检查网络后重试。'
            : raw,
      });
    }
  };

  /** 打开更新中心：后台已探测到新版就直接展示，否则现查一次 */
  const openUpdateCenter = () => {
    setUpdateOpen(true);
    const pending = pendingUpdate.current;
    if (pending && updateReady) {
      setUpdateState({
        status: 'available',
        version: pending.version,
        current: pending.currentVersion,
        notes: pending.body ?? '',
      });
      return;
    }
    void runUpdateCheck();
  };

  const installUpdate = async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    setUpdateState({ status: 'downloading', version: update.version, percent: 0 });
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event: any) => {
        if (event.event === 'Started') {
          total = event.data?.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0;
          setUpdateState({
            status: 'downloading',
            version: update.version,
            percent: total ? Math.min(99, Math.round((downloaded / total) * 100)) : 0,
          });
        } else if (event.event === 'Finished') {
          setUpdateState({ status: 'ready', version: update.version });
        }
      });
      await relaunch();
    } catch (err: any) {
      setUpdateState({ status: 'error', message: err?.message ?? String(err) });
    }
  };

  const [liveTest, setLiveTest] = React.useState<LoadTestLive>({
    running: false,
    snapshot: null,
    series: { qps: [], avg: [], p95: [] },
  });

  React.useEffect(() => {
    let disposeProgress: (() => void) | null = null;
    let disposeFinished: (() => void) | null = null;
    const append = (list: number[], value: number) => {
      const next = [...list, value];
      return next.length > 900 ? next.slice(next.length - 900) : next;
    };

    window.api
      .onLoadTestProgress((next) => {
        setLiveTest((prev) => ({
          running: next.running,
          snapshot: next,
          series: {
            qps: append(prev.series.qps, Number(next.qps.toFixed(2))),
            avg: append(prev.series.avg, Math.round(next.avgMs)),
            p95: append(prev.series.p95, next.p95),
          },
        }));
      })
      .then((dispose) => {
        disposeProgress = dispose;
      });

    window.api
      .onLoadTestFinished((next) => {
        setLiveTest((prev) => ({ ...prev, running: false, snapshot: next }));
      })
      .then((dispose) => {
        disposeFinished = dispose;
      });

    return () => {
      disposeProgress?.();
      disposeFinished?.();
    };
  }, []);

  const runLoadTest = async (config: LoadTestConfig) => {
    setLiveTest({ running: true, snapshot: null, series: { qps: [], avg: [], p95: [] } });
    try {
      await window.api.startLoadTest(config);
    } catch (err) {
      setLiveTest({ running: false, snapshot: null, series: { qps: [], avg: [], p95: [] } });
      throw err;
    }
  };

  const haltLoadTest = async () => {
    await window.api.stopLoadTest();
    setLiveTest((prev) => ({ ...prev, running: false }));
  };

  const [toast, setToast] = React.useState('');
  const [promptState, setPromptState] = React.useState<{
    title: string;
    value: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  } | null>(null);

  // 输入框/多行文本：拦截系统右键菜单，换成剪贴板菜单
  const fieldMenu = useContextMenu();
  React.useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const field = target?.closest('input, textarea') as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (!field) return;
      event.preventDefault();
      const start = field.selectionStart ?? 0;
      const end = field.selectionEnd ?? 0;
      const selected = field.value.slice(start, end);
      const editable = !field.readOnly && !field.disabled;

      const applyText = (text: string) => {
        const next = field.value.slice(0, start) + text + field.value.slice(end);
        const proto =
          field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, next);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
        const caret = start + text.length;
        field.setSelectionRange(caret, caret);
      };

      fieldMenu.open(event as unknown as React.MouseEvent, [
        {
          label: '剪切',
          shortcut: '⌘X',
          disabled: !selected || !editable,
          onClick: () => {
            void navigator.clipboard.writeText(selected);
            applyText('');
          },
        },
        {
          label: '复制',
          shortcut: '⌘C',
          disabled: !selected,
          onClick: () => void navigator.clipboard.writeText(selected),
        },
        {
          label: '粘贴',
          shortcut: '⌘V',
          disabled: !editable,
          onClick: async () => {
            const text = await navigator.clipboard.readText().catch(() => '');
            if (text) applyText(text);
          },
        },
        { separator: true },
        {
          label: '全选',
          shortcut: '⌘A',
          onClick: () => {
            field.focus();
            field.select();
          },
        },
      ]);
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [fieldMenu]);

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
    // 防抖：大请求体输入时不要每次击键都序列化
    const timer = setTimeout(() => {
      try {
        const payload = JSON.stringify({
          version: TABS_VERSION,
          activeTabId,
          tabs: tabs.map((tab) => ({ id: tab.id, draft: tab.draft, saved: tab.saved })),
        });
        // 超过 2MB 时降级为只记标签顺序，避免 localStorage 写入卡顿
        if (payload.length > 2_000_000) {
          localStorage.setItem(
            TABS_KEY,
            JSON.stringify({
              version: TABS_VERSION,
              activeTabId,
              tabs: tabs.map((tab) => ({ id: tab.id })),
            }),
          );
          return;
        }
        localStorage.setItem(TABS_KEY, payload);
      } catch {
        /* 忽略配额错误 */
      }
    }, 600);
    return () => clearTimeout(timer);
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

  const closeOtherTabs = (id: string) => {
    const keep = tabs.find((tab) => tab.id === id);
    const others = tabs.filter((tab) => tab.id !== id);
    if (others.some((tab) => isTabDirty(tab))) {
      if (!window.confirm('其他标签有未保存的修改，关闭后会丢失。继续？')) return;
    }
    setTabs(keep ? [keep] : []);
    setActiveTabId(keep?.id ?? null);
  };

  const closeAllTabs = () => {
    if (tabs.some((tab) => isTabDirty(tab))) {
      if (!window.confirm('有未保存的修改，关闭后会丢失。继续？')) return;
    }
    setTabs([]);
    setActiveTabId(null);
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

  /** 把编辑器里的请求组装成实际发送的报文（环境前缀、统一请求头、鉴权、表单） */
  const buildRequestPayload = (request: ApiRequest) => {
    const vars: Record<string, string> = {};
    let url = request.url.trim();
    if (!/^https?:\/\//i.test(url) && envBaseUrl) {
      url = `${envBaseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
    }
    const params: KeyValue[] = request.params.map((param) => ({
      ...param,
      key: substituteVars(param.key, vars),
      value: substituteVars(param.value, vars),
    }));
    url = applyParams(url, params);

    const headers: Record<string, string> = {};
    // 环境统一请求头：请求里写了同名 Header（忽略大小写）时以请求为准
    const requestHeaderKeys = new Set(
      request.headers
        .filter((header) => header.enabled && header.key)
        .map((header) => substituteVars(header.key, vars).trim().toLowerCase()),
    );
    for (const header of activeEnv?.headers ?? []) {
      if (!header.enabled || !header.key) continue;
      if (requestHeaderKeys.has(header.key.trim().toLowerCase())) continue;
      headers[header.key] = header.value;
    }
    for (const header of request.headers) {
      if (!header.enabled || !header.key) continue;
      headers[substituteVars(header.key, vars)] = substituteVars(header.value, vars);
    }
    const auth = request.auth;
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

    let body = substituteVars(request.body, vars);
    if (request.bodyType === 'urlencoded') {
      body = (request.formFields ?? [])
        .filter((field) => field.enabled && field.key)
        .map((field) => `${encodeURIComponent(field.key)}=${encodeURIComponent(field.value ?? '')}`)
        .join('&');
    }

    if (request.bodyType !== 'none' && request.bodyType !== 'form') {
      const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
      if (!hasContentType) {
        headers['Content-Type'] =
          request.bodyType === 'json'
            ? 'application/json'
            : request.bodyType === 'urlencoded'
              ? 'application/x-www-form-urlencoded'
              : 'text/plain';
      }
    }

    return {
      method: request.method,
      url,
      headers,
      body: request.bodyType === 'none' || request.bodyType === 'form' ? '' : body,
      formFields: request.bodyType === 'form' ? request.formFields ?? [] : undefined,
    };
  };

  const send = async () => {
    if (!draft || sending) return;
    const tabId = activeTabId;
    patchTab(tabId, { sending: true, response: null });
    try {
      const result = await window.api.sendRequest(buildRequestPayload(draft));
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
          <button
            className="chip-button"
            onClick={() => setDialog('env')}
            title="统一 URL 前缀与请求头"
          >
            <Icon name="globe" size={13} />
            环境设置
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
          <span className="top-divider" />
          <button
            className="top-icon-btn"
            title={updateReady ? `发现新版本 ${updateReady}` : '更新中心'}
            onClick={openUpdateCenter}
          >
            <Icon name="cloudDownload" size={15} />
            {updateReady && <span className="top-dot" />}
          </button>
          <button
            className="top-icon-btn"
            title="刷新数据"
            onClick={async () => {
              await reload();
              showToast('已刷新');
            }}
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            className="top-icon-btn"
            title="打开 GitHub 仓库"
            onClick={() => window.api.openUrl('https://github.com/Lixin-2/apiTools')}
          >
            <Icon name="github" size={15} />
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
                onCloseOthers={closeOtherTabs}
                onCloseAll={closeAllTabs}
                onSave={() => saveDraft()}
              />
              <div className="editor-pane" style={{ height: editorHeight }}>
              <RequestEditor
                draft={draft}
                dirty={dirty}
                sending={sending}
                variables={variables}
                previewUrl={previewUrl}
                baseUrl={envBaseUrl}
                environments={workspace?.environments ?? []}
                activeEnvironmentId={workspace?.activeEnvironmentId ?? null}
                onSelectEnvironment={async (id) => {
                  await window.api.setActiveEnvironment(id);
                  await reload();
                }}
                onOpenEnvSettings={() => setDialog('env')}
                folders={
                  workspace?.collections.find((c) => c.id === draft.collectionId)?.folders ?? []
                }
                onChange={updateDraft}
                onSend={send}
                onSave={() => saveDraft()}
                onLoadTest={() => setLoadTestOpen(true)}
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
          onSave={async (env): Promise<string | undefined> => {
            const saved = await window.api.saveEnvironment(env);
            // 新建的环境直接设为当前使用，省去再点一次
            if (!env.id && saved?.id) {
              await window.api.setActiveEnvironment(saved.id);
            }
            await reload();
            showToast('环境已保存');
            return saved?.id;
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

      {fieldMenu.node}

      {loadTestOpen && draft && (
        <LoadTestDialog
          requestName={draft.name || '未命名请求'}
          payload={buildRequestPayload(draft)}
          live={liveTest}
          environments={workspace?.environments ?? []}
          activeEnvironmentId={workspace?.activeEnvironmentId ?? null}
          onSelectEnvironment={async (id) => {
            await window.api.setActiveEnvironment(id);
            await reload();
          }}
          onStart={runLoadTest}
          onStop={haltLoadTest}
          onClose={() => setLoadTestOpen(false)}
        />
      )}

      {liveTest.running && !loadTestOpen && (
        <button
          className="lt-float"
          onClick={() => setLoadTestOpen(true)}
          title="压测在后台运行，点击打开面板"
        >
          <span className="lt-float-dot" />
          <span className="lt-float-text">压测进行中</span>
          <b className="lt-float-total">{(liveTest.snapshot?.total ?? 0).toLocaleString()}</b>
          <span className="lt-float-meta">
            <span className="lt-float-unit">请求</span>
            <span className="lt-float-qps">
              {(liveTest.snapshot?.qps ?? 0) >= 1
                ? `QPS ${Math.round(liveTest.snapshot?.qps ?? 0)}`
                : ''}
            </span>
          </span>
        </button>
      )}

      {updateOpen && (
        <UpdateCenter
          currentVersion={currentVersion}
          state={updateState}
          onCheck={runUpdateCheck}
          onInstall={installUpdate}
          onClose={() => setUpdateOpen(false)}
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
