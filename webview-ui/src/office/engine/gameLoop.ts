import { MAX_DELTA_TIME_SEC, MAX_IDLE_DELTA_TIME_SEC } from '../../constants.js';

/**
 * On-demand frame scheduler. A frame (update + render + frame listeners) runs
 * only when something asked for one (`requestRender`) or the scene animates on
 * its own (`nextFrameIn`): 0 = keep drawing every rAF (walking, effects, camera
 * glide), N seconds = sleep until the next animation boundary (typing frame,
 * pet idle frame…), Infinity = sleep until `requestRender`.
 */

/** The bit of a 2D context the loop touches (this module also loads under Node: tests). */
interface Ctx2D {
  imageSmoothingEnabled: boolean;
}

/** @internal */
export interface GameLoopCallbacks<C extends Ctx2D> {
  update: (dt: number) => void;
  render: (ctx: C) => void;
  /** Seconds until the scene changes by itself (0 = now, Infinity = never). */
  nextFrameIn: () => number;
}

/** Timer functions (injectable for tests). */
export interface LoopClock {
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const win = globalThis as unknown as {
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
};
const browserClock: LoopClock = {
  requestAnimationFrame: (cb) => win.requestAnimationFrame(cb),
  cancelAnimationFrame: (id) => win.cancelAnimationFrame(id),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const wakers = new Set<() => void>();
const frameListeners = new Set<() => void>();
const stats = { frames: 0, reasons: {} as Record<string, number> };

/** Ask for one frame: call after any change the canvas or its overlays show. */
export function requestRender(reason: string): void {
  stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  for (const wake of wakers) wake();
}

/** Run `listener` after every drawn frame except pure animation-boundary
 *  wakes (DOM overlays follow the canvas). */
export function onFrame(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

/** Frames drawn and render requests by reason (perf diagnostics). */
export function renderStats(): { frames: number; reasons: Record<string, number> } {
  return { frames: stats.frames, reasons: { ...stats.reasons } };
}

export function startGameLoop<C extends Ctx2D>(
  ctx: C,
  callbacks: GameLoopCallbacks<C>,
  clock: LoopClock = browserClock,
): () => void {
  ctx.imageSmoothingEnabled = false;

  let lastTime = 0;
  let rafId = 0;
  let timer: unknown = undefined;
  let stopped = false;
  /** This frame was woken by the animation-boundary timer (nothing walks). */
  let timed = false;

  const schedule = () => {
    if (!rafId && !stopped) rafId = clock.requestAnimationFrame(frame);
  };
  const clearTimer = () => {
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
  const wake = () => {
    timed = false;
    clearTimer();
    schedule();
  };

  const frame = (time: number) => {
    rafId = 0;
    if (stopped) return;
    // A timer wake may follow a long sleep: its time only advances timers
    // (nothing walks while asleep), so allow up to a second; otherwise the
    // usual clamp keeps a walker from jumping (e.g. after a hidden tab).
    const wokeByTimer = timed;
    const maxDt = wokeByTimer ? MAX_IDLE_DELTA_TIME_SEC : MAX_DELTA_TIME_SEC;
    timed = false;
    const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, maxDt);
    lastTime = time;

    callbacks.update(dt);
    ctx.imageSmoothingEnabled = false;
    callbacks.render(ctx);
    stats.frames++;
    // A timer wake only flips animation frames in place (nothing moved, no
    // input, no snapshot): the DOM overlays have nothing new to show.
    if (!wokeByTimer) for (const l of frameListeners) l();

    const next = callbacks.nextFrameIn();
    if (next <= 0) schedule();
    else if (next !== Infinity) {
      timer = clock.setTimeout(() => {
        timer = undefined;
        timed = true;
        schedule();
      }, next * 1000);
    }
  };

  wakers.add(wake);
  schedule();

  return () => {
    stopped = true;
    wakers.delete(wake);
    clock.cancelAnimationFrame(rafId);
    clearTimer();
  };
}
