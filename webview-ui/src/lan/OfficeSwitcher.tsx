import type { OfficesState } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';
import { switcherItems } from './offices.js';

/** Top-centre office tabs: 🌐 public + 🔒 each team. This PC's browser only. */
export function OfficeSwitcher({ state }: { state: Omit<OfficesState, 'type'> }) {
  useLang();
  return (
    <div
      role="tablist"
      aria-label={t('office.label')}
      className="absolute mobile-safe-top left-1/2 -translate-x-1/2 z-10 pixel-panel p-4 flex flex-wrap justify-center gap-4 max-w-[calc(100%-180px)]"
    >
      {switcherItems(state).map((item) => (
        // aria-disabled, not disabled: a disabled button shows no tooltip in some browsers.
        <Button
          key={item.view}
          role="tab"
          size="sm"
          aria-selected={item.active}
          aria-disabled={item.disabled}
          title={item.disabled ? t('office.publicDisabled') : undefined}
          variant={item.active ? 'active' : item.disabled ? 'disabled' : 'default'}
          className="whitespace-nowrap"
          onClick={() => {
            if (!item.disabled && !item.active) {
              transport.send({ type: 'setActiveView', view: item.view });
            }
          }}
        >
          {item.isPublic ? t('office.public') : `🔒 ${item.name || t('office.unnamed')}`}
        </Button>
      ))}
    </div>
  );
}
