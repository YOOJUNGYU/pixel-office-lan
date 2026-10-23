import { useEffect, useState } from 'react';

import type { UpdateAvailable, UpdateStatus } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import {
  SEEN_VERSION_STORAGE_KEY,
  UPDATE_DISMISSED_STORAGE_KEY,
  UPDATED_NOTICE_MS,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';
import { showInstallButton, updatedNoticeDue } from './updateBannerModel.js';

declare const __APP_VERSION__: string;

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

/** This page's version when this viewer last ran an older one (shown once), else null. */
function takeUpdatedNotice(): string | null {
  try {
    const seen = localStorage.getItem(SEEN_VERSION_STORAGE_KEY);
    localStorage.setItem(SEEN_VERSION_STORAGE_KEY, __APP_VERSION__);
    return updatedNoticeDue(seen, __APP_VERSION__) ? __APP_VERSION__ : null;
  } catch {
    return null;
  }
}

/** "New version" notice with [Update] [What's new] [Close]; Close hides it until the next version. */
export function UpdateBanner({ update, status, onClearStatus }: UpdateBannerProps) {
  useLang();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [updatedTo, setUpdatedTo] = useState(takeUpdatedNotice);
  useEffect(() => {
    if (!updatedTo) return;
    const id = setTimeout(() => setUpdatedTo(null), UPDATED_NOTICE_MS);
    return () => clearTimeout(id);
  }, [updatedTo]);
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
    setUpdatedTo(null);
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
  } else if (updatedTo) {
    text = t('update.updated', { v: updatedTo });
  } else {
    return null;
  }

  const install = () => transport.send({ type: 'installUpdate' });

  return (
    <div className="pointer-events-auto pixel-panel py-6 px-10 flex items-center gap-8 text-sm max-w-full flex-wrap justify-end">
      <span>{text}</span>
      {update && showInstallButton(true, state) && (
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
