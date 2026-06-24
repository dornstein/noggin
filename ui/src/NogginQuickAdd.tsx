// Footer: quick-add input. Two complementary gestures:
//   - Push (Enter): create a child of the active item and become it.
//     The natural "drop down a level" move.
//   - Add (Ctrl+Enter): create a sibling of the active item (immediately
//     after it). The natural "and another" move.
// When nothing is active, both fall through to "add at the end of the
// root list" — the host owns that detail.
// move active). When there's an active item, a "pop" button surfaces.

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';

export interface NogginQuickAddProps {
  hasActive: boolean;
  onPush: (title: string) => void;
  onAdd: (title: string) => void;
  onPop: () => void;
}

export function NogginQuickAdd({ hasActive, onPush, onAdd, onPop }: NogginQuickAddProps) {
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
        placeholder={hasActive
          ? 'Push a child…   (Enter = child  ·  Ctrl+Enter = sibling)'
          : 'Add an item…   (Enter or Ctrl+Enter)'}
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
        title={hasActive
          ? 'Push as a child of the active item and focus it  (Enter)'
          : 'Add at the end of the root list  (Enter)'}
      >
        {hasActive ? 'Push child' : 'Add'}
      </button>
      {hasActive && (
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          title="Add as a sibling immediately after the active item  (Ctrl+Enter)"
        >
          Add sibling
        </button>
      )}
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
