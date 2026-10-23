import { useCallback, useRef, useState } from 'react';

import type { ColorValue } from '../components/ui/types.js';
import {
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  LAYOUT_SAVE_ACK_TIMEOUT_MS,
  LAYOUT_SAVE_DEBOUNCE_MS,
  ZOOM_DEFAULT_DPR_FACTOR,
  ZOOM_MIN,
} from '../constants.js';
import {
  dropFurniture,
  eraseCarpet,
  eraseTile,
  floorFillRegion,
  furnitureAt,
  isFloorTile,
  paintCarpet,
  paintTiles,
  placeNewFurniture,
  recolorWalls,
  removeFurniture,
  rotateFurniture,
  toggleFurnitureState,
  wallStrokeAdds,
  wallStrokeTile,
} from '../office/editor/editorActions.js';
import type { EditorState } from '../office/editor/editorState.js';
import { saveThenExit } from '../office/editor/saveFlow.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getRotatedType, getToggledType } from '../office/layout/furnitureCatalog.js';
import type {
  EditTool as EditToolType,
  OfficeBackground,
  OfficeLayout,
  TileType as TileTypeVal,
} from '../office/types.js';
import { EditTool } from '../office/types.js';
import { TileType } from '../office/types.js';
import { clampZoom } from '../office/zoomAtPoint.js';
import { transport } from '../transport/index.js';
import type { FurnitureColorActions } from './useFurnitureColorActions.js';
import { useFurnitureColorActions } from './useFurnitureColorActions.js';

interface EditorActions extends Omit<FurnitureColorActions, 'pickColorAt'> {
  isEditMode: boolean;
  editorTick: number;
  isDirty: boolean;
  zoom: number;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /** Clear the dirty flag (used after a browser import applies a new saved baseline). */
  markClean: () => void;
  handleToggleEditMode: () => void;
  handleToolChange: (tool: EditToolType) => void;
  handleTileTypeChange: (type: TileTypeVal) => void;
  handleFloorColorChange: (color: ColorValue) => void;
  handleWallColorChange: (color: ColorValue) => void;
  handleWallSetChange: (setIndex: number) => void;
  handleFurnitureTypeChange: (type: string) => void; // FurnitureType enum or asset ID
  handleDeleteSelected: () => void;
  handleRotateSelected: () => void;
  handleToggleState: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleExitEditMode: () => void;
  /** Save, then leave edit mode on the server's `layoutSaved` (see saveThenExit); `onTimeout` when no answer comes. */
  handleSave: (onTimeout: () => void) => void;
  handleZoomChange: (zoom: number) => void;
  handleEditorTileAction: (col: number, row: number) => void;
  handleEditorEraseAction: (col: number, row: number) => void;
  handleEditorSelectionChange: () => void;
  /** A furniture drag released at (col,row): move it there, or drop a copy with `duplicate`. */
  handleDrop: (uid: string, col: number, row: number, opts: { duplicate: boolean }) => void;
  // Carpet state + handlers
  carpetVariant: number;
  carpetColor: ColorValue;
  carpetAccentColor: ColorValue;
  handleCarpetVariantChange: (variant: number) => void;
  handleCarpetColorChange: (color: ColorValue) => void;
  handleCarpetAccentColorChange: (color: ColorValue) => void;
  handleResetCarpetColor: () => void;
  handleResetCarpetAccentColor: () => void;
  /** Set the map background. `continuous` = a slider/picker drag: one undo entry per run. */
  handleBackgroundChange: (background: OfficeBackground, continuous: boolean) => void;
}

/** Default integer zoom (device pixels per sprite pixel) for a fresh session.
 *  Lives here, with the zoom state it seeds, rather than in the office modules:
 *  it reads `devicePixelRatio`, and a viewport concern in a state module drags
 *  the DOM into every graph that imports it (OfficeState's included). */
function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}

export function useEditorActions(
  getOfficeState: () => OfficeState,
  editorState: EditorState,
): EditorActions {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [zoom, setZoom] = useState(defaultZoom);
  const [carpetVariant, setCarpetVariantState] = useState<number>(editorState.carpetVariant);
  const [carpetColor, setCarpetColorState] = useState<ColorValue>(editorState.carpetColor);
  const [carpetAccentColor, setCarpetAccentColorState] = useState<ColorValue>(
    editorState.carpetAccentColor,
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panRef = useRef({ x: 0, y: 0 });

  // Clear the dirty flag after a browser layout import: the imported layout is the
  // new saved baseline (already persisted via saveLayout). setIsDirty also forces a
  // re-render so dirty-gated UI (EditActionBar, areasAvailable) reflects the import.
  const markClean = useCallback(() => {
    editorState.isDirty = false;
    setIsDirty(false);
  }, [editorState]);

  // Debounced layout save
  const saveLayout = useCallback((layout: OfficeLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      transport.send({ type: 'saveLayout', layout: layout as unknown as Record<string, unknown> });
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, []);

  const bumpTick = useCallback(() => setEditorTick((n) => n + 1), []);

  /**
   * Apply a layout edit: rebuild state, save, mark dirty — and push undo
   * unless the edit continues the undo session the newest entry already
   * covers (a stroke, a slider run; see EditorState.beginEdit). An edit that
   * returns the current layout unchanged is a no-op.
   */
  const commitLayout = useCallback(
    (newLayout: OfficeLayout, session: string | null) => {
      const os = getOfficeState();
      if (newLayout === os.getLayout()) return; // the edit changed nothing
      if (editorState.beginEdit(session)) {
        editorState.pushUndo(os.getLayout());
        editorState.clearRedo();
      }
      editorState.isDirty = true;
      setIsDirty(true);
      os.rebuildFromLayout(newLayout);
      saveLayout(newLayout);
      bumpTick();
    },
    [getOfficeState, editorState, saveLayout, bumpTick],
  );

  /** A discrete edit: always its own undo entry. */
  const applyEdit = useCallback(
    (newLayout: OfficeLayout) => commitLayout(newLayout, null),
    [commitLayout],
  );

  /**
   * One tile of a click-drag stroke (floor, wall, erase, carpet): the whole
   * stroke shares one undo entry. The stroke is closed on mouse up / mouse
   * leave / tool change / Esc via `editorState.endStroke()`.
   */
  const applyStrokeEdit = useCallback(
    (newLayout: OfficeLayout) => commitLayout(newLayout, 'stroke'),
    [commitLayout],
  );

  const colorActions = useFurnitureColorActions(
    getOfficeState,
    editorState,
    commitLayout,
    bumpTick,
  );

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((prev) => {
      const next = !prev;
      editorState.isEditMode = next;
      if (next) {
        // Initialize wallColor from existing wall tiles so new walls match
        const os = getOfficeState();
        const layout = os.getLayout();
        if (layout.tileColors) {
          for (let i = 0; i < layout.tiles.length; i++) {
            if (layout.tiles[i] === TileType.WALL && layout.tileColors[i]) {
              editorState.wallColor = { ...layout.tileColors[i]! };
              break;
            }
          }
        }
      } else {
        editorState.clearSelection();
        editorState.clearGhost();
        editorState.clearDrag();
        editorState.endStroke();
      }
      return next;
    });
  }, [editorState, getOfficeState]);

  // Tool toggle: clicking already-active tool deselects it (returns to SELECT)
  const handleToolChange = useCallback(
    (tool: EditToolType) => {
      const next = editorState.activeTool === tool ? EditTool.SELECT : tool;
      editorState.activeTool = next;
      editorState.clearSelection();
      editorState.clearGhost();
      editorState.clearDrag();
      // A stroke (or slider run) never spans a tool change — close it so the
      // next edit starts a fresh undo entry.
      editorState.endStroke();
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // ── Carpet handlers ──────────────────────────────────────────────
  const handleCarpetVariantChange = useCallback(
    (variant: number) => {
      editorState.carpetVariant = variant;
      setCarpetVariantState(variant);
    },
    [editorState],
  );

  const handleCarpetColorChange = useCallback(
    (color: ColorValue) => {
      editorState.carpetColor = color;
      setCarpetColorState(color);
    },
    [editorState],
  );

  const handleCarpetAccentColorChange = useCallback(
    (color: ColorValue) => {
      editorState.carpetAccentColor = color;
      setCarpetAccentColorState(color);
    },
    [editorState],
  );

  const handleResetCarpetColor = useCallback(() => {
    const next: ColorValue = { ...CARPET_DEFAULT_COLOR };
    editorState.carpetColor = next;
    setCarpetColorState(next);
  }, [editorState]);

  const handleResetCarpetAccentColor = useCallback(() => {
    const next: ColorValue = { ...CARPET_DEFAULT_ACCENT_COLOR };
    editorState.carpetAccentColor = next;
    setCarpetAccentColorState(next);
  }, [editorState]);

  const handleTileTypeChange = useCallback(
    (type: TileTypeVal) => {
      editorState.selectedTileType = type;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleFloorColorChange = useCallback(
    (color: ColorValue) => {
      editorState.floorColor = color;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // Recolours every existing wall; a slider run is one undo entry.
  const handleWallColorChange = useCallback(
    (color: ColorValue) => {
      editorState.wallColor = color;
      const layout = getOfficeState().getLayout();
      const newLayout = recolorWalls(layout, color);
      if (newLayout !== layout) {
        commitLayout(newLayout, 'wallColor');
      } else {
        bumpTick();
      }
    },
    [editorState, getOfficeState, commitLayout, bumpTick],
  );

  const handleWallSetChange = useCallback(
    (setIndex: number) => {
      editorState.selectedWallSet = setIndex;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleFurnitureTypeChange = useCallback(
    (type: string) => {
      // Clicking the same item deselects it (no ghost), stays in furniture mode.
      // A catalog item is placed in the palette colour — any colour the Copy
      // tool lifted leaves with the item it was lifted for.
      if (editorState.placingType === type) {
        editorState.placing = null;
        editorState.clearGhost();
      } else {
        editorState.placing = { type };
        // Picking from the catalog means "place this", not "edit that" — drop any
        // placed selection so R/T have exactly one target.
        editorState.clearSelection();
      }
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleDeleteSelected = useCallback(() => {
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const os = getOfficeState();
    const newLayout = removeFurniture(os.getLayout(), uid);
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
      editorState.clearSelection();
    }
  }, [getOfficeState, editorState, applyEdit]);

  const handleRotateSelected = useCallback(() => {
    // A placed item is only ever selected when no catalog item is (picking one
    // clears the selection), so selection wins: rotating with the Furniture tab
    // open must still turn the item the rotate button is pointing at.
    const uid = editorState.selectedFurnitureUid;
    // In furniture placement mode with nothing selected, cycle the catalog type
    // through its rotation group instead (rotates the ghost preview).
    if (!uid && editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const rotated = editorState.placing && getRotatedType(editorState.placing.type, 'cw');
      if (editorState.placing && rotated) {
        editorState.placing = { ...editorState.placing, type: rotated };
        bumpTick();
      }
      return;
    }
    if (!uid) return;
    const os = getOfficeState();
    const newLayout = rotateFurniture(os.getLayout(), uid, 'cw');
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
    }
  }, [getOfficeState, editorState, applyEdit, bumpTick]);

  const handleToggleState = useCallback(() => {
    // Same precedence as rotate: a selected placed item wins over the catalog
    // type, so T works with the Furniture tab open.
    const uid = editorState.selectedFurnitureUid;
    if (!uid && editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const toggled = editorState.placing && getToggledType(editorState.placing.type);
      if (editorState.placing && toggled) {
        editorState.placing = { ...editorState.placing, type: toggled };
        bumpTick();
      }
      return;
    }
    if (!uid) return;
    const os = getOfficeState();
    const newLayout = toggleFurnitureState(os.getLayout(), uid);
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
    }
  }, [getOfficeState, editorState, applyEdit, bumpTick]);

  const handleUndo = useCallback(() => {
    const prev = editorState.popUndo();
    if (!prev) return;
    editorState.endStroke(); // the next edit can't extend an entry that's been undone
    const os = getOfficeState();
    // Push current layout to redo stack before restoring
    editorState.pushRedo(os.getLayout());
    os.rebuildFromLayout(prev);
    saveLayout(prev);
    editorState.isDirty = true;
    setIsDirty(true);
    setEditorTick((n) => n + 1);
  }, [getOfficeState, editorState, saveLayout]);

  const handleRedo = useCallback(() => {
    const next = editorState.popRedo();
    if (!next) return;
    editorState.endStroke();
    const os = getOfficeState();
    // Push current layout to undo stack before restoring
    editorState.pushUndo(os.getLayout());
    os.rebuildFromLayout(next);
    saveLayout(next);
    editorState.isDirty = true;
    setIsDirty(true);
    setEditorTick((n) => n + 1);
  }, [getOfficeState, editorState, saveLayout]);

  /** Leave edit mode (same cleanup as toggling the Layout button off). No-op when already out. */
  const handleExitEditMode = useCallback(() => {
    if (!editorState.isEditMode) return;
    editorState.isEditMode = false;
    editorState.clearSelection();
    editorState.clearGhost();
    editorState.clearDrag();
    editorState.endStroke();
    setIsEditMode(false);
  }, [editorState]);

  /**
   * [Save]: flush the pending save; on the server's `layoutSaved` mark clean
   * and leave edit mode. A refusal (or no answer) keeps the editor open and dirty.
   */
  const handleSave = useCallback(
    (onTimeout: () => void) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const layout = getOfficeState().getLayout();
      saveThenExit({
        send: () =>
          transport.send({
            type: 'saveLayout',
            layout: layout as unknown as Record<string, unknown>,
          }),
        onMessage: (h) => transport.onMessage(h),
        timeoutMs: LAYOUT_SAVE_ACK_TIMEOUT_MS,
        onTimeout,
        onSaved: () => {
          markClean();
          handleExitEditMode();
        },
      });
    },
    [getOfficeState, markClean, handleExitEditMode],
  );

  // Notify React that imperative editor selection changed (e.g., from OfficeCanvas mouseUp)
  const handleEditorSelectionChange = bumpTick;

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(clampZoom(newZoom));
  }, []);

  /**
   * A furniture drag released at (col,row): validate, commit, and settle the
   * selection in one place — a copy is left selected so R / T / the colour
   * sliders act on what was just dropped; a move (or a refused drop) leaves
   * nothing selected.
   */
  const handleDrop = useCallback(
    (uid: string, col: number, row: number, opts: { duplicate: boolean }) => {
      const result = dropFurniture(getOfficeState().getLayout(), uid, col, row, opts);
      if (result) applyEdit(result.layout);
      editorState.setSelection(result?.selectedUid ?? null);
      bumpTick();
    },
    [getOfficeState, editorState, applyEdit, bumpTick],
  );

  const handleEditorTileAction = useCallback(
    (col: number, row: number) => {
      const layout = getOfficeState().getLayout();
      // The office size is fixed: nothing happens outside the grid.
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return;
      switch (editorState.activeTool) {
        case EditTool.TILE_PAINT:
          // One click fills the whole room (or the connected corridor): one undo entry.
          applyEdit(
            paintTiles(
              layout,
              floorFillRegion(layout, col, row),
              editorState.selectedTileType,
              editorState.floorColor,
            ),
          );
          return;
        case EditTool.WALL_PAINT: {
          const floor = { type: editorState.selectedTileType, color: editorState.floorColor };
          // The stroke's first tile decides whether it adds or removes walls.
          editorState.wallDragAdding ??= wallStrokeAdds(layout, col, row);
          const adding = editorState.wallDragAdding;
          applyStrokeEdit(wallStrokeTile(layout, col, row, adding, editorState.wallColor, floor));
          return;
        }
        case EditTool.ERASE:
          applyStrokeEdit(eraseTile(layout, col, row));
          return;
        case EditTool.CARPET_PAINT:
          applyStrokeEdit(
            paintCarpet(
              layout,
              col,
              row,
              editorState.carpetVariant,
              editorState.carpetColor,
              editorState.carpetAccentColor,
            ),
          );
          return;
        case EditTool.FURNITURE_PLACE: {
          const placing = editorState.placing;
          if (!placing) return;
          applyEdit(
            placeNewFurniture(layout, placing.type, col, row, editorState.placementColor()),
          );
          return;
        }
        case EditTool.FURNITURE_PICK: {
          const hit = furnitureAt(layout, col, row);
          if (hit) {
            editorState.pickUpCopy(hit);
            editorState.activeTool = EditTool.FURNITURE_PLACE;
          }
          bumpTick();
          return;
        }
        case EditTool.COLOR_PICK:
          colorActions.pickColorAt(col, row);
          return;
        case EditTool.EYEDROPPER: {
          const idx = row * layout.cols + col;
          const tile = layout.tiles[idx];
          const color = layout.tileColors?.[idx];
          if (tile === TileType.WALL) {
            // Pick wall color and switch to wall tool
            if (color) editorState.wallColor = { ...color };
            editorState.activeTool = EditTool.WALL_PAINT;
          } else if (tile !== undefined && tile !== TileType.VOID) {
            editorState.selectedTileType = tile;
            if (color) editorState.floorColor = { ...color };
            editorState.activeTool = EditTool.TILE_PAINT;
          }
          bumpTick();
          return;
        }
        case EditTool.CARPET_PICK: {
          const tile = isFloorTile(layout, col, row)
            ? layout.carpetTiles?.[row * layout.cols + col]
            : null;
          if (!tile) return;
          editorState.carpetVariant = tile.variant;
          setCarpetVariantState(tile.variant);
          if (tile.color) {
            const next = { ...tile.color };
            editorState.carpetColor = next;
            setCarpetColorState(next);
          }
          if (tile.accentColor) {
            const next = { ...tile.accentColor };
            editorState.carpetAccentColor = next;
            setCarpetAccentColorState(next);
          }
          editorState.activeTool = EditTool.CARPET_PAINT;
          bumpTick();
          return;
        }
      }
    },
    [getOfficeState, editorState, applyEdit, applyStrokeEdit, colorActions, bumpTick],
  );

  /**
   * Right-click / right-drag on (col,row): erase with the active tool's own
   * meaning — the carpet tool clears its layer, everything else erases
   * the tile and the furniture it crosses.
   */
  const handleEditorEraseAction = useCallback(
    (col: number, row: number) => {
      const layout = getOfficeState().getLayout();
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return;
      switch (editorState.activeTool) {
        case EditTool.CARPET_PAINT:
          applyStrokeEdit(eraseCarpet(layout, col, row));
          return;
        default:
          applyStrokeEdit(eraseTile(layout, col, row));
      }
    },
    [getOfficeState, editorState, applyStrokeEdit],
  );

  const handleBackgroundChange = useCallback(
    (background: OfficeBackground, continuous: boolean) => {
      const layout = getOfficeState().getLayout();
      commitLayout({ ...layout, background }, continuous ? 'background' : null);
    },
    [getOfficeState, commitLayout],
  );

  return {
    isEditMode,
    editorTick,
    isDirty,
    zoom,
    panRef,
    saveTimerRef,
    markClean,
    handleToggleEditMode,
    handleToolChange,
    handleTileTypeChange,
    handleFloorColorChange,
    handleWallColorChange,
    handleWallSetChange,
    handleSelectedFurnitureColorChange: colorActions.handleSelectedFurnitureColorChange,
    handlePickedFurnitureColorChange: colorActions.handlePickedFurnitureColorChange,
    handleColorPickToggle: colorActions.handleColorPickToggle,
    handleFurnitureTypeChange,
    handleDeleteSelected,
    handleRotateSelected,
    handleToggleState,
    handleUndo,
    handleRedo,
    handleExitEditMode,
    handleSave,
    handleZoomChange,
    handleEditorTileAction,
    handleEditorEraseAction,
    handleEditorSelectionChange,
    handleDrop,
    carpetVariant,
    carpetColor,
    carpetAccentColor,
    handleCarpetVariantChange,
    handleCarpetColorChange,
    handleCarpetAccentColorChange,
    handleResetCarpetColor,
    handleResetCarpetAccentColor,
    handleBackgroundChange,
  };
}
