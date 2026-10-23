import { useRef, useState } from 'react';

import type { Lang } from '../../../core/src/lan.js';
import type { AutostartState, OfficesState } from '../../../core/src/messages.js';
import type { OfficeReply } from '../hooks/useExtensionMessages.js';
import { LANG_NAMES, setLang, t, useLang } from '../i18n.js';
import { OfficeSettings } from '../lan/OfficeSettings.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import type { ThemePref } from '../theme.js';
import { setThemePref, THEME_PREFS, useThemePref } from '../theme.js';
import { transport } from '../transport/index.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Read-only viewers only get the (per-browser) language choice. */
  readOnly: boolean;
  /** Opens the profile modal; null when this browser cannot edit the profile. */
  onOpenProfile: (() => void) | null;
  /** Whether the areas overlay is rendered outside of the Areas edit tool. */
  showAreas: boolean;
  onToggleShowAreas: () => void;
  /** Hide the Show Areas checkbox entirely when areas are unavailable. */
  showAreasAvailable: boolean;
  /** Browser-native layout export. */
  onExportLayout: () => void;
  /** Browser-native layout import from a chosen file. */
  onImportLayout: (file: File) => void;
  /** Replace the layout with the bundled default office (absent = not offered). */
  onResetToDefaultLayout?: () => void;
  /** Start at login on this PC; hidden when null or unsupported (dev run, Linux). */
  autostart: AutostartState | null;
  /** Silent app updates (Settings → 자동 업데이트). */
  autoUpdate: boolean;
  onToggleAutoUpdate: () => void;
  /** Team offices (this PC's browser only); the 오피스 section is hidden when null. */
  offices: Omit<OfficesState, 'type'> | null;
  officeReply: OfficeReply | null;
  onOfficeReplyHandled: () => void;
  /** Settings → 사용법 다시 보기 (restarts the onboarding tour). */
  onReplayTour: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  readOnly,
  onOpenProfile,
  showAreas,
  onToggleShowAreas,
  showAreasAvailable,
  onExportLayout,
  onImportLayout,
  onResetToDefaultLayout,
  autostart,
  autoUpdate,
  onToggleAutoUpdate,
  offices,
  officeReply,
  onOfficeReplyHandled,
  onReplayTour,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = useLang();
  const themePref = useThemePref();

  const languageSelect = (
    <label
      data-tour="settings-language"
      className="flex items-center justify-between gap-8 py-4 px-10 text-base"
    >
      {t('settings.language')}
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="py-2 px-4 bg-bg-dark border-2 border-border rounded-none text-text"
      >
        {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );

  const themeSelect = (
    <label
      data-tour="settings-theme"
      className="flex items-center justify-between gap-8 py-4 px-10 text-base"
    >
      {t('settings.theme')}
      <select
        value={themePref}
        onChange={(e) => setThemePref(e.target.value as ThemePref)}
        className="py-2 px-4 bg-bg-dark border-2 border-border rounded-none text-text"
      >
        {THEME_PREFS.map((p) => (
          <option key={p} value={p}>
            {t(`theme.${p}`)}
          </option>
        ))}
      </select>
    </label>
  );

  const replayTour = <MenuItem onClick={onReplayTour}>{t('settings.replayTour')}</MenuItem>;

  if (readOnly) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={t('toolbar.settings')}>
        {languageSelect}
        {themeSelect}
        {replayTour}
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('toolbar.settings')}>
      {languageSelect}
      {themeSelect}
      {onOpenProfile && (
        <MenuItem
          onClick={() => {
            onOpenProfile();
            onClose();
          }}
        >
          {t('settings.profile')}
        </MenuItem>
      )}
      <MenuItem
        onClick={() => {
          onExportLayout();
          onClose();
        }}
      >
        {t('settings.export')}
      </MenuItem>
      {/* Open the native file picker; the import is applied in onChange below. */}
      <MenuItem onClick={() => fileInputRef.current?.click()}>{t('settings.import')}</MenuItem>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset the value so re-selecting the same file fires change again.
          e.target.value = '';
          if (file) {
            onImportLayout(file);
            onClose();
          }
        }}
      />
      {onResetToDefaultLayout && (
        <MenuItem
          onClick={() => {
            onClose();
            onResetToDefaultLayout();
          }}
        >
          {t('settings.resetDefaultLayout')}
        </MenuItem>
      )}
      <Checkbox
        label={t('settings.sound')}
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      {autostart?.supported && (
        // Not optimistic: the server answers with the real state (autostartState).
        <div data-tour="settings-autostart">
          <Checkbox
            label={t('settings.autostart')}
            checked={autostart.enabled}
            onChange={() => transport.send({ type: 'setAutostart', enabled: !autostart.enabled })}
          />
        </div>
      )}
      {showAreasAvailable && (
        <Checkbox
          label={t('settings.showAreas')}
          checked={showAreas}
          onChange={onToggleShowAreas}
        />
      )}
      <div data-tour="settings-update">
        <Checkbox
          label={t('settings.autoUpdate')}
          checked={autoUpdate}
          onChange={onToggleAutoUpdate}
        />
        <MenuItem
          onClick={() => {
            transport.send({ type: 'checkUpdate' });
            onClose();
          }}
        >
          {t('settings.checkUpdate')}
        </MenuItem>
      </div>
      {replayTour}
      {offices && (
        <OfficeSettings state={offices} reply={officeReply} onReplyHandled={onOfficeReplyHandled} />
      )}
      {/* The server closes this page's socket with WS_CLOSE_APP_QUIT → the "종료됨" notice. */}
      <MenuItem
        onClick={() => {
          if (!window.confirm(t('settings.quitConfirm'))) return;
          transport.send({ type: 'quitApp' });
          onClose();
        }}
      >
        {t('settings.quitApp')}
      </MenuItem>
    </Modal>
  );
}
