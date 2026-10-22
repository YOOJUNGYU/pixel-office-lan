import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import { ColorPicker } from '../../components/ui/ColorPicker.js';
import { ItemSelect } from '../../components/ui/ItemSelect.js';
import type { ColorValue } from '../../components/ui/types.js';
import { VisualColorPicker } from '../../components/VisualColorPicker.js';
import {
  BACKGROUND_CARPET_PATCH_TILES,
  BACKGROUND_DEFAULT_CARPET_VARIANT,
  BACKGROUND_DEFAULT_COLOR,
  BACKGROUND_DEFAULT_FLOOR_COLOR,
  BACKGROUND_DEFAULT_FLOOR_PATTERN,
  CANVAS_FALLBACK_TILE_COLOR,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
} from '../../constants.js';
import { areaName, t, useLang } from '../../i18n.js';
import type { BackgroundFill } from '../background.js';
import { resolveBackground } from '../background.js';
import { getColorizedSprite, hexToColorValue } from '../colorize.js';
import { getColorizedFloorSprite, getFloorPatternCount, hasFloorSprites } from '../floorTiles.js';
import type { FurnitureCategory, LoadedAssetData } from '../layout/furnitureCatalog.js';
import {
  buildDynamicCatalog,
  getActiveCategories,
  getCatalogByCategory,
} from '../layout/furnitureCatalog.js';
import {
  getCarpetJunctionSprite,
  getCarpetPatchSprite,
  getCarpetSetCount,
  hasCarpetSprites,
} from '../sprites/carpetTiles.js';
import { getCachedSprite } from '../sprites/spriteCache.js';
import type {
  BackgroundKind as BackgroundKindVal,
  CarpetTile,
  OfficeBackground,
  SpriteData,
  TileType as TileTypeVal,
} from '../types.js';
import { BackgroundKind, EditTool } from '../types.js';
import { getWallSetCount, getWallSetPreviewSprite } from '../wallTiles.js';

/** Synthetic category id used to show the carpet sub-panel inside the Furniture tab. */
const CARPET_CATEGORY_ID = '__carpet__' as const;
type CarpetCategoryId = typeof CARPET_CATEGORY_ID;
type FurniturePanelCategory = FurnitureCategory | CarpetCategoryId;

interface EditorToolbarProps {
  activeTool: EditTool;
  selectedTileType: TileTypeVal;
  selectedFurnitureType: string;
  selectedFurnitureUid: string | null;
  selectedFurnitureColor: ColorValue | null;
  floorColor: ColorValue;
  wallColor: ColorValue;
  selectedWallSet: number;
  onToolChange: (tool: EditTool) => void;
  onTileTypeChange: (type: TileTypeVal) => void;
  onFloorColorChange: (color: ColorValue) => void;
  onWallColorChange: (color: ColorValue) => void;
  onWallSetChange: (setIndex: number) => void;
  onSelectedFurnitureColorChange: (color: ColorValue | null) => void;
  /** Color applied to newly placed furniture (tints the palette + ghost). */
  pickedFurnitureColor: ColorValue | null;
  onPickedFurnitureColorChange: (color: ColorValue | null) => void;
  /** Arm/disarm the colour-only eyedropper offered by the colour sliders. */
  onColorPickToggle: () => void;
  onFurnitureTypeChange: (type: string) => void;
  loadedAssets?: LoadedAssetData;
  // Carpet state + handlers
  carpetVariant: number;
  carpetColor: ColorValue;
  carpetAccentColor: ColorValue;
  onCarpetVariantChange: (variant: number) => void;
  onCarpetColorChange: (color: ColorValue) => void;
  onCarpetAccentColorChange: (color: ColorValue) => void;
  /** Labels of rooms with no walkable tile (agents headed there sit anywhere). */
  emptyRooms: string[];
  background: OfficeBackground | undefined;
  onBackgroundChange: (background: OfficeBackground, continuous: boolean) => void;
}

const THUMB_ZOOM = 2;

const DEFAULT_FURNITURE_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

export function EditorToolbar({
  activeTool,
  selectedTileType,
  selectedFurnitureType,
  selectedFurnitureUid,
  selectedFurnitureColor,
  floorColor,
  wallColor,
  selectedWallSet,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onWallColorChange,
  onWallSetChange,
  onSelectedFurnitureColorChange,
  pickedFurnitureColor,
  onPickedFurnitureColorChange,
  onColorPickToggle,
  onFurnitureTypeChange,
  loadedAssets,
  carpetVariant,
  carpetColor,
  carpetAccentColor,
  onCarpetVariantChange,
  onCarpetColorChange,
  onCarpetAccentColorChange,
  emptyRooms,
  background,
  onBackgroundChange,
}: EditorToolbarProps) {
  useLang();
  const [activeCategory, setActiveCategory] = useState<FurniturePanelCategory>('desks');
  const [showColor, setShowColor] = useState(false);
  const [showWallColor, setShowWallColor] = useState(false);
  const [showFurnitureColor, setShowFurnitureColor] = useState(false);
  const [showCarpetColor, setShowCarpetColor] = useState(false);

  // Build dynamic catalog from loaded assets
  useEffect(() => {
    if (loadedAssets) {
      try {
        console.log(
          `[EditorToolbar] Building dynamic catalog with ${loadedAssets.catalog.length} assets...`,
        );
        const success = buildDynamicCatalog(loadedAssets);
        console.log(`[EditorToolbar] Catalog build result: ${success}`);

        // Reset to first available category if current doesn't exist
        const activeCategories = getActiveCategories();
        if (activeCategories.length > 0) {
          const firstCat = activeCategories[0]?.id;
          if (firstCat) {
            console.log(`[EditorToolbar] Setting active category to: ${firstCat}`);
            setActiveCategory(firstCat);
          }
        }
      } catch (err) {
        console.error(`[EditorToolbar] Error building dynamic catalog:`, err);
      }
    }
  }, [loadedAssets]);

  // For selected furniture: use existing color or default
  const effectiveColor = selectedFurnitureColor ?? DEFAULT_FURNITURE_COLOR;

  const categoryItems =
    activeCategory === CARPET_CATEGORY_ID ? [] : getCatalogByCategory(activeCategory);

  const patternCount = getFloorPatternCount();
  // Wall is TileType 0, floor patterns are 1..patternCount
  const floorPatterns = Array.from({ length: patternCount }, (_, i) => i + 1);

  const thumbSize = 42; // 2x for items

  const isFloorActive = activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER;
  const isWallActive = activeTool === EditTool.WALL_PAINT;
  const isEraseActive = activeTool === EditTool.ERASE;
  const isCarpetActive =
    activeTool === EditTool.CARPET_PAINT || activeTool === EditTool.CARPET_PICK;
  // Furniture button stays "active" while editing carpets — they live inside this panel.
  const isFurnitureActive =
    activeTool === EditTool.FURNITURE_PLACE ||
    activeTool === EditTool.FURNITURE_PICK ||
    // Colour eyedropper armed from the new-furniture sliders: this panel holds
    // them, so it has to stay open while the user goes to click an item.
    (activeTool === EditTool.COLOR_PICK && !selectedFurnitureUid) ||
    isCarpetActive;
  const isBackgroundActive = activeTool === EditTool.BACKGROUND;
  const isColorPicking = activeTool === EditTool.COLOR_PICK;
  const carpetVariantCount = getCarpetSetCount();

  /**
   * Draw a small carpet patch into the variant thumbnail. Rendering a 2×1 strip
   * (rather than a single interior tile) means the patch's outer edges resolve
   * to perimeter marching-squares cases, so the accent trim — which never
   * appears on the solid interior piece — is visible in the preview.
   */
  const drawCarpetPreview = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    variant: number,
  ): void => {
    if (!hasCarpetSprites()) {
      ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const previewCols = 2;
    const previewRows = 1;
    const tileSize = 16;
    const originX = Math.floor((w - previewCols * tileSize) / 2);
    const originY = Math.floor((h - previewRows * tileSize) / 2);
    const tile: CarpetTile = { variant, color: carpetColor, accentColor: carpetAccentColor };
    // 2×1 strip; trailing nulls are out of bounds and ignored by tileHasVariant.
    const fake: Array<CarpetTile | null> = [tile, tile];
    for (let jy = 0; jy <= previewRows; jy++) {
      for (let jx = 0; jx <= previewCols; jx++) {
        const sprite: SpriteData | null = getCarpetJunctionSprite(
          jx,
          jy,
          variant,
          fake,
          previewCols,
          previewRows,
          carpetColor,
          carpetAccentColor,
        );
        if (!sprite) continue;
        ctx.drawImage(
          getCachedSprite(sprite, 1),
          originX + jx * tileSize - tileSize / 2,
          originY + jy * tileSize - tileSize / 2,
        );
      }
    }
  };

  return (
    <div
      data-tour="editor-toolbar"
      className="absolute bottom-76 left-10 z-10 pixel-panel p-4 flex flex-col-reverse gap-4 max-w-[calc(100vw-20px)]"
    >
      {/* Tool row — at the bottom */}
      <div className="flex gap-4 flex-wrap">
        <Button
          variant={isFurnitureActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.FURNITURE_PLACE)}
          title={t('editor.furnitureTitle')}
        >
          {t('editor.furniture')}
        </Button>
        <Button
          variant={isFloorActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.TILE_PAINT)}
          title={t('editor.floorTitle')}
        >
          {t('editor.floor')}
        </Button>
        <Button
          variant={isWallActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.WALL_PAINT)}
          title={t('editor.wallsTitle')}
        >
          {t('editor.walls')}
        </Button>
        <Button
          variant={isBackgroundActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.BACKGROUND)}
          title={t('editor.backgroundTitle')}
        >
          {t('editor.background')}
        </Button>
        <Button
          variant={isEraseActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.ERASE)}
          data-tour="editor-erase"
          title={t('editor.eraseTitle')}
        >
          {t('editor.erase')}
        </Button>
      </div>

      {/* Sub-panel: Floor tiles — stacked bottom-to-top via column-reverse */}
      {isFloorActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Copy + Color toggle — just above tool row */}
          <div className="flex gap-4 items-center">
            <Button
              variant={activeTool === EditTool.EYEDROPPER ? 'active' : 'ghost'}
              size="sm"
              onClick={() => onToolChange(EditTool.EYEDROPPER)}
              title={t('editor.copyFloorTitle')}
            >
              {t('editor.copy')}
            </Button>
            <Button
              variant={showColor ? 'active' : 'ghost'}
              size="sm"
              onClick={() => setShowColor((v) => !v)}
              title={t('editor.floorColorTitle')}
            >
              {t('editor.color')}
            </Button>
          </div>

          {/* Floor pattern horizontal carousel — below the color controls */}
          <div className="carousel">
            {floorPatterns.map((patIdx) => (
              <ItemSelect
                key={patIdx}
                width={32}
                height={32}
                selected={selectedTileType === patIdx}
                onClick={() => onTileTypeChange(patIdx as TileTypeVal)}
                title={t('editor.floorItem', { t: String(patIdx) })}
                deps={[patIdx, floorColor]}
                draw={(ctx, w, h) => {
                  if (!hasFloorSprites()) {
                    ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                    ctx.fillRect(0, 0, w, h);
                    return;
                  }
                  const sprite = getColorizedFloorSprite(patIdx, floorColor);
                  ctx.drawImage(getCachedSprite(sprite, THUMB_ZOOM), 0, 0);
                }}
              />
            ))}
          </div>

          {/* Color controls (collapsible) — at the top, above the previews. */}
          {showColor && <TileColorBox value={floorColor} onChange={onFloorColorChange} />}
        </div>
      )}

      {/* Sub-panel: Wall — stacked bottom-to-top via column-reverse */}
      {isWallActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Color toggle — just above tool row */}
          <div className="flex gap-4 items-center">
            <Button
              variant={showWallColor ? 'active' : 'default'}
              size="sm"
              onClick={() => setShowWallColor((v) => !v)}
              title={t('editor.wallColorTitle')}
            >
              {t('editor.color')}
            </Button>
          </div>

          {/* Wall set picker — horizontal carousel, below the color controls */}
          {getWallSetCount() > 0 && (
            <div className="carousel">
              {Array.from({ length: getWallSetCount() }, (_, i) => (
                <ItemSelect
                  key={i}
                  width={32}
                  height={64}
                  selected={selectedWallSet === i}
                  onClick={() => onWallSetChange(i)}
                  title={t('editor.wallItem', { t: String(i + 1) })}
                  deps={[i, wallColor]}
                  draw={(ctx, w, h) => {
                    const sprite = getWallSetPreviewSprite(i);
                    if (!sprite) {
                      ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                      ctx.fillRect(0, 0, w, h);
                      return;
                    }
                    const cacheKey = `wall-preview-${i}-${wallColor.h}-${wallColor.s}-${wallColor.b}-${wallColor.c}`;
                    const colorized = getColorizedSprite(cacheKey, sprite, {
                      ...wallColor,
                      colorize: true,
                    });
                    ctx.drawImage(getCachedSprite(colorized, THUMB_ZOOM), 0, 0);
                  }}
                />
              ))}
            </div>
          )}

          {/* Color controls (collapsible) — at the top, above the previews. */}
          {showWallColor && <TileColorBox value={wallColor} onChange={onWallColorChange} />}
        </div>
      )}

      {isBackgroundActive && (
        <BackgroundPanel
          fill={resolveBackground(background, {
            floorPatterns: patternCount,
            carpetVariants: carpetVariantCount,
          })}
          onChange={onBackgroundChange}
          floorPatterns={floorPatterns}
          carpetVariantCount={carpetVariantCount}
        />
      )}

      <EmptyRoomsWarning labels={emptyRooms} />

      {/* Sub-panel: Furniture — stacked bottom-to-top via column-reverse */}
      {isFurnitureActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Category tabs + contextual Copy button — just above tool row */}
          <div className="flex gap-4 flex-wrap items-center">
            {getActiveCategories().map((cat) => (
              <Button
                key={cat.id}
                variant={activeCategory === cat.id ? 'active' : 'ghost'}
                size="sm"
                onClick={() => {
                  setActiveCategory(cat.id);
                  // Leaving carpet sub-panel → snap back to FURNITURE_PLACE
                  if (isCarpetActive) {
                    onToolChange(EditTool.FURNITURE_PLACE);
                  }
                }}
              >
                {t(`category.${cat.id}`)}
              </Button>
            ))}
            {carpetVariantCount > 0 && (
              <Button
                variant={activeCategory === CARPET_CATEGORY_ID ? 'active' : 'ghost'}
                size="sm"
                onClick={() => {
                  setActiveCategory(CARPET_CATEGORY_ID);
                  onToolChange(EditTool.CARPET_PAINT);
                }}
                title={t('editor.carpetTitle')}
              >
                {t('editor.carpet')}
              </Button>
            )}
            <div className="w-[1px] h-14 bg-white/15 mx-2 shrink-0" />
            {/* Color toggle — available across the whole Furniture tab. Carpet
                edits main+accent; other categories edit the new-furniture color. */}
            <Button
              variant={
                (activeCategory === CARPET_CATEGORY_ID ? showCarpetColor : showFurnitureColor)
                  ? 'active'
                  : 'ghost'
              }
              size="sm"
              onClick={() =>
                activeCategory === CARPET_CATEGORY_ID
                  ? setShowCarpetColor((v) => !v)
                  : setShowFurnitureColor((v) => !v)
              }
              title={
                activeCategory === CARPET_CATEGORY_ID
                  ? t('editor.carpetColorTitle')
                  : t('editor.furnitureColorTitle')
              }
            >
              {t('editor.color')}
            </Button>
            {/* Copy — the eyedropper tools, named for what they do: take the
                settings off something already placed. */}
            {activeCategory === CARPET_CATEGORY_ID ? (
              <Button
                variant={activeTool === EditTool.CARPET_PICK ? 'active' : 'ghost'}
                size="sm"
                onClick={() =>
                  onToolChange(
                    activeTool === EditTool.CARPET_PICK
                      ? EditTool.CARPET_PAINT
                      : EditTool.CARPET_PICK,
                  )
                }
                title={t('editor.copyCarpetTitle')}
              >
                {t('editor.copy')}
              </Button>
            ) : (
              <Button
                variant={activeTool === EditTool.FURNITURE_PICK ? 'active' : 'ghost'}
                size="sm"
                onClick={() => onToolChange(EditTool.FURNITURE_PICK)}
                title={t('editor.copyFurnitureTitle')}
              >
                {t('editor.copy')}
              </Button>
            )}
          </div>

          {/* Carpet sub-panel: variant carousel + compact color controls.
              Column-reverse stacks the pickers on top, then the variant
              previews, then the category tabs. */}
          {activeCategory === CARPET_CATEGORY_ID && (
            <>
              {/* Variant carousel — below the color controls */}
              <div className="carousel">
                {Array.from({ length: carpetVariantCount }, (_, i) => i).map((variantIdx) => (
                  <ItemSelect
                    key={variantIdx}
                    width={48}
                    height={32}
                    selected={carpetVariant === variantIdx}
                    onClick={() => {
                      onCarpetVariantChange(variantIdx);
                      if (activeTool !== EditTool.CARPET_PAINT) {
                        onToolChange(EditTool.CARPET_PAINT);
                      }
                    }}
                    title={t('editor.carpetItem', { t: String(variantIdx + 1) })}
                    deps={[variantIdx, carpetColor, carpetAccentColor]}
                    draw={(ctx, w, h) => drawCarpetPreview(ctx, w, h, variantIdx)}
                  />
                ))}
              </div>

              {/* Compact Main/Accent pickers — collapsible, at the top.
                  Each is a swatch + hex that opens its picker popup on click. */}
              {showCarpetColor && (
                <div className="flex gap-8 ml-2 mb-6 -mt-6">
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-[0.08em] text-text-muted">
                      {t('editor.main')}
                    </span>
                    <VisualColorPicker value={carpetColor} onChange={onCarpetColorChange} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-[0.08em] text-text-muted">
                      {t('editor.accent')}
                    </span>
                    <VisualColorPicker
                      value={carpetAccentColor}
                      onChange={onCarpetAccentColorChange}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Furniture items grid — hidden when carpet category is active.
              Thumbnails preview the new-furniture color so you see what places. */}
          {activeCategory !== CARPET_CATEGORY_ID && (
            <div className="carousel">
              {categoryItems.map((entry) => (
                <ItemSelect
                  key={entry.type}
                  width={thumbSize}
                  height={thumbSize}
                  selected={selectedFurnitureType === entry.type}
                  onClick={() => onFurnitureTypeChange(entry.type)}
                  title={entry.label}
                  deps={[entry.type, entry.sprite, pickedFurnitureColor]}
                  draw={(ctx, w, h) => {
                    const sprite = pickedFurnitureColor
                      ? getColorizedSprite(
                          `thumb-${entry.type}-${pickedFurnitureColor.h}-${pickedFurnitureColor.s}-${pickedFurnitureColor.b}-${pickedFurnitureColor.c}-${pickedFurnitureColor.colorize ?? ''}`,
                          entry.sprite,
                          pickedFurnitureColor,
                        )
                      : entry.sprite;
                    const cached = getCachedSprite(sprite, 2);
                    const scale = Math.min(w / cached.width, h / cached.height) * 0.85;
                    const dw = cached.width * scale;
                    const dh = cached.height * scale;
                    ctx.drawImage(cached, (w - dw) / 2, (h - dh) / 2, dw, dh);
                  }}
                />
              ))}
            </div>
          )}

          {/* New-furniture color picker — collapsible, above the palette. Editing
              an already-placed selection is handled by the panel below. */}
          {activeCategory !== CARPET_CATEGORY_ID && showFurnitureColor && !selectedFurnitureUid && (
            <ColorPicker
              value={pickedFurnitureColor ?? DEFAULT_FURNITURE_COLOR}
              onChange={onPickedFurnitureColorChange}
              showColorizeToggle
              onCopy={onColorPickToggle}
              copyActive={isColorPicking}
              onReset={() => onPickedFurnitureColorChange(null)}
            />
          )}
        </div>
      )}

      {/* Selected furniture color panel — shows when any placed furniture item
          is selected. Selecting an item is already the deliberate act, so the
          sliders open straight away rather than behind a Color toggle, and
          restoring the original sprite is the picker's own Reset (same control
          the new-furniture picker offers). */}
      {selectedFurnitureUid && (
        <ColorPicker
          value={effectiveColor}
          onChange={onSelectedFurnitureColorChange}
          showColorizeToggle
          onCopy={onColorPickToggle}
          copyActive={isColorPicking}
          onReset={() => onSelectedFurnitureColorChange(null)}
        />
      )}
    </div>
  );
}

/** A starting background for each kind, chosen when the user switches kind. */
function defaultBackground(kind: BackgroundKindVal): OfficeBackground {
  switch (kind) {
    case BackgroundKind.FLOOR:
      return {
        kind,
        pattern: BACKGROUND_DEFAULT_FLOOR_PATTERN,
        color: BACKGROUND_DEFAULT_FLOOR_COLOR,
      };
    case BackgroundKind.CARPET:
      return {
        kind,
        pattern: BACKGROUND_DEFAULT_CARPET_VARIANT,
        color: CARPET_DEFAULT_COLOR,
        accent: CARPET_DEFAULT_ACCENT_COLOR,
      };
    default:
      return { kind: BackgroundKind.COLOR, color: BACKGROUND_DEFAULT_COLOR };
  }
}

const BACKGROUND_KINDS: BackgroundKindVal[] = [
  BackgroundKind.COLOR,
  BackgroundKind.FLOOR,
  BackgroundKind.CARPET,
];

/** Fill a thumbnail with the repeating rug a carpet background uses. */
function drawCarpetBackgroundPreview(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  variant: number,
  color: ColorValue,
  accent: ColorValue,
): void {
  const sprite = getCarpetPatchSprite(variant, color, accent, BACKGROUND_CARPET_PATCH_TILES);
  const pattern = sprite ? ctx.createPattern(getCachedSprite(sprite, THUMB_ZOOM), 'repeat') : null;
  ctx.fillStyle = pattern ?? CANVAS_FALLBACK_TILE_COLOR;
  ctx.fillRect(0, 0, w, h);
}

/** Background tab: kind selector, then the controls for that kind. */
function BackgroundPanel({
  fill,
  onChange,
  floorPatterns,
  carpetVariantCount,
}: {
  fill: BackgroundFill;
  onChange: (background: OfficeBackground, continuous: boolean) => void;
  floorPatterns: number[];
  carpetVariantCount: number;
}) {
  return (
    <div className="flex flex-col-reverse gap-4">
      <div className="flex gap-4 items-center">
        {BACKGROUND_KINDS.map((kind) => (
          <Button
            key={kind}
            variant={fill.kind === kind ? 'active' : 'ghost'}
            size="sm"
            onClick={() => fill.kind !== kind && onChange(defaultBackground(kind), false)}
          >
            {t(`editor.background.${kind}`)}
          </Button>
        ))}
        {fill.kind === 'none' && (
          <span className="text-xs text-text-muted px-4">{t('editor.backgroundHint')}</span>
        )}
      </div>

      {fill.kind === 'color' && (
        <div className="flex items-center gap-8 ml-2">
          <span className="text-sm text-text-muted">{t('editor.color')}</span>
          <VisualColorPicker
            value={hexToColorValue(fill.css) ?? BACKGROUND_DEFAULT_COLOR}
            onChange={(color) => onChange({ kind: BackgroundKind.COLOR, color }, true)}
          />
        </div>
      )}

      {fill.kind === 'floor' && (
        <>
          <div className="carousel">
            {floorPatterns.map((patIdx) => (
              <ItemSelect
                key={patIdx}
                width={32}
                height={32}
                selected={fill.pattern === patIdx}
                onClick={() =>
                  onChange({ ...fill, kind: BackgroundKind.FLOOR, pattern: patIdx }, false)
                }
                title={t('editor.floorItem', { t: String(patIdx) })}
                deps={[patIdx, fill.color]}
                draw={(ctx) => {
                  const sprite = getColorizedFloorSprite(patIdx, fill.color);
                  ctx.drawImage(getCachedSprite(sprite, THUMB_ZOOM), 0, 0);
                }}
              />
            ))}
          </div>
          <TileColorBox
            value={fill.color}
            onChange={(color) => onChange({ ...fill, kind: BackgroundKind.FLOOR, color }, true)}
          />
        </>
      )}

      {fill.kind === 'carpet' && (
        <>
          <div className="carousel">
            {Array.from({ length: carpetVariantCount }, (_, i) => i).map((variant) => (
              <ItemSelect
                key={variant}
                width={48}
                height={32}
                selected={fill.variant === variant}
                onClick={() =>
                  onChange(
                    {
                      kind: BackgroundKind.CARPET,
                      pattern: variant,
                      color: fill.color,
                      accent: fill.accent,
                    },
                    false,
                  )
                }
                title={t('editor.carpetItem', { t: String(variant + 1) })}
                deps={[variant, fill.color, fill.accent]}
                draw={(ctx, w, h) =>
                  drawCarpetBackgroundPreview(ctx, w, h, variant, fill.color, fill.accent)
                }
              />
            ))}
          </div>
          <div className="flex gap-8 ml-2">
            {(['color', 'accent'] as const).map((key) => (
              <div key={key} className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.08em] text-text-muted">
                  {t(key === 'color' ? 'editor.main' : 'editor.accent')}
                </span>
                <VisualColorPicker
                  value={fill[key]}
                  onChange={(c) =>
                    onChange(
                      {
                        kind: BackgroundKind.CARPET,
                        pattern: fill.variant,
                        color: key === 'color' ? c : fill.color,
                        accent: key === 'accent' ? c : fill.accent,
                      },
                      true,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Floor/wall color control: a boxed panel with a "Color" row (carpet-style
 * swatch + hex that opens the visual picker) and a "Contrast" row. Floors and
 * walls always colorize, so there's no colorize toggle — just hue/sat/bright
 * via the popup, plus contrast (which matters since colorizeSprite uses each
 * pattern pixel's luminance).
 */
function TileColorBox({
  value,
  onChange,
}: {
  value: ColorValue;
  onChange: (color: ColorValue) => void;
}) {
  const contrastFill = ((value.c + 100) / 200) * 100;
  return (
    <div className="flex flex-col gap-4 py-8 px-10 bg-bg-dark border-2 border-border rounded-none">
      <div className="flex items-center gap-8">
        <span className="text-sm text-text-muted w-64 shrink-0">{t('editor.color')}</span>
        <VisualColorPicker value={value} onChange={onChange} />
      </div>
      <div className="flex items-center gap-8">
        <span className="text-sm text-text-muted w-64 shrink-0">{t('editor.contrast')}</span>
        <input
          type="range"
          min={-100}
          max={100}
          value={value.c}
          onChange={(e) => onChange({ ...value, c: Number(e.target.value) })}
          className="pixel-range flex-1 min-w-0"
          style={{ '--range-fill': `${contrastFill}%` } as CSSProperties}
        />
        <span className="text-sm text-text w-44 text-right shrink-0 tabular-nums">{value.c}</span>
      </div>
    </div>
  );
}

// ── Rooms ───────────────────────────────────────────

/** One line per room with no walkable tile; nothing when every room has floor. */
export function EmptyRoomsWarning({ labels }: { labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <div data-testid="empty-rooms-warning" className="flex flex-col gap-2 px-4 text-xs text-danger">
      {labels.map((l) => (
        <span key={l}>{t('editor.emptyRoom', { room: areaName(l) })}</span>
      ))}
    </div>
  );
}
