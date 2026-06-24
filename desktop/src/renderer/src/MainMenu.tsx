// MainMenu — a small popover menu surfaced from a single button in the
// topbar. Mirrors the Electron application menu so users on Windows /
// macOS / Linux without a visible menu bar can still find everything.
//
// Click-outside dismisses; Escape dismisses.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@noggin/ui';

export type DetailsLocation = 'right' | 'below';

export interface MainMenuProps {
  isOpen: boolean;
  hasNoggin: boolean;
  sidebarOpen: boolean;
  detailsLocation: DetailsLocation;
  onNew: () => void;
  onOpen: () => void;
  onClose: () => void;
  onToggleSidebar: () => void;
  onSetDetailsLocation: (loc: DetailsLocation) => void;
  onShortcuts: () => void;
  onAbout: () => void;
}

export function MainMenu(props: MainMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const dismiss = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      dismiss();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, dismiss]);

  const fire = (fn: () => void) => () => { dismiss(); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        className="iconbtn topbar-menu-btn"
        onClick={() => setOpen((v) => !v)}
        title="Main menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="menu" />
      </button>
      {open && (
        <div ref={menuRef} className="main-menu" role="menu">
          <button className="main-menu-item" onClick={fire(props.onNew)} role="menuitem">
            <Icon name="new-file" /> <span>New noggin…</span>
            <span className="main-menu-kbd">Ctrl+N</span>
          </button>
          <button className="main-menu-item" onClick={fire(props.onOpen)} role="menuitem">
            <Icon name="folder-opened" /> <span>Open noggin…</span>
            <span className="main-menu-kbd">Ctrl+O</span>
          </button>
          {props.isOpen && (
            <button className="main-menu-item" onClick={fire(props.onClose)} role="menuitem">
              <Icon name="close" /> <span>Close noggin</span>
              <span className="main-menu-kbd">Ctrl+W</span>
            </button>
          )}
          <div className="main-menu-sep" />
          <div className="main-menu-section">Layout</div>
          <button
            className="main-menu-item"
            onClick={fire(props.onToggleSidebar)}
            role="menuitemcheckbox"
            aria-checked={props.sidebarOpen}
          >
            <Icon name={props.sidebarOpen ? 'check' : 'blank'} />
            <span>Show noggins sidebar</span>
            <span className="main-menu-kbd">Ctrl+B</span>
          </button>
          <button
            className="main-menu-item"
            onClick={fire(() => props.onSetDetailsLocation('right'))}
            role="menuitemradio"
            aria-checked={props.detailsLocation === 'right'}
          >
            <Icon name={props.detailsLocation === 'right' ? 'circle-filled' : 'circle-outline'} />
            <span>Details on the right</span>
          </button>
          <button
            className="main-menu-item"
            onClick={fire(() => props.onSetDetailsLocation('below'))}
            role="menuitemradio"
            aria-checked={props.detailsLocation === 'below'}
          >
            <Icon name={props.detailsLocation === 'below' ? 'circle-filled' : 'circle-outline'} />
            <span>Details below the tree</span>
          </button>
          <div className="main-menu-sep" />
          <button className="main-menu-item" onClick={fire(props.onShortcuts)} role="menuitem">
            <Icon name="keyboard" /> <span>Keyboard shortcuts</span>
          </button>
          <button className="main-menu-item" onClick={fire(props.onAbout)} role="menuitem">
            <Icon name="info" /> <span>About noggin</span>
          </button>
        </div>
      )}
    </>
  );
}
