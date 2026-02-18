import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { 
  PeerId, 
  RoomId, 
  PeerMessage, 
  ConnectionState,
  MultiplayerConfig,
  BackgroundRequestMessage,
  BackgroundChunkMessage,
  BackgroundCompleteMessage,
} from '../types/multiplayer';
import { DEFAULT_MULTIPLAYER_CONFIG } from '../types/multiplayer';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { voiceChatManager } from './voiceChatManager';

type MessageHandler = (peerId: PeerId, message: PeerMessage) => void;
type ConnectionHandler = (peerId: PeerId, state: ConnectionState) => void;
type ErrorHandler = (error: Error) => void;
type BackgroundTransferHandler = (peerId: PeerId, fileName: string, fileType: string, dataUrl: string) => void;

/**
 * PeerManager handles WebRTC peer-to-peer connections using PeerJS.
 * Manages session creation, joining, and message routing.
 */
class PeerManager {
  private peer: Peer | null = null;
  private connections = new Map<PeerId, DataConnection>();
  private messageHandlers = new Set<MessageHandler>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private backgroundTransferHandlers = new Set<BackgroundTransferHandler>();
  private config: MultiplayerConfig;
  private reconnectTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  // Temporary storage for incoming file chunks
  private incomingFileBuffers = new Map<PeerId, Map<string, { chunks: (string | ArrayBuffer)[]; totalChunks: number; fileName: string; fileType: string }>>();
  
  // Auto-reconnect state
  private reconnectAttempts = 0;
  private lastRoomId: RoomId | null = null;
  private lastDisplayName: string | null = null;
  private lastRole: 'host' | 'guest' | null = null;

  constructor(config: Partial<MultiplayerConfig> = {}) {
    this.config = { ...DEFAULT_MULTIPLAYER_CONFIG, ...config };
  }

  // ==================
  // Session Management
  // ==================

  /**
   * Create a new session as host
   * @returns The room ID (which is the host's peer ID)
   */
  async createSession(displayName: string): Promise<RoomId> {
    const store = useMultiplayerStore.getState();
    store.setConnecting(true);
    store.setError(null);

    return new Promise((resolve, reject) => {
      // Generate a unique room ID
      const roomId = this.generateRoomId();
      
      this.peer = new Peer(roomId, {
        debug: 1, // Minimal logging
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        store.setError('Connection timeout');
        this.destroy();
      }, this.config.connectionTimeout);

      this.peer.on('open', (id) => {
        clearTimeout(timeout);
        console.log('[PeerManager] Session created with ID:', id);

        store.setLocalPeerId(id);
        store.setRoomId(id);
        store.setRole('host');
        store.setConnected(true);
        store.setLocalDisplayName(displayName);

        // Add self to peers list
        store.addPeer(id, {
          displayName,
          connectionState: 'connected',
          hasAvatar: false,
          isLocal: true,
        });

        // Share peer instance with voice chat manager
        // voiceChatManager.setPeer(this.peer);
        
        this.startHeartbeat();
        
        // Store for auto-reconnect
        this.lastRoomId = id;
        this.lastDisplayName = displayName;
        this.lastRole = 'host';
        this.reconnectAttempts = 0;

        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[PeerManager] Error:', err);
        
        // Specific error handling
        if (err.type === 'peer-unavailable') {
             store.setError(`Session ${roomId} not found or expired.`);
        } else if (err.type === 'unavailable-id') {
             store.setError(`Session ID collision. Please try again.`);
        } else if (err.type === 'network') {
             store.setError(`Network error. Please check your connection.`);
             // Potentially trigger auto-reconnect logic here if appropriate
        } else {
             store.setError(err.message);
        }
        
        this.notifyError(err);
        reject(err);
      });

      this.peer.on('disconnected', () => {
        console.warn('[PeerManager] Disconnected from signaling server');
        this.handleDisconnect();
      });
    });
  }

  /**
   * Join an existing session as guest
   * @param roomId - The room ID to join (host's peer ID)
   */
  async joinSession(roomId: RoomId, displayName: string): Promise<void> {
    const store = useMultiplayerStore.getState();
    store.setConnecting(true);
    store.setError(null);

    return new Promise((resolve, reject) => {
      // Create our own peer with a random ID
      const myPeerId = this.generatePeerId();
      
      this.peer = new Peer(myPeerId, {
        debug: 1,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        store.setError('Connection timeout');
        this.destroy();
      }, this.config.connectionTimeout);

      this.peer.on('open', (id) => {
        console.log('[PeerManager] My peer ID:', id);
        
        store.setLocalPeerId(id);
        store.setRoomId(roomId);
        store.setRole('guest');
        store.setLocalDisplayName(displayName);

        // Add self to peers list
        store.addPeer(id, {
          displayName,
          connectionState: 'connected',
          hasAvatar: false,
          isLocal: true,
        });

        // Share peer instance with voice chat manager
        // voiceChatManager.setPeer(this.peer);

        // Connect to the host
        console.log('[PeerManager] Connecting to host:', roomId);
        const conn = this.peer!.connect(roomId, {
          reliable: true,
          serialization: 'binary',
        });

        conn.on('open', () => {
          clearTimeout(timeout);
          console.log('[PeerManager] Connected to host');
          
          this.connections.set(roomId, conn);
          store.setConnected(true);
          
          // Add host to peers list
          store.addPeer(roomId, {
            displayName: 'Host', // Will be updated when we receive their info
            connectionState: 'connected',
            hasAvatar: false,
            isLocal: false,
          });

          this.setupConnectionHandlers(conn, roomId);
          this.notifyConnectionChange(roomId, 'connected');

          // Send join message
          this.send(roomId, {
            type: 'peer-join',
            peerId: id,
            displayName,
            timestamp: Date.now(),
          });

          // Request sync from host
          this.send(roomId, {
            type: 'sync-request',
            peerId: id,
            timestamp: Date.now(),
          });
          
          this.startHeartbeat();
          
          // Store for auto-reconnect
          this.lastRoomId = roomId;
          this.lastDisplayName = displayName;
          this.lastRole = 'guest';
          this.reconnectAttempts = 0;

          resolve();
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          console.error('[PeerManager] Connection error:', err);
          store.setError('Failed to connect to session');
          reject(err);
        });
      });

      // Handle incoming connections from other peers (mesh network)
      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[PeerManager] Peer error:', err);
        store.setError(err.message);
        this.notifyError(err);
        reject(err);
      });
      
      this.peer.on('disconnected', () => {
        console.warn('[PeerManager] Guest disconnected from signaling server');
        this.handleDisconnect();
      });
    });
  }

  /**
   * Leave the current session
   */
  leaveSession() {
    const store = useMultiplayerStore.getState();
    const localPeerId = store.localPeerId;

    if (localPeerId) {
      // Notify all peers that we're leaving
      this.broadcast({
        type: 'peer-leave',
        peerId: localPeerId,
        timestamp: Date.now(),
      });
    }

    // Clear reconnect state (intentional leave)
    this.lastRoomId = null;
    this.lastDisplayName = null;
    this.lastRole = null;
    this.reconnectAttempts = 0;

    this.destroy();
    store.resetSession();
  }

  // ==================
  // Messaging
  // ==================

  /**
   * Send a message to a specific peer
   */
  send(peerId: PeerId, message: PeerMessage): boolean {
    const conn = this.connections.get(peerId);
    if (!conn || conn.open === false) {
      console.warn('[PeerManager] Cannot send to peer:', peerId, '- not connected');
      return false;
    }

    try {
      conn.send(message);
      return true;
    } catch (error) {
      console.error('[PeerManager] Send error:', error);
      return false;
    }
  }

  /**
   * Broadcast a message to all connected peers
   */
  broadcast(message: PeerMessage): void {
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        try {
          conn.send(message);
        } catch (error) {
          console.error('[PeerManager] Broadcast error to', peerId, ':', error);
        }
      }
    });
  }

  /**
   * Broadcast a message to all peers except one
   */
  broadcastExcept(excludePeerId: PeerId, message: PeerMessage): void {
    this.connections.forEach((conn, peerId) => {
      if (peerId !== excludePeerId && conn.open) {
        try {
          conn.send(message);
        } catch (error) {
          console.error('[PeerManager] Broadcast error to', peerId, ':', error);
        }
      }
    });
  }

  // ==================
  // Event Handlers
  // ==================

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register a connection state handler
   */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  /**
   * Register an error handler
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Register a background transfer completion handler
   */
  onBackgroundTransfer(handler: BackgroundTransferHandler): () => void {
    this.backgroundTransferHandlers.add(handler);
    return () => this.backgroundTransferHandlers.delete(handler);
  }

  // ==================
  // Utilities
  // ==================

  /**
   * Get the local peer ID
   */
  getLocalPeerId(): PeerId | null {
    return this.peer?.id ?? null;
  }

  /**
   * Check if connected to any peers
   */
  isConnected(): boolean {
    return this.connections.size > 0;
  }

  /**
   * Get count of connected peers
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get list of connected peer IDs
   */
  getConnectedPeerIds(): PeerId[] {
    return Array.from(this.connections.keys());
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

  // ==================
  // Internal
  // ==================

  private handleIncomingConnection(conn: DataConnection) {
    const peerId = conn.peer;
    console.log('[PeerManager] Incoming connection from:', peerId);

    const store = useMultiplayerStore.getState();

    // Check max peers
    if (this.connections.size >= this.config.maxPeers) {
      console.warn('[PeerManager] Max peers reached, rejecting:', peerId);
      conn.close();
      return;
    }

    conn.on('open', () => {
      console.log('[PeerManager] Connection opened with:', peerId);
      
      this.connections.set(peerId, conn);
      
      // Add peer to store (will be updated with display name when we receive join message)
      store.addPeer(peerId, {
        displayName: `Peer-${peerId.slice(-4)}`,
        connectionState: 'connected',
        hasAvatar: false,
        isLocal: false,
      });

      this.setupConnectionHandlers(conn, peerId);
      this.notifyConnectionChange(peerId, 'connected');
    });

    conn.on('error', (err) => {
      console.error('[PeerManager] Connection error with', peerId, ':', err);
      this.notifyConnectionChange(peerId, 'error');
    });
  }

  private setupConnectionHandlers(conn: DataConnection, peerId: PeerId) {
    const store = useMultiplayerStore.getState();

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      this.handleMessage(peerId, message);
    });

    conn.on('close', () => {
      console.log('[PeerManager] Connection closed:', peerId);
      this.connections.delete(peerId);
      store.removePeer(peerId);
      this.notifyConnectionChange(peerId, 'disconnected');
      
      // Notify voice chat manager
      voiceChatManager.handlePeerLeave(peerId);

      // Clear any reconnect timer
      const timer = this.reconnectTimers.get(peerId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(peerId);
      }
    });

    conn.on('error', (err) => {
      console.error('[PeerManager] Connection error:', peerId, err);
      store.updatePeer(peerId, { connectionState: 'error' });
      this.notifyConnectionChange(peerId, 'error');
    });
  }

  private handleMessage(peerId: PeerId, message: PeerMessage) {
    const store = useMultiplayerStore.getState();

    // Handle built-in message types
    switch (message.type) {
      case 'peer-join':
        store.updatePeer(peerId, { displayName: message.displayName });
        // If we're host, notify other peers about the new peer
        if (store.role === 'host') {
          // Tell existing peers about the new peer
          this.broadcastExcept(peerId, {
            type: 'peer-join',
            peerId: message.peerId,
            displayName: message.displayName,
            timestamp: Date.now(),
          });
          
          // Tell the new peer about all existing peers
          store.peers.forEach((peerInfo, existingPeerId) => {
            if (existingPeerId !== peerId && existingPeerId !== store.localPeerId) {
              this.send(peerId, {
                type: 'peer-join',
                peerId: existingPeerId,
                displayName: peerInfo.displayName,
                timestamp: Date.now(),
              });
            }
          });
        }
        break;

      case 'peer-leave':
        store.removePeer(message.peerId);
        break;

      case 'ping':
        this.send(peerId, {
          type: 'pong',
          peerId: store.localPeerId!,
          sentAt: message.sentAt,
          receivedAt: Date.now(),
          timestamp: Date.now(),
        });
        break;

      case 'pong':
        const latency = Date.now() - message.sentAt;
        store.updatePeerLatency(peerId, latency);
        break;

      case 'background-request':
        this.handleBackgroundRequest(peerId, message as BackgroundRequestMessage);
        break;

      case 'background-chunk':
        this.handleBackgroundChunk(peerId, message as BackgroundChunkMessage);
        break;

      case 'background-complete':
        this.handleBackgroundComplete(peerId, message as BackgroundCompleteMessage);
        break;
    }

    // Notify all handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(peerId, message);
      } catch (error) {
        console.error('[PeerManager] Message handler error:', error);
      }
    });
  }

  private notifyConnectionChange(peerId: PeerId, state: ConnectionState) {
    this.connectionHandlers.forEach(handler => {
      try {
        handler(peerId, state);
      } catch (error) {
        console.error('[PeerManager] Connection handler error:', error);
      }
    });
  }

  private notifyError(error: Error) {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (e) {
        console.error('[PeerManager] Error handler error:', e);
      }
    });
  }

  private handleBackgroundRequest(peerId: PeerId, _message: BackgroundRequestMessage) {
    // Host receives a request for a background
    const store = useMultiplayerStore.getState();
    if (store.role === 'host') {
      // For now, assume host has the background. In a real app, you'd retrieve it.
      // For testing, let's simulate sending a simple animated background (e.g., a small WebM)
      console.log(`[PeerManager] Host received background request from ${peerId}.`);

      // Here you would typically load the actual animated background file.
      // For demonstration, let's assume a placeholder file is available.
      // In a real scenario, you'd load from a local cache or a specific path.
      const placeholderBackgroundData = `data:video/webm;base64,GkXfo6NChoEBQveBAULygQYJ/EBkQoaBAgSYhCEE///LwYAAQAAAoWlmo/`
      const fileName = "placeholder.webm";
      const fileType = "video/webm";
      const totalSize = placeholderBackgroundData.length; // Approximate size

      const chunkSize = this.config.vrmChunkSize;
      const totalChunks = Math.ceil(placeholderBackgroundData.length / chunkSize);

      for (let i = 0; i < totalChunks; i++) {
        const chunk = placeholderBackgroundData.slice(i * chunkSize, (i + 1) * chunkSize);
        const chunkMessage: BackgroundChunkMessage = {
          type: 'background-chunk',
          peerId: store.localPeerId!,
          targetPeerId: peerId,
          chunkIndex: i,
          totalChunks,
          data: chunk,
          fileName,
          fileType,
          timestamp: Date.now(),
        };
        this.send(peerId, chunkMessage);
      }

      const completeMessage: BackgroundCompleteMessage = {
        type: 'background-complete',
        peerId: store.localPeerId!,
        targetPeerId: peerId,
        fileName,
        fileType,
        totalSize,
        timestamp: Date.now(),
      };
      this.send(peerId, completeMessage);
    } else {
      console.warn(`[PeerManager] Peer ${store.localPeerId} received background request but is not host.`);
    }
  }

  private handleBackgroundChunk(peerId: PeerId, message: BackgroundChunkMessage) {
    const fileId = `${peerId}-${message.fileName}`;
    let buffer = this.incomingFileBuffers.get(peerId)?.get(fileId);

    if (!buffer) {
      buffer = { chunks: [], totalChunks: message.totalChunks, fileName: message.fileName, fileType: message.fileType };
      if (!this.incomingFileBuffers.has(peerId)) {
        this.incomingFileBuffers.set(peerId, new Map());
      }
      this.incomingFileBuffers.get(peerId)?.set(fileId, buffer);
    }

    buffer.chunks[message.chunkIndex] = message.data;

    // Check if all chunks received
    const receivedAllChunks = buffer.chunks.length === buffer.totalChunks &&
                              buffer.chunks.every(chunk => chunk !== undefined);

    if (receivedAllChunks) {
      console.log(`[PeerManager] All chunks received for ${message.fileName} from ${peerId}.`);
      
      let dataUrl: string;
      
      // Check if chunks are strings (base64) or ArrayBuffers
      if (typeof buffer.chunks[0] === 'string') {
          const fullData = buffer.chunks.join('');
          dataUrl = `data:${buffer.fileType};base64,${fullData}`;
      } else {
          // Assume ArrayBuffer
          const blob = new Blob(buffer.chunks as ArrayBuffer[], { type: buffer.fileType });
          dataUrl = URL.createObjectURL(blob);
      }

      this.notifyBackgroundTransfer(peerId, buffer.fileName, buffer.fileType, dataUrl);

      // Clean up buffer
      this.incomingFileBuffers.get(peerId)?.delete(fileId);
      if (this.incomingFileBuffers.get(peerId)?.size === 0) {
        this.incomingFileBuffers.delete(peerId);
      }
    }
  }

  private notifyBackgroundTransfer(peerId: PeerId, fileName: string, fileType: string, dataUrl: string) {
    this.backgroundTransferHandlers.forEach(handler => {
      try {
        handler(peerId, fileName, fileType, dataUrl);
      } catch (e) {
        console.error('[PeerManager] Background transfer handler error:', e);
      }
    });
  }

  private handleBackgroundComplete(peerId: PeerId, message: BackgroundCompleteMessage) {
    console.log(`[PeerManager] Background transfer complete for ${message.fileName} from ${peerId}.`)
    // The actual file reassembly and notification happens in handleBackgroundChunk,
    // but this message confirms completion for tracking/UI purposes.
  }

  /**
   * Handle disconnection with auto-reconnect
   */
  private handleDisconnect() {
    const store = useMultiplayerStore.getState();
    
    // Check if we are already handling a disconnect or destroyed
    if (this.isDestroyed) return;

    // Notify listeners
    this.notifyError(new Error('Disconnected from signaling server'));

    // Try to reconnect using PeerJS built-in reconnect first
    if (this.peer && this.peer.disconnected) {
      console.log('[PeerManager] Attempting PeerJS reconnect...');
      try {
        this.peer.reconnect();
        return;
      } catch (e) {
        console.warn('[PeerManager] PeerJS reconnect failed:', e);
      }
    }
    
    // If that fails, try full reconnection
    if (this.reconnectAttempts < this.config.reconnectAttempts && 
        this.lastRoomId && 
        this.lastDisplayName && 
        !this.isDestroyed) {
      
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000); // Exponential backoff, max 10s
      
      console.log(`[PeerManager] Auto-reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.reconnectAttempts})`);
      store.setError(`Reconnecting... (${this.reconnectAttempts}/${this.config.reconnectAttempts})`);
      
      setTimeout(() => {
        if (this.isDestroyed) return;
        
        // Clean up current peer
        if (this.peer) {
          try { this.peer.destroy(); } catch (_e) { /* ignore */ }
          this.peer = null;
        }
        this.connections.clear();
        
        // Attempt to rejoin
        if (this.lastRole === 'guest' && this.lastRoomId && this.lastDisplayName) {
          console.log('[PeerManager] Attempting to rejoin session:', this.lastRoomId);
          this.joinSession(this.lastRoomId, this.lastDisplayName)
            .then(() => {
              console.log('[PeerManager] Auto-reconnect successful');
              store.setError(null);
            })
            .catch((err) => {
              console.error('[PeerManager] Auto-reconnect failed:', err);
              // Force destroy before retrying to ensure clean state
              try { this.peer?.destroy(); } catch (e) { /* ignore */ }
              this.peer = null;
              this.handleDisconnect(); // Try again
            });
        } else if (this.lastRole === 'host' && this.lastDisplayName) {
          // Host can't really "rejoin" with the same room ID
          // Just attempt to recreate with new ID
          this.createSession(this.lastDisplayName)
            .then(() => {
              console.log('[PeerManager] Auto-reconnect (new session) successful');
              store.setError('Session recreated with new ID');
            })
            .catch((err) => {
              console.error('[PeerManager] Auto-reconnect failed:', err);
              this.handleDisconnect(); // Try again
            });
        }
      }, delay);
    } else if (this.reconnectAttempts >= this.config.reconnectAttempts) {
      console.error('[PeerManager] Max reconnect attempts reached');
      store.setError('Connection lost. Please rejoin manually.');
      store.setConnected(false);
    }
  }

  private generateRoomId(): RoomId {
    // Generate a memorable room ID: adjective-noun-number
    const adjectives = ['swift', 'cosmic', 'neon', 'cyber', 'quantum', 'neural', 'void', 'azure'];
    const nouns = ['runner', 'ghost', 'phoenix', 'matrix', 'nexus', 'pulse', 'wave', 'forge'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${adj}-${noun}-${num}`;
  }

  private generatePeerId(): PeerId {
    return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Clean up and destroy the peer connection
   */
  destroy() {
    this.isDestroyed = true;
    this.stopHeartbeat();

    // Disable voice chat
    voiceChatManager.disable();
    // voiceChatManager.setPeer(null);

    // Clear all reconnect timers
    this.reconnectTimers.forEach(timer => clearTimeout(timer));
    this.reconnectTimers.clear();

    // Close all connections
    this.connections.forEach(conn => {
      try {
        conn.close();
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    this.connections.clear();

    // Destroy peer
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.peer = null;
    }

    // Clear handlers
    this.messageHandlers.clear();
    this.connectionHandlers.clear();
    this.errorHandlers.clear();
  }

  /**
   * Get the underlying Peer instance (for voice chat integration)
   */
  getPeer(): Peer | null {
    return this.peer;
  }

  /**
   * Request a background from a peer
   */
  requestBackground(peerId: PeerId) {
    const store = useMultiplayerStore.getState();
    if (!store.localPeerId) return;

    const message: BackgroundRequestMessage = {
      type: 'background-request',
      peerId: store.localPeerId,
      targetPeerId: peerId,
      timestamp: Date.now(),
    };
    this.send(peerId, message);
  }

  /**
   * Send a background file to a peer
   * Chunks the file and sends it reliably.
   */
  async sendBackground(peerId: PeerId, file: File) {
    const store = useMultiplayerStore.getState();
    if (!store.localPeerId) return;

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const chunkSize = this.config.vrmChunkSize; // Using the same chunk size as VRM
    const totalChunks = Math.ceil(base64Data.length / chunkSize);

    console.log(`[PeerManager] Sending background ${file.name} to ${peerId} in ${totalChunks} chunks.`);

    for (let i = 0; i < totalChunks; i++) {
      const chunk = base64Data.slice(i * chunkSize, (i + 1) * chunkSize);
      const message: BackgroundChunkMessage = {
        type: 'background-chunk',
        peerId: store.localPeerId,
        targetPeerId: peerId,
        chunkIndex: i,
        totalChunks,
        data: chunk,
        fileName: file.name,
        fileType: file.type,
        timestamp: Date.now(),
      };
      // Send reliably, potentially with a small delay to prevent overwhelming the connection
      await new Promise(resolve => setTimeout(() => {
        this.send(peerId, message);
        resolve(null);
      }, 5)); // Small delay to avoid overwhelming the data channel
    }

    // Send complete message
    const completeMessage: BackgroundCompleteMessage = {
      type: 'background-complete',
      peerId: store.localPeerId,
      targetPeerId: peerId,
      fileName: file.name,
      fileType: file.type,
      totalSize: file.size,
      timestamp: Date.now(),
    };
    this.send(peerId, completeMessage);
    console.log(`[PeerManager] Finished sending background ${file.name} to ${peerId}.`);
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) return;
    
    // Check connection health every 5 seconds
    this.heartbeatInterval = setInterval(() => {
      const store = useMultiplayerStore.getState();
      const localPeerId = store.localPeerId;
      if (!localPeerId) return;

      this.connections.forEach((conn, peerId) => {
        if (conn.open) {
          try {
            conn.send({
              type: 'ping',
              peerId: localPeerId,
              timestamp: Date.now(),
              sentAt: Date.now()
            });
          } catch (e) {
            console.warn(`[PeerManager] Failed to send heartbeat to ${peerId}`, e);
          }
        }
      });
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

}

// Singleton instance
export const peerManager = new PeerManager();

