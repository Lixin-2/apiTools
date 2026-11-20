import React from 'react';
import { ApiRequest, Collection, Workspace } from '../../shared/types';
import { Icon, MethodTag, Select } from './ui';
import { useContextMenu } from './ContextMenu';

interface SidebarProps {
  workspace: Workspace | null;
  selectedId: string | null;
  port: number;
  onSelect: (req: ApiRequest) => void;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: () => void;
  onCreateRequest: (collectionId: string, folder?: string) => void;
  onCreateCollection: () => void;
  onCreateFolder: (collection: Collection, parentPath?: string) => void;
  onRenameFolder: (collection: Collection, folder: string) => void;
  onDeleteFolder: (collection: Collection, folder: string) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteCollection: (id: string) => void;
  onRenameCollection: (collection: Collection) => void;
  onExport: (collection: Collection) => void;
  onOpenMcp: () => void;
}

function toggleLabel(collapsed: boolean) {
  return collapsed ? '展开目录' : '折叠目录';
}

interface FolderNode {
  path: string;
  name: string;
  depth: number;
  children: FolderNode[];
  requests: ApiRequest[];
}

function buildTree(collection: Collection, requests: ApiRequest[]): FolderNode {
  const root: FolderNode = { path: '', name: '', depth: -1, children: [], requests: [] };
  const map = new Map<string, FolderNode>([['', root]]);

  const ensure = (path: string): FolderNode => {
    const found = map.get(path);
    if (found) return found;
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parent = ensure(parentPath);
    const node: FolderNode = {
      path,
      name,
      depth: segments.length - 1,
      children: [],
      requests: [],
    };
    parent.children.push(node);
    map.set(path, node);
    return node;
  };

  for (const folder of collection.folders ?? []) {
    if (folder.trim()) ensure(folder.trim());
  }
  for (const request of requests) {
    if (request.folder) ensure(request.folder).requests.push(request);
    else root.requests.push(request);
  }

  const sort = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root;
}

export default function Sidebar(props: SidebarProps) {
  const menu = useContextMenu();
  const { workspace, selectedId, port } = props;
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = React.useState<Record<string, boolean>>({});

  const collections = workspace?.collections ?? [];
  const requests = workspace?.requests ?? [];
  const q = query.trim().toLowerCase();

  const visible = React.useMemo(() => {
    if (!q) return { collections, requests };
    const matched = requests.filter((request) =>
      `${request.name} ${request.url} ${request.method} ${request.folder}`.toLowerCase().includes(q),
    );
    const folderHit = (collection: Collection) =>
      (collection.folders ?? []).some((folder) => folder.toLowerCase().includes(q));
    const ids = new Set(matched.map((request) => request.collectionId));
    return {
      collections: collections.filter(
        (collection) => ids.has(collection.id) || folderHit(collection) || collection.name.toLowerCase().includes(q),
      ),
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
          onContextMenu={(event) =>
            menu.open(event, [
              { label: '打开', icon: 'send', onClick: () => props.onSelect(req) },
              { label: '复制 URL', icon: 'copy', onClick: () => navigator.clipboard.writeText(req.url) },
              { label: '复制名称', icon: 'copy', onClick: () => navigator.clipboard.writeText(req.name) },
              { separator: true },
              { label: '删除请求', icon: 'trash', danger: true, onClick: () => props.onDeleteRequest(req.id) },
            ])
          }
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

  const renderFolder = (collection: Collection, node: FolderNode) => {
    const key = `${collection.id}:${node.path}`;
    const isCollapsed = collapsedFolders[key] ?? false;
    return (
      <div className="folder-block" key={key}>
        <div
          className="folder-row"
          style={{ paddingLeft: 14 + node.depth * 14 }}
          onClick={() => toggleFolder(key)}
          onContextMenu={(event) =>
            menu.open(event, [
              { label: '在此目录新建请求', icon: 'plus', onClick: () => props.onCreateRequest(collection.id, node.path) },
              { label: '新建子目录', icon: 'folder', onClick: () => props.onCreateFolder(collection, node.path) },
              { separator: true },
              { label: toggleLabel(isCollapsed), icon: 'chevron', onClick: () => toggleFolder(key) },
              { label: '重命名目录', icon: 'edit', onClick: () => props.onRenameFolder(collection, node.path) },
              { separator: true },
              { label: '删除目录', icon: 'trash', danger: true, onClick: () => props.onDeleteFolder(collection, node.path) },
            ])
          }
        >
          <span className={`chevron ${isCollapsed ? '' : 'open'}`}>
            <Icon name="chevron" size={10} />
          </span>
          <Icon name="folder" size={13} style={{ color: 'var(--text-faint)' }} />
          <span className="name" title={node.path}>
            {node.name}
          </span>
          <span className="count-pill">{node.requests.length}</span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-btn"
              title="在此目录新建请求"
              onClick={() => props.onCreateRequest(collection.id, node.path)}
            >
              <Icon name="plus" size={12} />
            </button>
            <button
              className="icon-btn"
              title="新建子目录"
              onClick={() => props.onCreateFolder(collection, node.path)}
            >
              <Icon name="folder-plus" size={12} />
            </button>
            <button
              className="icon-btn"
              title="重命名目录"
              onClick={() => props.onRenameFolder(collection, node.path)}
            >
              <Icon name="edit" size={11} />
            </button>
            <button
              className="icon-btn danger"
              title="删除目录（含子目录，接口会移到集合根级）"
              onClick={() => props.onDeleteFolder(collection, node.path)}
            >
              <Icon name="trash" size={12} />
            </button>
          </span>
        </div>
        {!isCollapsed && (
          <>
            {node.requests.map((req) => renderRequest(req, true))}
            {node.children.map((child) => renderFolder(collection, child))}
            {!node.requests.length && !node.children.length && <div className="folder-empty">空目录</div>}
          </>
        )}
      </div>
    );
  };

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
          options={(workspace?.projects ?? []).map((project) => ({
            value: project.id,
            label: project.name,
          }))}
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
          const items = visible.requests.filter((request) => request.collectionId === collection.id);
          const isCollapsed = collapsed[collection.id] ?? false;
          const tree = buildTree(collection, items);

          return (
            <div className="collection" key={collection.id}>
              <div
                className="collection-row"
                onClick={() => toggleCollection(collection.id)}
                onContextMenu={(event) =>
                  menu.open(event, [
                    { label: '新建请求', icon: 'plus', onClick: () => props.onCreateRequest(collection.id) },
                    { label: '新建目录', icon: 'folder', onClick: () => props.onCreateFolder(collection) },
                    { separator: true },
                    { label: '重命名集合', icon: 'edit', onClick: () => props.onRenameCollection(collection) },
                    { label: '导出集合', icon: 'download', onClick: () => props.onExport(collection) },
                    { separator: true },
                    { label: '删除集合', icon: 'trash', danger: true, onClick: () => props.onDeleteCollection(collection.id) },
                  ])
                }
              >
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
                  {tree.requests.map((req) => renderRequest(req, false))}
                  {tree.children.map((child) => renderFolder(collection, child))}
                  {!tree.requests.length && !tree.children.length && (
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
    {menu.node}
    </aside>
  );
}
