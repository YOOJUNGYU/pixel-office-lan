/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | LayoutLoaded
  | LayoutSaved
  | LayoutSaveRejected
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | OfficeAccess
  | SettingsLoaded
  | ExternalAssetDirectoriesUpdated
  | OfficeSnapshot
  | ProfileLoaded
  | UpdateAvailable
  | UpdateStatus
  | AutostartState
  | OfficesState
  | OfficeCreated
  | OfficeCode
  | OfficeError
  | ProfileError;

export type ClientMessage =
  | WebviewReady
  | SaveLayout
  | SetAlwaysShowLabels
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | SetShowAreas
  | SaveProfile
  | InstallUpdate
  | CheckUpdate
  | SetAutoUpdate
  | SetAutostart
  | QuitApp
  | CreateOffice
  | JoinOffice
  | LeaveOffice
  | SetActiveView
  | GetOfficeCode
  | SendChat
  | DeleteChat
  | MoveAvatar
  | SetNotifications;

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

export interface LayoutSaved {
  type: 'layoutSaved';
}

export interface LayoutSaveRejected {
  type: 'layoutSaveRejected';
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
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

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
  petIds: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface OfficeAccess {
  type: 'officeAccess';
  readOnly: boolean;
  version?: string;
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  alwaysShowLabels: boolean;
  externalAssetDirectories: string[];
  showAreas: boolean;
  autoUpdate: boolean;
  notifyPresence: boolean;
  notifyAgents: boolean;
}

export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

export interface OfficeSnapshot {
  type: 'officeSnapshot';
  online: Record<string, number>;
  agents: OfficeAgentMessage[];
  people: OfficePersonMessage[];
  selfPeerId: string;
}

export interface OfficeAgentMessage {
  key: string;
  parentKey?: string;
  id: string;
  provider: AgentProvider;
  kind: AgentViewKind;
  num: number;
  parentId?: string;
  room: AgentRoom;
  permission: boolean;
  act: AgentAct;
  target: string;
  reason: string;
  peer: PeerInfoMessage;
}

export type AgentProvider = 'claude' | 'codex';

export type AgentViewKind = 'main' | 'subagent' | 'shell';

export type AgentRoom = 'coding' | 'library' | 'server' | 'lounge';

export type AgentAct =
  | 'idle'
  | 'edit'
  | 'read'
  | 'search'
  | 'find'
  | 'web'
  | 'fetch'
  | 'mcp'
  | 'run'
  | 'delegate'
  | 'ask'
  | 'image'
  | 'tool';

export interface PeerInfoMessage {
  id: string;
  account: string;
  nickname: string;
  nickSince?: number;
  palette: number;
  hueShift: number;
  pet?: PetId;
  tagColors?: TagColors;
}

export type PetId = 'claudio' | 'gitcat';

export interface TagColors {
  bg: string;
  fg: string;
}

export interface OfficePersonMessage {
  peerId: string;
  account: string;
  nickname: string;
  nickSince?: number;
  palette: number;
  hueShift: number;
  pet?: PetId;
  tagColors?: TagColors;
  self: boolean;
  chat?: ChatMessage;
  avatar?: AvatarMessage;
}

export interface ChatMessage {
  id: string;
  text: string;
}

export interface AvatarMessage {
  col: number;
  row: number;
  dir: AvatarDir;
}

export type AvatarDir = 'down' | 'up' | 'left' | 'right';

export interface ProfileLoaded {
  type: 'profileLoaded';
  profile: ProfileMessage;
  canEdit: boolean;
  account: string;
  firstRun: boolean;
}

export interface ProfileMessage {
  nickname: string;
  palette: number;
  hueShift: number;
  pet?: PetId;
  tagColors?: TagColors;
  hideDetails: boolean;
  manualPeers: string[];
}

export interface UpdateAvailable {
  type: 'updateAvailable';
  version: string;
  notesUrl: string;
}

export interface UpdateStatus {
  type: 'updateStatus';
  state: UpdateState;
  percent?: number;
}

export type UpdateState = 'upToDate' | 'downloading' | 'installing' | 'error';

export interface AutostartState {
  type: 'autostartState';
  enabled: boolean;
  supported: boolean;
}

export interface OfficesState {
  type: 'officesState';
  offices: OfficeSummary[];
  activeView: string;
}

export interface OfficeSummary {
  tag: string;
  name: string;
}

export interface OfficeCreated {
  type: 'officeCreated';
  tag: string;
  name: string;
  code: string;
}

export interface OfficeCode {
  type: 'officeCode';
  tag: string;
  code: string;
}

export interface OfficeError {
  type: 'officeError';
  reason: OfficeErrorReason;
}

export type OfficeErrorReason = 'invalidCode' | 'alreadyJoined' | 'nameInvalid' | 'full';

export interface ProfileError {
  type: 'profileError';
  reason: ProfileErrorReason;
}

export type ProfileErrorReason = 'nicknameTaken';

export interface WebviewReady {
  type: 'webviewReady';
}

export interface SaveLayout {
  type: 'saveLayout';
  layout: Record<string, any>;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
  path?: string;
}

export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

export interface SetShowAreas {
  type: 'setShowAreas';
  enabled: boolean;
}

export interface SaveProfile {
  type: 'saveProfile';
  profile: ProfileMessage;
}

export interface InstallUpdate {
  type: 'installUpdate';
}

export interface CheckUpdate {
  type: 'checkUpdate';
}

export interface SetAutoUpdate {
  type: 'setAutoUpdate';
  enabled: boolean;
}

export interface SetAutostart {
  type: 'setAutostart';
  enabled: boolean;
}

export interface QuitApp {
  type: 'quitApp';
}

export interface CreateOffice {
  type: 'createOffice';
  name: string;
}

export interface JoinOffice {
  type: 'joinOffice';
  code: string;
  name?: string;
}

export interface LeaveOffice {
  type: 'leaveOffice';
  tag: string;
}

export interface SetActiveView {
  type: 'setActiveView';
  view: string;
}

export interface GetOfficeCode {
  type: 'getOfficeCode';
  tag: string;
}

export interface SendChat {
  type: 'sendChat';
  text: string;
}

export interface DeleteChat {
  type: 'deleteChat';
}

export interface MoveAvatar {
  type: 'moveAvatar';
  col: number;
  row: number;
  dir: AvatarDir;
}

export interface SetNotifications {
  type: 'setNotifications';
  presence?: boolean;
  agents?: boolean;
}
