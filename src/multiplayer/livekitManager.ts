import {
  Room,
  RoomEvent,
  RemoteParticipant,
  ConnectionState as LKConnectionState,
} from 'livekit-client';
import type { 
  PeerId, 
  RoomId, 
  PeerMessage, 
  ConnectionState,
  MultiplayerConfig,
} from '../types/multiplayer';
import { DEFAULT_MULTIPLAYER_CONFIG } from '../types/multiplayer';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { voiceChatManager } from './voiceChatManager';
import { multiAvatarManager } from '../three/multiAvatarManager';

type MessageHandler = (peerId: PeerId, message: PeerMessage) => void;
type ConnectionHandler = (peerId: PeerId, state: ConnectionState) => void;
type ErrorHandler = (error: Error) => void;
type BackgroundTransferHandler = (peerId: PeerId, fileName: string, fileType: string, dataUrl: string) => void;

/**
 * LiveKitManager handles WebRTC connections using LiveKit.
 * Replaces the previous PeerJS-based PeerManager.
 */
class LiveKitManager {
  private room: Room | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private config: MultiplayerConfig;
  
  // Track connection state
  private isConnecting = false;

  constructor(config: Partial<MultiplayerConfig> = {}) {
    this.config = { ...DEFAULT_MULTIPLAYER_CONFIG, ...config };
  }

  // ==================
  // Session Management
  // ==================

  /**
   * Create a new session (Host)
   * In LiveKit, creating and joining are similar, but we generates a unique room name for the host.
   */
  async createSession(displayName: string): Promise<RoomId> {
    const roomId = this.generateRoomId();
    await this.connectToRoom(roomId, displayName, 'host');
    return roomId;
  }

  /**
   * Join an existing session (Guest)
   */
  async joinSession(roomId: RoomId, displayName: string): Promise<void> {
    await this.connectToRoom(roomId, displayName, 'guest');
  }

  private async connectToRoom(roomId: RoomId, displayName: string, role: 'host' | 'guest') {
    const store = useMultiplayerStore.getState();
    
    if (this.isConnecting || this.room?.state === LKConnectionState.Connected) {
      console.warn('[LiveKitManager] Already connected or connecting');
      return;
    }

    this.isConnecting = true;
    store.setConnecting(true);
    store.setError(null);

    try {
      // 1. Get Token from Netlify Function
      const { token, url } = await this.fetchToken(roomId, displayName);
      
      // 2. Initialize Room
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          simulcast: true,
        },
      });

      // 3. Setup Event Listeners
      this.setupRoomListeners();

      // 4. Connect
      const wsUrl = url || import.meta.env.VITE_LIVEKIT_URL || "wss://your-project.livekit.cloud";
      console.log(`[LiveKitManager] Connecting to ${wsUrl} as ${displayName}`);
      
      await this.room.connect(wsUrl, token);
      
      console.log('[LiveKitManager] Connected to room:', this.room.name);

      // 5. Update Store
      store.setLocalPeerId(this.room.localParticipant.identity);
      store.setRoomId(roomId);
      store.setRole(role);
      store.setLocalDisplayName(displayName);
      store.setConnected(true);

      // Add self
      store.addPeer(this.room.localParticipant.identity, {
        displayName,
        connectionState: 'connected',
        hasAvatar: false,
        isLocal: true,
      });

      // Add existing participants
      this.room.remoteParticipants.forEach((participant) => {
        this.handleParticipantConnected(participant);
      });

      // Initialize Voice Chat
      // VoiceChatManager will now use this.room
      voiceChatManager.setRoom(this.room);

      this.isConnecting = false;

    } catch (error: any) {
      console.error('[LiveKitManager] Connection failed:', error);
      store.setError(error.message || 'Failed to connect to LiveKit');
      store.setConnecting(false);
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Leave the current session
   */
  async leaveSession() {
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    
    const store = useMultiplayerStore.getState();
    store.resetSession();
    voiceChatManager.disable();
    multiAvatarManager.endSession();
  }

  // ==================
  // Messaging
  // ==================

  /**
   * Send a message to a specific peer
   * LiveKit Data Packet (Reliable)
   */
  async send(peerId: PeerId, message: PeerMessage): Promise<boolean> {
    if (!this.room) return false;

    try {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      const destination = [peerId]; // Array of sids or identities? Identity usually.
      
      await this.room.localParticipant.publishData(payload, {
          reliable: true,
          destinationIdentities: destination
      });
      return true;
    } catch (error) {
      console.error('[LiveKitManager] Send error:', error);
      return false;
    }
  }

  /**
   * Broadcast a message to all connected peers
   */
  async broadcast(message: PeerMessage): Promise<void> {
    if (!this.room) return;

    try {
      const payload = new TextEncoder().encode(JSON.stringify(message));
      
      // Determine reliability based on message type
      // Pose updates can be lossy (unreliable) for lower latency
      const reliable = message.type !== 'pose-update';

      await this.room.localParticipant.publishData(payload, {
        reliable,
        // No destination means broadcast to all
      });
    } catch (error) {
      console.error('[LiveKitManager] Broadcast error:', error);
    }
  }

  // ==================
  // Event Handlers
  // ==================

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // Stub for legacy background transfer handler
  onBackgroundTransfer(_handler: BackgroundTransferHandler): () => void {
      // LiveKit doesn't handle this directly, SyncManager does via messages
      return () => {};
  }

  // ==================
  // Utilities
  // ==================

  /**
   * Get the local peer ID
   */
  getLocalPeerId(): PeerId | null {
    return this.room?.localParticipant.identity ?? null;
  }

  /**
   * Check if connected to any peers
   */
  isConnected(): boolean {
    return (this.room?.state === LKConnectionState.Connected);
  }

  /**
   * Get count of connected peers
   */
  getConnectionCount(): number {
    return this.room?.remoteParticipants.size ?? 0;
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeerIds(): PeerId[] {
    if (!this.room) return [];
    return Array.from(this.room.remoteParticipants.keys());
  }

  /**
   * Generate the shareable session URL
   */
  getSessionUrl(): string {
    const store = useMultiplayerStore.getState();
    const roomId = store.roomId;
    if (!roomId) return '';

    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
  }

  /**
   * Check if there's a room ID in the current URL
   */
  static getRoomIdFromUrl(): RoomId | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
  }

  /**
   * Clear room ID from URL without page reload
   */
  static clearRoomIdFromUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  }

  /**
   * Request a background from a peer (Wrapper for send)
   */
  requestBackground(peerId: PeerId) {
    const localPeerId = this.getLocalPeerId();
    if (!localPeerId) return;

    // Use generic send
    const message: any = {
      type: 'background-request',
      peerId: localPeerId,
      targetPeerId: peerId,
      timestamp: Date.now(),
    };
    this.send(peerId, message);
  }

  /**
   * Send a background file to a peer
   */
  async sendBackground(peerId: PeerId, file: File) {
    const localPeerId = this.getLocalPeerId();
    if (!localPeerId) return;

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const chunkSize = this.config.vrmChunkSize; 
    const totalChunks = Math.ceil(base64Data.length / chunkSize);

    console.log(`[LiveKitManager] Sending background ${file.name} to ${peerId} in ${totalChunks} chunks.`);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.slice(i * chunkSize, (i + 1) * chunkSize);
      const message: any = {
        type: 'background-chunk',
        peerId: localPeerId,
        targetPeerId: peerId,
        chunkIndex: i,
        totalChunks,
        data: chunk,
        fileName: file.name,
        fileType: file.type,
        timestamp: Date.now(),
      };
      
      await this.send(peerId, message);
    }

    // Send complete message
    const completeMessage: any = {
      type: 'background-complete',
      peerId: localPeerId,
      targetPeerId: peerId,
      fileName: file.name,
      fileType: file.type,
      totalSize: file.size,
      timestamp: Date.now(),
    };
    this.send(peerId, completeMessage);
  }

  // ==================
  // Internal
  // ==================

  private async fetchToken(roomName: string, participantName: string): Promise<{ token: string, url: string }> {
    const response = await fetch('/.netlify/functions/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, participantName }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch token');
    }

    const data = await response.json().catch(async (_e) => {
      const text = await response.text();
      console.error('Failed to parse token response:', text);
      throw new Error(`Invalid response from server: ${text.substring(0, 100)}...`);
    });
    return { token: data.token, url: data.url };
  }

  private setupRoomListeners() {
    if (!this.room) return;

    this.room
      .on(RoomEvent.ParticipantConnected, (participant) => {
        this.handleParticipantConnected(participant);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.handleParticipantDisconnected(participant);
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, _topic) => {
        if (participant) {
          this.handleDataReceived(payload, participant);
        }
      })
      .on(RoomEvent.Disconnected, () => {
        this.handleRoomDisconnect();
      })
      .on(RoomEvent.Reconnecting, () => {
         console.log('[LiveKitManager] Reconnecting...');
         useMultiplayerStore.getState().setError('Reconnecting...');
      })
      .on(RoomEvent.Reconnected, () => {
         console.log('[LiveKitManager] Reconnected');
         useMultiplayerStore.getState().setError(null);
      });
  }

  private handleParticipantConnected(participant: RemoteParticipant) {
    console.log('[LiveKitManager] Participant connected:', participant.identity);
    const store = useMultiplayerStore.getState();
    
    // Add to store
    store.addPeer(participant.identity, {
      displayName: participant.name || `Peer-${participant.identity}`,
      connectionState: 'connected',
      hasAvatar: false,
      isLocal: false,
    });

    this.notifyConnectionChange(participant.identity, 'connected');
    
    // Simulate peer-join for syncManager
    this.notifyMessage(participant.identity, {
        type: 'peer-join',
        peerId: participant.identity,
        displayName: participant.name || 'Unknown',
        timestamp: Date.now()
    });
  }

  private handleParticipantDisconnected(participant: RemoteParticipant) {
    console.log('[LiveKitManager] Participant disconnected:', participant.identity);
    const store = useMultiplayerStore.getState();
    
    store.removePeer(participant.identity);
    this.notifyConnectionChange(participant.identity, 'disconnected');
    
    this.notifyMessage(participant.identity, {
        type: 'peer-leave',
        peerId: participant.identity,
        timestamp: Date.now()
    });
  }

  private handleDataReceived(payload: Uint8Array, participant: RemoteParticipant) {
    try {
      const decoder = new TextDecoder();
      const json = decoder.decode(payload);
      const message = JSON.parse(json) as PeerMessage;
      
      this.notifyMessage(participant.identity, message);
    } catch (error) {
      console.error('[LiveKitManager] Failed to parse incoming data:', error);
    }
  }

  private handleRoomDisconnect() {
    console.log('[LiveKitManager] Disconnected from room');
    const store = useMultiplayerStore.getState();
    store.setConnected(false);
    store.setError('Disconnected from session');
    
    // Notify all
    store.peers.forEach((p) => {
        if (!p.isLocal) {
            this.notifyConnectionChange(p.peerId, 'disconnected');
        }
    });
  }

  private notifyMessage(peerId: PeerId, message: PeerMessage) {
    this.messageHandlers.forEach(handler => handler(peerId, message));
  }

  private notifyConnectionChange(peerId: PeerId, state: ConnectionState) {
    this.connectionHandlers.forEach(handler => handler(peerId, state));
  }

  private generateRoomId(): RoomId {
    // Generate a memorable room ID
    const adjectives = ['swift', 'cosmic', 'neon', 'cyber', 'quantum', 'neural', 'void', 'azure'];
    const nouns = ['runner', 'ghost', 'phoenix', 'matrix', 'nexus', 'pulse', 'wave', 'forge'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${adj}-${noun}-${num}`;
  }

  // Utilities for other managers
  getRoom() {
      return this.room;
  }
  
  getLocalParticipantIdentity() {
      return this.room?.localParticipant.identity;
  }
}

export const liveKitManager = new LiveKitManager();
