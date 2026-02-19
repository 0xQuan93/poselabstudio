import type { VRMPose } from '@pixiv/three-vrm';

/** Unique identifier for a peer in the session */
export type PeerId = string;

/** Unique identifier for a multiplayer room/session */
export type RoomId = string;

/** Connection state for a peer */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Role in the session */
export type SessionRole = 'host' | 'guest';

/** Avatar state that gets synchronized across peers */
export interface AvatarState {
  peerId: PeerId;
  displayName: string;
  /** Scene rotation of the avatar root */
  sceneRotation: { x: number; y: number; z: number };
  /** Normalized bone pose */
  pose: VRMPose;
  /** Expression weights (e.g., { Joy: 0.8, Angry: 0 }) */
  expressions: Record<string, number>;
  /** Position offset in scene (for multiple avatars) */
  position?: { x: number; y: number; z: number };
  /** Whether this avatar has a VRM loaded */
  hasAvatar: boolean;
  /** Timestamp for ordering/staleness */
  timestamp: number;
}

/** Peer info for UI display */
export interface PeerInfo {
  peerId: PeerId;
  displayName: string;
  connectionState: ConnectionState;
  hasAvatar: boolean;
  isLocal: boolean;
  /** Current presence state */
  presence?: PresenceState;
  /** Latency in ms */
  latency?: number;
  /** Last activity timestamp */
  lastActivity?: number;
}

/** Session state */
export interface SessionState {
  roomId: RoomId | null;
  role: SessionRole | null;
  isConnected: boolean;
  peers: Map<PeerId, PeerInfo>;
  localPeerId: PeerId | null;
}

/** Message types for peer communication */
export type MessageType = 
  | 'avatar-state'      // Full avatar state update
  | 'pose-update'       // Incremental pose update (high frequency)
  | 'expression-update' // Expression change
  | 'vrm-request'       // Request VRM file from peer
  | 'vrm-chunk'         // VRM file data chunk
  | 'vrm-complete'      // VRM transfer complete
  | 'vrm-chunk-request' // Request a missing VRM chunk
  | 'peer-join'         // Peer joined session
  | 'peer-leave'        // Peer left session
  | 'sync-request'      // Request full state sync
  | 'sync-response'     // Full state sync response
  | 'scene-sync'        // Scene settings sync (background, etc.)
  | 'ping'              // Latency check
  | 'pong'              // Latency response
  // Social features
  | 'chat'              // Text chat message
  | 'reaction'          // Quick emoji reaction (triggers avatar animation)
  | 'presence'          // Presence update (typing, AFK, recording, etc.)
  | 'group-photo'       // Synchronized photo capture
  | 'countdown'        // Countdown sync for group photos
  | 'background-request' // New: Request a peer's animated background
  | 'background-chunk'   // New: Send animated background data in chunks
  | 'background-complete';// New: Signal completion of animated background transfer

/** Base message structure */
export interface BaseMessage {
  type: MessageType;
  peerId: PeerId;
  timestamp: number;
}

/** Avatar state message (full update) */
export interface AvatarStateMessage extends BaseMessage {
  type: 'avatar-state';
  state: AvatarState;
}

/** High-frequency pose update (optimized) */
export interface PoseUpdateMessage extends BaseMessage {
  type: 'pose-update';
  pose: VRMPose;
  sceneRotation?: { x: number; y: number; z: number };
  /** User-controlled position offset (X-axis translation via gizmo) */
  scenePosition?: { x: number; y: number; z: number };
}

/** Expression update */
export interface ExpressionUpdateMessage extends BaseMessage {
  type: 'expression-update';
  expressions: Record<string, number>;
}

/** VRM file transfer messages */
export interface VRMRequestMessage extends BaseMessage {
  type: 'vrm-request';
  targetPeerId: PeerId;
}

export interface VRMChunkMessage extends BaseMessage {
  type: 'vrm-chunk';
  targetPeerId: PeerId;
  chunkIndex: number;
  totalChunks: number;
  data: string | ArrayBuffer; // Base64 or ArrayBuffer
}

export interface VRMCompleteMessage extends BaseMessage {
  type: 'vrm-complete';
  targetPeerId: PeerId;
  fileName: string;
  totalSize: number;
}

export interface VRMChunkRequestMessage extends BaseMessage {
  type: 'vrm-chunk-request';
  targetPeerId: PeerId;
  chunkIndex: number;
}

/** New: Background file transfer messages */
export interface BackgroundRequestMessage extends BaseMessage {
  type: 'background-request';
  targetPeerId: PeerId;
}

export interface BackgroundChunkMessage extends BaseMessage {
  type: 'background-chunk';
  targetPeerId: PeerId;
  chunkIndex: number;
  totalChunks: number;
  data: string | ArrayBuffer; // Base64 or ArrayBuffer
  fileName: string; // To identify the file being sent
  fileType: string; // MIME type (e.g., 'video/webm', 'image/gif')
}

export interface BackgroundCompleteMessage extends BaseMessage {
  type: 'background-complete';
  targetPeerId: PeerId;
  fileName: string;
  fileType: string;
  totalSize: number;
}

/** Peer events */
export interface PeerJoinMessage extends BaseMessage {
  type: 'peer-join';
  displayName: string;
}

export interface PeerLeaveMessage extends BaseMessage {
  type: 'peer-leave';
}

/** Sync messages */
export interface SyncRequestMessage extends BaseMessage {
  type: 'sync-request';
}

export interface SyncResponseMessage extends BaseMessage {
  type: 'sync-response';
  avatarStates: AvatarState[];
  sceneSettings?: {
    background?: string;
    aspectRatio?: string;
  };
}

/** Scene sync */
export interface SceneSyncMessage extends BaseMessage {
  type: 'scene-sync';
  background?: string;
  aspectRatio?: string;
  /** Base64 encoded custom background image data */
  customBackgroundData?: string;
  /** MIME type of custom background */
  customBackgroundType?: string;
}

/** Ping/Pong for latency */
export interface PingMessage extends BaseMessage {
  type: 'ping';
  sentAt: number;
}

export interface PongMessage extends BaseMessage {
  type: 'pong';
  sentAt: number;
  receivedAt: number;
}

/** Chat message */
export interface ChatMessage extends BaseMessage {
  type: 'chat';
  text: string;
  displayName: string;
}

/** Quick reaction types */
export type ReactionType = 'wave' | 'thumbsUp' | 'point' | 'clap' | 'dance';

/** Reaction message - triggers avatar animation */
export interface ReactionMessage extends BaseMessage {
  type: 'reaction';
  reaction: ReactionType;
  displayName: string;
}

/** Presence states */
export type PresenceState = 'active' | 'typing' | 'afk' | 'recording' | 'posing' | 'capturing';

/** Presence update */
export interface PresenceMessage extends BaseMessage {
  type: 'presence';
  state: PresenceState;
}

/** Group photo request/sync */
export interface GroupPhotoMessage extends BaseMessage {
  type: 'group-photo';
  action: 'request' | 'ready' | 'capture' | 'complete';
  /** Photo ID for tracking */
  photoId: string;
}

/** Countdown sync for group photos */
export interface CountdownMessage extends BaseMessage {
  type: 'countdown';
  count: number; // 3, 2, 1, 0 (capture)
  photoId: string;
}

/** Union type for all messages */
export type PeerMessage = 
  | AvatarStateMessage
  | PoseUpdateMessage
  | ExpressionUpdateMessage
  | VRMRequestMessage
  | VRMChunkMessage
  | VRMCompleteMessage
  | VRMChunkRequestMessage
  | PeerJoinMessage
  | PeerLeaveMessage
  | SyncRequestMessage
  | SyncResponseMessage
  | SceneSyncMessage
  | PingMessage
  | PongMessage
  // Social messages
  | ChatMessage
  | ReactionMessage
  | PresenceMessage
  | GroupPhotoMessage
  | CountdownMessage
  | BackgroundRequestMessage // Add new message types to the union
  | BackgroundChunkMessage
  | BackgroundCompleteMessage;

/** Configuration for multiplayer */
export interface MultiplayerConfig {
  /** Maximum peers in a session */
  maxPeers: number;
  /** Pose sync rate in Hz */
  poseSyncRate: number;
  /** Enable VRM file transfer between peers */
  enableVRMTransfer: boolean;
  /** VRM chunk size for transfer (bytes) */
  vrmChunkSize: number;
  /** Connection timeout in ms */
  connectionTimeout: number;
  /** Reconnection attempts */
  reconnectAttempts: number;
}

/** Default config */
export const DEFAULT_MULTIPLAYER_CONFIG: MultiplayerConfig = {
  maxPeers: 32,
  poseSyncRate: 30, // 30 FPS sync
  enableVRMTransfer: true,
  vrmChunkSize: 6 * 1024, // 6KB chunks (~8KB as base64, fits in WebRTC data channel limits)
  connectionTimeout: 10000,
  reconnectAttempts: 3,
};

