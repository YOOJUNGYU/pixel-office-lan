import { useEffect, useState } from 'react';

import { Button } from '../components/ui/Button.js';
import {
  SERVER_PANEL_GRACE_MS,
  SERVER_PANEL_POLL_MS,
  SERVER_START_TIMEOUT_MS,
  SERVER_STARTED_BEFORE_KEY,
  START_SERVER_URL,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import { transport } from '../transport/index.js';
import { panelVisible, startPhase } from './serverPanel.js';

function startedBefore(): boolean {
  try {
    return localStorage.getItem(SERVER_STARTED_BEFORE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Full-screen "server is off" panel with [시작] (navigates to pixeloffice://start, a scheme
 * the installer registers to a fixed launch command). Needs no server message: it renders
 * from the cached shell. Polls /api/health and reloads into the office once it is up.
 */
export function ServerPanel() {
  useLang();
  const [state, setState] = useState(transport.state);
  const [everConnected, setEverConnected] = useState(transport.state === 'connected');
  const [graceOver, setGraceOver] = useState(false);
  const [clickedAt, setClickedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [before, setBefore] = useState(startedBefore);

  useEffect(
    () =>
      transport.onStateChange((s) => {
        setState(s);
        if (s === 'connected') setEverConnected(true);
      }),
    [],
  );
  useEffect(() => {
    const id = setTimeout(() => setGraceOver(true), SERVER_PANEL_GRACE_MS);
    return () => clearTimeout(id);
  }, []);

  const visible = panelVisible(state, everConnected, graceOver);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setNow(Date.now());
      // ?waiting: a server started with --open skips its own window (this page reloads instead).
      fetch(`${import.meta.env.BASE_URL}api/health?waiting=1`, { cache: 'no-store' }).then(
        (r) => {
          if (r.ok) window.location.reload();
        },
        () => {},
      );
    }, SERVER_PANEL_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const start = () => {
    try {
      localStorage.setItem(SERVER_STARTED_BEFORE_KEY, '1');
    } catch {
      /* the hint just stays the first-time one */
    }
    setBefore(true);
    setClickedAt(Date.now());
    setNow(Date.now());
    window.location.href = START_SERVER_URL; // the browser asks "Open Pixel Office?"
  };

  const phase = startPhase(clickedAt, now, SERVER_START_TIMEOUT_MS);
  const quit = state === 'disconnected';
  return (
    <div
      role="alertdialog"
      aria-labelledby="server-panel-title"
      className="fixed inset-0 z-100 flex items-center justify-center bg-bg-dark p-16"
      data-testid="server-panel"
    >
      <div className="pixel-panel max-w-lg flex flex-col items-center gap-16 py-24 px-24 text-center">
        <h1 id="server-panel-title" className="text-xl m-0">
          {t(quit ? 'server.quitTitle' : 'server.offTitle')}
        </h1>
        <p className="m-0 text-base">{t(before ? 'server.bodyAgain' : 'server.body')}</p>
        <Button variant="accent" size="xl" onClick={start} data-testid="server-start">
          {t('server.start')}
        </Button>
        {phase !== 'idle' && (
          <p role="status" className="m-0 text-sm text-text-muted">
            {t(phase === 'starting' ? 'server.starting' : 'server.timeout')}
          </p>
        )}
      </div>
    </div>
  );
}
