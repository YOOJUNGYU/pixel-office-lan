import { TAG_TOGGLE_TOP_PX } from '../constants.js';
import { t, useLang } from '../i18n.js';

interface TagToggleProps {
  tagsHidden: boolean;
  onToggleTags: () => void;
}

/** Top-left name-tag toggle under the theme/zoom row (room descriptions live on the plates' hover). */
export function TagToggle({ tagsHidden, onToggleTags }: TagToggleProps) {
  useLang();
  return (
    <button
      type="button"
      data-tour="tags-toggle"
      aria-pressed={tagsHidden}
      onClick={onToggleTags}
      style={{ top: TAG_TOGGLE_TOP_PX }}
      className="absolute left-8 z-10 pixel-panel py-4 px-8 text-sm text-text cursor-pointer whitespace-nowrap"
    >
      {t(tagsHidden ? 'tags.show' : 'tags.hide')}
    </button>
  );
}
