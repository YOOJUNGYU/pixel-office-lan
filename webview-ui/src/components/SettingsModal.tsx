import { useRef, useState } from 'react';

import type { Lang } from '../../../core/src/lan.js';
import type { AutostartState, OfficesState } from '../../../core/src/messages.js';
import type { OfficeReply } from '../hooks/useExtensionMessages.js';
import { LANG_NAMES, setLang, t, useLang } from '../i18n.js';
import { OfficeSettings } from '../lan/OfficeSettings.js';
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
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
  /** Start at login on this PC; hidden when null or unsupported (dev run, Linux). */
  autostart: AutostartState | null;
  /** Team offices (this PC's browser only); the 오피스 section is hidden when null. */
  offices: Omit<OfficesState, 'type'> | null;
  officeReply: OfficeReply | null;
  onOfficeReplyHandled: () => void;
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
  autostart,
  offices,
  officeReply,
  onOfficeReplyHandled,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = useLang();

  const languageSelect = (
    <label className="flex items-center justify-between gap-8 py-4 px-10 text-base">
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

  if (readOnly) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={t('toolbar.settings')}>
        {languageSelect}
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('toolbar.settings')}>
      {languageSelect}
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
        <Checkbox
          label={t('settings.autostart')}
          checked={autostart.enabled}
          onChange={() => transport.send({ type: 'setAutostart', enabled: !autostart.enabled })}
        />
      )}
      {showAreasAvailable && (
        <Checkbox
          label={t('settings.showAreas')}
          checked={showAreas}
          onChange={onToggleShowAreas}
        />
      )}
      <MenuItem
        onClick={() => {
          transport.send({ type: 'checkUpdate' });
          onClose();
        }}
      >
        {t('settings.checkUpdate')}
      </MenuItem>
      {offices && (
        <OfficeSettings state={offices} reply={officeReply} onReplyHandled={onOfficeReplyHandled} />
      )}
    </Modal>
  );
}
