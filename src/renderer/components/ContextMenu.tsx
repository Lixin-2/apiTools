import React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';

export interface MenuItem {
  label?: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = window.innerWidth - margin - rect.width;
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, y - rect.height);
    }
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [x, y]);

  React.useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="ctx-sep" />
        ) : (
          <button
            key={`item-${index}`}
            className={`ctx-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick?.();
            }}
          >
            <span className="ctx-icon">{item.icon ? <Icon name={item.icon} size={12} /> : null}</span>
            <span className="ctx-label">{item.label}</span>
            {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** 右键菜单：调用 open(event, items) 即可在鼠标位置弹出 */
export function useContextMenu() {
  const [state, setState] = React.useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const open = React.useCallback((event: React.MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    if (!items.length) return;
    setState({ x: event.clientX, y: event.clientY, items });
  }, []);

  const close = React.useCallback(() => setState(null), []);

  const node = state ? (
    <ContextMenu x={state.x} y={state.y} items={state.items} onClose={close} />
  ) : null;

  return { open, close, node };
}
