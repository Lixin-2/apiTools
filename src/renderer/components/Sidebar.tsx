import React from 'react';
import { ApiRequest, Collection, Workspace } from '../../shared/types';
import { Icon, MethodTag, Select } from './ui';

interface SidebarProps {
  workspace: Workspace | null;
  selectedId: string | null;
  port: number;
  onSelect: (req: ApiRequest) => void;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: () => void;
  onFolderSettings: (collection: Collection, folder: string) => void;
  onCreateRequest: (collectionId: string, folder?: string) => void;
  onCreateCollection: () => void;
  onCreateFolder: (collection: Collection) => void;
  onRenameFolder: (collection: Collection, folder: string) => void;
  onDeleteFolder: (collection: Collection, folder: string) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCollection: (id: string) => void;
  onRenameCollection: (collection: Collection) => void;
  onExport: (collection: Collection) => void;
  onOpenMcp: () => void;
}

interface FolderGroup {
  name: string;
  items: ApiRequest[];
}

function folderVarCount(collection: Collection, folder: string): number {
  const config = (collection.folderVars ?? []).find((item) => item.name === folder);
  if (!config) return 0;
  return (
    config.variables.filter((variable) => variable.key).length +
    config.headers.filter((header) => header.key).length
  );
}

function buildFolders(collection: Collection, requests: ApiRequest[]): FolderGroup[] {
  const names: string[] = [...(collection.folders ?? [])];
  for (const request of requests) {
    if (request.folder && !names.includes(request.folder)) names.push(request.folder);
  }
  return names.map((name) => ({
    name,
    items: requests.filter((r) => r.folder === name),
  }));
}

export default function Sidebar(props: SidebarProps) {
  const { workspace, selectedId, port } = props;
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = React.useState<Record<string, boolean>>({});

  const collections = workspace?.collections ?? [];
  const requests = workspace?.requests ?? [];
  const q = query.trim().toLowerCase();

  const visible = React.useMemo(() => {
    if (!q) return { collections, requests };
    const matched = requests.filter((r) =>
      `${r.name} ${r.url} ${r.method} ${r.folder}`.toLowerCase().includes(q),
    );
    const folderHit = (c: Collection) => (c.folders ?? []).some((f) => f.toLowerCase().includes(q));
    const ids = new Set(matched.map((r) => r.collectionId));
    return {
      collections: collections.filter((c) => ids.has(c.id) || folderHit(c) || c.name.toLowerCase().includes(q)),
      requests: matched,
    };
  }, [collections, requests, q]);

  const toggleCollection = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  const toggleFolder = (key: string) =>
    setCollapsedFolders((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));

  const renderRequest = (req: ApiRequest, inFolder: boolean) => (
    <div
      key={req.id}
      className={`request-row ${inFolder ? 'nested' : ''} ${selectedId === req.id ? 'active' : ''}`}
      onClick={() => props.onSelect(req)}
      title={req.url}
    >
      <MethodTag method={req.method} mini />
      <span className="name">{req.name}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn danger" title="删除请求" onClick={() => props.onDeleteRequest(req.id)}>
          <Icon name="trash" size={12} />
        </button>
      </span>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="search">
          <Icon name="search" size={13} />
          <input
            placeholder="搜索集合、目录、接口"
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

      <div className="project-bar">
        <Icon name="layers" size={14} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
        <Select
          value={workspace?.activeProjectId ?? ''}
          options={
            (workspace?.projects ?? []).map((project) => ({
              value: project.id,
              label: project.name,
            })) || []
          }
          onChange={props.onSelectProject}
          className="project-select"
          style={{ flex: 1, minWidth: 0 }}
          menuWidth={230}
        />
        <button className="icon-btn" title="新建项目" onClick={props.onCreateProject}>
          <Icon name="plus" size={13} />
        </button>
        <button
          className="icon-btn"
          title="重命名项目"
          onClick={() => workspace?.activeProjectId && props.onRenameProject(workspace.activeProjectId)}
        >
          <Icon name="edit" size={12} />
        </button>
        <button className="icon-btn danger" title="删除当前项目" onClick={props.onDeleteProject}>
          <Icon name="trash" size={13} />
        </button>
      </div>

      <div className="sidebar-section">
        <span>集合</span>
        <button className="icon-btn" onClick={props.onCreateCollection} title="新建集合">
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="tree">
        {!workspace && <div className="empty-hint">加载中…</div>}
        {workspace && !visible.collections.length && (
          <div className="empty-hint">
            还没有集合
            <br />
            点击「新建集合」或从顶栏导入接口文档
          </div>
        )}
        {visible.collections.map((collection) => {
          const items = visible.requests.filter((r) => r.collectionId === collection.id);
          const isCollapsed = collapsed[collection.id] ?? false;
          const folders = buildFolders(collection, items);
          const rootItems = items.filter((r) => !r.folder);

          return (
            <div className="collection" key={collection.id}>
              <div className="collection-row" onClick={() => toggleCollection(collection.id)}>
                <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
                  <Icon name="chevron" size={11} />
                </span>
                <Icon name="folder-collection" size={14} style={{ color: 'var(--accent)' }} />
                <span className="name" title={collection.name}>
                  {collection.name}
                </span>
                <span className="count-pill">{items.length}</span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    title="新建请求"
                    onClick={() => props.onCreateRequest(collection.id)}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    title="新建目录"
                    onClick={() => props.onCreateFolder(collection)}
                  >
                    <Icon name="folder-plus" size={13} />
                  </button>
                  <button className="icon-btn" title="导出集合" onClick={() => props.onExport(collection)}>
                    <Icon name="download" size={13} />
                  </button>
                  <button className="icon-btn" title="重命名集合" onClick={() => props.onRenameCollection(collection)}>
                    <Icon name="edit" size={12} />
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

              {!isCollapsed && (
                <>
                  {rootItems.map((req) => renderRequest(req, false))}

                  {folders.map((folder) => {
                    const key = `${collection.id}:${folder.name}`;
                    const folderCollapsed = collapsedFolders[key] ?? false;
                    return (
                      <div className="folder-block" key={key}>
                        <div className="folder-row" onClick={() => toggleFolder(key)}>
                          <span className={`chevron ${folderCollapsed ? '' : 'open'}`}>
                            <Icon name="chevron" size={10} />
                          </span>
                          <Icon name="folder" size={13} style={{ color: 'var(--text-faint)' }} />
                          <span className="name">{folder.name}</span>
                          {folderVarCount(collection, folder.name) > 0 && (
                            <span className="var-chip" title="该目录配置了变量/公共请求头">
                              <Icon name="key" size={9} />
                              {folderVarCount(collection, folder.name)}
                            </span>
                          )}
                          <span className="count-pill">{folder.items.length}</span>
                          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="icon-btn"
                              title="在目录中新建请求"
                              onClick={() => props.onCreateRequest(collection.id, folder.name)}
                            >
                              <Icon name="plus" size={12} />
                            </button>
                            <button
                              className="icon-btn"
                              title="目录变量与公共请求头"
                              onClick={() => props.onFolderSettings(collection, folder.name)}
                            >
                              <Icon name="key" size={12} />
                            </button>
                            <button
                              className="icon-btn"
                              title="重命名目录"
                              onClick={() => props.onRenameFolder(collection, folder.name)}
                            >
                              <Icon name="edit" size={11} />
                            </button>
                            <button
                              className="icon-btn danger"
                              title="删除目录（接口会移到集合根级）"
                              onClick={() => props.onDeleteFolder(collection, folder.name)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </span>
                        </div>
                        {!folderCollapsed &&
                          (folder.items.length ? (
                            folder.items.map((req) => renderRequest(req, true))
                          ) : (
                            <div className="folder-empty">空目录 · 点上方 + 新建请求</div>
                          ))}
                      </div>
                    );
                  })}

                  {!rootItems.length && !folders.length && (
                    <div className="folder-empty" style={{ paddingLeft: 30 }}>
                      暂无接口
                    </div>
                  )}
                </>
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
