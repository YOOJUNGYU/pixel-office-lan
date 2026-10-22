/**
 * [Save] in the layout editor. The server only answers a refusal
 * (layoutSaveRejected), never a success, so "saved" = no refusal arrived
 * within `waitMs` of sending. Pure so it is testable with fake timers.
 */
export function saveThenExit(o: {
  send: () => void;
  getRejections: () => number;
  waitMs: number;
  onSaved: () => void;
}): void {
  const before = o.getRejections();
  o.send();
  setTimeout(() => {
    if (o.getRejections() === before) o.onSaved();
  }, o.waitMs);
}
