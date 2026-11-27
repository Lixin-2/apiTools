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
  name: string;
  publishedAt: string;
  url: string;
}

const REPO = 'Lixin-2/apiTools';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** 更新中心：当前版本状态 + 历史版本（数据来自 GitHub Releases） */
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

  const loadReleases = React.useCallback(async () => {
    setLoading(true);
    setError('');
    // GitHub API 在国内可能很慢，12 秒没响应就放弃，让用户走下载页
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      // 优先读 release 里自带的版本列表（GitHub CDN，快且不限流）
      const bundled = await fetch(
        `https://github.com/${REPO}/releases/latest/download/releases.json`,
        { signal: controller.signal },
      );
      if (bundled.ok) {
        const list = await bundled.json();
        if (Array.isArray(list) && list.length) {
          setReleases(
            list.map((item: any) => ({
              tag: item.tag ?? '',
              name: item.tag ?? '',
              publishedAt: item.publishedAt ?? '',
              url: item.url ?? '',
            })),
          );
          return;
        }
      }
      // 回退到 GitHub API（版本列表还没随 release 生成时的过渡方案）
      const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setReleases(
        (Array.isArray(data) ? data : []).map((item: any) => ({
          tag: item.tag_name,
          name: item.name || item.tag_name,
          publishedAt: item.published_at ?? '',
          url: item.html_url,
        })),
      );
    } catch (err: any) {
      setError(
        err?.name === 'AbortError'
          ? '请求超时（12 秒），当前网络可能无法访问 GitHub'
          : (err?.message ?? String(err)),
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (tab === 'changelog' && !releases && !loading) void loadReleases();
  }, [tab, releases, loading, loadReleases]);

  const downloadPage = `https://github.com/${REPO}/releases`;

  return (
    <Modal
      title="更新中心"
      onClose={onClose}
      width={640}
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

          {state.status === 'ready' && (
            <p className="update-line">安装完成，应用即将重启…</p>
          )}

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
          <div className="update-changelog-head">
            <span className="update-changelog-title">历史版本</span>
            <button className="link-btn" onClick={loadReleases}>
              刷新
            </button>
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
              {releases.map((item) => (
                <div className="release-row" key={item.tag}>
                  <b>{item.tag}</b>
                  <span className="release-date">
                    {item.publishedAt ? `发布于 ${formatDate(item.publishedAt)}` : ''}
                  </span>
                  <button
                    className="chip-button"
                    onClick={() => window.api.openUrl(item.url)}
                    title="在浏览器中打开该版本的发布页"
                  >
                    打开下载页
                  </button>
                </div>
              ))}
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
