import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import { ReplacedPanel } from './lan/ReplacedPanel.js';
import { ServerPanel } from './lan/ServerPanel.js';
import { initPwa } from './pwa.js';
import { isBrowserRuntime } from './runtime';

async function main() {
  initPwa();
  // browserMock is for Vite dev mode only (UI prototyping without a server).
  // In standalone server mode, assets are loaded server-side and sent over WebSocket.
  if (isBrowserRuntime && import.meta.env.DEV) {
    const { initBrowserMock } = await import('./browserMock.js');
    await initBrowserMock();
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      {/* Dev has no server (browserMock): the transport never connects. */}
      {!import.meta.env.DEV && <ServerPanel />}
      {!import.meta.env.DEV && <ReplacedPanel />}
    </StrictMode>,
  );
}

main().catch(console.error);
