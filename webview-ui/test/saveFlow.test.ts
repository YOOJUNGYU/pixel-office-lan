import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveThenExit } from '../src/office/editor/saveFlow.js';

describe('saveThenExit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exits after the wait when the server did not refuse', () => {
    const onSaved = vi.fn();
    const send = vi.fn();
    saveThenExit({ send, getRejections: () => 0, waitMs: 300, onSaved });
    expect(send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(299);
    expect(onSaved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('stays in edit mode when layoutSaveRejected arrives', () => {
    let rejections = 0;
    const onSaved = vi.fn();
    saveThenExit({
      send: () => rejections++,
      getRejections: () => rejections,
      waitMs: 300,
      onSaved,
    });
    vi.advanceTimersByTime(1000);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
