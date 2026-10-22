import { useEffect, useReducer } from 'react';

import { TOUR_STORAGE_KEY } from '../constants.js';
import type { StepId } from './steps.js';

export interface TourState {
  /** Steps of the running tour; empty = not running. */
  ids: StepId[];
  index: number;
  /** Finished or skipped once in this browser. */
  done: boolean;
}

export type TourAction =
  { type: 'start'; ids: StepId[] } | { type: 'next' } | { type: 'prev' } | { type: 'skip' };

export function tourReducer(s: TourState, a: TourAction): TourState {
  switch (a.type) {
    case 'start':
      return { ...s, ids: a.ids, index: 0 };
    case 'next':
      if (s.ids.length === 0) return s;
      return s.index + 1 < s.ids.length
        ? { ...s, index: s.index + 1 }
        : { ids: [], index: 0, done: true };
    case 'prev':
      return { ...s, index: Math.max(0, s.index - 1) };
    case 'skip':
      return s.ids.length === 0 ? s : { ids: [], index: 0, done: true };
  }
}

function readDone(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Tour progress; the done flag persists per browser (`pixel-office.tour.v1`). */
export function useTour() {
  const [state, dispatch] = useReducer(tourReducer, undefined, () => ({
    ids: [],
    index: 0,
    done: readDone(),
  }));
  useEffect(() => {
    if (!state.done) return;
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      /* storage blocked: the tour shows again next visit */
    }
  }, [state.done]);
  const current: StepId | null = state.ids[state.index] ?? null;
  return { state, current, dispatch };
}
