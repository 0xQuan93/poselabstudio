/**
 * Avatar Bridge
 * 
 * This module provides backward compatibility by wrapping the multiAvatarManager
 * to expose the same API as the original avatarManager for local avatar operations.
 * 
 * It also handles the integration between the original avatarManager and the
 * multiplayer system when a session is active.
 */

import { avatarManager } from '../three/avatarManager';
import { multiAvatarManager } from '../three/multiAvatarManager';
import { syncManager } from './syncManager';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';

type MultiplayerState = ReturnType<typeof useMultiplayerStore.getState>;

let unsubscribeMultiplayerStore: (() => void) | undefined;

/**
 * Check if we're in a multiplayer session
 */
function isInMultiplayerSession(): boolean {
  const state = useMultiplayerStore.getState();
  return state.isConnected && state.roomId !== null;
}

function registerLocalAvatarForSession(state: MultiplayerState) {
  if (!state.isConnected || !state.localPeerId) return;

  console.log('[AvatarBridge] Session active, registering local avatar');

  // Set local peer ID on multiAvatarManager
  multiAvatarManager.setLocalPeerId(state.localPeerId);

  // If there's already a local VRM loaded, register it (don't re-load!)
  const existingVRM = avatarManager.getVRM();
  if (existingVRM) {
    console.log('[AvatarBridge] Registering existing avatar with multiplayer (no reload)');
    // Use registerExistingAvatar to avoid creating a duplicate
    multiAvatarManager.registerExistingAvatar(
      state.localPeerId,
      existingVRM,
      true,
      state.localDisplayName
    );

    // Update peer info
    state.updatePeer(state.localPeerId, { hasAvatar: true });

    // Broadcast our state to any connected peers
    syncManager.broadcastFullState();
  }
}

/**
 * Initialize the avatar bridge - call this when the app starts
 * This sets up listeners to sync local avatar changes to peers
 */
export function initAvatarBridge() {
  if (unsubscribeMultiplayerStore) {
    return;
  }

  console.log('[AvatarBridge] Initializing');

  // When multiplayer session starts, register the local avatar with multiAvatarManager
  unsubscribeMultiplayerStore = useMultiplayerStore.subscribe((state, prevState) => {
    // Session connected
    if (
      state.isConnected &&
      state.localPeerId &&
      (!prevState.isConnected || state.localPeerId !== prevState.localPeerId)
    ) {
      registerLocalAvatarForSession(state);
    }

    // Session disconnected
    if (!state.isConnected && prevState.isConnected) {
      console.log('[AvatarBridge] Session disconnected, cleaning up');
      const localPeerId = state.localPeerId ?? prevState.localPeerId;
      // Remove all remote avatars but keep the local one
      multiAvatarManager.getAllAvatars().forEach((_, peerId) => {
        if (peerId !== localPeerId) {
          multiAvatarManager.removeAvatar(peerId);
        }
      });
    }
  });

  registerLocalAvatarForSession(useMultiplayerStore.getState());
}

/**
 * Load a VRM avatar - handles both single-player and multiplayer modes
 */
export async function loadAvatar(url: string) {
  const setRotationLocked = useSceneSettingsStore.getState().setRotationLocked;
  // Always load via the original avatarManager for single-player compatibility
  const vrm = await avatarManager.load(url, setRotationLocked);

  // If in multiplayer, also load into multiAvatarManager
  if (isInMultiplayerSession()) {
    const state = useMultiplayerStore.getState();
    if (state.localPeerId) {
      await multiAvatarManager.loadAvatar(
        state.localPeerId,
        url,
        true,
        state.localDisplayName
      );
      
      // Notify peers about our new avatar
      syncManager.broadcastFullState();
      
      // Update our peer info
      useMultiplayerStore.getState().updatePeer(state.localPeerId, { hasAvatar: true });
    }
  }

  return vrm;
}

/**
 * Notify multiplayer system of pose changes
 * Call this after applying poses locally
 */
export function notifyPoseChange() {
  if (isInMultiplayerSession()) {
    // The sync loop will pick this up, but we can force an immediate update
    syncManager.broadcastPoseUpdate();
  }
}

/**
 * Notify multiplayer system of expression changes
 */
export function notifyExpressionChange(expressions: Record<string, number>) {
  if (isInMultiplayerSession()) {
    syncManager.broadcastExpressionUpdate(expressions);
  }
}

/**
 * Notify multiplayer system of scene settings changes (for host)
 */
export function notifySceneChange(settings: { background?: string; aspectRatio?: string }) {
  if (isInMultiplayerSession()) {
    const state = useMultiplayerStore.getState();
    if (state.role === 'host') {
      syncManager.broadcastSceneSettings(settings);
    }
  }
}

/**
 * Get all avatar peer IDs (for UI display)
 */
export function getAllAvatarPeerIds(): string[] {
  return Array.from(multiAvatarManager.getAllAvatars().keys());
}

/**
 * Get avatar count in scene
 */
export function getAvatarCount(): number {
  if (isInMultiplayerSession()) {
    return multiAvatarManager.getAvatarCount();
  }
  return avatarManager.getVRM() ? 1 : 0;
}

