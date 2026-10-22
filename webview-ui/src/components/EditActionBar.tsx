import { useState } from 'react';

import type { useEditorActions } from '../hooks/useEditorActions.js';
import { t, useLang } from '../i18n.js';
import type { EditorState } from '../office/editor/editorState.js';
import { EmptyRoomsWarning } from '../office/editor/EditorToolbar.js';
import { Button } from './ui/Button.js';

interface EditActionBarProps {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
  /** Rooms with no walkable tile, warned about while editing. */
  emptyRooms: string[];
}

export function EditActionBar({ editor, editorState: es, emptyRooms }: EditActionBarProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  useLang();

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      data-tour="edit-actions"
      className="absolute top-8 left-1/2 -translate-x-1/2 z-10 flex flex-col gap-4 items-center pixel-panel p-4"
    >
      <div className="flex gap-4 items-center">
        <Button
          variant={undoDisabled ? 'disabled' : 'default'}
          size="md"
          onClick={undoDisabled ? undefined : editor.handleUndo}
          title={t('edit.undoTitle')}
        >
          {t('edit.undo')}
        </Button>
        <Button
          variant={redoDisabled ? 'disabled' : 'default'}
          size="md"
          onClick={redoDisabled ? undefined : editor.handleRedo}
          title={t('edit.redoTitle')}
        >
          {t('edit.redo')}
        </Button>
        <Button variant="default" size="md" onClick={editor.handleSave} title={t('edit.saveTitle')}>
          {t('edit.save')}
        </Button>
        {!showResetConfirm ? (
          <Button
            variant="default"
            size="md"
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
              size="md"
              className="bg-danger text-white"
              onClick={() => {
                setShowResetConfirm(false);
                editor.handleReset();
              }}
            >
              {t('edit.yes')}
            </Button>
            <Button variant="default" size="md" onClick={() => setShowResetConfirm(false)}>
              {t('edit.no')}
            </Button>
          </div>
        )}
      </div>
      <EmptyRoomsWarning labels={emptyRooms} />
    </div>
  );
}
