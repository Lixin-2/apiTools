import React from 'react';
import { ApiRequest, Collection, Workspace } from '../../shared/types';
import { Icon, MethodTag } from './ui';

interface SidebarProps {
  workspace: Workspace | null;
  selectedId: string | null;
  port: number;
  onSelect: (req: ApiRequest) => void;
  onCreateRequest: (collectionId: string) => void;
  onCreateCollection: () => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCollection: (id: string) => void;
  onRenameCollection: (collection: Collection) => void;
  onExport: (collection: Collection) => void;
  onOpenMcp: () => void;
}

function groupRequests(requests: ApiRequest[]): { folder: string; items: ApiRequest[] }[] {
  const map = new Map<string, ApiRequest[]>();
  for (const req of requests) {
    const key = req.folder || '';
    const list = map.get(key) ?? [];
    list.push(req);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])))
    .map(([folder, items]) => ({ folder, items }));
}

export default function Sidebar(props: SidebarProps) {
  const { workspace, selectedId, port } = props;
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const collections = workspace?.collections ?? [];
  const requests = workspace?.requests ?? [];
  const q = query.trim().toLowerCase();

  const filtered = React.useMemo(() => {
    if (!q) return { collections, requests };
    const matchRequests = requests.filter((r) =>
      `${r.name} ${r.url} ${r.method} ${r.folder}`.toLowerCase().includes(q),
    );
    const ids = new Set(matchRequests.map((r) => r.collectionId));
    return {
      collections: collections.filter((c) => ids.has(c.id) || c.name.toLowerCase().includes(q)),
      requests: matchRequests,
    };
  }, [collections, requests, q]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="search">
          <Icon name="search" size={13} />
          <input
            placeholder="搜索集合、接口"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          {query && (
            <button className="icon-btn" onClick={() => setQuery('')} title="清空">
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <button className="chip-button" onClick={props.onCreateCollection}>
          <Icon name="plus" size={13} />
          新建集合
        </button>
      </div>

      <div className="user-row">
        <div className="user-avatar">个</div>
        <span style={{ flex: 1 }}>个人工作区</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
          {workspace ? `${collections.length} 个集合` : ''}
        </span>
      </div>

      <div className="sidebar-section">
        <span>集合</span>
        <button className="icon-btn" onClick={props.onCreateCollection} title="新建集合">
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="tree">
        {!workspace && <div className="empty-hint">加载中…</div>}
        {workspace && !filtered.collections.length && (
          <div className="empty-hint">
            还没有集合
            <br />
            点击「新建集合」或从顶栏导入接口文档
          </div>
        )}
        {filtered.collections.map((collection) => {
          const items = filtered.requests.filter((r) => r.collectionId === collection.id);
          const isCollapsed = collapsed[collection.id] ?? false;
          const groups = groupRequests(items);
          return (
            <div className="collection" key={collection.id}>
              <div
                className="collection-row"
                onClick={() => setCollapsed((prev) => ({ ...prev, [collection.id]: !isCollapsed }))}
              >
                <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
                  <Icon name="chevron" size={11} />
                </span>
                <Icon name="folder" size={13} style={{ color: '#8f7bff' }} />
                <span className="name" title={collection.name}>
                  {collection.name}
                </span>
                <span className="count-pill">{items.length}</span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="在此集合新建请求"
                    onClick={() => props.onCreateRequest(collection.id)}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                  <button className="icon-btn" title="导出集合" onClick={() => props.onExport(collection)}>
                    <Icon name="download" size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    title="重命名"
                    onClick={() => props.onRenameCollection(collection)}
                  >
                    <Icon name="settings" size={12} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除集合"
                    onClick={() => props.onDeleteCollection(collection.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              </div>

              {!isCollapsed &&
                groups.map((group) => (
                  <div key={group.folder || '__root'}>
                    {group.folder && <div className="folder-label">{group.folder}</div>}
                    {group.items.map((req) => (
                      <div
                        key={req.id}
                        className={`request-row ${selectedId === req.id ? 'active' : ''}`}
                        onClick={() => props.onSelect(req)}
                        title={req.url}
                      >
                        <MethodTag method={req.method} mini />
                        <span className="name">{req.name}</span>
                        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="icon-btn danger"
                            title="删除请求"
                            onClick={() => props.onDeleteRequest(req.id)}
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              {!isCollapsed && !items.length && (
                <div className="folder-label" style={{ paddingLeft: 30 }}>
                  暂无接口
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <span className="status-dot" />
        <span className="foot-text" title={`本地 REST API: http://127.0.0.1:${port}`}>
          REST 127.0.0.1:{port}
        </span>
        <button className="icon-btn" title="MCP 接入说明" onClick={props.onOpenMcp}>
          <Icon name="robot" size={14} />
        </button>
      </div>
    </aside>
  );
}
