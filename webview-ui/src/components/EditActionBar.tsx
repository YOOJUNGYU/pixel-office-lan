import { useState } from 'react';

import type { useEditorActions } from '../hooks/useEditorActions.js';
import { t, useLang } from '../i18n.js';
import type { EditorState } from '../office/editor/editorState.js';
import { Button } from './ui/Button.js';

interface EditActionBarProps {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}

/** Undo / Redo / Save / Reset, beside the Layout button while the editor is open. */
export function EditActionBar({ editor, editorState: es }: EditActionBarProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  useLang();

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div data-tour="edit-actions" className="flex gap-4 items-center pixel-panel p-4">
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
      <Button variant="default" onClick={editor.handleSave} title={t('edit.saveTitle')}>
        {t('edit.save')}
      </Button>
      {!showResetConfirm ? (
        <Button
          variant="default"
          onClick={() => setShowResetConfirm(true)}
          title={t('edit.resetTitle')}
        >
          {t('edit.reset')}
        </Button>
      ) : (
        <div className="flex gap-4 items-center">
          <span className="text-base text-reset-text">{t('edit.resetConfirm')}</span>
          <Button
            variant="default"
            className="bg-danger text-white"
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            {t('edit.yes')}
          </Button>
          <Button variant="default" onClick={() => setShowResetConfirm(false)}>
            {t('edit.no')}
          </Button>
        </div>
      )}
    </div>
  );
}
