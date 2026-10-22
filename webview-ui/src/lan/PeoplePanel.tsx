import { useEffect, useState } from 'react';

import {
  MOBILE_MEDIA_QUERY,
  PEOPLE_COLLAPSED_KEY,
  PEOPLE_FACE_ROWS,
  PEOPLE_FACE_SCALE,
  PEOPLE_FACE_TOP,
  PEOPLE_HINT_MS,
  PEOPLE_WIDE_MIN_PX,
  PEOPLE_Z_INDEX,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { LanAgents } from './lanAgents.js';
import type { PersonRow } from './peopleModel.js';
import { CharacterPreview } from './ProfileModal.js';

const FACE_CROP = { top: PEOPLE_FACE_TOP, rows: PEOPLE_FACE_ROWS };

/** Remembered choice, else expanded only on a wide, non-mobile screen. */
function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(PEOPLE_COLLAPSED_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* storage blocked: fall back to the screen width */
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches || window.innerWidth < PEOPLE_WIDE_MIN_PX;
}

function counts(r: PersonRow): string {
  const parts = [];
  if (r.claude) parts.push(`Claude ${r.claude}`);
  if (r.codex) parts.push(`Codex ${r.codex}`);
  return parts.length ? parts.join(' · ') : t('people.noAgents');
}

function StatusMark({ status }: { status: PersonRow['status'] }) {
  const label = t(`people.status.${status}`);
  if (status === 'attention') {
    return (
      <span role="img" aria-label={label} title={label} className="w-12 text-center shrink-0">
        ❗
      </span>
    );
  }
  return (
    <span className="w-12 flex justify-center shrink-0" title={label}>
      <span
        role="img"
        aria-label={label}
        className={`w-6 h-6 ${status === 'working' ? 'bg-status-success' : 'bg-text-muted'}`}
      />
    </span>
  );
}

interface PeoplePanelProps {
  rows: PersonRow[];
  lan: LanAgents;
  officeState: OfficeState;
  /** The tour's people step shows it expanded regardless of the viewer's choice. */
  forceOpen: boolean;
}

/**
 * Right-edge list of everyone in the viewed office. Click = camera follows the
 * person's agent; hover = their name tags light up (LanAgents.highlightPeer).
 */
export function PeoplePanel({ rows, lan, officeState, forceOpen }: PeoplePanelProps) {
  useLang();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (hint === null) return;
    const timer = setTimeout(() => setHint(null), PEOPLE_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  // Unmounted mid-hover: no tag stays lit.
  useEffect(() => () => void (lan.highlightPeer = null), [lan]);

  const open = forceOpen || !collapsed;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(PEOPLE_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
  };
  const focus = (r: PersonRow) => {
    const id = r.focusKey !== null ? lan.idFor(r.focusKey) : undefined;
    if (id === undefined) setHint(r.person.peerId);
    else officeState.selectAndFollow(id);
  };

  return (
    <div
      data-tour="people"
      style={{ zIndex: PEOPLE_Z_INDEX }}
      className="absolute right-10 top-1/2 -translate-y-1/2 pixel-panel flex flex-col text-sm max-w-[min(260px,calc(100%-20px))] max-h-[60%]"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? t('people.hide') : t('people.show')}
        onClick={toggle}
        className="flex items-center justify-between gap-8 py-4 px-8 bg-transparent border-0 text-text cursor-pointer font-bold whitespace-nowrap"
      >
        <span>{t('people.title', { n: String(rows.length) })}</span>
        <span aria-hidden>{open ? '▸' : '◂'}</span>
      </button>
      {open && (
        <ul className="m-0 p-0 list-none overflow-y-auto border-t-2 border-border">
          {rows.map((r) => (
            <li key={r.person.peerId}>
              <button
                type="button"
                onClick={() => focus(r)}
                onMouseEnter={() => (lan.highlightPeer = r.person.peerId)}
                onMouseLeave={() => (lan.highlightPeer = null)}
                onFocus={() => (lan.highlightPeer = r.person.peerId)}
                onBlur={() => (lan.highlightPeer = null)}
                className="w-full flex items-center gap-8 py-3 px-8 bg-transparent border-0 text-left text-text cursor-pointer hover:bg-btn-hover"
              >
                <span className="shrink-0 flex bg-bg-dark border-2 border-border">
                  <CharacterPreview
                    palette={r.person.palette}
                    hueShift={r.person.hueShift}
                    scale={PEOPLE_FACE_SCALE}
                    crop={FACE_CROP}
                  />
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="truncate">
                    {r.person.nickname || t('nickname.unset')}
                    {r.person.self && ` ${t('people.you')}`}
                  </span>
                  <span
                    className={`text-xs truncate ${hint === r.person.peerId ? 'text-warning' : 'text-text-muted'}`}
                  >
                    {counts(r)}
                  </span>
                </span>
                <StatusMark status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
