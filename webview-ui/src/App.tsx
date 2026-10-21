import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProfileMessage } from '../../core/src/messages.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { EditActionBar } from './components/EditActionBar.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Button } from './components/ui/Button.js';
import { ZoomControls } from './components/ZoomControls.js';
import { OFFICE_CANVAS_TEST_ID } from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { t, useLang } from './i18n.js';
import { LanOverlay } from './lan/LanOverlay.js';
import { ProfileModal } from './lan/ProfileModal.js';
import { UpdateBanner } from './lan/UpdateBanner.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { exportLayoutToFile } from './office/layout/exportLayout.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from './office/layout/layoutSerializer.js';
import { overlayProjection } from './office/projection.js';
import { getPetCount } from './office/sprites/petSpriteData.js';
import { EditTool, type OfficeLayout, TILE_SIZE } from './office/types.js';
import { isBrowserRuntime, isE2E } from './runtime.js';
import { installTestHooks } from './testHooks.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

// Test-only observability hooks (message/sound logs, addAgent wrapper, selectAgent).
// Installed only under the e2e harness so they never patch prototypes or grow
// unbounded logs in a real user's session.
if (isE2E) installTestHooks(officeStateRef);

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
    areaMappings,
    setAreaMappings,
    showAreas,
    setShowAreas,
    officeReadOnly,
    lan,
    update,
    updateStatus,
    setUpdateStatus,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Overlay geometry: the root div is the canvas container's size.
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  useLang();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const firstRun = !!profile?.canEdit && profile.profile.nickname === '';
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

  // Mutate Directory→Area mappings locally + send to server.
  const handleAreaMappingChange = useCallback(
    (directoryName: string, areaLabel: string, action: 'add' | 'remove') => {
      const current = areaMappings[directoryName] ?? [];
      let nextLabels: string[];
      if (action === 'add') {
        if (current.includes(areaLabel)) return;
        nextLabels = [...current, areaLabel];
      } else {
        nextLabels = current.filter((l) => l !== areaLabel);
      }
      const next = { ...areaMappings };
      if (nextLabels.length === 0) {
        delete next[directoryName];
      } else {
        next[directoryName] = nextLabels;
      }
      setAreaMappings(next);
      getOfficeState().setAreaMappings(next);
      transport.send({ type: 'saveAreaMappings', mappings: next });
    },
    [areaMappings, setAreaMappings],
  );

  // Toggle global Show Areas — persisted via setShowAreas message; runs server-
  // side through configPersistence.
  const onToggleShowAreas = useCallback(() => {
    const next = !showAreas;
    setShowAreas(next);
    transport.send({ type: 'setShowAreas', enabled: next });
  }, [showAreas, setShowAreas]);

  // When AREA_PAINT is active in the editor, force the overlay on even if the
  // user has toggled Show Areas off globally — they need to see what they're
  // editing. The selected area's overlay is alpha-bumped via activeAreaLabel.
  const isEditingAreas = editor.isEditMode && editorState.activeTool === EditTool.AREA_PAINT;
  const effectiveShowAreas = isEditingAreas || showAreas;
  const activeAreaLabel = isEditingAreas ? editor.selectedAreaLabel : null;

  // e2e: register the component-scoped editor-action drivers + the effective
  // show-areas gate on the test-hooks namespace (module-load installTestHooks
  // can't reach these React callbacks). The action drivers bypass canvas
  // pixel→tile geometry — the handlers still own undo/dirty/rebuild; for specs
  // that drive the real canvas gesture instead, getTileCenter projects a tile
  // to canvas CSS pixels with the renderer's own zoom + pan. Guarded on isE2E.
  useEffect(() => {
    if (!isE2E || typeof window === 'undefined') return;
    const hooks = (window.__pixelAgentsTestHooks ??= {});
    hooks.editorTileAction = (col, row) => editor.handleEditorTileAction(col, row);
    hooks.editorEraseAction = (col, row) => editor.handleEditorEraseAction(col, row);
    hooks.editorDrop = (uid, col, row, duplicate = false) =>
      editor.handleDrop(uid, col, row, { duplicate });
    hooks.getTileCenter = (col, row) => {
      const canvas = document.querySelector(`[data-testid="${OFFICE_CANVAS_TEST_ID}"]`);
      if (!canvas) return null;
      const projection = overlayProjection(
        getOfficeState().getLayout(),
        canvas.getBoundingClientRect(),
        editor.zoom,
        editor.panRef.current,
        window.devicePixelRatio || 1,
      );
      return {
        x: projection.toScreenX((col + 0.5) * TILE_SIZE),
        y: projection.toScreenY((row + 0.5) * TILE_SIZE),
      };
    };
    hooks.getShowAreas = () => effectiveShowAreas;
  }, [
    editor.handleEditorTileAction,
    editor.handleEditorEraseAction,
    editor.handleDrop,
    editor.zoom,
    editor.panRef,
    effectiveShowAreas,
  ]);

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

  // Areas authoring is available when the layout already defines areas.
  const areasAvailable = (officeState.getLayout().areas?.length ?? 0) > 0;

  const handleExportLayout = useCallback(() => {
    exportLayoutToFile(getOfficeState().getLayout());
  }, []);

  const handleImportLayout = (file: File) => {
    // Browser-native import: read + validate + apply directly,
    // bypassing the layoutLoaded message whose dirty guard would skip it.
    if (isEditDirty() && !window.confirm(t('app.importConfirm'))) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as Record<string, unknown>;
        // Reject anything that is not a v1 layout with tile + furniture arrays
        // (migrate + rebuild iterate furniture and would throw on a non-array).
        if (
          imported.version !== 1 ||
          !Array.isArray(imported.tiles) ||
          !Array.isArray(imported.furniture)
        ) {
          window.alert(t('app.importInvalid'));
          return;
        }
        const migrated = migrateLayoutColors(imported as unknown as OfficeLayout);
        getOfficeState().rebuildFromLayout(migrated);
        editor.setLastSavedLayout(migrated);
        transport.send({
          type: 'saveLayout',
          layout: migrated as unknown as Record<string, unknown>,
        });
        editor.markClean();
      } catch {
        window.alert(t('app.importFailed'));
      }
    };
    reader.readAsText(file);
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
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        showAreas={effectiveShowAreas}
        activeAreaLabel={activeAreaLabel}
        tapSelectsFirst={isMobile}
      />

      <LanOverlay
        officeState={officeState}
        lan={lan}
        containerRef={containerRef}
        zoom={editor.zoom}
        panRef={editor.panRef}
      />

      {!isMobile && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'var(--vignette)' }}
      />

      {editor.isEditMode && editor.isDirty && (
        <EditActionBar editor={editor} editorState={editorState} />
      )}

      {showRotateHint && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
          style={{ top: editor.isDirty ? 64 : 8 }}
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
              activePetTypes={officeState.getActivePetTypes()}
              petCount={getPetCount()}
              onPetToggle={editor.handlePetToggle}
              carpetVariant={editor.carpetVariant}
              carpetColor={editor.carpetColor}
              carpetAccentColor={editor.carpetAccentColor}
              onCarpetVariantChange={editor.handleCarpetVariantChange}
              onCarpetColorChange={editor.handleCarpetColorChange}
              onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
              areas={officeState.getLayout().areas ?? []}
              selectedAreaLabel={editor.selectedAreaLabel}
              directories={[]}
              areasAvailable={areasAvailable}
              areaMappings={areaMappings}
              onSelectArea={editor.handleSelectArea}
              onAddArea={editor.handleAddArea}
              onRemoveArea={editor.handleRemoveArea}
              onRenameArea={editor.handleRenameArea}
              onAreaColorChange={editor.handleAreaColorChange}
              onAreaMappingChange={handleAreaMappingChange}
              background={officeState.getLayout().background}
              onBackgroundChange={editor.handleBackgroundChange}
            />
          );
        })()}

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
          isSettingsOpen={isSettingsOpen}
          onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        />
      )}

      {/* Mobile: Settings floats top-left (the layout editor stays desktop-
          only — its tools are drag/hover-driven). */}
      {isMobile && (
        <div className="absolute mobile-safe-top left-8 z-20">
          <Button
            size="sm"
            variant={isSettingsOpen ? 'active' : 'default'}
            className="border-border! shadow-pixel"
            onClick={() => setIsSettingsOpen((v) => !v)}
          >
            {t('toolbar.settings')}
          </Button>
        </div>
      )}

      <ConnectionIndicator />

      {!officeReadOnly && (
        <UpdateBanner
          update={update}
          status={updateStatus}
          onClearStatus={() => setUpdateStatus(null)}
        />
      )}

      {profile?.canEdit && (firstRun || isProfileOpen) && (
        <ProfileModal
          profile={profile.profile}
          firstRun={firstRun}
          saveError={profileSaveError}
          onSave={(p) => {
            transport.send({ type: 'saveProfile', profile: p });
            setProfileSave({ sent: p, before: profile });
            setProfileSaveError(false);
          }}
          onClose={() => {
            setIsProfileOpen(false);
            setProfileSaveError(false);
          }}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        readOnly={officeReadOnly}
        onOpenProfile={profile?.canEdit ? () => setIsProfileOpen(true) : null}
        showAreas={showAreas}
        onToggleShowAreas={onToggleShowAreas}
        showAreasAvailable={areasAvailable}
        onExportLayout={handleExportLayout}
        onImportLayout={handleImportLayout}
      />
    </div>
  );
}

/** The server echoes the saved profile; anything else means the save was rejected. */
const sameProfile = (a: ProfileMessage, b: ProfileMessage): boolean =>
  a.nickname === b.nickname &&
  a.palette === b.palette &&
  a.hueShift === b.hueShift &&
  a.hideDetails === b.hideDetails &&
  a.manualPeers.join('\n') === b.manualPeers.join('\n');

export default App;
