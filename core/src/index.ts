// Core package: shared types, interfaces, and protocol definitions
// Everything in this package is types-only (no runtime behavior)

export type {
  AgentView,
  OfficeAgent,
  PeerInfo,
  PeerPacket,
  Provider,
  Room,
  ViewKind,
} from './lan.js';
export type { ClientMessage, FurnitureAssetMessage, ServerMessage } from './messages.js';
export type {
  ColorValue,
  FloorColor,
  FurnitureCatalogEntry,
  OfficeLayout,
  PlacedFurniture,
  SpriteData,
} from './schemas.js';
// Runtime exports (LAN protocol constants + packet validation)
export {
  LAN_HTTP_PORT,
  LAN_UDP_PORT,
  MAX_PACKET_BYTES,
  parsePeerPacket,
  ROOM_LABELS,
} from './lan.js';
