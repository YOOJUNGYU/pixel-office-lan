import { useRef, useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
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
}

export function SettingsModal({
  isOpen,
  onClose,
  onOpenProfile,
  showAreas,
  onToggleShowAreas,
  showAreasAvailable,
  onExportLayout,
  onImportLayout,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="설정">
      {onOpenProfile && (
        <MenuItem
          onClick={() => {
            onOpenProfile();
            onClose();
          }}
        >
          내 프로필
        </MenuItem>
      )}
      <MenuItem
        onClick={() => {
          onExportLayout();
          onClose();
        }}
      >
        레이아웃 내보내기
      </MenuItem>
      {/* Open the native file picker; the import is applied in onChange below. */}
      <MenuItem onClick={() => fileInputRef.current?.click()}>레이아웃 가져오기</MenuItem>
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
        label="알림 소리"
        checked={soundLocal}
        onChange={() => {
          const newVal = !isSoundEnabled();
          setSoundEnabled(newVal);
          setSoundLocal(newVal);
          transport.send({ type: 'setSoundEnabled', enabled: newVal });
        }}
      />
      {showAreasAvailable && (
        <Checkbox label="방 영역 표시" checked={showAreas} onChange={onToggleShowAreas} />
      )}
    </Modal>
  );
}
