import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from 'react';

import type { OfficeAgent } from '../../../core/src/lan.js';
import { ROOM_LABELS } from '../../../core/src/lan.js';
import { Button } from '../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  LAN_BUBBLE_HEAD_OFFSET,
  TOUR_DIM_COLOR,
  TOUR_OUTLINE_PX,
  TOUR_SPOTLIGHT_EASE,
  TOUR_SPOTLIGHT_PAD_PX,
  TOUR_TOOLTIP_GAP_PX,
  TOUR_TOOLTIP_MAX_WIDTH_PX,
  TOUR_VIEWPORT_MARGIN_PX,
  TOUR_Z_INDEX,
} from '../constants.js';
import { t, useLang } from '../i18n.js';
import type { LanAgents } from '../lan/lanAgents.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { type OverlayProjection, overlayProjection } from '../office/projection.js';
import { CharacterState, TILE_SIZE } from '../office/types.js';
import { roleAgents } from './demoAgents.js';
import {
  approachRect,
  areaWorldRect,
  mergeOverlapping,
  placeTooltip,
  type Rect,
  spotlightRect,
  unionRect,
} from './geometry.js';
import { type BodyContext, bodyKey, type Step, type Target } from './steps.js';

interface TourOverlayProps {
  step: Step;
  index: number;
  count: number;
  officeState: OfficeState;
  lan: LanAgents;
  containerRef: RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: MutableRefObject<{ x: number; y: number }>;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  /** What is true on this screen (picks the step text variant). */
  context: BodyContext;
}

/** Screen rect of a character sprite (world px → container px). */
function characterRect(os: OfficeState, id: number | undefined, p: OverlayProjection): Rect | null {
  const ch = id !== undefined ? os.characters.get(id) : undefined;
  if (!ch) return null;
  const feet = ch.y + (ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0);
  const x0 = p.toScreenX(ch.x - TILE_SIZE / 2);
  const y0 = p.toScreenY(feet - LAN_BUBBLE_HEAD_OFFSET);
  return { x: x0, y: y0, w: p.toScreenX(ch.x + TILE_SIZE / 2) - x0, h: p.toScreenY(feet) - y0 };
}

function domRect(sel: string): Rect | null {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
}

const tagRect = (key: string): Rect | null => domRect(`[data-agent-key="${CSS.escape(key)}"]`);

/** Holes (screen rects, not yet padded) for one target; [] when absent. */
function resolveTarget(
  target: Target,
  os: OfficeState,
  lan: LanAgents,
  p: OverlayProjection,
  origin: { x: number; y: number },
): Rect[] {
  const shift = (r: Rect | null): Rect | null =>
    r && { x: r.x + origin.x, y: r.y + origin.y, w: r.w, h: r.h };
  const world = (r: Rect | null): Rect | null => {
    if (!r) return null;
    const x = p.toScreenX(r.x);
    const y = p.toScreenY(r.y);
    return shift({ x, y, w: p.toScreenX(r.x + r.w) - x, h: p.toScreenY(r.y + r.h) - y });
  };
  const layout = os.getLayout();
  const some = (rs: (Rect | null)[]): Rect[] => {
    const u = unionRect(rs.filter((r): r is Rect => r !== null));
    return u ? [u] : [];
  };
  if ('dom' in target) return some([domRect(`[data-tour="${target.dom}"]`)]);
  if ('map' in target) {
    return some([world({ x: 0, y: 0, w: layout.cols * TILE_SIZE, h: layout.rows * TILE_SIZE })]);
  }
  if ('room' in target) {
    return some([
      world(areaWorldRect(layout.areaTiles, layout.cols, ROOM_LABELS[target.room], TILE_SIZE)),
    ]);
  }
  const pick = roleAgents(target.agent, lan.all());
  if (!pick) return [];
  const agentRects = (a: OfficeAgent) => [
    shift(characterRect(os, lan.idFor(a.key), p)),
    tagRect(a.key),
  ];
  if (target.agent === 'ghost') {
    const ghost = pick.focus.parentKey
      ? lan.ghostIdFor(pick.focus.parentKey, pick.focus.room)
      : undefined;
    return [
      ...some([...agentRects(pick.focus), shift(characterRect(os, ghost, p))]),
      ...(pick.parent ? some(agentRects(pick.parent)) : []),
    ];
  }
  return some([...agentRects(pick.focus), ...(pick.parent ? agentRects(pick.parent) : [])]);
}

const REDUCED_MOTION = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Even-odd path: the whole viewport minus every hole. */
function dimPath(w: number, h: number, holes: Rect[]): string {
  let d = `M0 0H${w}V${h}H0Z`;
  for (const r of holes) d += `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`;
  return d;
}

/**
 * Onboarding tour overlay: dims everything but the current step's targets,
 * blocks input outside them (inside too, unless the step is interactive) and
 * shows the step's text beside them. Re-rendered every frame so holes follow
 * walking characters, resizes and zoom.
 */
export function TourOverlay({
  step,
  index,
  count,
  officeState,
  lan,
  containerRef,
  zoom,
  panRef,
  onNext,
  onPrev,
  onSkip,
  context,
}: TourOverlayProps) {
  useLang();
  const [, setTick] = useState(0);
  const holesRef = useRef<Rect[]>([]);
  const tipRef = useRef<HTMLDivElement>(null);

  // Per frame: re-render, and keep the hover bubble forced on.
  const hoverRef = useRef(false);
  hoverRef.current = step.scene?.hover === true;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (hoverRef.current) {
        const pick = roleAgents('bubble', lan.all());
        officeState.hoveredAgentId = (pick && lan.idFor(pick.focus.key)) ?? null;
      }
      setTick((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lan, officeState]);
  useEffect(() => {
    if (!step.scene?.hover) return;
    return () => {
      officeState.hoveredAgentId = null;
    };
  }, [step, officeState]);

  // Focus belongs to the tooltip while the tour runs, and goes back afterwards.
  useEffect(() => {
    const prev = document.activeElement;
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, []);

  // The app is inert (no focus, no clicks, no keys) under the tour. On "try it"
  // steps only the map and the zoom buttons stay live, so the spotlight never
  // reaches the switcher or the toolbars that sit inside it.
  const interactive = step.interactive === true;
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const live = (c: Element) =>
      c.querySelector('canvas') !== null || c.matches('[data-tour="zoom"]');
    const els = (interactive ? [...root.children].filter((c) => !live(c)) : [root]).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    for (const e of els) e.inert = true;
    return () => {
      for (const e of els) e.inert = false;
    };
  }, [interactive, containerRef]);

  // Scroll a target inside a scrolling panel (Settings) into view, once per step.
  useEffect(() => {
    for (const tg of step.targets) {
      if ('dom' in tg) {
        document
          .querySelector(`[data-tour="${tg.dom}"]`)
          ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }, [step]);

  // Keys belong to the tour while it runs (the editor's Esc/R/Delete never fire).
  const keyRef = useRef({ onNext, onPrev, onSkip });
  keyRef.current = { onNext, onPrev, onSkip };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const tg = e.target;
      const typing =
        tg instanceof HTMLElement &&
        (tg.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tg.tagName));
      if (typing && e.key !== 'Escape') return;
      // Tab cycles inside the tooltip.
      if (e.key === 'Tab') {
        const btns = [...(tipRef.current?.querySelectorAll('button') ?? [])];
        if (btns.length === 0) return;
        e.preventDefault();
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const n = btns.length;
        btns[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
        return;
      }
      const k = keyRef.current;
      const keys: Record<string, (() => void) | undefined> = {
        Escape: k.onSkip,
        ArrowRight: k.onNext,
        ArrowLeft: k.onPrev,
      };
      const run = keys[e.key];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const view = { w: window.innerWidth, h: window.innerHeight };
  const el = containerRef.current;
  let holes: Rect[] = [];
  if (el) {
    const box = el.getBoundingClientRect();
    const p = overlayProjection(
      officeState.getLayout(),
      box,
      zoom,
      panRef.current,
      window.devicePixelRatio || 1,
    );
    for (const tg of step.targets) {
      for (const r of resolveTarget(tg, officeState, lan, p, { x: box.left, y: box.top })) {
        const s = spotlightRect(r, TOUR_SPOTLIGHT_PAD_PX, view, TOUR_VIEWPORT_MARGIN_PX);
        if (s) holes.push(s);
      }
    }
    holes = mergeOverlapping(holes);
  }
  // Glide from the previous holes; a different number of holes snaps.
  const prev = holesRef.current;
  const shown =
    prev.length === holes.length && !REDUCED_MOTION()
      ? holes.map((h, i) => approachRect(prev[i], h, TOUR_SPOTLIGHT_EASE))
      : holes;
  holesRef.current = shown;

  const tipEl = tipRef.current;
  const tipSize = tipEl ? { w: tipEl.offsetWidth, h: tipEl.offsetHeight } : null;
  const pos = tipSize
    ? placeTooltip(unionRect(holes), tipSize, view, TOUR_TOOLTIP_GAP_PX, TOUR_VIEWPORT_MARGIN_PX)
    : null;

  const last = index === count - 1;
  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: TOUR_Z_INDEX }}>
      <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
        <path
          d={dimPath(view.w, view.h, shown)}
          fill={TOUR_DIM_COLOR}
          fillRule="evenodd"
          className="pointer-events-auto"
        />
        {shown.map((r, i) => (
          <rect
            key={i}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill="none"
            stroke="var(--color-accent-bright)"
            strokeWidth={TOUR_OUTLINE_PX}
          />
        ))}
      </svg>
      {/* Look, don't touch: the spotlight is click-through only on "try it" steps. */}
      {!step.interactive && <div className="absolute inset-0 pointer-events-auto" />}
      <div
        ref={tipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-tooltip"
        className="absolute pixel-panel pointer-events-auto flex flex-col gap-6 py-8 px-12 text-sm leading-snug"
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          width: `min(${TOUR_TOOLTIP_MAX_WIDTH_PX}px, calc(100vw - ${2 * TOUR_VIEWPORT_MARGIN_PX}px))`,
        }}
      >
        <div className="flex items-center justify-between gap-8">
          <span id="tour-title" className="text-accent-bright text-base">
            {t(`tour.${step.id}.title`)}
          </span>
          <span className="text-xs text-text-muted shrink-0" data-testid="tour-counter">
            {index + 1} / {count}
          </span>
        </div>
        <p id="tour-body" aria-live="polite" className="m-0 whitespace-pre-line">
          {t(bodyKey(step.id, context))}
        </p>
        <div className="flex items-center gap-4 justify-end flex-wrap">
          {!last && (
            <Button size="sm" variant="ghost" className="mr-auto" onClick={onSkip}>
              {t('tour.skip')}
            </Button>
          )}
          <Button
            size="sm"
            variant={index === 0 ? 'disabled' : 'default'}
            aria-disabled={index === 0}
            onClick={index === 0 ? undefined : onPrev}
          >
            {t('tour.prev')}
          </Button>
          {/* Keyed per step so Enter/Space always means "next". */}
          <Button key={step.id} autoFocus size="sm" variant="accent" onClick={onNext}>
            {last ? t('tour.finish') : t('tour.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
