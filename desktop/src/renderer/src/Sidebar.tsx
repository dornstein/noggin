// Sidebar: recent noggins. Pure renderer state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@noggin/ui';
import type { RecentEntry } from './recents';

export function Sidebar({
  openLocation,
  recents,
  onSwitch,
  onRemove,
  onNew,
  onOpen,
}: {
  openLocation: string | null;
  recents: RecentEntry[];
  onSwitch: (location: string) => void;
  onRemove: (location: string) => void;
  onNew: () => void;
  onOpen: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addBtnRef.current?.contains(e.target as Node)) return;
      if (addMenuRef.current?.contains(e.target as Node)) return;
      setAddOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [addOpen]);

  const handleRemove = useCallback((location: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(location);
  }, [onRemove]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span>Noggins</span>
        <div className="sidebar-add-wrap">
          <button
            ref={addBtnRef}
            className="iconbtn"
            onClick={() => setAddOpen((v) => !v)}
            title="Add a noggin"
            aria-haspopup="menu"
            aria-expanded={addOpen}
          >
            <Icon name="add" />
          </button>
          {addOpen && (
            <div ref={addMenuRef} className="main-menu sidebar-add-menu" role="menu">
              <button
                className="main-menu-item"
                role="menuitem"
                onClick={() => { setAddOpen(false); onNew(); }}
              >
                <Icon name="new-file" /> <span>New noggin…</span>
              </button>
              <button
                className="main-menu-item"
                role="menuitem"
                onClick={() => { setAddOpen(false); onOpen(); }}
              >
                <Icon name="folder-opened" /> <span>Open existing noggin…</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <ul className="recents">
        {recents.length === 0 && (
          <li className="recents-empty">
            No recent noggins.
            <br />
            Click <strong>+</strong> to add one.
          </li>
        )}
        {recents.map((r) => {
          const isOpen = r.location === openLocation;
          const hasActive = !!r.activePath;
          return (
            <li
              key={r.location}
              className={`recent${isOpen ? ' open' : ''}${!r.exists ? ' missing' : ''}${hasActive ? ' has-active' : ''}`}
              onClick={() => onSwitch(r.location)}
              title={r.exists ? r.location : `${r.location} (file missing)`}
            >
              <div className="recent-row">
                <Icon
                  name={isOpen ? 'circle-large-filled' : (r.exists ? 'circle-outline' : 'warning')}
                  className="recent-dot"
                />
                <span className="recent-label">{r.label}</span>
                {!isOpen && <span className="recent-meta">{relativeTime(r.lastOpenedAt)}</span>}
                <button
                  className="iconbtn recent-remove"
                  onClick={(e) => handleRemove(r.location, e)}
                  title="Remove from list"
                  aria-label="Remove from recents"
                >
                  <Icon name="close" />
                </button>
              </div>
              {hasActive && (
                <div className="recent-active" title={`Active: ${r.activeTitle || '(untitled)'} (${r.activePath})`}>
                  <span className="recent-active-path">{r.activePath}</span>
                  <span className="recent-active-title">{r.activeTitle || '(untitled)'}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return ''; }
}
