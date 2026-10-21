// Core package: shared types, interfaces, and protocol definitions
// Everything in this package is types-only (no runtime behavior)

export type { ClientMessage, FurnitureAssetMessage, ServerMessage } from './messages.js';
export type {
  ColorValue,
  FloorColor,
  FurnitureCatalogEntry,
  OfficeLayout,
  PlacedFurniture,
  SpriteData,
} from './schemas.js';
