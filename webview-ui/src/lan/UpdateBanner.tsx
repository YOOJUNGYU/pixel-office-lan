import { useState } from 'react';

import type { UpdateAvailable, UpdateStatus } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { UPDATE_DISMISSED_STORAGE_KEY } from '../constants.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';

interface UpdateBannerProps {
  /** Only ever sent to this PC's (loopback) browser. */
  update: UpdateAvailable | null;
  status: UpdateStatus | null;
  onClearStatus: () => void;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** "New version" notice with [Update] [What's new] [Close]; Close hides it until the next version. */
export function UpdateBanner({ update, status, onClearStatus }: UpdateBannerProps) {
  useLang();
  const [dismissed, setDismissed] = useState(readDismissed);
  const state = status?.state;
  const busy = state === 'downloading' || state === 'installing' || state === 'error';

  const close = () => {
    if (update) {
      setDismissed(update.version);
      try {
        localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, update.version);
      } catch {
        /* hidden for this page only */
      }
    }
    onClearStatus();
  };

  let text: string;
  if (update && (busy || dismissed !== update.version)) {
    text =
      state === 'downloading'
        ? t('update.downloading', { p: String(status?.percent ?? 0) })
        : state === 'installing'
          ? t('update.installing')
          : state === 'error'
            ? t('update.error')
            : t('update.available', { v: update.version });
  } else if (state === 'upToDate') {
    text = t('update.upToDate');
  } else {
    return null;
  }

  const install = () => transport.send({ type: 'installUpdate' });

  return (
    <div className="absolute right-10 bottom-10 z-20 pixel-panel py-6 px-10 flex items-center gap-8 text-sm max-w-[calc(100%-20px)] flex-wrap">
      <span>{text}</span>
      {update && state !== 'upToDate' && state !== 'downloading' && (
        <>
          <Button size="sm" variant="accent" onClick={install}>
            {t(state === 'error' ? 'update.retry' : 'update.install')}
          </Button>
          <Button
            size="sm"
            onClick={() => window.open(update.notesUrl, '_blank', 'noopener,noreferrer')}
          >
            {t('update.notes')}
          </Button>
        </>
      )}
      {state !== 'downloading' && (
        <Button size="sm" variant="ghost" onClick={close}>
          {t('update.close')}
        </Button>
      )}
    </div>
  );
}
