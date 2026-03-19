/**
 * Physics Layer Definitions
 * 
 * Based on Hyperfy's layer structure for collaborative 3D worlds.
 */
export const PhysicsLayers = {
  NONE: 0,
  ENVIRONMENT: 1 << 0,  // Static scenery, floors, walls
  PLAYER: 1 << 1,       // The local player avatar
  REMOTE_PLAYER: 1 << 2, // Other players in collab mode
  PROP: 1 << 3,         // Interactive objects, rigidbodies
  TRIGGER: 1 << 4,      // Non-physical zones (e.g., pose zones)
  UI: 1 << 5,           // 3D UI elements
  LOD_0: 1 << 6,        // Level of Detail 0 (High)
  LOD_1: 1 << 7,        // Level of Detail 1 (Medium)
  LOD_2: 1 << 8,        // Level of Detail 2 (Low)
};

export type PhysicsLayer = number;

/**
 * Common masks
 */
export const PhysicsMasks = {
  ALL: 0xFFFFFFFF,
  GROUND: PhysicsLayers.ENVIRONMENT,
  WALL: PhysicsLayers.ENVIRONMENT | PhysicsLayers.PROP,
  INTERACTABLE: PhysicsLayers.PROP | PhysicsLayers.REMOTE_PLAYER,
  PHYSICS_WORLD: PhysicsLayers.ENVIRONMENT | PhysicsLayers.PROP | PhysicsLayers.PLAYER | PhysicsLayers.REMOTE_PLAYER,
};
