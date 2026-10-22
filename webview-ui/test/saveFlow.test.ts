import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveThenExit } from '../src/office/editor/saveFlow.js';

/** A fake transport: `reply` delivers a server message to the subscribed handlers. */
function fake() {
  let handlers: Array<(m: { type: string }) => void> = [];
  return {
    onMessage: (h: (m: { type: string }) => void) => {
      handlers.push(h);
      return () => {
        handlers = handlers.filter((x) => x !== h);
      };
    },
    reply: (type: string) => handlers.forEach((h) => h({ type })),
    listeners: () => handlers.length,
  };
}

describe('saveThenExit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const run = (t: ReturnType<typeof fake>) => {
    const r = { onSaved: vi.fn(), onTimeout: vi.fn(), send: vi.fn() };
    saveThenExit({ ...r, onMessage: t.onMessage, timeoutMs: 5000 });
    return r;
  };

  it('exits on layoutSaved, and only then', () => {
    const t = fake();
    const r = run(t);
    expect(r.send).toHaveBeenCalledOnce();
    t.reply('officeSnapshot');
    vi.advanceTimersByTime(4000);
    expect(r.onSaved).not.toHaveBeenCalled();
    t.reply('layoutSaved');
    expect(r.onSaved).toHaveBeenCalledOnce();
    expect(t.listeners()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(r.onTimeout).not.toHaveBeenCalled();
  });

  it('stays in edit mode on layoutSaveRejected (no timeout error either)', () => {
    const t = fake();
    const r = run(t);
    t.reply('layoutSaveRejected');
    t.reply('layoutSaved');
    vi.advanceTimersByTime(10_000);
    expect(r.onSaved).not.toHaveBeenCalled();
    expect(r.onTimeout).not.toHaveBeenCalled();
    expect(t.listeners()).toBe(0);
  });

  it('reports a timeout when no answer arrives within 5 s', () => {
    const t = fake();
    const r = run(t);
    vi.advanceTimersByTime(4999);
    expect(r.onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(r.onTimeout).toHaveBeenCalledOnce();
    t.reply('layoutSaved');
    expect(r.onSaved).not.toHaveBeenCalled();
  });
});
