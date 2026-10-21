/**
 * Compact color control for carpet colors: a swatch + hex input that expands
 * into a popup with a saturation/brightness square and a vertical hue bar. The
 * picker panel only appears when the swatch/hex is clicked, and closes on an
 * outside click (matching the old carpet UI).
 *
 * The square is rendered with the SAME model the carpet renderer uses
 * (`flatColorizeSprite`): output is HSL where `lightness = 0.5 + b/200`. The
 * vertical axis is that brightness `b` (top = +100 → white, middle = 0 → pure
 * hue, bottom = -100 → black) and the horizontal axis is saturation. Drawing
 * the square from the renderer's formula keeps it what-you-see-is-what-you-get,
 * so the picked color matches the painted carpet exactly. ColorValue is emitted
 * with `colorize: true` and `c: 0`.
 *
 * Drag is captured at the document level via useEffect-managed listeners so the
 * marker keeps tracking when the cursor exits the picker bounds, matching
 * production color pickers (Photoshop, Figma).
 */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  VISUAL_COLOR_PICKER_COMPACT_WIDTH_PX,
  VISUAL_COLOR_PICKER_HUE_GRADIENT,
  VISUAL_COLOR_PICKER_HUE_WIDTH_PX,
  VISUAL_COLOR_PICKER_MARKER_BORDER,
  VISUAL_COLOR_PICKER_MARKER_RADIUS_PX,
  VISUAL_COLOR_PICKER_MARKER_SHADOW,
  VISUAL_COLOR_PICKER_POPUP_GAP_PX,
  VISUAL_COLOR_PICKER_SV_SIZE_PX,
  VISUAL_COLOR_PICKER_SWATCH_PX,
} from '../constants.js';
import { colorValueToHex, hexToColorValue, hslToRgb, lightnessFromB } from '../office/colorize.js';
import type { ColorValue } from './ui/types.js';

interface VisualColorPickerProps {
  value: ColorValue;
  onChange: (color: ColorValue) => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function VisualColorPicker({ value, onChange }: VisualColorPickerProps) {
  const svSize = VISUAL_COLOR_PICKER_SV_SIZE_PX;
  const hueWidth = VISUAL_COLOR_PICKER_HUE_WIDTH_PX;
  const markerR = VISUAL_COLOR_PICKER_MARKER_RADIUS_PX;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draggingSvRef = useRef(false);
  const draggingHueRef = useRef(false);

  const [inputHex, setInputHex] = useState(() => colorValueToHex(value));
  const [expanded, setExpanded] = useState(false);

  // Keep the hex field in sync with external changes, but not while it's focused.
  useEffect(() => {
    if (inputRef.current !== document.activeElement) {
      setInputHex(colorValueToHex(value));
    }
  }, [value]);

  // Paint the saturation × brightness square for the current hue.
  useEffect(() => {
    if (!expanded) return;
    const canvas = svCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(svSize, svSize);
    const data = img.data;
    for (let y = 0; y < svSize; y++) {
      const b = 100 - (y / (svSize - 1)) * 200;
      const l = lightnessFromB(b);
      for (let x = 0; x < svSize; x++) {
        const sat = (x / (svSize - 1)) * 100;
        const [r, g, bl] = hslToRgb(value.h, sat / 100, l);
        const i = (y * svSize + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = bl;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [value.h, expanded, svSize]);

  const pickFromSv = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);
      const s = Math.round(x * 100);
      const b = Math.round(100 - y * 200);
      onChange({ h: value.h, s, b, c: value.c, colorize: true });
    },
    [onChange, value.h, value.c],
  );

  const pickFromHue = useCallback(
    (clientY: number) => {
      const el = hueRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);
      onChange({ h: Math.round(y * 360), s: value.s, b: value.b, c: value.c, colorize: true });
    },
    [onChange, value.s, value.b, value.c],
  );

  const onSvMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingSvRef.current = true;
      pickFromSv(e.clientX, e.clientY);
    },
    [pickFromSv],
  );

  const onHueMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingHueRef.current = true;
      pickFromHue(e.clientY);
    },
    [pickFromHue],
  );

  // Document-level drag tracking so the cursor can leave the picker bounds.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingSvRef.current) pickFromSv(e.clientX, e.clientY);
      else if (draggingHueRef.current) pickFromHue(e.clientY);
    };
    const onUp = () => {
      draggingSvRef.current = false;
      draggingHueRef.current = false;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [pickFromSv, pickFromHue]);

  // Close the popup on an outside click.
  useEffect(() => {
    if (!expanded) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [expanded]);

  const handleHexChange = useCallback(
    (hex: string) => {
      setInputHex(hex);
      const parsed = hexToColorValue(hex);
      if (parsed) onChange({ ...parsed, c: value.c });
    },
    [onChange, value.c],
  );

  const previewHex = colorValueToHex(value);

  const svMarkerStyle: CSSProperties = {
    position: 'absolute',
    left: `${(value.s / 100) * svSize - markerR}px`,
    top: `${((100 - value.b) / 200) * svSize - markerR}px`,
    width: markerR * 2,
    height: markerR * 2,
    borderRadius: '50%',
    border: VISUAL_COLOR_PICKER_MARKER_BORDER,
    boxShadow: VISUAL_COLOR_PICKER_MARKER_SHADOW,
    pointerEvents: 'none',
    backgroundColor: previewHex,
  };

  const hueMarkerStyle: CSSProperties = {
    position: 'absolute',
    left: -2,
    top: `${(value.h / 360) * svSize - markerR}px`,
    width: hueWidth + 4,
    height: markerR * 2,
    border: VISUAL_COLOR_PICKER_MARKER_BORDER,
    boxShadow: VISUAL_COLOR_PICKER_MARKER_SHADOW,
    pointerEvents: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Collapsed: swatch + hex — click to expand the picker popup. */}
      <div
        className="flex items-center gap-3 cursor-pointer"
        style={{ width: VISUAL_COLOR_PICKER_COMPACT_WIDTH_PX }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          className="border-2 border-border"
          style={{
            width: VISUAL_COLOR_PICKER_SWATCH_PX,
            height: VISUAL_COLOR_PICKER_SWATCH_PX,
            backgroundColor: previewHex,
            flexShrink: 0,
          }}
        />
        <input
          ref={inputRef}
          type="text"
          value={inputHex}
          onChange={(e) => handleHexChange(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="flex-1 min-w-0 bg-bg text-text border-2 border-border px-2 py-0.5 font-mono text-[12px]"
          spellCheck={false}
          maxLength={7}
        />
      </div>

      {/* Expanded: popup to the right of the trigger, bottom-aligned. */}
      {expanded && (
        <div
          className="absolute z-20 flex flex-col gap-4 py-4 px-6 bg-bg-dark border-2 border-border"
          style={{ left: '100%', bottom: 0, marginLeft: VISUAL_COLOR_PICKER_POPUP_GAP_PX }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-row gap-8 items-start">
            <div className="relative" style={{ width: svSize, height: svSize }}>
              <canvas
                ref={svCanvasRef}
                width={svSize}
                height={svSize}
                style={{ width: svSize, height: svSize, cursor: 'crosshair' }}
                onMouseDown={onSvMouseDown}
              />
              <div style={svMarkerStyle} />
            </div>
            <div
              ref={hueRef}
              className="relative"
              style={{
                width: hueWidth,
                height: svSize,
                backgroundImage: VISUAL_COLOR_PICKER_HUE_GRADIENT,
                cursor: 'crosshair',
              }}
              onMouseDown={onHueMouseDown}
            >
              <div style={hueMarkerStyle} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
