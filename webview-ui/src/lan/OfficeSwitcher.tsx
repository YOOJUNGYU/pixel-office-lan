import type { OfficesState } from '../../../core/src/messages.js';
import { Button } from '../components/ui/Button.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';
import { switcherItems } from './offices.js';

/**
 * Top-centre office tabs: 🌐 public + 🔒 each team + 🏠 personal. This PC's browser only.
 * `online` = people live per open office (me included); a tab without one shows no count.
 */
export function OfficeSwitcher({
  state,
  online,
}: {
  state: Omit<OfficesState, 'type'>;
  online: Record<string, number>;
}) {
  useLang();
  return (
    <div
      role="tablist"
      data-tour="switcher"
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
          title={
            item.disabled
              ? t('office.publicDisabled')
              : item.isPersonal
                ? t('office.personalHint')
                : undefined
          }
          variant={item.active ? 'active' : item.disabled ? 'disabled' : 'default'}
          className="whitespace-nowrap"
          onClick={() => {
            if (!item.disabled && !item.active) {
              transport.send({ type: 'setActiveView', view: item.view });
            }
          }}
        >
          {item.isPublic
            ? t('office.public')
            : item.isPersonal
              ? t('office.personal')
              : `🔒 ${item.name || t('office.unnamed')}`}
          {online[item.view] !== undefined &&
            ` · ${t('office.online', { n: String(online[item.view]) })}`}
        </Button>
      ))}
    </div>
  );
}
