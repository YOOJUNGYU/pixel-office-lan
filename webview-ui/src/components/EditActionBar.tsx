import type { useEditorActions } from '../hooks/useEditorActions.js';
import { t, useLang } from '../i18n.js';
import type { EditorState } from '../office/editor/editorState.js';
import { Button } from './ui/Button.js';

interface EditActionBarProps {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
  /** Save (and share) the layout and leave edit mode (unless the server refuses). */
  onSave: () => void;
  /** Confirm, then put the bundled default layout in the editor (an edit; [Save] keeps it). */
  onReset: () => void;
  /** Drop every edit, back to the saved layout, and leave edit mode. */
  onCancel: () => void;
}

/** Reset / Undo / Redo / Save / Cancel, beside the Layout button while the editor is open.
 *  Edits stay on this page until [Save]. */
export function EditActionBar({
  editor,
  editorState: es,
  onSave,
  onReset,
  onCancel,
}: EditActionBarProps) {
  useLang();

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div data-tour="edit-actions" className="flex gap-4 items-center pixel-panel p-4">
      <Button variant="default" onClick={onReset} title={t('edit.resetTitle')}>
        {t('edit.reset')}
      </Button>
      <Button
        variant={undoDisabled ? 'disabled' : 'default'}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title={t('edit.undoTitle')}
      >
        {t('edit.undo')}
      </Button>
      <Button
        variant={redoDisabled ? 'disabled' : 'default'}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title={t('edit.redoTitle')}
      >
        {t('edit.redo')}
      </Button>
      <Button variant="default" onClick={onSave} title={t('edit.saveTitle')}>
        {t('edit.save')}
      </Button>
      <Button variant="default" onClick={onCancel} title={t('edit.cancelTitle')}>
        {t('edit.cancel')}
      </Button>
    </div>
  );
}
