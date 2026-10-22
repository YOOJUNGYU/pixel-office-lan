/**
 * [Save] in the layout editor: send, then wait for the server's answer to this
 * socket — `layoutSaved` → `onSaved`, `layoutSaveRejected` → nothing (the
 * rejection toast is shown elsewhere; the editor stays open), neither within
 * `timeoutMs` → `onTimeout`. Pure so it is testable with fake timers.
 */
export function saveThenExit(o: {
  send: () => void;
  onMessage: (handler: (msg: { type: string }) => void) => () => void;
  timeoutMs: number;
  onSaved: () => void;
  onTimeout: () => void;
}): void {
  const done = (then?: () => void) => {
    unsubscribe();
    clearTimeout(timer);
    then?.();
  };
  const unsubscribe = o.onMessage((msg) => {
    if (msg.type === 'layoutSaved') done(o.onSaved);
    else if (msg.type === 'layoutSaveRejected') done();
  });
  const timer = setTimeout(() => done(o.onTimeout), o.timeoutMs);
  o.send();
}
