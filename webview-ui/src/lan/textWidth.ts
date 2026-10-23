/** Text widths for tag stacking and chat wrapping, measured once per string (cleared when web fonts finish loading). */
const textWidths = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;
document.fonts?.addEventListener('loadingdone', () => textWidths.clear());
export function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  let w = textWidths.get(key);
  if (w === undefined) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 0;
    measureCtx.font = font;
    w = measureCtx.measureText(text).width;
    textWidths.set(key, w);
  }
  return w;
}
