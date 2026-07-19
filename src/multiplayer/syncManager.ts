import type { 
  PeerId, 
  PeerMessage, 
  AvatarState, 
  PoseUpdateMessage,
  AvatarStateMessage,
  ExpressionUpdateMessage,
  SyncResponseMessage,
  SceneSyncMessage,
  VRMChunkMessage,
  VRMCompleteMessage,
  VRMRequestMessage,
  VRMChunkRequestMessage,
  BackgroundChunkMessage,
  BackgroundCompleteMessage,
} from '../types/multiplayer';
import { DEFAULT_MULTIPLAYER_CONFIG } from '../types/multiplayer';
import { peerManager } from './peerManager';
import { multiAvatarManager } from '../three/multiAvatarManager';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { useSceneSettingsStore } from '../state/useSceneSettingsStore';
import { sceneManager } from '../three/sceneManager';
import { useAvatarSource } from '../state/useAvatarSource';
import { notifyTransferProgress, clearTransferProgress } from '../components/ConnectionProgressPanel';

type VRMTransferBuffer = {
  chunks: (ArrayBuffer | undefined)[];
  receivedCount: number;
  receivedBytes: number;
  totalChunks: number;
  fileName: string;
  retries: number;
  expiresAt: number;
};

type BackgroundTransferBuffer = {
  chunks: (ArrayBuffer | undefined)[];
  receivedCount: number;
  receivedBytes: number;
  totalChunks: number;
  fileName: string;
  fileType: string;
  expiresAt: number;
};

const MEBIBYTE = 1024 * 1024;
const MAX_VRM_TRANSFER_BYTES = 20 * MEBIBYTE;
const MAX_BACKGROUND_TRANSFER_BYTES = 5 * MEBIBYTE;
// Keep small legacy scene-sync payloads working, but move larger backgrounds
// onto the bounded binary transfer path before they hit LiveKit JSON parsing.
const MAX_INLINE_BACKGROUND_BASE64_CHARS = 32 * 1024;
const VRM_TRANSFER_CHUNK_SIZE = DEFAULT_MULTIPLAYER_CONFIG.vrmChunkSize;
const BACKGROUND_TRANSFER_CHUNK_SIZE = 16 * 1024;
const MAX_VRM_TRANSFER_CHUNKS = Math.ceil(MAX_VRM_TRANSFER_BYTES / VRM_TRANSFER_CHUNK_SIZE);
const MAX_BACKGROUND_TRANSFER_CHUNKS = Math.ceil(MAX_BACKGROUND_TRANSFER_BYTES / BACKGROUND_TRANSFER_CHUNK_SIZE);
const MAX_VRM_BASE64_CHARS = Math.ceil(VRM_TRANSFER_CHUNK_SIZE / 3) * 4;
const MAX_BACKGROUND_BASE64_CHARS = Math.ceil(BACKGROUND_TRANSFER_CHUNK_SIZE / 3) * 4;
const MAX_BACKGROUND_TRANSFER_BASE64_CHARS = Math.ceil(MAX_BACKGROUND_TRANSFER_BYTES / 3) * 4;
const TRANSFER_EXPIRY_MS = 60_000;
const BASE64_CHUNK_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function hasValidChunkCoordinates(chunkIndex: number, totalChunks: number, maxChunks: number) {
  return Number.isInteger(totalChunks)
    && totalChunks > 0
    && totalChunks <= maxChunks
    && Number.isInteger(chunkIndex)
    && chunkIndex >= 0
    && chunkIndex < totalChunks;
}

function isValidTransferSize(totalSize: number, maxBytes: number) {
  return Number.isInteger(totalSize) && totalSize > 0 && totalSize <= maxBytes;
}

function decodeTransferChunk(
  data: string | ArrayBuffer,
  maxDecodedBytes: number,
  maxBase64Chars: number,
): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) {
    return data.byteLength > 0 && data.byteLength <= maxDecodedBytes ? data : null;
  }

  if (
    typeof data !== 'string'
    || data.length === 0
    || data.length > maxBase64Chars
    || !BASE64_CHUNK_PATTERN.test(data)
  ) {
    return null;
  }

  try {
    const binaryString = atob(data);
    if (binaryString.length === 0 || binaryString.length > maxDecodedBytes) return null;

    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index++) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return null;
  }
}

/**
 * SyncManager handles the synchronization of avatar state between peers.
 * It bridges the PeerManager (networking) with the MultiAvatarManager (rendering).
 */
class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private lastPoseSent = 0;
  private lastExpressionSent = 0;
  private lastSentExpressions: Record<string, number> = {};
  private poseSyncRate = DEFAULT_MULTIPLAYER_CONFIG.poseSyncRate;
  private poseSyncInterval = 1000 / this.poseSyncRate;
  private expressionSyncInterval = 100; // Sync expressions at 10Hz for smoother mocap
  private isActive = false;
  private vrmTransferBuffers = new Map<PeerId, VRMTransferBuffer>();
  private backgroundTransferBuffers = new Map<PeerId, BackgroundTransferBuffer>();
  private vrmTransferExpiryTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();
  private backgroundTransferExpiryTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();
  private pendingVRMRequests = new Set<PeerId>(); // Track pending requests to avoid duplicates
  private pendingBackgroundRequests = new Set<PeerId>(); // Track pending background requests
  private activeVRMSends = new Set<PeerId>(); // Track VRM sends in progress to avoid duplicates
  private activeBackgroundSends = new Set<PeerId>(); // Track background sends in progress

  /**
   * Initialize the sync manager and start listening for messages
   */
  initialize() {
    if (this.isActive) return;
    this.isActive = true;

    console.log('[SyncManager] Initializing');

    // Listen for peer messages
    peerManager.onMessage((peerId, message) => {
      this.handleMessage(peerId, message);
    });

    // Listen for connection changes
    peerManager.onConnectionChange((peerId, state) => {
      this.handleConnectionChange(peerId, state);
    });

    // Start the sync loop
    this.startSyncLoop();
  }

  /**
   * Stop the sync manager
   */
  stop() {
    this.isActive = false;
    this.stopSyncLoop();
    this.vrmTransferExpiryTimers.forEach((timer) => clearTimeout(timer));
    this.backgroundTransferExpiryTimers.forEach((timer) => clearTimeout(timer));
    this.vrmTransferBuffers.clear();
    this.backgroundTransferBuffers.clear();
    this.vrmTransferExpiryTimers.clear();
    this.backgroundTransferExpiryTimers.clear();
    this.pendingVRMRequests.clear();
    this.pendingBackgroundRequests.clear();
    console.log('[SyncManager] Stopped');
  }

  /**
   * Set the pose sync rate (Hz)
   */
  setSyncRate(rate: number) {
    this.poseSyncRate = Math.max(1, Math.min(60, rate));
    this.poseSyncInterval = 1000 / this.poseSyncRate;
    
    // Restart sync loop with new rate
    if (this.syncInterval) {
      this.stopSyncLoop();
      this.startSyncLoop();
    }
  }

  private isValidDirectedTransferEnvelope(
    senderPeerId: PeerId,
    message: { type: string; peerId: PeerId; targetPeerId: PeerId },
  ) {
    const localPeerId = useMultiplayerStore.getState().localPeerId;
    const isValid = Boolean(localPeerId)
      && message.peerId === senderPeerId
      && message.targetPeerId === localPeerId;

    if (!isValid) {
      console.warn(`[SyncManager] Ignored ${message.type} with an inconsistent sender or target`);
    }

    return isValid;
  }

  private clearVRMBuffer(peerId: PeerId) {
    const timer = this.vrmTransferExpiryTimers.get(peerId);
    if (timer !== undefined) clearTimeout(timer);
    this.vrmTransferExpiryTimers.delete(peerId);
    this.vrmTransferBuffers.delete(peerId);
  }

  private clearVRMTransfer(peerId: PeerId) {
    this.clearVRMBuffer(peerId);
    this.pendingVRMRequests.delete(peerId);
  }

  private clearBackgroundBuffer(peerId: PeerId) {
    const timer = this.backgroundTransferExpiryTimers.get(peerId);
    if (timer !== undefined) clearTimeout(timer);
    this.backgroundTransferExpiryTimers.delete(peerId);
    this.backgroundTransferBuffers.delete(peerId);
  }

  private clearBackgroundTransfer(peerId: PeerId) {
    this.clearBackgroundBuffer(peerId);
    this.pendingBackgroundRequests.delete(peerId);
  }

  private scheduleVRMTransferExpiry(peerId: PeerId) {
    const buffer = this.vrmTransferBuffers.get(peerId);
    if (!buffer) return;

    const previousTimer = this.vrmTransferExpiryTimers.get(peerId);
    if (previousTimer !== undefined) clearTimeout(previousTimer);

    const expiresAt = Date.now() + TRANSFER_EXPIRY_MS;
    buffer.expiresAt = expiresAt;
    const timer = setTimeout(() => {
      const currentBuffer = this.vrmTransferBuffers.get(peerId);
      if (!currentBuffer || currentBuffer.expiresAt !== expiresAt) return;

      const peerInfo = useMultiplayerStore.getState().peers.get(peerId);
      const displayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
      console.warn(`[SyncManager] VRM transfer from ${peerId} expired`);
      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: currentBuffer.receivedCount,
        totalChunks: currentBuffer.totalChunks,
        status: 'error',
      });
      this.clearVRMTransfer(peerId);
    }, TRANSFER_EXPIRY_MS);

    this.vrmTransferExpiryTimers.set(peerId, timer);
  }

  private scheduleBackgroundTransferExpiry(peerId: PeerId) {
    const buffer = this.backgroundTransferBuffers.get(peerId);
    if (!buffer) return;

    const previousTimer = this.backgroundTransferExpiryTimers.get(peerId);
    if (previousTimer !== undefined) clearTimeout(previousTimer);

    const expiresAt = Date.now() + TRANSFER_EXPIRY_MS;
    buffer.expiresAt = expiresAt;
    const timer = setTimeout(() => {
      const currentBuffer = this.backgroundTransferBuffers.get(peerId);
      if (!currentBuffer || currentBuffer.expiresAt !== expiresAt) return;

      console.warn(`[SyncManager] Background transfer from ${peerId} expired`);
      this.clearBackgroundTransfer(peerId);
    }, TRANSFER_EXPIRY_MS);

    this.backgroundTransferExpiryTimers.set(peerId, timer);
  }

  // ==================
  // Outgoing Sync
  // ==================

  /**
   * Send the local avatar's full state to all peers
   */
  broadcastFullState() {
    const state = multiAvatarManager.getLocalAvatarState();
    if (!state) return;

    const message: AvatarStateMessage = {
      type: 'avatar-state',
      peerId: state.peerId,
      timestamp: Date.now(),
      state,
    };

    peerManager.broadcast(message);
  }

  /**
   * Send a pose update (high frequency, minimal data)
   */
  broadcastPoseUpdate() {
    const localAvatar = multiAvatarManager.getLocalAvatar();
    if (!localAvatar) return;

    const state = multiAvatarManager.getLocalAvatarState();
    if (!state) return;

    const message: PoseUpdateMessage = {
      type: 'pose-update',
      peerId: state.peerId,
      timestamp: Date.now(),
      pose: state.pose,
      sceneRotation: state.sceneRotation,
      scenePosition: state.position,
    };

    peerManager.broadcast(message);
  }

  /**
   * Send an expression update
   */
  broadcastExpressionUpdate(expressions: Record<string, number>) {
    const store = useMultiplayerStore.getState();
    if (!store.localPeerId) return;

    const message: ExpressionUpdateMessage = {
      type: 'expression-update',
      peerId: store.localPeerId,
      timestamp: Date.now(),
      expressions,
    };

    peerManager.broadcast(message);
  }

  /**
   * Send scene settings to all peers (background, aspect ratio, etc.)
   */
  broadcastSceneSettings(settings: { background?: string; aspectRatio?: string }) {
    const store = useMultiplayerStore.getState();
    if (!store.localPeerId) return;

    // Small custom backgrounds can remain inline for compatibility. Larger
    // payloads travel through the bounded, sender-validated chunk path below.
    let customBackgroundData: string | undefined;
    let customBackgroundType: string | undefined;
    let sendBackgroundSeparately = false;
    
    if (settings.background === 'custom') {
      const sceneState = useSceneSettingsStore.getState();
      if (sceneState.customBackgroundData) {
        if (sceneState.customBackgroundData.length <= MAX_INLINE_BACKGROUND_BASE64_CHARS) {
          customBackgroundData = sceneState.customBackgroundData;
          customBackgroundType = sceneState.customBackgroundType || 'image/png';
        } else {
          sendBackgroundSeparately = true;
        }
      }
    }

    const message: SceneSyncMessage = {
      type: 'scene-sync',
      peerId: store.localPeerId,
      timestamp: Date.now(),
      ...settings,
      customBackgroundData,
      customBackgroundType,
    };

    peerManager.broadcast(message);

    if (sendBackgroundSeparately) {
      store.peers.forEach((peer, peerId) => {
        if (!peer.isLocal) void this.sendBackgroundToPeer(peerId);
      });
    }
  }

  /**
   * Send the local VRM file to a specific peer
   */
  async sendVRMToPeer(peerId: PeerId) {
    // Check if already sending to this peer
    if (this.activeVRMSends.has(peerId)) {
      console.log(`[SyncManager] Already sending VRM to ${peerId}, skipping duplicate`);
      return;
    }

    const localAvatar = multiAvatarManager.getLocalAvatar();
    if (!localAvatar) {
      console.warn('[SyncManager] No local avatar to send');
      return;
    }

    // Get the VRM file data from the avatar source store
    const { vrmArrayBuffer } = useAvatarSource.getState();
    if (!vrmArrayBuffer) {
      console.warn('[SyncManager] No VRM ArrayBuffer available for transfer');
      return;
    }

    if (vrmArrayBuffer.byteLength === 0 || vrmArrayBuffer.byteLength > MAX_VRM_TRANSFER_BYTES) {
      console.warn(`[SyncManager] Refusing VRM transfer outside the ${MAX_VRM_TRANSFER_BYTES / MEBIBYTE}MiB limit`);
      return;
    }

    // Mark as sending
    this.activeVRMSends.add(peerId);

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    const chunkSize = VRM_TRANSFER_CHUNK_SIZE;
    
    const fileSizeKB = Math.round(vrmArrayBuffer.byteLength / 1024);
    console.log(`[SyncManager] Sending VRM to peer ${peerId}: (${fileSizeKB} KB)`);

    // Convert ArrayBuffer to chunks
    const uint8Array = new Uint8Array(vrmArrayBuffer);
    const totalChunks = Math.ceil(uint8Array.length / chunkSize);

    console.log(`[SyncManager] Splitting into ${totalChunks} chunks of ${chunkSize / 1024}KB each`);

    // Notify UI of transfer start
    notifyTransferProgress({
      peerId,
      displayName: peerDisplayName,
      direction: 'sending',
      chunksComplete: 0,
      totalChunks,
      status: 'transferring',
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, uint8Array.length);
      const chunkBytes = uint8Array.slice(start, end);
      
      let binary = '';
      for (let j = 0; j < chunkBytes.length; j++) {
        binary += String.fromCharCode(chunkBytes[j]);
      }
      const base64Chunk = btoa(binary);
      
      const chunkMessage: VRMChunkMessage = {
        type: 'vrm-chunk',
        peerId: store.localPeerId!,
        targetPeerId: peerId,
        timestamp: Date.now(),
        chunkIndex: i,
        totalChunks,
        data: base64Chunk,
      };

      try {
        const sent = await peerManager.send(peerId, chunkMessage);
        if (sent) {
          successCount++;
          // Update progress UI
          notifyTransferProgress({
            peerId,
            displayName: peerDisplayName,
            direction: 'sending',
            chunksComplete: successCount,
            totalChunks,
            status: 'transferring',
          });
        } else {
          failCount++;
          console.warn(`[SyncManager] Failed to send chunk ${i + 1}/${totalChunks}`);
        }
      } catch (error) {
        failCount++;
        console.error(`[SyncManager] Error sending chunk ${i + 1}/${totalChunks}:`, error);
      }

      // Delay between chunks to avoid overwhelming the connection
      if (i < totalChunks - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    if (failCount > 0) {
      console.warn(`[SyncManager] VRM transfer had ${failCount} failed chunks out of ${totalChunks}`);
      notifyTransferProgress({
        peerId,
        displayName: peerDisplayName,
        direction: 'sending',
        chunksComplete: successCount,
        totalChunks,
        status: 'error',
      });
    } else {
      // Mark as complete
      notifyTransferProgress({
        peerId,
        displayName: peerDisplayName,
        direction: 'sending',
        chunksComplete: totalChunks,
        totalChunks,
        status: 'complete',
      });
      // Clear after a delay
      setTimeout(() => clearTransferProgress(peerId), 3000);
    }

    // Send completion message
    const completeMessage: VRMCompleteMessage = {
      type: 'vrm-complete',
      peerId: store.localPeerId!,
      targetPeerId: peerId,
      timestamp: Date.now(),
      fileName: 'avatar.vrm',
      totalSize: vrmArrayBuffer.byteLength,
    };

    peerManager.send(peerId, completeMessage);
    console.log(`[SyncManager] VRM transfer complete to ${peerId} (${successCount}/${totalChunks} chunks sent)`);

    // Clear the sending flag
    this.activeVRMSends.delete(peerId);
  }

  /**
   * Request VRM file from a specific peer
   */
  requestVRMFromPeer(peerId: PeerId) {
    // Avoid duplicate requests
    if (this.pendingVRMRequests.has(peerId)) {
      console.log(`[SyncManager] Already requested VRM from ${peerId}, skipping`);
      return;
    }
    
    // Don't request if we already have their avatar
    if (multiAvatarManager.hasAvatar(peerId)) {
      console.log(`[SyncManager] Already have avatar for ${peerId}, skipping request`);
      return;
    }

    this.pendingVRMRequests.add(peerId);
    
    const store = useMultiplayerStore.getState();
    
    const message: VRMRequestMessage = {
      type: 'vrm-request',
      peerId: store.localPeerId!,
      targetPeerId: peerId,
      timestamp: Date.now(),
    };

    peerManager.send(peerId, message);
    console.log(`[SyncManager] Requesting VRM from peer ${peerId}`);
  }

  /**
   * Send the current custom background to a specific peer
   */
  async sendBackgroundToPeer(peerId: PeerId) {
    if (this.activeBackgroundSends.has(peerId)) return;

    const { customBackgroundData, customBackgroundType } = useSceneSettingsStore.getState();
    if (!customBackgroundData) return;

    if (
      customBackgroundData.length === 0
      || customBackgroundData.length > MAX_BACKGROUND_TRANSFER_BASE64_CHARS
      || !BASE64_CHUNK_PATTERN.test(customBackgroundData)
    ) {
      console.warn(`[SyncManager] Refusing malformed or oversized background transfer to ${peerId}`);
      return;
    }

    let binaryString: string;
    try {
      binaryString = atob(customBackgroundData);
    } catch {
      console.warn(`[SyncManager] Refusing malformed background transfer to ${peerId}`);
      return;
    }

    if (binaryString.length === 0 || binaryString.length > MAX_BACKGROUND_TRANSFER_BYTES) {
      console.warn(`[SyncManager] Refusing background transfer outside the ${MAX_BACKGROUND_TRANSFER_BYTES / MEBIBYTE}MiB limit`);
      return;
    }

    this.activeBackgroundSends.add(peerId);

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    const chunkSize = BACKGROUND_TRANSFER_CHUNK_SIZE;
    const totalChunks = Math.ceil(uint8Array.length / chunkSize);
    const fileName = 'custom-background';

    notifyTransferProgress({
      peerId,
      displayName: peerDisplayName,
      direction: 'sending',
      chunksComplete: 0,
      totalChunks,
      status: 'transferring',
    });

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, uint8Array.length);
      const chunkBytes = uint8Array.slice(start, end);
      
      let binary = '';
      for (let j = 0; j < chunkBytes.length; j++) {
        binary += String.fromCharCode(chunkBytes[j]);
      }
      const base64Chunk = btoa(binary);
      
      const message: BackgroundChunkMessage = {
        type: 'background-chunk',
        peerId: store.localPeerId!,
        targetPeerId: peerId,
        timestamp: Date.now(),
        chunkIndex: i,
        totalChunks,
        data: base64Chunk,
        fileName,
        fileType: customBackgroundType || 'image/png'
      };

      try {
        await peerManager.send(peerId, message);
        notifyTransferProgress({
          peerId,
          displayName: peerDisplayName,
          direction: 'sending',
          chunksComplete: i + 1,
          totalChunks,
          status: 'transferring',
        });
      } catch (error) {
        console.error(`[SyncManager] Background chunk ${i} error:`, error);
      }

      if (i < totalChunks - 1) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }

    const completeMessage: BackgroundCompleteMessage = {
      type: 'background-complete',
      peerId: store.localPeerId!,
      targetPeerId: peerId,
      timestamp: Date.now(),
      fileName,
      fileType: customBackgroundType || 'image/png',
      totalSize: uint8Array.byteLength
    };

    peerManager.send(peerId, completeMessage);
    this.activeBackgroundSends.delete(peerId);
    setTimeout(() => clearTransferProgress(peerId), 3000);
  }

  /**
   * Request background from a specific peer
   */
  requestBackgroundFromPeer(peerId: PeerId) {
    if (this.pendingBackgroundRequests.has(peerId)) return;
    this.pendingBackgroundRequests.add(peerId);

    const store = useMultiplayerStore.getState();
    const message: any = {
      type: 'background-request',
      peerId: store.localPeerId!,
      targetPeerId: peerId,
      timestamp: Date.now(),
    };

    peerManager.send(peerId, message);
    console.log(`[SyncManager] Requested background from ${peerId}`);
  }

  // ==================
  // Incoming Sync
  // ==================

  private handleMessage(peerId: PeerId, message: PeerMessage) {
    switch (message.type) {
      case 'avatar-state':
        this.handleAvatarState(peerId, message as AvatarStateMessage);
        break;

      case 'pose-update':
        this.handlePoseUpdate(peerId, message as PoseUpdateMessage);
        break;

      case 'expression-update':
        this.handleExpressionUpdate(peerId, message as ExpressionUpdateMessage);
        break;

      case 'sync-request':
        this.handleSyncRequest(peerId);
        break;

      case 'sync-response':
        this.handleSyncResponse(message as SyncResponseMessage);
        break;

      case 'scene-sync':
        this.handleSceneSync(message as SceneSyncMessage);
        break;

      case 'vrm-request':
        // Peer is requesting our VRM file
        this.handleVRMRequest(peerId, message as VRMRequestMessage);
        break;

      case 'vrm-chunk':
        this.handleVRMChunk(peerId, message as VRMChunkMessage);
        break;

      case 'vrm-complete':
        this.handleVRMComplete(peerId, message as VRMCompleteMessage);
        break;

      case 'vrm-chunk-request':
        this.handleVRMChunkRequest(peerId, message as VRMChunkRequestMessage);
        break;

      case 'background-request':
        this.handleBackgroundRequest(peerId, message as { type: string; peerId: PeerId; targetPeerId: PeerId });
        break;

      case 'background-chunk':
        this.handleBackgroundChunk(peerId, message as BackgroundChunkMessage);
        break;

      case 'background-complete':
        this.handleBackgroundComplete(peerId, message as BackgroundCompleteMessage);
        break;

      case 'peer-join':
        // When a new peer joins (or we're notified about them), exchange state and VRM
        // The peerId here is who sent the message, message.peerId is who actually joined
        this.handlePeerJoin(peerId, message as { peerId: PeerId; displayName: string });
        break;

      case 'peer-leave':
        this.handlePeerLeave(message.peerId);
        break;
    }
  }

  private handlePeerJoin(senderPeerId: PeerId, message: { peerId: PeerId; displayName: string }) {
    const actualPeerId = message.peerId;
    const store = useMultiplayerStore.getState();
    
    console.log(`[SyncManager] Peer joined notification: ${actualPeerId} (from ${senderPeerId})`);
    
    // If we're the host and someone directly connected to us
    if (store.role === 'host' && senderPeerId === actualPeerId) {
      // Send our full avatar state to the new peer
      this.sendFullStateToPeer(senderPeerId);
      
      // Send our VRM file to the new peer (if we have one)
      const { vrmArrayBuffer } = useAvatarSource.getState();
      if (vrmArrayBuffer) {
        setTimeout(() => {
          this.sendVRMToPeer(senderPeerId);
        }, 500);
      }

      // Request their VRM file
      setTimeout(() => {
        if (!multiAvatarManager.hasAvatar(senderPeerId)) {
          this.requestVRMFromPeer(senderPeerId);
        }
      }, 1000);
    } 
    // If we're a guest and the host told us about another peer
    else if (store.role === 'guest' && senderPeerId !== actualPeerId) {
      console.log(`[SyncManager] Host notified us about peer: ${actualPeerId}`);
      
      // Add the peer to our store
      store.addPeer(actualPeerId, {
        displayName: message.displayName,
        connectionState: 'connected',
        hasAvatar: false,
        isLocal: false,
      });
      
      // We can't directly connect to them (star topology), but we can request
      // their VRM through the host by sending a message that gets relayed
      // For now, we rely on the host to relay VRM data
      
      // The host should handle VRM relay in sync-response
    }
    // If we're a guest and another peer sent us a join message (shouldn't happen in star)
    else if (store.role === 'guest' && senderPeerId === actualPeerId) {
      console.log(`[SyncManager] Direct peer join from: ${actualPeerId}`);
      
      // Send our state back
      this.sendFullStateToPeer(senderPeerId);
      
      // Exchange VRMs
      const { vrmArrayBuffer } = useAvatarSource.getState();
      if (vrmArrayBuffer) {
        setTimeout(() => {
          this.sendVRMToPeer(senderPeerId);
        }, 500);
      }

      setTimeout(() => {
        if (!multiAvatarManager.hasAvatar(senderPeerId)) {
          this.requestVRMFromPeer(senderPeerId);
        }
      }, 1000);
    }
  }

  private handleVRMRequest(senderPeerId: PeerId, message: VRMRequestMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const peerId = senderPeerId;
    console.log(`[SyncManager] VRM requested by peer: ${peerId}`);
    this.sendVRMToPeer(peerId);
  }

  private handleBackgroundRequest(
    senderPeerId: PeerId,
    message: { type: string; peerId: PeerId; targetPeerId: PeerId },
  ) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const peerId = senderPeerId;
    console.log(`[SyncManager] Background requested by peer: ${peerId}`);
    this.sendBackgroundToPeer(peerId);
  }

  private async handleVRMChunkRequest(senderPeerId: PeerId, message: VRMChunkRequestMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const requesterPeerId = senderPeerId;
    const { chunkIndex } = message;
    console.log(`[SyncManager] Received request for missing chunk ${chunkIndex} from ${requesterPeerId}`);

    const { vrmArrayBuffer } = useAvatarSource.getState();
    if (!vrmArrayBuffer) {
      console.warn(`[SyncManager] Cannot resend chunk, no VRM buffer available.`);
      return;
    }

    if (vrmArrayBuffer.byteLength === 0 || vrmArrayBuffer.byteLength > MAX_VRM_TRANSFER_BYTES) {
      console.warn(`[SyncManager] Cannot resend VRM outside the ${MAX_VRM_TRANSFER_BYTES / MEBIBYTE}MiB limit.`);
      return;
    }

    const chunkSize = VRM_TRANSFER_CHUNK_SIZE;
    const uint8Array = new Uint8Array(vrmArrayBuffer);
    const totalChunks = Math.ceil(uint8Array.length / chunkSize);

    if (chunkIndex >= totalChunks || chunkIndex < 0) {
      console.warn(`[SyncManager] Invalid chunk index requested: ${chunkIndex}`);
      return;
    }

    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, uint8Array.length);
    const chunk = uint8Array.slice(start, end);

    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    const base64Chunk = btoa(binary);

    const chunkMessage: VRMChunkMessage = {
      type: 'vrm-chunk',
      peerId: useMultiplayerStore.getState().localPeerId!,
      targetPeerId: requesterPeerId,
      timestamp: Date.now(),
      chunkIndex,
      totalChunks,
      data: base64Chunk,
    };

    try {
      peerManager.send(requesterPeerId, chunkMessage);
      console.log(`[SyncManager] Resent chunk ${chunkIndex} to ${requesterPeerId}`);
    } catch (error) {
      console.error(`[SyncManager] Error resending chunk ${chunkIndex}:`, error);
    }
  }

  private handleBackgroundChunk(senderPeerId: PeerId, message: BackgroundChunkMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const { chunkIndex, totalChunks, data, fileType } = message;
    if (!hasValidChunkCoordinates(chunkIndex, totalChunks, MAX_BACKGROUND_TRANSFER_CHUNKS)) {
      console.warn(`[SyncManager] Ignored background chunk with invalid coordinates from ${senderPeerId}`);
      return;
    }

    const chunkData = decodeTransferChunk(data, BACKGROUND_TRANSFER_CHUNK_SIZE, MAX_BACKGROUND_BASE64_CHARS);
    if (!chunkData) {
      console.warn(`[SyncManager] Ignored malformed background chunk from ${senderPeerId}`);
      return;
    }

    const peerId = senderPeerId;
    let buffer = this.backgroundTransferBuffers.get(peerId);
    if (!buffer || buffer.totalChunks !== totalChunks) {
      this.clearBackgroundBuffer(peerId);
      buffer = {
        chunks: new Array(totalChunks).fill(undefined),
        receivedCount: 0,
        receivedBytes: 0,
        totalChunks,
        fileName: message.fileName,
        fileType,
        expiresAt: 0,
      };
      this.backgroundTransferBuffers.set(peerId, buffer);
    }

    if (buffer.chunks[chunkIndex]) return;
    if (buffer.receivedBytes + chunkData.byteLength > MAX_BACKGROUND_TRANSFER_BYTES) {
      console.warn(`[SyncManager] Ignored oversized background transfer from ${peerId}`);
      this.clearBackgroundTransfer(peerId);
      return;
    }

    buffer.chunks[chunkIndex] = chunkData;
    buffer.receivedCount++;
    buffer.receivedBytes += chunkData.byteLength;
    this.scheduleBackgroundTransferExpiry(peerId);
  }

  private async handleBackgroundComplete(senderPeerId: PeerId, message: BackgroundCompleteMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const peerId = senderPeerId;
    const { fileType, totalSize } = message;
    if (
      !isValidTransferSize(totalSize, MAX_BACKGROUND_TRANSFER_BYTES)
      || typeof fileType !== 'string'
      || fileType.length > 128
    ) {
      console.warn(`[SyncManager] Ignored invalid background completion from ${peerId}`);
      this.clearBackgroundTransfer(peerId);
      return;
    }

    const buffer = this.backgroundTransferBuffers.get(peerId);
    if (!buffer) return;

    if (
      buffer.receivedCount !== buffer.totalChunks
      || buffer.receivedBytes !== totalSize
    ) {
      console.warn(`[SyncManager] Background transfer size mismatch from ${peerId}`);
      this.clearBackgroundTransfer(peerId);
      return;
    }

    const validChunks = buffer.chunks.filter((chunk): chunk is ArrayBuffer => chunk !== undefined);
    const blob = new Blob(validChunks, { type: fileType });
    const blobUrl = URL.createObjectURL(blob);
    sceneManager.setBackground(blobUrl);

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const content = base64data.split(',')[1];
      useSceneSettingsStore.getState().setCustomBackground(content, fileType);
    };
    reader.readAsDataURL(blob);

    console.log(`[SyncManager] Background transfer complete from ${peerId}`);
    this.clearBackgroundTransfer(peerId);
  }

  private handleAvatarState(peerId: PeerId, message: AvatarStateMessage) {
    const { state } = message;
    
    // Update the store
    useMultiplayerStore.getState().updateRemoteAvatarState(peerId, state);
    useMultiplayerStore.getState().updatePeer(peerId, { 
      hasAvatar: state.hasAvatar,
      displayName: state.displayName,
    });

    // Apply to the avatar if it exists
    if (multiAvatarManager.hasAvatar(peerId)) {
      multiAvatarManager.applyAvatarState(peerId, state);
    } else if (state.hasAvatar) {
      // They have an avatar but we don't have their VRM yet - request it
      console.log(`[SyncManager] Peer ${peerId} has avatar but we don't have their VRM, requesting...`);
      this.requestVRMFromPeer(peerId);
    }
  }

  private handlePoseUpdate(peerId: PeerId, message: PoseUpdateMessage) {
    const store = useMultiplayerStore.getState();
    
    // IMPORTANT: Never apply remote poses to our local avatar
    if (peerId === store.localPeerId) {
      console.warn(`[SyncManager] Ignoring pose update for our own avatar (${peerId})`);
      return;
    }

    // Apply pose update directly to the remote avatar
    if (multiAvatarManager.hasAvatar(peerId)) {
      multiAvatarManager.applyPose(peerId, message.pose);
      if (message.sceneRotation) {
        multiAvatarManager.applySceneRotation(peerId, message.sceneRotation);
      }
      if (message.scenePosition) {
        multiAvatarManager.applyScenePosition(peerId, message.scenePosition);
      }
    }

    // Update store with partial state
    const existing = store.remoteAvatarStates.get(peerId);
    if (existing) {
      store.updateRemoteAvatarState(peerId, {
        ...existing,
        pose: message.pose,
        sceneRotation: message.sceneRotation ?? existing.sceneRotation,
        position: message.scenePosition ?? existing.position,
        timestamp: message.timestamp,
      });
    }
  }

  private handleExpressionUpdate(peerId: PeerId, message: ExpressionUpdateMessage) {
    const store = useMultiplayerStore.getState();
    
    // IMPORTANT: Never apply remote expressions to our local avatar
    if (peerId === store.localPeerId) {
      console.warn(`[SyncManager] Ignoring expression update for our own avatar (${peerId})`);
      return;
    }

    if (multiAvatarManager.hasAvatar(peerId)) {
      multiAvatarManager.applyExpressions(peerId, message.expressions);
    }

    // Update store
    const existing = store.remoteAvatarStates.get(peerId);
    if (existing) {
      store.updateRemoteAvatarState(peerId, {
        ...existing,
        expressions: message.expressions,
        timestamp: message.timestamp,
      });
    }
  }

  private handleSyncRequest(peerId: PeerId) {
    const store = useMultiplayerStore.getState();
    
    // Gather all avatar states (local + any we know about)
    const avatarStates: AvatarState[] = [];
    
    const localState = multiAvatarManager.getLocalAvatarState();
    if (localState) {
      avatarStates.push(localState);
    }

    // Include remote states we know about
    store.remoteAvatarStates.forEach((state) => {
      avatarStates.push(state);
    });

    // Get current scene settings
    const aspectRatio = sceneManager.getAspectRatio();

    const response: SyncResponseMessage = {
      type: 'sync-response',
      peerId: store.localPeerId!,
      timestamp: Date.now(),
      avatarStates,
      sceneSettings: {
        aspectRatio,
      },
    };

    peerManager.send(peerId, response);
  }

  private handleSyncResponse(message: SyncResponseMessage) {
    const store = useMultiplayerStore.getState();

    // Apply all avatar states
    message.avatarStates.forEach((state) => {
      if (state.peerId !== store.localPeerId) {
        store.updateRemoteAvatarState(state.peerId, state);
        store.updatePeer(state.peerId, {
          hasAvatar: state.hasAvatar,
          displayName: state.displayName,
        });

        // Apply to existing avatars or request VRM if needed
        if (multiAvatarManager.hasAvatar(state.peerId)) {
          multiAvatarManager.applyAvatarState(state.peerId, state);
        } else if (state.hasAvatar) {
          // They have an avatar but we don't have their VRM - request it
          console.log(`[SyncManager] Peer ${state.peerId} has avatar, requesting VRM...`);
          setTimeout(() => {
            this.requestVRMFromPeer(state.peerId);
          }, 500);
        }
      }
    });

    // Apply scene settings (if we're a guest)
    if (store.role === 'guest' && message.sceneSettings) {
      if (message.sceneSettings.aspectRatio) {
        sceneManager.setAspectRatio(message.sceneSettings.aspectRatio as '16:9' | '1:1' | '9:16');
      }
      if (message.sceneSettings.background) {
        sceneManager.setBackground(message.sceneSettings.background);
      }
    }
  }

  private handleSceneSync(message: SceneSyncMessage) {
    const store = useMultiplayerStore.getState();
    
    // Only apply if from host and we're a guest
    if (store.role === 'guest') {
      if (message.background) {
        if (message.background === 'custom') {
          if (!message.customBackgroundData) {
            console.info('[SyncManager] Waiting for bounded custom background transfer');
          } else {
            // Create data URL from base64 and apply
            const dataUrl = `data:${message.customBackgroundType || 'image/png'};base64,${message.customBackgroundData}`;
            sceneManager.setBackground(dataUrl);

            // Store in scene settings for persistence
            const sceneState = useSceneSettingsStore.getState();
            sceneState.setCustomBackground(message.customBackgroundData, message.customBackgroundType || 'image/png');

            console.log('[SyncManager] Applied custom background from host');
          }
        } else {
          sceneManager.setBackground(message.background);
        }
      }
      if (message.aspectRatio) {
        sceneManager.setAspectRatio(message.aspectRatio as '16:9' | '1:1' | '9:16');
      }
    }
  }

  private handleVRMChunk(senderPeerId: PeerId, message: VRMChunkMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const { chunkIndex, totalChunks, data } = message;
    if (!hasValidChunkCoordinates(chunkIndex, totalChunks, MAX_VRM_TRANSFER_CHUNKS)) {
      console.warn(`[SyncManager] Ignored VRM chunk with invalid coordinates from ${senderPeerId}`);
      return;
    }

    const chunkData = decodeTransferChunk(data, VRM_TRANSFER_CHUNK_SIZE, MAX_VRM_BASE64_CHARS);
    if (!chunkData) {
      console.warn(`[SyncManager] Ignored malformed VRM chunk from ${senderPeerId}`);
      return;
    }

    const peerId = senderPeerId;
    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    const existingBuffer = this.vrmTransferBuffers.get(peerId);
    if (!existingBuffer || existingBuffer.totalChunks !== totalChunks) {
      this.clearVRMBuffer(peerId);
      this.vrmTransferBuffers.set(peerId, {
        chunks: new Array(totalChunks).fill(undefined),
        receivedCount: 0,
        receivedBytes: 0,
        totalChunks,
        fileName: '',
        retries: 0,
        expiresAt: 0,
      });
      notifyTransferProgress({
        peerId,
        displayName: peerDisplayName,
        direction: 'receiving',
        chunksComplete: 0,
        totalChunks,
        status: 'transferring',
      });
    }

    const buffer = this.vrmTransferBuffers.get(peerId)!;
    if (buffer.chunks[chunkIndex]) return;
    if (buffer.receivedBytes + chunkData.byteLength > MAX_VRM_TRANSFER_BYTES) {
      console.warn(`[SyncManager] Ignored oversized VRM transfer from ${peerId}`);
      this.clearVRMTransfer(peerId);
      return;
    }

    buffer.chunks[chunkIndex] = chunkData;
    buffer.receivedCount++;
    buffer.receivedBytes += chunkData.byteLength;
    this.scheduleVRMTransferExpiry(peerId);

    if (buffer.receivedCount % 10 === 0 || buffer.receivedCount === totalChunks) {
      notifyTransferProgress({
        peerId,
        displayName: peerDisplayName,
        direction: 'receiving',
        chunksComplete: buffer.receivedCount,
        totalChunks,
        status: 'transferring',
      });
    }

    console.log(`[SyncManager] Received VRM chunk ${chunkIndex + 1}/${totalChunks} from ${peerId} (${buffer.receivedCount}/${totalChunks} received)`);
  }

  private async handleVRMComplete(senderPeerId: PeerId, message: VRMCompleteMessage) {
    if (!this.isValidDirectedTransferEnvelope(senderPeerId, message)) return;

    const peerId = senderPeerId;
    const { fileName, totalSize } = message;
    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const displayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    if (!isValidTransferSize(totalSize, MAX_VRM_TRANSFER_BYTES)) {
      console.warn(`[SyncManager] Ignored invalid VRM completion from ${peerId}`);
      this.clearVRMTransfer(peerId);
      return;
    }

    const buffer = this.vrmTransferBuffers.get(peerId);
    if (!buffer) {
      console.error('[SyncManager] VRM complete received but no chunks buffered');
      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: 0,
        totalChunks: 0,
        status: 'error',
      });
      return;
    }

    console.log(`[SyncManager] VRM transfer complete from ${peerId}: ${fileName} (${totalSize} bytes)`);
    console.log(`[SyncManager] Received ${buffer.receivedCount}/${buffer.totalChunks} chunks`);
    if (buffer.receivedCount !== buffer.totalChunks) {
      console.error(`[SyncManager] Missing chunks: expected ${buffer.totalChunks}, received ${buffer.receivedCount}`);
      if (buffer.retries < 5) {
        buffer.retries++;
        this.scheduleVRMTransferExpiry(peerId);
        for (let index = 0; index < buffer.totalChunks; index++) {
          if (!buffer.chunks[index]) {
            peerManager.send(peerId, {
              type: 'vrm-chunk-request',
              peerId: useMultiplayerStore.getState().localPeerId!,
              targetPeerId: peerId,
              timestamp: Date.now(),
              chunkIndex: index,
            });
          }
        }
        return;
      }

      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: buffer.receivedCount,
        totalChunks: buffer.totalChunks,
        status: 'error',
      });
      this.clearVRMTransfer(peerId);
      return;
    }

    if (buffer.receivedBytes !== totalSize) {
      console.error(`[SyncManager] VRM transfer size mismatch from ${peerId}`);
      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: buffer.receivedCount,
        totalChunks: buffer.totalChunks,
        status: 'error',
      });
      this.clearVRMTransfer(peerId);
      return;
    }

    notifyTransferProgress({
      peerId,
      displayName,
      direction: 'receiving',
      chunksComplete: buffer.totalChunks,
      totalChunks: buffer.totalChunks,
      status: 'loading',
    });

    try {
      const validChunks = buffer.chunks.filter((chunk): chunk is ArrayBuffer => chunk !== undefined);
      const blob = new Blob(validChunks, { type: 'model/gltf-binary' });
      const arrayBuffer = await blob.arrayBuffer();
      if (arrayBuffer.byteLength !== totalSize) {
        throw new Error('Reassembled VRM size does not match the signed transfer size');
      }

      await multiAvatarManager.loadRemoteAvatarFromBuffer(peerId, arrayBuffer, displayName);
      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: buffer.totalChunks,
        totalChunks: buffer.totalChunks,
        status: 'complete',
      });
      setTimeout(() => clearTransferProgress(peerId), 3000);

      const pendingState = store.remoteAvatarStates.get(peerId);
      if (pendingState) {
        multiAvatarManager.applyAvatarState(peerId, pendingState);
      }
      store.updatePeer(peerId, { hasAvatar: true });
    } catch (error) {
      console.error('[SyncManager] Failed to load remote VRM:', error);
    } finally {
      this.clearVRMTransfer(peerId);
    }
  }

  private handlePeerLeave(peerId: PeerId, removeAvatar = false) {
    // Clean up any pending binary transfers and their expiry timers.
    this.clearVRMTransfer(peerId);
    this.clearBackgroundTransfer(peerId);

    // Only remove the avatar if explicitly requested (e.g., intentional leave)
    // Otherwise, keep the avatar but mark as offline for visual feedback
    if (removeAvatar) {
      multiAvatarManager.removeAvatar(peerId);
      console.log(`[SyncManager] Peer left and avatar removed: ${peerId}`);
    } else {
      // Keep avatar in scene but could add visual indication of offline status
      console.log(`[SyncManager] Peer disconnected (avatar preserved): ${peerId}`);
    }
  }

  private handleConnectionChange(peerId: PeerId, state: string) {
    if (state === 'disconnected') {
      // Don't remove avatar on disconnect - they might reconnect
      // The avatar stays visible as a "ghost" until session ends
      this.handlePeerLeave(peerId, false);
    }
  }

  private sendFullStateToPeer(peerId: PeerId) {
    const state = multiAvatarManager.getLocalAvatarState();
    if (!state) return;

    const message: AvatarStateMessage = {
      type: 'avatar-state',
      peerId: state.peerId,
      timestamp: Date.now(),
      state,
    };

    peerManager.send(peerId, message);
  }

  // ==================
  // Sync Loop
  // ==================

  private startSyncLoop() {
    if (this.syncInterval) return;

    console.log(`[SyncManager] Starting sync loop at ${this.poseSyncRate} Hz`);

    this.syncInterval = setInterval(() => {
      if (!this.isActive) return;

      const now = Date.now();
      
      // Check if we have a local avatar and should send an update
      const localVRM = multiAvatarManager.getLocalVRM();
      if (localVRM) {
        // Rate limit pose updates
        if (now - this.lastPoseSent >= this.poseSyncInterval) {
          this.broadcastPoseUpdate();
          this.lastPoseSent = now;
        }

        // Also sync expressions (for mocap face tracking)
        if (now - this.lastExpressionSent >= this.expressionSyncInterval) {
          this.syncLocalExpressions(localVRM);
          this.lastExpressionSent = now;
        }
      }
    }, Math.max(16, this.poseSyncInterval)); // At least 60fps check
  }

  /**
   * Sync local expressions if they have changed (for mocap face tracking)
   */
  private syncLocalExpressions(vrm: import('@pixiv/three-vrm').VRM) {
    if (!vrm.expressionManager) return;

    const currentExpressions: Record<string, number> = {};
    let hasChanges = false;

    // Get all current expression values
    const manager = vrm.expressionManager as any;
    let expressionNames: string[] = [];

    // Extract available expression names from VRM
    if (manager.expressionMap) {
      expressionNames = Object.keys(manager.expressionMap);
    } else if (manager._expressionMap) {
      expressionNames = Object.keys(manager._expressionMap);
    } else if (manager.expressions) {
      expressionNames = manager.expressions.map((e: any) => e.expressionName).filter(Boolean);
    }

    // Capture current values and check for changes
    expressionNames.forEach(name => {
      const value = vrm.expressionManager!.getValue(name) ?? 0;
      currentExpressions[name] = value;

      // Check if changed significantly (threshold to avoid noise)
      const lastValue = this.lastSentExpressions[name] ?? 0;
      if (Math.abs(value - lastValue) > 0.01) {
        hasChanges = true;
      }
    });

    // Only broadcast if there are meaningful changes
    if (hasChanges) {
      this.broadcastExpressionUpdate(currentExpressions);
      this.lastSentExpressions = currentExpressions;
    }
  }

  private stopSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

// Singleton instance
export const syncManager = new SyncManager();

