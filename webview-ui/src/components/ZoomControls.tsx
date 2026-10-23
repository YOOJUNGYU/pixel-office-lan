import { useEffect, useRef, useState } from 'react';

import {
  ZOOM_BUTTON_FACTOR,
  ZOOM_LEVEL_FADE_DELAY_MS,
  ZOOM_LEVEL_FADE_DURATION_SEC,
  ZOOM_LEVEL_HIDE_DELAY_MS,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import { getTheme, setThemePref, useThemePref } from '../theme.js';
import { Button } from './ui/Button.js';

interface ZoomControlsProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** The +/− row (hidden on mobile, where pinch zooms); the theme toggle always shows. */
  showZoom: boolean;
}

const BTN_CLASS =
  'border-border! shadow-pixel disabled:hover:bg-btn-bg disabled:cursor-default disabled:opacity-(--btn-disabled-opacity)';

/** Dark ⇄ light in one click (a stored 'system' becomes the explicit opposite). */
function ThemeToggle() {
  useThemePref(); // re-render on any theme change
  const dark = getTheme() === 'dark';
  return (
    <Button
      size="icon_lg"
      data-tour="theme-toggle"
      onClick={() => setThemePref(dark ? 'light' : 'dark')}
      className={BTN_CLASS}
      title={t(dark ? 'theme.toLight' : 'theme.toDark')}
      aria-label={t(dark ? 'theme.toLight' : 'theme.toDark')}
    >
      {dark ? (
        // Sun: what you get
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="2" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line
              key={a}
              x1="9"
              y1="1.5"
              x2="9"
              y2="3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              transform={`rotate(${a} 9 9)`}
            />
          ))}
        </svg>
      ) : (
        // Moon
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M14.5 11.5A6 6 0 0 1 6.5 3.5a6 6 0 1 0 8 8Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Button>
  );
}

export function ZoomControls({ zoom, onZoomChange, showZoom }: ZoomControlsProps) {
  useLang();
  const [showLevel, setShowLevel] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(zoom);

  const minDisabled = zoom <= ZOOM_MIN;
  const maxDisabled = zoom >= ZOOM_MAX;

  // Show zoom level briefly when zoom changes
  useEffect(() => {
    if (zoom === prevZoomRef.current) return;
    prevZoomRef.current = zoom;

    // Clear existing timers
    if (timerRef.current) clearTimeout(timerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    setShowLevel(true);
    setFadeOut(false);

    // Start fade after delay
    fadeTimerRef.current = setTimeout(() => {
      setFadeOut(true);
    }, ZOOM_LEVEL_FADE_DELAY_MS);

    // Hide completely after delay
    timerRef.current = setTimeout(() => {
      setShowLevel(false);
      setFadeOut(false);
    }, ZOOM_LEVEL_HIDE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, [zoom]);

  return (
    <>
      {/* Zoom level indicator at top-center */}
      {showZoom && showLevel && (
        <div
          className="absolute top-10 left-1/2 -translate-x-1/2 z-10 pixel-panel pb-4 px-16 text-lg select-none pointer-events-none"
          style={{
            opacity: fadeOut ? 0 : 1,
            transition: `opacity ${ZOOM_LEVEL_FADE_DURATION_SEC}s ease-out`,
          }}
        >
          {zoom.toFixed(1)}x
        </div>
      )}

      {/* Top-left: theme toggle, then + and − side by side */}
      <div className="absolute top-8 left-8 z-10 flex flex-col items-start gap-4">
        <ThemeToggle />
        {showZoom && (
          <div data-tour="zoom" className="flex gap-4">
            <Button
              size="icon_lg"
              onClick={() => onZoomChange(zoom * ZOOM_BUTTON_FACTOR)}
              disabled={maxDisabled}
              className={BTN_CLASS}
              title={t('zoom.in')}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <line
                  x1="9"
                  y1="3"
                  x2="9"
                  y2="15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="3"
                  y1="9"
                  x2="15"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Button>
            <Button
              size="icon_lg"
              onClick={() => onZoomChange(zoom / ZOOM_BUTTON_FACTOR)}
              disabled={minDisabled}
              className={BTN_CLASS}
              title={t('zoom.out')}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <line
                  x1="3"
                  y1="9"
                  x2="15"
                  y2="9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
