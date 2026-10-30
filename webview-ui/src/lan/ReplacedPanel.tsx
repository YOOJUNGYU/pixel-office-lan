import { useEffect, useState } from 'react';

import { Button } from '../components/ui/Button.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';

/**
 * Full-screen "open in another window" panel: the server keeps one UI (the newest window)
 * and closes the others with WS_CLOSE_REPLACED. This window first tries to close itself
 * (allowed for a PWA window or a tab with a single history entry); if it stays, [여기서 열기]
 * reloads it, which takes the office back from the other window.
 */
export function ReplacedPanel() {
  useLang();
  const [replaced, setReplaced] = useState(transport.state === 'replaced');

  useEffect(
    () =>
      transport.onStateChange((s) => {
        if (s !== 'replaced') return;
        setReplaced(true);
        window.close();
      }),
    [],
  );

  if (!replaced) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby="replaced-panel-title"
      className="fixed inset-0 z-100 flex items-center justify-center bg-bg-dark p-16"
      data-testid="replaced-panel"
    >
      <div className="pixel-panel max-w-lg flex flex-col items-center gap-16 py-24 px-24 text-center">
        <h1 id="replaced-panel-title" className="text-xl m-0">
          {t('replaced.title')}
        </h1>
        <p className="m-0 text-base">{t('replaced.body')}</p>
        <Button variant="accent" size="xl" onClick={() => window.location.reload()}>
          {t('replaced.here')}
        </Button>
      </div>
    </div>
  );
}
