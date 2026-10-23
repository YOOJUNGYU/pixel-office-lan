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

/** Hidden tags still show for the hovered and the selected character. */
export const tagVisible = (
  hidden: boolean,
  id: number,
  hoveredId: number | null,
  selectedId: number | null,
): boolean => !hidden || id === hoveredId || id === selectedId;
