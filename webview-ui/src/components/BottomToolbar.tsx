import { t, useLang } from '../i18n.js';
import { Button } from './ui/Button.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  /** null hides the layout button (read-only viewers). */
  onToggleEditMode: (() => void) | null;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
}: BottomToolbarProps) {
  useLang();
  return (
    <div className="absolute left-10 bottom-10 z-20 flex items-center gap-4 pixel-panel p-4">
      {onToggleEditMode && (
        <Button
          variant={isEditMode ? 'active' : 'default'}
          onClick={onToggleEditMode}
          data-tour="layout-button"
          title={t('toolbar.layoutTitle')}
        >
          {t('toolbar.layout')}
        </Button>
      )}
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        data-tour="settings-button"
        title={t('toolbar.settings')}
      >
        {t('toolbar.settings')}
      </Button>
    </div>
  );
}
