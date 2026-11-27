import React from 'react';
import { Modal } from './Dialogs';
import { Icon } from './ui';

export type UpdateState =
  | { status: 'checking' }
  | { status: 'latest'; current: string }
  | { status: 'available'; version: string; current: string; notes: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

interface Release {
  tag: string;
  publishedAt: string;
  url: string;
  body?: string;
}

const REPO = 'Lixin-2/apiTools';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 极简 markdown：只处理标题、列表、粗体、行内代码和链接，够渲染 release notes */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) {
      nodes.push(<b key={key}>{token.slice(2, -2)}</b>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const label = token.slice(1, token.indexOf(']'));
      const href = token.slice(token.indexOf('(') + 1, -1);
      nodes.push(
        <a key={key} href={href} onClick={(event) => event.preventDefault()}>
          {label}
        </a>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(text?: string) {
  if (!text || !text.trim()) return null;
  const blocks: React.ReactNode[] = [];
  let items: React.ReactNode[] = [];
  let blockIndex = 0;

  const flush = () => {
    if (!items.length) return;
    blocks.push(<ul key={`ul-${blockIndex++}`}>{items}</ul>);
    items = [];
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^#{2,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push(<h4 key={`h-${blockIndex++}`}>{renderInline(heading[1], `h${blockIndex}`)}</h4>);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      items.push(<li key={`li-${blockIndex++}`}>{renderInline(bullet[1], `l${blockIndex}`)}</li>);
      continue;
    }
    flush();
    blocks.push(<p key={`p-${blockIndex++}`}>{renderInline(trimmed, `p${blockIndex}`)}</p>);
  }
  flush();
  return blocks;
}

/** 更新中心：当前版本状态 + 历史版本（可展开查看更新说明） */
export default function UpdateCenter({
  currentVersion,
  state,
  onCheck,
  onInstall,
  onClose,
}: {
  currentVersion: string;
  state: UpdateState;
  onCheck: () => void;
  onInstall: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState<'app' | 'changelog'>('app');
  const [releases, setReleases] = React.useState<Release[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const autoLoadedRef = React.useRef(false);

  const loadReleases = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await window.api.fetchReleases();
      setReleases(list);
      // 默认展开最新一个
      if (list[0]?.tag) setExpanded(new Set([list[0].tag]));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (tab === 'changelog' && !autoLoadedRef.current) {
      autoLoadedRef.current = true;
      void loadReleases();
    }
  }, [tab, loadReleases]);

  const toggle = (tag: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const downloadPage = `https://github.com/${REPO}/releases`;

  return (
    <Modal
      title="更新中心"
      onClose={onClose}
      width={680}
      footer={
        <>
          <button className="chip-button" onClick={() => window.api.openUrl(downloadPage)}>
            <Icon name="github" size={13} />
            打开下载页
          </button>
          <span className="spacer" />
          <button className="chip-button" onClick={onClose}>
            关闭
          </button>
          {state.status === 'available' && (
            <button className="chip-button primary" onClick={onInstall}>
              更新到 {state.version}
            </button>
          )}
        </>
      }
    >
      <div className="update-tabs">
        <button className={tab === 'app' ? 'active' : ''} onClick={() => setTab('app')}>
          apiTools
        </button>
        <button className={tab === 'changelog' ? 'active' : ''} onClick={() => setTab('changelog')}>
          更新日志
        </button>
      </div>

      {tab === 'app' ? (
        <div className="update-panel">
          {state.status === 'checking' && (
            <p className="update-line">
              正在检查最新版本… <span className="update-spinner" />
            </p>
          )}

          {state.status === 'latest' && (
            <p className="update-line">
              apiTools 已是最新版本（{currentVersion}）。
              <button className="link-btn" onClick={onCheck}>
                重新检查
              </button>
            </p>
          )}

          {state.status === 'available' && (
            <>
              <p className="update-line">
                发现新版本 <b>{state.version}</b>，当前为 {state.current}。
              </p>
              {state.notes && <pre className="update-notes">{state.notes}</pre>}
            </>
          )}

          {state.status === 'downloading' && (
            <>
              <p className="update-line">
                正在下载 {state.version} · {state.percent}%
              </p>
              <div className="update-bar">
                <span style={{ width: `${state.percent}%` }} />
              </div>
              <p className="help">下载完成后会自动重启应用。</p>
            </>
          )}

          {state.status === 'ready' && <p className="update-line">安装完成，应用即将重启…</p>}

          {state.status === 'error' && (
            <>
              <p className="update-line danger">检查更新失败</p>
              <div className="result-box" style={{ color: 'var(--danger)' }}>
                {state.message}
              </div>
              <button className="chip-button" onClick={onCheck}>
                重试
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="update-changelog">
          <div className="changelog-head">
            <div>
              <div className="changelog-title">更新日志</div>
              <div className="changelog-sub">查看各版本的更新内容。</div>
            </div>
            <div className="changelog-actions">
              <button
                className="chip-button"
                onClick={() => {
                  setTab('app');
                  onCheck();
                }}
              >
                <Icon name="cloudDownload" size={13} />
                检查更新
              </button>
              <button className="chip-button" onClick={() => window.api.openUrl(downloadPage)}>
                <Icon name="externalLink" size={13} />
                在官网查看
              </button>
            </div>
          </div>
          <p className="help" style={{ marginBottom: 10 }}>
            回退到旧版本前请先备份数据，旧版本可能无法读取新版本创建的数据。
          </p>

          {loading && (
            <p className="update-line">
              正在加载版本列表… <span className="update-spinner" />
            </p>
          )}

          {error && (
            <p className="help" style={{ color: 'var(--danger)' }}>
              加载失败：{error}。可以点左下角「打开下载页」在浏览器里查看全部版本。
            </p>
          )}

          {releases && releases.length > 0 && (
            <div className="release-list">
              {releases.map((item, index) => {
                const open = expanded.has(item.tag);
                return (
                  <div className="release-card" key={item.tag}>
                    <button
                      className={`release-head ${open ? 'open' : ''}`}
                      onClick={() => toggle(item.tag)}
                    >
                      <span className="release-tag">
                        <Icon name="tag" size={12} />
                        <b>{item.tag}</b>
                        {index === 0 && <span className="release-new">NEW</span>}
                      </span>
                      <span className="release-date">
                        {item.publishedAt ? `发布于 ${formatDate(item.publishedAt)}` : ''}
                      </span>
                      <span className={`release-chevron ${open ? 'open' : ''}`}>
                        <Icon name="chevron" size={13} />
                      </span>
                    </button>
                    {open && (
                      <div className="release-body">
                        {item.body && item.body.trim() ? (
                          renderMarkdown(item.body)
                        ) : (
                          <p className="help">这个版本没有内置更新说明，可以点下方链接到 GitHub 查看。</p>
                        )}
                        <button
                          className="release-link"
                          onClick={() => window.api.openUrl(item.url)}
                        >
                          <Icon name="externalLink" size={12} />
                          GitHub Release
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {releases && releases.length === 0 && !loading && (
            <p className="help">还没有已发布的版本。</p>
          )}
        </div>
      )}
    </Modal>
  );
}
