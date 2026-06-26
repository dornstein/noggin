// Markdown note editor with syntax highlighting (CodeMirror 6) and a
// live preview pane. The editor is structurally simple — a CodeMirror
// instance with the markdown language pack — and the host owns submit.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { renderMarkdown } from './markdown';
import { Icon } from './Icon';
import { cn } from './cn';

/**
 * @public
 * Optional class-name overrides for {@link NogginNoteEditor}.
 */
export interface NogginNoteEditorClassNames {
  /** Outer wrapper. */
  root?: string;
  /** The CodeMirror host element. */
  textarea?: string;
  /** The footer row with hint + buttons. */
  actions?: string;
}

export interface NogginNoteEditorProps {
  /** Initial markdown text. Defaults to empty. */
  initialValue?: string;
  placeholder?: string;
  /** Called when the user submits (Ctrl+Enter or the Submit button). */
  onSubmit: (text: string) => void;
  /** Called when the user discards. Host can collapse the editor etc. */
  onCancel?: () => void;
  /** Submit button label. Default 'Add note'. */
  submitLabel?: string;
  /** Auto-focus the editor on mount. Default true. */
  autoFocus?: boolean;
  /** Show the live preview pane to the right. Default true. */
  showPreview?: boolean;
  /** Per-slot class-name overrides. See {@link NogginNoteEditorClassNames}. */
  classNames?: NogginNoteEditorClassNames;
}

export function NogginNoteEditor({
  initialValue = '',
  placeholder = 'Write a note in markdown…',
  onSubmit,
  onCancel,
  submitLabel = 'Add note',
  autoFocus = true,
  showPreview = true,
  classNames,
}: NogginNoteEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [text, setText] = useState(initialValue);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const submit = () => {
      const v = viewRef.current?.state.doc.toString() ?? '';
      const t = v.trim();
      if (!t) return true;
      onSubmit(t);
      return true;
    };

    const cancel = () => {
      if (onCancel) onCancel();
      return true;
    };

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        highlightActiveLine(),
        drawSelection(),
        markdown(),
        EditorView.lineWrapping,
        keymap.of([
          { key: 'Mod-Enter', preventDefault: true, run: submit },
          { key: 'Escape', preventDefault: true, run: cancel },
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setText(u.state.doc.toString());
        }),
        EditorView.theme({
          '&': {
            backgroundColor: 'var(--noggin-input-bg, #3c3c3c)',
            color: 'var(--noggin-input-fg, #cccccc)',
            fontSize: 'var(--noggin-font-size, 13px)',
          },
          '.cm-content': {
            fontFamily: 'var(--noggin-font-family-mono, "Cascadia Code", Consolas, monospace)',
            padding: '6px 4px',
            caretColor: 'var(--noggin-focus-ring, #007acc)',
          },
          '.cm-line': { padding: '0 8px' },
          '.cm-cursor': { borderLeftColor: 'var(--noggin-focus-ring, #007acc)' },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            color: 'var(--noggin-input-fg-muted, #6b6b6b)',
            border: 'none',
          },
          '.cm-activeLine': { backgroundColor: 'transparent' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--noggin-input-fg-muted, #969696)' },
          '&.cm-focused': { outline: '1px solid var(--noggin-focus-ring, #007fd4)' },
          '&.cm-focused .cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--noggin-row-selected-bg, #094771)',
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (autoFocus) view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We deliberately do NOT include `initialValue` / `placeholder` in
    // deps — those are only honored on mount; otherwise typing would
    // reset the editor's selection on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(() => {
    const v = viewRef.current?.state.doc.toString() ?? '';
    const t = v.trim();
    if (!t) return;
    onSubmit(t);
  }, [onSubmit]);

  const isEmpty = !text.trim();

  return (
    <div className={cn('noggin-note-editor', classNames?.root)}>
      <div className={`noggin-note-editor-panes${showPreview ? ' has-preview' : ''}`}>
        <div className="noggin-note-editor-input">
          <div ref={hostRef} className={cn('cm-host', classNames?.textarea)} aria-label={placeholder} />
        </div>
        {showPreview && (
          <div className="noggin-note-editor-preview">
            <div className="noggin-note-editor-preview-label">Preview</div>
            <div
              className="noggin-note-preview-body markdown-body"
              dangerouslySetInnerHTML={{ __html: text.trim() ? renderMarkdown(text) : `<p class="noggin-preview-placeholder">${escapeHtml(placeholder)}</p>` }}
            />
          </div>
        )}
      </div>
      <div className={cn('noggin-note-editor-actions', classNames?.actions)}>
        <span className="noggin-note-editor-hint">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to submit · <kbd>Esc</kbd> to cancel
        </span>
        <div className="noggin-note-editor-buttons">
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="primary" onClick={submit} disabled={isEmpty}>
            <Icon name="add" /> {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
