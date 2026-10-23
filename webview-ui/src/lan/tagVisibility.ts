import { TAGS_HIDDEN_KEY } from '../constants.js';

export function readTagsHidden(): boolean {
  try {
    return localStorage.getItem(TAGS_HIDDEN_KEY) !== '0'; // default: hidden
  } catch {
    return true;
  }
}

export function saveTagsHidden(hidden: boolean): void {
  try {
    localStorage.setItem(TAGS_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** The toggle hides agents' tags only (avatar tags always show); a hidden tag
 *  still shows for the hovered and the selected character. */
export const tagVisible = (
  hidden: boolean,
  id: number,
  hoveredId: number | null,
  selectedId: number | null,
  avatar = false,
): boolean => avatar || !hidden || id === hoveredId || id === selectedId;
