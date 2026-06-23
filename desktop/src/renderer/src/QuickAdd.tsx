// Footer: quick-add input. Enter = push (create as child of active +
// become it). Ctrl+Enter = add (create as child of active but don't
// move active). When there's an active item, a "pop" button surfaces.

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface QuickAddProps {
  hasActive: boolean;
  onPush: (title: string) => void;
  onAdd: (title: string) => void;
  onPop: () => void;
}

export function QuickAdd({ hasActive, onPush, onAdd, onPop }: QuickAddProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const push = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    onPush(t);
    setDraft('');
    inputRef.current?.focus();
  }, [draft, onPush]);

  const add = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft('');
    inputRef.current?.focus();
  }, [draft, onAdd]);

  return (
    <form
      className="quickadd"
      onSubmit={(e) => { e.preventDefault(); push(); }}
    >
      <Icon name="add" className="quickadd-icon" />
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Push a side-quest…   (Enter = push · Ctrl+Enter = add)"
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            add();
          }
        }}
      />
      <button
        type="submit"
        className="primary"
        disabled={!draft.trim()}
        title="Push as child of active and become it (Enter)"
      >
        Push
      </button>
      <button
        type="button"
        onClick={add}
        disabled={!draft.trim()}
        title="Add as child of active without changing focus (Ctrl+Enter)"
      >
        Add
      </button>
      {hasActive && (
        <button
          type="button"
          className="quickadd-pop"
          onClick={onPop}
          title="Mark active done and surface to parent (pop)"
        >
          <Icon name="check" /> Pop
        </button>
      )}
    </form>
  );
}
