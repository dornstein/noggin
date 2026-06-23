// Reusable context-menu primitive. Render at root level with
// `<ContextMenu open={pos} onClose={...} items={[...]} />`. Closes on
// outside click, Escape, or when an item runs.

import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: string;
  /** Optional keyboard shortcut hint, e.g. 'Ctrl+Enter'. */
  shortcut?: string;
  /** Set true for a danger action; styled red. */
  danger?: boolean;
  /** Hide the entry entirely. */
  hidden?: boolean;
  /** Disable the entry (greys it out, blocks click). */
  disabled?: boolean;
  /** Action to run. */
  onClick: () => void;
}

export type ContextMenuEntry = ContextMenuItem | { separator: true };

export function ContextMenu({
  open,
  items,
  onClose,
}: {
  open: { x: number; y: number } | null;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Defer to avoid swallowing the click that opened the menu.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Clamp to viewport so the menu doesn't render off-screen.
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const estimatedW = 220;
  const estimatedH = items.length * 26 + 8;
  const left = Math.min(open.x, viewportW - estimatedW - 8);
  const top = Math.min(open.y, viewportH - estimatedH - 8);

  return (
    <ul
      className="ctx-menu"
      ref={ref}
      role="menu"
      style={{ left, top }}
    >
      {items.map((entry, i) => {
        if ('separator' in entry) {
          return <li key={`sep-${i}`} className="ctx-sep" role="separator" />;
        }
        if (entry.hidden) return null;
        return (
          <li
            key={entry.key}
            className={`ctx-item${entry.danger ? ' danger' : ''}${entry.disabled ? ' disabled' : ''}`}
            role="menuitem"
            onClick={() => {
              if (entry.disabled) return;
              entry.onClick();
              onClose();
            }}
          >
            <span className="ctx-icon">
              {entry.icon ? <Icon name={entry.icon} /> : null}
            </span>
            <span className="ctx-label">{entry.label}</span>
            {entry.shortcut && <span className="ctx-shortcut">{entry.shortcut}</span>}
          </li>
        );
      })}
    </ul>
  );
}
