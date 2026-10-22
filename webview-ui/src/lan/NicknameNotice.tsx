import { Button } from '../components/ui/Button.js';
import { t, useLang } from '../i18n.js';

/** Shown once when this PC lost a same-nickname tie-break (others see "name · a1b2"). */
export function NicknameNotice({
  onChange,
  onClose,
}: {
  onChange: () => void;
  onClose: () => void;
}) {
  useLang();
  return (
    <div
      role="status"
      className="absolute left-1/2 -translate-x-1/2 bottom-60 z-20 pixel-panel py-6 px-10 flex items-center gap-8 text-sm max-w-[calc(100%-20px)] flex-wrap"
    >
      <span>{t('nickname.conflict')}</span>
      <Button size="sm" variant="accent" onClick={onChange}>
        {t('nickname.change')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClose}>
        {t('update.close')}
      </Button>
    </div>
  );
}
