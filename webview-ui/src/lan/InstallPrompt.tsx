import { Button } from '../components/ui/Button.js';
import { t, useLang } from '../i18n.js';
import { dismissInstall, promptInstall, useInstallMode } from '../pwa.js';

/** "Install as app" popup for this PC's browser tab (hidden in the app, when read-only, after [Later]). */
export function InstallPrompt({ readOnly }: { readOnly: boolean }) {
  useLang();
  const mode = useInstallMode(readOnly);
  if (mode === 'hidden') return null;
  return (
    <div
      role="dialog"
      data-tour="install"
      aria-label={t('install.title')}
      className="absolute mobile-safe-top max-lg:top-[calc(env(safe-area-inset-top,0px)+64px)] right-10 z-20 pixel-panel py-8 px-12 flex flex-col gap-6 text-sm max-w-[min(360px,calc(100%-20px))]"
    >
      <span className="text-accent-bright">{t('install.title')}</span>
      <span className="text-text-muted">
        {mode === 'prompt'
          ? t('install.body')
          : t(mode === 'safari' ? 'install.safari' : 'install.other')}
      </span>
      <div className="flex gap-6 justify-end">
        {mode === 'prompt' && (
          <Button size="sm" variant="accent" onClick={promptInstall}>
            {t('install.install')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismissInstall}>
          {t('install.later')}
        </Button>
      </div>
    </div>
  );
}
