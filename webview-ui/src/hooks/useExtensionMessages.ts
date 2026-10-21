import { useEffect, useRef, useState } from 'react';

import type { OfficeAgent } from '../../../core/src/lan.js';
import type { ProfileLoaded } from '../../../core/src/messages.js';
import { LAN_READING_TOOLS } from '../constants.js';
import { LanAgents } from '../lan/lanAgents.js';
import { setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCarpetSprites } from '../office/sprites/carpetTiles.js';
import { setPetTemplates } from '../office/sprites/petSpriteData.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { setProviderCapabilities } from '../office/toolUtils.js';
import type { OfficeLayout } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { transport } from '../transport/index.js';

interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

interface ExtensionMessageState {
  layoutReady: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  alwaysShowLabels: boolean;
  // Areas
  areaMappings: Record<string, string[]>;
  setAreaMappings: (m: Record<string, string[]>) => void;
  showAreas: boolean;
  setShowAreas: (v: boolean) => void;
  /** A read-only office (not a loopback browser): every change it sends is
   *  refused, so the UI hides the controls that would send one. */
  officeReadOnly: boolean;
  /** LAN agents ↔ characters (lan.all(), lan.agentFor(id)). */
  lan: LanAgents;
  /** Bumped on every applied officeSnapshot so overlays re-render. */
  lanVersion: number;
  /** This PC's profile and whether this browser may edit it; null until loaded. */
  profile: Omit<ProfileLoaded, 'type'> | null;
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [layoutReady, setLayoutReady] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [externalAssetDirectories, setExternalAssetDirectories] = useState<string[]>([]);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);
  const [areaMappings, setAreaMappings] = useState<Record<string, string[]>>({});
  const [showAreas, setShowAreas] = useState(false);
  const [officeReadOnly, setOfficeReadOnly] = useState(false);
  const [lanVersion, setLanVersion] = useState(0);
  const [profile, setProfile] = useState<Omit<ProfileLoaded, 'type'> | null>(null);
  const lanRef = useRef<LanAgents | null>(null);
  lanRef.current ??= new LanAgents(getOfficeState());
  const lan = lanRef.current;
  /** Snapshots can arrive before layoutLoaded: hold the latest until then. */
  const pendingAgentsRef = useRef<OfficeAgent[] | null>(null);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (msg: any) => {
      const os = getOfficeState();
      const applyAgents = (agents: OfficeAgent[]) => {
        lan.apply(agents);
        setLanVersion((v) => v + 1);
      };

      if (msg.type === 'officeAccess') {
        setOfficeReadOnly(msg.readOnly === true);
        return;
      }

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        layoutReadyRef.current = true;
        setLayoutReady(true);
        if (pendingAgentsRef.current) {
          applyAgents(pendingAgentsRef.current);
          pendingAgentsRef.current = null;
        }
      } else if (msg.type === 'officeSnapshot') {
        const agents = msg.agents as OfficeAgent[];
        if (layoutReadyRef.current) applyAgents(agents);
        else pendingAgentsRef.current = agents;
      } else if (msg.type === 'profileLoaded') {
        const { profile, canEdit } = msg as ProfileLoaded;
        setProfile({ profile, canEdit });
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'petSpritesLoaded') {
        const pets = msg.pets;
        if (!Array.isArray(pets)) {
          return;
        }
        const petNames = Array.isArray(msg.petNames) ? (msg.petNames as string[]) : undefined;
        console.log(`[Webview] Received ${pets.length} pet sprites`);
        setPetTemplates(
          pets as Array<{
            walkDown: string[][][];
            idleDown: string[][][];
            walkUp: string[][][];
            idleUp: string[][][];
            walkRight: string[][][];
          }>,
          petNames,
        );
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} wall tile set(s)`);
        setWallSprites(sets);
      } else if (msg.type === 'carpetTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} carpet variant(s)`);
        setCarpetSprites(sets);
      } else if (msg.type === 'areaMappingsLoaded') {
        const mappings = (msg.mappings ?? {}) as Record<string, string[]>;
        setAreaMappings(mappings);
        os.setAreaMappings(mappings);
      } else if (msg.type === 'settingsLoaded') {
        setSoundEnabled(msg.soundEnabled as boolean);
        if (typeof msg.alwaysShowLabels === 'boolean') {
          setAlwaysShowLabels(msg.alwaysShowLabels as boolean);
        }
        if (typeof msg.showAreas === 'boolean') {
          setShowAreas(msg.showAreas as boolean);
        }
        if (Array.isArray(msg.externalAssetDirectories)) {
          setExternalAssetDirectories(msg.externalAssetDirectories as string[]);
        }
        if (typeof msg.lastSeenVersion === 'string') {
          setLastSeenVersion(msg.lastSeenVersion as string);
        }
        if (typeof msg.extensionVersion === 'string') {
          setExtensionVersion(msg.extensionVersion as string);
        }
      } else if (msg.type === 'externalAssetDirectoriesUpdated') {
        if (Array.isArray(msg.dirs)) {
          setExternalAssetDirectories(msg.dirs as string[]);
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      }
    };
    setProviderCapabilities({ readingTools: LAN_READING_TOOLS, subagentToolNames: [] });
    const unsubscribe = transport.onMessage(handler);
    transport.send({ type: 'webviewReady' });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState]);

  return {
    layoutReady,
    loadedAssets,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    alwaysShowLabels,
    areaMappings,
    setAreaMappings,
    showAreas,
    setShowAreas,
    officeReadOnly,
    lan,
    lanVersion,
    profile,
  };
}
