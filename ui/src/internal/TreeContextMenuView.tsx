// Default renderer for the tree's context menu. Internal: NogginTree
// and NogginDetails embed it, hosts never import it. If a host wants a
// platform-native menu (e.g. VS Code), it passes `renderContextMenu` to
// the surrounding component and gets the same entries — see
// `TreeContextMenuRenderProps` in `../types.ts`.

import { useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import { cn } from '../cn';
import type { TreeContextMenuRenderProps } from '../types';

export function TreeContextMenuView({ position, entries, onClose }: TreeContextMenuRenderProps) {
  const ref = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
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
  }, [onClose]);

  // Clamp to viewport so the menu doesn't render off-screen.
  const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight;
  const estimatedW = 220;
  const estimatedH = entries.length * 26 + 8;
  const left = Math.min(position.x, viewportW - estimatedW - 8);
  const top = Math.min(position.y, viewportH - estimatedH - 8);

  return (
    <ul className="ctx-menu" ref={ref} role="menu" style={{ left, top }}>
      {entries.map((entry) => {
        if (entry.kind === 'separator') {
          return <li key={entry.key} className="ctx-sep" role="separator" />;
        }
        return (
          <li
            key={entry.key}
            className={cn('ctx-item', entry.danger && 'danger', entry.disabled && 'disabled')}
            role="menuitem"
            onClick={() => {
              if (entry.disabled) return;
              entry.onClick();
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
