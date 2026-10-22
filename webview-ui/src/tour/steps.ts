// Declarative onboarding tour: what each step spotlights and which UI it opens.
// Text lives in i18n.ts as `tour.<id>.title` / `tour.<id>.body`.

import type { Room } from '../../../core/src/lan.js';
import { EditTool } from '../office/types.js';

/** What a step spotlights. Several targets = several holes. */
export type Target =
  /** A DOM element tagged `data-tour="<id>"`. */
  | { dom: string }
  /** A room of the map (its area tiles). */
  | { room: Room }
  /** The whole office map. */
  | { map: true }
  /**
   * Characters with their name tags: `tag` = a main agent, `bubble` = one
   * waiting for approval (else one with a reason), `child` = a subagent beside
   * its parent, `ghost` = a subagent holding its parent's ghost in another
   * room (plus the real parent).
   */
  | { agent: AgentRole };

export type AgentRole = 'tag' | 'bubble' | 'child' | 'ghost';

/** UI the step shows while it is current; everything returns to the user's state afterwards. */
export interface Scene {
  settings?: boolean;
  profile?: boolean;
  /** Layout editor open with this tool selected. */
  editor?: EditTool;
  /** Show the save/undo bar even without unsaved changes (buttons blocked). */
  actionBar?: boolean;
  /** Force the `bubble` agent's hover bubble. */
  hover?: boolean;
  /** Room the demo coder walks to. */
  walk?: Room;
}

/** Things a step needs on this screen; steps whose needs are unmet are dropped. */
export type Capability = 'edit' | 'switcher' | 'profile' | 'offices' | 'areas';

export interface Step {
  id: StepId;
  targets: Target[];
  scene?: Scene;
  /** Clicks/wheel inside the spotlight reach the app (try it yourself). */
  interactive?: boolean;
  requires?: Capability[];
  /** Part of the short tour for read-only (remote) viewers. */
  readOnly?: boolean;
}

export type StepId =
  | 'welcome'
  | 'roomCoding'
  | 'roomLibrary'
  | 'roomServer'
  | 'roomLounge'
  | 'tag'
  | 'bubble'
  | 'family'
  | 'map'
  | 'switcher'
  | 'settingsButton'
  | 'language'
  | 'profile'
  | 'offices'
  | 'remote'
  | 'system'
  | 'layoutButton'
  | 'floor'
  | 'walls'
  | 'furniture'
  | 'areas'
  | 'background'
  | 'editorMore'
  | 'install'
  | 'done';

export const STEPS: Step[] = [
  { id: 'welcome', targets: [], readOnly: true },
  { id: 'roomCoding', targets: [{ room: 'coding' }], scene: { walk: 'coding' }, readOnly: true },
  { id: 'roomLibrary', targets: [{ room: 'library' }], scene: { walk: 'library' }, readOnly: true },
  { id: 'roomServer', targets: [{ room: 'server' }], scene: { walk: 'server' }, readOnly: true },
  { id: 'roomLounge', targets: [{ room: 'lounge' }], scene: { walk: 'lounge' }, readOnly: true },
  { id: 'tag', targets: [{ agent: 'tag' }], readOnly: true },
  {
    id: 'bubble',
    targets: [{ agent: 'bubble' }, { dom: 'hover-bubble' }],
    scene: { hover: true },
    readOnly: true,
  },
  { id: 'family', targets: [{ agent: 'child' }, { agent: 'ghost' }], readOnly: true },
  {
    id: 'map',
    targets: [{ map: true }, { dom: 'zoom' }],
    interactive: true,
    readOnly: true,
  },
  { id: 'switcher', targets: [{ dom: 'switcher' }], requires: ['switcher'], readOnly: true },
  { id: 'settingsButton', targets: [{ dom: 'settings-button' }] },
  { id: 'language', targets: [{ dom: 'settings-language' }], scene: { settings: true } },
  {
    id: 'profile',
    targets: [{ dom: 'profile-modal' }],
    scene: { profile: true },
    requires: ['profile'],
  },
  {
    id: 'offices',
    targets: [{ dom: 'settings-offices' }],
    scene: { settings: true },
    requires: ['offices'],
  },
  {
    id: 'remote',
    targets: [{ dom: 'settings-remote' }],
    scene: { settings: true },
    requires: ['offices'],
  },
  {
    id: 'system',
    targets: [{ dom: 'settings-autostart' }, { dom: 'settings-update' }],
    scene: { settings: true },
  },
  { id: 'layoutButton', targets: [{ dom: 'layout-button' }], requires: ['edit'] },
  {
    id: 'floor',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.TILE_PAINT },
    requires: ['edit'],
  },
  {
    id: 'walls',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.WALL_PAINT },
    requires: ['edit'],
  },
  {
    id: 'furniture',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.FURNITURE_PLACE },
    requires: ['edit'],
  },
  {
    id: 'areas',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.AREA_PAINT },
    requires: ['edit', 'areas'],
  },
  {
    id: 'background',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.BACKGROUND },
    requires: ['edit'],
  },
  {
    id: 'editorMore',
    targets: [{ dom: 'editor-pets' }, { dom: 'editor-erase' }, { dom: 'edit-actions' }],
    scene: { editor: EditTool.SELECT, actionBar: true },
    requires: ['edit'],
  },
  // Falls back to a centred explanation when the install popup is not shown.
  { id: 'install', targets: [{ dom: 'install' }] },
  { id: 'done', targets: [], readOnly: true },
];

export type Variant = 'full' | 'readOnly';

/** The steps this viewer gets: the variant's subset, minus steps needing what this screen lacks. */
export function visibleSteps(variant: Variant, caps: ReadonlySet<Capability>): StepId[] {
  return STEPS.filter(
    (s) => (variant === 'full' || s.readOnly) && (s.requires ?? []).every((c) => caps.has(c)),
  ).map((s) => s.id);
}

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));
export const stepById = (id: StepId): Step => BY_ID.get(id)!;
