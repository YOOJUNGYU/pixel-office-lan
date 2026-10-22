// Declarative onboarding tour: what each step spotlights and which UI it opens.
// Text lives in i18n.ts as `tour.<id>.title` / `tour.<id>.body`.

import type { Room } from '../../../core/src/lan.js';
import type { Key } from '../i18n.js';
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
   * its parent.
   */
  | { agent: AgentRole };

export type AgentRole = 'tag' | 'bubble' | 'child';

/** UI the step shows while it is current; everything returns to the user's state afterwards. */
export interface Scene {
  settings?: boolean;
  profile?: boolean;
  /** Layout editor open with this tool selected. */
  editor?: EditTool;
  /** Force the `bubble` agent's hover bubble. */
  hover?: boolean;
  /** Room the demo coder walks to. */
  walk?: Room;
  /** People panel expanded even if the viewer collapsed it. */
  people?: boolean;
  /** Room legend open even if the viewer collapsed it. */
  legend?: boolean;
}

/** Things a step needs on this screen; steps whose needs are unmet are dropped. */
export type Capability =
  | 'edit'
  | 'switcher'
  | 'profile'
  | 'offices'
  /** A subagent or shell is on the map (real, or the demos). */
  | 'family';

export interface Step {
  id: StepId;
  targets: Target[];
  scene?: Scene;
  /** Clicks/wheel inside the spotlight reach the app (try it yourself). */
  interactive?: boolean;
  requires?: Capability[];
}

export type StepId =
  | 'welcome'
  | 'roomCoding'
  | 'roomLibrary'
  | 'roomServer'
  | 'roomLounge'
  | 'roomLegend'
  | 'tag'
  | 'bubble'
  | 'family'
  | 'map'
  | 'switcher'
  | 'people'
  | 'settingsButton'
  | 'language'
  | 'profile'
  | 'offices'
  | 'system'
  | 'layoutButton'
  | 'floor'
  | 'walls'
  | 'furniture'
  | 'background'
  | 'editorMore'
  | 'save'
  | 'install'
  | 'done';

export const STEPS: Step[] = [
  { id: 'welcome', targets: [] },
  { id: 'roomCoding', targets: [{ room: 'coding' }], scene: { walk: 'coding' } },
  { id: 'roomLibrary', targets: [{ room: 'library' }], scene: { walk: 'library' } },
  { id: 'roomServer', targets: [{ room: 'server' }], scene: { walk: 'server' } },
  { id: 'roomLounge', targets: [{ room: 'lounge' }], scene: { walk: 'lounge' } },
  { id: 'roomLegend', targets: [{ dom: 'room-legend' }], scene: { legend: true } },
  { id: 'tag', targets: [{ agent: 'tag' }] },
  {
    id: 'bubble',
    targets: [{ agent: 'bubble' }, { dom: 'hover-bubble' }],
    scene: { hover: true },
  },
  {
    id: 'family',
    targets: [{ agent: 'child' }],
    requires: ['family'],
  },
  {
    id: 'map',
    targets: [{ map: true }, { dom: 'zoom' }],
    interactive: true,
  },
  { id: 'switcher', targets: [{ dom: 'switcher' }], requires: ['switcher'] },
  { id: 'people', targets: [{ dom: 'people' }], scene: { people: true } },
  { id: 'settingsButton', targets: [{ dom: 'settings-button' }] },
  {
    id: 'language',
    targets: [{ dom: 'settings-language' }, { dom: 'settings-theme' }],
    scene: { settings: true },
  },
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
    id: 'background',
    targets: [{ dom: 'editor-toolbar' }],
    scene: { editor: EditTool.BACKGROUND },
    requires: ['edit'],
  },
  {
    id: 'editorMore',
    targets: [{ dom: 'editor-erase' }, { dom: 'edit-actions' }],
    scene: { editor: EditTool.SELECT },
    requires: ['edit'],
  },
  {
    id: 'save',
    targets: [{ dom: 'edit-actions' }],
    scene: { editor: EditTool.SELECT },
    requires: ['edit'],
  },
  // Falls back to a centred explanation when the install popup is not shown.
  { id: 'install', targets: [{ dom: 'install' }] },
  { id: 'done', targets: [] },
];

/** The steps this viewer gets: all but those needing what this screen lacks. */
export function visibleSteps(caps: ReadonlySet<Capability>): StepId[] {
  return STEPS.filter((s) => (s.requires ?? []).every((c) => caps.has(c))).map((s) => s.id);
}

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));
export const stepById = (id: StepId): Step => BY_ID.get(id)!;

/** What is true on this screen, for copy that would otherwise describe absent things. */
export interface BodyContext {
  /** Demo characters were added. */
  demo: boolean;
  /** Start at login is offered (Windows/Mac install). */
  autostart: boolean;
  /** Phone/tablet: pinch instead of the +/− buttons. */
  touch: boolean;
}

/** The i18n key of a step's body text. */
export function bodyKey(id: StepId, ctx: BodyContext): Key {
  if ((id === 'welcome' || id === 'roomLibrary' || id === 'done') && ctx.demo) {
    return `tour.${id}.bodyDemo`;
  }
  if (id === 'map' && ctx.touch) return 'tour.map.bodyTouch';
  if (id === 'system' && !ctx.autostart) return 'tour.system.bodyNoAutostart';
  return `tour.${id}.body`;
}
