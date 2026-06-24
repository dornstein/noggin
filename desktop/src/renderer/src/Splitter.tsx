// Draggable splitter. Pure presentational + drag tracking;
// owner state (width/height) is held by the parent.

import { useCallback } from 'react';

export interface SplitterProps {
  /** 'vertical' = thin vertical bar that resizes horizontally. */
  orientation: 'vertical' | 'horizontal';
  /** Called with the delta in px each mousemove. Positive = drag right/down. */
  onResize: (deltaPx: number) => void;
  /** Optional double-click reset. */
  onReset?: () => void;
}

export function Splitter({ orientation, onResize, onReset }: SplitterProps) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let last = orientation === 'vertical' ? e.clientX : e.clientY;
    const onMove = (ev: MouseEvent) => {
      const pos = orientation === 'vertical' ? ev.clientX : ev.clientY;
      const delta = pos - last;
      if (delta !== 0) {
        onResize(delta);
        last = pos;
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  }, [orientation, onResize]);

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      title={onReset ? 'Drag to resize · Double-click to reset' : 'Drag to resize'}
    />
  );
}
