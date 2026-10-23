import { useCallback, useEffect, useRef, useState } from 'react';

import type { OfficeAgent } from '../../core/src/lan.js';
import { fillMissingRooms, isLayoutGrid, ROOM_LABELS, ROOM_ORDER } from '../../core/src/lan.js';
import type { ProfileMessage } from '../../core/src/messages.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { EditActionBar } from './components/EditActionBar.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Button } from './components/ui/Button.js';
import { ZoomControls } from './components/ZoomControls.js';
import {
  DEFAULT_LAYOUT_ASSET,
  FIRST_OPEN_FIT_FILL,
  FIT_TOP_MARGIN_PX,
  LAYOUT_REJECTED_TOAST_MS,
  OFFICE_CANVAS_TEST_ID,
  TOP_RIGHT_BOTTOM_RESERVE_PX,
  TOP_RIGHT_Z_INDEX,
  TOUR_AUTOSTART_DELAY_MS,
  TOUR_FIT_FILL,
  ZOOM_MAX,
  ZOOM_MIN,
} from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { t, useLang } from './i18n.js';
import { InstallPrompt } from './lan/InstallPrompt.js';
import { LanOverlay } from './lan/LanOverlay.js';
import { NicknameNotice } from './lan/NicknameNotice.js';
import { OfficeSwitcher } from './lan/OfficeSwitcher.js';
import { peopleRows } from './lan/peopleModel.js';
import { PeoplePanel } from './lan/PeoplePanel.js';
import { ProfileModal } from './lan/ProfileModal.js';
import { RoomLegend } from './lan/RoomLegend.js';
import { readTagsHidden, saveTagsHidden } from './lan/tagVisibility.js';
import { UpdateBanner } from './lan/UpdateBanner.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { exportLayoutToFile } from './office/layout/exportLayout.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from './office/layout/layoutSerializer.js';
import { overlayProjection } from './office/projection.js';
import { EditTool, type OfficeLayout, TILE_SIZE } from './office/types.js';
import { isBrowserRuntime, isE2E } from './runtime.js';
import { installTestHooks } from './testHooks.js';
import { demoAgents, needsDemo } from './tour/demoAgents.js';
import { fitZoom } from './tour/geometry.js';
import { type Capability, stepById, visibleSteps } from './tour/steps.js';
import { TourOverlay } from './tour/TourOverlay.js';
import { useTour } from './tour/useTour.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

// Test-only observability hooks (message/sound logs, addAgent wrapper, selectAgent).
// Installed only under the e2e harness so they never patch prototypes or grow
// unbounded logs in a real user's session.
if (isE2E) installTestHooks(officeStateRef);

/** Room labels with no tile in the layout. */
function emptyRoomLabels(layout: OfficeLayout): string[] {
  return ROOM_ORDER.map((r) => ROOM_LABELS[r]).filter((l) => !layout.areaTiles?.includes(l));
}

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    layoutReady,
    loadedAssets,
    profile,
    showAreas,
    setShowAreas,
    officeReadOnly,
    restarting,
    lan,
    people,
    profileError,
    clearProfileError,
    layoutSaveRejections,
    nicknames,
    update,
    updateStatus,
    setUpdateStatus,
    autostart,
    offices,
    officeReply,
    clearOfficeReply,
  } = useExtensionMessages(getOfficeState, isEditDirty);

  // Overlay geometry: the root div is the canvas container's size.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const lang = useLang();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const firstRun = !!profile?.canEdit && profile.firstRun;
  // A save stays open until the server answers (profileLoaded): its echo closes the
  // modal, an unchanged profile means rejected and the form keeps the user's input.
  const [profileSave, setProfileSave] = useState<{
    sent: ProfileMessage;
    before: typeof profile;
  } | null>(null);
  const [profileSaveError, setProfileSaveError] = useState(false);
  if (profileSave && profile && profile !== profileSave.before) {
    setProfileSave(null);
    if (sameProfile(profile.profile, profileSave.sent)) setIsProfileOpen(false);
    else setProfileSaveError(true);
  }

  // Phones and touch tablets: pinch replaces the zoom buttons and Settings floats.
  const isMobile = useIsMobile();

  // Toggle global Show Areas — persisted via setShowAreas message; runs server-
  // side through configPersistence.
  const onToggleShowAreas = useCallback(() => {
    const next = !showAreas;
    setShowAreas(next);
    transport.send({ type: 'setShowAreas', enabled: next });
  }, [showAreas, setShowAreas]);

  const effectiveShowAreas = showAreas;

  // e2e: register the component-scoped editor-action drivers + the effective
  // show-areas gate on the test-hooks namespace (module-load installTestHooks
  // can't reach these React callbacks). The action drivers bypass canvas
  // pixel→tile geometry — the handlers still own undo/dirty/rebuild; for specs
  // that drive the real canvas gesture instead, getTileCenter projects a tile
  // to canvas CSS pixels with the renderer's own zoom + pan. Guarded on isE2E.
  const { zoom, panRef, handleZoomChange, isEditMode, handleToggleEditMode, handleToolChange } =
    editor;
  const { handleEditorTileAction, handleEditorEraseAction, handleDrop } = editor;
  useEffect(() => {
    if (!isE2E || typeof window === 'undefined') return;
    const hooks = (window.__pixelAgentsTestHooks ??= {});
    hooks.editorTileAction = (col, row) => handleEditorTileAction(col, row);
    hooks.editorEraseAction = (col, row) => handleEditorEraseAction(col, row);
    hooks.editorDrop = (uid, col, row, duplicate = false) =>
      handleDrop(uid, col, row, { duplicate });
    hooks.getTileCenter = (col, row) => {
      const canvas = document.querySelector(`[data-testid="${OFFICE_CANVAS_TEST_ID}"]`);
      if (!canvas) return null;
      const projection = overlayProjection(
        getOfficeState().getLayout(),
        canvas.getBoundingClientRect(),
        zoom,
        panRef.current,
        window.devicePixelRatio || 1,
      );
      return {
        x: projection.toScreenX((col + 0.5) * TILE_SIZE),
        y: projection.toScreenY((row + 0.5) * TILE_SIZE),
      };
    };
    hooks.getShowAreas = () => effectiveShowAreas;
    hooks.getZoom = () => zoom;
    hooks.setZoom = (z) => handleZoomChange(z);
    // Client-only characters (like the tour's demos) for screenshots of agent scenes.
    hooks.setDemoAgents = (agents) => lan.setDemo(agents as OfficeAgent[]);
  }, [
    lan,
    handleZoomChange,
    handleEditorTileAction,
    handleEditorEraseAction,
    handleDrop,
    zoom,
    panRef,
    effectiveShowAreas,
  ]);

  const [tagsHidden, setTagsHidden] = useState(readTagsHidden);
  const toggleTags = useCallback(() => {
    setTagsHidden((h) => {
      saveTagsHidden(!h);
      return !h;
    });
  }, []);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const officeState = getOfficeState();

  // The Show Areas setting is offered when the layout defines its rooms.
  const areasAvailable = (officeState.getLayout().areas?.length ?? 0) > 0;
  const emptyRooms = officeState.emptyRooms();

  // ── Onboarding tour ──
  // The current step's scene drives what is open (settings, profile, editor
  // tool, action bar) and the client-only demo characters; when the tour ends
  // everything falls back to the user's own state.
  const tour = useTour();
  const { dispatch: tourDispatch } = tour;
  const step = tour.current ? stepById(tour.current) : null;
  const scene = step?.scene;
  const tourDemoRef = useRef(false);
  const [, setAgentsRev] = useState(0);
  // Camera: the user's before the tour (restored at the end) and the tour's
  // whole-office view (re-applied on every step, undoing the "try it" step).
  type Camera = { zoom: number; pan: { x: number; y: number } };
  const tourUserCameraRef = useRef<Camera | null>(null);
  const tourCameraRef = useRef<Camera | null>(null);
  /** Selection/camera follow before the tour (a click in the map step must not outlive it). */
  const tourUserFollowRef = useRef<{ selected: number | null; follow: number | null } | null>(null);
  /** The layout editor was open when the tour started: closed meanwhile, reopened after. */
  const tourUserEditorRef = useRef<{ tool: EditTool } | null>(null);
  const startTour = useCallback(() => {
    const os = getOfficeState();
    tourUserCameraRef.current ??= { zoom, pan: { ...panRef.current } };
    tourUserFollowRef.current ??= { selected: os.selectedAgentId, follow: os.cameraFollowId };
    // No editing under the tour (the map step's clicks would paint and autosave).
    if (isEditMode && !tourUserEditorRef.current) {
      tourUserEditorRef.current = { tool: editorState.activeTool };
      handleToggleEditMode();
    }
    const box = containerRef.current?.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const layout = getOfficeState().getLayout();
    tourCameraRef.current = {
      zoom: box
        ? fitZoom(
            { w: layout.cols * TILE_SIZE, h: layout.rows * TILE_SIZE },
            { w: box.width * dpr, h: box.height * dpr },
            TOUR_FIT_FILL,
            ZOOM_MIN,
            ZOOM_MAX,
          )
        : zoom,
      pan: { x: 0, y: 0 },
    };
    const caps = new Set<Capability>();
    if (!officeReadOnly && !isMobile) caps.add('edit');
    if (offices) caps.add('switcher').add('offices');
    if (profile?.canEdit) caps.add('profile');
    setIsSettingsOpen(false);
    setIsProfileOpen(false);
    tourDemoRef.current = needsDemo(lan.realAgents());
    if (tourDemoRef.current || lan.realAgents().some((a) => a.parentKey !== undefined)) {
      caps.add('family');
    }
    tourDispatch({ type: 'start', ids: visibleSteps(caps) });
  }, [
    officeReadOnly,
    isMobile,
    offices,
    profile,
    lan,
    tourDispatch,
    zoom,
    panRef,
    isEditMode,
    handleToggleEditMode,
  ]);

  // The server refused a layout save, or [Save] got no answer: say so for a
  // moment (the editor keeps the layout). A new object per error restarts the timer.
  const [saveError, setSaveError] = useState<{ key: 'rejected' | 'timeout' } | null>(null);
  useEffect(() => {
    if (layoutSaveRejections > 0) setSaveError({ key: 'rejected' });
  }, [layoutSaveRejections]);
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), LAYOUT_REJECTED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [saveError]);

  // First open: a big office (e.g. a 128×128 layout) is zoomed out to fit the
  // window when the default zoom would not show all of it. Once per session.
  const fittedRef = useRef(false);
  useEffect(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!layoutReady || fittedRef.current || !box) return;
    fittedRef.current = true;
    const dpr = window.devicePixelRatio || 1;
    const layout = getOfficeState().getLayout();
    // Fit below the office switcher (top centre) so the room names along the
    // top edge are never under it: fit in the height left, then pan down.
    const top = FIT_TOP_MARGIN_PX * dpr;
    const fit = fitZoom(
      { w: layout.cols * TILE_SIZE, h: layout.rows * TILE_SIZE },
      { w: box.width * dpr, h: box.height * dpr - top },
      FIRST_OPEN_FIT_FILL,
      ZOOM_MIN,
      ZOOM_MAX,
    );
    if (fit < zoom) {
      panRef.current = { x: 0, y: top / 2 };
      handleZoomChange(fit);
    }
  }, [layoutReady, zoom, handleZoomChange, panRef]);

  // First run: right after the profile is saved.
  const tourCanAutostart =
    layoutReady && profile !== null && !firstRun && !tour.state.done && step === null;
  useEffect(() => {
    if (!tourCanAutostart) return;
    const timer = setTimeout(startTour, TOUR_AUTOSTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tourCanAutostart, startTour]);

  const touring = step !== null;
  const walk = scene?.walk ?? 'lounge';
  useEffect(() => {
    lan.setDemo(
      touring && tourDemoRef.current
        ? demoAgents(
            {
              accounts: [t('tour.demo.a'), t('tour.demo.b'), t('tour.demo.c'), t('tour.demo.d')],
              editReason: t('tour.demo.editReason'),
              readReason: t('tour.demo.readReason'),
              waitReason: t('tour.demo.waitReason'),
            },
            walk,
          )
        : [],
    );
    setAgentsRev((n) => n + 1); // the people panel reads lan.all() at render: show/clear demo people now, not on the next snapshot
  }, [lan, touring, walk, lang]);

  // Editor steps open the editor with a tool; leaving them restores the tool
  // and closes the editor if the tour opened it. Nothing is ever saved.
  const tourEditorRef = useRef<{ opened: boolean; tool: EditTool } | null>(null);
  const tourTool = scene?.editor;
  useEffect(() => {
    const saved = tourEditorRef.current;
    if (tourTool !== undefined) {
      if (!saved) {
        tourEditorRef.current = { opened: !isEditMode, tool: editorState.activeTool };
        if (!isEditMode) handleToggleEditMode();
      }
      if (editorState.activeTool !== tourTool) handleToolChange(tourTool);
    } else if (saved) {
      tourEditorRef.current = null;
      if (editorState.activeTool !== saved.tool) handleToolChange(saved.tool);
      if (saved.opened && isEditMode) handleToggleEditMode();
    }
  }, [tourTool, isEditMode, handleToggleEditMode, handleToolChange]);

  // Tour over: reopen the editor the user had open (once the tour's own close has landed).
  useEffect(() => {
    const user = tourUserEditorRef.current;
    if (touring || !user || isEditMode) return;
    tourUserEditorRef.current = null;
    handleToggleEditMode();
    if (editorState.activeTool !== user.tool) handleToolChange(user.tool);
  }, [touring, isEditMode, handleToggleEditMode, handleToolChange]);

  const stepId = step?.id;
  useEffect(() => {
    const cam = stepId ? tourCameraRef.current : tourUserCameraRef.current;
    if (!cam) return;
    handleZoomChange(cam.zoom);
    panRef.current = { ...cam.pan };
    // Every step starts unfollowed; the end gives the user's selection back.
    const os = getOfficeState();
    const user = tourUserFollowRef.current;
    os.selectedAgentId = stepId ? null : (user?.selected ?? null);
    os.cameraFollowId = stepId ? null : (user?.follow ?? null);
    if (!stepId)
      tourUserCameraRef.current = tourCameraRef.current = tourUserFollowRef.current = null;
  }, [stepId, handleZoomChange, panRef]);

  const settingsOpen = touring ? scene?.settings === true : isSettingsOpen;
  const profileOpen = touring ? scene?.profile === true : isProfileOpen;

  const handleExportLayout = useCallback(() => {
    exportLayoutToFile(getOfficeState().getLayout());
  }, []);

  const fetchDefaultLayout = async (): Promise<unknown> => {
    const res = await fetch(`${import.meta.env.BASE_URL}${DEFAULT_LAYOUT_ASSET}`);
    if (!res.ok) throw new Error(`default layout ${res.status.toString()}`);
    return (await res.json()) as unknown;
  };

  /** Validate, apply and save a layout from outside (file import, reset to the default). */
  const applyLayout = async (imported: unknown) => {
    // The server's grid check (isLayoutGrid), before anything is built: a
    // v1 grid within 128×128 whose tiles match it, with a furniture array.
    if (!isLayoutGrid(imported)) {
      window.alert(t('app.importInvalid'));
      return;
    }
    let migrated = migrateLayoutColors(imported as unknown as OfficeLayout);
    // Rooms come from the bundled default: a room without tiles takes the
    // default's when the grid is the default size (the server does the same).
    if (emptyRoomLabels(migrated).length > 0) {
      migrated = fillMissingRooms(migrated, await fetchDefaultLayout());
    }
    getOfficeState().rebuildFromLayout(migrated);
    transport.send({
      type: 'saveLayout',
      layout: migrated as unknown as Record<string, unknown>,
    });
    editor.markClean();
  };

  const handleImportLayout = (file: File) => {
    // Browser-native import: read + validate + apply directly,
    // bypassing the layoutLoaded message whose dirty guard would skip it.
    if (isEditDirty() && !window.confirm(t('app.importConfirm'))) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyLayout(JSON.parse(String(reader.result)) as unknown).catch(() =>
          window.alert(t('app.importFailed')),
        );
      } catch {
        window.alert(t('app.importFailed'));
      }
    };
    reader.readAsText(file);
  };

  /** Settings and the editor's [Reset] → the bundled default office (an older saved layout stays until this); leaves edit mode. */
  const handleResetToDefaultLayout = (confirmText = t('app.resetDefaultConfirm')) => {
    if (!window.confirm(confirmText)) return;
    fetchDefaultLayout()
      .then(applyLayout)
      .then(editor.handleExitEditMode)
      .catch(() => window.alert(t('app.importFailed')));
  };

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.placingType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return (
      <div className="w-full h-full flex items-center justify-center ">{t('app.loading')}</div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="w-full h-full relative overflow-hidden">
        <OfficeCanvas
          officeState={officeState}
          isEditMode={editor.isEditMode}
          editorState={editorState}
          onEditorTileAction={editor.handleEditorTileAction}
          onEditorEraseAction={editor.handleEditorEraseAction}
          onEditorSelectionChange={editor.handleEditorSelectionChange}
          onDeleteSelected={editor.handleDeleteSelected}
          onRotateSelected={editor.handleRotateSelected}
          onDrop={editor.handleDrop}
          zoom={editor.zoom}
          onZoomChange={editor.handleZoomChange}
          panRef={editor.panRef}
          showAreas={effectiveShowAreas}
          tapSelectsFirst={isMobile}
        />

        <LanOverlay
          officeState={officeState}
          lan={lan}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          tagsHidden={tagsHidden && scene?.tags !== true}
        />

        {!isMobile && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

        {!editor.isEditMode && (
          <RoomLegend
            areas={officeState.getLayout().areas}
            isMobile={isMobile}
            forceOpen={scene?.legend === true}
            tagsHidden={tagsHidden}
            onToggleTags={toggleTags}
          />
        )}

        {/* Vignette overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'var(--vignette)' }}
        />

        {showRotateHint && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
            style={{ top: 8 }}
          >
            {t('app.rotateHint')}
          </div>
        )}

        {editor.isEditMode &&
          (() => {
            const selUid = editorState.selectedFurnitureUid;
            const selColor = selUid
              ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
              : null;
            return (
              <EditorToolbar
                activeTool={editorState.activeTool}
                selectedTileType={editorState.selectedTileType}
                selectedFurnitureType={editorState.placingType}
                selectedFurnitureUid={selUid}
                selectedFurnitureColor={selColor}
                floorColor={editorState.floorColor}
                wallColor={editorState.wallColor}
                selectedWallSet={editorState.selectedWallSet}
                onToolChange={editor.handleToolChange}
                onTileTypeChange={editor.handleTileTypeChange}
                onFloorColorChange={editor.handleFloorColorChange}
                onWallColorChange={editor.handleWallColorChange}
                onWallSetChange={editor.handleWallSetChange}
                onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                pickedFurnitureColor={editorState.pickedFurnitureColor}
                onPickedFurnitureColorChange={editor.handlePickedFurnitureColorChange}
                onColorPickToggle={editor.handleColorPickToggle}
                onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                loadedAssets={loadedAssets}
                carpetVariant={editor.carpetVariant}
                carpetColor={editor.carpetColor}
                carpetAccentColor={editor.carpetAccentColor}
                onCarpetVariantChange={editor.handleCarpetVariantChange}
                onCarpetColorChange={editor.handleCarpetColorChange}
                onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
                emptyRooms={emptyRooms}
                background={officeState.getLayout().background}
                onBackgroundChange={editor.handleBackgroundChange}
              />
            );
          })()}

        {saveError && (
          <div
            role="alert"
            className="absolute left-1/2 -translate-x-1/2 bottom-80 z-20 bg-danger text-white text-sm py-3 px-8 rounded-none border-2 border-border shadow-pixel pointer-events-none whitespace-nowrap"
          >
            {t(saveError.key === 'rejected' ? 'app.layoutSaveRejected' : 'app.layoutSaveTimeout')}
          </div>
        )}

        {offices && !editor.isEditMode && <OfficeSwitcher state={offices} />}

        {/* Top right, stacked so nothing overlaps: update banner, install popup, people panel
          (which takes the height left below them). */}
        <div
          style={{ zIndex: TOP_RIGHT_Z_INDEX, bottom: TOP_RIGHT_BOTTOM_RESERVE_PX }}
          className="absolute mobile-safe-top max-lg:top-[calc(env(safe-area-inset-top,0px)+64px)] right-10 flex flex-col items-end gap-8 pointer-events-none max-w-[calc(100%-20px)]"
        >
          {!officeReadOnly && (
            <UpdateBanner
              update={update}
              status={updateStatus}
              onClearStatus={() => setUpdateStatus(null)}
            />
          )}
          <InstallPrompt readOnly={officeReadOnly} />
          {!editor.isEditMode && (
            <PeoplePanel
              rows={peopleRows(people, lan.all())}
              lan={lan}
              officeState={officeState}
              forceOpen={scene?.people === true}
            />
          )}
        </div>

        {officeReadOnly && (
          <div className="absolute mobile-safe-top left-1/2 -translate-x-1/2 z-10 text-sm text-text-muted pointer-events-none select-none whitespace-nowrap">
            {t('app.readOnly')}
          </div>
        )}

        {/* A read-only office gets no layout button and only the language
          setting: everything else would be refused by the server anyway. */}
        {!isMobile && (
          <BottomToolbar
            isEditMode={editor.isEditMode}
            onToggleEditMode={officeReadOnly ? null : editor.handleToggleEditMode}
            isSettingsOpen={settingsOpen}
            onToggleSettings={() => setIsSettingsOpen((v) => !v)}
          >
            {editor.isEditMode && (
              <EditActionBar
                editor={editor}
                editorState={editorState}
                onSave={() => editor.handleSave(() => setSaveError({ key: 'timeout' }))}
                onReset={() => handleResetToDefaultLayout(t('app.resetEditorConfirm'))}
              />
            )}
          </BottomToolbar>
        )}

        {/* Mobile: Settings floats top-left (the layout editor stays desktop-
          only — its tools are drag/hover-driven). */}
        {isMobile && (
          <div className="absolute mobile-safe-top left-8 z-20">
            <Button
              size="sm"
              variant={settingsOpen ? 'active' : 'default'}
              className="border-border! shadow-pixel"
              onClick={() => setIsSettingsOpen((v) => !v)}
              data-tour="settings-button"
            >
              {t('toolbar.settings')}
            </Button>
          </div>
        )}

        <ConnectionIndicator />

        {restarting && (
          <div
            role="status"
            className="absolute inset-0 z-60 flex items-center justify-center bg-bg-dark/80"
          >
            <div className="pixel-panel py-8 px-16 text-base">{t('app.restarting')}</div>
          </div>
        )}

        {profile?.canEdit && (firstRun || profileOpen) && (
          <ProfileModal
            profile={profile.profile}
            firstRun={firstRun}
            saveError={profileSaveError ? (profileError ?? 'rejected') : null}
            takenNicknames={nicknames.taken}
            account={profile.account}
            onSave={(p) => {
              clearProfileError();
              transport.send({ type: 'saveProfile', profile: p });
              setProfileSave({ sent: p, before: profile });
              setProfileSaveError(false);
            }}
            onClose={() => {
              setIsProfileOpen(false);
              setProfileSaveError(false);
              clearProfileError();
            }}
          />
        )}

        {profile?.canEdit && nicknames.selfLost !== null && !firstRun && !profileOpen && (
          <NicknameNotice clash={nicknames.selfLost} onChange={() => setIsProfileOpen(true)} />
        )}

        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          readOnly={officeReadOnly}
          onOpenProfile={profile?.canEdit ? () => setIsProfileOpen(true) : null}
          showAreas={showAreas}
          onToggleShowAreas={onToggleShowAreas}
          showAreasAvailable={areasAvailable}
          onExportLayout={handleExportLayout}
          onImportLayout={handleImportLayout}
          onResetToDefaultLayout={officeReadOnly ? undefined : handleResetToDefaultLayout}
          autostart={autostart}
          offices={offices}
          officeReply={officeReply}
          onOfficeReplyHandled={clearOfficeReply}
          onReplayTour={startTour}
        />
      </div>
      {/* Outside the app root: the overlay makes the root inert while it runs. */}
      {step && (
        <TourOverlay
          step={step}
          index={tour.state.index}
          count={tour.state.ids.length}
          officeState={officeState}
          lan={lan}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          onNext={() => tourDispatch({ type: 'next' })}
          onPrev={() => tourDispatch({ type: 'prev' })}
          onSkip={() => tourDispatch({ type: 'skip' })}
          context={{
            demo: tourDemoRef.current,
            autostart: autostart?.supported === true,
            touch: isMobile,
          }}
        />
      )}
    </>
  );
}

/** The server echoes the saved profile; anything else means the save was rejected. */
const sameProfile = (a: ProfileMessage, b: ProfileMessage): boolean =>
  a.nickname === b.nickname &&
  a.palette === b.palette &&
  a.hueShift === b.hueShift &&
  a.pet === b.pet &&
  a.hideDetails === b.hideDetails &&
  a.manualPeers.join('\n') === b.manualPeers.join('\n');

export default App;
