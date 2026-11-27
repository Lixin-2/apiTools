import React from 'react';
import { createPortal } from 'react-dom';
import { HttpMethod } from '../../shared/types';

const icons: Record<string, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V5h5v2" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
    </>
  ),
  send: <path d="M4.5 12 20 4.5 13.5 20l-2.2-6.3L4.5 12Z" />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V9" />
      <path d="m7.5 13.5 4.5-4.5 4.5 4.5" />
      <path d="M5 5h14" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  folder: <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v6.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />,
  'folder-plus': (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v6.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M12 11.5v5M9.5 14h5" />
    </>
  ),
  'folder-collection': (
    <>
      <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h3l2 2.3h5.5a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-10Z" />
      <path d="M8 12.5h6M8 15.5h4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </>
  ),
  robot: (
    <>
      <rect x="4" y="7.5" width="16" height="11" rx="3" />
      <path d="M12 4v3.5" />
      <circle cx="9" cy="13" r="1.2" />
      <circle cx="15" cy="13" r="1.2" />
      <path d="M9.5 16.5h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4.5 9.5h15M4.5 14.5h15" />
      <path d="M12 4c2.2 2.4 3.2 5.2 3.2 8s-1 5.6-3.2 8c-2.2-2.4-3.2-5.2-3.2-8s1-5.6 3.2-8Z" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M20 4.5V10h-5.5" />
    </>
  ),
  spark: <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9 12 3.5Z" />,
  terminal: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m7.5 10 2.5 2-2.5 2M12.5 14h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 13.5A8 8 0 0 1 10.5 4a8.2 8.2 0 1 0 9.5 9.5Z" />,
  github: (
    <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.8.8.1-.6.4-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.6 1a9 9 0 0 1 4.7 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.6.6.6 1 1.5 1 2.5 0 3.6-2.2 4.4-4.3 4.6.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z" />
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.2" />
      <path d="M11.2 12H20M17 12v3M14.5 12v2.2" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8 4.5-8 4.5-8-4.5L12 4Z" />
      <path d="m4 12.5 8 4.5 8-4.5" />
      <path d="m4 16.5 8 4.5 8-4.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 14,
  style,
}: {
  name: keyof typeof icons | string;
  size?: number;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {icons[name] ?? icons.spark}
    </svg>
  );
}

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#22c55e',
  POST: '#eab308',
  PUT: '#3b82f6',
  PATCH: '#a855f7',
  DELETE: '#ef4444',
  HEAD: '#14b8a6',
  OPTIONS: '#f97316',
};

export function MethodTag({ method, mini }: { method: HttpMethod; mini?: boolean }) {
  const color = METHOD_COLORS[method] ?? '#9a9aab';
  return (
    <span
      className={mini ? 'method-mini' : 'method-badge'}
      style={
        mini
          ? { color }
          : {
              color,
              background: `color-mix(in srgb, ${color} 16%, transparent)`,
              padding: '3px 8px',
              borderRadius: 6,
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              fontWeight: 700,
            }
      }
    >
      {method}
    </span>
  );
}

/* ---------------------------------- select --------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
  hint?: string;
}

export function Select({
  value,
  options,
  onChange,
  size = 'md',
  color,
  className = '',
  align = 'left',
  menuWidth,
  style,
  icon,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  color?: string;
  className?: string;
  align?: 'left' | 'right';
  menuWidth?: number;
  style?: React.CSSProperties;
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.bottom + 5, width: rect.width });
    setOpen(true);
  };

  // 菜单渲染后做一次边界夹紧，避免超出窗口右侧/底部
  React.useLayoutEffect(() => {
    if (!open || !anchor || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const margin = 10;
    let left = anchor.left;
    if (left + menuRect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - menuRect.width);
    }
    let top = anchor.top;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = Math.max(margin, anchor.top - menuRect.height - 34);
    }
    if (Math.abs(left - anchor.left) > 0.5 || Math.abs(top - anchor.top) > 0.5) {
      setAnchor({ ...anchor, left, top });
    }
  }, [open, anchor]);

  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const current = options.find((option) => option.value === value);

  return (
    <div className={`select size-${size} ${open ? 'open' : ''} ${className}`} ref={rootRef} style={style}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        style={color ? { color } : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {icon && <span className="select-icon">{icon}</span>}
        <span className="select-value">{current?.label ?? value}</span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="select-menu portal"
            style={{
              minWidth: menuWidth ?? Math.max(anchor.width, 150),
              maxWidth: 340,
              top: anchor.top,
              left: anchor.left,
            }}
            role="listbox"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`select-option ${option.value === value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={option.color ? { color: option.color } : undefined}
              >
                <span>{option.label}</span>
                {option.value === value && <Icon name="check" size={12} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** 品牌标记：与新应用图标一致，随主题自动切换底色 */
export function AppMark({ size = 22 }: { size?: number }) {
  const gradientId = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="app-mark" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="17" y1="47" x2="47" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" className="app-mark-bg" />
      <path
        d="M17 47c0-14 30-12 30-30"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="17" cy="47" r="7.5" className="app-mark-node" />
      <circle cx="17" cy="47" r="2.9" fill="#7c5cff" />
      <circle cx="47" cy="17" r="7.5" className="app-mark-node" />
      <circle cx="47" cy="17" r="2.9" fill="#22d3ee" />
    </svg>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function CopyButton({ value, label = '复制', onDone }: { value: string; label?: string; onDone?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      className="icon-btn"
      title={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        onDone?.();
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
    </button>
  );
}

export function formatBytes(size: number): string {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}
