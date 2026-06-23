// Sidebar: list of recently-opened noggins, with the currently-open
// one highlighted. Click to switch. + to open a new file via the OS
// dialog. × on a row removes it from the list (does not delete the
// file). Collapsible via the chevron in the App's top-bar.

import { useCallback, useEffect, useState } from 'react';
import { noggin } from './api';
import type { RecentEntry } from '@shared/ipc';
import { Icon } from './Icon';

export function Sidebar({
  openLocation,
  onError,
}: {
  openLocation: string | null;
  onError: (msg: string) => void;
}) {
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  const refresh = useCallback(async () => {
    const r = await noggin.recents.list();
    if (r.ok) setRecents(r.data);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, openLocation]);

  const onOpenFile = useCallback(async () => {
    const picked = await noggin.recents.pickFile();
    if (!picked.ok) { onError(picked.error.message); return; }
    if (!picked.data) return; // user cancelled
    const opened = await noggin.open(picked.data);
    if (!opened.ok) onError(opened.error.message);
    refresh();
  }, [onError, refresh]);

  const onSwitch = useCallback(async (location: string) => {
    if (location === openLocation) return;
    const r = await noggin.open(location);
    if (!r.ok) onError(r.error.message);
    refresh();
  }, [openLocation, onError, refresh]);

  const onRemove = useCallback(async (location: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const r = await noggin.recents.remove(location);
    if (!r.ok) onError(r.error.message);
    refresh();
  }, [onError, refresh]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">NOGGINS</span>
        <button className="iconbtn" onClick={onOpenFile} title="Open noggin… (Ctrl+O)">
          <Icon name="add" />
        </button>
      </div>

      <ul className="recents">
        {recents.length === 0 && (
          <li className="recents-empty">No recent noggins. Click + to open one.</li>
        )}
        {recents.map((r) => {
          const isOpen = r.location === openLocation;
          return (
            <li
              key={r.location}
              className={`recent${isOpen ? ' open' : ''}${!r.exists ? ' missing' : ''}`}
              onClick={() => onSwitch(r.location)}
              title={r.exists ? r.location : `${r.location} (missing)`}
            >
              <Icon
                name={isOpen ? 'circle-filled' : (r.exists ? 'circle-outline' : 'warning')}
                className="recent-dot"
              />
              <span className="recent-label">{r.label}</span>
              <button
                className="iconbtn recent-remove"
                onClick={(e) => onRemove(r.location, e)}
                title="Remove from list"
              >
                <Icon name="close" />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
