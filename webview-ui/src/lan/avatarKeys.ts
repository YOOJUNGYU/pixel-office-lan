// Arrow keys walk my avatar (one tile per step, keeps walking while held).
import { useEffect } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { isTextEntry } from './chat.js';
import { arrowDir } from './lanAgents.js';

/** Arrow keys → my avatar, unless a text field has focus; `enabled` = not editing, touring or read-only. */
export function useAvatarKeys(os: OfficeState, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      const dir = arrowDir(e.key);
      if (dir === undefined || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTextEntry(document.activeElement)) return;
      e.preventDefault();
      if (!e.repeat) os.pressAvatar(dir);
    };
    const up = (e: KeyboardEvent) => {
      const dir = arrowDir(e.key);
      if (dir !== undefined) os.releaseAvatar(dir);
    };
    const blur = () => os.releaseAvatar();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      os.releaseAvatar();
    };
  }, [os, enabled]);
}
