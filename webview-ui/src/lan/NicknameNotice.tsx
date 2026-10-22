import { useState } from 'react';

import { Button } from '../components/ui/Button.js';
import { NICKNAME_NOTICE_STORAGE_KEY } from '../constants.js';
import { t, useLang } from '../i18n.js';

function readHandled(): string | null {
  try {
    return localStorage.getItem(NICKNAME_NOTICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * This PC's nickname lost a clash (another PC set it first; others see it with
 * a short tag). Shown once per clashing nickname (`clash` = its nicknameKey).
 */
export function NicknameNotice({ clash, onChange }: { clash: string; onChange: () => void }) {
  useLang();
  const [handled, setHandled] = useState(readHandled);
  if (handled === clash) return null;
  const done = () => {
    setHandled(clash);
    try {
      localStorage.setItem(NICKNAME_NOTICE_STORAGE_KEY, clash);
    } catch {
      /* shown again next page load */
    }
  };
  return (
    <div
      role="status"
      className="absolute left-1/2 -translate-x-1/2 bottom-60 z-20 pixel-panel py-6 px-10 flex items-center gap-8 text-sm max-w-[calc(100%-20px)] flex-wrap"
    >
      <span>{t('nickname.conflict')}</span>
      <Button
        size="sm"
        variant="accent"
        onClick={() => {
          done();
          onChange();
        }}
      >
        {t('nickname.change')}
      </Button>
      <Button size="sm" variant="ghost" onClick={done}>
        {t('update.close')}
      </Button>
    </div>
  );
}
