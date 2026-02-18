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
  private vrmTransferBuffers = new Map<PeerId, { chunks: (ArrayBuffer | undefined)[]; receivedCount: number; totalChunks: number; fileName: string; retries: number }>();
  private backgroundTransferBuffers = new Map<PeerId, { chunks: (ArrayBuffer | undefined)[]; receivedCount: number; totalChunks: number; fileName: string; fileType: string }>();
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
    this.vrmTransferBuffers.clear();
    this.pendingVRMRequests.clear();
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

    // If background is 'custom', include the custom background data
    let customBackgroundData: string | undefined;
    let customBackgroundType: string | undefined;
    
    if (settings.background === 'custom') {
      const sceneState = useSceneSettingsStore.getState();
      if (sceneState.customBackgroundData) {
        customBackgroundData = sceneState.customBackgroundData;
        customBackgroundType = sceneState.customBackgroundType || 'image/png';
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

    // Mark as sending
    this.activeVRMSends.add(peerId);

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    const chunkSize = DEFAULT_MULTIPLAYER_CONFIG.vrmChunkSize;
    
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

    this.activeBackgroundSends.add(peerId);

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;
    
    // Convert base64 to ArrayBuffer chunks
    // Note: customBackgroundData is currently stored as Base64 string in the store
    // We decode it once here to send efficiently
    const binaryString = atob(customBackgroundData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const uint8Array = bytes;
    
    const chunkSize = 16 * 1024; // 16KB chunks
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
      totalSize: customBackgroundData.length
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
        this.handleVRMRequest(peerId);
        break;

      case 'vrm-chunk':
        this.handleVRMChunk(message as VRMChunkMessage);
        break;

      case 'vrm-complete':
        this.handleVRMComplete(message as VRMCompleteMessage);
        break;

      case 'vrm-chunk-request':
        this.handleVRMChunkRequest(message as any);
        break;

      case 'background-request':
        this.handleBackgroundRequest(peerId);
        break;

      case 'background-chunk':
        this.handleBackgroundChunk(message as BackgroundChunkMessage);
        break;

      case 'background-complete':
        this.handleBackgroundComplete(message as BackgroundCompleteMessage);
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

  private handleVRMRequest(peerId: PeerId) {
    console.log(`[SyncManager] VRM requested by peer: ${peerId}`);
    this.sendVRMToPeer(peerId);
  }

  private handleBackgroundRequest(peerId: PeerId) {
    console.log(`[SyncManager] Background requested by peer: ${peerId}`);
    this.sendBackgroundToPeer(peerId);
  }

  private async handleVRMChunkRequest(message: { peerId: PeerId; targetPeerId: PeerId; chunkIndex: number }) {
    const { peerId: requesterPeerId, chunkIndex } = message;
    console.log(`[SyncManager] Received request for missing chunk ${chunkIndex} from ${requesterPeerId}`);

    const { vrmArrayBuffer } = useAvatarSource.getState();
    if (!vrmArrayBuffer) {
      console.warn(`[SyncManager] Cannot resend chunk, no VRM buffer available.`);
      return;
    }

    const chunkSize = DEFAULT_MULTIPLAYER_CONFIG.vrmChunkSize;
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

  private handleBackgroundChunk(message: BackgroundChunkMessage) {
    const { peerId, chunkIndex, totalChunks, data, fileType } = message;
    
    let buffer = this.backgroundTransferBuffers.get(peerId);
    if (!buffer || buffer.totalChunks !== totalChunks) {
      buffer = {
        chunks: new Array(totalChunks).fill(undefined),
        receivedCount: 0,
        totalChunks,
        fileName: message.fileName,
        fileType
      };
      this.backgroundTransferBuffers.set(peerId, buffer);
    }

    if (!buffer.chunks[chunkIndex]) {
      // Handle legacy string data or new ArrayBuffer
      if (typeof data === 'string') {
          // Convert base64 to ArrayBuffer if needed, or just keep consistency
          // Since we reassemble to base64 for background (because SceneManager takes base64/URL),
          // we might actually want to Convert ArrayBuffer BACK to base64 here if we want to keep `chunks` as string.
          // BUT, for consistency with VRM, let's store ArrayBuffer and convert at the end.
          const binaryString = atob(data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
          }
          buffer.chunks[chunkIndex] = bytes.buffer;
      } else {
          buffer.chunks[chunkIndex] = data;
      }
      buffer.receivedCount++;
    }
  }

  private async handleBackgroundComplete(message: BackgroundCompleteMessage) {
    const { peerId, fileType } = message;
    const buffer = this.backgroundTransferBuffers.get(peerId);
    if (!buffer) return;

    if (buffer.receivedCount === buffer.totalChunks) {
      // Filter valid chunks
      const validChunks = buffer.chunks.filter((c): c is ArrayBuffer => c !== undefined);
      
      // Create Blob
      const blob = new Blob(validChunks, { type: fileType });
      
      // Convert Blob to Base64 (DataURL) for SceneManager
      // Alternatively, SceneManager could take a blob URL, which is more efficient!
      // Let's check SceneManager... it takes a string (URL or DataURL).
      // Blob URL is perfect and faster.
      const blobUrl = URL.createObjectURL(blob);
      
      // Apply background
      sceneManager.setBackground(blobUrl);
      
      // For persistence, we still need the Base64 data if we want to save it to the store/project file
      // But for immediate display, Blob URL is fine.
      // Let's generate Base64 for the store to maintain compatibility.
      const reader = new FileReader();
      reader.onloadend = () => {
          const base64data = reader.result as string;
          // Strip the prefix "data:image/png;base64,"
          const content = base64data.split(',')[1];
          
          const sceneState = useSceneSettingsStore.getState();
          sceneState.setCustomBackground(content, fileType);
      };
      reader.readAsDataURL(blob);
      
      console.log(`[SyncManager] Background transfer complete from ${peerId}`);
    }

    this.backgroundTransferBuffers.delete(peerId);
    this.pendingBackgroundRequests.delete(peerId);
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
        if (message.background === 'custom' && message.customBackgroundData) {
          // Create data URL from base64 and apply
          const dataUrl = `data:${message.customBackgroundType || 'image/png'};base64,${message.customBackgroundData}`;
          sceneManager.setBackground(dataUrl);
          
          // Store in scene settings for persistence
          const sceneState = useSceneSettingsStore.getState();
          sceneState.setCustomBackground(message.customBackgroundData, message.customBackgroundType || 'image/png');
          
          console.log('[SyncManager] Applied custom background from host');
        } else {
          sceneManager.setBackground(message.background);
        }
      }
      if (message.aspectRatio) {
        sceneManager.setAspectRatio(message.aspectRatio as '16:9' | '1:1' | '9:16');
      }
    }
  }

  private handleVRMChunk(message: VRMChunkMessage) {
    const { peerId, chunkIndex, totalChunks, data } = message;

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const peerDisplayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;

    // Initialize or reset buffer for this peer
    // If totalChunks differs, this is a new transfer - reset the buffer
    const existingBuffer = this.vrmTransferBuffers.get(peerId);
    if (!existingBuffer || existingBuffer.totalChunks !== totalChunks) {
      this.vrmTransferBuffers.set(peerId, {
        chunks: new Array(totalChunks).fill(undefined),
        receivedCount: 0,
        totalChunks,
        fileName: '',
        retries: 0,
      });
      
      // Notify UI of transfer start
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
    
    // Validate data is an ArrayBuffer (or string if legacy)
    let chunkData: ArrayBuffer;
    if (typeof data === 'string') {
        // Legacy support or fallback: decode base64
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        chunkData = bytes.buffer;
    } else {
        chunkData = data;
    }
    
    // Only count if this chunk wasn't already received (avoid duplicates)
    const isNewChunk = !buffer.chunks[chunkIndex];
    buffer.chunks[chunkIndex] = chunkData;
    
    if (isNewChunk) {
      buffer.receivedCount++;

      // Update progress UI (only on new chunks to avoid spam)
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
  }

  private async handleVRMComplete(message: VRMCompleteMessage) {
    const { peerId, fileName, totalSize } = message;
    const buffer = this.vrmTransferBuffers.get(peerId);

    const store = useMultiplayerStore.getState();
    const peerInfo = store.peers.get(peerId);
    const displayName = peerInfo?.displayName ?? `Peer-${peerId.slice(-4)}`;

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

    // Verify all chunks were received
    if (buffer.receivedCount !== buffer.totalChunks) {
      console.error(`[SyncManager] Missing chunks: expected ${buffer.totalChunks}, received ${buffer.receivedCount}`);
      
      if (buffer.retries < 5) {
        buffer.retries++;
        console.log(`[SyncManager] Requesting missing chunks (attempt ${buffer.retries})...`);
        for (let i = 0; i < buffer.totalChunks; i++) {
          if (!buffer.chunks[i]) {
            const requestMessage: VRMChunkRequestMessage = {
              type: 'vrm-chunk-request',
              peerId: useMultiplayerStore.getState().localPeerId!,
              targetPeerId: peerId,
              timestamp: Date.now(),
              chunkIndex: i,
            };
            peerManager.send(peerId, requestMessage);
          }
        }
        // Don't delete the buffer, wait for the requested chunks
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
      this.vrmTransferBuffers.delete(peerId);
      this.pendingVRMRequests.delete(peerId);
      return;
    }

    // Verify no empty chunks
    for (let i = 0; i < buffer.chunks.length; i++) {
      if (!buffer.chunks[i]) {
        console.error(`[SyncManager] Missing chunk at index ${i}`);
        
        if (buffer.retries < 5) {
          buffer.retries++;
          const requestMessage: VRMChunkRequestMessage = {
            type: 'vrm-chunk-request',
            peerId: useMultiplayerStore.getState().localPeerId!,
            targetPeerId: peerId,
            timestamp: Date.now(),
            chunkIndex: i,
          };
          peerManager.send(peerId, requestMessage);
          // Don't delete buffer, wait for retry
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
        this.vrmTransferBuffers.delete(peerId);
        this.pendingVRMRequests.delete(peerId);
        return;
      }
    }

    // Update UI to show loading state
    notifyTransferProgress({
      peerId,
      displayName,
      direction: 'receiving',
      chunksComplete: buffer.totalChunks,
      totalChunks: buffer.totalChunks,
      status: 'loading',
    });

    try {
      // Reassemble from ArrayBuffer chunks
      // Filter out undefined chunks (should already be verified, but for type safety)
      const validChunks = buffer.chunks.filter((c): c is ArrayBuffer => c !== undefined);
      
      console.log(`[SyncManager] Reassembling from ${validChunks.length} chunks`);
      
      // Create Blob directly from ArrayBuffers
      const blob = new Blob(validChunks, { type: 'model/gltf-binary' });
      const arrayBuffer = await blob.arrayBuffer();

      console.log(`[SyncManager] Decoded ${arrayBuffer.byteLength} bytes`);

      // Load the VRM
      console.log(`[SyncManager] Loading VRM for ${displayName}`);
      await multiAvatarManager.loadRemoteAvatarFromBuffer(peerId, arrayBuffer, displayName);

      console.log(`[SyncManager] Remote avatar loaded for ${peerId}`);

      // Mark as complete
      notifyTransferProgress({
        peerId,
        displayName,
        direction: 'receiving',
        chunksComplete: buffer.totalChunks,
        totalChunks: buffer.totalChunks,
        status: 'complete',
      });
      // Clear after a delay
      setTimeout(() => clearTransferProgress(peerId), 3000);

      // Apply any pending state we received
      const pendingState = store.remoteAvatarStates.get(peerId);
      if (pendingState) {
        console.log(`[SyncManager] Applying pending state for ${peerId}`);
        multiAvatarManager.applyAvatarState(peerId, pendingState);
      }

      // Update peer info to show they have an avatar loaded on our end
      store.updatePeer(peerId, { hasAvatar: true });

    } catch (error) {
      console.error('[SyncManager] Failed to load remote VRM:', error);
    } finally {
      // Clean up
      this.vrmTransferBuffers.delete(peerId);
      this.pendingVRMRequests.delete(peerId);
    }
  }

  private handlePeerLeave(peerId: PeerId, removeAvatar = false) {
    // Clean up any pending VRM transfers
    this.vrmTransferBuffers.delete(peerId);
    this.pendingVRMRequests.delete(peerId);

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

