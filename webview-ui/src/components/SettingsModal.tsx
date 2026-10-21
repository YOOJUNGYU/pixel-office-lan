import { useRef, useState } from 'react';

import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Checkbox } from './ui/Checkbox.js';
import { MenuItem } from './ui/MenuItem.js';
import { Modal } from './ui/Modal.js';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  externalAssetDirectories: string[];
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
  externalAssetDirectories,
  showAreas,
  onToggleShowAreas,
  showAreasAvailable,
  onExportLayout,
  onImportLayout,
}: SettingsModalProps) {
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assetDirDraft, setAssetDirDraft] = useState('');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="설정">
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
      {/* Browser has no native directory picker, so accept a typed absolute path. */}
      <div className="flex items-center gap-4 py-4 px-10">
        <input
          type="text"
          value={assetDirDraft}
          placeholder="에셋 폴더 절대 경로"
          onChange={(e) => setAssetDirDraft(e.target.value)}
          className="flex-1 min-w-0 text-xs py-2 px-4 bg-bg border-2 border-border rounded-none text-text"
        />
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            const path = assetDirDraft.trim();
            if (!path) return;
            transport.send({ type: 'addExternalAssetDirectory', path });
            setAssetDirDraft('');
          }}
          className="shrink-0"
        >
          추가
        </Button>
      </div>
      {externalAssetDirectories.map((dir) => (
        <div key={dir} className="flex items-center justify-between py-4 px-10 gap-8">
          <span
            className="text-xs text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
            title={dir}
          >
            {dir.split(/[/\\]/).pop() ?? dir}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => transport.send({ type: 'removeExternalAssetDirectory', path: dir })}
            className="shrink-0"
          >
            x
          </Button>
        </div>
      ))}
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
