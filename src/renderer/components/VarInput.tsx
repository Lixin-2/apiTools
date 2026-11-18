import React from 'react';
import { createPortal } from 'react-dom';
import { KeyValue } from '../../shared/types';
import { Icon } from './ui';

interface Props {
  value: string;
  onChange: (value: string) => void;
  variables: KeyValue[];
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  multiline?: boolean;
  spellCheck?: boolean;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/**
 * 支持 {{变量}} 自动补全的输入框。
 * 输入 "{{" 后弹出候选，可用 ↑↓ 选择、Enter/Tab 插入、Esc 关闭。
 */
export default function VarInput({
  value,
  onChange,
  variables,
  placeholder,
  className,
  style,
  multiline,
  spellCheck = false,
  onKeyDown,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<KeyValue[]>([]);
  const [active, setActive] = React.useState(0);
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(null);
  const [triggerAt, setTriggerAt] = React.useState<number>(-1);

  const close = React.useCallback(() => {
    setOpen(false);
    setTriggerAt(-1);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !inputRef.current?.contains(target)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  const refresh = React.useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement, text: string) => {
      const caret = element.selectionStart ?? text.length;
      const before = text.slice(0, caret);
      const index = before.lastIndexOf('{{');
      if (index === -1) return close();
      const tail = before.slice(index + 2);
      if (tail.includes('}}') || /[\s\n{}]/.test(tail)) return close();

      const prefix = tail.toLowerCase();
      const matched = variables.filter(
        (variable) => variable.enabled && variable.key && variable.key.toLowerCase().includes(prefix),
      );
      if (!matched.length) return close();

      const rect = element.getBoundingClientRect();
      setItems(matched);
      setActive(0);
      setTriggerAt(index);
      setAnchor({ left: rect.left, top: rect.bottom + 4 });
      setOpen(true);
    },
    [variables, close],
  );

  const insert = (key: string) => {
    const element = inputRef.current;
    if (!element || triggerAt < 0) return;
    const caret = element.selectionStart ?? value.length;
    const next = `${value.slice(0, triggerAt)}{{${key}}}${value.slice(caret)}`;
    onChange(next);
    close();
    const position = triggerAt + key.length + 4;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (open && items.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((prev) => (prev + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((prev) => (prev - 1 + items.length) % items.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insert(items[active].key);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
    }
    onKeyDown?.(event);
  };

  const common = {
    ref: inputRef as any,
    value,
    placeholder,
    spellCheck,
    className,
    style,
    onKeyDown: handleKeyDown,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
      refresh(event.target as HTMLInputElement, event.target.value);
    },
    onClick: (event: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      refresh(event.currentTarget, event.currentTarget.value),
  };

  return (
    <>
      {multiline ? <textarea {...common} /> : <input type="text" {...common} />}
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="var-suggest"
            style={{
              left: Math.min(anchor.left, Math.max(10, window.innerWidth - 300)),
              top: Math.min(anchor.top, window.innerHeight - 220),
            }}
          >
            <div className="var-suggest-head">
              <Icon name="key" size={11} />
              环境变量
            </div>
            {items.slice(0, 8).map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`var-suggest-item ${index === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insert(item.key);
                }}
              >
                <code>{`{{${item.key}}}`}</code>
                <span>{item.value || '（空）'}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
